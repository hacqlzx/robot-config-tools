import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { ZipArchive } from "archiver";
import { DevicePointRepo, getDatabase } from "@robot/database";
import { getProjectRoot } from "../project-core/project-root";

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";
const CALIB_DEVICE_DIR_NAME = "calib_device";
const CALIB_CABINET_DIR_NAME = "calib_cabinet";
const POINT_CALIBRATION_FILE_NAME = "calibrationInfo.json";
const MAP_DIR_NAME = "地图";
const AREA_FILE_NAME = "description_file.json";
const AREA_TYPE_DEVICE = "8";

interface CalibrationBinding {
  pointCode: string;
  pointName: string;
}

interface CalibrationRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bindings: CalibrationBinding[];
}

interface CalibrationEntry {
  mapCode?: string;
  imageId: number;
  imageName: string;
  spId: number;
  side: "left" | "right";
  rects: CalibrationRect[];
}

interface CalibrationFileData {
  version?: number;
  mapCode?: string;
  data: CalibrationEntry[];
}

interface SurveyImageMeta {
  imageId: number;
  imagePath: string;
  spId: number;
  side: "left" | "right";
  imageName: string;
  spConfig: any;
  imageConfig: any;
  width: number;
  height: number;
}

interface DeviceAreaInfo {
  id: string;
  name: string;
}

interface SurveyContext {
  manifest: any;
  mapName: string;
  mapCode: string;
  images: SurveyImageMeta[];
  deviceAreas: DeviceAreaInfo[];
}

interface ImageLabelRecord {
  fileName: string;
  data: any;
}

interface PointCalibrationRecord {
  point_code: string;
  calibration_id: string;
  cruise_id: string;
}

interface CabinetImageSource {
  id: string;
  mime: string;
  size: number;
}

interface CabinetImageSourceRef extends CabinetImageSource {
  kind: "zip" | "file";
  packagePath?: string;
  entryName?: string;
  filePath?: string;
}

interface CabinetImagePackageRecord {
  stationName: string;
  stationCode: string;
  bayName: string;
  bayCode: string;
  mainDeviceName: string;
  mainDeviceCode: string;
  componentName: string;
  componentCode: string;
  calibrationId: string;
  imageName: string;
  imageSource?: CabinetImageSource;
  imageDataUrl: string;
}

const cabinetImageSources = new Map<string, CabinetImageSourceRef>();
let cabinetImageSourceSeq = 0;

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
        throw new Error("未找到设备区 json_list.json，请确认压缩包包含 device/json_list.json、json_list.json 或 勘察数据/device/json_list.json");
      }
      const importedSpIds = readImportedSpIds(deviceDir);

      console.log("[import-survey-data] 导入完成:", surveyDir, "deviceDir:", deviceDir, "sp:", importedSpIds);
      return { success: true, surveyDir, deviceDir, importedSpIds };
    } catch (e: any) {
      console.error("[import-survey-data] 导入失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("export-survey-data", async (_event, projectName: string, mapName: string, destDir: string) => {
    console.log("[export-survey-data] 开始导出:", "project:", projectName, "map:", mapName, "dest:", destDir);
    try {
      const safeProjectName = assertSafePathSegment(projectName, "项目名称");
      const safeMapName = assertSafePathSegment(mapName, "地图名称");
      const rawDestDir = String(destDir || "").trim();
      if (!rawDestDir || !path.isAbsolute(rawDestDir)) throw new Error("导出目录无效");

      const projectDir = assertInside(getProjectRoot(), path.join(getProjectRoot(), safeProjectName), "导出勘察数据");
      if (!fs.existsSync(projectDir)) throw new Error(`项目 "${safeProjectName}" 不存在`);

      const surveyRoot = assertInside(projectDir, path.join(projectDir, SURVEY_DIR_NAME), "导出勘察数据");
      const surveyDir = assertInside(projectDir, path.join(surveyRoot, safeMapName), "导出勘察数据");
      if (!fs.existsSync(surveyDir)) throw new Error(`当前地图暂无勘察数据：${safeMapName}`);

      const outputDir = path.resolve(rawDestDir);
      fs.mkdirSync(outputDir, { recursive: true });

      const stationName = sanitizeFileName(readStationName(safeProjectName) || safeProjectName || "未知厂站");
      const mapFileName = sanitizeFileName(safeMapName);
      const timeStr = formatMinuteStamp(new Date());
      const zipBaseName = `${stationName}_${mapFileName}_${timeStr}`;
      const zipPath = nextAvailableZipPath(outputDir, zipBaseName);

      await writeSurveyZip(zipPath, surveyDir);
      console.log("[export-survey-data] 导出完成:", zipPath);
      return { success: true, zipPath, zipName: path.basename(zipPath) };
    } catch (e: any) {
      console.error("[export-survey-data] 导出失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("export-image-labels", async (_event, projectName: string, mapName: string, destDir: string) => {
    console.log("[export-image-labels] 开始导出:", "project:", projectName, "map:", mapName, "dest:", destDir);
    try {
      const safeProjectName = assertSafePathSegment(projectName, "项目名称");
      const safeMapName = assertSafePathSegment(mapName, "地图名称");
      const rawDestDir = String(destDir || "").trim();
      if (!rawDestDir || !path.isAbsolute(rawDestDir)) throw new Error("导出目录无效");

      const projectDir = assertInside(getProjectRoot(), path.join(getProjectRoot(), safeProjectName), "导出图像标识");
      if (!fs.existsSync(projectDir)) throw new Error(`项目 "${safeProjectName}" 不存在`);

      const surveyRoot = assertInside(projectDir, path.join(projectDir, SURVEY_DIR_NAME), "导出图像标识");
      const surveyDir = assertInside(projectDir, path.join(surveyRoot, safeMapName), "导出图像标识");
      if (!fs.existsSync(surveyDir)) throw new Error(`当前地图暂无勘察数据：${safeMapName}`);

      const deviceDir = resolveDeviceDir(surveyDir);
      if (!deviceDir) throw new Error("未找到设备区 json_list.json，请先导入勘察图像数据");

      const calibrationPath = path.join(surveyRoot, CALIBRATION_FILE_NAME);
      if (!fs.existsSync(calibrationPath)) throw new Error("暂无图像标识数据");

      const context = readSurveyContext(surveyDir, deviceDir, safeMapName, readMapDeviceAreas(projectDir, safeMapName));
      const calibration = readCalibrationFile(calibrationPath);
      ensureCalibrationIds(safeProjectName, calibration, context);
      const points = readProjectPoints(safeProjectName);
      const timeStr = formatMinuteStamp(new Date());
      const records = buildImageLabelRecords(calibration, context, points, timeStr);
      const pointRecords = buildPointCalibrationRecords(calibration, context, points);
      if (records.length === 0) throw new Error("当前地图暂无可导出的图像标识");

      const outputDir = path.resolve(rawDestDir);
      fs.mkdirSync(outputDir, { recursive: true });
      const stationName = sanitizeFileName(readStationName(safeProjectName) || safeProjectName || "未知厂站");
      const mapFileName = sanitizeFileName(safeMapName);
      const zipBaseName = `${stationName}_${mapFileName}_图像标识_${timeStr}`;
      const zipPath = nextAvailableZipPath(outputDir, zipBaseName);

      await writeImageLabelsZip(zipPath, records, pointRecords);
      console.log("[export-image-labels] 导出完成:", zipPath, "count:", records.length);
      return { success: true, zipPath, zipName: path.basename(zipPath), exportedCount: records.length };
    } catch (e: any) {
      console.error("[export-image-labels] 导出失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("import-image-labels", async (_event, projectName: string, mapName: string, zipPath: string) => {
    console.log("[import-image-labels] 开始导入:", zipPath, "project:", projectName, "map:", mapName);
    try {
      const safeProjectName = assertSafePathSegment(projectName, "项目名称");
      const safeMapName = assertSafePathSegment(mapName, "地图名称");
      const sourceZip = String(zipPath || "").trim();
      if (!sourceZip || !path.isAbsolute(sourceZip)) throw new Error("压缩包路径无效");
      if (!fs.existsSync(sourceZip)) throw new Error("压缩包不存在");

      const projectDir = assertInside(getProjectRoot(), path.join(getProjectRoot(), safeProjectName), "导入图像标识");
      if (!fs.existsSync(projectDir)) throw new Error(`项目 "${safeProjectName}" 不存在`);

      const surveyRoot = assertInside(projectDir, path.join(projectDir, SURVEY_DIR_NAME), "导入图像标识");
      const surveyDir = assertInside(projectDir, path.join(surveyRoot, safeMapName), "导入图像标识");
      if (!fs.existsSync(surveyDir)) throw new Error(`当前地图暂无勘察数据：${safeMapName}`);

      const deviceDir = resolveDeviceDir(surveyDir);
      if (!deviceDir) throw new Error("未找到设备区 json_list.json，请先导入勘察图像数据");

      const context = readSurveyContext(surveyDir, deviceDir, safeMapName, readMapDeviceAreas(projectDir, safeMapName));
      const points = readProjectPoints(safeProjectName);
      const labels = readImageLabelZip(sourceZip);
      if (labels.length === 0) throw new Error("压缩包内未找到 calib_device 图像标识 JSON");

      const { entries, importedCount, warnings } = convertRobotLabelsToCalibrationEntries(labels, context, points);
      if (importedCount === 0) throw new Error(warnings[0] || "未解析到有效图像标识");

      const calibrationPath = path.join(surveyRoot, CALIBRATION_FILE_NAME);
      const existing = fs.existsSync(calibrationPath) ? readCalibrationFile(calibrationPath) : { version: 2, mapCode: context.mapName, data: [] };
      const existingOtherMaps = normalizeCalibrationEntries(existing).filter((entry) => entry.mapCode !== context.mapName);
      const finalData: CalibrationFileData = {
        version: 2,
        mapCode: context.mapName,
        data: [...existingOtherMaps, ...entries],
      };
      fs.mkdirSync(surveyRoot, { recursive: true });
      fs.writeFileSync(calibrationPath, `${JSON.stringify(finalData, null, 2)}\n`, "utf-8");
      ensureCalibrationIds(safeProjectName, finalData, context);

      console.log("[import-image-labels] 导入完成:", calibrationPath, "count:", importedCount, "warnings:", warnings.length);
      return { success: true, importedCount, warnings };
    } catch (e: any) {
      console.error("[import-image-labels] 导入失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("import-cabinet-image-package", async (_event, packagePath: string) => {
    try {
      const sourcePath = String(packagePath || "").trim();
      if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error("压缩包路径无效");
      if (!fs.existsSync(sourcePath)) throw new Error("压缩包不存在");

      const stat = fs.statSync(sourcePath);
      cabinetImageSources.clear();
      const result = stat.isDirectory()
        ? readCabinetImagePackageFromDir(sourcePath)
        : readCabinetImagePackageFromZip(sourcePath);

      if (result.records.length === 0) throw new Error("未解析到屏柜部件记录");
      return {
        success: true,
        packageName: path.basename(sourcePath),
        ...result,
      };
    } catch (e: any) {
      console.error("[import-cabinet-image-package] 导入失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("load-cabinet-image", async (_event, sourceId: string) => {
    try {
      const source = cabinetImageSources.get(String(sourceId || ""));
      if (!source) throw new Error("图片来源已失效，请重新导入屏柜图像压缩包");
      const dataUrl = readCabinetImageDataUrl(source);
      return { success: true, dataUrl };
    } catch (e: any) {
      console.error("[load-cabinet-image] 加载失败:", e.message);
      return { success: false, error: e.message };
    }
  });
}

function readCabinetImagePackageFromZip(zipPath: string): { records: CabinetImagePackageRecord[]; warnings: string[] } {
  if (path.extname(zipPath).toLowerCase() !== ".zip") throw new Error("请选择 ZIP 压缩包");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const xlsxEntry = entries.find((entry) => {
    const baseName = path.posix.basename(normalizeZipEntryName(entry.entryName));
    return /\.(xlsx|xls)$/i.test(baseName) && !baseName.startsWith("~$");
  });
  if (!xlsxEntry) throw new Error("压缩包内未找到屏柜部件表 Excel");

  const rows = parseCabinetComponentRows(xlsxEntry.getData());
  const imageMap = new Map<string, { name: string; source: CabinetImageSource }>();
  for (const entry of entries) {
    const entryName = normalizeZipEntryName(entry.entryName);
    const ext = path.posix.extname(entryName).toLowerCase();
    const mime = imageMimeType(ext);
    if (!mime) continue;
    const code = path.posix.basename(entryName, ext).trim();
    if (!code) continue;
    const current = imageMap.get(code);
    const entryInImgDir = entryName.split("/").some((part) => part.toLowerCase() === "img");
    if (!current || entryInImgDir) {
      imageMap.set(code, {
        name: path.posix.basename(entryName),
        source: registerCabinetImageSource({
          kind: "zip",
          packagePath: zipPath,
          entryName,
          mime,
          size: entry.header.size,
        }),
      });
    }
  }

  return attachCabinetImages(rows, imageMap);
}

function readCabinetImagePackageFromDir(dirPath: string): { records: CabinetImagePackageRecord[]; warnings: string[] } {
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  const xlsx = files.find((item) => item.isFile() && /\.(xlsx|xls)$/i.test(item.name) && !item.name.startsWith("~$"));
  if (!xlsx) throw new Error("目录内未找到屏柜部件表 Excel");

  const rows = parseCabinetComponentRows(fs.readFileSync(path.join(dirPath, xlsx.name)));
  const imageMap = new Map<string, { name: string; source: CabinetImageSource }>();
  const imgDir = path.join(dirPath, "img");
  const searchDir = fs.existsSync(imgDir) && fs.statSync(imgDir).isDirectory() ? imgDir : dirPath;
  for (const filePath of collectFiles(searchDir)) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = imageMimeType(ext);
    if (!mime) continue;
    const code = path.basename(filePath, ext).trim();
    const stat = fs.statSync(filePath);
    imageMap.set(code, {
      name: path.basename(filePath),
      source: registerCabinetImageSource({
        kind: "file",
        filePath,
        mime,
        size: stat.size,
      }),
    });
  }

  return attachCabinetImages(rows, imageMap);
}

function parseCabinetComponentRows(xlsxBuffer: Buffer): Omit<CabinetImagePackageRecord, "imageName" | "imageDataUrl">[] {
  const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const parsed = rows
      .map((row) => ({
        stationName: valueText(row["厂站名称"]),
        stationCode: valueText(row["厂站编码"]),
        bayName: valueText(row["间隔名称"]),
        bayCode: valueText(row["间隔编码"]),
        mainDeviceName: valueText(row["主设备名称"]),
        mainDeviceCode: valueText(row["主设备编码"]),
        componentName: valueText(row["部件名称"]),
        componentCode: valueText(row["部件编码"]),
        calibrationId: valueText(row["标定id"]),
      }))
      .filter((row) => row.componentCode);
    if (parsed.length > 0) return parsed;
  }
  throw new Error("Excel 中未找到有效的部件编码");
}

function attachCabinetImages(
  rows: Omit<CabinetImagePackageRecord, "imageName" | "imageDataUrl">[],
  imageMap: Map<string, { name: string; source: CabinetImageSource }>,
): { records: CabinetImagePackageRecord[]; warnings: string[] } {
  const warnings: string[] = [];
  const records = rows.map((row) => {
    const image = imageMap.get(row.componentCode);
    if (!image) warnings.push(`未找到部件图片：${row.componentName || row.componentCode}`);
    return {
      ...row,
      imageName: image?.name || "",
      imageSource: image?.source,
      imageDataUrl: "",
    };
  });
  return { records, warnings };
}

function readCabinetImageDataUrl(source: CabinetImageSourceRef): string {
  if (!source || !source.mime) throw new Error("图片来源无效");

  if (source.kind === "zip") {
    const packagePath = String(source.packagePath || "").trim();
    const entryName = normalizeZipEntryName(source.entryName || "");
    if (!packagePath || !path.isAbsolute(packagePath)) throw new Error("压缩包路径无效");
    if (!fs.existsSync(packagePath)) throw new Error("压缩包不存在");
    if (!entryName) throw new Error("压缩包图片路径无效");

    const zip = new AdmZip(packagePath);
    const entry = zip.getEntries().find((item) => !item.isDirectory && normalizeZipEntryName(item.entryName) === entryName);
    if (!entry) throw new Error("压缩包内未找到图片");
    return `data:${source.mime};base64,${entry.getData().toString("base64")}`;
  }

  if (source.kind === "file") {
    const filePath = String(source.filePath || "").trim();
    if (!filePath || !path.isAbsolute(filePath)) throw new Error("图片路径无效");
    if (!fs.existsSync(filePath)) throw new Error("图片文件不存在");
    return `data:${source.mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  }

  throw new Error("不支持的图片来源");
}

function registerCabinetImageSource(source: Omit<CabinetImageSourceRef, "id">): CabinetImageSource {
  const id = `cabinet-image:${Date.now()}:${++cabinetImageSourceSeq}`;
  cabinetImageSources.set(id, { ...source, id });
  return {
    id,
    mime: source.mime,
    size: source.size,
  };
}

function collectFiles(dirPath: string): string[] {
  const files: string[] = [];
  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (item.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeZipEntryName(entryName: string): string {
  return String(entryName || "").replace(/\\/g, "/");
}

function imageMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    default:
      return "";
  }
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
  if (
    fs.existsSync(path.join(targetDir, "json_list.json"))
    || fs.existsSync(path.join(targetDir, "device", "json_list.json"))
  ) return;

  const wrappers = items
    .filter((item) => item.isDirectory())
    .map((item) => path.join(targetDir, item.name))
    .filter((wrapper) => (
      fs.existsSync(path.join(wrapper, "json_list.json"))
      || fs.existsSync(path.join(wrapper, "device", "json_list.json"))
    ));
  if (wrappers.length !== 1) return;

  const wrapper = wrappers[0];
  for (const item of fs.readdirSync(wrapper, { withFileTypes: true })) {
    const src = path.join(wrapper, item.name);
    const dst = path.join(targetDir, item.name);
    if (item.isDirectory() && fs.existsSync(dst)) cpMerge(src, dst);
    else fs.cpSync(src, dst, { recursive: true, force: true });
  }
  fs.rmSync(wrapper, { recursive: true, force: true });
  console.log("[import-survey-data] 扁平化外层目录:", wrapper);
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

function listFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(filePath));
    else files.push(filePath);
  }
  return files;
}

async function writeSurveyZip(zipPath: string, surveyDir: string): Promise<void> {
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const completed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    (archive as any).on("error", reject);
  });
  archive.pipe(output);

  for (const filePath of listFilesRecursive(surveyDir)) {
    const rel = path.relative(surveyDir, filePath).replace(/\\/g, "/");
    if (!rel || path.basename(filePath) === CALIBRATION_FILE_NAME) continue;
    archive.file(filePath, { name: rel });
  }

  await archive.finalize();
  await completed;
}

function readCalibrationFile(filePath: string): CalibrationFileData {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CalibrationFileData;
  return {
    version: parsed.version || 1,
    mapCode: parsed.mapCode,
    data: normalizeCalibrationEntries(parsed),
  };
}

function normalizeCalibrationEntries(file: CalibrationFileData): CalibrationEntry[] {
  return (file.data || []).map((entry) => ({
    ...entry,
    mapCode: String(entry.mapCode || file.mapCode || ""),
    rects: Array.isArray(entry.rects) ? entry.rects : [],
  }));
}

function readProjectPoints(projectName: string): any[] {
  try {
    return getDatabase().prepare("SELECT * FROM device_point WHERE project_name = ?").all(projectName) as any[];
  } catch (e) {
    console.warn("[image-labels] 读取点表失败:", e);
    return [];
  }
}

function ensureCalibrationIds(projectName: string, calibration: CalibrationFileData, context: SurveyContext): void {
  const db = getDatabase();
  const repo = new DevicePointRepo(db);
  const pointCodes = new Set<string>();
  for (const entry of normalizeCalibrationEntries(calibration)) {
    if (!isCalibrationEntryForMap(entry, context)) continue;
    for (const rect of entry.rects || []) {
      for (const binding of rect.bindings || []) {
        const pointCode = valueText(binding.pointCode);
        if (pointCode) pointCodes.add(pointCode);
      }
    }
  }
  for (const pointCode of pointCodes) {
    repo.bindCalibrationId(pointCode, projectName);
  }
  db.saveToDisk();
}

function readSurveyContext(surveyDir: string, deviceDir: string, mapName: string, deviceAreas: DeviceAreaInfo[] = []): SurveyContext {
  const manifestPath = path.join(deviceDir, "json_list.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const mapCode = String(manifest.map_code || manifest.map_id || mapName);
  const images: SurveyImageMeta[] = [];

  for (const fileName of manifest.file_names || []) {
    const spConfigPath = resolveSpConfigPath(deviceDir, String(fileName));
    if (!spConfigPath) continue;
    const spConfig = JSON.parse(fs.readFileSync(spConfigPath, "utf-8"));
    const spDir = path.dirname(spConfigPath);

    for (const imageConfig of Object.values(spConfig.images || {}) as any[]) {
      const side: "left" | "right" = imageConfig.pic_loc_flag === "right" ? "right" : "left";
      const imagePath = path.join(spDir, String(imageConfig.vis_name || ""));
      const imageSize = readImageSize(imagePath);
      images.push({
        imageId: computeImageId(Number(spConfig.sp_id), imageConfig, side),
        imagePath,
        spId: Number(spConfig.sp_id),
        side,
        imageName: String(imageConfig.vis_name || ""),
        spConfig,
        imageConfig,
        width: imageSize?.width || Number(imageConfig.width) || 0,
        height: imageSize?.height || (Number(imageConfig.width) ? Number(imageConfig.height) || 0 : 0),
      });
    }
  }

  return { manifest, mapName, mapCode, images, deviceAreas };
}

function readMapDeviceAreas(projectDir: string, mapName: string): DeviceAreaInfo[] {
  try {
    const mapDir = assertInside(projectDir, path.join(projectDir, MAP_DIR_NAME, mapName), "读取设备区域");
    const areaPath = assertInside(projectDir, path.join(mapDir, AREA_FILE_NAME), "读取设备区域");
    if (!fs.existsSync(areaPath)) return [];

    const parsed = JSON.parse(fs.readFileSync(areaPath, "utf-8"));
    const records = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
    return records
      .filter((record: any) => valueText(record?.type) === AREA_TYPE_DEVICE)
      .map((record: any) => ({ id: valueText(record?.id), name: valueText(record?.name) }))
      .filter((area: DeviceAreaInfo) => area.name);
  } catch (e) {
    console.warn("[image-labels] 读取设备区域失败:", e);
    return [];
  }
}

function resolveSpConfigPath(deviceDir: string, fileName: string): string | null {
  const normalizedFile = fileName.replace(/[\\/]/g, path.sep);
  const baseName = path.basename(normalizedFile);
  const parts = baseName.split("_");
  const parsed = Number.parseInt(parts[1], 10);
  const cpId = Number.isFinite(parsed) ? Math.abs(parsed) : NaN;
  const candidates = [
    path.join(deviceDir, normalizedFile),
    Number.isFinite(cpId) ? path.join(deviceDir, String(cpId), baseName) : "",
    path.join(deviceDir, baseName),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function computeImageId(spId: number, imageConfig: any, side: "left" | "right"): number {
  const loc = Array.isArray(imageConfig.pic_loc) ? imageConfig.pic_loc : [0, 0];
  return Number(loc[0] || 0) + Number(loc[1] || 0) * 100 + spId * 10000 + (side === "right" ? 5000 : 0);
}

function readImageSize(filePath: string): { width: number; height: number } | null {
  try {
    const buf = fs.readFileSync(filePath);
    return readPngSize(buf) || readJpegSize(buf);
  } catch {
    return null;
  }
}

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3
      || marker === 0xc5 || marker === 0xc6 || marker === 0xc7
      || marker === 0xc9 || marker === 0xca || marker === 0xcb
      || marker === 0xcd || marker === 0xce || marker === 0xcf
    ) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function isCalibrationEntryForMap(entry: CalibrationEntry, context: SurveyContext): boolean {
  return entry.mapCode === context.mapName;
}

function buildImageLabelRecords(calibration: CalibrationFileData, context: SurveyContext, points: any[], timeStr: string): ImageLabelRecord[] {
  const pointByCode = new Map<string, any>();
  for (const point of points) {
    const code = valueText(point.pointCode);
    if (code) pointByCode.set(code, point);
  }
  const records: ImageLabelRecord[] = [];
  let serial = 1;

  for (const entry of normalizeCalibrationEntries(calibration)) {
    if (!isCalibrationEntryForMap(entry, context)) continue;
    const imageMeta = findSurveyImageMeta(context, entry);
    if (!imageMeta || imageMeta.width <= 0 || imageMeta.height <= 0) continue;

    for (const rect of entry.rects || []) {
      for (const binding of rect.bindings || []) {
        const point = pointByCode.get(String(binding.pointCode || ""));
        const pointName = String(point?.pointName || binding.pointName || binding.pointCode || "未命名点位");
        const pointCode = String(point?.pointCode || binding.pointCode || "");
        const robotData = buildRobotImageLabel(imageMeta, context, rect, point, pointName, pointCode);
        const serialText = String(serial).padStart(3, "0");
        const fileName = `${sanitizeFileName(context.mapCode)}_${sanitizeFileName(pointName)}_${timeStr}_${serialText}.json`;
        records.push({ fileName, data: robotData });
        serial++;
      }
    }
  }

  return records;
}

function buildPointCalibrationRecords(calibration: CalibrationFileData, context: SurveyContext, points: any[]): PointCalibrationRecord[] {
  const pointByCode = new Map<string, any>();
  for (const point of points) {
    const code = valueText(point.pointCode);
    if (code) pointByCode.set(code, point);
  }

  const pointCodes: string[] = [];
  const seen = new Set<string>();
  for (const entry of normalizeCalibrationEntries(calibration)) {
    if (!isCalibrationEntryForMap(entry, context)) continue;
    for (const rect of entry.rects || []) {
      for (const binding of rect.bindings || []) {
        const pointCode = valueText(binding.pointCode);
        if (!pointCode || seen.has(pointCode)) continue;
        seen.add(pointCode);
        pointCodes.push(pointCode);
      }
    }
  }

  return pointCodes
    .map((pointCode) => {
      const point = pointByCode.get(pointCode);
      return {
        point_code: valueText(point?.pointCode) || pointCode,
        calibration_id: valueText(point?.calibrationId),
        cruise_id: valueText(point?.cruiseId),
      };
    })
    .filter((record) => record.point_code && record.calibration_id);
}

function findSurveyImageMeta(context: SurveyContext, entry: CalibrationEntry): SurveyImageMeta | null {
  return context.images.find((image) => image.imageId === entry.imageId)
    || context.images.find((image) => image.spId === Number(entry.spId) && image.imageName === entry.imageName)
    || null;
}

function buildRobotImageLabel(imageMeta: SurveyImageMeta, context: SurveyContext, rect: CalibrationRect, point: any, pointName: string, pointCode: string): any {
  const targetRect = rectToNormalizedPoints(rect, imageMeta.width, imageMeta.height);
  const targetPoint = [
    clamp01((rect.x + rect.w / 2) / imageMeta.width),
    clamp01((rect.y + rect.h / 2) / imageMeta.height),
  ];
  const imageConfig = imageMeta.imageConfig || {};
  const spConfig = imageMeta.spConfig || {};
  const saveType = Number(point?.saveTypeList);
  const deviceName = resolveDeviceAreaName(context, point);

  return {
    calibr_rp: spConfig.calibr_rp || { pitch: 0, roll: 0 },
    camera_id: Number(imageConfig.camera_id || 0),
    cp_id: Number(point?.calibrationId || 0),
    current_rp: spConfig.current_rp || { pitch: 0, roll: 0 },
    device_name: deviceName,
    point_name: pointName,
    point_code: pointCode,
    map_code: context.mapCode,
    is_calibr: true,
    focus: Number(imageConfig.focus || 0),
    height: Number(imageConfig.height || 0),
    icp_result: Array.isArray(spConfig.icp_result) ? spConfig.icp_result : identityMatrix4(),
    pan: Number(imageConfig.pan || 0),
    robot_id: String(context.manifest.robot_id || ""),
    save_type_list: Number.isFinite(saveType) && saveType > 0 ? [saveType] : [],
    sp_id: imageMeta.spId,
    target_point: targetPoint,
    target_rect: targetRect,
    tilt: Number(imageConfig.tilt || 0),
    vis_img_size: [imageMeta.width, imageMeta.height],
    zoom: Number(imageConfig.zoom || 0),
  };
}

function resolveDeviceAreaName(context: SurveyContext, point: any): string {
  const bayName = valueText(point?.bayName);
  if (bayName) {
    const matched = context.deviceAreas.find((area) => area.name === bayName);
    if (matched?.name) return matched.name;
  }

  if (context.deviceAreas.length === 1) return context.deviceAreas[0].name;
  if (bayName) return bayName;
  return context.deviceAreas[0]?.name || context.mapName;
}

function rectToNormalizedPoints(rect: CalibrationRect, width: number, height: number): number[][] {
  const x1 = clamp01(rect.x / width);
  const y1 = clamp01(rect.y / height);
  const x2 = clamp01((rect.x + rect.w) / width);
  const y2 = clamp01((rect.y + rect.h) / height);
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function identityMatrix4(): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

async function writeImageLabelsZip(zipPath: string, records: ImageLabelRecord[], pointRecords: PointCalibrationRecord[]): Promise<void> {
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const completed = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    (archive as any).on("error", reject);
  });
  archive.pipe(output);
  archive.append("", { name: `${CALIB_CABINET_DIR_NAME}/` });
  archive.append("", { name: `${CALIB_DEVICE_DIR_NAME}/` });
  archive.append(`${JSON.stringify(pointRecords, null, 2)}\n`, { name: POINT_CALIBRATION_FILE_NAME });

  for (const record of records) {
    archive.append(`${JSON.stringify(record.data, null, 2)}\n`, {
      name: `${CALIB_DEVICE_DIR_NAME}/${record.fileName}`,
    });
  }

  await archive.finalize();
  await completed;
}

function readImageLabelZip(zipPath: string): any[] {
  const zip = new AdmZip(zipPath);
  const labels: any[] = [];
  for (const entry of zip.getEntries()) {
    const normalized = entry.entryName.replace(/\\/g, "/");
    if (entry.isDirectory || !normalized.startsWith(`${CALIB_DEVICE_DIR_NAME}/`) || !normalized.toLowerCase().endsWith(".json")) {
      continue;
    }
    const parsed = JSON.parse(entry.getData().toString("utf-8"));
    if (Array.isArray(parsed)) labels.push(...parsed);
    else labels.push(parsed);
  }
  return labels;
}

function convertRobotLabelsToCalibrationEntries(labels: any[], context: SurveyContext, points: any[]): { entries: CalibrationEntry[]; importedCount: number; warnings: string[] } {
  const warnings: string[] = [];
  const pointByCode = new Map<string, any>();
  const pointByName = new Map<string, any[]>();
  for (const point of points) {
    const code = valueText(point.pointCode);
    if (code) pointByCode.set(code, point);
    const name = valueText(point.pointName);
    if (!name) continue;
    if (!pointByName.has(name)) pointByName.set(name, []);
    pointByName.get(name)!.push(point);
  }

  const entryMap = new Map<number, CalibrationEntry>();
  let importedCount = 0;
  let rectId = Date.now();

  for (const label of labels) {
    const importedPointCode = firstText(label.point_code, label.pointCode);
    const importedPointName = firstText(label.point_name, label.pointName);
    if (!importedPointCode && !importedPointName) {
      warnings.push("存在缺少 point_code/point_name 的图像标识，已跳过");
      continue;
    }

    let point: any | null = null;
    if (importedPointCode) {
      point = pointByCode.get(importedPointCode) || null;
      if (!point) {
        warnings.push(`点表中未找到点位编码：${importedPointCode}`);
        continue;
      }
    } else {
      const candidates = pointByName.get(importedPointName) || [];
      if (candidates.length === 0) {
        warnings.push(`点表中未找到点位名称：${importedPointName}`);
        continue;
      }
      if (candidates.length > 1) {
        warnings.push(`点位名称重复，无法唯一绑定：${importedPointName}`);
        continue;
      }
      point = candidates[0];
    }

    const pointName = valueText(point.pointName) || importedPointName || importedPointCode;

    const imageMeta = matchRobotLabelImage(context, label);
    if (!imageMeta) {
      warnings.push(`未匹配到图像：${pointName}`);
      continue;
    }

    const rect = robotTargetRectToRect(label, imageMeta);
    if (!rect) {
      warnings.push(`标识框无效：${pointName}`);
      continue;
    }

    let entry = entryMap.get(imageMeta.imageId);
    if (!entry) {
      entry = {
        mapCode: context.mapName,
        imageId: imageMeta.imageId,
        imageName: imageMeta.imageName,
        spId: imageMeta.spId,
        side: imageMeta.side,
        rects: [],
      };
      entryMap.set(imageMeta.imageId, entry);
    }

    const binding = { pointCode: valueText(point.pointCode), pointName };
    const existingRect = entry.rects.find((item) => isCloseRect(item, rect));
    if (existingRect) {
      if (!existingRect.bindings.some((item) => item.pointCode === binding.pointCode)) {
        existingRect.bindings.push(binding);
      }
    } else {
      entry.rects.push({ ...rect, id: rectId++, bindings: [binding] });
    }
    importedCount++;
  }

  return { entries: [...entryMap.values()], importedCount, warnings };
}

function matchRobotLabelImage(context: SurveyContext, label: any): SurveyImageMeta | null {
  const spId = Number(label.sp_id);
  const candidates = context.images.filter((image) => image.spId === spId);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best: { image: SurveyImageMeta; score: number } | null = null;
  for (const image of candidates) {
    const cfg = image.imageConfig || {};
    let score = 0;
    if (Number(cfg.camera_id) === Number(label.camera_id)) score += 2;
    if (isNearNumber(cfg.pan, label.pan, 0.01)) score += 2;
    if (isNearNumber(cfg.tilt, label.tilt, 0.01)) score += 2;
    if (isNearNumber(cfg.zoom, label.zoom, 0.01)) score += 1;
    if (isNearNumber(cfg.focus, label.focus, 1)) score += 1;
    if (best === null || score > best.score) best = { image, score };
  }

  return best && best.score >= 3 ? best.image : null;
}

function isNearNumber(a: unknown, b: unknown, epsilon: number): boolean {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= epsilon;
}

function robotTargetRectToRect(label: any, imageMeta: SurveyImageMeta): Omit<CalibrationRect, "id" | "bindings"> | null {
  const points = Array.isArray(label.target_rect) ? label.target_rect : [];
  if (points.length < 4) return null;
  const size = Array.isArray(label.vis_img_size) && label.vis_img_size.length >= 2
    ? { width: Number(label.vis_img_size[0]) || imageMeta.width, height: Number(label.vis_img_size[1]) || imageMeta.height }
    : { width: imageMeta.width, height: imageMeta.height };
  if (size.width <= 0 || size.height <= 0) return null;

  const xs = points.map((point: any) => Number(point?.[0])).filter((value: number) => Number.isFinite(value));
  const ys = points.map((point: any) => Number(point?.[1])).filter((value: number) => Number.isFinite(value));
  if (xs.length === 0 || ys.length === 0) return null;
  const normalized = xs.every((value: number) => value >= 0 && value <= 1.5) && ys.every((value: number) => value >= 0 && value <= 1.5);
  const scaleX = normalized ? size.width : 1;
  const scaleY = normalized ? size.height : 1;
  const minX = Math.min(...xs) * scaleX;
  const maxX = Math.max(...xs) * scaleX;
  const minY = Math.min(...ys) * scaleY;
  const maxY = Math.max(...ys) * scaleY;

  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

function isCloseRect(a: CalibrationRect, b: Omit<CalibrationRect, "id" | "bindings">): boolean {
  return Math.abs(a.x - b.x) < 2
    && Math.abs(a.y - b.y) < 2
    && Math.abs(a.w - b.w) < 2
    && Math.abs(a.h - b.h) < 2;
}

function readStationName(projectName: string): string {
  try {
    const db = getDatabase();
    const binding = db.prepare("SELECT station_name FROM project_station WHERE project_name = ?").get(projectName) as any;
    if (binding?.station_name) return String(binding.station_name);
    if (binding?.stationName) return String(binding.stationName);

    const point = db.prepare("SELECT station_name FROM device_point WHERE project_name = ? AND station_name IS NOT NULL AND station_name <> '' LIMIT 1").get(projectName) as any;
    if (point?.station_name) return String(point.station_name);
    if (point?.stationName) return String(point.stationName);
  } catch (e) {
    console.warn("[export-survey-data] 读取厂站名称失败:", e);
  }
  return "";
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = valueText(value);
    if (text) return text;
  }
  return "";
}

function sanitizeFileName(value: string): string {
  const name = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return name || "未命名";
}

function formatMinuteStamp(date: Date): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const timePart = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("");
  return `${datePart}_${timePart}`;
}

function nextAvailableZipPath(outputDir: string, zipBaseName: string): string {
  let index = 0;
  while (true) {
    const suffix = index === 0 ? "" : `_${index + 1}`;
    const candidate = path.join(outputDir, `${zipBaseName}${suffix}.zip`);
    if (!fs.existsSync(candidate)) return candidate;
    index++;
  }
}
