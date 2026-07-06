import { app, dialog } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let PROJECT_ROOT = "";

function projectRootConfigPath(): string {
  return path.join(app.getPath("userData"), "data-path.json");
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

export function hasProjectRootConfig(): boolean {
  return fs.existsSync(projectRootConfigPath());
}

export function ensureProjectRoot(): void {
  if (!PROJECT_ROOT) {
    loadInitialProjectRoot();
  }
  if (!fs.existsSync(PROJECT_ROOT)) {
    fs.mkdirSync(PROJECT_ROOT, { recursive: true });
  }
}

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

export function setDataPath(newPath: string): boolean {
  const rawPath = String(newPath ?? "").trim();
  if (!rawPath) throw new Error("数据目录不能为空");

  const projPath = path.resolve(rawPath);
  if (!fs.existsSync(projPath)) fs.mkdirSync(projPath, { recursive: true });
  fs.writeFileSync(projectRootConfigPath(), JSON.stringify({ projectRoot: projPath }, null, 2));
  PROJECT_ROOT = projPath;
  return true;
}
