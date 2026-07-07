import { shell } from "electron";
import fs from "fs";
import path from "path";
import { getDatabase } from "@robot/database";
import { exportSpaceZip } from "../export-points";
import { getProjectRoot, ensureProjectRoot, hasProjectRootConfig, initProjectRoot } from "./project-root";
import {
  assertInside,
  assertSafePathSegment,
  getProjectContextFromPath,
  resolveProjectDir,
  resolveProjectPath,
  resolveProjectRootPath,
} from "./project-paths";
import {
  assertWritableProjectFile,
  createDefaultManifest,
  ensureProjectManifest,
  manifestPath,
  PROJECT_MANIFEST_FILE,
  removeManifestAssetsUnderPath,
  rewriteManifestAssetPathsAfterMove,
  SUPPORTED_MAP_EXTS,
  updateManifestForProjectRename,
  updateManifestForWrittenFile,
  writeProjectManifestByDir,
} from "./project-manifest";
import { readDirTree, type TreeNode } from "./project-tree";

const MAP_MODEL_FILE_NAME = "map.las";
const MAP_INFO_FILE_NAME = "map_info.json";

export async function listProjects(): Promise<string[]> {
  ensureProjectRoot();
  const entries = fs.readdirSync(getProjectRoot(), { withFileTypes: true });
  const projectNames = entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of projectNames) {
    try {
      ensureProjectManifest(name);
    } catch (err) {
      console.warn("[project:manifest] repair failed:", name, err);
    }
  }

  return projectNames;
}

export async function createProject(name: string): Promise<string> {
  if (!hasProjectRootConfig()) await initProjectRoot();
  ensureProjectRoot();

  const safeName = assertSafePathSegment(name, "项目名称");
  const dirPath = resolveProjectDir(safeName);
  if (fs.existsSync(dirPath)) {
    throw new Error(`项目 "${safeName}" 已存在`);
  }

  fs.mkdirSync(dirPath);
  writeProjectManifestByDir(dirPath, createDefaultManifest(safeName));
  return safeName;
}

export async function renameProject(oldName: string, newName: string): Promise<string> {
  ensureProjectRoot();
  const safeNewName = assertSafePathSegment(newName, "项目名称");
  const oldPath = resolveProjectDir(oldName);
  const newPath = resolveProjectDir(safeNewName);
  if (!fs.existsSync(oldPath)) {
    throw new Error(`项目 "${oldName}" 不存在`);
  }
  if (fs.existsSync(newPath)) {
    throw new Error(`项目 "${safeNewName}" 已存在`);
  }

  fs.renameSync(oldPath, newPath);
  updateManifestForProjectRename(safeNewName);
  return safeNewName;
}

export async function deleteProject(name: string): Promise<string> {
  ensureProjectRoot();
  const dirPath = resolveProjectDir(name);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`项目 "${name}" 不存在`);
  }
  fs.rmSync(dirPath, { recursive: true });
  return name;
}

export async function importProjectModel(projectName: string, sourcePath: string, fileName: string): Promise<string> {
  const rawSourcePath = String(sourcePath ?? "").trim();
  if (!rawSourcePath || !path.isAbsolute(rawSourcePath)) {
    throw new Error("源模型路径无效");
  }

  const sourceResolved = path.resolve(rawSourcePath);
  const ext = path.extname(sourceResolved).toLowerCase();
  if (!SUPPORTED_MAP_EXTS.has(ext)) {
    throw new Error("仅支持 LAS/LAZ 模型文件");
  }

  let sourceStat: Awaited<ReturnType<typeof fs.promises.stat>> | null = null;
  try {
    sourceStat = await fs.promises.stat(sourceResolved);
  } catch {
    sourceStat = null;
  }
  if (!sourceStat?.isFile()) {
    throw new Error("源模型文件不存在");
  }

  const safeBaseName = assertSafePathSegment(String(fileName ?? "").replace(/\.[^.]+$/, ""), "地图名称");
  const manifest = ensureProjectManifest(projectName);
  const targetDir = resolveProjectPath(projectName, manifest.layout.dirs.maps, safeBaseName);
  const targetPath = resolveProjectPath(projectName, manifest.layout.dirs.maps, safeBaseName, MAP_MODEL_FILE_NAME);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (sourceResolved.toLowerCase() !== targetPath.toLowerCase()) {
    await fs.promises.copyFile(sourceResolved, targetPath);
  }
  updateManifestForWrittenFile(projectName, targetPath, Number(sourceStat.size));

  const mapInfoPath = resolveProjectPath(projectName, manifest.layout.dirs.maps, safeBaseName, MAP_INFO_FILE_NAME);
  if (!fs.existsSync(mapInfoPath)) {
    const mapInfoText = `${JSON.stringify({ mapName: safeBaseName }, null, 2)}\n`;
    await fs.promises.writeFile(mapInfoPath, mapInfoText, "utf-8");
    updateManifestForWrittenFile(projectName, mapInfoPath, Buffer.byteLength(mapInfoText));
  }
  return targetPath;
}

export function getProjectManifest(projectName: string) {
  return ensureProjectManifest(projectName);
}

export async function listProjectTree(projectName: string, subDir: string): Promise<TreeNode[]> {
  const targetDir = resolveProjectPath(projectName, subDir || "");
  return readDirTree(targetDir);
}

export async function writeProjectFile(projectName: string, subPath: string, data: ArrayBuffer): Promise<string> {
  const filePath = resolveProjectPath(projectName, subPath);
  assertWritableProjectFile(projectName, filePath);

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buf = Buffer.from(data);
  await fs.promises.writeFile(filePath, buf);
  updateManifestForWrittenFile(projectName, filePath, buf.byteLength);
  return filePath;
}

export async function deleteProjectPath(targetPath: string): Promise<boolean> {
  const resolved = resolveProjectRootPath(targetPath, "删除");
  if (path.relative(path.resolve(getProjectRoot()), resolved) === "") {
    throw new Error("禁止删除项目根目录");
  }

  const { projectName, projectDir } = getProjectContextFromPath(resolved);
  if (resolved === projectDir) {
    throw new Error("请通过项目管理删除项目");
  }
  if (resolved === manifestPath(projectDir)) {
    throw new Error("项目清单由主进程维护，禁止删除");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("文件不存在");
  }

  fs.rmSync(resolved, { recursive: true, force: true });
  removeManifestAssetsUnderPath(projectName, resolved);
  return true;
}

export async function renameProjectPath(targetPath: string, newName: string): Promise<string> {
  const resolved = resolveProjectRootPath(targetPath, "重命名");
  if (path.relative(path.resolve(getProjectRoot()), resolved) === "") {
    throw new Error("禁止重命名项目根目录");
  }

  const { projectName, projectDir } = getProjectContextFromPath(resolved);
  if (resolved === projectDir) {
    throw new Error("请通过项目管理重命名项目");
  }
  if (resolved === manifestPath(projectDir)) {
    throw new Error("项目清单由主进程维护，禁止重命名");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error("文件不存在");
  }

  const safeName = assertSafePathSegment(newName, "名称");
  const newPath = assertInside(getProjectRoot(), path.resolve(path.dirname(resolved), safeName), "重命名");
  if (fs.existsSync(newPath)) {
    throw new Error("同名文件已存在");
  }

  fs.renameSync(resolved, newPath);
  rewriteManifestAssetPathsAfterMove(projectName, resolved, newPath);
  return newPath;
}

export async function openProjectPath(targetPath: string): Promise<void> {
  const resolved = resolveProjectRootPath(targetPath, "打开目录");
  shell.showItemInFolder(resolved);
}

export async function exportProjectFile(projectName: string, subPath: string, destDir: string): Promise<string> {
  const srcPath = resolveProjectPath(projectName, subPath);
  if (!fs.existsSync(srcPath)) throw new Error("源文件不存在: " + subPath);

  const fileName = path.basename(srcPath);
  const rawDestDir = String(destDir ?? "").trim();
  if (!rawDestDir) throw new Error("目标目录不能为空");
  const destRoot = path.resolve(rawDestDir);
  const destPath = path.join(destRoot, fileName);
  await fs.promises.copyFile(srcPath, destPath);
  return destPath;
}

export interface ExportZipItem {
  type: string;
  name: string;
}

export async function exportProjectZip(
  projectName: string,
  items: ExportZipItem[],
  destDir: string,
  onProgress: (step: string, pct: number) => void,
) {
  const safeProjectName = assertSafePathSegment(projectName, "项目名称");
  const rawDestDir = String(destDir ?? "").trim();
  if (!rawDestDir) throw new Error("目标目录不能为空");

  const destRoot = path.resolve(rawDestDir);
  const db = getDatabase();
  const points: any[] = db.prepare("SELECT * FROM device_point WHERE project_name = ?").all(safeProjectName);

  const includePointTable = items.some((it) => it.type === "点表");
  const mapDirs = items
    .filter((it) => it.type === "地图")
    .map((it) => assertSafePathSegment(it.name, "地图名称"));

  return exportSpaceZip(safeProjectName, getProjectRoot(), points, mapDirs, includePointTable, destRoot, onProgress);
}
