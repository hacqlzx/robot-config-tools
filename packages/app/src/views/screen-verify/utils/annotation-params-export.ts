import { findSelectedAnnotation } from "./annotation-utils";
import { findTargetTypeOption } from "./constants";
import { getCabinetRecordKey } from "./tree-utils";
import { sortTableRowsByAnnotationRows } from "./recognition-workflow";
import type { CabinetPointRow, CabinetSinglePoint, ComponentAnnotations, ImageRect } from "../types";

const MATCH_TYPE_ZERO_ALGORITHM_TYPES = new Set([5, 13, 23]);
const RECT_OFFSET = 100;
const SCORE_THRESH = 0.25;

export interface CabinetAnnotationParamsExportInput {
  projectName: string;
  records: CabinetImagePackageRecord[];
  annotationsByComponent: Record<string, ComponentAnnotations>;
  ocrRowsByComponent: Record<string, CabinetPointRow[]>;
  singlePointsByComponent: Record<string, CabinetSinglePoint[]>;
  pointVerifiedByComponent: Record<string, boolean>;
}

export interface CabinetAnnotationParamsExportResult {
  data: CabinetAnnotationParamsJson;
  pointCount: number;
  matchCount: number;
  errors: string[];
}

export interface CabinetAnnotationParamsJson {
  detTypeInfo: Array<{
    cruise_id: string;
    det_type: number;
  }>;
  detectInfo: unknown[];
  matchInfo: CabinetAnnotationMatchInfo[];
}

interface CabinetAnnotationMatchInfo {
  classid_roi?: string;
  cruise_ids: string[];
  image_path: string;
  match_type: number;
  rect: string;
  rect_loc_classes?: string;
  score_thresh?: number;
}

interface ExportPointItem {
  record: CabinetImagePackageRecord;
  recordKey: string;
  order: number;
  name: string;
  label: string;
  labelDesc: string;
  algorithmType: number;
  matchType: number;
  assId: string;
  cruiseId: string;
  targetRect: ImageRect;
  groupKey: string;
}

interface ExportPointGroup {
  record: CabinetImagePackageRecord;
  items: ExportPointItem[];
  matchType: number;
  rect: RectBox;
  order: number;
}

interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 生成屏柜标注参数 detector.json。
 *
 * 输出结构和后台约定保持一致：detTypeInfo 写巡检点和算法类型，
 * detectInfo 暂时置空，matchInfo 按图片、标准部件组、设备行聚合生成对位参数。
 */
export function buildCabinetAnnotationParamsExport(input: CabinetAnnotationParamsExportInput): CabinetAnnotationParamsExportResult {
  const errors: string[] = [];
  const points = collectExportPointItems(input, errors);
  assignCruiseIds(points, errors);
  const groups = buildExportPointGroups(points);

  const data: CabinetAnnotationParamsJson = {
    detTypeInfo: points.map((point) => ({
      cruise_id: point.cruiseId,
      det_type: point.algorithmType,
    })),
    detectInfo: [],
    matchInfo: groups.map(buildMatchInfo),
  };

  if (!points.length) errors.push("暂无可导出的标注点位");
  return {
    data,
    pointCount: points.length,
    matchCount: groups.length,
    errors: unique(errors),
  };
}

/**
 * 收集所有可导出的点位。
 * 保存中的中间态允许存在空名称，但导出时会在这里做强校验。
 */
function collectExportPointItems(input: CabinetAnnotationParamsExportInput, errors: string[]): ExportPointItem[] {
  const points: ExportPointItem[] = [];
  input.records.forEach((record, recordIndex) => {
    const recordKey = getCabinetRecordKey(record);
    if (!input.pointVerifiedByComponent[recordKey]) return;
    const annotations = input.annotationsByComponent[recordKey] || emptyAnnotations();
    const ocrRows = input.ocrRowsByComponent[recordKey] || [];
    const singlePoints = input.singlePointsByComponent[recordKey] || [];
    if (!ocrRows.length && !singlePoints.length) return;

    const assId = normalizeAssId(record.calibrationId);
    if (!record.stationName.trim()) {
      errors.push(`${formatRecordName(record)} 缺少厂站名称，无法生成 image_path`);
    }
    if (!assId) {
      errors.push(`${formatRecordName(record)} 缺少数字标定id，无法生成 cruise_id 和 image_path`);
    }

    const singlePointById = new Map(singlePoints.map((point) => [point.id, point]));
    const rows = sortTableRowsByAnnotationRows([
      ...ocrRows.map((row) => ({ ...row, source: row.source || "ocr" as const })),
      ...singlePoints.map((point) => ({
        key: point.id,
        index: 0,
        name: point.pointName,
        type: point.recognitionLabelDesc || point.recognitionType,
        source: "single" as const,
        boundRectId: point.boundRectId,
        boundRectTool: point.boundRectTool,
        recognitionLabel: point.recognitionLabel,
        recognitionLabelDesc: point.recognitionLabelDesc,
        deviceName: point.deviceName,
      })),
    ], annotations);

    rows.forEach((row, rowIndex) => {
      const item = buildExportPointItem({
        record,
        recordKey,
        recordIndex,
        row,
        rowIndex,
        annotations,
        assId,
        singlePoint: singlePointById.get(row.key),
        errors,
      });
      if (item) points.push(item);
    });
  });
  return points;
}

/**
 * 把右侧点位表行转换成导出点位项。
 * 这里会解析算法类型、查找目标框，并记录生成 detector.json 所需的排序上下文。
 */
function buildExportPointItem(options: {
  record: CabinetImagePackageRecord;
  recordKey: string;
  recordIndex: number;
  row: CabinetPointRow;
  rowIndex: number;
  annotations: ComponentAnnotations;
  assId: string;
  singlePoint?: CabinetSinglePoint;
  errors: string[];
}): ExportPointItem | null {
  const { record, recordKey, recordIndex, row, rowIndex, annotations, assId, singlePoint, errors } = options;
  const rowName = String(row.name || "").trim();
  const rowLabel = String(row.recognitionLabel || "").trim();
  const rowLabelDesc = String(row.recognitionLabelDesc || row.type || "").trim();
  const typeOption = findTargetTypeOption(rowLabel, rowLabelDesc);
  const label = rowLabel || typeOption?.value || "";
  const labelDesc = rowLabelDesc || typeOption?.label || label;
  const targetRect = findPointTargetRect(row, annotations, singlePoint);
  const displayPrefix = `${formatRecordName(record)} 第 ${rowIndex + 1} 条`;

  if (!rowName) errors.push(`${displayPrefix} 点位名称为空`);
  if (!label) errors.push(`${displayPrefix} 目标类型为空`);
  if (!typeOption) errors.push(`${displayPrefix} 目标类型未匹配算法类型：${rowLabel || rowLabelDesc || "空"}`);
  if (!targetRect) errors.push(`${displayPrefix} 未绑定设备框或外观框`);
  if (targetRect && (targetRect.w <= 0 || targetRect.h <= 0)) errors.push(`${displayPrefix} 目标框尺寸无效`);

  if (!rowName || !label || !typeOption || !targetRect || !assId) return null;

  return {
    record,
    recordKey,
    order: recordIndex * 100000 + rowIndex,
    name: rowName,
    label,
    labelDesc,
    algorithmType: typeOption.algorithmType,
    matchType: getMatchType(typeOption.algorithmType),
    assId,
    cruiseId: "",
    targetRect: normalizeRect(targetRect),
    groupKey: getPointGroupKey(targetRect, annotations),
  };
}

/**
 * 根据标定 assId 生成巡检点 ID。
 * 同一张图片内按空间排序追加 4 位序号，最终格式类似 85540001。
 */
function assignCruiseIds(points: ExportPointItem[], errors: string[]): void {
  const assCounters = new Map<string, number>();
  const cruiseIds = new Set<string>();
  for (const point of points) {
    const nextSeq = (assCounters.get(point.assId) || 0) + 1;
    assCounters.set(point.assId, nextSeq);
    point.cruiseId = `${point.assId}${String(nextSeq).padStart(4, "0")}`;
    if (cruiseIds.has(point.cruiseId)) {
      errors.push(`巡检点 ID 重复：${point.cruiseId}`);
    }
    cruiseIds.add(point.cruiseId);
  }
}

/**
 * 按图片、标准部件组和 match_type 分组，再按目标框所在行拆分 matchInfo。
 */
function buildExportPointGroups(points: ExportPointItem[]): ExportPointGroup[] {
  const contextMap = new Map<string, ExportPointItem[]>();
  for (const point of points) {
    const key = `${point.recordKey}::${point.groupKey}::${point.matchType}`;
    contextMap.set(key, [...(contextMap.get(key) || []), point]);
  }

  const groups: ExportPointGroup[] = [];
  for (const contextItems of contextMap.values()) {
    const rows = splitPointRows(contextItems);
    for (const rowItems of rows) {
      const sortedItems = sortPointsByPosition(rowItems);
      groups.push({
        record: sortedItems[0].record,
        items: sortedItems,
        matchType: sortedItems[0].matchType,
        rect: getBoundingRect(sortedItems.map((item) => item.targetRect), sortedItems[0].matchType === 0 ? RECT_OFFSET : 0),
        order: Math.min(...sortedItems.map((item) => item.order)),
      });
    }
  }

  return groups.sort((left, right) => left.order - right.order);
}

/**
 * 生成单个 matchInfo。
 * match_type=2057 时 rect 是整行外接框，rect_loc_classes 使用相对该外接框的坐标。
 * match_type=0 时只需要带 100 像素偏移的目标区域，不输出 classid_roi。
 */
function buildMatchInfo(group: ExportPointGroup): CabinetAnnotationMatchInfo {
  const cruiseIds = group.items.map((item) => item.cruiseId);
  const info: CabinetAnnotationMatchInfo = {
    cruise_ids: cruiseIds,
    image_path: `../robot/model/${group.record.stationName}/${group.items[0].assId}.jpg`,
    match_type: group.matchType,
    rect: formatRect(group.rect),
  };

  if (group.matchType === 2057) {
    const rectLocClasses: Record<string, [string, string]> = {};
    for (const item of group.items) {
      rectLocClasses[item.cruiseId] = [
        item.label,
        formatRect(toRelativeRect(item.targetRect, group.rect)),
      ];
    }
    info.classid_roi = unique(group.items.map((item) => item.label)).join(",");
    info.rect_loc_classes = JSON.stringify(rectLocClasses, null, 4);
    info.score_thresh = SCORE_THRESH;
  }

  return info;
}

/**
 * 点位导出优先使用绑定的设备框或外观框；只有单点历史数据才回退到快照框。
 */
function findPointTargetRect(
  row: CabinetPointRow,
  annotations: ComponentAnnotations,
  singlePoint?: CabinetSinglePoint,
): ImageRect | null {
  if (row.relatedRectId && row.relatedRectTool) {
    const related = findSelectedAnnotation(annotations, { id: row.relatedRectId, tool: row.relatedRectTool });
    if (related) return related;
  }
  if (row.boundRectId && row.boundRectTool) {
    const bound = findSelectedAnnotation(annotations, { id: row.boundRectId, tool: row.boundRectTool });
    if (bound) return bound;
  }
  return singlePoint?.rectSnapshot || null;
}

/**
 * 对位参数按标准部件组聚合，找不到容器时归入 ungrouped。
 */
function getPointGroupKey(rect: ImageRect, annotations: ComponentAnnotations): string {
  if (rect.groupId) return `group:${rect.groupId}`;
  const container = annotations.standardPartRects.find((standardPart) => containsRect(standardPart, rect) || isRectCenterInside(rect, standardPart));
  if (container) return `group:${container.id}`;
  return "ungrouped";
}

/**
 * 同一个 matchInfo 内继续按设备所在行拆分，避免上下两排设备被合并到一个对位框。
 */
function splitPointRows(points: ExportPointItem[]): ExportPointItem[][] {
  const sortedPoints = sortPointsByPosition(points);
  const rows: ExportPointItem[][] = [];
  for (const point of sortedPoints) {
    const row = rows.find((currentRow) => isSamePointRow(currentRow, point));
    if (row) row.push(point);
    else rows.push([point]);
  }
  return rows.map(sortPointsByPosition);
}

function isSamePointRow(row: ExportPointItem[], point: ExportPointItem): boolean {
  const rowCenterY = median(row.map((item) => getRectCenterY(item.targetRect)));
  const rowHeight = median(row.map((item) => item.targetRect.h));
  const threshold = Math.max(8, Math.min(rowHeight, point.targetRect.h) * 0.65);
  return Math.abs(getRectCenterY(point.targetRect) - rowCenterY) <= threshold;
}

function sortPointsByPosition(points: ExportPointItem[]): ExportPointItem[] {
  return [...points].sort((left, right) => (
    left.targetRect.y - right.targetRect.y
    || left.targetRect.x - right.targetRect.x
    || left.order - right.order
  ));
}

/**
 * 计算对位外接框；表计、小灯、外观等 match_type=0 的场景会额外扩 100 像素。
 */
function getBoundingRect(rects: ImageRect[], offset: number): RectBox {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  const x = Math.max(0, left - offset);
  const y = Math.max(0, top - offset);
  return normalizeRect({
    x,
    y,
    w: right + offset - x,
    h: bottom + offset - y,
  });
}

function toRelativeRect(rect: ImageRect, base: RectBox): RectBox {
  return normalizeRect({
    x: rect.x - base.x,
    y: rect.y - base.y,
    w: rect.w,
    h: rect.h,
  });
}

function normalizeRect(rect: Pick<ImageRect, "x" | "y" | "w" | "h">): ImageRect {
  return {
    id: "export-rect",
    x: Math.round(Number(rect.x) || 0),
    y: Math.round(Number(rect.y) || 0),
    w: Math.round(Number(rect.w) || 0),
    h: Math.round(Number(rect.h) || 0),
  };
}

function formatRect(rect: RectBox | ImageRect): string {
  return [rect.x, rect.y, rect.w, rect.h].map((value) => String(Math.round(Number(value) || 0))).join(",");
}

/**
 * 根据算法类型决定对位方式：表计/小灯/外观走 0，其他室内目标检测走 2057。
 */
function getMatchType(algorithmType: number): number {
  return MATCH_TYPE_ZERO_ALGORITHM_TYPES.has(algorithmType) ? 0 : 2057;
}

function normalizeAssId(value: string): string {
  const assId = String(value || "").trim();
  return /^\d+$/.test(assId) ? assId : "";
}

function formatRecordName(record: CabinetImagePackageRecord): string {
  return record.componentName || record.componentCode || record.imageName || "未命名部件";
}

function emptyAnnotations(): ComponentAnnotations {
  return {
    standardPartRects: [],
    deviceLabelRects: [],
    deviceBoxRects: [],
    appearanceRects: [],
  };
}

function containsRect(outer: ImageRect, inner: ImageRect): boolean {
  const tolerance = 0.5;
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.w <= outer.x + outer.w + tolerance
    && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

function isRectCenterInside(rect: ImageRect, container: ImageRect): boolean {
  const centerX = getRectCenterX(rect);
  const centerY = getRectCenterY(rect);
  return centerX >= container.x
    && centerX <= container.x + container.w
    && centerY >= container.y
    && centerY <= container.y + container.h;
}

function getRectCenterX(rect: Pick<ImageRect, "x" | "w">): number {
  return rect.x + rect.w / 2;
}

function getRectCenterY(rect: Pick<ImageRect, "y" | "h">): number {
  return rect.y + rect.h / 2;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sortedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
