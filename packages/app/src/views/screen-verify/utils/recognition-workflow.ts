import { detectCabinetDevices } from "../services/device-detection-service";
import type { DeviceDetection } from "../services/device-detection-service";
import { cropCabinetOcrImage, recognizeCabinetFacadeLabels, recognizeCabinetLabels } from "../services/ocr-service";
import type { CabinetOcrDetectedLabel } from "../services/ocr-service";
import { throwIfRecognitionCancelled } from "../services/recognition-request";
import { validateAnnotationGroups } from "./annotation-group-utils";
import { cloneAnnotations, findSelectedAnnotation } from "./annotation-utils";
import { FACADE_TARGET_TYPE, findTargetTypeOption, MIN_ANNOTATION_RECT_SIZE } from "./constants";
import { getCabinetRecordKey } from "./tree-utils";
import type { AnnotationSelection, AnnotationTool, CabinetPointRow, CabinetSinglePoint, ComponentAnnotations, ImageRect } from "../types";

export type MultiPointGenerateMode = "whole" | "add";

interface CabinetOcrSource {
  regionId: string;
  title: string;
  dataUrl: string;
  originX: number;
  originY: number;
  width?: number;
  height?: number;
  targetX?: number;
  targetY?: number;
  targetW?: number;
  targetH?: number;
  sourceRectId?: string;
  groupId?: string;
  anchorRects?: ImageRect[];
}

export interface ComponentRecognitionResult {
  annotations: ComponentAnnotations;
  rows: CabinetPointRow[];
  singlePoints: CabinetSinglePoint[];
  labelCount: number;
  deviceCount: number;
  warning?: string;
}
function isPendingManualRect(rect: ImageRect): boolean {
  return (!rect.source || rect.source === "manual")
    && !rect.saved
    && rect.generationStatus !== "generated"
    && rect.generationStatus !== "saved";
}

interface RecognizeComponentImageOptions {
  imageDataUrl: string;
  annotations: ComponentAnnotations;
  existingRows: CabinetPointRow[];
  existingSinglePoints: CabinetSinglePoint[];
  mode: MultiPointGenerateMode;
  signal?: AbortSignal;
}

export async function recognizeComponentImage(options: RecognizeComponentImageOptions): Promise<ComponentRecognitionResult> {
  const { imageDataUrl, annotations, existingRows, existingSinglePoints, mode, signal } = options;
  throwIfRecognitionCancelled(signal);
  const working = mode === "whole" ? retainRecognitionInputAnnotations(annotations) : cloneAnnotations(annotations);
  const targetLabels = getRecognitionTargetRects(working.deviceLabelRects, mode, isWholeRecognitionLabelRect);
  const targetAppearanceRects = getRecognitionTargetRects(working.appearanceRects, mode, isManualInputRect);
  const targetStandardPartRects = getRecognitionTargetRects(working.standardPartRects, mode, isManualInputRect);

  if (targetAppearanceRects.length && !targetStandardPartRects.length) {
    if (!targetLabels.length) throw new Error("请先框选设备标签框");
    return recognizeFacadeComponentImage({
      imageDataUrl,
      working,
      targetLabels,
      targetAppearanceRects,
      existingRows,
      existingSinglePoints,
      mode,
      signal,
    });
  }

  const targetLabelIds = new Set(targetLabels.map((rect) => rect.id));
  const requiredStandardPartIds = new Set(targetStandardPartRects.map((rect) => rect.id));
  const validation = validateAnnotationGroups(working, { targetLabelIds, requiredStandardPartIds });
  if (validation.issues.length) throw new Error(validation.issues[0]);

  const preDetectionGroups = validation.groups.map((group) => ({
    ...group,
    deviceRects: [] as ImageRect[],
  }));
  const response = await detectCabinetDevices(imageDataUrl, { signal });
  if (response.issues.length) throw new Error(response.issues[0]);
  throwIfRecognitionCancelled(signal);

  const generationKey = Date.now();
  const aiDeviceRects = mapDeviceDetectionsToImageRects(response.detections, preDetectionGroups, generationKey);
  const gapFilledDeviceRects = fillDeviceBoxGapsByRows(aiDeviceRects, generationKey);

  const groupByInputLabelId = new Map<string, string>();
  for (const group of validation.groups) {
    for (const label of group.labelRects) groupByInputLabelId.set(label.id, group.id);
  }
  const sources = await buildDeviceLabelOcrSources(imageDataUrl, targetLabels, groupByInputLabelId, gapFilledDeviceRects);
  throwIfRecognitionCancelled(signal);
  const ocrResult = await recognizeCabinetLabels(sources.map((source) => ({
    regionId: source.regionId,
    title: source.title,
    dataUrl: source.dataUrl,
  })), { signal });
  const recognizedLabelRects = mapOcrLabelsToImageRects(ocrResult.labels, sources);
  const generatedDeviceRects = completeDeviceBoxesByOcrRows(gapFilledDeviceRects, recognizedLabelRects, validation.groups, generationKey);
  console.info("[screen-verify] multi-point label OCR result", {
    mode,
    sources: sources.map(({ dataUrl, ...source }) => source),
    rawText: ocrResult.rawText,
    regions: ocrResult.regions,
    labels: ocrResult.labels,
    mappedRects: recognizedLabelRects,
  });
  if (!recognizedLabelRects.length) throw new Error("未识别到标签");

  const recognizedGroups = validation.groups
    .map((group) => ({
      ...group,
      labelRects: recognizedLabelRects.filter((rect) => rect.groupId === group.id),
      deviceRects: [] as ImageRect[],
    }))
    .filter((group) => group.labelRects.length > 0);

  const recognizedSourceRectIds = new Set(
    recognizedLabelRects.map((rect) => rect.generatedFromRectId).filter(Boolean) as string[],
  );
  const affectedGroupIds = new Set(recognizedGroups.map((group) => group.id));
  console.info("[screen-verify] device detection result", {
    mode,
    rawDetections: response.detections,
    matchedRects: aiDeviceRects,
    gapFilledRects: gapFilledDeviceRects,
    completedRects: generatedDeviceRects,
    groups: recognizedGroups.map((group) => ({
      id: group.id,
      standardPartRect: group.standardPartRect,
      labelCount: group.labelRects.length,
    })),
  });

  const nextAnnotations: ComponentAnnotations = {
    ...working,
    standardPartRects: working.standardPartRects.map((rect) => (
      affectedGroupIds.has(rect.id)
        ? { ...rect, groupId: rect.id, saved: false, generationStatus: "generated" }
        : rect
    )),
    deviceLabelRects: [
      ...working.deviceLabelRects.filter((rect) => !recognizedSourceRectIds.has(rect.id)),
      ...recognizedLabelRects,
    ],
    deviceBoxRects: [
      ...working.deviceBoxRects,
      ...generatedDeviceRects,
    ],
  };
  const recognizedRows = buildRowsFromRecognizedLabels(recognizedLabelRects, generatedDeviceRects);
  const nextRows = mode === "whole" ? recognizedRows : [...existingRows, ...recognizedRows];
  const nextSinglePoints = mode === "whole" ? [] : existingSinglePoints;

  return {
    annotations: nextAnnotations,
    rows: nextRows,
    singlePoints: nextSinglePoints,
    labelCount: recognizedLabelRects.length,
    deviceCount: generatedDeviceRects.length,
    warning: generatedDeviceRects.length
      ? undefined
      : `已识别 ${recognizedLabelRects.length} 个标签，未识别到部件框`,
  };
}

async function recognizeFacadeComponentImage(options: {
  imageDataUrl: string;
  working: ComponentAnnotations;
  targetLabels: ImageRect[];
  targetAppearanceRects: ImageRect[];
  existingRows: CabinetPointRow[];
  existingSinglePoints: CabinetSinglePoint[];
  mode: MultiPointGenerateMode;
  signal?: AbortSignal;
}): Promise<ComponentRecognitionResult> {
  const {
    imageDataUrl,
    working,
    targetLabels,
    targetAppearanceRects,
    existingRows,
    existingSinglePoints,
    mode,
    signal,
  } = options;
  throwIfRecognitionCancelled(signal);
  const generationKey = Date.now();
  const groupId = `facade:${generationKey}`;
  const facadeDeviceRects = targetAppearanceRects.map((rect) => createFacadeDeviceRect(rect, groupId));
  const groupByInputLabelId = new Map(targetLabels.map((rect) => [rect.id, groupId]));
  const sources = await buildDeviceLabelOcrSources(imageDataUrl, targetLabels, groupByInputLabelId);
  throwIfRecognitionCancelled(signal);
  const ocrResult = await recognizeCabinetFacadeLabels(sources.map((source) => ({
    regionId: source.regionId,
    title: source.title,
    dataUrl: source.dataUrl,
  })), { signal });
  const recognizedLabelRects = mapOcrLabelsToImageRects(ocrResult.labels, sources);
  console.info("[screen-verify] facade label OCR result", {
    mode,
    sources: sources.map(({ dataUrl, ...source }) => source),
    rawText: ocrResult.rawText,
    regions: ocrResult.regions,
    labels: ocrResult.labels,
    mappedRects: recognizedLabelRects,
    facadeDeviceRects,
  });
  if (!recognizedLabelRects.length) throw new Error("未识别到标签");

  const recognizedSourceRectIds = new Set(
    recognizedLabelRects.map((rect) => rect.generatedFromRectId).filter(Boolean) as string[],
  );
  const facadeRectIds = new Set(facadeDeviceRects.map((rect) => rect.id));
  const nextAnnotations: ComponentAnnotations = {
    ...working,
    deviceLabelRects: [
      ...working.deviceLabelRects.filter((rect) => !recognizedSourceRectIds.has(rect.id)),
      ...recognizedLabelRects,
    ],
    appearanceRects: working.appearanceRects.map((rect) => (
      facadeRectIds.has(rect.id)
        ? createFacadeDeviceRect(rect, groupId)
        : rect
    )),
  };
  const recognizedRows = buildRowsFromRecognizedLabels(recognizedLabelRects, facadeDeviceRects, "appearance");
  const nextRows = mode === "whole" ? recognizedRows : [...existingRows, ...recognizedRows];
  const nextSinglePoints = mode === "whole" ? [] : existingSinglePoints;

  return {
    annotations: nextAnnotations,
    rows: nextRows,
    singlePoints: nextSinglePoints,
    labelCount: recognizedLabelRects.length,
    deviceCount: facadeDeviceRects.length,
  };
}

function retainRecognitionInputAnnotations(annotations: ComponentAnnotations): ComponentAnnotations {
  return {
    standardPartRects: annotations.standardPartRects.filter(isManualInputRect),
    deviceLabelRects: annotations.deviceLabelRects.filter(isWholeRecognitionLabelRect),
    deviceBoxRects: annotations.deviceBoxRects.filter(isManualInputRect),
    appearanceRects: annotations.appearanceRects.filter(isManualInputRect),
  };
}

function getRecognitionTargetRects(
  rects: ImageRect[],
  mode: MultiPointGenerateMode,
  wholeFilter: (rect: ImageRect) => boolean,
): ImageRect[] {
  return rects.filter((rect) => (mode === "whole" ? wholeFilter(rect) : isPendingManualRect(rect)));
}

function isManualInputRect(rect: ImageRect): boolean {
  return !rect.source || rect.source === "manual";
}

function isWholeRecognitionLabelRect(rect: ImageRect): boolean {
  return isManualInputRect(rect) || rect.source === "ocr";
}

export function getRecognitionReadiness(
  annotations: ComponentAnnotations,
  mode: MultiPointGenerateMode,
): { ready: boolean; reason?: string } {
  const working = mode === "whole" ? retainRecognitionInputAnnotations(annotations) : cloneAnnotations(annotations);
  const targetLabels = getRecognitionTargetRects(working.deviceLabelRects, mode, isWholeRecognitionLabelRect);
  const targetAppearanceRects = getRecognitionTargetRects(working.appearanceRects, mode, isManualInputRect);
  const targetStandardPartRects = getRecognitionTargetRects(working.standardPartRects, mode, isManualInputRect);
  if (targetAppearanceRects.length && !targetStandardPartRects.length) {
    return targetLabels.length
      ? { ready: true }
      : { ready: false, reason: "缺少设备标签框" };
  }
  if (!targetStandardPartRects.length) return { ready: false, reason: "缺少标准部件框" };
  if (!targetLabels.length) return { ready: false, reason: "缺少设备标签框" };
  return { ready: true };
}

export function hasComponentPointData(
  componentCode: string,
  ocrRowsByComponent: Record<string, CabinetPointRow[]>,
  singlePointsByComponent: Record<string, CabinetSinglePoint[]>,
): boolean {
  return Boolean((ocrRowsByComponent[componentCode] || []).length || (singlePointsByComponent[componentCode] || []).length);
}

export function getComponentDisplayName(record: CabinetImagePackageRecord): string {
  return record.componentName || record.componentCode || record.imageName || "未命名部件";
}

export function waitForBrowserPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      window.setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => resolve());
  });
}

export function resolveTargetTypeValue(row: CabinetPointRow | null): string {
  if (!row) return "";
  return row.recognitionLabel || findTargetTypeOption(undefined, row.recognitionLabelDesc || row.type)?.value || "";
}

function createFacadeDeviceRect(rect: ImageRect, groupId: string): ImageRect {
  return {
    ...rect,
    text: FACADE_TARGET_TYPE.label,
    source: rect.source || "manual",
    saved: false,
    generationStatus: "generated",
    groupId,
    recognitionLabel: FACADE_TARGET_TYPE.value,
    recognitionLabelDesc: FACADE_TARGET_TYPE.label,
  };
}

function mapDeviceDetectionsToImageRects(
  detections: DeviceDetection[],
  groups: Array<{ id: string; standardPartRect: ImageRect }>,
  generationKey: number,
): ImageRect[] {
  const rects: ImageRect[] = [];
  for (const detection of detections) {
    const matchedGroup = findMatchedDetectionGroup(detection.result.rect, groups);
    if (!matchedGroup) continue;
    const targetType = findTargetTypeOption(detection.result.classid, detection.result.labeldesc);
    const recognitionLabel = targetType?.value || detection.result.classid;
    const recognitionLabelDesc = targetType?.label || detection.result.labeldesc;
    rects.push({
      id: `ai-device:${generationKey}:${rects.length}:${Math.random().toString(16).slice(2)}`,
      ...detection.result.rect,
      text: recognitionLabelDesc || recognitionLabel || "部件",
      confidence: detection.result.score,
      source: "ai",
      saved: false,
      generationStatus: "generated",
      groupId: matchedGroup.id,
      generatedFromRectId: matchedGroup.standardPartRect.id,
      recognitionLabel,
      recognitionLabelDesc,
    });
  }
  return rects;
}

function fillDeviceBoxGapsByRows(deviceRects: ImageRect[], generationKey: number): ImageRect[] {
  const rows = splitRectRows(deviceRects);
  return rows.flatMap((row, rowIndex) => fillLargeGapsInRow(row, generationKey, rowIndex));
}

function completeDeviceBoxesByOcrRows(
  deviceRects: ImageRect[],
  labelRects: ImageRect[],
  groups: Array<{ id: string; standardPartRect: ImageRect }>,
  generationKey: number,
): ImageRect[] {
  let result = deviceRects;
  for (const group of groups) {
    const groupDeviceRects = result.filter((rect) => rect.groupId === group.id);
    const groupLabelRects = labelRects.filter((rect) => rect.groupId === group.id);
    if (!groupDeviceRects.length || !groupLabelRects.length) continue;

    const rows = splitRectRows(groupDeviceRects);
    const targetColumnCount = getTargetColumnCountForGroup(groupDeviceRects, groupLabelRects);
    if (targetColumnCount <= 0) continue;

    const completedRows = rows.map((row, rowIndex) => fillRowToTargetCount(
      row,
      targetColumnCount,
      group.standardPartRect,
      generationKey,
      rowIndex,
    ));
    const completedGroupDeviceRects = completedRows.flat();
    result = [
      ...result.filter((rect) => rect.groupId !== group.id),
      ...completedGroupDeviceRects,
    ];
  }
  return sortRectsByPosition(result);
}

function getTargetColumnCountForGroup(deviceRects: ImageRect[], labelRects: ImageRect[]): number {
  const deviceRows = splitRectRows(deviceRects);
  const labelRows = splitRectRows(labelRects);
  const maxDeviceCols = Math.max(0, ...deviceRows.map((row) => row.length));
  const maxLabelCols = Math.max(0, ...labelRows.map((row) => row.length));
  return Math.max(maxDeviceCols, maxLabelCols);
}

function fillLargeGapsInRow(row: ImageRect[], generationKey: number, rowIndex: number): ImageRect[] {
  const sortedRow = sortRectsByCenterX(row);
  if (sortedRow.length < 2) return sortedRow;

  const avgSpacing = getAvgCenterSpacing(sortedRow);
  if (!avgSpacing || avgSpacing <= 0) return sortedRow;

  const result: ImageRect[] = [];
  let inferredIndex = 0;
  for (let index = 0; index < sortedRow.length - 1; index += 1) {
    const leftRect = sortedRow[index];
    const rightRect = sortedRow[index + 1];
    result.push(leftRect);

    const currentSpacing = getRectCenterX(rightRect) - getRectCenterX(leftRect);
    if (currentSpacing <= avgSpacing * 1.5) continue;

    const numToAdd = Math.max(0, Math.round(currentSpacing / avgSpacing) - 1);
    const spacingStep = currentSpacing / (numToAdd + 1);
    for (let offset = 1; offset <= numToAdd; offset += 1) {
      result.push(createInferredDeviceRectBetween(
        leftRect,
        rightRect,
        getRectCenterX(leftRect) + spacingStep * offset,
        generationKey,
        rowIndex,
        inferredIndex,
      ));
      inferredIndex += 1;
    }
  }
  result.push(sortedRow[sortedRow.length - 1]);
  return sortRectsByCenterX(result);
}

function fillRowToTargetCount(
  row: ImageRect[],
  targetCount: number,
  container: ImageRect,
  generationKey: number,
  rowIndex: number,
): ImageRect[] {
  let result = sortRectsByCenterX(row);
  let avgSpacing = getRowFillSpacing(result, targetCount);
  if (!avgSpacing || avgSpacing <= 0) return result;

  let inferredIndex = 0;
  while (result.length < targetCount) {
    const insertion = findBestDeviceInsertion(result, avgSpacing, container, generationKey, rowIndex, inferredIndex);
    if (!insertion) break;
    result = [
      ...result.slice(0, insertion.index),
      insertion.rect,
      ...result.slice(insertion.index),
    ];
    result = sortRectsByCenterX(result);
    avgSpacing = getRowFillSpacing(result, targetCount) || avgSpacing;
    inferredIndex += 1;
  }
  return result;
}

function findBestDeviceInsertion(
  row: ImageRect[],
  avgSpacing: number,
  container: ImageRect,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
): { index: number; rect: ImageRect } | null {
  if (!row.length) return null;
  const sortedRow = sortRectsByCenterX(row);
  const candidates: { index: number; rect: ImageRect; score: number }[] = [];

  for (let index = 0; index <= sortedRow.length; index += 1) {
    const rect = createInsertionCandidateRect(sortedRow, index, avgSpacing, generationKey, rowIndex, inferredIndex);
    if (!rect || !containsRect(container, rect)) continue;
    const candidateRow = sortRectsByCenterX([
      ...sortedRow.slice(0, index),
      rect,
      ...sortedRow.slice(index),
    ]);
    candidates.push({
      index,
      rect,
      score: getSpacingUniformityScore(candidateRow, avgSpacing),
    });
  }

  if (!candidates.length) return null;
  return candidates.reduce((best, current) => (current.score < best.score ? current : best));
}

function createInsertionCandidateRect(
  row: ImageRect[],
  index: number,
  avgSpacing: number,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
): ImageRect | null {
  const sortedRow = sortRectsByCenterX(row);
  const template = sortedRow[index] || sortedRow[index - 1];
  if (!template) return null;

  let centerX: number;
  if (index === 0) {
    centerX = getRectCenterX(sortedRow[0]) - avgSpacing;
  } else if (index === sortedRow.length) {
    centerX = getRectCenterX(sortedRow[sortedRow.length - 1]) + avgSpacing;
  } else {
    centerX = (getRectCenterX(sortedRow[index - 1]) + getRectCenterX(sortedRow[index])) / 2;
  }

  return createInferredDeviceRectFromTemplate(template, centerX, generationKey, rowIndex, inferredIndex);
}

function createInferredDeviceRectBetween(
  leftRect: ImageRect,
  rightRect: ImageRect,
  centerX: number,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
): ImageRect {
  const template = getRectArea(leftRect) >= getRectArea(rightRect) ? leftRect : rightRect;
  const inferred = createInferredDeviceRectFromTemplate(template, centerX, generationKey, rowIndex, inferredIndex);
  inferred.y = (leftRect.y + rightRect.y) / 2;
  return inferred;
}

function createInferredDeviceRectFromTemplate(
  template: ImageRect,
  centerX: number,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
): ImageRect {
  const w = Math.max(MIN_ANNOTATION_RECT_SIZE, template.w);
  const h = Math.max(MIN_ANNOTATION_RECT_SIZE, template.h);
  return {
    ...template,
    id: `inferred-device:${generationKey}:${rowIndex}:${inferredIndex}:${Math.random().toString(16).slice(2)}`,
    x: centerX - w / 2,
    y: template.y,
    w,
    h,
    source: "inferred",
    confidence: undefined,
    saved: false,
    generationStatus: "generated",
  };
}

function splitRectRows(rects: ImageRect[]): ImageRect[][] {
  const sortedRects = sortRectsByPosition(rects);
  const rows: ImageRect[][] = [];
  for (const rect of sortedRects) {
    const row = rows.find((currentRow) => isSameRectRow(currentRow, rect));
    if (row) {
      row.push(rect);
    } else {
      rows.push([rect]);
    }
  }
  return rows.map(sortRectsByCenterX);
}

function isSameRectRow(row: ImageRect[], rect: ImageRect): boolean {
  const rowCenterY = median(row.map(getRectCenterY));
  const rowHeight = median(row.map((item) => item.h));
  const threshold = Math.max(MIN_ANNOTATION_RECT_SIZE * 2, Math.min(rowHeight, rect.h) * 0.65);
  return Math.abs(getRectCenterY(rect) - rowCenterY) <= threshold;
}

function getAvgCenterSpacing(row: ImageRect[]): number {
  const sortedRow = sortRectsByCenterX(row);
  if (sortedRow.length < 2) return 0;
  const spacings: number[] = [];
  for (let index = 0; index < sortedRow.length - 1; index += 1) {
    spacings.push(getRectCenterX(sortedRow[index + 1]) - getRectCenterX(sortedRow[index]));
  }
  const positiveSpacings = spacings.filter((spacing) => spacing > 0);
  if (!positiveSpacings.length) return 0;
  const minSpacing = Math.min(...positiveSpacings);
  const normalSpacings = positiveSpacings.filter((spacing) => spacing <= minSpacing * 1.5);
  return average(normalSpacings.length ? normalSpacings : positiveSpacings);
}

function getRowFillSpacing(row: ImageRect[], targetCount: number): number {
  const sortedRow = sortRectsByCenterX(row);
  const medianWidth = getMedianRectWidth(sortedRow);
  const avgSpacing = getAvgCenterSpacing(sortedRow);
  if (sortedRow.length >= 2 && targetCount > sortedRow.length) {
    const span = getRectCenterX(sortedRow[sortedRow.length - 1]) - getRectCenterX(sortedRow[0]);
    const spanSpacing = span / Math.max(1, targetCount - 1);
    const currentSpacingLooksLikeGap = avgSpacing > Math.max(medianWidth * 1.6, spanSpacing * 1.5);
    if (spanSpacing > 0 && currentSpacingLooksLikeGap) return spanSpacing;
  }
  return avgSpacing || medianWidth * 1.25;
}

function getSpacingUniformityScore(row: ImageRect[], avgSpacing: number): number {
  const sortedRow = sortRectsByCenterX(row);
  let score = 0;
  for (let index = 0; index < sortedRow.length - 1; index += 1) {
    const actualSpacing = getRectCenterX(sortedRow[index + 1]) - getRectCenterX(sortedRow[index]);
    score += Math.abs(actualSpacing - avgSpacing);
  }
  return score;
}

function sortRectsByPosition(rects: ImageRect[]): ImageRect[] {
  return [...rects].sort((leftRect, rightRect) => (
    leftRect.y - rightRect.y || leftRect.x - rightRect.x
  ));
}

function sortRectsByCenterX(rects: ImageRect[]): ImageRect[] {
  return [...rects].sort((leftRect, rightRect) => getRectCenterX(leftRect) - getRectCenterX(rightRect));
}

function containsRect(outer: ImageRect, inner: ImageRect): boolean {
  const tolerance = 0.5;
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.w <= outer.x + outer.w + tolerance
    && inner.y + inner.h <= outer.y + outer.h + tolerance;
}

function getMedianRectWidth(rects: ImageRect[]): number {
  return median(rects.map((rect) => rect.w).filter((width) => width > 0));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sortedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function buildRowsFromRecognizedLabels(
  labelRects: ImageRect[],
  deviceRects: ImageRect[],
  deviceTool: AnnotationTool = "deviceBox",
): CabinetPointRow[] {
  return labelRects.flatMap((labelRect) => {
    const relatedDeviceRects = findRelatedDeviceRectsForLabel(labelRect, deviceRects);
    if (!relatedDeviceRects.length) {
      return [createPointRowFromLabelAndDevice(labelRect, null, deviceTool)];
    }
    return relatedDeviceRects.map((deviceRect) => createPointRowFromLabelAndDevice(labelRect, deviceRect, deviceTool));
  });
}

export interface SortedPointRowsResult {
  annotations: ComponentAnnotations;
  rows: CabinetPointRow[];
  emptyNameCount: number;
  unboundLabelCount: number;
  unboundDeviceCount: number;
}

export function buildSortedPointRowsFromAnnotations(annotations: ComponentAnnotations): SortedPointRowsResult {
  const labelAssignments = assignRectsToStandardPartGroups(annotations.deviceLabelRects, annotations.standardPartRects);
  const deviceAssignments = assignRectsToStandardPartGroups(annotations.deviceBoxRects, annotations.standardPartRects);
  const hasUngroupedRects = labelAssignments.unassigned.length > 0 || deviceAssignments.unassigned.length > 0;
  const groupIds = [
    ...annotations.standardPartRects.map((rect) => rect.id),
    ...(hasUngroupedRects ? ["ungrouped"] : []),
  ];
  const rows: CabinetPointRow[] = [];
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  for (const groupId of groupIds) {
    const labels = sortRectsByPosition(
      groupId === "ungrouped" ? labelAssignments.unassigned : (labelAssignments.byGroup.get(groupId) || []),
    );
    const devices = sortRectsByPosition(
      groupId === "ungrouped" ? deviceAssignments.unassigned : (deviceAssignments.byGroup.get(groupId) || []),
    );
    if (!labels.length && !devices.length) continue;

    const aligned = buildSortedPointRowsForGroup(labels, devices);
    rows.push(...aligned.rows);
    unboundLabelCount += aligned.unboundLabelCount;
    unboundDeviceCount += aligned.unboundDeviceCount;
  }

  const nextAnnotations: ComponentAnnotations = {
    ...annotations,
    standardPartRects: annotations.standardPartRects.map((rect) => ({
      ...rect,
      groupId: rect.id,
      saved: false,
      generationStatus: rect.generationStatus === "saved" ? "generated" : rect.generationStatus,
    })),
    deviceLabelRects: labelAssignments.rects,
    deviceBoxRects: deviceAssignments.rects,
  };

  return {
    annotations: nextAnnotations,
    rows: rows.map((row, index) => ({ ...row, index: index + 1 })),
    emptyNameCount: rows.filter((row) => !row.name.trim()).length,
    unboundLabelCount,
    unboundDeviceCount,
  };
}

function buildSortedPointRowsForGroup(labelRects: ImageRect[], deviceRects: ImageRect[]): {
  rows: CabinetPointRow[];
  unboundLabelCount: number;
  unboundDeviceCount: number;
} {
  const labelRows = splitRectRows(labelRects);
  const deviceRows = splitRectRows(deviceRects);
  const rows: CabinetPointRow[] = [];
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  if (!labelRows.length) {
    return {
      rows: deviceRows.flatMap((deviceRow) => sortRectsByCenterX(deviceRow).map((deviceRect) => createPointRowFromLabelAndDevice(createEmptyLabelRectForDevice(deviceRect), deviceRect, "deviceBox"))),
      unboundLabelCount: 0,
      unboundDeviceCount: deviceRects.length,
    };
  }

  const usedDeviceIds = new Set<string>();
  for (const labelRow of labelRows) {
    const sortedLabels = sortRectsByCenterX(labelRow);
    const relatedDeviceRows = findRelatedDeviceRowsForLabelRow(sortedLabels, deviceRows);
    if (!relatedDeviceRows.length) {
      rows.push(...sortedLabels.map((labelRect) => createPointRowFromLabelAndDevice(labelRect, null, "deviceBox")));
      unboundLabelCount += sortedLabels.length;
      continue;
    }

    for (const deviceRow of relatedDeviceRows) {
      const sortedDevices = sortRectsByCenterX(deviceRow);
      const alignedRows = createAlignedRowsForLabelAndDeviceRow(sortedLabels, sortedDevices);
      rows.push(...alignedRows.rows);
      alignedRows.usedDeviceIds.forEach((id) => usedDeviceIds.add(id));
      unboundLabelCount += alignedRows.unboundLabelCount;
      unboundDeviceCount += alignedRows.unboundDeviceCount;
    }
  }

  for (const deviceRect of deviceRows.flat()) {
    if (usedDeviceIds.has(deviceRect.id)) continue;
    rows.push(createPointRowFromLabelAndDevice(createEmptyLabelRectForDevice(deviceRect), deviceRect, "deviceBox"));
    unboundDeviceCount += 1;
  }

  return { rows, unboundLabelCount, unboundDeviceCount };
}

function createAlignedRowsForLabelAndDeviceRow(labelRow: ImageRect[], deviceRow: ImageRect[]): {
  rows: CabinetPointRow[];
  usedDeviceIds: Set<string>;
  unboundLabelCount: number;
  unboundDeviceCount: number;
} {
  const maxCount = Math.max(labelRow.length, deviceRow.length);
  const rows: CabinetPointRow[] = [];
  const usedDeviceIds = new Set<string>();
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  for (let index = 0; index < maxCount; index += 1) {
    const labelRect = labelRow[index];
    const deviceRect = deviceRow[index];
    if (deviceRect) usedDeviceIds.add(deviceRect.id);
    if (labelRect && !deviceRect) unboundLabelCount += 1;
    if (!labelRect && deviceRect) unboundDeviceCount += 1;
    rows.push(createPointRowFromLabelAndDevice(labelRect || createEmptyLabelRectForDevice(deviceRect), deviceRect || null, "deviceBox"));
  }

  return { rows, usedDeviceIds, unboundLabelCount, unboundDeviceCount };
}

function findRelatedDeviceRowsForLabelRow(labelRow: ImageRect[], deviceRows: ImageRect[][]): ImageRect[][] {
  if (!deviceRows.length) return [];
  const labelCenterY = median(labelRow.map(getRectCenterY));
  const labelSpan = getRowHorizontalSpan(labelRow);
  const candidates = deviceRows
    .map((deviceRow) => ({
      row: deviceRow,
      centerY: median(deviceRow.map(getRectCenterY)),
      score: getRowRelationScore(labelRow, deviceRow, labelSpan),
    }))
    .sort((left, right) => left.score - right.score);

  const above = candidates
    .filter((candidate) => candidate.centerY < labelCenterY)
    .sort((left, right) => Math.abs(left.centerY - labelCenterY) - Math.abs(right.centerY - labelCenterY))[0];
  const below = candidates
    .filter((candidate) => candidate.centerY >= labelCenterY)
    .sort((left, right) => Math.abs(left.centerY - labelCenterY) - Math.abs(right.centerY - labelCenterY))[0];

  const sharedRows = uniqueRectRows([above?.row, below?.row])
    .filter((row) => isDeviceRowHorizontallyRelated(labelSpan, row));
  if (sharedRows.length >= 2) return sharedRows;
  if (sharedRows.length === 1 && shouldUseSingleDeviceRowForLabels(labelRow, sharedRows[0], candidates.length)) return sharedRows;
  return candidates[0]?.row ? [candidates[0].row] : [];
}

function shouldUseSingleDeviceRowForLabels(labelRow: ImageRect[], deviceRow: ImageRect[], totalDeviceRowCount: number): boolean {
  if (totalDeviceRowCount <= 1) return true;
  const labelCenterY = median(labelRow.map(getRectCenterY));
  const deviceCenterY = median(deviceRow.map(getRectCenterY));
  const distanceY = Math.abs(deviceCenterY - labelCenterY);
  const maxHeight = Math.max(median(labelRow.map((rect) => rect.h)), median(deviceRow.map((rect) => rect.h)), MIN_ANNOTATION_RECT_SIZE);
  return distanceY <= maxHeight * 3;
}

function getRowRelationScore(labelRow: ImageRect[], deviceRow: ImageRect[], labelSpan = getRowHorizontalSpan(labelRow)): number {
  const deviceSpan = getRowHorizontalSpan(deviceRow);
  const labelCenterY = median(labelRow.map(getRectCenterY));
  const deviceCenterY = median(deviceRow.map(getRectCenterY));
  const overlapX = getAxisOverlap(labelSpan.left, labelSpan.right, deviceSpan.left, deviceSpan.right);
  const minWidth = Math.max(1, Math.min(labelSpan.right - labelSpan.left, deviceSpan.right - deviceSpan.left));
  const overlapPenalty = (1 - Math.min(1, overlapX / minWidth)) * 120;
  return Math.abs(labelCenterY - deviceCenterY) + overlapPenalty + Math.abs(labelRow.length - deviceRow.length) * 12;
}

function isDeviceRowHorizontallyRelated(labelSpan: { left: number; right: number }, deviceRow: ImageRect[]): boolean {
  const deviceSpan = getRowHorizontalSpan(deviceRow);
  const overlapX = getAxisOverlap(labelSpan.left, labelSpan.right, deviceSpan.left, deviceSpan.right);
  const minWidth = Math.max(1, Math.min(labelSpan.right - labelSpan.left, deviceSpan.right - deviceSpan.left));
  const deviceCenterX = (deviceSpan.left + deviceSpan.right) / 2;
  return overlapX / minWidth >= 0.2 || (deviceCenterX >= labelSpan.left && deviceCenterX <= labelSpan.right);
}

function getRowHorizontalSpan(row: ImageRect[]): { left: number; right: number } {
  if (!row.length) return { left: 0, right: 0 };
  return {
    left: Math.min(...row.map((rect) => rect.x)),
    right: Math.max(...row.map((rect) => rect.x + rect.w)),
  };
}

function uniqueRectRows(rows: (ImageRect[] | null | undefined)[]): ImageRect[][] {
  const seenKeys = new Set<string>();
  const result: ImageRect[][] = [];
  for (const row of rows) {
    if (!row?.length) continue;
    const key = row.map((rect) => rect.id).join("|");
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push(row);
  }
  return result;
}

function createEmptyLabelRectForDevice(deviceRect: ImageRect | undefined): ImageRect {
  const fallback = deviceRect || { id: "empty", x: 0, y: 0, w: MIN_ANNOTATION_RECT_SIZE, h: MIN_ANNOTATION_RECT_SIZE };
  return {
    id: `empty-label:${fallback.id}`,
    x: fallback.x,
    y: fallback.y,
    w: fallback.w,
    h: fallback.h,
    text: "",
    source: "ocr",
    saved: false,
    generationStatus: "generated",
    groupId: fallback.groupId,
  };
}

function assignRectsToStandardPartGroups(rects: ImageRect[], standardPartRects: ImageRect[]): {
  rects: ImageRect[];
  byGroup: Map<string, ImageRect[]>;
  unassigned: ImageRect[];
} {
  const byGroup = new Map<string, ImageRect[]>();
  const unassigned: ImageRect[] = [];
  const nextRects = rects.map((rect) => {
    const group = findContainerStandardPart(rect, standardPartRects);
    if (!group) {
      const nextRect: ImageRect = {
        ...rect,
        groupId: undefined,
        saved: false,
        generationStatus: rect.generationStatus === "saved" ? "generated" : rect.generationStatus,
      };
      unassigned.push(nextRect);
      return nextRect;
    }
    const nextRect: ImageRect = {
      ...rect,
      groupId: group.id,
      saved: false,
      generationStatus: rect.generationStatus === "saved" ? "generated" : rect.generationStatus,
    };
    byGroup.set(group.id, [...(byGroup.get(group.id) || []), nextRect]);
    return nextRect;
  });
  return { rects: nextRects, byGroup, unassigned };
}

function findContainerStandardPart(rect: ImageRect, standardPartRects: ImageRect[]): ImageRect | null {
  const containers = standardPartRects
    .filter((standardPart) => containsRect(standardPart, rect) || isRectCenterInside(rect, standardPart))
    .sort((left, right) => getRectArea(left) - getRectArea(right));
  return containers[0] || null;
}

function createPointRowFromLabelAndDevice(
  labelRect: ImageRect,
  deviceRect: ImageRect | null,
  deviceTool: AnnotationTool,
): CabinetPointRow {
  return {
    key: deviceRect ? `${labelRect.id}:${deviceRect.id}` : labelRect.id,
    index: 0,
    name: labelRect.text || "",
    type: deviceRect?.recognitionLabelDesc || deviceRect?.recognitionLabel || "",
    confidence: labelRect.confidence,
    source: "ocr",
    boundRectId: labelRect.id,
    boundRectTool: "deviceLabel",
    relatedRectId: deviceRect?.id,
    relatedRectTool: deviceRect ? deviceTool : undefined,
    recognitionLabel: deviceRect?.recognitionLabel,
    recognitionLabelDesc: deviceRect?.recognitionLabelDesc,
  };
}

interface TableRowSortItem {
  row: CabinetPointRow;
  order: number;
  anchorRect: ImageRect | null;
  groupRect: ImageRect | null;
  groupKey: string;
  groupIndex: number;
  groupY: number;
  rowIndex: number;
  rowY: number;
  rowX: number;
}

export function sortTableRowsByAnnotationRows(rows: CabinetPointRow[], annotations: ComponentAnnotations): CabinetPointRow[] {
  const sortedStandardParts = sortRectsByPosition(annotations.standardPartRects);
  const items = rows.map((row, order) => createTableRowSortItem(row, order, annotations, sortedStandardParts));
  fillTableRowBucketIndexes(items);
  return items
    .sort((left, right) => (
      left.groupIndex - right.groupIndex
      || left.groupY - right.groupY
      || left.rowIndex - right.rowIndex
      || left.rowY - right.rowY
      || left.rowX - right.rowX
      || left.order - right.order
    ))
    .map((item) => item.row);
}

function createTableRowSortItem(
  row: CabinetPointRow,
  order: number,
  annotations: ComponentAnnotations,
  sortedStandardParts: ImageRect[],
): TableRowSortItem {
  const anchorRect = findTableRowAnchorRect(row, annotations);
  if (!anchorRect) {
    return {
      row,
      order,
      anchorRect: null,
      groupRect: null,
      groupKey: "unbound",
      groupIndex: Number.MAX_SAFE_INTEGER,
      groupY: Number.MAX_SAFE_INTEGER,
      rowIndex: Number.MAX_SAFE_INTEGER,
      rowY: Number.MAX_SAFE_INTEGER,
      rowX: Number.MAX_SAFE_INTEGER,
    };
  }

  const groupRect = anchorRect.groupId
    ? sortedStandardParts.find((rect) => rect.id === anchorRect.groupId) || findContainerStandardPart(anchorRect, sortedStandardParts)
    : findContainerStandardPart(anchorRect, sortedStandardParts);
  const groupIndex = groupRect ? sortedStandardParts.findIndex((rect) => rect.id === groupRect.id) : sortedStandardParts.length;

  return {
    row,
    order,
    anchorRect,
    groupRect,
    groupKey: groupRect ? `group:${groupRect.id}` : "ungrouped",
    groupIndex,
    groupY: groupRect ? groupRect.y : anchorRect.y,
    rowIndex: Number.MAX_SAFE_INTEGER,
    rowY: getRectCenterY(anchorRect),
    rowX: getRectCenterX(anchorRect),
  };
}

function fillTableRowBucketIndexes(items: TableRowSortItem[]): void {
  const itemsByGroup = new Map<string, TableRowSortItem[]>();
  for (const item of items) {
    if (!item.anchorRect) continue;
    itemsByGroup.set(item.groupKey, [...(itemsByGroup.get(item.groupKey) || []), item]);
  }

  for (const groupItems of itemsByGroup.values()) {
    const rowBuckets = splitRectRows(groupItems.map((item) => item.anchorRect).filter(Boolean) as ImageRect[]);
    groupItems.forEach((item) => {
      const bucketIndex = item.anchorRect
        ? rowBuckets.findIndex((bucket) => bucket.includes(item.anchorRect as ImageRect))
        : -1;
      if (bucketIndex < 0) return;
      item.rowIndex = bucketIndex;
      item.rowY = median(rowBuckets[bucketIndex].map(getRectCenterY));
    });
  }
}

function findTableRowAnchorRect(row: CabinetPointRow, annotations: ComponentAnnotations): ImageRect | null {
  if (row.relatedRectId && row.relatedRectTool) {
    const relatedRect = findSelectedAnnotation(annotations, { tool: row.relatedRectTool, id: row.relatedRectId });
    if (relatedRect) return relatedRect;
  }
  if (row.boundRectId && row.boundRectTool) {
    return findSelectedAnnotation(annotations, { tool: row.boundRectTool, id: row.boundRectId });
  }
  return null;
}

export function isTableRowBoundToSelection(row: CabinetPointRow, selection: AnnotationSelection): boolean {
  return (row.boundRectId === selection.id && row.boundRectTool === selection.tool)
    || (row.relatedRectId === selection.id && row.relatedRectTool === selection.tool);
}

export function findFirstEmptyNameSelection(
  ocrRows: CabinetPointRow[],
  singlePoints: CabinetSinglePoint[],
  annotations: ComponentAnnotations,
): AnnotationSelection | null {
  const rows: CabinetPointRow[] = [
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
    })),
  ];
  const emptyRow = sortTableRowsByAnnotationRows(rows, annotations).find((row) => !row.name.trim());
  return emptyRow ? findTableRowSelection(emptyRow, annotations) : null;
}

export function findTableRowSelection(row: CabinetPointRow, annotations: ComponentAnnotations): AnnotationSelection | null {
  const target = row.relatedRectId && row.relatedRectTool
    ? { tool: row.relatedRectTool, id: row.relatedRectId }
    : row.boundRectId && row.boundRectTool
      ? { tool: row.boundRectTool, id: row.boundRectId }
      : null;
  if (!target) return null;
  if (findSelectedAnnotation(annotations, target)) return target;
  if (row.boundRectId && row.boundRectTool) {
    const fallback = { tool: row.boundRectTool, id: row.boundRectId };
    if (findSelectedAnnotation(annotations, fallback)) return fallback;
  }
  return null;
}

function findRelatedDeviceRectsForLabel(labelRect: ImageRect, deviceRects: ImageRect[]): ImageRect[] {
  const sameGroupDeviceRects = deviceRects.filter((rect) => rect.groupId && rect.groupId === labelRect.groupId);
  if (!sameGroupDeviceRects.length) return [];
  if (sameGroupDeviceRects.length === 1) return [sameGroupDeviceRects[0]];

  const labelCenterY = getRectCenterY(labelRect);
  const alignedCandidates = sameGroupDeviceRects
    .map((rect) => ({
      rect,
      score: getLabelDeviceAlignmentScore(labelRect, rect),
      side: getRectCenterY(rect) < labelCenterY ? "above" as const : "below" as const,
    }))
    .filter((item) => item.score != null) as { rect: ImageRect; score: number; side: "above" | "below" }[];

  if (alignedCandidates.length) {
    const above = pickBestLabelDeviceCandidate(alignedCandidates.filter((item) => item.side === "above"));
    const below = pickBestLabelDeviceCandidate(alignedCandidates.filter((item) => item.side === "below"));
    const result = uniqueRects([above?.rect, below?.rect]);
    if (result.length) return result;
  }

  return [findNearestDeviceRect(labelRect, sameGroupDeviceRects)];
}

function findNearestDeviceRect(labelRect: ImageRect, deviceRects: ImageRect[]): ImageRect {
  let matchedRect = deviceRects[0];
  let matchedDistance = getRectCenterDistanceSquared(labelRect, matchedRect);
  for (const rect of deviceRects.slice(1)) {
    const distance = getRectCenterDistanceSquared(labelRect, rect);
    if (distance < matchedDistance) {
      matchedRect = rect;
      matchedDistance = distance;
    }
  }
  return matchedRect;
}

function pickBestLabelDeviceCandidate(candidates: { rect: ImageRect; score: number }[]): { rect: ImageRect; score: number } | null {
  if (!candidates.length) return null;
  return candidates.reduce((best, current) => (current.score < best.score ? current : best));
}

function getLabelDeviceAlignmentScore(labelRect: ImageRect, deviceRect: ImageRect): number | null {
  const labelCenterX = getRectCenterX(labelRect);
  const deviceCenterX = getRectCenterX(deviceRect);
  const centerDistanceX = Math.abs(labelCenterX - deviceCenterX);
  const overlapX = getAxisOverlap(labelRect.x, labelRect.x + labelRect.w, deviceRect.x, deviceRect.x + deviceRect.w);
  const minWidth = Math.max(1, Math.min(labelRect.w, deviceRect.w));
  const overlapRatio = overlapX / minWidth;
  const maxCenterDistance = Math.max(labelRect.w, deviceRect.w) * 0.8 + 8;
  if (overlapRatio < 0.3 && centerDistanceX > maxCenterDistance) return null;
  return centerDistanceX + Math.abs(getRectCenterY(labelRect) - getRectCenterY(deviceRect)) * 0.2 - overlapRatio * 12;
}

function uniqueRects(rects: (ImageRect | null | undefined)[]): ImageRect[] {
  const seenIds = new Set<string>();
  const result: ImageRect[] = [];
  for (const rect of rects) {
    if (!rect || seenIds.has(rect.id)) continue;
    seenIds.add(rect.id);
    result.push(rect);
  }
  return result;
}

function getRectCenterX(rect: { x: number; w: number }): number {
  return rect.x + rect.w / 2;
}

function getRectCenterY(rect: { y: number; h: number }): number {
  return rect.y + rect.h / 2;
}

function getAxisOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function getRectCenterDistanceSquared(leftRect: { x: number; y: number; w: number; h: number }, rightRect: { x: number; y: number; w: number; h: number }): number {
  const leftCenterX = getRectCenterX(leftRect);
  const leftCenterY = getRectCenterY(leftRect);
  const rightCenterX = getRectCenterX(rightRect);
  const rightCenterY = getRectCenterY(rightRect);
  const dx = leftCenterX - rightCenterX;
  const dy = leftCenterY - rightCenterY;
  return dx * dx + dy * dy;
}

function findMatchedDetectionGroup(
  detectionRect: { x: number; y: number; w: number; h: number },
  groups: Array<{ id: string; standardPartRect: ImageRect }>,
): { id: string; standardPartRect: ImageRect } | null {
  let matchedGroup: { id: string; standardPartRect: ImageRect } | null = null;
  let matchedScore = 0;
  const detectionArea = getRectArea(detectionRect);
  if (detectionArea <= 0) return null;

  for (const group of groups) {
    const standardPartRect = group.standardPartRect;
    const intersectionArea = getRectIntersectionArea(detectionRect, standardPartRect);
    if (intersectionArea <= 0) continue;
    const overlapRatio = intersectionArea / detectionArea;
    const centerInside = isRectCenterInside(detectionRect, standardPartRect);
    if (!centerInside && overlapRatio < 0.5) continue;

    const score = overlapRatio + (centerInside ? 1 : 0);
    if (score > matchedScore) {
      matchedGroup = group;
      matchedScore = score;
    }
  }

  return matchedGroup;
}

function isRectCenterInside(rect: { x: number; y: number; w: number; h: number }, container: ImageRect): boolean {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  return centerX >= container.x
    && centerX <= container.x + container.w
    && centerY >= container.y
    && centerY <= container.y + container.h;
}

function getRectIntersectionArea(
  leftRect: { x: number; y: number; w: number; h: number },
  rightRect: { x: number; y: number; w: number; h: number },
): number {
  const left = Math.max(leftRect.x, rightRect.x);
  const top = Math.max(leftRect.y, rightRect.y);
  const right = Math.min(leftRect.x + leftRect.w, rightRect.x + rightRect.w);
  const bottom = Math.min(leftRect.y + leftRect.h, rightRect.y + rightRect.h);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function getRectArea(rect: { w: number; h: number }): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

export function mapAnnotationRects(
  annotations: ComponentAnnotations,
  mapper: (rect: ImageRect) => ImageRect,
): ComponentAnnotations {
  return {
    standardPartRects: annotations.standardPartRects.map(mapper),
    deviceLabelRects: annotations.deviceLabelRects.map(mapper),
    deviceBoxRects: annotations.deviceBoxRects.map(mapper),
    appearanceRects: annotations.appearanceRects.map(mapper),
  };
}

export function getAnnotationCount(annotations: ComponentAnnotations): number {
  return annotations.standardPartRects.length
    + annotations.deviceLabelRects.length
    + annotations.deviceBoxRects.length
    + annotations.appearanceRects.length;
}

export function hasWholeGenerateReplaceableData(
  annotations: ComponentAnnotations,
  ocrRows: CabinetPointRow[],
  singlePoints: CabinetSinglePoint[],
): boolean {
  return hasGeneratedOrSavedAnnotations(annotations)
    || ocrRows.length > 0
    || singlePoints.length > 0;
}

function hasGeneratedOrSavedAnnotations(annotations: ComponentAnnotations): boolean {
  return [
    ...annotations.standardPartRects,
    ...annotations.deviceLabelRects,
    ...annotations.deviceBoxRects,
    ...annotations.appearanceRects,
  ].some((rect) => rect.saved || rect.generationStatus === "generated" || rect.generationStatus === "saved");
}

export function buildComponentPointCounts(
  components: CabinetImagePackageRecord[],
  ocrRowsByComponent: Record<string, CabinetPointRow[]>,
  singlePointsByComponent: Record<string, CabinetSinglePoint[]>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const component of components) {
    const recordKey = getCabinetRecordKey(component);
    counts[recordKey] = (ocrRowsByComponent[recordKey] || []).length
      + (singlePointsByComponent[recordKey] || []).length;
  }
  return counts;
}

function mapOcrLabelsToImageRects(labels: CabinetOcrDetectedLabel[], sources: CabinetOcrSource[]): ImageRect[] {
  const sourceMap = new Map(sources.map((source) => [source.regionId, source]));
  const labelsByRegion = new Map<string, CabinetOcrDetectedLabel[]>();
  for (const label of labels) {
    const source = sourceMap.get(label.regionId);
    if (!source) continue;
    const current = labelsByRegion.get(label.regionId) || [];
    current.push(label);
    labelsByRegion.set(label.regionId, current);
  }

  const rects: ImageRect[] = [];
  for (const source of sources) {
    const regionLabels = labelsByRegion.get(source.regionId) || [];
    if (!regionLabels.length) continue;

    if (source.targetX != null && source.targetY != null && source.targetW != null && source.targetH != null) {
      rects.push(...mapRegionLabelsBySourceRect(regionLabels, source));
    }
  }

  return rects;
}

function mapRegionLabelsBySourceRect(labels: CabinetOcrDetectedLabel[], source: CabinetOcrSource): ImageRect[] {
  const count = Math.max(labels.length, source.anchorRects?.length || 0);
  const targetX = source.targetX ?? 0;
  const targetY = source.targetY ?? 0;
  const targetW = source.targetW ?? 0;
  const targetH = source.targetH ?? 0;
  if (count <= 0) return [];

  if (source.anchorRects?.length) {
    const anchoredRects = source.anchorRects.map((anchorRect, index) => {
      const label = labels[index];
      const fallbackW = targetW / count;
      const boxW = Math.max(MIN_ANNOTATION_RECT_SIZE, Math.min(targetW, anchorRect.w || fallbackW));
      const x = Math.min(Math.max(targetX, getRectCenterX(anchorRect) - boxW / 2), targetX + targetW - boxW);
      return createOcrImageRect(label, source, index, {
        x,
        y: targetY,
        w: boxW,
        h: Math.max(MIN_ANNOTATION_RECT_SIZE, targetH),
      });
    });
    if (labels.length <= anchoredRects.length) return anchoredRects;

    const segmentW = targetW / labels.length;
    const boxW = Math.max(MIN_ANNOTATION_RECT_SIZE, segmentW * 0.72);
    return labels.slice(anchoredRects.length).reduce<ImageRect[]>((rects, label, extraIndex) => {
      const index = anchoredRects.length + extraIndex;
      const fallbackRect = createOcrImageRect(label, source, index, {
        x: targetX + segmentW * index + (segmentW - boxW) / 2,
        y: targetY,
        w: boxW,
        h: Math.max(MIN_ANNOTATION_RECT_SIZE, targetH),
      });
      return [...rects, fallbackRect];
    }, anchoredRects);
  }

  const segmentW = targetW / count;
  const boxW = Math.max(MIN_ANNOTATION_RECT_SIZE, segmentW * 0.72);
  const boxH = Math.max(MIN_ANNOTATION_RECT_SIZE, targetH);

  return labels.map((label, index) => createOcrImageRect(label, source, index, {
    x: targetX + segmentW * index + (segmentW - boxW) / 2,
    y: targetY,
    w: boxW,
    h: boxH,
  }));
}

function createOcrImageRect(
  label: CabinetOcrDetectedLabel | undefined,
  source: CabinetOcrSource,
  index: number,
  rect: { x: number; y: number; w: number; h: number },
): ImageRect {
  return {
    id: createOcrRectId(source.regionId, index),
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    text: label?.text || "",
    confidence: label?.confidence,
    source: "ocr",
    saved: false,
    generationStatus: "generated",
    groupId: source.groupId,
    generatedFromRectId: source.sourceRectId,
  };
}

function buildLabelSplitAnchorRects(labelRect: ImageRect, deviceRects: ImageRect[]): ImageRect[] {
  const alignedDeviceRects = deviceRects
    .filter((deviceRect) => {
      const overlapX = getAxisOverlap(labelRect.x, labelRect.x + labelRect.w, deviceRect.x, deviceRect.x + deviceRect.w);
      const minWidth = Math.max(1, Math.min(labelRect.w, deviceRect.w));
      const deviceCenterX = getRectCenterX(deviceRect);
      const centerInsideLabelX = deviceCenterX >= labelRect.x - deviceRect.w * 0.5
        && deviceCenterX <= labelRect.x + labelRect.w + deviceRect.w * 0.5;
      return overlapX / minWidth >= 0.25 || centerInsideLabelX;
    })
    .sort((leftRect, rightRect) => getRectCenterX(leftRect) - getRectCenterX(rightRect));

  const columns: ImageRect[] = [];
  for (const deviceRect of alignedDeviceRects) {
    const matchedColumn = columns.find((columnRect) => (
      Math.abs(getRectCenterX(columnRect) - getRectCenterX(deviceRect)) <= Math.max(columnRect.w, deviceRect.w) * 0.6
    ));
    if (!matchedColumn) {
      columns.push({ ...deviceRect });
      continue;
    }
    const right = Math.max(matchedColumn.x + matchedColumn.w, deviceRect.x + deviceRect.w);
    matchedColumn.x = Math.min(matchedColumn.x, deviceRect.x);
    matchedColumn.w = right - matchedColumn.x;
  }

  return columns.sort((leftRect, rightRect) => getRectCenterX(leftRect) - getRectCenterX(rightRect));
}

function createOcrRectId(regionId: string, index: number): string {
  return `ocr:${regionId}:${Date.now()}:${index}:${Math.random().toString(16).slice(2)}`;
}

export function createSinglePointId(): string {
  return `single-point:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function buildDeviceLabelOcrSources(
  imageDataUrl: string,
  rects: ImageRect[],
  groupByRectId?: Map<string, string>,
  deviceRects: ImageRect[] = [],
): Promise<CabinetOcrSource[]> {
  const validRects = rects.filter((rect) => rect.w >= MIN_ANNOTATION_RECT_SIZE && rect.h >= MIN_ANNOTATION_RECT_SIZE);
  return Promise.all(validRects.map(async (rect, index) => {
    const groupId = groupByRectId?.get(rect.id);
    const crop = await cropCabinetOcrImage(imageDataUrl, rect);
    return {
      regionId: `region_${index + 1}`,
      title: `标签区域 ${index + 1}`,
      dataUrl: crop.dataUrl,
      originX: crop.originX,
      originY: crop.originY,
      width: crop.width,
      height: crop.height,
      targetX: rect.x,
      targetY: rect.y,
      targetW: rect.w,
      targetH: rect.h,
      sourceRectId: rect.id,
      groupId,
      anchorRects: buildLabelSplitAnchorRects(rect, deviceRects.filter((deviceRect) => deviceRect.groupId && deviceRect.groupId === groupId)),
    };
  }));
}

