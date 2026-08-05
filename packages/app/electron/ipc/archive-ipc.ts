import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { ZipArchive } from "archiver";
import { DevicePointRepo, getDatabase } from "@robot/database";
import { generatePointExcelFromRows, type PointExcelExportRow } from "../export-points";
import { getProjectRoot } from "../project-core/project-root";
import { resolveProjectDir, resolveProjectPath } from "../project-core/project-paths";

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";
const CALIB_DEVICE_DIR_NAME = "calib_device";
const CALIB_CABINET_DIR_NAME = "calib_cabinet";
const POINT_CALIBRATION_FILE_NAME = "calibration.json";
const MAP_DIR_NAME = "地图";
const AREA_FILE_NAME = "description_file.json";
const AREA_TYPE_DEVICE = "8";
const OVERVIEW_DIR_NAME = "总览图";
const CABINET_IMAGE_DIR_NAME = "屏柜图像";
const CABINET_IMAGE_DATA_FILE_NAME = "cabinet-image-data.json";
const CABINET_COMPONENT_WORKBOOK_NAME = "屏柜部件表.xlsx";
const CABINET_POINT_TABLE_ROBOT_COL = "机器人编码";
const CABINET_POINT_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

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
  recordKey: string;
  robotCode: string;
  stationName: string;
  stationCode: string;
  areaName: string;
  areaCode: string;
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

interface CabinetImageRobotIndex {
  robotCode: string;
  dirName: string;
  packageName?: string;
  workbookName?: string;
  importedAt: string;
  records: Omit<CabinetImagePackageRecord, "imageSource" | "imageDataUrl">[];
}

interface CabinetImageAnnotationIndex {
  recordKey: string;
  robotCode: string;
  componentCode: string;
  updatedAt: string;
  annotations: any;
  ocrRows: any[];
  singlePoints: any[];
}

interface CabinetMainDeviceNameOverride {
  key: string;
  robotCode: string;
  name: string;
  updatedAt: string;
}

interface CabinetImageWorkspaceData {
  version: number;
  updatedAt: string;
  robots: CabinetImageRobotIndex[];
  annotations: Record<string, CabinetImageAnnotationIndex>;
  mainDeviceNameOverrides: Record<string, CabinetMainDeviceNameOverride>;
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
      const records = buildImageLabelRecords(calibration, context, points);
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

  ipcMain.handle("import-cabinet-image-package", async (_event, projectName: string, packagePath: string) => {
    try {
      const sourcePath = String(packagePath || "").trim();
      if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error("压缩包路径无效");
      if (!fs.existsSync(sourcePath)) throw new Error("压缩包不存在");

      const stat = fs.statSync(sourcePath);
      cabinetImageSources.clear();
      const imported = importCabinetImagePackageToLocal(projectName, sourcePath, stat.isDirectory() ? "directory" : "zip");
      const result = readCabinetImageWorkspace(projectName);

      if (result.records.length === 0) throw new Error("未解析到屏柜部件记录");
      return {
        success: true,
        packageName: path.basename(sourcePath),
        packageDir: imported.importDir,
        importedRobotCode: imported.robotCode,
        ...result,
      };
    } catch (e: any) {
      console.error("[import-cabinet-image-package] 导入失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("load-local-cabinet-image-package", async (_event, projectName: string) => {
    try {
      cabinetImageSources.clear();
      const result = readCabinetImageWorkspace(projectName);
      return { success: true, ...result };
    } catch (e: any) {
      console.error("[load-local-cabinet-image-package] 加载失败:", e.message);
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

  ipcMain.handle("save-cabinet-image-annotations", async (_event, projectName: string, payload: any) => {
    try {
      const result = saveCabinetImageAnnotations(projectName, payload);
      return { success: true, ...result };
    } catch (e: any) {
      console.error("[save-cabinet-image-annotations] 保存失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("save-cabinet-main-device-name-override", async (_event, projectName: string, payload: any) => {
    try {
      const result = saveCabinetMainDeviceNameOverride(projectName, payload);
      return { success: true, ...result };
    } catch (e: any) {
      console.error("[save-cabinet-main-device-name-override] 保存失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("export-cabinet-annotation-params", async (_event, projectName: string, destDir: string, data: any) => {
    try {
      const result = exportCabinetAnnotationParams(projectName, destDir, data);
      return { success: true, ...result };
    } catch (e: any) {
      console.error("[export-cabinet-annotation-params] 导出失败:", e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("export-cabinet-point-table", async (_event, projectName: string, destDir: string) => {
    try {
      const result = exportCabinetPointTable(projectName, destDir);
      return { success: true, ...result };
    } catch (e: any) {
      console.error("[export-cabinet-point-table] 导出失败:", e.message);
      return { success: false, error: e.message };
    }
  });
}

/**
 * 导入屏柜图像包到项目本地目录。
 * 数据统一落到“总览图/屏柜图像/{机器人编码}”，相同机器人编码采用全量替换。
 */
function importCabinetImagePackageToLocal(projectName: string, sourcePath: string, sourceType: "zip" | "directory"): { importDir: string; robotCode: string } {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const projectDir = resolveProjectDir(safeProjectName);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`项目 "${safeProjectName}" 不存在`);
  }

  const cabinetRoot = resolveProjectPath(safeProjectName, OVERVIEW_DIR_NAME, CABINET_IMAGE_DIR_NAME);
  fs.mkdirSync(cabinetRoot, { recursive: true });
  if (sourceType === "directory") assertDirectoryDoesNotOverlapForCabinetImages(sourcePath, cabinetRoot);

  const tempDir = path.join(cabinetRoot, `.import-${Date.now()}-${process.pid}`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    if (sourceType === "zip") {
      const zip = new AdmZip(sourcePath);
      zip.extractAllTo(tempDir, true);
    } else {
      fs.cpSync(sourcePath, tempDir, { recursive: true, force: true });
    }

    flattenCabinetImageWrapperDir(tempDir);
    normalizeCabinetWorkbookFile(tempDir);

    const parsed = readCabinetImagePackageFromDir(tempDir);
    const robotCode = assertSafePathSegment(resolveCabinetRobotCode(parsed.records), "机器人编码");
    const targetDir = path.join(cabinetRoot, robotCode);
    assertInside(cabinetRoot, targetDir, "导入屏柜图像");

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(tempDir, targetDir);

    replaceCabinetImageRobotIndex(safeProjectName, robotCode, targetDir, path.basename(sourcePath));
    return { importDir: targetDir, robotCode };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * 从 ZIP 中读取屏柜部件表和 img 图片，先不落盘，供导入预解析使用。
 */
function readCabinetImagePackageFromZip(zipPath: string): { records: CabinetImagePackageRecord[]; warnings: string[] } {
  if (path.extname(zipPath).toLowerCase() !== ".zip") throw new Error("请选择 ZIP 压缩包");
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const xlsxEntry = entries.find((entry) => {
    const baseName = path.posix.basename(normalizeZipEntryName(entry.entryName));
    return /\.(xlsx|xls)$/i.test(baseName) && !baseName.startsWith("~$");
  });
  if (!xlsxEntry) throw new Error("压缩包内未找到屏柜部件表 Excel");

  const rows = normalizeCabinetComponentRows(parseCabinetComponentRows(xlsxEntry.getData()));
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

/**
 * 从已解压目录读取屏柜部件表和图片。
 * 目录中存在 img 子目录时优先从 img 下按部件编码匹配图片。
 */
function readCabinetImagePackageFromDir(dirPath: string): { records: CabinetImagePackageRecord[]; warnings: string[] } {
  const workbookPath = findCabinetComponentWorkbookPath(dirPath);
  if (!workbookPath) throw new Error("目录内未找到屏柜部件表 Excel");

  const rows = normalizeCabinetComponentRows(parseCabinetComponentRows(fs.readFileSync(workbookPath)));
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

/**
 * 解析屏柜部件表 Excel。
 * 左侧树和后续点表导出都以这里的机器人编码、层级编码、标定 id 为基础。
 */
function parseCabinetComponentRows(xlsxBuffer: Buffer): Omit<CabinetImagePackageRecord, "imageName" | "imageSource" | "imageDataUrl">[] {
  const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const parsed = rows
      .map((row) => {
        const robotCode = valueText(row["机器人编码"]);
        const componentCode = valueText(row["部件编码"]);
        return {
          recordKey: buildCabinetRecordKey(robotCode, componentCode),
          robotCode,
          stationName: valueText(row["厂站名称"]),
          stationCode: valueText(row["厂站编码"]),
          areaName: valueText(row["区域名称"]),
          areaCode: valueText(row["区域编码"]),
          bayName: valueText(row["间隔名称"]),
          bayCode: valueText(row["间隔编码"]),
          mainDeviceName: valueText(row["主设备名称"]),
          mainDeviceCode: valueText(row["主设备编码"]),
          componentName: valueText(row["部件名称"]),
          componentCode,
          calibrationId: valueText(row["标定id"]),
        };
      })
      .filter((row) => row.componentCode);
    if (parsed.length > 0) return parsed;
  }
  throw new Error("Excel 中未找到有效的部件编码");
}

/**
 * 将 Excel 中的部件记录和本地图片按部件编码关联。
 */
function attachCabinetImages(
  rows: Omit<CabinetImagePackageRecord, "imageName" | "imageSource" | "imageDataUrl">[],
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

/**
 * 读取整个项目的屏柜图像工作区。
 * 会扫描各机器人目录，并把 annotation.json 中仍然有效的标注、点位和单点记录回填给前端。
 */
function readCabinetImageWorkspace(projectName: string): {
  records: CabinetImagePackageRecord[];
  warnings: string[];
  annotationsByComponent: Record<string, any>;
  ocrRowsByComponent: Record<string, any[]>;
  singlePointsByComponent: Record<string, any[]>;
  robots: CabinetImageRobotIndex[];
} {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const projectDir = resolveProjectDir(safeProjectName);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`项目 "${safeProjectName}" 不存在`);
  }

  const cabinetRoot = resolveProjectPath(safeProjectName, OVERVIEW_DIR_NAME, CABINET_IMAGE_DIR_NAME);
  if (!fs.existsSync(cabinetRoot)) {
    return {
      records: [],
      warnings: [],
      annotationsByComponent: {},
      ocrRowsByComponent: {},
      singlePointsByComponent: {},
      robots: [],
    };
  }

  const data = readCabinetImageWorkspaceData(cabinetRoot);
  const records: CabinetImagePackageRecord[] = [];
  const warnings: string[] = [];
  const robots: CabinetImageRobotIndex[] = [];

  for (const item of fs.readdirSync(cabinetRoot, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const robotDir = path.join(cabinetRoot, item.name);
    try {
      normalizeCabinetWorkbookFile(robotDir);
      const result = readCabinetImagePackageFromDir(robotDir);
      const robotCode = resolveCabinetRobotCode(result.records, item.name);
      records.push(...applyCabinetMainDeviceNameOverrides(result.records, data.mainDeviceNameOverrides));
      warnings.push(...result.warnings.map((warning) => `${robotCode}: ${warning}`));
      const previousRobot = data.robots.find((robot) => robot.robotCode === robotCode);
      robots.push({
        robotCode,
        dirName: item.name,
        packageName: previousRobot?.packageName,
        workbookName: path.basename(findCabinetComponentWorkbookPath(robotDir) || CABINET_COMPONENT_WORKBOOK_NAME),
        importedAt: previousRobot?.importedAt || new Date().toISOString(),
        records: result.records.map(toCabinetImagePersistedRecord),
      });
    } catch (error: any) {
      warnings.push(`${item.name}: ${error?.message || "屏柜图像目录解析失败"}`);
    }
  }

  const recordKeys = new Set(records.map((record) => record.recordKey));
  const annotationsByComponent: Record<string, any> = {};
  const ocrRowsByComponent: Record<string, any[]> = {};
  const singlePointsByComponent: Record<string, any[]> = {};
  const nextAnnotations: Record<string, CabinetImageAnnotationIndex> = {};
  for (const [recordKey, entry] of Object.entries(data.annotations || {})) {
    if (!recordKeys.has(recordKey)) continue;
    const annotations = normalizeCabinetAnnotationData(entry.annotations);
    annotationsByComponent[recordKey] = annotations;
    ocrRowsByComponent[recordKey] = Array.isArray(entry.ocrRows) ? entry.ocrRows : [];
    singlePointsByComponent[recordKey] = Array.isArray(entry.singlePoints) ? entry.singlePoints : [];
    nextAnnotations[recordKey] = {
      ...entry,
      annotations,
      ocrRows: ocrRowsByComponent[recordKey],
      singlePoints: singlePointsByComponent[recordKey],
    };
  }

  writeCabinetImageWorkspaceData(cabinetRoot, {
    version: 1,
    updatedAt: new Date().toISOString(),
    robots,
    annotations: nextAnnotations,
    mainDeviceNameOverrides: data.mainDeviceNameOverrides || {},
  });

  return { records, warnings, annotationsByComponent, ocrRowsByComponent, singlePointsByComponent, robots };
}

/**
 * 导入同一机器人编码时全量替换旧索引、旧标注和旧主设备名称覆盖。
 */
function replaceCabinetImageRobotIndex(projectName: string, robotCode: string, targetDir: string, packageName: string): void {
  const cabinetRoot = resolveProjectPath(projectName, OVERVIEW_DIR_NAME, CABINET_IMAGE_DIR_NAME);
  const data = readCabinetImageWorkspaceData(cabinetRoot);
  const result = readCabinetImagePackageFromDir(targetDir);
  const now = new Date().toISOString();
  const nextRobots = data.robots.filter((robot) => robot.robotCode !== robotCode);
  const nextAnnotations = Object.fromEntries(
    Object.entries(data.annotations || {}).filter(([, entry]) => entry.robotCode !== robotCode),
  );
  const nextMainDeviceNameOverrides = Object.fromEntries(
    Object.entries(data.mainDeviceNameOverrides || {}).filter(([, entry]) => entry.robotCode !== robotCode),
  );

  nextRobots.push({
    robotCode,
    dirName: path.basename(targetDir),
    packageName,
    workbookName: path.basename(findCabinetComponentWorkbookPath(targetDir) || CABINET_COMPONENT_WORKBOOK_NAME),
    importedAt: now,
    records: result.records.map(toCabinetImagePersistedRecord),
  });

  writeCabinetImageWorkspaceData(cabinetRoot, {
    version: 1,
    updatedAt: now,
    robots: nextRobots,
    annotations: nextAnnotations,
    mainDeviceNameOverrides: nextMainDeviceNameOverrides,
  });
}

/**
 * 保存单个部件的标注中间态。
 * 允许空名称等未完成数据保存；导出时再做强校验。
 */
function saveCabinetImageAnnotations(projectName: string, payload: any): { saved: boolean; deleted: boolean } {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");
  const cabinetRoot = resolveProjectPath(safeProjectName, OVERVIEW_DIR_NAME, CABINET_IMAGE_DIR_NAME);
  fs.mkdirSync(cabinetRoot, { recursive: true });

  const recordKey = valueText(payload?.recordKey);
  const robotCode = valueText(payload?.robotCode);
  const componentCode = valueText(payload?.componentCode);
  if (!recordKey) throw new Error("部件标注 key 为空");
  if (!robotCode) throw new Error("机器人编码为空");
  if (!componentCode) throw new Error("部件编码为空");

  const data = readCabinetImageWorkspaceData(cabinetRoot);
  const annotations = normalizeCabinetAnnotationData(payload?.annotations);
  const ocrRows = Array.isArray(payload?.ocrRows) ? payload.ocrRows : [];
  const singlePoints = Array.isArray(payload?.singlePoints) ? payload.singlePoints : [];
  const hasData = hasCabinetAnnotationData(annotations, ocrRows, singlePoints);
  const now = new Date().toISOString();

  if (hasData) {
    data.annotations[recordKey] = {
      recordKey,
      robotCode,
      componentCode,
      updatedAt: now,
      annotations,
      ocrRows,
      singlePoints,
    };
  } else {
    delete data.annotations[recordKey];
  }

  writeCabinetImageWorkspaceData(cabinetRoot, { ...data, updatedAt: now });
  return { saved: hasData, deleted: !hasData };
}

/**
 * 保存 OCR 识别后的主设备名称覆盖，不回写原始 Excel，避免破坏导入源数据。
 */
function saveCabinetMainDeviceNameOverride(projectName: string, payload: any): { saved: boolean; key: string; name: string } {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");
  const cabinetRoot = resolveProjectPath(safeProjectName, OVERVIEW_DIR_NAME, CABINET_IMAGE_DIR_NAME);
  fs.mkdirSync(cabinetRoot, { recursive: true });

  const key = valueText(payload?.key);
  const robotCode = valueText(payload?.robotCode);
  const name = valueText(payload?.name);
  if (!key) throw new Error("主设备名称覆盖 key 为空");
  if (!robotCode) throw new Error("机器人编码为空");
  if (!name) throw new Error("屏柜名称不能为空");

  const data = readCabinetImageWorkspaceData(cabinetRoot);
  const now = new Date().toISOString();
  data.mainDeviceNameOverrides[key] = {
    key,
    robotCode,
    name,
    updatedAt: now,
  };
  writeCabinetImageWorkspaceData(cabinetRoot, { ...data, updatedAt: now });
  return { saved: true, key, name };
}

/**
 * 将前端生成的 detector.json 写入用户选择的导出目录。
 */
function exportCabinetAnnotationParams(projectName: string, destDir: string, data: any): { filePath: string; fileName: string; pointCount: number; matchCount: number } {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");
  const targetDir = String(destDir || "").trim();
  if (!targetDir) throw new Error("请选择导出目录");
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error("导出目录不存在");
  }
  if (!data || typeof data !== "object") throw new Error("标注参数数据为空");

  const fileName = "detector.json";
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4), "utf-8");
  return {
    filePath,
    fileName,
    pointCount: Array.isArray(data.detTypeInfo) ? data.detTypeInfo.length : 0,
    matchCount: Array.isArray(data.matchInfo) ? data.matchInfo.length : 0,
  };
}

/**
 * 汇总屏柜导入 Excel 和后续生成的点位，导出屏柜点表。
 */
function exportCabinetPointTable(projectName: string, destDir: string): { filePath: string; fileName: string; rowCount: number; pointCount: number; componentCount: number } {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");
  const targetDir = String(destDir || "").trim();
  if (!targetDir) throw new Error("请选择导出目录");
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error("导出目录不存在");
  }

  const workspace = readCabinetImageWorkspace(safeProjectName);
  if (!workspace.records.length) throw new Error("请先导入屏柜图像");

  const usedPointCodes = collectExistingPointCodes(safeProjectName, workspace);
  const exportData = buildCabinetPointTableRows(workspace, usedPointCodes);
  if (!exportData.rows.length) throw new Error("暂无可导出的屏柜点表数据");

  const fileName = uniqueCabinetExportFileName(
    targetDir,
    `${sanitizeFileName(safeProjectName)}_屏柜点表_${formatCabinetExportTime(new Date())}.xlsx`,
  );
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, generatePointExcelFromRows(exportData.rows, {
    extraColumns: [CABINET_POINT_TABLE_ROBOT_COL],
    sheetName: "屏柜点表",
  }));

  return {
    filePath,
    fileName,
    rowCount: exportData.rows.length,
    pointCount: exportData.pointCount,
    componentCount: exportData.componentCount,
  };
}

/**
 * 收集数据库和屏柜工作区中已经占用的点位编码，避免导出时生成重复编码。
 */
function collectExistingPointCodes(projectName: string, workspace: ReturnType<typeof readCabinetImageWorkspace>): Set<string> {
  const codes = new Set<string>();
  try {
    const db = getDatabase();
    const rows = db.prepare("SELECT point_code FROM device_point WHERE project_name = ?").all(projectName) as Array<{ point_code?: unknown; pointCode?: unknown }>;
    for (const row of rows) {
      const code = valueText(row.point_code ?? row.pointCode);
      if (code) codes.add(code);
    }
  } catch (error) {
    console.warn("[export-cabinet-point-table] 读取已有点位编码失败:", error);
  }

  for (const rows of Object.values(workspace.ocrRowsByComponent || {})) {
    for (const row of rows || []) {
      const code = valueText(row?.pointCode);
      if (code) codes.add(code);
    }
  }
  for (const points of Object.values(workspace.singlePointsByComponent || {})) {
    for (const point of points || []) {
      const code = valueText(point?.pointCode);
      if (code) codes.add(code);
    }
  }
  return codes;
}

/**
 * 构建屏柜点表导出行。
 * 每个部件会先输出原始部件行，再追加人工/识别生成的点位行。
 */
function buildCabinetPointTableRows(
  workspace: ReturnType<typeof readCabinetImageWorkspace>,
  usedPointCodes: Set<string>,
): { rows: PointExcelExportRow[]; pointCount: number; componentCount: number } {
  const rows: PointExcelExportRow[] = [];
  let pointCount = 0;
  let componentCount = 0;

  for (const record of workspace.records) {
    const recordKey = valueText(record.recordKey) || buildCabinetRecordKey(record.robotCode, record.componentCode);
    const baseRow = cabinetComponentExportRow(record);
    const generatedRows = cabinetGeneratedPointRows(
      record,
      workspace.ocrRowsByComponent[recordKey] || [],
      workspace.singlePointsByComponent[recordKey] || [],
      usedPointCodes,
    );

    if (generatedRows.length > 0) {
      rows.push(...generatedRows);
      pointCount += generatedRows.length;
    } else {
      rows.push(baseRow);
      componentCount += 1;
    }
  }

  return { rows, pointCount, componentCount };
}

function cabinetComponentExportRow(record: CabinetImagePackageRecord): PointExcelExportRow {
  return {
    [CABINET_POINT_TABLE_ROBOT_COL]: valueText(record.robotCode),
    "*部件名称": valueText(record.componentName) || valueText(record.componentCode),
    "部件编码": valueText(record.componentCode),
    "*主设备名称": valueText(record.mainDeviceName) || valueText(record.mainDeviceCode),
    "主设备编码": valueText(record.mainDeviceCode),
    "*主设备类型": "二次屏柜",
    "*相位": "主体",
    "*间隔名称": valueText(record.bayName) || valueText(record.bayCode),
    "间隔编码": valueText(record.bayCode),
    "间隔类型": "屏柜区",
    "*区域": valueText(record.areaName) || valueText(record.areaCode),
    "区域编码": valueText(record.areaCode),
  };
}

/**
 * 将单个部件下已保存的识别点位转换为点表行。
 */
function cabinetGeneratedPointRows(
  record: CabinetImagePackageRecord,
  ocrRows: any[],
  singlePoints: any[],
  usedPointCodes: Set<string>,
): PointExcelExportRow[] {
  const baseRow = cabinetComponentExportRow(record);
  const rows: PointExcelExportRow[] = [];

  for (const row of ocrRows || []) {
    rows.push(cabinetPointExportRow(baseRow, {
      name: valueText(row?.name),
      pointCode: valueText(row?.pointCode),
      label: valueText(row?.recognitionLabel),
      labelDesc: valueText(row?.recognitionLabelDesc) || valueText(row?.type),
    }, usedPointCodes));
  }

  for (const point of singlePoints || []) {
    rows.push(cabinetPointExportRow(baseRow, {
      name: valueText(point?.pointName),
      pointCode: valueText(point?.pointCode),
      label: valueText(point?.recognitionLabel),
      labelDesc: valueText(point?.recognitionLabelDesc) || valueText(point?.recognitionType),
    }, usedPointCodes));
  }

  return rows;
}

/**
 * 生成单条屏柜点位行，并根据识别类型补齐点表中的识别方式字段。
 */
function cabinetPointExportRow(
  baseRow: PointExcelExportRow,
  point: { name: string; pointCode: string; label: string; labelDesc: string },
  usedPointCodes: Set<string>,
): PointExcelExportRow {
  const recognition = resolveCabinetPointRecognitionColumns(point.label, point.labelDesc);
  const pointCode = reserveCabinetPointCode(point.pointCode, usedPointCodes);
  return {
    ...baseRow,
    "*点位名称": point.name,
    "点位编码": pointCode,
    ...recognition,
  };
}

function resolveCabinetPointRecognitionColumns(label: string, labelDesc: string): PointExcelExportRow {
  const normalizedLabel = valueText(label);
  const normalizedDesc = valueText(labelDesc);
  const columns: PointExcelExportRow = {
    "采集类型": "可见光图片",
  };

  if (normalizedLabel === "infrared" || normalizedDesc.includes("红外")) {
    return {
      ...columns,
      "*识别类型1": "红外测温",
      "采集类型": "红外图谱",
    };
  }

  if (isCabinetMeterLabel(normalizedLabel, normalizedDesc)) {
    return {
      ...columns,
      "*识别类型1": "表计读取",
      "表计类型": cabinetMeterType(normalizedLabel, normalizedDesc),
    };
  }

  if (isCabinetAppearanceLabel(normalizedLabel, normalizedDesc)) {
    return {
      ...columns,
      "*识别类型1": "设备外观查看",
    };
  }

  if (normalizedLabel || normalizedDesc) {
    return {
      ...columns,
      "*识别类型1": "位置状态识别",
    };
  }

  return columns;
}

function isCabinetMeterLabel(label: string, desc: string): boolean {
  return ["meter_sf6", "zzb", "num_led"].includes(label)
    || desc.includes("表")
    || desc.includes("仪表");
}

function cabinetMeterType(label: string, desc: string): string {
  if (label === "meter_sf6" || desc.includes("SF6")) return "SF6压力表";
  return "";
}

function isCabinetAppearanceLabel(label: string, desc: string): boolean {
  return ["facade", "little_light", "show_off", "show_on", "ybzz"].includes(label)
    || desc.includes("外观")
    || desc.includes("显示屏")
    || desc.includes("小灯")
    || desc.includes("仪表装置");
}

function reserveCabinetPointCode(pointCode: string, usedPointCodes: Set<string>): string {
  const normalized = valueText(pointCode);
  if (normalized && !usedPointCodes.has(normalized)) {
    usedPointCodes.add(normalized);
    return normalized;
  }
  return generateCabinetPointCode(usedPointCodes);
}

/**
 * 屏柜点位编码生成规则：9 位数字，按已有最大值递增，确保本次导出内不重复。
 */
function generateCabinetPointCode(usedPointCodes: Set<string>): string {
  while (true) {
    let code = "P";
    for (let index = 0; index < 31; index += 1) {
      code += CABINET_POINT_CODE_CHARS[Math.floor(Math.random() * CABINET_POINT_CODE_CHARS.length)];
    }
    if (!usedPointCodes.has(code)) {
      usedPointCodes.add(code);
      return code;
    }
  }
}

function uniqueCabinetExportFileName(dir: string, preferredName: string): string {
  const parsed = path.parse(preferredName);
  let candidate = preferredName;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function formatCabinetExportTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * 读取屏柜图像工作区的持久化 JSON；不存在或损坏时返回空结构，保证页面可继续打开。
 */
function readCabinetImageWorkspaceData(cabinetRoot: string): CabinetImageWorkspaceData {
  const filePath = path.join(cabinetRoot, CABINET_IMAGE_DATA_FILE_NAME);
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: "", robots: [], annotations: {}, mainDeviceNameOverrides: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      version: Number(data?.version || 1),
      updatedAt: valueText(data?.updatedAt),
      robots: Array.isArray(data?.robots) ? data.robots : [],
      annotations: data?.annotations && typeof data.annotations === "object" ? data.annotations : {},
      mainDeviceNameOverrides: data?.mainDeviceNameOverrides && typeof data.mainDeviceNameOverrides === "object"
        ? data.mainDeviceNameOverrides
        : {},
    };
  } catch {
    return { version: 1, updatedAt: "", robots: [], annotations: {}, mainDeviceNameOverrides: {} };
  }
}

/**
 * 写入屏柜图像工作区持久化 JSON。
 */
function writeCabinetImageWorkspaceData(cabinetRoot: string, data: CabinetImageWorkspaceData): void {
  fs.mkdirSync(cabinetRoot, { recursive: true });
  fs.writeFileSync(path.join(cabinetRoot, CABINET_IMAGE_DATA_FILE_NAME), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function toCabinetImagePersistedRecord(record: CabinetImagePackageRecord): Omit<CabinetImagePackageRecord, "imageSource" | "imageDataUrl"> {
  const { imageSource: _imageSource, imageDataUrl: _imageDataUrl, ...rest } = record;
  return rest;
}

function applyCabinetMainDeviceNameOverrides(
  records: CabinetImagePackageRecord[],
  overrides: Record<string, CabinetMainDeviceNameOverride> = {},
): CabinetImagePackageRecord[] {
  return records.map((record) => {
    const override = overrides[buildCabinetMainDeviceOverrideKey(record)];
    if (!override?.name) return record;
    return { ...record, mainDeviceName: override.name };
  });
}

function buildCabinetMainDeviceOverrideKey(record: CabinetImagePackageRecord): string {
  return [
    valueText(record.robotCode) || "default",
    valueText(record.stationCode) || valueText(record.stationName) || "default",
    valueText(record.areaCode) || valueText(record.areaName) || "default",
    valueText(record.bayCode) || valueText(record.bayName) || "default",
    valueText(record.mainDeviceCode) || valueText(record.componentCode) || valueText(record.mainDeviceName) || "default",
  ].join("::");
}

function normalizeCabinetComponentRows(
  rows: Omit<CabinetImagePackageRecord, "imageName" | "imageSource" | "imageDataUrl">[],
): Omit<CabinetImagePackageRecord, "imageName" | "imageSource" | "imageDataUrl">[] {
  const robotCode = resolveCabinetRobotCode(rows);
  return rows.map((row) => ({
    ...row,
    robotCode,
    recordKey: buildCabinetRecordKey(robotCode, row.componentCode),
  }));
}

function resolveCabinetRobotCode(
  rows: Array<Pick<CabinetImagePackageRecord, "robotCode">>,
  fallback = "",
): string {
  const robotCodes = [...new Set(rows.map((row) => valueText(row.robotCode)).filter(Boolean))];
  if (robotCodes.length > 1) throw new Error(`屏柜部件表存在多个机器人编码：${robotCodes.join(", ")}`);
  const robotCode = robotCodes[0] || valueText(fallback);
  if (!robotCode) throw new Error("屏柜部件表缺少机器人编码");
  return robotCode;
}

function buildCabinetRecordKey(robotCode: string, componentCode: string): string {
  return `${valueText(robotCode) || "default"}::${valueText(componentCode)}`;
}

/**
 * 标注 JSON 兼容修正，避免旧版本缺少某类框数组导致前端读取报错。
 */
function normalizeCabinetAnnotationData(annotations: any): any {
  return {
    standardPartRects: Array.isArray(annotations?.standardPartRects) ? annotations.standardPartRects : [],
    deviceLabelRects: Array.isArray(annotations?.deviceLabelRects) ? annotations.deviceLabelRects : [],
    deviceBoxRects: Array.isArray(annotations?.deviceBoxRects) ? annotations.deviceBoxRects : [],
    appearanceRects: Array.isArray(annotations?.appearanceRects) ? annotations.appearanceRects : [],
  };
}

function hasCabinetAnnotationData(annotations: any, ocrRows: any[], singlePoints: any[]): boolean {
  return normalizeCabinetAnnotationData(annotations).standardPartRects.length > 0
    || normalizeCabinetAnnotationData(annotations).deviceLabelRects.length > 0
    || normalizeCabinetAnnotationData(annotations).deviceBoxRects.length > 0
    || normalizeCabinetAnnotationData(annotations).appearanceRects.length > 0
    || ocrRows.length > 0
    || singlePoints.length > 0;
}

function normalizeCabinetWorkbookFile(dirPath: string): void {
  const workbookPath = findCabinetComponentWorkbookPath(dirPath);
  if (!workbookPath) return;
  const ext = path.extname(workbookPath).toLowerCase() === ".xls" ? ".xls" : ".xlsx";
  const targetPath = path.join(dirPath, ext === ".xls" ? "屏柜部件表.xls" : CABINET_COMPONENT_WORKBOOK_NAME);
  if (isSameFsPath(workbookPath, targetPath)) return;
  fs.copyFileSync(workbookPath, targetPath);
  fs.rmSync(workbookPath, { force: true });
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

function isSameFsPath(leftPath: string, rightPath: string): boolean {
  return path.resolve(leftPath).toLowerCase() === path.resolve(rightPath).toLowerCase();
}

function assertDirectoryDoesNotOverlapForCabinetImages(sourceDir: string, targetDir: string): void {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  const relTargetFromSource = path.relative(source, target);
  const relSourceFromTarget = path.relative(target, source);
  const targetInsideSource = relTargetFromSource === "" || (!relTargetFromSource.startsWith("..") && !path.isAbsolute(relTargetFromSource));
  const sourceInsideTarget = relSourceFromTarget === "" || (!relSourceFromTarget.startsWith("..") && !path.isAbsolute(relSourceFromTarget));
  if (targetInsideSource || sourceInsideTarget) {
    throw new Error("导入目录不能与屏柜图像本地目录互相包含");
  }
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

function flattenCabinetImageWrapperDir(targetDir: string): void {
  if (findCabinetComponentWorkbookPath(targetDir)) return;

  const items = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((item) => !item.name.startsWith(".") && !item.name.startsWith("__"));
  const wrappers = items
    .filter((item) => item.isDirectory())
    .map((item) => path.join(targetDir, item.name))
    .filter((wrapper) => Boolean(findCabinetComponentWorkbookPath(wrapper)));
  if (wrappers.length !== 1) return;

  const wrapper = wrappers[0];
  for (const item of fs.readdirSync(wrapper, { withFileTypes: true })) {
    const src = path.join(wrapper, item.name);
    const dst = path.join(targetDir, item.name);
    if (item.isDirectory() && fs.existsSync(dst)) cpMerge(src, dst);
    else fs.cpSync(src, dst, { recursive: true, force: true });
  }
  fs.rmSync(wrapper, { recursive: true, force: true });
  console.log("[import-cabinet-image-package] 扁平化外层目录:", wrapper);
}

function findCabinetComponentWorkbookPath(dirPath: string): string | null {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
  const files = fs.readdirSync(dirPath, { withFileTypes: true });
  const xlsx = files.find((item) => item.isFile() && /\.(xlsx|xls)$/i.test(item.name) && !item.name.startsWith("~$"));
  return xlsx ? path.join(dirPath, xlsx.name) : null;
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
  repo.bindCalibrationIds(Array.from(pointCodes), projectName);
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

function buildImageLabelRecords(calibration: CalibrationFileData, context: SurveyContext, points: any[]): ImageLabelRecord[] {
  const pointByCode = new Map<string, any>();
  for (const point of points) {
    const code = valueText(point.pointCode);
    if (code) pointByCode.set(code, point);
  }
  const records: ImageLabelRecord[] = [];
  const usedFileNames = new Set<string>();
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
        const fileName = createPointCodeJsonFileName(pointCode, usedFileNames, serial);
        records.push({ fileName, data: robotData });
        serial++;
      }
    }
  }

  return records;
}

function createPointCodeJsonFileName(pointCode: string, usedFileNames: Set<string>, serial: number): string {
  const baseName = sanitizeFileName(pointCode || `point_${String(serial).padStart(3, "0")}`);
  let fileName = `${baseName}.json`;
  let suffix = 2;
  while (usedFileNames.has(fileName)) {
    fileName = `${baseName}_${suffix}.json`;
    suffix++;
  }
  usedFileNames.add(fileName);
  return fileName;
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
