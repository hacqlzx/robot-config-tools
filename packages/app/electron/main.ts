import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from "electron";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { initDbIpc, closeDbIpc } from "./db-ipc";
import { getDatabase } from "@robot/database";
import { exportSpaceZip } from "./export-points";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === GPU 配置：解决双显卡机器默认使用核显导致模型颜色渲染异常的问题 ===
// 绕过 Chromium GPU 黑名单，避免某些核显被强制回退到软件渲染导致颜色丢失
app.commandLine.appendSwitch("ignore-gpu-blocklist");
// 指定使用 D3D11 作为 ANGLE 后端（微软官方推荐的 WebGL 后端，兼容性与稳定性最优）
app.commandLine.appendSwitch("use-angle", "d3d11");
// 禁用 GPU vsync，减少渲染延迟
app.commandLine.appendSwitch("disable-gpu-vsync");

let PROJECT_ROOT = "";

const SUPPORTED_MAP_EXTS = new Set([".las", ".laz"]);
const POINT_TABLE_EXTS = new Set([".xls", ".xlsx"]);
const PROJECT_MANIFEST_FILE = "project.manifest.json";
const PROJECT_MANIFEST_SCHEMA_VERSION = 1;
const PROJECT_LAYOUT_VERSION = 1;
const DEFAULT_PROJECT_DIRS = {
  maps: "地图",
  pointTables: "点表",
  surveyImages: "勘察图",
};

interface ProjectManifestAsset {
  id: string;
  name: string;
  relativePath: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface ProjectManifest {
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  layout: {
    version: number;
    dirs: {
      maps: string;
      pointTables: string;
      surveyImages: string;
      [key: string]: string;
    };
  };
  assets: {
    maps: ProjectManifestAsset[];
    pointTables: ProjectManifestAsset[];
    surveyTasks: ProjectManifestAsset[];
  };
}

type ManifestAssetCollection = keyof ProjectManifest["assets"];

interface ManifestAssetInput {
  id?: string;
  name: string;
  relativePath: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

function assertSafePathSegment(name: string, label: string): string {
  const value = String(name ?? "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  if (value === "." || value === ".." || /[<>:"/\\|?*\x00-\x1F]/.test(value)) {
    throw new Error(`${label}包含非法字符`);
  }
  return value;
}

function isPathInside(parent: string, target: string): boolean {
  const parentResolved = path.resolve(parent);
  const targetResolved = path.resolve(target);
  const relative = path.relative(parentResolved, targetResolved);
  return relative === "" || (!!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertInside(parent: string, target: string, action: string): string {
  const resolved = path.resolve(target);
  if (!isPathInside(parent, resolved)) {
    throw new Error(`路径越界，禁止${action}`);
  }
  return resolved;
}

function resolveProjectDir(projectName: string): string {
  ensureProjectRoot();
  const safeProjectName = assertSafePathSegment(projectName, "项目名称");
  const dirPath = path.resolve(PROJECT_ROOT, safeProjectName);
  return assertInside(PROJECT_ROOT, dirPath, "访问项目");
}

function resolveProjectPath(projectName: string, ...segments: string[]): string {
  const projectDir = resolveProjectDir(projectName);
  const targetPath = path.resolve(projectDir, ...segments);
  return assertInside(projectDir, targetPath, "访问项目文件");
}

function resolveProjectRootPath(targetPath: string, action: string): string {
  ensureProjectRoot();
  const value = String(targetPath ?? "").trim();
  if (!value) throw new Error("路径不能为空");
  if (!path.isAbsolute(value)) {
    throw new Error(`路径必须是绝对路径，禁止${action}`);
  }
  const resolved = path.resolve(value);
  return assertInside(PROJECT_ROOT, resolved, action);
}

function nowIso(): string {
  return new Date().toISOString();
}

function toProjectRelativePath(projectDir: string, targetPath: string): string {
  const relative = path.relative(projectDir, assertInside(projectDir, targetPath, "访问项目文件"));
  return relative.replace(/\\/g, "/");
}

function manifestPath(projectDir: string): string {
  return path.join(projectDir, PROJECT_MANIFEST_FILE);
}

function sanitizeAssetList(value: unknown): ProjectManifestAsset[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const stamp = nowIso();
      return {
        ...item,
        id: typeof item.id === "string" && item.id ? item.id : randomUUID(),
        name: typeof item.name === "string" ? item.name : "",
        relativePath: typeof item.relativePath === "string" ? item.relativePath.replace(/\\/g, "/") : "",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : stamp,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : stamp,
      };
    })
    .filter((item) => item.name && item.relativePath);
}

function createDefaultManifest(projectName: string): ProjectManifest {
  const stamp = nowIso();
  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    project: {
      id: randomUUID(),
      name: projectName,
      createdAt: stamp,
      updatedAt: stamp,
    },
    layout: {
      version: PROJECT_LAYOUT_VERSION,
      dirs: { ...DEFAULT_PROJECT_DIRS },
    },
    assets: {
      maps: [],
      pointTables: [],
      surveyTasks: [],
    },
  };
}

function normalizeManifest(projectName: string, raw: any): ProjectManifest {
  const defaults = createDefaultManifest(projectName);
  const project = raw?.project && typeof raw.project === "object" ? raw.project : {};
  const layout = raw?.layout && typeof raw.layout === "object" ? raw.layout : {};
  const dirs = layout.dirs && typeof layout.dirs === "object" ? layout.dirs : {};
  const assets = raw?.assets && typeof raw.assets === "object" ? raw.assets : {};

  return {
    schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
    project: {
      id: typeof project.id === "string" && project.id ? project.id : defaults.project.id,
      name: projectName,
      createdAt: typeof project.createdAt === "string" ? project.createdAt : defaults.project.createdAt,
      updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : defaults.project.updatedAt,
    },
    layout: {
      version: typeof layout.version === "number" ? layout.version : PROJECT_LAYOUT_VERSION,
      dirs: {
        ...DEFAULT_PROJECT_DIRS,
        ...Object.fromEntries(
          Object.entries(dirs).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !!entry[1]),
        ),
      },
    },
    assets: {
      maps: sanitizeAssetList(assets.maps),
      pointTables: sanitizeAssetList(assets.pointTables),
      surveyTasks: sanitizeAssetList(assets.surveyTasks),
    },
  };
}

function readProjectManifestByDir(projectDir: string, projectName: string): ProjectManifest {
  const filePath = manifestPath(projectDir);
  if (!fs.existsSync(filePath)) {
    return createDefaultManifest(projectName);
  }

  try {
    return normalizeManifest(projectName, JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return createDefaultManifest(projectName);
  }
}

function writeProjectManifestByDir(projectDir: string, manifest: ProjectManifest): ProjectManifest {
  const filePath = manifestPath(projectDir);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifest;
}

function ensureProjectManifest(projectName: string): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  return writeProjectManifestByDir(projectDir, manifest);
}

function updateProjectManifest(projectName: string, mutate: (manifest: ProjectManifest, projectDir: string) => void): ProjectManifest {
  const projectDir = resolveProjectDir(projectName);
  const manifest = readProjectManifestByDir(projectDir, projectName);
  mutate(manifest, projectDir);
  manifest.project.name = projectName;
  manifest.project.updatedAt = nowIso();
  return writeProjectManifestByDir(projectDir, manifest);
}

function upsertManifestAsset(
  manifest: ProjectManifest,
  collection: ManifestAssetCollection,
  asset: ManifestAssetInput,
): void {
  const normalizedPath = asset.relativePath.replace(/\\/g, "/");
  const list = manifest.assets[collection];
  const existing = list.find((item) => item.relativePath === normalizedPath || item.name === asset.name);
  const stamp = nowIso();
  const next: ProjectManifestAsset = {
    ...asset,
    id: existing?.id || asset.id || randomUUID(),
    name: asset.name,
    relativePath: normalizedPath,
    createdAt: existing?.createdAt || asset.createdAt || stamp,
    updatedAt: stamp,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    list.push(next);
  }
}

function touchMapAssetForPath(manifest: ProjectManifest, relativePath: string): void {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const mapDir = manifest.layout.dirs.maps;
  const parts = normalizedPath.split("/");
  if (parts[0] !== mapDir || !parts[1]) return;

  const mapName = parts[1];
  const mapRelativePath = `${mapDir}/${mapName}`;
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  const existing = manifest.assets.maps.find((item) => item.relativePath === mapRelativePath);
  if (!existing && !SUPPORTED_MAP_EXTS.has(ext)) return;

  if (SUPPORTED_MAP_EXTS.has(ext)) {
    upsertManifestAsset(manifest, "maps", {
      name: mapName,
      relativePath: mapRelativePath,
      entryFile: normalizedPath,
      ext,
      type: "pointCloud",
    });
    return;
  }

  if (existing) {
    existing.updatedAt = nowIso();
  }
}

function touchPointTableAssetForPath(manifest: ProjectManifest, relativePath: string, fileSize?: number): void {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const pointTableDir = manifest.layout.dirs.pointTables;
  const parts = normalizedPath.split("/");
  const ext = path.posix.extname(normalizedPath).toLowerCase();
  if (parts[0] !== pointTableDir || parts.length !== 2 || !POINT_TABLE_EXTS.has(ext)) return;

  upsertManifestAsset(manifest, "pointTables", {
    name: path.posix.basename(normalizedPath, ext),
    relativePath: normalizedPath,
    ext,
    fileSize,
    type: "excel",
  });
}

function updateManifestForWrittenFile(projectName: string, filePath: string, fileSize?: number): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const relativePath = toProjectRelativePath(projectDir, filePath);
    touchMapAssetForPath(manifest, relativePath);
    touchPointTableAssetForPath(manifest, relativePath, fileSize);
  });
}

function removeManifestAssetsUnderPath(projectName: string, targetPath: string): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const relativePath = toProjectRelativePath(projectDir, targetPath);
    const isAffected = (value: unknown) => {
      if (typeof value !== "string") return false;
      return value === relativePath || value.startsWith(`${relativePath}/`);
    };

    for (const key of Object.keys(manifest.assets) as ManifestAssetCollection[]) {
      manifest.assets[key] = manifest.assets[key].filter((asset) =>
        !isAffected(asset.relativePath) && !isAffected(asset.entryFile),
      );
    }
  });
}

function rewriteManifestAssetPathsAfterMove(projectName: string, oldPath: string, newPath: string): void {
  updateProjectManifest(projectName, (manifest, projectDir) => {
    const oldRelativePath = toProjectRelativePath(projectDir, oldPath);
    const newRelativePath = toProjectRelativePath(projectDir, newPath);
    const rewrite = (value: unknown) => {
      if (typeof value !== "string") return value;
      if (value === oldRelativePath) return newRelativePath;
      if (value.startsWith(`${oldRelativePath}/`)) return `${newRelativePath}${value.slice(oldRelativePath.length)}`;
      return value;
    };

    for (const key of Object.keys(manifest.assets) as ManifestAssetCollection[]) {
      for (const asset of manifest.assets[key]) {
        asset.relativePath = String(rewrite(asset.relativePath));
        if (typeof asset.entryFile === "string") {
          asset.entryFile = rewrite(asset.entryFile);
        }
        asset.updatedAt = nowIso();
        if (key === "maps") {
          asset.name = asset.relativePath.split("/")[1] || asset.name;
        } else if (key === "pointTables") {
          const ext = path.posix.extname(asset.relativePath);
          asset.name = path.posix.basename(asset.relativePath, ext) || asset.name;
        }
      }
    }
  });
}

function getProjectContextFromPath(targetPath: string): { projectName: string; projectDir: string } {
  const relative = path.relative(path.resolve(PROJECT_ROOT), targetPath);
  const [projectName] = relative.split(path.sep);
  if (!projectName) throw new Error("无法识别项目路径");
  return { projectName, projectDir: resolveProjectDir(projectName) };
}

/**
 * 首次创建项目时触发目录选择。已配置且路径有效则跳过弹窗。
 * 返回值：最终使用的 PROJECT_ROOT（可能为新选或已有）
 */
async function initProjectRoot() {
  const configPath = path.join(app.getPath("userData"), "data-path.json");
  let configuredPath = "";
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      configuredPath = config.projectRoot || "";
    }
  } catch { /* ignore */ }

  if (!app.isPackaged) {
    PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "project");
    return PROJECT_ROOT;
  }

  // 已配置且路径有效 → 直接使用
  if (configuredPath && fs.existsSync(configuredPath)) {
    PROJECT_ROOT = configuredPath;
    return PROJECT_ROOT;
  }

  // 首次：弹窗选择
  const { response } = await dialog.showMessageBox({
    type: "question",
    title: "选择数据存储目录",
    message: configuredPath
      ? `原数据目录已不存在：${configuredPath}\n请重新选择。`
      : "请选择项目数据存储目录（建议选空间充足的盘符）",
    buttons: ["选择目录", "暂时跳过"],
    defaultId: 0,
  });

  if (response !== 0) {
    // 跳过：使用 exe 同级作为兜底
    PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
    if (!fs.existsSync(PROJECT_ROOT)) fs.mkdirSync(PROJECT_ROOT, { recursive: true });
    return PROJECT_ROOT;
  }

  const result = await dialog.showOpenDialog({
    title: "选择数据存储目录",
    properties: ["openDirectory", "createDirectory"],
  });

  if (!result.canceled && result.filePaths[0]) {
    const chosen = result.filePaths[0];
    const projPath = fs.existsSync(path.join(chosen, "project")) ? path.join(chosen, "project") : chosen;
    PROJECT_ROOT = projPath;
    if (!fs.existsSync(projPath)) fs.mkdirSync(projPath, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ projectRoot: projPath }, null, 2));
    return projPath;
  }

  PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
  if (!fs.existsSync(PROJECT_ROOT)) fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  return PROJECT_ROOT;
}

// 暴露设置数据路径的接口
ipcMain.handle("set-data-path", async (_event, newPath: string) => {
  const configPath = path.join(app.getPath("userData"), "data-path.json");
  const rawPath = String(newPath ?? "").trim();
  if (!rawPath) throw new Error("数据目录不能为空");
  const projPath = path.resolve(rawPath);
  if (!fs.existsSync(projPath)) fs.mkdirSync(projPath, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ projectRoot: projPath }, null, 2));
  PROJECT_ROOT = projPath;
  return true;
});

Menu.setApplicationMenu(null);

// 开发环境忽略证书，生产环境按需放行
if (!app.isPackaged) {
  app.commandLine.appendSwitch("ignore-certificate-errors");
}
app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  // 生产环境放行自签名证书（可按需加指纹校验）
  event.preventDefault();
  callback(true);
});

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.js");
  console.log("preload path:", preloadPath, "exists:", fs.existsSync(preloadPath));

  const win = new BrowserWindow({
    show: false,
    backgroundColor: "#f5f5f5",
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webgl: true,
      webSecurity: false,
    },
  });

  win.maximize();
  win.once("ready-to-show", () => win.show());

  // 窗口控制
  ipcMain.on("win:minimize", () => win.minimize());
  ipcMain.on("win:maximize", () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on("win:close", () => win.close());

  // pinq jianc
  ipcMain.handle("ping", async (_event, ip: string) => {
    const cmd = process.platform === "win32" ? `ping -n 1 -w 2000 ${ip}` : `ping -c 1 -W 2 ${ip}`;
    return new Promise((resolve) => {
      exec(cmd, (error) => {
        resolve(!error);
      });
    });
  });

  // 大文件分块读取
  ipcMain.handle("read-file-chunk", async (_event, filePath: string, offset: number, length: number) => {
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, offset);
      return buf.buffer.slice(0, bytesRead);
    } finally {
      await fd.close();
    }
  });

  // 大文件整读（<2GB 用 fs.readFile，>=2GB 用分块组装）
  ipcMain.handle("read-large-file", async (_event, filePath: string) => {
    const { size } = await fs.promises.stat(filePath);
    if (size < 2 * 1024 * 1024 * 1024) {
      const buffer = await fs.promises.readFile(filePath);
      return buffer.buffer;
    }
    // >=2GB：分块读取组装（Node.js Buffer 可超 2GB）
    const fd = await fs.promises.open(filePath, "r");
    try {
      const buf = Buffer.allocUnsafe(size);
      let offset = 0;
      const chunkSize = 512 * 1024 * 1024;
      while (offset < size) {
        const toRead = Math.min(chunkSize, size - offset);
        const { bytesRead } = await fd.read(buf, offset, toRead, offset);
        offset += bytesRead;
      }
      return buf.buffer;
    } finally {
      await fd.close();
    }
  });

  // === WebGL 上下文丢失恢复处理 ===
  // 核显驱动崩溃时 WebGL 上下文可能丢失，监听并尝试恢复
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Render process gone:", details.reason, details.exitCode);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "bottom" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

// === 项目文件夹管理 ===
function ensureProjectRoot() {
  if (!fs.existsSync(PROJECT_ROOT)) {
    fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  }
}

ipcMain.handle("project:list", async () => {
  ensureProjectRoot();
  const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
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
});

ipcMain.handle("project:create", async (_event, name: string) => {
  const configPath = path.join(app.getPath("userData"), "data-path.json");
  // 从未配置过 → 弹出选择
  if (!fs.existsSync(configPath)) await initProjectRoot();
  ensureProjectRoot();
  const safeName = assertSafePathSegment(name, "项目名称");
  const dirPath = resolveProjectDir(safeName);
  if (fs.existsSync(dirPath)) {
    throw new Error(`项目 "${safeName}" 已存在`);
  }
  fs.mkdirSync(dirPath);
  writeProjectManifestByDir(dirPath, createDefaultManifest(safeName));
  return safeName;
});

ipcMain.handle("project:rename", async (_event, oldName: string, newName: string) => {
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
  updateProjectManifest(safeNewName, (manifest) => {
    manifest.project.name = safeNewName;
  });
  return safeNewName;
});

ipcMain.handle("project:delete", async (_event, name: string) => {
  ensureProjectRoot();
  const dirPath = resolveProjectDir(name);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`项目 "${name}" 不存在`);
  }
  fs.rmSync(dirPath, { recursive: true });
  return name;
});

// 导入模型文件到项目：复制到 project/{projectName}/地图/{fileName}/{fileName}.{las|laz}
ipcMain.handle("project:import-file", async (_event, projectName: string, sourcePath: string, fileName: string) => {
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
  const targetPath = resolveProjectPath(projectName, manifest.layout.dirs.maps, safeBaseName, `${safeBaseName}${ext}`);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  if (sourceResolved.toLowerCase() !== targetPath.toLowerCase()) {
    await fs.promises.copyFile(sourceResolved, targetPath);
  }
  updateManifestForWrittenFile(projectName, targetPath, Number(sourceStat.size));
  return targetPath;
});

ipcMain.handle("project:get-manifest", async (_event, projectName: string) => {
  return ensureProjectManifest(projectName);
});

// 列出项目目录下的文件树
interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

function readDirTree(dirPath: string): TreeNode[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return { name: entry.name, path: fullPath, isDir: true, children: readDirTree(fullPath) };
    }
    return { name: entry.name, path: fullPath, isDir: false };
  });
}

ipcMain.handle("project:list-tree", async (_event, projectName: string, subDir: string) => {
  const targetDir = resolveProjectPath(projectName, subDir || "");
  return readDirTree(targetDir);
});

// 写入文件到项目目录
ipcMain.handle("project:write-file", async (_event, projectName: string, subPath: string, data: ArrayBuffer) => {
  const filePath = resolveProjectPath(projectName, subPath);
  if (path.basename(filePath) === PROJECT_MANIFEST_FILE && path.dirname(filePath) === resolveProjectDir(projectName)) {
    throw new Error("项目清单由主进程维护，禁止直接写入");
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buf = Buffer.from(data);
  await fs.promises.writeFile(filePath, buf);
  updateManifestForWrittenFile(projectName, filePath, buf.byteLength);
  return filePath;
});

// 删除项目内文件/目录（绝对路径，限项目根内）
ipcMain.handle("project:delete-path", async (_event, targetPath: string) => {
  const resolved = resolveProjectRootPath(targetPath, "删除");
  if (path.relative(path.resolve(PROJECT_ROOT), resolved) === "") {
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
});

// 重命名项目内文件/目录（同目录改名，限项目根内）
ipcMain.handle("project:rename-path", async (_event, targetPath: string, newName: string) => {
  const resolved = resolveProjectRootPath(targetPath, "重命名");
  if (path.relative(path.resolve(PROJECT_ROOT), resolved) === "") {
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
  const newPath = assertInside(PROJECT_ROOT, path.resolve(path.dirname(resolved), safeName), "重命名");
  if (fs.existsSync(newPath)) {
    throw new Error("同名文件已存在");
  }
  fs.renameSync(resolved, newPath);
  rewriteManifestAssetPathsAfterMove(projectName, resolved, newPath);
  return newPath;
});

// 在文件资源管理器中打开目录（并选中该文件/目录）
ipcMain.handle("project:open-dir", async (_event, targetPath: string) => {
  const resolved = resolveProjectRootPath(targetPath, "打开目录");
  shell.showItemInFolder(resolved);
});

// 选择目录对话框
ipcMain.handle("dialog:select-dir", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "选择保存目录",
  });
  return result.canceled ? null : result.filePaths[0];
});

// 复制项目内文件到指定目录
ipcMain.handle("project:export-file", async (_event, projectName: string, subPath: string, destDir: string) => {
  const srcPath = resolveProjectPath(projectName, subPath);
  if (!fs.existsSync(srcPath)) throw new Error("源文件不存在: " + subPath);
  const fileName = path.basename(srcPath);
  const rawDestDir = String(destDir ?? "").trim();
  if (!rawDestDir) throw new Error("目标目录不能为空");
  const destRoot = path.resolve(rawDestDir);
  const destPath = path.join(destRoot, fileName);
  await fs.promises.copyFile(srcPath, destPath);
  return destPath;
});

// 导出空间模型为 zip（点表 + 地图 + 配置文件），异步 + 进度回传
ipcMain.handle("project:export-zip", async (event, projectName: string, items: { type: string; name: string }[], destDir: string) => {
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

  return exportSpaceZip(safeProjectName, PROJECT_ROOT, points, mapDirs, includePointTable, destRoot,
    (step, pct) => {
      event.sender.send("export:progress", { step, pct });
    }
  );
});
async function logGPUInfo() {
  const logPath = path.join(app.getPath("userData"), "gpu-info.log");
  try {
    const gpuInfo: any = await app.getGPUInfo("basic");
    const devices = (gpuInfo.gpuDevice || []).map((d: any) => 
      `  - ${d.deviceId}: ${d.vendorId} ${d.description || ""} (active: ${d.active})`
    ).join("\n");
    const log = [
      `=== GPU Info ${new Date().toISOString()} ===`,
      `Platform: ${process.platform}`,
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `GPU Devices:`,
      devices || "  (none)",
      `Aux Attributes: ${JSON.stringify(gpuInfo.auxAttributes || {})}`,
      `=== End ===`,
    ].join("\n");
    fs.writeFileSync(logPath, log, "utf-8");
    console.log("GPU info logged to:", logPath);
  } catch (err) {
    fs.writeFileSync(logPath, `GPU info failed: ${err}`, "utf-8");
  }
}
// 获取项目存储根目录
ipcMain.handle("get-project-root", async () => PROJECT_ROOT);
// GPU 信息 IPC：渲染进程可调用此接口获取当前 GPU 状态
ipcMain.handle("gpu:info", async () => {
  try {
    const gpuInfo: any = await app.getGPUInfo("basic");
    return {
      gpuDevice: gpuInfo.gpuDevice || [],
      auxAttributes: gpuInfo.auxAttributes || {},
    };
  } catch {
    return { gpuDevice: [], auxAttributes: {} };
  }
});

// 解压 ZIP 到指定目录
ipcMain.handle("extract-zip", async (_event, zipPath: string, destDir: string) => {
  console.log("[extract-zip] 开始解压:", zipPath, "→", destDir);
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    console.log(`[extract-zip] 共 ${entries.length} 个条目, 前5:`, entries.slice(0, 5).map((e: any) => e.entryName));
    zip.extractAllTo(destDir, true);
    console.log("[extract-zip] 解压完成:", destDir);

    // 记录顶层实际内容
    const topItems = fs.readdirSync(destDir, { withFileTypes: true });
    console.log(`[extract-zip] 顶层条目: ${topItems.map(x => `${x.name}(${x.isDirectory() ? 'd' : 'f'})`).join(", ")}`);

    // 始终查找并去除 ZIP 内同名子目录造成的嵌套
    const subDirs = topItems.filter(x => x.isDirectory() && !x.name.startsWith(".") && !x.name.startsWith("__"));
    for (const d of subDirs) {
      const candidate = path.join(destDir, d.name);
      if (fs.existsSync(path.join(candidate, "json_list.json"))) {
        // 子目录里有 json_list.json，将内容合并提上来（不删除已有文件）
        const subItems = fs.readdirSync(candidate, { withFileTypes: true });
        for (const item of subItems) {
          const src = path.join(candidate, item.name);
          const dst = path.join(destDir, item.name);
          if (item.isDirectory() && fs.existsSync(dst)) {
            cpMerge(src, dst);
          } else {
            fs.cpSync(src, dst, { recursive: true, force: true });
          }
        }
        fs.rmSync(candidate, { recursive: true, force: true });
        console.log("[extract-zip] 扁平化目录，去除嵌套 →", candidate);
      }
    }
    return { success: true, actualDir: destDir };
  } catch (e: any) {
    console.error("[extract-zip] 解压失败:", e.message);
    return { success: false, error: e.message };
  }
});

/** 合并目录：覆盖同名文件，保留独有文件 */
function cpMerge(src: string, dst: string) {
  const items = fs.readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      cpMerge(s, d);
    } else {
      fs.cpSync(s, d, { force: true });
    }
  }
}

app.whenReady().then(async () => {
  logGPUInfo();

  // 尝试读缓存的 project 路径
  const configPath = path.join(app.getPath("userData"), "data-path.json");
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.projectRoot && fs.existsSync(config.projectRoot)) {
        PROJECT_ROOT = config.projectRoot;
      }
    }
  } catch { /* ignore */ }
  if (!PROJECT_ROOT && app.isPackaged) {
    PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
  } else if (!PROJECT_ROOT) {
    PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "project");
  }

  await initDbIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  closeDbIpc();
  if (process.platform !== "darwin") app.quit();
});
