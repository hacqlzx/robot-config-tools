import { shell } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import os from "os";
import {
  deleteProjectData,
  getDatabase,
  getProjectDataCounts,
  DeviceBayRepo,
  DeviceMainRepo,
  renameProjectData,
  type CreateDeviceMainDTO,
  type DeviceBay,
  type ProjectDataCounts,
} from "@robot/database";
import { exportSpaceZip, type PointTableExportData } from "../export-points";
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
const DESCRIPTION_FILE_NAME = "description_file.json";
const MAP_DIR_NAME = "地图";
const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";
const AREA_TYPE_CABINET_ROW = "1";
const AREA_TYPE_CABINET = "2";
const MAIN_DEVICE_TYPE_CABINET = 29;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

interface ImportedSpaceModelZipResult {
  mapName: string;
  mapDir: string;
  modelPath: string;
}

export interface ImportedSpaceModelZipPlan {
  mapCode: string;
  mapName: string;
  willReplace: boolean;
  existingMapName?: string;
  existingMapDir?: string;
}

interface PreparedMapSource {
  sourceDir: string;
  mapName: string;
}

interface MapInfoValues {
  mapCode: string;
  mapName: string;
}

interface ResolvedMapImportPlan {
  mapCode: string;
  targetDir: string;
  targetMapName: string;
  willReplace: boolean;
  existingMapDir: string | null;
}

function makeProjectTreeWritable(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      makeProjectTreeWritable(path.join(targetPath, entry));
    }
    fs.chmodSync(targetPath, 0o777);
    return;
  }
  fs.chmodSync(targetPath, 0o666);
}

function removeProjectDirectory(dirPath: string): void {
  const removeOptions: fs.RmDirOptions = {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  };
  try {
    fs.rmSync(dirPath, removeOptions);
  } catch (error: any) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    makeProjectTreeWritable(dirPath);
    fs.rmSync(dirPath, removeOptions);
  }
}

function assertProjectName(name: string): string {
  return assertSafePathSegment(name, "项目名称");
}

function formatMapInfoTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildMapInfoText(mapName: string, mapCode?: string): string {
  const data: Record<string, string> = {};
  if (mapCode?.trim()) data.map_code = mapCode.trim();
  data.map_name = mapName;
  data.time = formatMapInfoTime();
  return `${JSON.stringify(data, null, 2)}\n`;
}

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function areaType(record: Record<string, unknown>): string {
  return textValue(record.type);
}

function readMapInfoValues(mapDir: string): MapInfoValues {
  const filePath = path.join(mapDir, MAP_INFO_FILE_NAME);
  if (!fs.existsSync(filePath)) return { mapCode: "", mapName: "" };

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!isRecord(parsed)) return { mapCode: "", mapName: "" };
    return {
      mapCode: textValue(parsed.map_code ?? parsed.mapCode ?? parsed.map_id ?? parsed.mapId),
      mapName: textValue(parsed.map_name ?? parsed.mapName ?? parsed.name),
    };
  } catch {
    return { mapCode: "", mapName: "" };
  }
}

function stripExportTimeSuffix(name: string): string {
  const original = textValue(name);
  if (!original) return "";
  return original.replace(/[_-]\d{8}[_-]\d{4,6}(?:_\d+)?$/, "") || original;
}

function normalizeImportedMapName(...candidates: string[]): string {
  const raw = candidates.map(stripExportTimeSuffix).find(Boolean);
  return assertSafePathSegment(raw || "地图", "地图名称");
}

function findExistingMapDirByCode(projectName: string, mapsSubDir: string, mapCode: string): string | null {
  const code = textValue(mapCode);
  if (!code) return null;

  const mapRoot = resolveProjectPath(projectName, mapsSubDir);
  if (!fs.existsSync(mapRoot)) return null;

  const entries = fs.readdirSync(mapRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("__"))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const dirPath = path.join(mapRoot, entry.name);
    if (readMapInfoValues(dirPath).mapCode === code) return dirPath;
  }
  return null;
}

function uniqueNewMapName(projectName: string, mapsSubDir: string, desiredName: string): string {
  const safeName = assertSafePathSegment(desiredName, "地图名称");
  let candidate = safeName;
  for (let index = 1; fs.existsSync(resolveProjectPath(projectName, mapsSubDir, candidate)); index++) {
    candidate = assertSafePathSegment(`${safeName}_${index}`, "地图名称");
  }
  return candidate;
}

async function writeNormalizedMapInfo(mapDir: string, mapName: string, fallbackMapCode: string): Promise<void> {
  const mapInfoPath = path.join(mapDir, MAP_INFO_FILE_NAME);
  let data: Record<string, unknown> = {};

  if (fs.existsSync(mapInfoPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mapInfoPath, "utf-8"));
      if (isRecord(parsed)) data = { ...parsed };
    } catch {
      data = {};
    }
  }

  const mapCode = textValue(data.map_code ?? data.mapCode ?? data.map_id ?? data.mapId) || textValue(fallbackMapCode);
  if (mapCode) data.map_code = mapCode;
  data.map_name = mapName;
  if (!textValue(data.time)) data.time = formatMapInfoTime();

  await fs.promises.writeFile(mapInfoPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function resolveModelZipSource(sourcePath: string): Promise<string> {
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

  return sourceResolved;
}

function resolveMapImportPlan(
  projectName: string,
  sourceZipPath: string,
  mapSourceDir: string,
  mapsSubDir: string,
): ResolvedMapImportPlan {
  const mapInfo = readMapInfoValues(mapSourceDir);
  const existingMapDir = findExistingMapDirByCode(projectName, mapsSubDir, mapInfo.mapCode);
  const existingMapInfo = existingMapDir ? readMapInfoValues(existingMapDir) : null;
  const desiredMapName = normalizeImportedMapName(path.basename(sourceZipPath, ".zip"));
  const targetDir = existingMapDir
    || resolveProjectPath(projectName, mapsSubDir, uniqueNewMapName(projectName, mapsSubDir, desiredMapName));
  const targetMapName = existingMapDir
    ? (existingMapInfo?.mapName || path.basename(existingMapDir))
    : path.basename(targetDir);

  return {
    mapCode: mapInfo.mapCode,
    targetDir,
    targetMapName,
    willReplace: !!existingMapDir,
    existingMapDir,
  };
}

function getDirectProjectMapName(projectName: string, projectDir: string, targetPath: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(targetPath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const manifest = ensureProjectManifest(projectName);
  const mapRoot = assertInside(projectDir, path.join(projectDir, manifest.layout.dirs.maps || MAP_DIR_NAME), "识别地图目录");
  const relative = path.relative(mapRoot, targetPath);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (relative.split(path.sep).length !== 1) return null;
  return path.basename(targetPath);
}

function pruneSurveyCalibrationForMap(projectName: string, projectDir: string, surveyRoot: string, mapName: string): boolean {
  const calibrationPath = assertInside(projectDir, path.join(surveyRoot, CALIBRATION_FILE_NAME), "清理勘察标识");
  if (!fs.existsSync(calibrationPath)) return false;

  try {
    const parsed = JSON.parse(fs.readFileSync(calibrationPath, "utf-8"));
    if (!isRecord(parsed)) return false;
    const fileMapCode = textValue(parsed.mapCode);
    const data = Array.isArray(parsed.data) ? parsed.data : [];
    const remaining = data.filter((entry) => {
      const entryMapCode = isRecord(entry) ? textValue(entry.mapCode) : "";
      return (entryMapCode || fileMapCode) !== mapName;
    });
    const changed = remaining.length !== data.length || fileMapCode === mapName;
    if (!changed) return false;

    const nextMapCode = textValue(isRecord(remaining[0]) ? remaining[0].mapCode : "") || (fileMapCode === mapName ? "" : fileMapCode);
    const next = {
      ...parsed,
      version: Number(parsed.version) || 2,
      mapCode: nextMapCode,
      data: remaining,
    };
    fs.writeFileSync(calibrationPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    updateManifestForWrittenFile(projectName, calibrationPath, fs.statSync(calibrationPath).size);
    return true;
  } catch (error) {
    console.warn("[项目文件删除] 清理勘察标识失败", { projectName, mapName, error });
    return false;
  }
}

function deleteSurveyDataForMap(projectName: string, projectDir: string, mapName: string): void {
  const manifest = ensureProjectManifest(projectName);
  const surveyRoot = assertInside(projectDir, path.join(projectDir, manifest.layout.dirs.surveyImages || SURVEY_DIR_NAME), "删除勘察数据");
  const surveyDir = assertInside(projectDir, path.join(surveyRoot, mapName), "删除勘察数据");

  if (fs.existsSync(surveyDir)) {
    removeProjectDirectory(surveyDir);
    removeManifestAssetsUnderPath(projectName, surveyDir);
  }
  pruneSurveyCalibrationForMap(projectName, projectDir, surveyRoot, mapName);
}

function splitTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitTextList(item));
  return textValue(value)
    .split(/[,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function bayCodesFromAreaRecord(record: Record<string, unknown> | null | undefined): string[] {
  if (!record) return [];
  return uniqueTexts([...splitTextList(record.bay_code), ...splitTextList(record.bay_codes)]);
}

function findDescriptionFiles(rootDir: string): string[] {
  const result: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("__")) {
        queue.push(fullPath);
      } else if (entry.isFile() && entry.name === DESCRIPTION_FILE_NAME) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

interface CabinetMainImportItem {
  code: string;
  name: string;
  bayCode: string;
}

function collectCabinetMainImportItems(records: Record<string, unknown>[]): CabinetMainImportItem[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const type = areaType(record);
    if (type !== AREA_TYPE_CABINET_ROW && type !== AREA_TYPE_CABINET) continue;
    const id = textValue(record.id);
    if (id) byId.set(id, record);
  }

  const items: CabinetMainImportItem[] = [];
  const seen = new Set<string>();
  const push = (record: Record<string, unknown>, bayCodes: string[]) => {
    const code = textValue(record.code);
    const name = textValue(record.name) || code;
    if (!name && !code) return;
    for (const bayCode of uniqueTexts(bayCodes)) {
      const key = `${bayCode}\u0000${code}\u0000${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ code, name, bayCode });
    }
  };

  for (const record of records) {
    if (areaType(record) === AREA_TYPE_CABINET) {
      let bayCodes = bayCodesFromAreaRecord(record);
      if (bayCodes.length === 0) {
        const parentCodes = bayCodesFromAreaRecord(byId.get(textValue(record.parent_id)));
        if (parentCodes.length === 1) bayCodes = parentCodes;
      }
      push(record, bayCodes);
    }
  }
  return items;
}

function generateMainDeviceCode(): string {
  let result = "MD";
  for (let i = result.length; i < 32; i++) {
    result += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return result;
}

function createCabinetMainDto(projectName: string, bay: DeviceBay, item: CabinetMainImportItem, sortNum: number): CreateDeviceMainDTO {
  return {
    mainDeviceType: MAIN_DEVICE_TYPE_CABINET,
    mainDeviceName: item.name,
    mainDeviceCode: item.code || generateMainDeviceCode(),
    phaseType: 0,
    threePhaseFlag: 0,
    threePhaseAssociateId: "",
    entityId: "",
    alarmLevel: 0,
    bayId: bay.id,
    bayType: bay.bayType || "屏柜区",
    bayName: bay.bayName || "",
    bayCode: bay.bayCode || item.bayCode,
    voltId: bay.voltId || 0,
    voltName: bay.voltName || "",
    voltCode: bay.voltCode || "",
    stationId: bay.stationId || 0,
    stationName: bay.stationName || "",
    stationCode: bay.stationCode || "",
    sortNum,
    projectName,
    createBy: "space-model-import",
    updateBy: "space-model-import",
    deviceModel: "",
    deviceSource: "",
    manufacturer: "",
    productionCode: "",
    useCompany: "",
    productionDate: "",
    commissioningDate: "",
    remarkInfo: "",
    repairFlag: 0,
  };
}

function syncCabinetMainDevicesFromImportedMap(projectName: string, mapDir: string): void {
  const files = findDescriptionFiles(mapDir);
  if (files.length === 0) return;

  const items: CabinetMainImportItem[] = [];
  for (const filePath of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(parsed)) {
        items.push(...collectCabinetMainImportItems(parsed.filter(isRecord)));
      }
    } catch (error) {
      console.warn("[空间模型导入][屏柜主设备] 解析 description_file.json 失败", { filePath, error });
    }
  }
  if (items.length === 0) return;

  const db = getDatabase();
  const bayRepo = new DeviceBayRepo(db);
  const mainRepo = new DeviceMainRepo(db);
  const bayCache = new Map<string, DeviceBay | null>();
  const skippedMissingBay = new Set<string>();
  let inserted = 0;
  let skippedExisting = 0;

  db.transaction(() => {
    for (const item of items) {
      const bayCode = textValue(item.bayCode);
      if (!bayCode) continue;
      if (!bayCache.has(bayCode)) {
        bayCache.set(bayCode, bayRepo.findByBayCode(bayCode, projectName) ?? null);
      }
      const bay = bayCache.get(bayCode);
      if (!bay) {
        skippedMissingBay.add(bayCode);
        continue;
      }

      const existingByBay = mainRepo.findByBayId(bay.id, projectName);
      const exists = existingByBay.some((main) =>
        main.mainDeviceType === MAIN_DEVICE_TYPE_CABINET
        && ((item.code && main.mainDeviceCode === item.code) || (item.name && main.mainDeviceName === item.name))
      );
      if (exists) {
        skippedExisting += 1;
        continue;
      }

      mainRepo.create(createCabinetMainDto(projectName, bay, item, existingByBay.length + 1));
      inserted += 1;
    }
  })();
  db.saveToDisk();

  console.log("[空间模型导入][屏柜主设备] 同步完成", {
    projectName,
    mapDir,
    files: files.length,
    parsedItems: items.length,
    inserted,
    skippedExisting,
    skippedMissingBay: Array.from(skippedMissingBay),
  });
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

  const safeName = assertProjectName(name);
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
  const safeOldName = assertSafePathSegment(oldName, "项目名称");
  const safeNewName = assertProjectName(newName);
  if (safeOldName === safeNewName) return safeNewName;

  const oldPath = resolveProjectDir(safeOldName);
  const newPath = resolveProjectDir(safeNewName);
  if (!fs.existsSync(oldPath)) {
    throw new Error(`项目 "${safeOldName}" 不存在`);
  }
  if (fs.existsSync(newPath)) {
    throw new Error(`项目 "${safeNewName}" 已存在`);
  }

  const db = getDatabase();
  const targetCounts = getProjectDataCounts(db, safeNewName);
  if (targetCounts.total > 0) {
    throw new Error(`数据库中已存在项目 "${safeNewName}" 的关联数据，无法重命名`);
  }

  fs.renameSync(oldPath, newPath);
  let databaseRenamed = false;
  try {
    updateManifestForProjectRename(safeNewName);
    renameProjectData(db, safeOldName, safeNewName);
    databaseRenamed = true;
  } catch (error) {
    const rollbackErrors: string[] = [];
    let databaseNeedsRollback = databaseRenamed;
    if (!databaseNeedsRollback) {
      try {
        databaseNeedsRollback = getProjectDataCounts(db, safeNewName).total > 0;
      } catch (rollbackError: any) {
        rollbackErrors.push(`数据库状态检查失败：${rollbackError?.message || rollbackError}`);
      }
    }
    if (databaseNeedsRollback) {
      try {
        renameProjectData(db, safeNewName, safeOldName);
      } catch (rollbackError: any) {
        rollbackErrors.push(`数据库回滚失败：${rollbackError?.message || rollbackError}`);
      }
    }
    try {
      fs.renameSync(newPath, oldPath);
      updateManifestForProjectRename(safeOldName);
    } catch (rollbackError: any) {
      rollbackErrors.push(`项目目录回滚失败：${rollbackError?.message || rollbackError}`);
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${(error as any)?.message || error}；${rollbackErrors.join("；")}`);
    }
    throw error;
  }
  return safeNewName;
}

export async function deleteProject(name: string): Promise<string> {
  ensureProjectRoot();
  const safeName = assertSafePathSegment(name, "项目名称");
  const dirPath = resolveProjectDir(safeName);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`项目 "${safeName}" 不存在`);
  }

  deleteProjectData(getDatabase(), safeName);
  try {
    removeProjectDirectory(dirPath);
  } catch (error: any) {
    throw new Error(`项目数据库数据已删除，但目录清理失败：${error?.message || error}`);
  }
  return safeName;
}

export function getProjectDatabaseSummary(name: string): ProjectDataCounts {
  const safeName = assertSafePathSegment(name, "项目名称");
  return getProjectDataCounts(getDatabase(), safeName);
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
    const mapInfoText = buildMapInfoText(safeBaseName);
    await fs.promises.writeFile(mapInfoPath, mapInfoText, "utf-8");
    updateManifestForWrittenFile(projectName, mapInfoPath, Buffer.byteLength(mapInfoText));
  }
  return targetPath;
}

export async function inspectProjectModelZipImport(projectName: string, sourcePath: string): Promise<ImportedSpaceModelZipPlan> {
  const sourceResolved = await resolveModelZipSource(sourcePath);
  const manifest = ensureProjectManifest(projectName);
  const mapsSubDir = manifest.layout.dirs.maps || MAP_DIR_NAME;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robot-space-import-preview-"));

  try {
    const zip = new AdmZip(sourceResolved);
    zip.extractAllTo(tempRoot, true);

    const prepared = prepareMapSourceDir(tempRoot, sourceResolved);
    const plan = resolveMapImportPlan(projectName, sourceResolved, prepared.sourceDir, mapsSubDir);
    return {
      mapCode: plan.mapCode,
      mapName: plan.targetMapName,
      willReplace: plan.willReplace,
      existingMapName: plan.willReplace ? plan.targetMapName : undefined,
      existingMapDir: plan.existingMapDir || undefined,
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function importProjectModelZip(projectName: string, sourcePath: string): Promise<ImportedSpaceModelZipResult> {
  const sourceResolved = await resolveModelZipSource(sourcePath);
  const manifest = ensureProjectManifest(projectName);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robot-space-import-"));

  try {
    const zip = new AdmZip(sourceResolved);
    zip.extractAllTo(tempRoot, true);

    const prepared = prepareMapSourceDir(tempRoot, sourceResolved);
    const mapSourceDir = prepared.sourceDir;
    const mapsSubDir = manifest.layout.dirs.maps || MAP_DIR_NAME;
    const plan = resolveMapImportPlan(projectName, sourceResolved, mapSourceDir, mapsSubDir);
    const targetDir = plan.targetDir;
    const mapName = plan.targetMapName;

    if (fs.existsSync(targetDir)) {
      removeProjectDirectory(targetDir);
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
    await writeNormalizedMapInfo(targetDir, mapName, plan.mapCode);
    updateManifestForWrittenFile(projectName, mapInfoPath, fs.statSync(mapInfoPath).size);

    syncCabinetMainDevicesFromImportedMap(projectName, targetDir);

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

  const deletedMapName = getDirectProjectMapName(projectName, projectDir, resolved);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    removeProjectDirectory(resolved);
  } else {
    fs.rmSync(resolved, { force: true });
  }
  removeManifestAssetsUnderPath(projectName, resolved);
  if (deletedMapName) {
    deleteSurveyDataForMap(projectName, projectDir, deletedMapName);
  }
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
  const pointTableData: PointTableExportData = {
    voltages: db.prepare("SELECT * FROM device_voltage WHERE project_name = ? ORDER BY sort_num, id").all(safeProjectName) as any[],
    bays: db.prepare("SELECT * FROM device_bay WHERE project_name = ? ORDER BY sort_num, id").all(safeProjectName) as any[],
    mains: db.prepare("SELECT * FROM device_main WHERE project_name = ? ORDER BY sort_num, id").all(safeProjectName) as any[],
    components: db.prepare("SELECT * FROM device_component WHERE project_name = ? ORDER BY sort_num, id").all(safeProjectName) as any[],
    points: db.prepare("SELECT * FROM device_point WHERE project_name = ? ORDER BY sort_num, id").all(safeProjectName) as any[],
  };

  const mapDirs = items
    .filter((it) => it.type === "地图")
    .map((it) => assertSafePathSegment(it.name, "地图名称"));
  if (mapDirs.length !== 1) throw new Error("导出模型仅支持当前左侧树已加载的单个模型");

  return exportSpaceZip(safeProjectName, getProjectRoot(), pointTableData, mapDirs, destRoot, onProgress);
}
