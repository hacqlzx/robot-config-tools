import { detectCabinetDevices } from "../services/device-detection-service";
import type { DeviceDetection } from "../services/device-detection-service";
import {
  CABINET_OCR_NORMALIZED_COORDINATE_MAX,
  cropCabinetOcrImage,
  recognizeCabinetFacadeLabels,
  recognizeCabinetLabels,
} from "../services/ocr-service";
import type { CabinetOcrDetectedLabel } from "../services/ocr-service";
import { throwIfRecognitionCancelled } from "../services/recognition-request";
import { buildCabinetGeneratedPointName } from "@/shared/cabinet-detection";
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
  roi?: { x: number; y: number; w: number; h: number };
  targetX?: number;
  targetY?: number;
  targetW?: number;
  targetH?: number;
  sourceRectId?: string;
  groupId?: string;
  masked?: boolean;
  sourceMode?: "crop" | "masked-whole";
  coordinateMode?: "original" | "crop-local";
}

export interface ComponentRecognitionResult {
  annotations: ComponentAnnotations;
  rows: CabinetPointRow[];
  singlePoints: CabinetSinglePoint[];
  labelCount: number;
  deviceCount: number;
  emptyNameCount: number;
  unboundLabelCount: number;
  unboundDeviceCount: number;
  inferredLabelCount: number;
  warning?: string;
}

interface PointRowsWithDiagnostics {
  rows: CabinetPointRow[];
  emptyNameCount: number;
  unboundLabelCount: number;
  unboundDeviceCount: number;
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

/**
 * 屏柜部件的多点识别主流程。
 *
 * 整图模式只保留用户手工输入的框作为识别条件，新增模式只处理未生成过的手工框。
 * 常规场景会先调用设备检测识别设备类型，再对用户框选的标签区域做 OCR，
 * 最后把标签框、设备框按空间关系组合成右侧点位表。
 */
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

  // 设备检测按整图返回，后续只保留落在本次标准部件框内的设备框。
  const preDetectionGroups = validation.groups.map((group) => ({
    ...group,
    deviceRects: [] as ImageRect[],
  }));
  const response = await detectCabinetDevices(imageDataUrl, { signal });
  if (response.issues.length) throw new Error(response.issues[0]);
  throwIfRecognitionCancelled(signal);

  const generationKey = Date.now();
  const aiDeviceRects = mapDeviceDetectionsToImageRects(response.detections, preDetectionGroups, generationKey);

  const groupByInputLabelId = new Map<string, string>();
  for (const group of validation.groups) {
    for (const label of group.labelRects) groupByInputLabelId.set(label.id, group.id);
  }
  // 标签 OCR 会传入用户框选区域对应的 ROI，回包再映射回原图坐标。
  const sources = await buildDeviceLabelOcrSources(imageDataUrl, targetLabels, groupByInputLabelId);
  throwIfRecognitionCancelled(signal);
  console.info("[screen-verify] label OCR request params", {
    mode,
    imageSize: getDebugImageSize(sources),
    selectedDeviceLabelRects: targetLabels.map(toDebugRect),
    selectedStandardPartRects: targetStandardPartRects.map(toDebugRect),
    requestRois: sources.map(toDebugOcrSource),
    aiDeviceRects: aiDeviceRects.map(toDebugRect),
  });
  const ocrResult = await recognizeCabinetLabels(sources.map((source) => ({
    regionId: source.regionId,
    title: source.title,
    dataUrl: source.dataUrl,
    roi: source.roi,
    width: source.width,
    height: source.height,
    coordinateMode: source.coordinateMode,
  })), { signal });
  const mappedLabelRects = mapOcrLabelsToImageRects(ocrResult.labels, sources);
  const recognizedLabelRects = selectRecognitionLabelRectsForDeviceRows(mappedLabelRects, aiDeviceRects, validation.groups);
  // 设备漏识别时，用已识别标签行的列信息自动补充设备框。
  const generatedDeviceRects = completeDeviceBoxesByOcrRows(aiDeviceRects, recognizedLabelRects, validation.groups, generationKey);
  // 标签漏识别时，反向使用设备列补充空标签框，保证每个设备都有对应点位。
  const completedLabelRects = completeLabelBoxesByDeviceRows(
    recognizedLabelRects,
    generatedDeviceRects,
    validation.groups,
    generationKey,
  );
  console.info("[screen-verify] label OCR response params", {
    mode,
    imageSize: getDebugImageSize(sources),
    sources: sources.map(toDebugOcrSource),
    rawText: ocrResult.rawText,
    regions: ocrResult.regions,
    labels: ocrResult.labels,
    mappedRects: mappedLabelRects,
    filteredRects: recognizedLabelRects,
  });
  if (!recognizedLabelRects.length) throw new Error("未识别到标签");

  const recognizedGroups = validation.groups
    .map((group) => ({
      ...group,
      labelRects: completedLabelRects.filter((rect) => rect.groupId === group.id),
      deviceRects: generatedDeviceRects.filter((rect) => rect.groupId === group.id),
    }))
    .filter((group) => group.labelRects.length > 0 || group.deviceRects.length > 0);

  const recognizedSourceRectIds = new Set(
    recognizedLabelRects.map((rect) => rect.generatedFromRectId).filter(Boolean) as string[],
  );
  const affectedGroupIds = new Set(recognizedGroups.map((group) => group.id));
  console.info("[screen-verify] device detection result", {
    mode,
    rawDetections: response.detections,
    matchedRects: aiDeviceRects,
    completedRects: generatedDeviceRects,
    inferredRects: generatedDeviceRects.filter((rect) => rect.source === "inferred").map(toDebugRect),
    completedLabels: completedLabelRects.map(toDebugRect),
    inferredLabels: completedLabelRects.filter((rect) => rect.source === "inferred").map(toDebugRect),
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
      ...completedLabelRects,
    ],
    deviceBoxRects: [
      ...working.deviceBoxRects,
      ...generatedDeviceRects,
    ],
  };
  const recognizedPointRows = buildRowsFromRecognitionGroups(recognizedGroups);
  const recognizedRows = recognizedPointRows.rows;
  const nextRows = applyCabinetGeneratedPointNames(mode === "whole" ? recognizedRows : [...existingRows, ...recognizedRows]);
  const nextSinglePoints = mode === "whole" ? [] : existingSinglePoints;

  return {
    annotations: nextAnnotations,
    rows: nextRows,
    singlePoints: nextSinglePoints,
    labelCount: recognizedLabelRects.length,
    deviceCount: generatedDeviceRects.length,
    emptyNameCount: recognizedPointRows.emptyNameCount,
    unboundLabelCount: recognizedPointRows.unboundLabelCount,
    unboundDeviceCount: recognizedPointRows.unboundDeviceCount,
    inferredLabelCount: completedLabelRects.filter((rect) => rect.source === "inferred").length,
    warning: generatedDeviceRects.length
      ? undefined
      : `已识别 ${recognizedLabelRects.length} 个标签，未识别到部件框`,
  };
}

/**
 * 外观识别场景：用户框选外观框和名称标签框，不走设备检测，
 * 直接把外观框当成一个设备目标，再用 OCR 识别名称。
 */
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
  console.info("[screen-verify] facade label OCR request params", {
    mode,
    imageSize: getDebugImageSize(sources),
    selectedDeviceLabelRects: targetLabels.map(toDebugRect),
    selectedAppearanceRects: targetAppearanceRects.map(toDebugRect),
    requestRois: sources.map(toDebugOcrSource),
  });
  const ocrResult = await recognizeCabinetFacadeLabels(sources.map((source) => ({
    regionId: source.regionId,
    title: source.title,
    dataUrl: source.dataUrl,
    roi: source.roi,
    width: source.width,
    height: source.height,
    coordinateMode: source.coordinateMode,
  })), { signal });
  const recognizedLabelRects = mapOcrLabelsToImageRects(ocrResult.labels, sources);
  const completedLabelRects = completeLabelBoxesByDeviceRows(
    recognizedLabelRects,
    facadeDeviceRects,
    [{ id: groupId }],
    generationKey,
  );
  console.info("[screen-verify] facade label OCR response params", {
    mode,
    imageSize: getDebugImageSize(sources),
    sources: sources.map(toDebugOcrSource),
    rawText: ocrResult.rawText,
    regions: ocrResult.regions,
    labels: ocrResult.labels,
    mappedRects: recognizedLabelRects,
    completedLabelRects,
    facadeDeviceRects,
  });
  if (!completedLabelRects.length) throw new Error("未识别到标签");

  const recognizedSourceRectIds = new Set(
    completedLabelRects.map((rect) => rect.generatedFromRectId).filter(Boolean) as string[],
  );
  const facadeRectIds = new Set(facadeDeviceRects.map((rect) => rect.id));
  const nextAnnotations: ComponentAnnotations = {
    ...working,
    deviceLabelRects: [
      ...working.deviceLabelRects.filter((rect) => !recognizedSourceRectIds.has(rect.id)),
      ...completedLabelRects,
    ],
    appearanceRects: working.appearanceRects.map((rect) => (
      facadeRectIds.has(rect.id)
        ? createFacadeDeviceRect(rect, groupId)
        : rect
    )),
  };
  const recognizedPointRows = buildRowsFromRecognizedLabels(completedLabelRects, facadeDeviceRects, "appearance");
  const recognizedRows = recognizedPointRows.rows;
  const nextRows = applyCabinetGeneratedPointNames(mode === "whole" ? recognizedRows : [...existingRows, ...recognizedRows]);
  const nextSinglePoints = mode === "whole" ? [] : existingSinglePoints;

  return {
    annotations: nextAnnotations,
    rows: nextRows,
    singlePoints: nextSinglePoints,
    labelCount: recognizedLabelRects.length,
    deviceCount: facadeDeviceRects.length,
    emptyNameCount: recognizedPointRows.emptyNameCount,
    unboundLabelCount: recognizedPointRows.unboundLabelCount,
    unboundDeviceCount: recognizedPointRows.unboundDeviceCount,
    inferredLabelCount: completedLabelRects.filter((rect) => rect.source === "inferred").length,
  };
}

/**
 * 整图重新识别会清空当前图片旧结果，只保留本次新框选且尚未保存的手工输入框。
 *
 * 保存过的手工框也属于旧结果，不能继续作为输入条件，否则确认弹窗里的“删除旧框”不会真正生效。
 */
function retainRecognitionInputAnnotations(annotations: ComponentAnnotations): ComponentAnnotations {
  return {
    standardPartRects: annotations.standardPartRects.filter(isPendingManualRect),
    deviceLabelRects: annotations.deviceLabelRects.filter(isPendingManualRect),
    deviceBoxRects: annotations.deviceBoxRects.filter(isPendingManualRect),
    appearanceRects: annotations.appearanceRects.filter(isPendingManualRect),
  };
}

/**
 * 根据识别模式筛选本次需要处理的目标框。
 */
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

/**
 * 给按钮状态使用的轻量校验，只判断是否具备发起识别的必要框。
 */
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
    deviceName: FACADE_TARGET_TYPE.deviceName,
  };
}

/**
 * 把算法返回的设备检测结果转换为画布框，并匹配到当前标准部件组。
 */
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
    const deviceName = targetType?.deviceName || "";
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
      deviceName,
    });
  }
  return rects;
}

/**
 * 根据标签行补齐设备框。
 *
 * 只有同组内标签和设备数量、行关系不一致时才补框；
 * 补出来的设备框会继承同一行已有设备的类型，用虚线展示。
 */
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

    const deviceRows = splitRectRows(groupDeviceRects);
    const labelRows = selectRelevantLabelRowsForDeviceRows(splitRectRows(groupLabelRects), deviceRows);
    if (!hasDeviceLabelCountMismatch(labelRows, deviceRows)) continue;

    const completedRows = completeDeviceRowsByLabelRows(
      labelRows,
      deviceRows,
      group.standardPartRect,
      generationKey,
    );
    const completedGroupDeviceRects = completedRows.flat();
    result = [
      ...result.filter((rect) => rect.groupId !== group.id),
      ...completedGroupDeviceRects,
    ];
  }
  return sortRectsByPosition(result);
}

/**
 * 根据设备列反向补齐标签框。
 *
 * 当标签少于设备时，优先按“相关设备行中的最大列数”作为目标数量。
 * 一排标签同时对应上下两排设备时，只补一套共享标签列，后续绑定时复用到上下两排。
 */
function completeLabelBoxesByDeviceRows(
  labelRects: ImageRect[],
  deviceRects: ImageRect[],
  groups: Array<{ id: string; standardPartRect?: ImageRect }>,
  generationKey: number,
): ImageRect[] {
  let result = [...labelRects];
  const groupEntries = [
    ...groups,
    { id: "ungrouped", standardPartRect: undefined },
  ];
  let inferredRowIndex = 0;

  for (const group of groupEntries) {
    const groupLabels = result.filter((rect) => (
      group.id === "ungrouped" ? !rect.groupId : rect.groupId === group.id
    ));
    const groupDevices = deviceRects.filter((rect) => (
      group.id === "ungrouped" ? !rect.groupId : rect.groupId === group.id
    ));
    if (!groupLabels.length || !groupDevices.length) continue;

    const deviceRows = splitRectRows(groupDevices);
    const candidateLabelRows = selectRelevantLabelRowsForDeviceRows(splitRectRows(groupLabels), deviceRows);
    const selectedLabelIds = new Set(candidateLabelRows.flat().map((rect) => rect.id));
    const completedLabelRows: ImageRect[][] = [];

    for (const labelRow of candidateLabelRows) {
      const sortedLabels = sortRectsByCenterX(labelRow);
      const relatedRows = uniqueRectRows(findRelatedDeviceRowsForLabelRow(sortedLabels, deviceRows));
      // 一个真实标签可能同时描述同一部件框内的多个设备。
      // 这种情况下标签应被多个设备共享，不能因为数量少于设备框而生成虚线补标签。
      if (shouldShareLabelAcrossDeviceRows(sortedLabels, relatedRows)) {
        console.info("[screen-verify] shared label matched multiple devices", {
          labelRects: sortedLabels.map(toDebugRect),
          deviceRows: relatedRows.map((row) => row.map(toDebugRect)),
        });
        completedLabelRows.push(sortedLabels);
        continue;
      }
      const targetCount = relatedRows.reduce((maxCount, row) => Math.max(maxCount, row.length), 0);
      if (!relatedRows.length || targetCount <= sortedLabels.length) {
        completedLabelRows.push(sortedLabels);
        continue;
      }

      completedLabelRows.push(fillLabelRowToDeviceColumns(
        sortedLabels,
        relatedRows,
        group.standardPartRect,
        generationKey,
        inferredRowIndex,
      ));
      inferredRowIndex += 1;
    }

    if (!completedLabelRows.length) continue;
    result = [
      ...result.filter((rect) => !selectedLabelIds.has(rect.id)),
      ...completedLabelRows.flat(),
    ];
  }

  return sortRectsByPosition(result);
}

/**
 * 将已有标签列和设备列做保序匹配，未匹配到的设备列生成空标签框。
 */
function fillLabelRowToDeviceColumns(
  labelRow: ImageRect[],
  relatedDeviceRows: ImageRect[][],
  container: ImageRect | undefined,
  generationKey: number,
  rowIndex: number,
): ImageRect[] {
  const sortedLabels = sortRectsByCenterX(labelRow);
  const targetCenters = getDeviceColumnCenters(relatedDeviceRows);
  if (!targetCenters.length || targetCenters.length <= sortedLabels.length) return sortedLabels;

  const matchedColumnIndexes = matchLabelColumnsToTargetCenters(sortedLabels, targetCenters);
  const matchedColumns = new Set(matchedColumnIndexes);
  const template = sortedLabels.length
    ? sortedLabels[Math.floor(sortedLabels.length / 2)]
    : sortRectsByCenterX(relatedDeviceRows.flat())[Math.floor(relatedDeviceRows.flat().length / 2)];
  if (!template) return sortedLabels;

  const inferredLabels = targetCenters
    .map((centerX, columnIndex) => {
      if (matchedColumns.has(columnIndex)) return null;
      return createInferredLabelRectAtCenter(
        template,
        centerX,
        container,
        generationKey,
        rowIndex,
        columnIndex,
      );
    })
    .filter((rect): rect is ImageRect => Boolean(rect));

  return sortRectsByCenterX([...sortedLabels, ...inferredLabels]);
}

function getDeviceColumnCenters(deviceRows: ImageRect[][]): number[] {
  const sortedRows = deviceRows
    .map(sortRectsByCenterX)
    .filter((row) => row.length > 0);
  if (!sortedRows.length) return [];

  const targetCount = Math.max(...sortedRows.map((row) => row.length));
  const referenceRows = sortedRows.filter((row) => row.length === targetCount);
  return Array.from({ length: targetCount }, (_, columnIndex) => {
    const centers = referenceRows
      .map((row) => row[columnIndex])
      .filter(Boolean)
      .map(getRectCenterX);
    return median(centers);
  });
}

/**
 * 动态规划寻找最小列偏移的保序匹配，能识别首部、中间和尾部漏标签。
 */
function matchLabelColumnsToTargetCenters(labelRow: ImageRect[], targetCenters: number[]): number[] {
  const labels = sortRectsByCenterX(labelRow);
  const labelCount = labels.length;
  const targetCount = targetCenters.length;
  if (!labelCount || !targetCount) return [];
  if (labelCount >= targetCount) return Array.from({ length: targetCount }, (_, index) => index);

  const costs = Array.from({ length: labelCount + 1 }, () => (
    Array<number>(targetCount + 1).fill(Number.POSITIVE_INFINITY)
  ));
  const choices = Array.from({ length: labelCount + 1 }, () => (
    Array<"skip" | "match" | ""> (targetCount + 1).fill("")
  ));
  for (let columnIndex = 0; columnIndex <= targetCount; columnIndex += 1) {
    costs[0][columnIndex] = 0;
  }

  for (let labelIndex = 1; labelIndex <= labelCount; labelIndex += 1) {
    for (let columnIndex = 1; columnIndex <= targetCount; columnIndex += 1) {
      const skipCost = costs[labelIndex][columnIndex - 1];
      const matchCost = costs[labelIndex - 1][columnIndex - 1]
        + Math.abs(getRectCenterX(labels[labelIndex - 1]) - targetCenters[columnIndex - 1]);
      if (skipCost <= matchCost) {
        costs[labelIndex][columnIndex] = skipCost;
        choices[labelIndex][columnIndex] = "skip";
      } else {
        costs[labelIndex][columnIndex] = matchCost;
        choices[labelIndex][columnIndex] = "match";
      }
    }
  }

  const matched: number[] = [];
  let labelIndex = labelCount;
  let columnIndex = targetCount;
  while (labelIndex > 0 && columnIndex > 0) {
    if (choices[labelIndex][columnIndex] === "match") {
      matched.unshift(columnIndex - 1);
      labelIndex -= 1;
      columnIndex -= 1;
    } else {
      columnIndex -= 1;
    }
  }
  return matched;
}

function createInferredLabelRectAtCenter(
  template: ImageRect,
  centerX: number,
  container: ImageRect | undefined,
  generationKey: number,
  rowIndex: number,
  columnIndex: number,
): ImageRect {
  const width = Math.max(MIN_ANNOTATION_RECT_SIZE, template.w);
  const height = Math.max(MIN_ANNOTATION_RECT_SIZE, template.h);
  const boundedCenterX = container
    ? clampNumber(
      centerX,
      container.x + width / 2,
      container.x + container.w - width / 2,
    )
    : centerX;
  return {
    ...template,
    id: `inferred-label:${generationKey}:${rowIndex}:${columnIndex}:${Math.random().toString(16).slice(2)}`,
    x: boundedCenterX - width / 2,
    y: template.y,
    w: width,
    h: height,
    text: "",
    confidence: undefined,
    source: "inferred",
    saved: false,
    generationStatus: "generated",
    groupId: template.groupId,
    generatedFromRectId: undefined,
  };
}

/**
 * 判断标签行和设备行是否存在数量或关系不一致。
 * 支持“一排标签对应上下两排设备”的情况，因此会把相关设备行合并计数。
 */
function hasDeviceLabelCountMismatch(labelRows: ImageRect[][], deviceRows: ImageRect[][]): boolean {
  if (!labelRows.length || !deviceRows.length) return false;
  const deviceRowsById = new Map(deviceRows.map((row) => [getRectRowKey(row), row]));
  const usedDeviceRowKeys = new Set<string>();

  for (const labelRow of labelRows) {
    const relatedRows = findRelatedDeviceRowsForLabelRow(labelRow, deviceRows);
    if (!relatedRows.length) return true;
    const uniqueRelatedRows = uniqueRectRows(relatedRows);
    if (shouldShareLabelAcrossDeviceRows(labelRow, uniqueRelatedRows)) {
      uniqueRelatedRows.forEach((row) => usedDeviceRowKeys.add(getRectRowKey(row)));
      continue;
    }
    const relatedDeviceCount = uniqueRelatedRows.reduce((sum, row) => sum + row.length, 0);
    if (relatedDeviceCount !== labelRow.length * uniqueRelatedRows.length) return true;
    uniqueRelatedRows.forEach((row) => usedDeviceRowKeys.add(getRectRowKey(row)));
  }

  return [...deviceRowsById.keys()].some((key) => !usedDeviceRowKeys.has(key));
}

/**
 * 逐行补齐设备框，使每个相关设备行尽量和标签列一一对应。
 */
function completeDeviceRowsByLabelRows(
  labelRows: ImageRect[][],
  deviceRows: ImageRect[][],
  container: ImageRect,
  generationKey: number,
): ImageRect[][] {
  const resultRows = sortRectRowsByPosition(deviceRows);
  let inferredRowIndex = 0;

  for (const labelRow of labelRows) {
    const sortedLabels = sortRectsByCenterX(labelRow);
    const relatedRows = uniqueRectRows(findRelatedDeviceRowsForLabelRow(sortedLabels, resultRows));
    for (const deviceRow of relatedRows) {
      const rowIndexInResult = findMatchingDeviceRowIndex(resultRows, deviceRow);
      if (rowIndexInResult < 0) continue;
      const currentRow = resultRows[rowIndexInResult];
      if (currentRow.length === sortedLabels.length) {
        continue;
      }
      const rowTypeTemplate = getRowDeviceTypeTemplate(currentRow);
      resultRows[rowIndexInResult] = fillRowToMatchLabels(
        currentRow,
        sortedLabels,
        container,
        generationKey,
        inferredRowIndex,
        rowTypeTemplate,
      );
      inferredRowIndex += 1;
    }
  }

  return sortRectRowsByPosition(resultRows);
}

function getRectRowKey(row: ImageRect[]): string {
  return sortRectsByCenterX(row).map((rect) => rect.id).join("|");
}

function findMatchingDeviceRowIndex(rows: ImageRect[][], targetRow: ImageRect[]): number {
  const targetIds = new Set(targetRow.map((rect) => rect.id));
  return rows.findIndex((row) => row.some((rect) => targetIds.has(rect.id)));
}

function sortRectRowsByPosition(rows: ImageRect[][]): ImageRect[][] {
  return [...rows]
    .map(sortRectsByCenterX)
    .sort((leftRow, rightRow) => median(leftRow.map(getRectCenterY)) - median(rightRow.map(getRectCenterY)));
}

function getRowDeviceTypeTemplate(row: ImageRect[]): Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> {
  const sortedRow = sortRectsByCenterX(row);
  const recognized = sortedRow.find((rect) => rect.deviceName || rect.recognitionLabel || rect.recognitionLabelDesc || rect.text);
  return {
    text: recognized?.text,
    recognitionLabel: recognized?.recognitionLabel,
    recognitionLabelDesc: recognized?.recognitionLabelDesc,
    deviceName: recognized?.deviceName,
  };
}

/**
 * 单行补框入口：先处理中间大空洞，再处理首尾或剩余缺口。
 */
function fillRowToMatchLabels(
  row: ImageRect[],
  labelRow: ImageRect[],
  container: ImageRect,
  generationKey: number,
  rowIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName">,
): ImageRect[] {
  let result = fillLargeGapsInRow(row, generationKey, rowIndex, typeTemplate, labelRow.length);
  if (result.length >= labelRow.length) return result;
  return fillRowToTargetCount(
    result,
    labelRow.length,
    container,
    generationKey,
    rowIndex,
    typeTemplate,
    labelRow,
  );
}

/**
 * 处理两侧已有框、中间漏识别的情况。
 * 平均列距会过滤异常大间隔，所以 currentSpacing 远大于平均列距时可认为中间缺框。
 */
function fillLargeGapsInRow(
  row: ImageRect[],
  generationKey: number,
  rowIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
  maxCount = Number.POSITIVE_INFINITY,
): ImageRect[] {
  const sortedRow = sortRectsByCenterX(row);
  if (sortedRow.length < 2) return sortedRow;

  const avgSpacing = getAvgCenterSpacing(sortedRow);
  if (!avgSpacing || avgSpacing <= 0) return sortedRow;

  const result: ImageRect[] = [];
  let inferredIndex = 0;
  const maxInferredCount = Math.max(0, maxCount - sortedRow.length);
  for (let index = 0; index < sortedRow.length - 1; index += 1) {
    const leftRect = sortedRow[index];
    const rightRect = sortedRow[index + 1];
    result.push(leftRect);

    const currentSpacing = getRectCenterX(rightRect) - getRectCenterX(leftRect);
    if (currentSpacing <= avgSpacing * 1.5) continue;

    const numToAdd = Math.min(
      Math.max(0, Math.round(currentSpacing / avgSpacing) - 1),
      maxInferredCount - inferredIndex,
    );
    if (numToAdd <= 0) continue;
    const spacingStep = currentSpacing / (numToAdd + 1);
    for (let offset = 1; offset <= numToAdd; offset += 1) {
      result.push(createInferredDeviceRectBetween(
        leftRect,
        rightRect,
        getRectCenterX(leftRect) + spacingStep * offset,
        generationKey,
        rowIndex,
        inferredIndex,
        typeTemplate,
      ));
      inferredIndex += 1;
      if (inferredIndex >= maxInferredCount) break;
    }
  }
  result.push(sortedRow[sortedRow.length - 1]);
  return sortRectsByCenterX(result);
}

/**
 * 大间隔处理后数量仍不足时，枚举最左、最右和中间候选位置，按评分选择最佳插入点。
 */
function fillRowToTargetCount(
  row: ImageRect[],
  targetCount: number,
  container: ImageRect,
  generationKey: number,
  rowIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
  labelRow: ImageRect[] = [],
): ImageRect[] {
  let result = sortRectsByCenterX(row);
  let avgSpacing = getRowFillSpacing(result, targetCount, labelRow);
  if (!avgSpacing || avgSpacing <= 0) return result;

  let inferredIndex = 0;
  while (result.length < targetCount) {
    const insertion = findBestDeviceInsertion(result, avgSpacing, container, generationKey, rowIndex, inferredIndex, typeTemplate, labelRow);
    if (!insertion) break;
    result = [
      ...result.slice(0, insertion.index),
      insertion.rect,
      ...result.slice(insertion.index),
    ];
    result = sortRectsByCenterX(result);
    avgSpacing = getRowFillSpacing(result, targetCount, labelRow) || avgSpacing;
    inferredIndex += 1;
  }
  return result;
}

/**
 * 为补框候选位置打分：列距越均匀、越贴近标签列，分数越低。
 */
function findBestDeviceInsertion(
  row: ImageRect[],
  avgSpacing: number,
  container: ImageRect,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
  labelRow: ImageRect[] = [],
): { index: number; rect: ImageRect } | null {
  if (!row.length) return null;
  const sortedRow = sortRectsByCenterX(row);
  const candidates: { index: number; rect: ImageRect; score: number }[] = [];

  for (let index = 0; index <= sortedRow.length; index += 1) {
    const rect = createInsertionCandidateRect(sortedRow, index, avgSpacing, generationKey, rowIndex, inferredIndex, typeTemplate, labelRow);
    if (!rect || !containsRect(container, rect)) continue;
    const candidateRow = sortRectsByCenterX([
      ...sortedRow.slice(0, index),
      rect,
      ...sortedRow.slice(index),
    ]);
    candidates.push({
      index,
      rect,
      score: getSpacingUniformityScore(candidateRow, avgSpacing) + getLabelColumnAlignmentScore(candidateRow, labelRow),
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
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
  labelRow: ImageRect[] = [],
): ImageRect | null {
  const sortedRow = sortRectsByCenterX(row);
  const template = sortedRow[index] || sortedRow[index - 1];
  if (!template) return null;

  let centerX: number;
  const targetLabel = labelRow[index];
  if (targetLabel) {
    centerX = getRectCenterX(targetLabel);
  } else if (index === 0) {
    centerX = getRectCenterX(sortedRow[0]) - avgSpacing;
  } else if (index === sortedRow.length) {
    centerX = getRectCenterX(sortedRow[sortedRow.length - 1]) + avgSpacing;
  } else {
    centerX = (getRectCenterX(sortedRow[index - 1]) + getRectCenterX(sortedRow[index])) / 2;
  }

  return createInferredDeviceRectFromTemplate(template, centerX, generationKey, rowIndex, inferredIndex, typeTemplate);
}

function createInferredDeviceRectBetween(
  leftRect: ImageRect,
  rightRect: ImageRect,
  centerX: number,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
): ImageRect {
  const template = getRectArea(leftRect) >= getRectArea(rightRect) ? leftRect : rightRect;
  const inferred = createInferredDeviceRectFromTemplate(template, centerX, generationKey, rowIndex, inferredIndex, typeTemplate);
  inferred.y = (leftRect.y + rightRect.y) / 2;
  return inferred;
}

function createInferredDeviceRectFromTemplate(
  template: ImageRect,
  centerX: number,
  generationKey: number,
  rowIndex: number,
  inferredIndex: number,
  typeTemplate: Pick<ImageRect, "text" | "recognitionLabel" | "recognitionLabelDesc" | "deviceName"> = {},
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
    text: typeTemplate.text || template.text,
    recognitionLabel: typeTemplate.recognitionLabel || template.recognitionLabel,
    recognitionLabelDesc: typeTemplate.recognitionLabelDesc || template.recognitionLabelDesc,
    deviceName: typeTemplate.deviceName || template.deviceName,
  };
}

/**
 * 按纵向中心把框拆成多行。屏柜设备通常按水平行排列，后续补框和排序都以行为基本单位。
 */
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

/**
 * 计算同一行的平均列间距，并过滤疑似漏框造成的异常大间距。
 */
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

function getRowFillSpacing(row: ImageRect[], targetCount: number, labelRow: ImageRect[] = []): number {
  const sortedRow = sortRectsByCenterX(row);
  const sortedLabels = sortRectsByCenterX(labelRow);
  if (sortedLabels.length >= 2) {
    const labelSpacing = getAvgCenterSpacing(sortedLabels);
    if (labelSpacing > 0) return labelSpacing;
  }
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

function getLabelColumnAlignmentScore(deviceRow: ImageRect[], labelRow: ImageRect[]): number {
  if (!labelRow.length) return 0;
  const sortedDevices = sortRectsByCenterX(deviceRow);
  const sortedLabels = sortRectsByCenterX(labelRow);
  const maxCount = Math.min(sortedDevices.length, sortedLabels.length);
  let score = 0;
  for (let index = 0; index < maxCount; index += 1) {
    score += Math.abs(getRectCenterX(sortedDevices[index]) - getRectCenterX(sortedLabels[index]));
  }
  return score;
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sortedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

/**
 * 根据识别出的标签框和设备框生成右侧点位行。
 */
function buildRowsFromRecognizedLabels(
  labelRects: ImageRect[],
  deviceRects: ImageRect[],
  deviceTool: AnnotationTool = "deviceBox",
): PointRowsWithDiagnostics {
  if (deviceTool === "deviceBox") {
    const result = buildSortedPointRowsForGroup(labelRects, deviceRects);
    return {
      ...result,
      emptyNameCount: result.rows.filter((row) => !row.name.trim()).length,
    };
  }

  const rows: CabinetPointRow[] = [];
  const usedDeviceIds = new Set<string>();
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;
  for (const labelRect of labelRects) {
    const relatedDeviceRects = findRelatedDeviceRectsForLabel(labelRect, deviceRects)
      .filter((deviceRect) => !usedDeviceIds.has(deviceRect.id));
    if (!relatedDeviceRects.length) {
      unboundLabelCount += 1;
      continue;
    }
    relatedDeviceRects.forEach((deviceRect) => {
      usedDeviceIds.add(deviceRect.id);
      rows.push(createPointRowFromLabelAndDevice(labelRect, deviceRect, deviceTool));
    });
  }

  for (const deviceRect of deviceRects) {
    if (usedDeviceIds.has(deviceRect.id)) continue;
    usedDeviceIds.add(deviceRect.id);
    unboundDeviceCount += 1;
    rows.push(createPointRowFromLabelAndDevice(createEmptyLabelRectForDevice(deviceRect), deviceRect, deviceTool));
  }

  return {
    rows,
    emptyNameCount: rows.filter((row) => !row.name.trim()).length,
    unboundLabelCount,
    unboundDeviceCount,
  };
}

function buildRowsFromRecognitionGroups(
  groups: Array<{ labelRects: ImageRect[]; deviceRects: ImageRect[] }>,
): PointRowsWithDiagnostics {
  const rows: CabinetPointRow[] = [];
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  for (const group of groups) {
    if (!group.labelRects.length && !group.deviceRects.length) continue;
    const result = buildRowsFromRecognizedLabels(group.labelRects, group.deviceRects);
    rows.push(...result.rows);
    unboundLabelCount += result.unboundLabelCount;
    unboundDeviceCount += result.unboundDeviceCount;
  }

  return {
    rows,
    emptyNameCount: rows.filter((row) => !row.name.trim()).length,
    unboundLabelCount,
    unboundDeviceCount,
  };
}

export interface SortedPointRowsResult {
  annotations: ComponentAnnotations;
  rows: CabinetPointRow[];
  emptyNameCount: number;
  unboundLabelCount: number;
  unboundDeviceCount: number;
}

/**
 * 一键排序入口：先按标准部件框分组，再在组内按行列建立标签和设备的绑定关系。
 */
export function buildSortedPointRowsFromAnnotations(annotations: ComponentAnnotations): SortedPointRowsResult {
  const reusableLabelRects = annotations.deviceLabelRects.filter((rect) => (
    rect.source !== "inferred" || hasVisibleLabelTextRect(rect)
  ));
  const deviceAssignments = assignRectsToStandardPartGroups(annotations.deviceBoxRects, annotations.standardPartRects);
  const initialLabelAssignments = assignRectsToStandardPartGroups(reusableLabelRects, annotations.standardPartRects);
  const completedLabelRects = completeLabelBoxesByDeviceRows(
    initialLabelAssignments.rects,
    deviceAssignments.rects,
    annotations.standardPartRects.map((rect) => ({
      id: rect.id,
      standardPartRect: rect,
    })),
    Date.now(),
  );
  const labelAssignments = assignRectsToStandardPartGroups(completedLabelRects, annotations.standardPartRects);
  const hasUngroupedRects = labelAssignments.unassigned.length > 0 || deviceAssignments.unassigned.length > 0;
  const groupIds = [
    ...annotations.standardPartRects.map((rect) => rect.id),
    ...(hasUngroupedRects ? ["ungrouped"] : []),
  ];
  const rows: CabinetPointRow[] = [];
  const groupDebugs: unknown[] = [];
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  for (const groupId of groupIds) {
    const groupRect = annotations.standardPartRects.find((rect) => rect.id === groupId);
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
    groupDebugs.push({
      groupId,
      groupRect: groupRect ? toDebugRect(groupRect) : null,
      labels: labels.map(toDebugRect),
      devices: devices.map(toDebugRect),
      labelRows: splitRectRows(labels).map((row) => row.map(toDebugRect)),
      deviceRows: splitRectRows(devices).map((row) => row.map(toDebugRect)),
      resultRows: aligned.rows.map(toDebugPointRow),
      emptyRows: aligned.rows.filter((row) => !row.name.trim()).map(toDebugPointRow),
      unboundLabelCount: aligned.unboundLabelCount,
      unboundDeviceCount: aligned.unboundDeviceCount,
    });
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
  const indexedRows = applyCabinetGeneratedPointNames(rows);
  console.info("[screen-verify] one-click sort grouping detail", {
    inputCounts: {
      standardPart: annotations.standardPartRects.length,
      labels: annotations.deviceLabelRects.length,
      completedLabels: labelAssignments.rects.length,
      devices: annotations.deviceBoxRects.length,
      unassignedLabels: labelAssignments.unassigned.length,
      unassignedDevices: deviceAssignments.unassigned.length,
    },
    groups: groupDebugs,
    result: {
      rowCount: indexedRows.length,
      emptyNameCount: rows.filter((row) => !row.name.trim()).length,
      unboundLabelCount,
      unboundDeviceCount,
      rows: indexedRows.map(toDebugPointRow),
      emptyRows: indexedRows.filter((row) => !row.name.trim()).map(toDebugPointRow),
    },
  });

  return {
    annotations: nextAnnotations,
    rows: indexedRows,
    emptyNameCount: rows.filter((row) => !row.name.trim()).length,
    unboundLabelCount,
    unboundDeviceCount,
  };
}

/**
 * 组内点位生成逻辑。
 *
 * 支持 1:1、一排标签对应上下两排设备、单标签对应多个设备等场景。
 */
function buildSortedPointRowsForGroup(labelRects: ImageRect[], deviceRects: ImageRect[]): {
  rows: CabinetPointRow[];
  unboundLabelCount: number;
  unboundDeviceCount: number;
} {
  const deviceRows = splitRectRows(deviceRects);
  const rawLabelRows = selectRelevantLabelRowsForDeviceRows(splitRectRows(labelRects), deviceRows);
  const hasVisibleLabelText = rawLabelRows.some((row) => row.some((rect) => hasVisibleLabelTextRect(rect)));
  const labelRows = hasVisibleLabelText
    ? rawLabelRows.map((row) => row.filter(isUsableLabelRectForAlignment)).filter((row) => row.length)
    : rawLabelRows;
  const rows: CabinetPointRow[] = [];
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  if (!deviceRows.length) {
    return {
      rows,
      unboundLabelCount: labelRows.reduce((count, row) => count + row.length, 0),
      unboundDeviceCount: 0,
    };
  }

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
      const sortedDevices = sortRectsByCenterX(deviceRow).filter((deviceRect) => !usedDeviceIds.has(deviceRect.id));
      if (!sortedDevices.length) continue;
      const alignedRows = createAlignedRowsForLabelAndDeviceRow(sortedLabels, sortedDevices);
      rows.push(...alignedRows.rows);
      alignedRows.usedDeviceIds.forEach((id) => usedDeviceIds.add(id));
      unboundLabelCount += alignedRows.unboundLabelCount;
      unboundDeviceCount += alignedRows.unboundDeviceCount;
    }
  }

  for (const deviceRect of deviceRows.flat()) {
    if (usedDeviceIds.has(deviceRect.id)) continue;
    unboundDeviceCount += 1;
    rows.push(createPointRowFromLabelAndDevice(createEmptyLabelRectForDevice(deviceRect), deviceRect, "deviceBox"));
  }

  return { rows, unboundLabelCount, unboundDeviceCount };
}

function isUsableLabelRectForAlignment(rect: ImageRect): boolean {
  return hasVisibleLabelTextRect(rect) || rect.source === "inferred";
}

/**
 * 标签识别可能返回无关行；这里根据设备行的空间关系和文字质量选出真正参与点位绑定的标签行。
 */
function selectRelevantLabelRowsForDeviceRows(labelRows: ImageRect[][], deviceRows: ImageRect[][]): ImageRect[][] {
  if (!labelRows.length || !deviceRows.length) return labelRows;
  const visibleLabelRows = labelRows.filter((row) => row.some((rect) => hasVisibleLabelTextRect(rect)));
  const candidateRows = visibleLabelRows.length ? visibleLabelRows : labelRows;
  if (candidateRows.length <= Math.max(1, deviceRows.length)) return candidateRows;

  const selectedRows = selectBestLabelRowsForDeviceRows(candidateRows, deviceRows);
  return selectedRows.length ? sortRectRowsByPosition(selectedRows) : candidateRows;
}

function selectBestLabelRowsForDeviceRows(labelRows: ImageRect[][], deviceRows: ImageRect[][]): ImageRect[][] {
  const pairs: Array<{ labelRow: ImageRect[]; deviceRow: ImageRect[]; score: number }> = [];
  for (const labelRow of labelRows) {
    for (const deviceRow of deviceRows) {
      if (!isDeviceRowHorizontallyRelated(getRowHorizontalSpan(labelRow), deviceRow)) continue;
      pairs.push({
        labelRow,
        deviceRow,
        score: getLabelRowSelectionScore(labelRow, deviceRow),
      });
    }
  }

  pairs.sort((left, right) => left.score - right.score);
  const selectedRows: ImageRect[][] = [];
  const usedLabelRowKeys = new Set<string>();
  const usedDeviceRowKeys = new Set<string>();
  for (const pair of pairs) {
    const labelRowKey = getRectRowKey(pair.labelRow);
    const deviceRowKey = getRectRowKey(pair.deviceRow);
    if (usedLabelRowKeys.has(labelRowKey) || usedDeviceRowKeys.has(deviceRowKey)) continue;
    usedLabelRowKeys.add(labelRowKey);
    usedDeviceRowKeys.add(deviceRowKey);
    selectedRows.push(pair.labelRow);
    if (usedDeviceRowKeys.size >= deviceRows.length) break;
  }

  return selectedRows;
}

function getLabelRowSelectionScore(labelRow: ImageRect[], deviceRow: ImageRect[]): number {
  return getRowRelationScore(labelRow, deviceRow)
    + getLabelRowTextPenalty(labelRow)
    + getLabelDeviceTypePenalty(labelRow, deviceRow);
}

function getLabelDeviceTypePenalty(labelRow: ImageRect[], deviceRow: ImageRect[]): number {
  const labelCategory = getLabelRowTextCategory(labelRow);
  const deviceCategory = getDeviceRowTypeCategory(deviceRow);
  if (!labelCategory || !deviceCategory) return 0;
  return labelCategory === deviceCategory ? -50 : 160;
}

function getLabelRowTextCategory(labelRow: ImageRect[]): CabinetLabelTextCategory | "" {
  const text = labelRow.map((rect) => normalizeLabelTextForScoring(rect.text)).join("");
  if (/压板/u.test(text)) return "plate";
  if (/指示灯|LED|灯/u.test(text)) return "light";
  if (/空开|空气开关/u.test(text)) return "airSwitch";
  if (/旋钮/u.test(text)) return "knob";
  if (/钥匙|钥匙孔/u.test(text)) return "keyhole";
  if (/把手/u.test(text)) return "handle";
  return "";
}

function getDeviceRowTypeCategory(deviceRow: ImageRect[]): CabinetLabelTextCategory | "" {
  const text = deviceRow.map((rect) => normalizeLabelTextForScoring([
    rect.deviceName,
    rect.recognitionLabelDesc,
    rect.recognitionLabel,
    rect.text,
  ].filter(Boolean).join(""))).join("");
  if (/压板/u.test(text)) return "plate";
  if (/指示灯|LED|矩形灯|小灯|显示屏|灯亮|灯灭/u.test(text)) return "light";
  if (/空开/u.test(text)) return "airSwitch";
  if (/旋钮/u.test(text)) return "knob";
  if (/钥匙|钥匙孔/u.test(text)) return "keyhole";
  if (/把手/u.test(text)) return "handle";
  return "";
}

type CabinetLabelTextCategory = "plate" | "light" | "airSwitch" | "knob" | "keyhole" | "handle";

function getLabelRowTextPenalty(labelRow: ImageRect[]): number {
  const texts = labelRow.map((rect) => normalizeLabelTextForScoring(rect.text)).filter(Boolean);
  if (!texts.length) return 120;

  const combinedText = texts.join("");
  const technicalHitCount = texts.filter((text) => (
    /[#A-Z0-9]|换流|排油|油阀|电源|回路|指示|开关|合位|分位|全开|全关|闭锁|解锁/u.test(text)
  )).length;
  const shortStatusCount = texts.filter((text) => isShortStatusLabelText(text)).length;
  const usefulLength = combinedText.replace(/[①②③④⑤⑥⑦⑧⑨⑩\s]/gu, "").length;
  return Math.max(0, 8 - usefulLength) * 8
    + Math.max(0, 2 - technicalHitCount) * 24
    + shortStatusCount * 40;
}

function normalizeLabelTextForScoring(text: string | undefined): string {
  return String(text || "").replace(/\s+/g, "").trim();
}

function isShortStatusLabelText(text: string): boolean {
  return /^([①②③④⑤⑥⑦⑧⑨⑩\d]+[开停合断亮灭])+$/u.test(text)
    || /^(阀门|开启|停止|关闭|解锁|闭锁|A相|B相|C相)$/u.test(text);
}

/**
 * 单个标签行和单个设备行的绑定。
 * 数量一致时直接按列绑定；数量不一致时先判断单标签多设备，再按最近列匹配。
 */
function createAlignedRowsForLabelAndDeviceRow(labelRow: ImageRect[], deviceRow: ImageRect[]): {
  rows: CabinetPointRow[];
  usedDeviceIds: Set<string>;
  unboundLabelCount: number;
  unboundDeviceCount: number;
} {
  const rows: CabinetPointRow[] = [];
  const usedDeviceIds = new Set<string>();
  const usedLabelIds = new Set<string>();
  const sortedLabels = sortRectsByCenterX(labelRow);
  const sortedDevices = sortRectsByCenterX(deviceRow);
  let unboundLabelCount = 0;
  let unboundDeviceCount = 0;

  if (shouldUseSingleLabelForMultipleDevices(sortedLabels, sortedDevices)) {
    sortedDevices.forEach((deviceRect) => {
      usedDeviceIds.add(deviceRect.id);
      usedLabelIds.add(sortedLabels[0].id);
      rows.push(createPointRowFromLabelAndDevice(sortedLabels[0], deviceRect, "deviceBox"));
    });
    return { rows, usedDeviceIds, unboundLabelCount: 0, unboundDeviceCount: 0 };
  }

  if (sortedLabels.length === sortedDevices.length) {
    sortedDevices.forEach((deviceRect, index) => {
      usedDeviceIds.add(deviceRect.id);
      usedLabelIds.add(sortedLabels[index].id);
      rows.push(createPointRowFromLabelAndDevice(sortedLabels[index], deviceRect, "deviceBox"));
    });
    return { rows, usedDeviceIds, unboundLabelCount: 0, unboundDeviceCount: 0 };
  }

  for (const deviceRect of sortedDevices) {
    const labelRect = findBestLabelForDeviceRect(deviceRect, sortedLabels, usedLabelIds);
    if (!labelRect) {
      unboundDeviceCount += 1;
      rows.push(createPointRowFromLabelAndDevice(createEmptyLabelRectForDevice(deviceRect), deviceRect, "deviceBox"));
      usedDeviceIds.add(deviceRect.id);
      continue;
    }

    usedLabelIds.add(labelRect.id);
    usedDeviceIds.add(deviceRect.id);
    rows.push(createPointRowFromLabelAndDevice(labelRect, deviceRect, "deviceBox"));
  }

  for (const labelRect of sortedLabels) {
    if (usedLabelIds.has(labelRect.id)) continue;
    unboundLabelCount += 1;
    rows.push(createPointRowFromLabelAndDevice(labelRect, null, "deviceBox"));
  }

  return { rows, usedDeviceIds, unboundLabelCount, unboundDeviceCount };
}

/**
 * 识别单标签对应多个设备的特殊场景。
 *
 * 典型例子是一个铭牌描述同一个局部区域，下面或旁边同时有指示灯、旋钮等多个设备。
 * 判断时要求设备簇足够紧凑，并且和标签在水平、垂直方向都保持局部关联。
 */
function shouldUseSingleLabelForMultipleDevices(labelRow: ImageRect[], deviceRow: ImageRect[]): boolean {
  if (labelRow.length !== 1 || deviceRow.length <= 1) return false;
  const labelRect = labelRow[0];
  if (!hasVisibleLabelTextRect(labelRect)) return false;

  const deviceSpan = getRowHorizontalSpan(deviceRow);
  const deviceCenterX = (deviceSpan.left + deviceSpan.right) / 2;
  const labelCenterX = getRectCenterX(labelRect);
  const labelCenterY = getRectCenterY(labelRect);
  const deviceCenterY = median(deviceRow.map(getRectCenterY));
  const medianDeviceWidth = Math.max(MIN_ANNOTATION_RECT_SIZE, getMedianRectWidth(deviceRow));
  const medianDeviceHeight = Math.max(MIN_ANNOTATION_RECT_SIZE, median(deviceRow.map((rect) => rect.h)));
  const deviceSpanWidth = Math.max(0, deviceSpan.right - deviceSpan.left);
  const compactSpanLimit = Math.max(labelRect.w * 4, medianDeviceWidth * deviceRow.length * 2.2);
  if (deviceSpanWidth > compactSpanLimit) return false;

  const nearestDeviceDistanceX = Math.min(...deviceRow.map((deviceRect) => Math.abs(getRectCenterX(deviceRect) - labelCenterX)));
  const expandedLabelLeft = labelRect.x - Math.max(labelRect.w, medianDeviceWidth);
  const expandedLabelRight = labelRect.x + labelRect.w + Math.max(labelRect.w, medianDeviceWidth);
  const expandedOverlap = getAxisOverlap(expandedLabelLeft, expandedLabelRight, deviceSpan.left, deviceSpan.right);
  const localXRelated = expandedOverlap > 0
    || nearestDeviceDistanceX <= Math.max(labelRect.w * 1.8, medianDeviceWidth * 2.5);
  if (!localXRelated) return false;

  const maxVerticalDistance = Math.max(labelRect.h * 8, medianDeviceHeight * 4, MIN_ANNOTATION_RECT_SIZE * 8);
  return Math.abs(deviceCenterY - labelCenterY) <= maxVerticalDistance;
}

/**
 * 判断标签行是否应当在多排设备之间共享。
 *
 * 目前主要覆盖“一张标签对应同一部件框内多个设备”的场景；
 * 也兼容一张标签位于上下两排设备之间、分别关联多排设备的场景。
 */
function shouldShareLabelAcrossDeviceRows(labelRow: ImageRect[], deviceRows: ImageRect[][]): boolean {
  return deviceRows.some((deviceRow) => shouldUseSingleLabelForMultipleDevices(labelRow, deviceRow));
}

function hasVisibleLabelTextRect(rect: ImageRect): boolean {
  return Boolean(normalizeLabelTextForScoring(rect.text));
}

function findBestLabelForDeviceRect(deviceRect: ImageRect, labelRow: ImageRect[], usedLabelIds: Set<string>): ImageRect | null {
  const candidates = labelRow
    .filter((labelRect) => !usedLabelIds.has(labelRect.id))
    .map((labelRect) => ({
      labelRect,
      score: getLabelDeviceColumnScore(labelRect, deviceRect),
    }))
    .filter((item) => item.score != null) as { labelRect: ImageRect; score: number }[];
  if (!candidates.length) return null;
  return candidates.reduce((best, current) => (current.score < best.score ? current : best)).labelRect;
}

function getLabelDeviceColumnScore(labelRect: ImageRect, deviceRect: ImageRect): number | null {
  const labelCenterX = getRectCenterX(labelRect);
  const deviceCenterX = getRectCenterX(deviceRect);
  const centerDistanceX = Math.abs(labelCenterX - deviceCenterX);
  const overlapX = getAxisOverlap(labelRect.x, labelRect.x + labelRect.w, deviceRect.x, deviceRect.x + deviceRect.w);
  const minWidth = Math.max(1, Math.min(labelRect.w, deviceRect.w));
  const overlapRatio = overlapX / minWidth;
  const maxCenterDistance = Math.max(labelRect.w, deviceRect.w) * 1.2 + MIN_ANNOTATION_RECT_SIZE * 2;
  if (overlapRatio < 0.2 && centerDistanceX > maxCenterDistance) return null;
  return centerDistanceX - overlapRatio * 16;
}

/**
 * 为某个标签行寻找相关设备行。
 * 这里允许返回上下两排设备，用于处理中间标签共享上下设备的场景。
 */
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
    const group = findPresetStandardPartGroup(rect, standardPartRects) || findContainerStandardPart(rect, standardPartRects);
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

function findPresetStandardPartGroup(rect: ImageRect, standardPartRects: ImageRect[]): ImageRect | null {
  if (!rect.groupId) return null;
  return standardPartRects.find((standardPart) => standardPart.id === rect.groupId) || null;
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
    deviceName: deviceRect?.deviceName,
  };
}

function applyCabinetGeneratedPointNames(rows: CabinetPointRow[]): CabinetPointRow[] {
  // 第一遍：生成基础名称（标签名称，不带类型和序号）
  const rowsWithBaseNames = rows.map((row, index) => {
    const recNum = index + 1;
    return {
      ...row,
      index: recNum,
      name: buildCabinetGeneratedPointName(row.name, row.recognitionLabel, row.recognitionLabelDesc || row.type, recNum),
    };
  });

  // 第二遍：检测重名并添加后缀
  const nameCountMap = new Map<string, number>();
  const nameOccurrenceMap = new Map<string, number>();

  // 统计每个名称出现的次数
  for (const row of rowsWithBaseNames) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    nameCountMap.set(name, (nameCountMap.get(name) || 0) + 1);
  }

  // 为重名的点位添加后缀
  return rowsWithBaseNames.map((row) => {
    const name = String(row.name || "").trim();
    if (!name) return row;

    const totalCount = nameCountMap.get(name) || 1;
    if (totalCount <= 1) {
      // 没有重名，保持原名
      return row;
    }

    // 有重名，添加序号后缀
    const occurrence = (nameOccurrenceMap.get(name) || 0) + 1;
    nameOccurrenceMap.set(name, occurrence);
    return {
      ...row,
      name: `${name}_${occurrence}`,
    };
  });
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

/**
 * 表格展示和导出前的统一排序。
 * 优先按标准部件组排序，再按目标框所在行列排序，保证右侧表格顺序和画布空间顺序一致。
 */
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

/**
 * 每条点位优先使用设备框/外观框作为排序锚点，找不到时回退到标签框。
 */
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
      deviceName: point.deviceName,
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

/**
 * 外观框或其他非设备框绑定时使用的兜底关系查找。
 * 常规设备框绑定主要走 buildSortedPointRowsForGroup。
 */
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

function selectRecognitionLabelRectsForDeviceRows(
  labelRects: ImageRect[],
  deviceRects: ImageRect[],
  groups: Array<{ id: string; standardPartRect: ImageRect }>,
): ImageRect[] {
  if (!labelRects.length || !deviceRects.length) return labelRects;

  const selected: ImageRect[] = [];
  const handledLabelIds = new Set<string>();
  for (const group of groups) {
    const groupLabelRects = labelRects.filter((rect) => rect.groupId === group.id);
    if (!groupLabelRects.length) continue;
    groupLabelRects.forEach((rect) => handledLabelIds.add(rect.id));

    const groupDeviceRows = splitRectRows(deviceRects.filter((rect) => rect.groupId === group.id));
    if (!groupDeviceRows.length) {
      selected.push(...groupLabelRects);
      continue;
    }

    selected.push(...selectRelevantLabelRowsForDeviceRows(splitRectRows(groupLabelRects), groupDeviceRows).flat());
  }

  selected.push(...labelRects.filter((rect) => !handledLabelIds.has(rect.id)));
  return sortRectsByPosition(selected);
}

function mapRegionLabelsBySourceRect(labels: CabinetOcrDetectedLabel[], source: CabinetOcrSource): ImageRect[] {
  const bounds = getOcrSourceBounds(source);
  const rects = labels.flatMap((label, index) => {
    if (!label.bbox) return [];
    const rect = normalizeDetectedLabelBboxToImageRect(label.bbox, source, bounds);
    return rect ? [createOcrImageRect(label, source, index, rect)] : [];
  });
  return sortRectsByPosition(rects);
}

function getOcrSourceBounds(source: CabinetOcrSource): { x: number; y: number; w: number; h: number } {
  return {
    x: source.targetX ?? source.roi?.x ?? source.originX ?? 0,
    y: source.targetY ?? source.roi?.y ?? source.originY ?? 0,
    w: Math.max(1, source.targetW || source.roi?.w || source.width || 1),
    h: Math.max(1, source.targetH || source.roi?.h || source.height || 1),
  };
}

function normalizeDetectedLabelBboxToImageRect(
  bbox: { x: number; y: number; w: number; h: number },
  source: CabinetOcrSource,
  bounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const values = [bbox.x, bbox.y, bbox.w, bbox.h];
  if (!values.every(Number.isFinite) || bbox.w <= 0 || bbox.h <= 0) return null;

  const normalizedRight = bbox.x + bbox.w;
  const normalizedBottom = bbox.y + bbox.h;
  const tolerance = 1;
  if (
    bbox.x < -tolerance
    || bbox.y < -tolerance
    || normalizedRight > CABINET_OCR_NORMALIZED_COORDINATE_MAX + tolerance
    || normalizedBottom > CABINET_OCR_NORMALIZED_COORDINATE_MAX + tolerance
  ) {
    return null;
  }

  const imageBounds = {
    x: source.originX,
    y: source.originY,
    w: Math.max(1, source.width || bounds.w),
    h: Math.max(1, source.height || bounds.h),
  };
  const left = clampNumber(bbox.x, 0, CABINET_OCR_NORMALIZED_COORDINATE_MAX);
  const top = clampNumber(bbox.y, 0, CABINET_OCR_NORMALIZED_COORDINATE_MAX);
  const right = clampNumber(normalizedRight, 0, CABINET_OCR_NORMALIZED_COORDINATE_MAX);
  const bottom = clampNumber(normalizedBottom, 0, CABINET_OCR_NORMALIZED_COORDINATE_MAX);
  return clampRectToBounds({
    x: imageBounds.x + (left / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageBounds.w,
    y: imageBounds.y + (top / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageBounds.h,
    w: ((right - left) / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageBounds.w,
    h: ((bottom - top) / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageBounds.h,
  }, bounds);
}

function clampRectToBounds(
  rect: { x: number; y: number; w: number; h: number },
  bounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  if (
    centerX < bounds.x
    || centerX > bounds.x + bounds.w
    || centerY < bounds.y
    || centerY > bounds.y + bounds.h
  ) {
    return null;
  }

  const left = clampNumber(rect.x, bounds.x, bounds.x + bounds.w);
  const top = clampNumber(rect.y, bounds.y, bounds.y + bounds.h);
  const right = clampNumber(rect.x + rect.w, bounds.x, bounds.x + bounds.w);
  const bottom = clampNumber(rect.y + rect.h, bounds.y, bounds.y + bounds.h);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;
  return { x: left, y: top, w, h };
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

function createOcrRectId(regionId: string, index: number): string {
  return `ocr:${regionId}:${Date.now()}:${index}:${Math.random().toString(16).slice(2)}`;
}

export function createSinglePointId(): string {
  return `single-point:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function getDebugImageSize(sources: CabinetOcrSource[]): { width?: number; height?: number } {
  const firstSource = sources[0];
  return {
    width: firstSource?.width,
    height: firstSource?.height,
  };
}

function toDebugOcrSource(source: CabinetOcrSource) {
  return {
    regionId: source.regionId,
    title: source.title,
    masked: source.masked,
    imageWidth: source.width,
    imageHeight: source.height,
    roi: source.roi,
    roiBbox: source.roi
      ? [
        Math.round(source.roi.x),
        Math.round(source.roi.y),
        Math.round(source.roi.x + source.roi.w),
        Math.round(source.roi.y + source.roi.h),
      ]
      : undefined,
    targetRect: {
      x: source.targetX,
      y: source.targetY,
      w: source.targetW,
      h: source.targetH,
    },
    sourceRectId: source.sourceRectId,
    groupId: source.groupId,
    origin: {
      x: source.originX,
      y: source.originY,
    },
    sourceMode: source.sourceMode,
    coordinateMode: source.coordinateMode,
  };
}

function toDebugRect(rect: ImageRect) {
  return {
    id: rect.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    bbox: [
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.x + rect.w),
      Math.round(rect.y + rect.h),
    ],
    text: rect.text,
    source: rect.source,
    groupId: rect.groupId,
    generatedFromRectId: rect.generatedFromRectId,
    recognitionLabel: rect.recognitionLabel,
    recognitionLabelDesc: rect.recognitionLabelDesc,
    deviceName: rect.deviceName,
  };
}

function toDebugPointRow(row: CabinetPointRow) {
  return {
    index: row.index,
    key: row.key,
    name: row.name,
    type: row.type,
    boundRectId: row.boundRectId,
    boundRectTool: row.boundRectTool,
    relatedRectId: row.relatedRectId,
    relatedRectTool: row.relatedRectTool,
    recognitionLabel: row.recognitionLabel,
    recognitionLabelDesc: row.recognitionLabelDesc,
    deviceName: row.deviceName,
  };
}

async function buildDeviceLabelOcrSources(
  imageDataUrl: string,
  rects: ImageRect[],
  groupByRectId?: Map<string, string>,
): Promise<CabinetOcrSource[]> {
  const validRects = rects.filter((rect) => rect.w >= MIN_ANNOTATION_RECT_SIZE && rect.h >= MIN_ANNOTATION_RECT_SIZE);
  if (!validRects.length) return [];

  const groups = groupLabelRectsForOcr(validRects, groupByRectId);
  const sources: CabinetOcrSource[] = [];

  // OCR 按标准部件组裁图：组内仍然合并请求，组间隔离，避免两组设备复用同一组标签。
  for (const group of groups) {
    const bounds = mergeImageRectBounds(group.rects);
    const crop = await cropCabinetOcrImage(imageDataUrl, bounds, 0);
    for (const rect of group.rects) {
      const groupId = groupByRectId?.get(rect.id) || rect.groupId;
      const index = sources.length + 1;
      sources.push({
        regionId: `region_${index}`,
        title: `标签区域 ${index}`,
        dataUrl: crop.dataUrl,
        originX: crop.originX,
        originY: crop.originY,
        width: crop.width,
        height: crop.height,
        // roi 使用当前组裁剪图内的局部坐标；target 保留原图坐标，供结果映射回画布。
        roi: {
          x: rect.x - crop.originX,
          y: rect.y - crop.originY,
          w: rect.w,
          h: rect.h,
        },
        targetX: rect.x,
        targetY: rect.y,
        targetW: rect.w,
        targetH: rect.h,
        sourceRectId: rect.id,
        groupId,
        masked: false,
        sourceMode: "crop",
        coordinateMode: "original",
      });
    }
  }

  return sources;
}

function groupLabelRectsForOcr(
  rects: ImageRect[],
  groupByRectId?: Map<string, string>,
): Array<{ key: string; rects: ImageRect[] }> {
  const grouped = new Map<string, ImageRect[]>();
  for (const rect of rects) {
    const groupId = groupByRectId?.get(rect.id) || rect.groupId;
    const key = groupId ? `group:${groupId}` : `rect:${rect.id}`;
    grouped.set(key, [...(grouped.get(key) || []), rect]);
  }
  return Array.from(grouped.entries()).map(([key, groupRects]) => ({ key, rects: groupRects }));
}

function mergeImageRectBounds(rects: ImageRect[]): { x: number; y: number; w: number; h: number } {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

