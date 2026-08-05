import { app, dialog } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let PROJECT_ROOT = "";

/**
 * 数据根目录配置文件路径。
 * 打包后保存在 Electron userData 下，避免随应用升级丢失。
 */
function projectRootConfigPath(): string {
  return path.join(app.getPath("userData"), "data-path.json");
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

export function hasProjectRootConfig(): boolean {
  return fs.existsSync(projectRootConfigPath());
}

/**
 * 确保当前进程已经有可用的项目数据根目录。
 */
export function ensureProjectRoot(): void {
  if (!PROJECT_ROOT) {
    loadInitialProjectRoot();
  }
  if (!fs.existsSync(PROJECT_ROOT)) {
    fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  }
}

/**
 * 加载启动阶段的默认数据根目录。
 * 开发环境固定使用仓库 project 目录，打包环境优先读取用户配置。
 */
export function loadInitialProjectRoot(): string {
  const configPath = projectRootConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (config.projectRoot && fs.existsSync(config.projectRoot)) {
        PROJECT_ROOT = config.projectRoot;
      }
    }
  } catch {
    // ignore malformed config and fall back below
  }

  if (!PROJECT_ROOT && app.isPackaged) {
    PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
  } else if (!PROJECT_ROOT) {
    PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "project");
  }

  return PROJECT_ROOT;
}

/**
 * 打包应用首次启动时初始化数据根目录。
 * 如果配置目录不存在，会弹窗要求用户重新选择；用户跳过时回退到 exe 同级 project。
 */
export async function initProjectRoot(): Promise<string> {
  const configPath = projectRootConfigPath();
  let configuredPath = "";
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      configuredPath = config.projectRoot || "";
    }
  } catch {
    // ignore
  }

  if (!app.isPackaged) {
    PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "project");
    return PROJECT_ROOT;
  }

  if (configuredPath && fs.existsSync(configuredPath)) {
    PROJECT_ROOT = configuredPath;
    return PROJECT_ROOT;
  }

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
    PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
    ensureProjectRoot();
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
    ensureProjectRoot();
    fs.writeFileSync(configPath, JSON.stringify({ projectRoot: projPath }, null, 2));
    return projPath;
  }

  PROJECT_ROOT = path.join(path.dirname(app.getPath("exe")), "project");
  ensureProjectRoot();
  return PROJECT_ROOT;
}

/**
 * 手动设置项目数据根目录。
 * newPath 必须是可创建/可写的绝对目录，保存后立即影响当前进程。
 */
export function setDataPath(newPath: string): boolean {
  const rawPath = String(newPath ?? "").trim();
  if (!rawPath) throw new Error("数据目录不能为空");

  const projPath = path.resolve(rawPath);
  if (!fs.existsSync(projPath)) fs.mkdirSync(projPath, { recursive: true });
  fs.writeFileSync(projectRootConfigPath(), JSON.stringify({ projectRoot: projPath }, null, 2));
  PROJECT_ROOT = projPath;
  return true;
}
