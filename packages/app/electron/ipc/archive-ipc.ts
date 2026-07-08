import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "../project-core/project-root";

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";

export function registerArchiveIpc(): void {
  ipcMain.handle("extract-zip", async (_event, zipPath: string, destDir: string) => {
    console.log("[extract-zip] 开始解压:", zipPath, "→", destDir);
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      console.log(`[extract-zip] 共 ${entries.length} 个条目, 前5:`, entries.slice(0, 5).map((e: any) => e.entryName));
      zip.extractAllTo(destDir, true);
      console.log("[extract-zip] 解压完成:", destDir);

      const topItems = fs.readdirSync(destDir, { withFileTypes: true });
      console.log(`[extract-zip] 顶层条目: ${topItems.map((x) => `${x.name}(${x.isDirectory() ? "d" : "f"})`).join(", ")}`);

      const subDirs = topItems.filter((x) => x.isDirectory() && !x.name.startsWith(".") && !x.name.startsWith("__"));
      for (const d of subDirs) {
        const candidate = path.join(destDir, d.name);
        if (fs.existsSync(path.join(candidate, "json_list.json"))) {
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

  ipcMain.handle("import-survey-data", async (_event, projectName: string, mapName: string, zipPath: string) => {
    console.log("[import-survey-data] 开始导入:", zipPath, "project:", projectName, "map:", mapName);
    try {
      const safeProjectName = assertSafePathSegment(projectName, "项目名称");
      const safeMapName = assertSafePathSegment(mapName, "地图名称");
      const sourceZip = String(zipPath || "").trim();
      if (!sourceZip || !path.isAbsolute(sourceZip)) throw new Error("压缩包路径无效");
      if (!fs.existsSync(sourceZip)) throw new Error("压缩包不存在");

      const projectDir = assertInside(getProjectRoot(), path.join(getProjectRoot(), safeProjectName), "导入勘察数据");
      if (!fs.existsSync(projectDir)) throw new Error(`项目 "${safeProjectName}" 不存在`);
      if (safeMapName === CALIBRATION_FILE_NAME) throw new Error("地图名称不能与勘察数据文件同名");

      const surveyDir = assertInside(projectDir, path.join(projectDir, SURVEY_DIR_NAME, safeMapName), "导入勘察数据");

      // 全量更新当前地图的机器人图片数据；项目级 勘察数据/勘察数据.json 是人工绑定结果，不能删。
      fs.rmSync(surveyDir, { recursive: true, force: true });
      fs.mkdirSync(surveyDir, { recursive: true });

      const zip = new AdmZip(sourceZip);
      zip.extractAllTo(surveyDir, true);
      flattenSingleWrapperDir(surveyDir);

      const deviceDir = resolveDeviceDir(surveyDir);
      if (!deviceDir) {
        throw new Error("未找到设备区 json_list.json，请确认压缩包包含 device/json_list.json 或 json_list.json");
      }
      const importedSpIds = readImportedSpIds(deviceDir);

      console.log("[import-survey-data] 导入完成:", surveyDir, "deviceDir:", deviceDir, "sp:", importedSpIds);
      return { success: true, surveyDir, deviceDir, importedSpIds };
    } catch (e: any) {
      console.error("[import-survey-data] 导入失败:", e.message);
      return { success: false, error: e.message };
    }
  });
}

function cpMerge(src: string, dst: string): void {
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

function assertSafePathSegment(value: string, label: string): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error(`${label}不能为空`);
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error(`${label}包含非法路径字符`);
  }
  return name;
}

function assertInside(root: string, target: string, action: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return resolvedTarget;
  }
  throw new Error(`${action}路径越界`);
}

function flattenSingleWrapperDir(targetDir: string): void {
  const items = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((item) => !item.name.startsWith(".") && !item.name.startsWith("__"));
  if (items.length !== 1 || !items[0].isDirectory()) return;

  const wrapper = path.join(targetDir, items[0].name);
  if (
    fs.existsSync(path.join(wrapper, "json_list.json"))
    || fs.existsSync(path.join(wrapper, "device", "json_list.json"))
    || fs.existsSync(path.join(wrapper, "cabinet"))
  ) {
    for (const item of fs.readdirSync(wrapper, { withFileTypes: true })) {
      const src = path.join(wrapper, item.name);
      const dst = path.join(targetDir, item.name);
      if (item.isDirectory() && fs.existsSync(dst)) cpMerge(src, dst);
      else fs.cpSync(src, dst, { recursive: true, force: true });
    }
    fs.rmSync(wrapper, { recursive: true, force: true });
    console.log("[import-survey-data] 扁平化外层目录:", wrapper);
  }
}

function resolveDeviceDir(surveyDir: string): string | null {
  const direct = path.join(surveyDir, "json_list.json");
  if (fs.existsSync(direct)) return surveyDir;
  const device = path.join(surveyDir, "device", "json_list.json");
  if (fs.existsSync(device)) return path.join(surveyDir, "device");
  return null;
}

function readImportedSpIds(deviceDir: string): number[] {
  try {
    const manifestPath = path.join(deviceDir, "json_list.json");
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (Array.isArray(data?.ordered_sp)) {
      return data.ordered_sp
        .map((id: unknown) => Number(id))
        .filter((id: number) => Number.isFinite(id))
        .sort((a: number, b: number) => a - b);
    }
  } catch {}

  return fs.readdirSync(deviceDir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => Number(item.name))
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => a - b);
}
