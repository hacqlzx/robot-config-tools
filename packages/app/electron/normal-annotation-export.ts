import { withProjectDatabase } from "./project-core/project-database";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx-js-style";
import { DevicePointRepo, getDatabase } from "@robot/database";

interface NormalAnnotationExportRecord {
  name?: unknown;
  pointCode?: unknown;
  pointName?: unknown;
  origin?: unknown;
  position?: unknown;
  direction?: unknown;
  diameter?: unknown;
}

interface NormalAnnotationExportRow {
  pointName: string;
  pointCode: string;
  origin: [number, number, number];
  direction: [number, number, number];
  diameter: number | null;
  recognitionType: string;
}

interface PreparedNormalAnnotationExport {
  rows: NormalAnnotationExportRow[];
}

interface AnnotationExportOptions {
  itemName: "法线" | "巡检点";
  collectionName: "法线标注" | "巡检点标注";
  positionField: "origin" | "position";
  requireDiameter: boolean;
}

const EXPORT_HEADERS = [
  "编号", "采集类型", "识别类型", "设备点位名称", "设备点位ID", "X", "Y", "Z",
  "法向量x", "法向量y", "法向量z", "目标直径",
];

// 法线描述可见光相机的观察方向，导出格式与标注 Excel 模板保持一致。
const COLLECT_TYPE = "可见光";
const RECOGNITION_LABELS: Record<string, string> = {
  meter_read: "表计",
  position_state: "位置状态",
  appearance: "外观",
  sound: "声音",
  ir_temp: "红外",
  visible: "可见光",
  表计读取: "表计",
  位置状态识别: "位置状态",
  设备外观查看: "外观",
  声音检测: "声音",
  红外测温: "红外",
  可见光查看: "可见光",
};

function prepareNormalAnnotationExportInternal(
  projectName: string,
  data: unknown,
): PreparedNormalAnnotationExport {
  return prepareAnnotationExport(projectName, data, {
    itemName: "法线",
    collectionName: "法线标注",
    positionField: "origin",
    requireDiameter: true,
  });
}

function prepareInspectionPointExportInternal(
  projectName: string,
  data: unknown,
): PreparedNormalAnnotationExport {
  return prepareAnnotationExport(projectName, data, {
    itemName: "巡检点",
    collectionName: "巡检点标注",
    positionField: "position",
    requireDiameter: false,
  });
}

function prepareAnnotationExport(
  projectName: string,
  data: unknown,
  options: AnnotationExportOptions,
): PreparedNormalAnnotationExport {
  const safeProjectName = textValue(projectName);
  if (!safeProjectName) throw new Error("请先选择项目");

  const records = Array.isArray(data) ? data : [];
  if (records.length === 0) throw new Error(`暂无可导出的${options.collectionName}`);

  const pointRepo = new DevicePointRepo(getDatabase());
  const points = pointRepo.list(safeProjectName);
  const pointByCode = new Map(
    points
      .map((point) => [normalizePointCode(point.pointCode), point] as const)
      .filter(([code]) => !!code),
  );
  const seenPointCodes = new Map<string, number>();
  const rows: NormalAnnotationExportRow[] = [];
  const unboundNormals: string[] = [];

  records.forEach((value, index) => {
    const record = asRecord(value);
    const itemLabel = textValue(record?.name) || `第 ${index + 1} 个${options.itemName}`;
    const pointCode = textValue(record?.pointCode);
    if (!pointCode) {
      unboundNormals.push(itemLabel);
      return;
    }

    const pointCodeKey = normalizePointCode(pointCode);
    const firstIndex = seenPointCodes.get(pointCodeKey);
    if (firstIndex !== undefined) {
      throw new Error(`点位“${pointCode}”已绑定多个${options.itemName}（第 ${firstIndex + 1} 个和第 ${index + 1} 个）`);
    }
    seenPointCodes.set(pointCodeKey, index);

    const point = pointByCode.get(pointCodeKey);
    if (!point) throw new Error(`${options.itemName}“${itemLabel}”绑定的点位不存在：${pointCode}`);

    const origin = numberTuple(options.positionField === "origin" ? record?.origin : record?.position);
    if (!origin) throw new Error(`${options.itemName}“${itemLabel}”的坐标无效`);
    const direction = numberTuple(record?.direction);
    if (!direction) throw new Error(`${options.itemName}“${itemLabel}”的法向量无效`);
    const diameterValue = Number(record?.diameter);
    if (options.requireDiameter && (!Number.isFinite(diameterValue) || diameterValue <= 0)) {
      throw new Error(`${options.itemName}“${itemLabel}”的目标直径无效`);
    }

    rows.push({
      pointName: textValue(point.pointName) || textValue(record?.pointName) || pointCode,
      pointCode: textValue(point.pointCode) || pointCode,
      origin,
      direction,
      diameter: options.requireDiameter ? diameterValue : null,
      recognitionType: displayRecognitionType(point.recognitionTypeList),
    });
  });

  if (unboundNormals.length > 0) {
    throw new Error(`请先为以下${options.itemName}绑定点位：${unboundNormals.join("、")}`);
  }
  if (rows.length === 0) throw new Error(`暂无可导出的${options.collectionName}`);
  return { rows };
}

function exportNormalAnnotationExcelInternal(
  projectName: string,
  destDir: string,
  data: unknown,
) {
  const prepared = prepareNormalAnnotationExportInternal(projectName, data);
  return exportAnnotationExcel(destDir, prepared, "法线标注");
}

function exportInspectionPointExcelInternal(
  projectName: string,
  destDir: string,
  data: unknown,
) {
  const prepared = prepareInspectionPointExportInternal(projectName, data);
  return exportAnnotationExcel(destDir, prepared, "巡检点标注");
}

function exportAnnotationExcel(
  destDir: string,
  prepared: PreparedNormalAnnotationExport,
  filePrefix: string,
) {
  const outputDir = path.resolve(String(destDir || "").trim());
  if (!path.isAbsolute(outputDir) || !fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    throw new Error("导出目录无效");
  }

  const fileName = uniqueFileName(outputDir, `${filePrefix}_${formatExportTime(new Date())}.xlsx`);
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, generateAnnotationExcel(prepared.rows));
  return { success: true, filePath, fileName, exportedCount: prepared.rows.length };
}

function generateAnnotationExcel(rows: NormalAnnotationExportRow[]): Buffer {
  const dataRows = rows.map((row, index) => [
    index + 1,
    COLLECT_TYPE,
    row.recognitionType,
    row.pointName,
    row.pointCode,
    row.origin[0], row.origin[1], row.origin[2],
    row.direction[0], row.direction[1], row.direction[2],
    row.diameter,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...dataRows]);
  const headerStyle = {
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: "E7E6E6" } },
    font: { name: "等线", sz: 11, bold: true },
  };
  for (let column = 0; column < EXPORT_HEADERS.length; column += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: column });
    worksheet[cellRef].s = headerStyle;
  }
  worksheet["!rows"] = [{ hpt: 24 }];
  worksheet["!cols"] = [
    { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 40 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return Buffer.from(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

function displayRecognitionType(value: unknown): string {
  const labels = textValue(value)
    .split(",")
    .map((item) => RECOGNITION_LABELS[item.trim()] || item.trim())
    .filter(Boolean);
  return Array.from(new Set(labels)).join("、");
}

function asRecord(value: unknown): NormalAnnotationExportRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as NormalAnnotationExportRecord
    : null;
}

function numberTuple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const tuple: [number, number, number] = [Number(value[0]), Number(value[1]), Number(value[2])];
  return tuple.every(Number.isFinite) ? tuple : null;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function normalizePointCode(value: unknown): string {
  return textValue(value).toLowerCase();
}

function uniqueFileName(dir: string, preferredName: string): string {
  const parsed = path.parse(preferredName);
  let candidate = preferredName;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function formatExportTime(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

export function prepareNormalAnnotationExport(projectName: string, data: unknown) {
  return withProjectDatabase(projectName, () => prepareNormalAnnotationExportInternal(projectName, data));
}

export function prepareInspectionPointExport(projectName: string, data: unknown) {
  return withProjectDatabase(projectName, () => prepareInspectionPointExportInternal(projectName, data));
}

export function exportNormalAnnotationExcel(projectName: string, destDir: string, data: unknown) {
  return withProjectDatabase(projectName, () => exportNormalAnnotationExcelInternal(projectName, destDir, data));
}

export function exportInspectionPointExcel(projectName: string, destDir: string, data: unknown) {
  return withProjectDatabase(projectName, () => exportInspectionPointExcelInternal(projectName, destDir, data));
}
