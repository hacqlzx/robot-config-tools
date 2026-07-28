import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { ipcMain } from "electron";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx-js-style";
import { isPathInside, resolveProjectDir, resolveProjectPath } from "../project-core/project-paths";

type DeviceVerificationNodeKind = "region" | "bay" | "mainDevice" | "component" | "point";
type DeviceVerificationSourceType = "zip" | "directory";

interface DeviceVerificationNodeRecord {
  id: string;
  title: string;
  code: string;
  kind: DeviceVerificationNodeKind;
  parentId: string | null;
  childrenIds: string[];
  marked?: boolean;
  imagePath?: string;
  imageMime?: string;
}

interface DeviceVerificationSession {
  id: string;
  sourceDir: string;
  packageName: string;
  nodes: Map<string, DeviceVerificationNodeRecord>;
  rootIds: string[];
}

interface ImageEntryInfo {
  filePath: string;
  mime: string;
}

interface DeviceVerificationSource {
  path: string;
  type: DeviceVerificationSourceType;
}

interface DeviceCorrectionRect {
  x: number;
  y: number;
  size: number;
  imageWidth: number;
  imageHeight: number;
}

interface DeviceCorrectionRecord {
  pointCode: string;
  pointName: string;
  rect: DeviceCorrectionRect;
  updatedAt: string;
}

interface DeviceCorrectionFile {
  version: number;
  updatedAt: string;
  records: Record<string, DeviceCorrectionRecord>;
}

interface DeviceMarkedPointRecord {
  pointCode: string;
  pointName: string;
  updatedAt: string;
}

interface DeviceMarkedPointFile {
  version: number;
  updatedAt: string;
  records: Record<string, DeviceMarkedPointRecord>;
}

interface MarkedPointExcelExportRow {
  pointName: string;
  mainDeviceName: string;
  bayName: string;
}

const OVERVIEW_DIR_NAME = "总览图";
const DEVICE_VERIFY_DIR_NAME = "设备验证图";
const DEVICE_CORRECTION_FILE_NAME = "设备纠偏.json";
const DEVICE_MARKED_POINT_FILE_NAME = "标记点位.json";

const hierarchyColumns: Array<{
  kind: DeviceVerificationNodeKind;
  names: string[];
  codes: string[];
}> = [
  { kind: "region", names: ["*区域", "区域"], codes: ["区域编码"] },
  { kind: "bay", names: ["*间隔名称", "间隔名称"], codes: ["间隔编码"] },
  { kind: "mainDevice", names: ["*主设备名称", "主设备名称"], codes: ["主设备编码"] },
  { kind: "component", names: ["*部件名称", "部件名称"], codes: ["部件编码"] },
  { kind: "point", names: ["*点位名称", "点位名称"], codes: ["点位编码"] },
];

let activeSession: DeviceVerificationSession | null = null;

export function registerDeviceVerifyIpc(): void {
  ipcMain.handle("device-verify:import-package", async (_event, projectName: string, sourcePath: string) => {
    try {
      const source = validatePackageSource(sourcePath);
      const importDir = importDeviceVerificationSource(projectName, source);
      const session = readDeviceVerificationDirectory(importDir, path.basename(source.path));
      activeSession = session;

      return buildPackageResult(session);
    } catch (error: any) {
      console.error("[device-verify] 导入设备验证图失败:", error?.message || error);
      return { success: false, error: error?.message || "设备验证图加载失败" };
    }
  });

  ipcMain.handle("device-verify:load-local", async (_event, projectName: string) => {
    try {
      const localDir = getDeviceVerificationDir(projectName);
      if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
        return { success: true, hasData: false };
      }

      const session = readDeviceVerificationDirectory(localDir, DEVICE_VERIFY_DIR_NAME);
      activeSession = session;
      return buildPackageResult(session);
    } catch (error: any) {
      console.error("[device-verify] 加载本地设备验证图失败:", error?.message || error);
      return { success: false, error: error?.message || "本地设备验证图加载失败" };
    }
  });

  ipcMain.handle("device-verify:list-children", async (_event, sessionId: string, parentId: string) => {
    try {
      const session = getActiveSession(sessionId);
      const parent = session.nodes.get(String(parentId || ""));
      if (!parent) throw new Error("树节点不存在，请重新加载设备验证图");
      return {
        success: true,
        children: parent.childrenIds.map((id) => toPublicNode(session, session.nodes.get(id)!, false)),
      };
    } catch (error: any) {
      return { success: false, error: error?.message || "点位树加载失败" };
    }
  });

  ipcMain.handle("device-verify:load-image", async (_event, sessionId: string, pointNodeId: string) => {
    try {
      const session = getActiveSession(sessionId);
      const point = session.nodes.get(String(pointNodeId || ""));
      if (!point || point.kind !== "point") throw new Error("请选择点位节点");
      if (!point.imagePath || !point.imageMime) throw new Error("该点位没有对应图片");

      const imagePath = path.resolve(point.imagePath);
      if (!isPathInside(session.sourceDir, imagePath)) throw new Error("图片路径越界，请重新加载设备验证图");
      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) throw new Error("未找到点位图片，请重新加载设备验证图");

      return {
        success: true,
        fileName: path.basename(imagePath),
        dataUrl: `data:${point.imageMime};base64,${fs.readFileSync(imagePath).toString("base64")}`,
      };
    } catch (error: any) {
      console.error("[device-verify] 加载点位图片失败:", error?.message || error);
      return { success: false, error: error?.message || "点位图片加载失败" };
    }
  });

  ipcMain.handle("device-verify:load-correction", async (_event, projectName: string, pointCode: string) => {
    try {
      const code = valueText(pointCode);
      if (!code) return { success: true, rect: null };

      const file = readDeviceCorrectionFile(getDeviceCorrectionFilePath(projectName));
      return {
        success: true,
        rect: file.records[code]?.rect || null,
      };
    } catch (error: any) {
      console.error("[device-verify] 加载设备纠偏失败:", error?.message || error);
      return { success: false, error: error?.message || "设备纠偏加载失败" };
    }
  });

  ipcMain.handle("device-verify:save-correction", async (_event, projectName: string, record: Partial<DeviceCorrectionRecord>) => {
    try {
      const pointCode = valueText(record?.pointCode);
      if (!pointCode) throw new Error("点位编码不能为空");
      const rect = normalizeCorrectionRect(record?.rect);
      const correctionPath = getDeviceCorrectionFilePath(projectName);
      const file = readDeviceCorrectionFile(correctionPath);
      const now = new Date().toISOString();
      file.records[pointCode] = {
        pointCode,
        pointName: valueText(record?.pointName),
        rect,
        updatedAt: now,
      };
      file.updatedAt = now;
      writeDeviceCorrectionFile(correctionPath, file);
      return { success: true, rect };
    } catch (error: any) {
      console.error("[device-verify] 保存设备纠偏失败:", error?.message || error);
      return { success: false, error: error?.message || "设备纠偏保存失败" };
    }
  });

  ipcMain.handle("device-verify:delete-correction", async (_event, projectName: string, pointCode: string) => {
    try {
      const code = valueText(pointCode);
      if (!code) return { success: true };
      const correctionPath = getDeviceCorrectionFilePath(projectName);
      const file = readDeviceCorrectionFile(correctionPath);
      if (file.records[code]) {
        delete file.records[code];
        file.updatedAt = new Date().toISOString();
        writeDeviceCorrectionFile(correctionPath, file);
      }
      return { success: true };
    } catch (error: any) {
      console.error("[device-verify] 删除设备纠偏失败:", error?.message || error);
      return { success: false, error: error?.message || "设备纠偏删除失败" };
    }
  });

  ipcMain.handle("device-verify:export-correction-data", async (_event, projectName: string, destDir: string) => {
    try {
      return exportDeviceVerificationCorrectionData(projectName, destDir);
    } catch (error: any) {
      console.error("[device-verify] 导出纠偏数据失败:", error?.message || error);
      return { success: false, error: error?.message || "导出纠偏数据失败" };
    }
  });

  ipcMain.handle("device-verify:set-point-mark", async (_event, projectName: string, record: { pointCode?: string; pointName?: string; marked?: boolean }) => {
    try {
      const pointCode = valueText(record?.pointCode);
      if (!pointCode) throw new Error("点位编码不能为空");
      const marked = Boolean(record?.marked);
      const markedPath = getDeviceMarkedPointFilePath(projectName);
      const file = readDeviceMarkedPointFile(markedPath);
      const now = new Date().toISOString();
      if (marked) {
        file.records[pointCode] = {
          pointCode,
          pointName: valueText(record?.pointName),
          updatedAt: now,
        };
      } else if (file.records[pointCode]) {
        delete file.records[pointCode];
      }
      file.updatedAt = now;
      writeDeviceMarkedPointFile(markedPath, file);
      updateActiveSessionMarked(pointCode, marked);
      return { success: true, marked };
    } catch (error: any) {
      console.error("[device-verify] 保存标记点位失败:", error?.message || error);
      return { success: false, error: error?.message || "标记点位保存失败" };
    }
  });

  ipcMain.handle("device-verify:export-marked-points", async (_event, projectName: string, destDir: string) => {
    try {
      return exportMarkedDeviceVerificationPoints(projectName, destDir);
    } catch (error: any) {
      console.error("[device-verify] 导出标记点位失败:", error?.message || error);
      return { success: false, error: error?.message || "导出标记点位失败" };
    }
  });
}

function importDeviceVerificationSource(projectName: string, source: DeviceVerificationSource): string {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const projectDir = resolveProjectDir(safeProjectName);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error(`项目 "${safeProjectName}" 不存在`);
  }

  const targetDir = getDeviceVerificationDir(safeProjectName);
  if (source.type === "directory") {
    if (isSameFsPath(source.path, targetDir)) {
      return targetDir;
    }
    assertDirectoryDoesNotOverlap(source.path, targetDir);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  if (source.type === "zip") {
    extractZipToDir(source.path, targetDir);
  } else {
    fs.cpSync(source.path, targetDir, { recursive: true, force: true });
  }

  flattenSingleWrapperDir(targetDir);
  return targetDir;
}

function exportMarkedDeviceVerificationPoints(projectName: string, destDir: string) {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const outputDir = path.resolve(String(destDir || "").trim());
  if (!path.isAbsolute(outputDir) || !fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error("导出目录无效");
  }

  const localDir = getDeviceVerificationDir(safeProjectName);
  if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    throw new Error("请先加载设备验证图");
  }

  const markedFile = readDeviceMarkedPointFile(getDeviceMarkedPointFilePath(safeProjectName));
  const markedPointCodes = new Set(Object.keys(markedFile.records).map((code) => code.toLowerCase()));
  if (markedPointCodes.size === 0) throw new Error("暂无标记点位");

  const workbookPath = findPointWorkbookPath(collectFiles(localDir));
  if (!workbookPath) throw new Error("未找到点表.xlsx");

  const exportRows = readMarkedPointExportRows(fs.readFileSync(workbookPath), markedPointCodes);
  if (exportRows.length === 0) throw new Error("点表.xlsx 中未找到已标记点位");

  const fileName = uniqueFileName(outputDir, `${safeProjectName}_标记点位_${formatExportTime(new Date())}.xlsx`);
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, generateMarkedPointExcel(exportRows));

  return {
    success: true,
    filePath,
    fileName,
    exportedCount: exportRows.length,
  };
}

function exportDeviceVerificationCorrectionData(projectName: string, destDir: string) {
  const safeProjectName = String(projectName || "").trim();
  if (!safeProjectName) throw new Error("请先选择项目");

  const outputDir = path.resolve(String(destDir || "").trim());
  if (!path.isAbsolute(outputDir) || !fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error("导出目录无效");
  }

  const localDir = getDeviceVerificationDir(safeProjectName);
  if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
    throw new Error("请先加载设备验证图");
  }

  const correctionFile = readDeviceCorrectionFile(getDeviceCorrectionFilePath(safeProjectName));
  const correctionRecords = Object.values(correctionFile.records)
    .filter((record) => record.pointCode && record.rect);
  if (correctionRecords.length === 0) throw new Error("暂无纠偏数据");

  const files = collectFiles(localDir);
  const cruiseIdByPointCode = readCruiseIdMapFromExtendJson(files, localDir);
  const zip = new AdmZip();
  const usedEntryNames = new Set<string>();
  let exportedCount = 0;

  for (const record of correctionRecords) {
    const rect = normalizeCorrectionRect(record.rect);
    const cruiseId = cruiseIdByPointCode.get(record.pointCode.toLowerCase());
    if (!cruiseId) throw new Error(`extend.json 中未找到点位 ${record.pointCode} 的 cruise_id`);

    const payload = [{
      cp_id: cruiseId,
      target_point: correctionRectToTargetPoint(rect),
      target_rect: correctionRectToTargetRect(rect),
    }];
    const entryName = uniqueZipEntryName(usedEntryNames, `${cruiseId}.json`);
    zip.addFile(entryName, Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf-8"));
    exportedCount++;
  }

  const fileName = uniqueFileName(outputDir, `${safeProjectName}_纠偏数据_${formatExportTime(new Date())}.zip`);
  const filePath = path.join(outputDir, fileName);
  zip.writeZip(filePath);

  return {
    success: true,
    filePath,
    fileName,
    exportedCount,
  };
}

function getDeviceVerificationDir(projectName: string): string {
  return resolveProjectPath(projectName, OVERVIEW_DIR_NAME, DEVICE_VERIFY_DIR_NAME);
}

function getDeviceCorrectionFilePath(projectName: string): string {
  return resolveProjectPath(projectName, OVERVIEW_DIR_NAME, DEVICE_VERIFY_DIR_NAME, DEVICE_CORRECTION_FILE_NAME);
}

function getDeviceMarkedPointFilePath(projectName: string): string {
  return resolveProjectPath(projectName, OVERVIEW_DIR_NAME, DEVICE_VERIFY_DIR_NAME, DEVICE_MARKED_POINT_FILE_NAME);
}

function buildPackageResult(session: DeviceVerificationSession) {
  const nodes = [...session.nodes.values()];
  const pointNodes = nodes.filter((node) => node.kind === "point");
  const matchedImageCount = pointNodes.filter((node) => node.imagePath).length;
  return {
    success: true,
    hasData: true,
    sessionId: session.id,
    packageName: session.packageName,
    localDir: session.sourceDir,
    roots: session.rootIds.map((id) => toPublicNode(session, session.nodes.get(id)!, true)),
    expandedKeys: collectExpandedKeys(session),
    pointCount: pointNodes.length,
    imageCount: matchedImageCount,
  };
}

function readDeviceVerificationDirectory(sourceDir: string, packageName: string): DeviceVerificationSession {
  const files = collectFiles(sourceDir);
  const workbookPath = findPointWorkbookPath(files);
  if (!workbookPath) throw new Error("未找到点表.xlsx");

  const imageByPointCode = collectPointImages(files, sourceDir);

  const markedPointCodes = readMarkedPointCodes(path.join(sourceDir, DEVICE_MARKED_POINT_FILE_NAME));
  const { nodes, rootIds } = buildVerificationTree(fs.readFileSync(workbookPath), imageByPointCode, markedPointCodes);
  if (rootIds.length === 0) throw new Error("点表.xlsx 中未解析到有效的区域数据");

  return {
    id: randomUUID(),
    sourceDir,
    packageName,
    nodes,
    rootIds,
  };
}

function readMarkedPointExportRows(workbookBuffer: Buffer, markedPointCodes: Set<string>): MarkedPointExcelExportRow[] {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "sheet1") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("点表.xlsx 中没有可读取的工作表");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const headerIndex = findHeaderRowIndex(grid);
  if (headerIndex < 0) throw new Error("点表.xlsx 中未找到点位表头");

  const headers = grid[headerIndex].map(valueText);
  const rows: MarkedPointExcelExportRow[] = [];
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = mapRow(headers, grid[rowIndex]);
    const pointCode = firstValue(row, ["点位编码"]);
    if (!pointCode || !markedPointCodes.has(pointCode.toLowerCase())) continue;
    rows.push({
      pointName: firstValue(row, ["点位名称", "*点位名称"]),
      mainDeviceName: firstValue(row, ["主设备名称", "*主设备名称"]),
      bayName: firstValue(row, ["间隔名称", "*间隔名称"]),
    });
  }
  return rows;
}

function generateMarkedPointExcel(rows: MarkedPointExcelExportRow[]): Buffer {
  const headerRow = ["序号", "点位名称", "主设备名称", "间隔名称"];
  const dataRows = rows.map((row, index) => [
    index + 1,
    row.pointName,
    row.mainDeviceName,
    row.bayName,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const headerStyle = {
    alignment: { horizontal: "center", vertical: "center" },
    fill: { patternType: "solid", fgColor: { rgb: "E7E6E6" } },
    font: { name: "等线", sz: 11 },
  };
  for (let c = 0; c < headerRow.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[cellRef]) ws[cellRef] = { t: "s", v: headerRow[c] };
    ws[cellRef].s = headerStyle;
  }
  ws["!rows"] = [{ hpt: 24 }];
  ws["!cols"] = [
    { wch: 8 },
    { wch: 36.89 },
    { wch: 38.89 },
    { wch: 45.22 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function buildVerificationTree(
  workbookBuffer: Buffer,
  imageByPointCode: Map<string, ImageEntryInfo>,
  markedPointCodes: Set<string>,
): { nodes: Map<string, DeviceVerificationNodeRecord>; rootIds: string[] } {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === "sheet1") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("点表.xlsx 中没有可读取的工作表");

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
  const headerIndex = findHeaderRowIndex(grid);
  if (headerIndex < 0) throw new Error("点表.xlsx 中未找到点位表头");

  const headers = grid[headerIndex].map(valueText);
  const nodes = new Map<string, DeviceVerificationNodeRecord>();
  const rootIds: string[] = [];
  const nodeByIdentity = new Map<string, string>();
  let sequence = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = mapRow(headers, grid[rowIndex]);
    let parentId: string | null = null;

    for (const level of hierarchyColumns) {
      const title = firstValue(row, level.names);
      const code = firstValue(row, level.codes);
      if (!title && !code) break;

      const identityValue = code ? `code:${code}` : `name:${title}`;
      const identity = `${parentId || "root"}\u0000${level.kind}\u0000${identityValue}`;
      let nodeId = nodeByIdentity.get(identity);

      if (!nodeId) {
        nodeId = `device-verify:${level.kind}:${++sequence}`;
        const image = level.kind === "point" && code
          ? imageByPointCode.get(code.toLowerCase())
          : undefined;
        nodes.set(nodeId, {
          id: nodeId,
          title: title || code,
          code,
          kind: level.kind,
          parentId,
          childrenIds: [],
          marked: level.kind === "point" && code ? markedPointCodes.has(code.toLowerCase()) : false,
          imagePath: image?.filePath,
          imageMime: image?.mime,
        });
        nodeByIdentity.set(identity, nodeId);

        if (parentId) {
          nodes.get(parentId)!.childrenIds.push(nodeId);
        } else {
          rootIds.push(nodeId);
        }
      } else {
        const existing = nodes.get(nodeId)!;
        if (title && existing.title === existing.code) existing.title = title;
        if (level.kind === "point" && code && !existing.imagePath) {
          const image = imageByPointCode.get(code.toLowerCase());
          existing.imagePath = image?.filePath;
          existing.imageMime = image?.mime;
        }
      }

      parentId = nodeId;
    }
  }

  return { nodes, rootIds };
}

function collectPointImages(files: string[], sourceDir: string): Map<string, ImageEntryInfo> {
  const imageByPointCode = new Map<string, ImageEntryInfo>();
  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath).replace(/\\/g, "/");
    const segments = relativePath.split("/").filter(Boolean);
    if (!segments.slice(0, -1).some((segment) => segment.toLowerCase() === "img")) continue;

    const ext = path.extname(filePath).toLowerCase();
    const mime = imageMimeType(ext);
    if (!mime) continue;
    const pointCode = path.basename(filePath, ext).trim();
    if (!pointCode) continue;
    imageByPointCode.set(pointCode.toLowerCase(), { filePath, mime });
  }
  return imageByPointCode;
}

function readCruiseIdMapFromExtendJson(files: string[], sourceDir: string): Map<string, string> {
  const extendPath = findExtendJsonPath(files, sourceDir);
  if (!extendPath) throw new Error("未找到 extend.json");

  const parsed = JSON.parse(fs.readFileSync(extendPath, "utf-8"));
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.records)
      ? parsed.records
      : [];
  if (rows.length === 0) throw new Error("extend.json 中未找到点位映射");

  const cruiseIdByPointCode = new Map<string, string>();
  for (const row of rows) {
    const pointCode = valueText(row?.point_code ?? row?.pointCode);
    const cruiseId = valueText(row?.cruise_id ?? row?.cruiseId);
    if (!pointCode || !cruiseId) continue;
    cruiseIdByPointCode.set(pointCode.toLowerCase(), cruiseId);
  }

  if (cruiseIdByPointCode.size === 0) throw new Error("extend.json 中未找到有效 cruise_id");
  return cruiseIdByPointCode;
}

function findExtendJsonPath(files: string[], sourceDir: string): string | undefined {
  const candidates = files.filter((filePath) => path.basename(filePath).toLowerCase() === "extend.json");
  return candidates.sort((left, right) => {
    const leftDepth = path.relative(sourceDir, left).split(path.sep).length;
    const rightDepth = path.relative(sourceDir, right).split(path.sep).length;
    return leftDepth - rightDepth;
  })[0];
}

function findPointWorkbookPath(files: string[]): string | undefined {
  const workbooks = files.filter((filePath) => {
    const baseName = path.basename(filePath);
    return /\.xlsx$/i.test(baseName) && !baseName.startsWith("~$");
  });
  return workbooks.find((filePath) => path.basename(filePath) === "点表.xlsx") || workbooks[0];
}

function findHeaderRowIndex(grid: unknown[][]): number {
  return grid.slice(0, 10).findIndex((row) => {
    const headers = new Set(row.map(valueText));
    const hasPoint = headers.has("点位编码") || headers.has("点位名称") || headers.has("*点位名称");
    const hasRegion = headers.has("区域") || headers.has("*区域") || headers.has("区域编码");
    return hasPoint && hasRegion;
  });
}

function mapRow(headers: string[], values: unknown[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    if (header) row[header] = valueText(values[index]);
  }
  return row;
}

function firstValue(row: Record<string, string>, headers: string[]): string {
  for (const header of headers) {
    const value = valueText(row[header]);
    if (value) return value;
  }
  return "";
}

function toPublicNode(session: DeviceVerificationSession, node: DeviceVerificationNodeRecord, includeChildren: boolean) {
  return {
    key: node.id,
    title: node.title,
    code: node.code,
    kind: node.kind,
    isLeaf: node.childrenIds.length === 0,
    hasImage: Boolean(node.imagePath),
    marked: Boolean(node.marked),
    ...(includeChildren && node.childrenIds.length > 0
      ? { children: node.childrenIds.map((id) => toPublicNode(session, session.nodes.get(id)!, true)) }
      : {}),
  };
}

function collectExpandedKeys(session: DeviceVerificationSession): string[] {
  const keys: string[] = [];
  const walk = (nodeId: string) => {
    const node = session.nodes.get(nodeId);
    if (!node) return;
    if (node.childrenIds.length > 0) keys.push(node.id);
    node.childrenIds.forEach(walk);
  };
  session.rootIds.forEach(walk);
  return keys;
}

function getActiveSession(sessionId: string): DeviceVerificationSession {
  if (!activeSession || activeSession.id !== String(sessionId || "")) {
    throw new Error("设备验证图已失效，请重新加载");
  }
  return activeSession;
}

function validatePackageSource(sourcePath: string): DeviceVerificationSource {
  const rawPath = String(sourcePath || "").trim();
  if (!rawPath) throw new Error("导入路径无效");
  const resolved = path.resolve(rawPath);
  if (!path.isAbsolute(resolved)) throw new Error("导入路径无效");
  if (!fs.existsSync(resolved)) throw new Error("导入路径不存在");

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) return { path: resolved, type: "directory" };
  if (stat.isFile() && path.extname(resolved).toLowerCase() === ".zip") return { path: resolved, type: "zip" };
  throw new Error("请选择 ZIP 压缩包或设备验证图目录");
}

function assertDirectoryDoesNotOverlap(sourceDir: string, targetDir: string): void {
  const source = path.resolve(sourceDir);
  const target = path.resolve(targetDir);
  if (isPathInside(source, target) || isPathInside(target, source)) {
    throw new Error("导入目录不能是当前项目的设备验证图目录或其上级/子级目录");
  }
}

function isSameFsPath(leftPath: string, rightPath: string): boolean {
  const left = path.resolve(leftPath);
  const right = path.resolve(rightPath);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function uniqueFileName(dir: string, preferredName: string): string {
  const ext = path.extname(preferredName);
  const base = path.basename(preferredName, ext);
  let fileName = preferredName;
  let index = 1;
  while (fs.existsSync(path.join(dir, fileName))) {
    fileName = `${base}_${index}${ext}`;
    index++;
  }
  return fileName;
}

function formatExportTime(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}

function extractZipToDir(zipPath: string, targetDir: string): void {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const entryName = normalizeArchiveEntryName(entry.entryName);
    if (!entryName) continue;
    if (entryName.split("/").some((segment) => segment === ".." || /[<>:"|?*\x00-\x1F]/.test(segment))) {
      throw new Error(`压缩包包含非法路径：${entry.entryName}`);
    }
    const resolved = path.resolve(targetDir, entryName);
    if (!isPathInside(targetDir, resolved)) {
      throw new Error(`压缩包包含越界路径：${entry.entryName}`);
    }
  }
  zip.extractAllTo(targetDir, true);
}

function flattenSingleWrapperDir(dir: string): void {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter((item) => !item.name.startsWith(".") && item.name !== "__MACOSX");
  const directories = items.filter((item) => item.isDirectory());
  const files = items.filter((item) => item.isFile());
  if (files.length > 0 || directories.length !== 1) return;

  const wrapperDir = path.join(dir, directories[0].name);
  for (const item of fs.readdirSync(wrapperDir, { withFileTypes: true })) {
    const source = path.join(wrapperDir, item.name);
    const target = path.join(dir, item.name);
    fs.cpSync(source, target, { recursive: true, force: true });
  }
  fs.rmSync(wrapperDir, { recursive: true, force: true });
}

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function readMarkedPointCodes(filePath: string): Set<string> {
  const file = readDeviceMarkedPointFile(filePath);
  return new Set(Object.keys(file.records).map((code) => code.toLowerCase()));
}

function readDeviceMarkedPointFile(filePath: string): DeviceMarkedPointFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: "", records: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const records: Record<string, DeviceMarkedPointRecord> = {};
  if (Array.isArray(parsed?.records)) {
    for (const item of parsed.records) {
      const record = normalizeMarkedPointRecord(item);
      if (record) records[record.pointCode] = record;
    }
  } else if (parsed?.records && typeof parsed.records === "object") {
    for (const item of Object.values(parsed.records)) {
      const record = normalizeMarkedPointRecord(item);
      if (record) records[record.pointCode] = record;
    }
  }

  return {
    version: 1,
    updatedAt: valueText(parsed?.updatedAt),
    records,
  };
}

function writeDeviceMarkedPointFile(filePath: string, file: DeviceMarkedPointFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

function normalizeMarkedPointRecord(value: any): DeviceMarkedPointRecord | null {
  const pointCode = valueText(value?.pointCode ?? value?.code);
  if (!pointCode) return null;
  return {
    pointCode,
    pointName: valueText(value?.pointName ?? value?.name),
    updatedAt: valueText(value?.updatedAt),
  };
}

function updateActiveSessionMarked(pointCode: string, marked: boolean): void {
  const code = valueText(pointCode).toLowerCase();
  if (!code || !activeSession) return;
  for (const node of activeSession.nodes.values()) {
    if (node.kind === "point" && node.code.toLowerCase() === code) {
      node.marked = marked;
    }
  }
}

function readDeviceCorrectionFile(filePath: string): DeviceCorrectionFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: "", records: {} };
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const records: Record<string, DeviceCorrectionRecord> = {};
  if (Array.isArray(parsed?.records)) {
    for (const item of parsed.records) {
      const record = normalizeCorrectionRecord(item);
      if (record) records[record.pointCode] = record;
    }
  } else if (parsed?.records && typeof parsed.records === "object") {
    for (const item of Object.values(parsed.records)) {
      const record = normalizeCorrectionRecord(item);
      if (record) records[record.pointCode] = record;
    }
  }

  return {
    version: 1,
    updatedAt: valueText(parsed?.updatedAt),
    records,
  };
}

function writeDeviceCorrectionFile(filePath: string, file: DeviceCorrectionFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

function normalizeCorrectionRecord(value: any): DeviceCorrectionRecord | null {
  const pointCode = valueText(value?.pointCode);
  if (!pointCode) return null;
  try {
    return {
      pointCode,
      pointName: valueText(value?.pointName),
      rect: normalizeCorrectionRect(value?.rect),
      updatedAt: valueText(value?.updatedAt),
    };
  } catch {
    return null;
  }
}

function normalizeCorrectionRect(value: any): DeviceCorrectionRect {
  const imageWidth = Math.max(1, Math.round(Number(value?.imageWidth) || 0));
  const imageHeight = Math.max(1, Math.round(Number(value?.imageHeight) || 0));
  const maxSize = Math.max(1, Math.min(imageWidth, imageHeight));
  const size = Math.min(maxSize, Math.max(1, Number(value?.size) || 0));
  const x = Math.min(Math.max(0, Number(value?.x) || 0), Math.max(0, imageWidth - size));
  const y = Math.min(Math.max(0, Number(value?.y) || 0), Math.max(0, imageHeight - size));

  return {
    x: Math.round(x),
    y: Math.round(y),
    size: Math.round(size),
    imageWidth,
    imageHeight,
  };
}

function correctionRectToTargetPoint(rect: DeviceCorrectionRect): number[] {
  return [
    clamp01((rect.x + rect.size / 2) / rect.imageWidth),
    clamp01((rect.y + rect.size / 2) / rect.imageHeight),
  ];
}

function correctionRectToTargetRect(rect: DeviceCorrectionRect): number[][] {
  const x1 = clamp01(rect.x / rect.imageWidth);
  const y1 = clamp01(rect.y / rect.imageHeight);
  const x2 = clamp01((rect.x + rect.size) / rect.imageWidth);
  const y2 = clamp01((rect.y + rect.size) / rect.imageHeight);
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

function sanitizeZipBaseName(value: string): string {
  const text = valueText(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return text || "correction";
}

function uniqueZipEntryName(usedNames: Set<string>, preferredName: string): string {
  const ext = path.extname(preferredName);
  const base = path.basename(preferredName, ext);
  let name = `${sanitizeZipBaseName(base)}${ext || ".json"}`;
  let index = 1;
  while (usedNames.has(name.toLowerCase())) {
    name = `${sanitizeZipBaseName(base)}_${index}${ext || ".json"}`;
    index++;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

function normalizeArchiveEntryName(entryName: string): string {
  return String(entryName || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
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
    case ".gif":
      return "image/gif";
    default:
      return "";
  }
}

function valueText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}
