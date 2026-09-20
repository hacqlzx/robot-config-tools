import * as XLSX from "xlsx";
import {
  INSPECTION_POINT_LENGTH,
  type InspectionPointItem,
} from "../hooks/drawing/drawing-schema";

type Vec3 = [number, number, number];

type ImportField =
  | "pointName"
  | "pointCode"
  | "x"
  | "y"
  | "z"
  | "directionX"
  | "directionY"
  | "directionZ";

export type InspectionPointBindingIssueType = "duplicate" | "missing";

export interface InspectionPointBindingIssue {
  type: InspectionPointBindingIssueType;
  pointCode: string;
  pointName: string;
  message: string;
}

export interface InspectionPointBindingValidation {
  issuesByItemId: Map<string, InspectionPointBindingIssue[]>;
  duplicates: Array<{ pointCode: string; pointName: string; bayCode: string; bayName: string; count: number }>;
  missingPoints: Array<{ pointCode: string; pointName: string; bayCode: string; bayName: string }>;
}

export interface InspectionPointCatalogItem {
  pointCode: unknown;
  pointName?: unknown;
  bayCode?: unknown;
  bayName?: unknown;
}

const HEADER_FIELDS = new Map<string, ImportField>([
  ["设备点位名称", "pointName"],
  ["点位名称", "pointName"],
  ["设备点位id", "pointCode"],
  ["点位id", "pointCode"],
  ["设备点位编码", "pointCode"],
  ["点位编码", "pointCode"],
  ["x", "x"],
  ["坐标x", "x"],
  ["y", "y"],
  ["坐标y", "y"],
  ["z", "z"],
  ["坐标z", "z"],
  ["法向量x", "directionX"],
  ["方向x", "directionX"],
  ["nx", "directionX"],
  ["法向量y", "directionY"],
  ["方向y", "directionY"],
  ["ny", "directionY"],
  ["法向量z", "directionZ"],
  ["方向z", "directionZ"],
  ["nz", "directionZ"],
]);

const REQUIRED_FIELDS: ImportField[] = [
  "pointCode",
  "x",
  "y",
  "z",
  "directionX",
  "directionY",
  "directionZ",
];

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeInspectionPointCode(value: unknown): string {
  return textValue(value).toLowerCase();
}

function normalizeHeader(value: unknown): string {
  return textValue(value).replace(/[\s_]+/g, "").toLowerCase();
}

function createInspectionPointId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `inspection:import:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function finiteNumber(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDirection(value: Vec3): Vec3 | null {
  const length = Math.hypot(...value);
  if (length <= 1e-8) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function findHeader(rows: unknown[][]): { rowIndex: number; columns: Map<ImportField, number> } | null {
  let best: { rowIndex: number; columns: Map<ImportField, number> } | null = null;
  const maxHeaderRows = Math.min(rows.length, 10);
  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    const columns = new Map<ImportField, number>();
    rows[rowIndex].forEach((cell, columnIndex) => {
      const field = HEADER_FIELDS.get(normalizeHeader(cell));
      if (field && !columns.has(field)) columns.set(field, columnIndex);
    });
    if (!best || columns.size > best.columns.size) best = { rowIndex, columns };
  }
  return best && REQUIRED_FIELDS.every((field) => best!.columns.has(field)) ? best : null;
}

/** 解析“巡检点导出”生成的 Excel，也兼容常用的点位编码/坐标/方向列名。 */
export async function parseInspectionPointExcel(file: File): Promise<InspectionPointItem[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Excel 中没有工作表");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  const header = findHeader(rows);
  if (!header) {
    throw new Error("未找到巡检点表头，请使用巡检点导出的 Excel 文件");
  }

  const items: InspectionPointItem[] = [];
  const errors: string[] = [];
  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row.some((value) => textValue(value))) continue;
    const value = (field: ImportField) => row[header.columns.get(field) ?? -1];
    const pointCode = textValue(value("pointCode"));
    const pointName = textValue(value("pointName"));
    const positionValues: [number | null, number | null, number | null] = [
      finiteNumber(value("x")),
      finiteNumber(value("y")),
      finiteNumber(value("z")),
    ];
    const directionValues: [number | null, number | null, number | null] = [
      finiteNumber(value("directionX")),
      finiteNumber(value("directionY")),
      finiteNumber(value("directionZ")),
    ];
    const excelRow = rowIndex + 1;
    if (!pointCode) {
      errors.push(`第 ${excelRow} 行缺少设备点位ID`);
      continue;
    }
    if (positionValues.some((number) => number === null)) {
      errors.push(`第 ${excelRow} 行坐标无效`);
      continue;
    }
    if (directionValues.some((number) => number === null)) {
      errors.push(`第 ${excelRow} 行法向量无效`);
      continue;
    }
    const position = positionValues as Vec3;
    const direction = normalizeDirection(directionValues as Vec3);
    if (!direction) {
      errors.push(`第 ${excelRow} 行法向量不能为零向量`);
      continue;
    }
    items.push({
      id: createInspectionPointId(),
      name: pointName || `巡检点 ${items.length + 1}`,
      pointCode,
      pointName: pointName || undefined,
      position,
      direction,
      length: INSPECTION_POINT_LENGTH.default,
      updatedAt: new Date().toISOString(),
    });
  }

  if (errors.length > 0) {
    const details = errors.slice(0, 5).join("；");
    const omitted = errors.length > 5 ? `；另有 ${errors.length - 5} 行错误` : "";
    throw new Error(`${details}${omitted}`);
  }
  if (items.length === 0) throw new Error("Excel 中没有可导入的巡检点");
  return items;
}

/** 校验单张地图内的重复绑定，以及绑定点位在当前项目点表中的存在性。 */
export function validateInspectionPointBindings(
  items: InspectionPointItem[],
  existingPoints: Iterable<InspectionPointCatalogItem>,
  validateExistence = true,
): InspectionPointBindingValidation {
  const pointCatalogByCode = new Map<string, { pointName: string; bayCode: string; bayName: string }>();
  for (const point of existingPoints) {
    const code = normalizeInspectionPointCode(point.pointCode);
    if (!code) continue;
    pointCatalogByCode.set(code, {
      pointName: textValue(point.pointName),
      bayCode: textValue(point.bayCode),
      bayName: textValue(point.bayName),
    });
  }
  const itemsByCode = new Map<string, InspectionPointItem[]>();
  items.forEach((item) => {
    const code = normalizeInspectionPointCode(item.pointCode);
    if (!code) return;
    const entries = itemsByCode.get(code) ?? [];
    entries.push(item);
    itemsByCode.set(code, entries);
  });

  const issuesByItemId = new Map<string, InspectionPointBindingIssue[]>();
  const duplicates: InspectionPointBindingValidation["duplicates"] = [];
  const missingPoints: InspectionPointBindingValidation["missingPoints"] = [];
  itemsByCode.forEach((entries, normalizedCode) => {
    const catalogPoint = pointCatalogByCode.get(normalizedCode);
    const displayCode = textValue(entries[0].pointCode);
    const displayName = textValue(entries[0].pointName)
      || catalogPoint?.pointName
      || textValue(entries[0].name)
      || "未命名点位";
    const bayCode = catalogPoint?.bayCode || "";
    const bayName = catalogPoint?.bayName || (catalogPoint ? "未分配间隔" : "未匹配间隔");
    const issues: InspectionPointBindingIssue[] = [];
    if (entries.length > 1) {
      duplicates.push({ pointCode: displayCode, pointName: displayName, bayCode, bayName, count: entries.length });
      issues.push({
        type: "duplicate",
        pointCode: displayCode,
        pointName: displayName,
        message: `点位“${displayName}”重复绑定了 ${entries.length} 个巡检点`,
      });
    }
    if (validateExistence && !catalogPoint) {
      missingPoints.push({ pointCode: displayCode, pointName: displayName, bayCode, bayName });
      issues.push({
        type: "missing",
        pointCode: displayCode,
        pointName: displayName,
        message: `绑定点位“${displayName}”在当前项目点表中不存在`,
      });
    }
    if (issues.length > 0) {
      entries.forEach((item) => issuesByItemId.set(item.id, [...issues]));
    }
  });

  return {
    issuesByItemId,
    duplicates: duplicates.sort((left, right) => left.pointName.localeCompare(right.pointName, "zh-Hans-CN", { numeric: true })),
    missingPoints: missingPoints.sort((left, right) => left.pointName.localeCompare(right.pointName, "zh-Hans-CN", { numeric: true })),
  };
}
