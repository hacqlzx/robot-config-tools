import { shell } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import os from "os";
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
const MAP_DIR_NAME = "地图";

interface ImportedSpaceModelZipResult {
  mapName: string;
  mapDir: string;
  modelPath: string;
}

interface PreparedMapSource {
  sourceDir: string;
  mapName: string;
}

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

export async function importProjectModelZip(projectName: string, sourcePath: string): Promise<ImportedSpaceModelZipResult> {
  const rawSourcePath = String(sourcePath ?? "").trim();
  if (!rawSourcePath || !path.isAbsolute(rawSourcePath)) {
    throw new Error("源压缩包路径无效");
  }

  const sourceResolved = path.resolve(rawSourcePath);
  if (path.extname(sourceResolved).toLowerCase() !== ".zip") {
    throw new Error("仅支持 ZIP 空间模型包");
  }

  let sourceStat: Awaited<ReturnType<typeof fs.promises.stat>> | null = null;
  try {
    sourceStat = await fs.promises.stat(sourceResolved);
  } catch {
    sourceStat = null;
  }
  if (!sourceStat?.isFile()) {
    throw new Error("源压缩包不存在");
  }

  const manifest = ensureProjectManifest(projectName);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robot-space-import-"));

  try {
    const zip = new AdmZip(sourceResolved);
    zip.extractAllTo(tempRoot, true);

    const prepared = prepareMapSourceDir(tempRoot, sourceResolved);
    const mapSourceDir = prepared.sourceDir;
    const mapName = assertSafePathSegment(prepared.mapName, "地图名称");
    const targetDir = resolveProjectPath(projectName, manifest.layout.dirs.maps || MAP_DIR_NAME, mapName);

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      removeManifestAssetsUnderPath(projectName, targetDir);
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.cpSync(mapSourceDir, targetDir, { recursive: true, force: true });

    const modelPath = findPreferredModelFile(targetDir);
    if (!modelPath) {
      throw new Error("压缩包中未找到 map.las 或 LAS/LAZ 模型文件");
    }

    const modelStat = fs.statSync(modelPath);
    updateManifestForWrittenFile(projectName, modelPath, modelStat.size);

    const mapInfoPath = path.join(targetDir, MAP_INFO_FILE_NAME);
    if (!fs.existsSync(mapInfoPath)) {
      const mapInfoText = `${JSON.stringify({ mapName }, null, 2)}\n`;
      await fs.promises.writeFile(mapInfoPath, mapInfoText, "utf-8");
      updateManifestForWrittenFile(projectName, mapInfoPath, Buffer.byteLength(mapInfoText));
    } else {
      updateManifestForWrittenFile(projectName, mapInfoPath, fs.statSync(mapInfoPath).size);
    }

    return { mapName, mapDir: targetDir, modelPath };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function prepareMapSourceDir(extractDir: string, sourceZipPath: string): PreparedMapSource {
  const outerMapZip = findOuterMapZip(extractDir);
  if (outerMapZip) {
    const mapName = assertSafePathSegment(path.basename(outerMapZip, ".zip"), "地图名称");
    const mapExtractDir = path.join(extractDir, "__map__", mapName);
    fs.mkdirSync(mapExtractDir, { recursive: true });
    new AdmZip(outerMapZip).extractAllTo(mapExtractDir, true);
    flattenSingleWrapperDir(mapExtractDir);
    normalizeMapModelFileName(mapExtractDir);
    return { sourceDir: mapExtractDir, mapName };
  }

  const mapDirFromOuterPackage = findMapDirUnderMapRoot(extractDir);
  if (mapDirFromOuterPackage) {
    normalizeMapModelFileName(mapDirFromOuterPackage);
    return { sourceDir: mapDirFromOuterPackage, mapName: path.basename(mapDirFromOuterPackage) };
  }

  flattenSingleWrapperDir(extractDir);
  const directModel = findPreferredModelFile(extractDir, false);
  if (directModel) {
    normalizeMapModelFileName(extractDir);
    return { sourceDir: extractDir, mapName: path.basename(sourceZipPath, ".zip") };
  }

  const mapDir = findDirContainingModel(extractDir);
  if (mapDir) {
    normalizeMapModelFileName(mapDir);
    return { sourceDir: mapDir, mapName: path.basename(mapDir) };
  }

  throw new Error("压缩包中未找到地图模型文件");
}

function findOuterMapZip(rootDir: string): string | null {
  const mapRoot = path.join(rootDir, MAP_DIR_NAME);
  if (!fs.existsSync(mapRoot)) return null;

  const entries = fs.readdirSync(mapRoot, { withFileTypes: true });
  const zipEntries = entries.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".zip");
  if (zipEntries.length > 1) {
    throw new Error("空间模型加载仅支持单个地图包，请选择单地图导出的 ZIP");
  }
  return zipEntries[0] ? path.join(mapRoot, zipEntries[0].name) : null;
}

function findMapDirUnderMapRoot(rootDir: string): string | null {
  const mapRoot = path.join(rootDir, MAP_DIR_NAME);
  if (!fs.existsSync(mapRoot)) return null;

  if (findPreferredModelFile(mapRoot, false)) return mapRoot;

  const entries = fs.readdirSync(mapRoot, { withFileTypes: true });
  const mapDir = entries.find((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("__")) return false;
    return !!findPreferredModelFile(path.join(mapRoot, entry.name), false);
  });
  return mapDir ? path.join(mapRoot, mapDir.name) : null;
}

function flattenSingleWrapperDir(targetDir: string): void {
  const items = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((item) => !item.name.startsWith(".") && !item.name.startsWith("__"));
  if (items.length !== 1 || !items[0].isDirectory()) return;

  const wrapper = path.join(targetDir, items[0].name);
  if (!findPreferredModelFile(wrapper)) return;

  for (const item of fs.readdirSync(wrapper, { withFileTypes: true })) {
    const src = path.join(wrapper, item.name);
    const dst = path.join(targetDir, item.name);
    fs.cpSync(src, dst, { recursive: true, force: true });
  }
  fs.rmSync(wrapper, { recursive: true, force: true });
}

function findDirContainingModel(rootDir: string): string | null {
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (findPreferredModelFile(dir, false)) return dir;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !item.name.startsWith(".") && !item.name.startsWith("__")) {
        queue.push(path.join(dir, item.name));
      }
    }
  }
  return null;
}

function findPreferredModelFile(rootDir: string, recursive = true): string | null {
  const directMapLas = path.join(rootDir, MAP_MODEL_FILE_NAME);
  if (fs.existsSync(directMapLas)) return directMapLas;

  const direct = fs.readdirSync(rootDir, { withFileTypes: true })
    .find((entry) => entry.isFile() && SUPPORTED_MAP_EXTS.has(path.extname(entry.name).toLowerCase()));
  if (direct) return path.join(rootDir, direct.name);

  if (!recursive) return null;
  for (const item of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith(".") || item.name.startsWith("__")) continue;
    const found = findPreferredModelFile(path.join(rootDir, item.name), true);
    if (found) return found;
  }
  return null;
}

function normalizeMapModelFileName(mapDir: string): void {
  const target = path.join(mapDir, MAP_MODEL_FILE_NAME);
  if (fs.existsSync(target)) return;

  const model = findPreferredModelFile(mapDir, false);
  if (!model) return;
  const ext = path.extname(model).toLowerCase();
  if (!SUPPORTED_MAP_EXTS.has(ext)) return;
  fs.renameSync(model, target);
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
