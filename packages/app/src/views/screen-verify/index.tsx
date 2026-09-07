import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "react";
import { useLocation } from "react-router-dom";
import { DownOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Checkbox, Dropdown, Empty, Input, Modal, Select, Space, Spin, Table, Tree } from "antd";
import type { MenuProps } from "antd";
import { createLocalExportTask } from "@/components/download-task/task-actions";
import { useResizable } from "@/components/useResizable";
import { buildCabinetGeneratedPointName } from "@/shared/cabinet-detection";
import { useSelectedProject } from "@/stores/appContextStore";
import { BatchRecognitionModal } from "./components/BatchRecognitionModal";
import type { BatchRecognitionMode, BatchRecognitionProgress } from "./components/BatchRecognitionModal";
import { CabinetImageCanvas } from "./components/CabinetImageCanvas";
import { CabinetTreeTitle } from "./components/CabinetTreeTitle";
import type { BatchRecognitionNodeStatus } from "./components/CabinetTreeTitle";
import { SinglePointModal } from "./components/SinglePointModal";
import { TargetTypeModal } from "./components/TargetTypeModal";
import { cropCabinetOcrImage, recognizeCabinetLabelTexts, recognizeCabinetName } from "./services/ocr-service";
import { isRecognitionRequestCancelled, throwIfRecognitionCancelled } from "./services/recognition-request";
import { annotationToolKey, cloneAnnotations, createEmptyAnnotations } from "./utils/annotation-utils";
import { buildCabinetAnnotationParamsExport } from "./utils/annotation-params-export";
import { buildCabinetImageCacheKey } from "./utils/cabinet-image-utils";
import { createCabinetPointColumns, generateModeLabels, statusOptions } from "./utils/constants";
import type { TargetTypeOption } from "./utils/constants";
import {
  buildComponentPointCounts,
  buildSortedPointRowsFromAnnotations,
  createSinglePointId,
  findFirstEmptyNameSelection,
  findTableRowSelection,
  getAnnotationCount,
  getComponentDisplayName,
  getRecognitionReadiness,
  hasComponentPointData,
  hasWholeGenerateReplaceableData,
  isTableRowBoundToSelection,
  mapAnnotationRects,
  recognizeComponentImage,
  resolveTargetTypeValue,
  sortTableRowsByAnnotationRows,
  waitForBrowserPaint,
} from "./utils/recognition-workflow";
import type { MultiPointGenerateMode } from "./utils/recognition-workflow";
import { buildCabinetTree, buildInitialExpandedKeys, buildMainDeviceKey, buildMainDeviceOverrideKey, getCabinetRecordKey } from "./utils/tree-utils";
import type {
  AnnotationHistoryEntry,
  AnnotationSelection,
  AnnotationTool,
  CabinetPointRow,
  CabinetSinglePoint,
  CabinetTreeNode,
  ComponentAnnotations,
  ImageRect,
  SinglePointDraft,
} from "./types";
import "./index.scss";

const EMPTY_SINGLE_POINT_DRAFT: SinglePointDraft = {
  pointName: "",
  recognitionType: "",
  recognitionLabel: "",
  recognitionLabelDesc: "",
  deviceName: "",
};

function uniqueMainDeviceNameOverridePayloads(records: CabinetImagePackageRecord[], name: string) {
  const payloads = new Map<string, { key: string; robotCode: string; name: string }>();
  for (const record of records) {
    const key = buildMainDeviceOverrideKey(record);
    payloads.set(key, {
      key,
      robotCode: record.robotCode,
      name,
    });
  }
  return [...payloads.values()];
}

async function recognizeSupplementLabelTexts(
  imageDataUrl: string,
  labelRects: ImageRect[],
  signal: AbortSignal,
): Promise<Map<string, { text: string; confidence?: number }>> {
  const sources = await Promise.all(labelRects.map(async (rect, index) => {
    const crop = await cropCabinetOcrImage(imageDataUrl, rect, 4);
    return {
      rectId: rect.id,
      regionId: `supplement_label_${index + 1}`,
      title: `补充标签 ${index + 1}`,
      dataUrl: crop.dataUrl,
      width: crop.width,
      height: crop.height,
    };
  }));
  throwIfRecognitionCancelled(signal);

  const result = await recognizeCabinetLabelTexts(sources.map(({ rectId: _rectId, ...source }) => source), { signal });
  const regionById = new Map(result.regions.map((region) => [region.regionId, region]));
  const recognized = new Map<string, { text: string; confidence?: number }>();
  for (const source of sources) {
    const label = regionById.get(source.regionId)?.labels[0];
    const text = String(label?.text || "").trim();
    if (!text) continue;
    recognized.set(source.rectId, { text, confidence: label?.confidence });
  }
  console.info("[screen-verify] supplement label text OCR result", {
    targetCount: labelRects.length,
    recognizedCount: recognized.size,
    labels: [...recognized.entries()],
    rawText: result.rawText,
  });
  return recognized;
}

function toSortDebugRect(rect: ImageRect | undefined) {
  if (!rect) return null;
  return {
    id: rect.id,
    bbox: [
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.x + rect.w),
      Math.round(rect.y + rect.h),
    ],
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    text: rect.text,
    source: rect.source,
    groupId: rect.groupId,
    generatedFromRectId: rect.generatedFromRectId,
    recognitionLabel: rect.recognitionLabel,
    recognitionLabelDesc: rect.recognitionLabelDesc,
    deviceName: rect.deviceName,
  };
}

function toSortDebugAnnotations(annotations: ComponentAnnotations) {
  return {
    standardPartRects: annotations.standardPartRects.map(toSortDebugRect),
    deviceLabelRects: annotations.deviceLabelRects.map(toSortDebugRect),
    deviceBoxRects: annotations.deviceBoxRects.map(toSortDebugRect),
    appearanceRects: annotations.appearanceRects.map(toSortDebugRect),
  };
}

function findAnnotationRectForDebug(annotations: ComponentAnnotations, tool: AnnotationTool | undefined, rectId: string | undefined) {
  if (!tool || !rectId) return undefined;
  const rects = tool === "standardPart"
    ? annotations.standardPartRects
    : tool === "deviceLabel"
      ? annotations.deviceLabelRects
      : tool === "deviceBox"
        ? annotations.deviceBoxRects
        : annotations.appearanceRects;
  return rects.find((rect) => rect.id === rectId);
}

function toSortDebugPointRow(row: CabinetPointRow, annotations?: ComponentAnnotations) {
  return {
    index: row.index,
    key: row.key,
    name: row.name,
    type: row.type,
    boundRectId: row.boundRectId,
    boundRectTool: row.boundRectTool,
    boundRect: annotations ? toSortDebugRect(findAnnotationRectForDebug(annotations, row.boundRectTool, row.boundRectId)) : undefined,
    relatedRectId: row.relatedRectId,
    relatedRectTool: row.relatedRectTool,
    relatedRect: annotations ? toSortDebugRect(findAnnotationRectForDebug(annotations, row.relatedRectTool, row.relatedRectId)) : undefined,
    recognitionLabel: row.recognitionLabel,
    recognitionLabelDesc: row.recognitionLabelDesc,
    deviceName: row.deviceName,
  };
}

function getCabinetPointRowDisplayType(row: CabinetPointRow): string {
  return String(row.type || row.recognitionLabelDesc || row.recognitionLabel || "").trim();
}

function validateCabinetPointVerification(rows: CabinetPointRow[]): { valid: boolean; message?: string } {
  if (!rows.length) {
    return { valid: false, message: "当前图片暂无点位，不能勾选核查完成" };
  }

  const emptyNameCount = rows.filter((row) => !String(row.name || "").trim()).length;
  const emptyTypeCount = rows.filter((row) => !getCabinetPointRowDisplayType(row)).length;
  
  // 检测重名
  const nameMap = new Map<string, number>();
  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    nameMap.set(name, (nameMap.get(name) || 0) + 1);
  }
  const duplicateCount = Array.from(nameMap.values()).filter(count => count > 1).length;
  
  const issues = [
    emptyNameCount ? `${emptyNameCount} 条名称为空` : "",
    emptyTypeCount ? `${emptyTypeCount} 条类型为空` : "",
    duplicateCount ? `${duplicateCount} 个名称重复` : "",
  ].filter(Boolean);

  return issues.length
    ? { valid: false, message: `点位信息不完整：${issues.join("、")}` }
    : { valid: true };
}

function buildCabinetPointExportSummary(
  records: CabinetImagePackageRecord[],
  ocrRowsByComponent: Record<string, CabinetPointRow[]>,
  singlePointsByComponent: Record<string, CabinetSinglePoint[]>,
  pointVerifiedByComponent: Record<string, boolean>,
): {
  totalComponents: number;
  verifiedComponents: number;
  totalPoints: number;
  verifiedPoints: number;
} {
  let totalComponents = 0;
  let verifiedComponents = 0;
  let totalPoints = 0;
  let verifiedPoints = 0;

  for (const record of records) {
    const recordKey = getCabinetRecordKey(record);
    const pointCount = (ocrRowsByComponent[recordKey]?.length || 0) + (singlePointsByComponent[recordKey]?.length || 0);
    if (!pointCount) continue;
    totalComponents += 1;
    totalPoints += pointCount;
    if (pointVerifiedByComponent[recordKey]) {
      verifiedComponents += 1;
      verifiedPoints += pointCount;
    }
  }

  return {
    totalComponents,
    verifiedComponents,
    totalPoints,
    verifiedPoints,
  };
}

export default function ScreenVerify() {
  const { message, modal } = AntdApp.useApp();
  const selectedProject = useSelectedProject();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rightTableWrapRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<"marked" | "unmarked" | "all">("all");
  const [nameFilter, setNameFilter] = useState("");
  const [loadingPackage, setLoadingPackage] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [selectedImageDataUrl, setSelectedImageDataUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [components, setComponents] = useState<CabinetImagePackageRecord[]>([]);
  const [selectedComponentCode, setSelectedComponentCode] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [renameMainKey, setRenameMainKey] = useState("");
  const [renameMainName, setRenameMainName] = useState("");
  const [activeAnnotationTool, setActiveAnnotationTool] = useState<AnnotationTool | null>(null);
  const [annotationsByComponent, setAnnotationsByComponent] = useState<Record<string, ComponentAnnotations>>({});
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationSelection | null>(null);
  const [ocrRowsByComponent, setOcrRowsByComponent] = useState<Record<string, CabinetPointRow[]>>({});
  const [singlePointsByComponent, setSinglePointsByComponent] = useState<Record<string, CabinetSinglePoint[]>>({});
  const [pointVerifiedByComponent, setPointVerifiedByComponentState] = useState<Record<string, boolean>>({});
  const [singlePointModalOpen, setSinglePointModalOpen] = useState(false);
  const [singlePointDraft, setSinglePointDraft] = useState<SinglePointDraft>(EMPTY_SINGLE_POINT_DRAFT);
  const [singlePointTargetRect, setSinglePointTargetRect] = useState<ImageRect | null>(null);
  const [singlePointDrawing, setSinglePointDrawing] = useState(false);
  const [singlePointCreatedRect, setSinglePointCreatedRect] = useState<{ componentCode: string; rectId: string } | null>(null);
  const [cabinetNameDrawing, setCabinetNameDrawing] = useState(false);
  const [cabinetNameModalOpen, setCabinetNameModalOpen] = useState(false);
  const [cabinetNameDraft, setCabinetNameDraft] = useState("");
  const [cabinetNameRecognizedText, setCabinetNameRecognizedText] = useState("");
  const [cabinetNameConfidence, setCabinetNameConfidence] = useState<number | null>(null);
  const [targetTypeModalOpen, setTargetTypeModalOpen] = useState(false);
  const [editingTargetTypeRow, setEditingTargetTypeRow] = useState<CabinetPointRow | null>(null);
  const [editingNameRow, setEditingNameRow] = useState<CabinetPointRow | null>(null);
  const [editingNameValue, setEditingNameValue] = useState("");
  const [rightTableScrollY, setRightTableScrollY] = useState(240);
  const [exportingPointTable, setExportingPointTable] = useState(false);
  const [exportingAnnotationParams, setExportingAnnotationParams] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<BatchRecognitionMode>("new");
  const [batchProgress, setBatchProgress] = useState<BatchRecognitionProgress | null>(null);
  const [batchCancelling, setBatchCancelling] = useState(false);
  const [batchNodeStatus, setBatchNodeStatus] = useState<Record<string, BatchRecognitionNodeStatus>>({});
  const imageCacheRef = useRef(new Map<string, string>());
  const annotationsByComponentRef = useRef<Record<string, ComponentAnnotations>>({});
  const ocrRowsByComponentRef = useRef<Record<string, CabinetPointRow[]>>({});
  const singlePointsByComponentRef = useRef<Record<string, CabinetSinglePoint[]>>({});
  const pointVerifiedByComponentRef = useRef<Record<string, boolean>>({});
  const annotationHistoryRef = useRef<AnnotationHistoryEntry[]>([]);
  const persistedAnnotationKeysRef = useRef(new Set<string>());
  const treeFilterActiveRef = useRef(false);
  const skipNameEditSubmitRef = useRef(false);
  const singleRecognitionAbortRef = useRef<AbortController | null>(null);
  const batchRecognitionAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (location.pathname === "/screen-verify") return;
    singleRecognitionAbortRef.current?.abort();
    batchRecognitionAbortRef.current?.abort();
  }, [location.pathname]);

  useEffect(() => () => {
    singleRecognitionAbortRef.current?.abort();
    batchRecognitionAbortRef.current?.abort();
  }, []);

  const { width: leftWidth, resizing: leftResizing, onMouseDown: onLeftResizeStart } = useResizable({
    containerRef,
    initialPercent: 0.2,
    minWidth: 220,
    maxPercent: 0.4,
  });

  const { width: rightWidth, resizing: rightResizing, onMouseDown: onRightResizeStart } = useResizable({
    containerRef,
    initialPercent: 0.28,
    minWidth: 280,
    maxPercent: 0.45,
    reverse: true,
  });

  const selectedComponent = useMemo(
    () => components.find((item) => getCabinetRecordKey(item) === selectedComponentCode) || null,
    [components, selectedComponentCode],
  );

  const selectedAnnotations = useMemo(
    () => annotationsByComponent[selectedComponentCode] || createEmptyAnnotations(),
    [annotationsByComponent, selectedComponentCode],
  );

  const selectedOcrRows = useMemo(
    () => ocrRowsByComponent[selectedComponentCode] || [],
    [ocrRowsByComponent, selectedComponentCode],
  );

  const selectedSinglePoints = useMemo(
    () => singlePointsByComponent[selectedComponentCode] || [],
    [selectedComponentCode, singlePointsByComponent],
  );

  const selectedPointVerified = useMemo(
    () => Boolean(pointVerifiedByComponent[selectedComponentCode]),
    [pointVerifiedByComponent, selectedComponentCode],
  );

  const selectedTableRows = useMemo(() => {
    const rows: CabinetPointRow[] = [
      ...selectedOcrRows.map((row) => ({ ...row, source: row.source || "ocr" as const })),
      ...selectedSinglePoints.map((point) => ({
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
    return sortTableRowsByAnnotationRows(rows, selectedAnnotations).map((row, index) => ({ ...row, index: index + 1 }));
  }, [selectedAnnotations, selectedOcrRows, selectedSinglePoints]);

  const selectedTableRowKeys = useMemo(() => {
    if (!selectedAnnotation) return new Set<string>();
    return new Set(selectedTableRows
      .filter((row) => isTableRowBoundToSelection(row, selectedAnnotation))
      .map((row) => row.key));
  }, [selectedAnnotation, selectedTableRows]);

  const componentPointCounts = useMemo(
    () => buildComponentPointCounts(components, ocrRowsByComponent, singlePointsByComponent),
    [components, ocrRowsByComponent, singlePointsByComponent],
  );

  const componentMarkedStates = useMemo(() => {
    const states: Record<string, boolean> = {};
    for (const component of components) {
      const recordKey = getCabinetRecordKey(component);
      const annotations = annotationsByComponent[recordKey];
      states[recordKey] = Boolean(
        (annotations && getAnnotationCount(annotations) > 0)
        || hasComponentPointData(recordKey, ocrRowsByComponent, singlePointsByComponent),
      );
    }
    return states;
  }, [annotationsByComponent, components, ocrRowsByComponent, singlePointsByComponent]);

  const treeFilterActive = Boolean(nameFilter.trim()) || statusFilter !== "all";

  const { treeData, allExpandableKeys } = useMemo(
    () => buildCabinetTree(components, nameFilter, componentPointCounts, componentMarkedStates, statusFilter),
    [componentMarkedStates, componentPointCounts, components, nameFilter, statusFilter],
  );

  useEffect(() => {
    if (treeFilterActive) {
      setExpandedKeys(allExpandableKeys);
    } else if (treeFilterActiveRef.current) {
      setExpandedKeys(buildInitialExpandedKeys(components));
    }
    treeFilterActiveRef.current = treeFilterActive;
  }, [allExpandableKeys, components, treeFilterActive]);

  useEffect(() => {
    annotationsByComponentRef.current = annotationsByComponent;
  }, [annotationsByComponent]);

  useEffect(() => {
    ocrRowsByComponentRef.current = ocrRowsByComponent;
  }, [ocrRowsByComponent]);

  useEffect(() => {
    singlePointsByComponentRef.current = singlePointsByComponent;
  }, [singlePointsByComponent]);

  useEffect(() => {
    pointVerifiedByComponentRef.current = pointVerifiedByComponent;
  }, [pointVerifiedByComponent]);

  useEffect(() => {
    setSelectedAnnotation(null);
    setEditingNameRow(null);
    setEditingNameValue("");
    setActiveAnnotationTool(null);
    setSinglePointDrawing(false);
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    setCabinetNameDrawing(false);
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
  }, [selectedComponentCode]);

  useEffect(() => {
    const element = rightTableWrapRef.current;
    if (!element) return;

    const updateTableScrollY = () => {
      const availableHeight = element.clientHeight - 38;
      setRightTableScrollY(Math.max(120, availableHeight));
    };
    updateTableScrollY();

    const observer = new ResizeObserver(updateTableScrollY);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rightWidth]);

  useEffect(() => {
    const firstSelectedKey = [...selectedTableRowKeys][0];
    if (!firstSelectedKey) return;
    const wrap = rightTableWrapRef.current;
    const body = wrap?.querySelector(".ant-table-body");
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]"));
    const targetRow = rows.find((row) => row.getAttribute("data-row-key") === firstSelectedKey);
    targetRow?.scrollIntoView({ block: "nearest" });
  }, [selectedTableRowKeys]);

  const clearAnnotationInteraction = useCallback(() => {
    setSelectedAnnotation(null);
    setActiveAnnotationTool(null);
    setSinglePointDrawing(false);
    setCabinetNameDrawing(false);
  }, []);

  const reportRecognitionBusy = useCallback(() => {
    message.error("正在识别中，请勿重复点击");
  }, [message]);

  const openRenameMainDevice = useCallback((node: CabinetTreeNode) => {
    setRenameMainKey(node.key);
    setRenameMainName(node.title);
  }, []);

  const cancelRenameMainDevice = useCallback(() => {
    setRenameMainKey("");
    setRenameMainName("");
  }, []);

  const renameMainDeviceByKey = useCallback(async (mainKey: string, nextName: string): Promise<boolean> => {
    if (!nextName) {
      message.warning("屏柜名称不能为空");
      return false;
    }

    const matchedRecords = components.filter((record) => buildMainDeviceKey(record) === mainKey);
    if (!matchedRecords.length) {
      message.warning("未找到需要修改的屏柜");
      return false;
    }
    const changed = matchedRecords.some((record) => record.mainDeviceName !== nextName);
    const nextMainKey = matchedRecords[0] ? buildMainDeviceKey({ ...matchedRecords[0], mainDeviceName: nextName }) : mainKey;
    setComponents((prev) => prev.map((record) => {
      if (buildMainDeviceKey(record) !== mainKey) return record;
      return { ...record, mainDeviceName: nextName };
    }));
    if (changed && nextMainKey !== mainKey) {
      setExpandedKeys((keys) => keys.map((key) => (key === mainKey ? nextMainKey : key)));
    }
    if (changed) {
      if (!selectedProject || !window.electronAPI?.saveCabinetMainDeviceNameOverride) {
        message.warning("屏柜名称已更新，当前环境未保存覆盖映射");
        return true;
      }
      try {
        const payloads = uniqueMainDeviceNameOverridePayloads(matchedRecords, nextName);
        for (const payload of payloads) {
          const result = await window.electronAPI.saveCabinetMainDeviceNameOverride(selectedProject, payload);
          if (!result.success) throw new Error(result.error || "保存屏柜名称覆盖失败");
        }
      } catch (e: any) {
        message.error(e?.message || "保存屏柜名称覆盖失败");
      }
    }
    return true;
  }, [components, message, selectedProject]);

  const commitRenameMainDevice = useCallback(() => {
    const mainKey = renameMainKey;
    const nextName = renameMainName.trim();
    renameMainDeviceByKey(mainKey, nextName).then((success) => {
      if (!success) return;
      setRenameMainKey("");
      setRenameMainName("");
    });
  }, [renameMainDeviceByKey, renameMainKey, renameMainName]);

  const pushAnnotationHistory = useCallback((componentCode: string) => {
    if (!componentCode) return;
    annotationHistoryRef.current.push({
      componentCode,
      annotations: cloneAnnotations(annotationsByComponentRef.current[componentCode] || createEmptyAnnotations()),
      ocrRows: (ocrRowsByComponentRef.current[componentCode] || []).map((row) => ({ ...row })),
      singlePoints: (singlePointsByComponentRef.current[componentCode] || []).map((point) => ({
        ...point,
        rectSnapshot: { ...point.rectSnapshot },
      })),
    });
  }, []);

  const resetComponentPointVerification = useCallback((componentCode: string) => {
    if (!componentCode || !pointVerifiedByComponentRef.current[componentCode]) return;
    const next = { ...pointVerifiedByComponentRef.current };
    delete next[componentCode];
    pointVerifiedByComponentRef.current = next;
    setPointVerifiedByComponentState(next);
  }, []);

  const updateComponentAnnotations = useCallback((
    componentCode: string,
    updater: (current: ComponentAnnotations) => ComponentAnnotations,
    options: { preservePointVerification?: boolean } = {},
  ) => {
    if (!componentCode) return;
    const currentState = annotationsByComponentRef.current;
    const current = currentState[componentCode] || createEmptyAnnotations();
    const next = {
      ...currentState,
      [componentCode]: updater(current),
    };
    annotationsByComponentRef.current = next;
    setAnnotationsByComponent(next);
    if (!options.preservePointVerification) resetComponentPointVerification(componentCode);
  }, [resetComponentPointVerification]);

  const setComponentOcrRows = useCallback((
    componentCode: string,
    rows: CabinetPointRow[],
    options: { preservePointVerification?: boolean } = {},
  ) => {
    const next = {
      ...ocrRowsByComponentRef.current,
      [componentCode]: rows,
    };
    ocrRowsByComponentRef.current = next;
    setOcrRowsByComponent(next);
    if (!options.preservePointVerification) resetComponentPointVerification(componentCode);
  }, [resetComponentPointVerification]);

  const setComponentSinglePoints = useCallback((
    componentCode: string,
    points: CabinetSinglePoint[],
    options: { preservePointVerification?: boolean } = {},
  ) => {
    const next = {
      ...singlePointsByComponentRef.current,
      [componentCode]: points,
    };
    singlePointsByComponentRef.current = next;
    setSinglePointsByComponent(next);
    if (!options.preservePointVerification) resetComponentPointVerification(componentCode);
  }, [resetComponentPointVerification]);

  const setComponentPointVerified = useCallback((componentCode: string, verified: boolean) => {
    if (!componentCode) return;
    if (!verified) {
      resetComponentPointVerification(componentCode);
      return;
    }
    const next = { ...pointVerifiedByComponentRef.current };
    next[componentCode] = true;
    pointVerifiedByComponentRef.current = next;
    setPointVerifiedByComponentState(next);
  }, [resetComponentPointVerification]);

  useEffect(() => {
    setSinglePointCreatedRect((created) => {
      if (!created) return null;
      annotationHistoryRef.current.pop();
      updateComponentAnnotations(created.componentCode, (current) => ({
        ...current,
        deviceBoxRects: current.deviceBoxRects.filter((rect) => rect.id !== created.rectId),
      }));
      return null;
    });
  }, [selectedComponentCode, updateComponentAnnotations]);

  /**
   * 单张图片的多点生成入口。
   * whole 会重建当前图片的识别结果，add 只追加新框选区域的结果。
   */
  const runMultiPointGenerate = useCallback(async (mode: MultiPointGenerateMode) => {
    if (ocrLoading) {
      reportRecognitionBusy();
      return;
    }
    clearAnnotationInteraction();
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (!selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return;
    }

    const current = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    singleRecognitionAbortRef.current?.abort();
    const controller = new AbortController();
    singleRecognitionAbortRef.current = controller;
    setOcrLoading(true);
    try {
      const result = await recognizeComponentImage({
        imageDataUrl: selectedImageDataUrl,
        annotations: current,
        existingRows: ocrRowsByComponentRef.current[selectedComponentCode] || [],
        existingSinglePoints: singlePointsByComponentRef.current[selectedComponentCode] || [],
        mode,
        signal: controller.signal,
      });

      pushAnnotationHistory(selectedComponentCode);
      updateComponentAnnotations(selectedComponentCode, () => result.annotations);
      setComponentOcrRows(selectedComponentCode, result.rows);
      setComponentSinglePoints(selectedComponentCode, result.singlePoints);
      if (mode === "whole") {
        setSinglePointModalOpen(false);
        setSinglePointTargetRect(null);
      }
      if (result.warning) {
        message.warning(result.warning);
      } else {
        const issueDetails = [
          result.inferredLabelCount ? `自动补充 ${result.inferredLabelCount} 个标签框` : "",
          result.emptyNameCount ? `${result.emptyNameCount} 个名称为空` : "",
          result.unboundLabelCount ? `${result.unboundLabelCount} 个标签未绑定设备` : "",
          result.unboundDeviceCount ? `${result.unboundDeviceCount} 个设备未绑定标签` : "",
        ].filter(Boolean);
        if (issueDetails.length) {
          message.warning(`已识别 ${result.labelCount} 个标签，生成 ${result.deviceCount} 个部件框和 ${result.rows.length} 条点位，${issueDetails.join("、")}`);
        }
      }
    } catch (e: any) {
      if (isRecognitionRequestCancelled(e)) message.info("识别已取消");
      else message.error(e?.message || "标签或部件识别失败");
    } finally {
      if (singleRecognitionAbortRef.current === controller) singleRecognitionAbortRef.current = null;
      setOcrLoading(false);
    }
  }, [
    clearAnnotationInteraction,
    message,
    ocrLoading,
    pushAnnotationHistory,
    reportRecognitionBusy,
    selectedComponentCode,
    selectedImageDataUrl,
    setComponentOcrRows,
    setComponentSinglePoints,
    updateComponentAnnotations,
  ]);

  const handleWholeImageGenerate = useCallback(() => {
    if (ocrLoading) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    clearAnnotationInteraction();
    const annotations = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    const hasExistingData = hasWholeGenerateReplaceableData(
      annotations,
      ocrRowsByComponentRef.current[selectedComponentCode] || [],
      singlePointsByComponentRef.current[selectedComponentCode] || [],
    );
    if (!hasExistingData) {
      void runMultiPointGenerate("whole");
      return;
    }
    modal.confirm({
      title: "确认执行多点生成（整图）？",
      content: "该操作会删除当前图片所有已保存框、识别结果和点位数据，仅识别当前新框选且尚未保存的区域。",
      okText: "删除并生成",
      okType: "danger",
      cancelText: "取消",
      centered: true,
      onOk: () => runMultiPointGenerate("whole"),
    });
  }, [clearAnnotationInteraction, message, modal, ocrLoading, reportRecognitionBusy, runMultiPointGenerate, selectedComponentCode]);

  const handleAddGenerate = useCallback(() => {
    void runMultiPointGenerate("add");
  }, [runMultiPointGenerate]);

  /**
   * 一键排序入口。
   * 先对人工后补且没有文字的标签框做轻量 OCR，再按当前画布框关系重建右侧点位表。
   */
  const handleSortPointRows = useCallback(async () => {
    if (ocrLoading) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (!selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return;
    }
    let annotations = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    const singlePointDeviceRectIds = new Set(
      (singlePointsByComponentRef.current[selectedComponentCode] || [])
        .filter((point) => point.boundRectTool === "deviceBox")
        .map((point) => point.boundRectId),
    );
    const supplementLabelRects = annotations.deviceLabelRects.filter((rect) => (
      (!rect.text || !rect.text.trim())
      && (!rect.source || rect.source === "manual")
      && rect.w > 0
      && rect.h > 0
    ));

    const existingRows = ocrRowsByComponentRef.current[selectedComponentCode] || [];
    const existingSinglePoints = singlePointsByComponentRef.current[selectedComponentCode] || [];
    console.info("[screen-verify] one-click sort input", {
      componentCode: selectedComponentCode,
      existingRows: existingRows.map((row) => toSortDebugPointRow(row, annotations)),
      existingSinglePoints: existingSinglePoints.map((point) => ({
        id: point.id,
        pointName: point.pointName,
        recognitionType: point.recognitionType,
        boundRectId: point.boundRectId,
        boundRectTool: point.boundRectTool,
        boundRect: toSortDebugRect(findAnnotationRectForDebug(annotations, point.boundRectTool, point.boundRectId)),
      })),
      singlePointDeviceRectIds: [...singlePointDeviceRectIds],
      supplementLabelRects: supplementLabelRects.map(toSortDebugRect),
      annotations: toSortDebugAnnotations(annotations),
    });

    let recognizedLabelCount = 0;
    if (supplementLabelRects.length) {
      singleRecognitionAbortRef.current?.abort();
      const controller = new AbortController();
      singleRecognitionAbortRef.current = controller;
      setOcrLoading(true);
      try {
        const recognizedTexts = await recognizeSupplementLabelTexts(selectedImageDataUrl, supplementLabelRects, controller.signal);
        throwIfRecognitionCancelled(controller.signal);
        recognizedLabelCount = recognizedTexts.size;
        annotations = {
          ...annotations,
          deviceLabelRects: annotations.deviceLabelRects.map((rect) => {
            const recognized = recognizedTexts.get(rect.id);
            if (!recognized) return rect;
            return {
              ...rect,
              text: recognized.text,
              confidence: recognized.confidence,
              source: rect.source || "manual",
              saved: false,
              generationStatus: "generated",
            };
          }),
        };
      } catch (e: any) {
        if (isRecognitionRequestCancelled(e)) {
          message.info("识别已取消");
          return;
        }
        message.warning(e?.message || "补充标签文字识别失败，已按现有名称排序");
      } finally {
        if (singleRecognitionAbortRef.current === controller) singleRecognitionAbortRef.current = null;
        setOcrLoading(false);
      }
    }

    // 单点新增的设备框已经由单点记录独立管理，一键排序时不再参与批量绑定。
    const sortableAnnotations: ComponentAnnotations = {
      ...annotations,
      deviceBoxRects: annotations.deviceBoxRects.filter((rect) => !singlePointDeviceRectIds.has(rect.id)),
    };
    const result = buildSortedPointRowsFromAnnotations(sortableAnnotations);
    console.info("[screen-verify] one-click sort output", {
      componentCode: selectedComponentCode,
      recognizedSupplementLabelCount: recognizedLabelCount,
      resultSummary: {
        rowCount: result.rows.length,
        emptyNameCount: result.emptyNameCount,
        unboundLabelCount: result.unboundLabelCount,
        unboundDeviceCount: result.unboundDeviceCount,
      },
      sortableAnnotations: toSortDebugAnnotations(sortableAnnotations),
      resultAnnotations: toSortDebugAnnotations(result.annotations),
      rows: result.rows.map((row) => toSortDebugPointRow(row, result.annotations)),
      emptyRows: result.rows
        .filter((row) => !row.name.trim())
        .map((row) => toSortDebugPointRow(row, result.annotations)),
    });
    if (!result.rows.length) {
      message.warning(singlePointDeviceRectIds.size
        ? "当前图片没有可排序的多点数据，单点新增点位不参与一键排序"
        : "当前图片没有可排序的标签框和设备框");
      return;
    }

    const sortedDeviceRectById = new Map(result.annotations.deviceBoxRects.map((rect) => [rect.id, rect]));
    const nextAnnotations: ComponentAnnotations = {
      ...result.annotations,
      deviceBoxRects: annotations.deviceBoxRects.map((rect) => (
        singlePointDeviceRectIds.has(rect.id)
          ? rect
          : sortedDeviceRectById.get(rect.id) || rect
      )),
    };
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, () => nextAnnotations);
    setComponentOcrRows(selectedComponentCode, result.rows);
    setSelectedAnnotation(null);
    setActiveAnnotationTool(null);

    const issueDetails = [
      result.emptyNameCount ? `${result.emptyNameCount} 个名称为空` : "",
      result.unboundLabelCount ? `${result.unboundLabelCount} 个标签未绑定设备` : "",
      result.unboundDeviceCount ? `${result.unboundDeviceCount} 个设备未绑定标签` : "",
    ].filter(Boolean);
    const messageText = issueDetails.length
      ? `已重新排序 ${result.rows.length} 条点位，${issueDetails.join("、")}，请人工补框或补充名称`
      : `已重新排序 ${result.rows.length} 条点位`;
    const finalMessageText = recognizedLabelCount
      ? `${messageText}，识别补充标签 ${recognizedLabelCount} 个`
      : messageText;
    if (result.emptyNameCount || result.unboundLabelCount || result.unboundDeviceCount) {
      message.warning(finalMessageText);
    }
  }, [
    message,
    ocrLoading,
    pushAnnotationHistory,
    reportRecognitionBusy,
    selectedComponentCode,
    selectedImageDataUrl,
    setComponentOcrRows,
    updateComponentAnnotations,
  ]);

  const handleSinglePointAddGenerate = useCallback(() => {
    if (ocrLoading) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (loadingImage || !selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return;
    }
    if (singlePointDrawing) {
      setSinglePointDrawing(false);
      setActiveAnnotationTool(null);
      return;
    }

    setSelectedAnnotation(null);
    setSinglePointDrawing(true);
    setActiveAnnotationTool("deviceBox");
    setSinglePointTargetRect(null);
    setSinglePointCreatedRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    setSinglePointModalOpen(false);
    message.info("请在图片上框选单点设备");
  }, [loadingImage, message, ocrLoading, reportRecognitionBusy, selectedComponent, selectedImageDataUrl, singlePointDrawing]);

  const handleCancelSinglePoint = useCallback(() => {
    if (singlePointCreatedRect) {
      annotationHistoryRef.current.pop();
      updateComponentAnnotations(singlePointCreatedRect.componentCode, (current) => ({
        ...current,
        deviceBoxRects: current.deviceBoxRects.filter((rect) => rect.id !== singlePointCreatedRect.rectId),
      }));
      if (selectedAnnotation?.tool === "deviceBox" && selectedAnnotation.id === singlePointCreatedRect.rectId) {
        setSelectedAnnotation(null);
      }
    }
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDrawing(false);
    setSinglePointCreatedRect(null);
    setActiveAnnotationTool(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
  }, [selectedAnnotation, singlePointCreatedRect, updateComponentAnnotations]);

  const handleSubmitSinglePoint = useCallback((values: SinglePointDraft) => {
    if (!selectedComponentCode || !singlePointTargetRect) {
      message.warning("请先框选单点设备");
      return;
    }

    pushAnnotationHistory(selectedComponentCode);
    const recognitionType = values.recognitionLabelDesc || values.recognitionType;
    const recNum = selectedTableRows.length + 1;
    const pointName = buildCabinetGeneratedPointName(values.pointName, values.recognitionLabel, recognitionType, recNum);
    const boundRect: ImageRect = {
      ...singlePointTargetRect,
      text: recognitionType,
      recognitionLabel: values.recognitionLabel,
      recognitionLabelDesc: recognitionType,
      deviceName: values.deviceName,
      saved: false,
      generationStatus: singlePointTargetRect.source === "manual" || !singlePointTargetRect.source ? "pending" : "generated",
    };
    const point: CabinetSinglePoint = {
      id: createSinglePointId(),
      componentCode: selectedComponentCode,
      pointName,
      recognitionType: values.recognitionType,
      recognitionLabel: values.recognitionLabel,
      recognitionLabelDesc: recognitionType,
      deviceName: values.deviceName,
      boundRectId: boundRect.id,
      boundRectTool: "deviceBox",
      rectSnapshot: { ...boundRect },
      createdAt: new Date().toISOString(),
      saved: false,
    };

    updateComponentAnnotations(selectedComponentCode, (current) => ({
      ...current,
      deviceBoxRects: current.deviceBoxRects.map((rect) => (
        rect.id === boundRect.id ? boundRect : rect
      )),
    }));
    setComponentSinglePoints(selectedComponentCode, [...(singlePointsByComponentRef.current[selectedComponentCode] || []), point]);
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDrawing(false);
    setSinglePointCreatedRect(null);
    setActiveAnnotationTool(null);
    setSelectedAnnotation({ tool: "deviceBox", id: boundRect.id });
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    message.success("单点已生成");
  }, [message, pushAnnotationHistory, selectedComponentCode, selectedTableRows.length, setComponentSinglePoints, singlePointTargetRect]);

  const saveComponentAnnotations = useCallback(async (
    record: CabinetImagePackageRecord,
    componentCode: string,
    annotations: ComponentAnnotations,
    ocrRows: CabinetPointRow[],
    singlePoints: CabinetSinglePoint[],
    options: { silent?: boolean; trackHistory?: boolean; selectEmptyName?: boolean } = {},
  ): Promise<{ saved: boolean; emptyNameSelection: AnnotationSelection | null }> => {
    if (!selectedProject) {
      if (!options.silent) message.warning("请先选择项目");
      return { saved: false, emptyNameSelection: null };
    }
    if (!window.electronAPI?.saveCabinetImageAnnotations) {
      if (!options.silent) message.warning("仅 Electron 环境支持保存屏柜标注");
      return { saved: false, emptyNameSelection: null };
    }
    const annotationCount = getAnnotationCount(annotations);
    const hasCurrentData = annotationCount > 0 || singlePoints.length > 0 || ocrRows.length > 0;
    const hadPersistedData = persistedAnnotationKeysRef.current.has(componentCode);
    if (!hasCurrentData && !hadPersistedData) {
      setComponentPointVerified(componentCode, false);
      if (!options.silent) message.warning("当前图片暂无可保存数据");
      return { saved: false, emptyNameSelection: null };
    }
    const emptyNameSelection = hasCurrentData
      ? findFirstEmptyNameSelection(ocrRows, singlePoints, annotations)
      : null;

    const savedAnnotations = mapAnnotationRects(annotations, (rect) => ({
      ...rect,
      saved: true,
      generationStatus: "saved",
    }));
    const savedPoints = singlePoints.map((point) => ({ ...point, saved: true }));

    const result = await window.electronAPI.saveCabinetImageAnnotations(selectedProject, {
      recordKey: componentCode,
      robotCode: record.robotCode,
      componentCode: record.componentCode,
      annotations: savedAnnotations,
      ocrRows,
      singlePoints: savedPoints,
      pointVerified: Boolean(pointVerifiedByComponentRef.current[componentCode]),
    });
    if (!result.success) throw new Error(result.error || "保存屏柜标注失败");
    console.info("[screen-verify] cabinet image save", {
      recordKey: componentCode,
      componentCode: record.componentCode,
      robotCode: record.robotCode,
      annotations: savedAnnotations,
      points: savedPoints,
      silent: options.silent,
    });

    if (options.trackHistory) pushAnnotationHistory(componentCode);
    updateComponentAnnotations(componentCode, () => savedAnnotations, { preservePointVerification: true });
    setComponentOcrRows(componentCode, ocrRows, { preservePointVerification: true });
    setComponentSinglePoints(componentCode, savedPoints, { preservePointVerification: true });
    if (!hasCurrentData) {
      persistedAnnotationKeysRef.current.delete(componentCode);
      setComponentPointVerified(componentCode, false);
      if (!options.silent) message.success("已保存");
      return { saved: true, emptyNameSelection: null };
    }

    persistedAnnotationKeysRef.current.add(componentCode);
    if (emptyNameSelection) {
      if (options.selectEmptyName) setSelectedAnnotation(emptyNameSelection);
      if (!options.silent) message.warning("已保存，存在点位名称未填写");
    } else {
      if (!options.silent) message.success("已保存");
    }
    return { saved: true, emptyNameSelection };
  }, [
    message,
    pushAnnotationHistory,
    selectedProject,
    setComponentOcrRows,
    setComponentSinglePoints,
    setComponentPointVerified,
    updateComponentAnnotations,
  ]);

  /**
   * 保存当前图片标注中间态。
   * 保存允许空名称，方便批量识别后继续人工修正；导出标注参数时再强校验。
   */
  const handleSaveCurrentImage = useCallback(async () => {
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }

    try {
      await saveComponentAnnotations(
        selectedComponent,
        selectedComponentCode,
        annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations(),
        ocrRowsByComponentRef.current[selectedComponentCode] || [],
        singlePointsByComponentRef.current[selectedComponentCode] || [],
        { trackHistory: true, selectEmptyName: true },
      );
    } catch (e: any) {
      message.error(e?.message || "保存屏柜标注失败");
    }
  }, [
    message,
    saveComponentAnnotations,
    selectedComponent,
    selectedComponentCode,
  ]);

  const handlePointVerificationChange = useCallback(async (event: { target: { checked: boolean } }) => {
    if (!selectedComponent || !selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }

    const checked = event.target.checked;
    const currentAnnotations = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    const currentRows = ocrRowsByComponentRef.current[selectedComponentCode] || [];
    const currentSinglePoints = singlePointsByComponentRef.current[selectedComponentCode] || [];
    if (checked) {
      const validation = validateCabinetPointVerification(selectedTableRows);
      if (!validation.valid) {
        const emptyNameSelection = findFirstEmptyNameSelection(currentRows, currentSinglePoints, currentAnnotations);
        if (emptyNameSelection) setSelectedAnnotation(emptyNameSelection);
        message.warning(validation.message || "点位信息不完整，不能勾选核查完成");
        return;
      }
    }

    const previous = Boolean(pointVerifiedByComponentRef.current[selectedComponentCode]);
    setComponentPointVerified(selectedComponentCode, checked);
    try {
      // 点位核查状态也是标注数据的一部分，勾选或取消后立即保存当前图片全部中间态。
      await saveComponentAnnotations(
        selectedComponent,
        selectedComponentCode,
        currentAnnotations,
        currentRows,
        currentSinglePoints,
        { silent: true },
      );
      message.success(checked ? "点位核查已完成并保存" : "已取消点位核查并保存");
    } catch (error: any) {
      setComponentPointVerified(selectedComponentCode, previous);
      message.error(error?.message || "保存点位核查状态失败");
    }
  }, [
    message,
    saveComponentAnnotations,
    selectedComponent,
    selectedComponentCode,
    selectedTableRows,
    setComponentPointVerified,
  ]);

  /**
   * 加载部件原图并做内存缓存，批量识别会复用这里避免重复 IPC 读取。
   */
  const loadCabinetImageDataUrl = useCallback(async (record: CabinetImagePackageRecord): Promise<string> => {
    const cacheKey = buildCabinetImageCacheKey(record);
    const cached = imageCacheRef.current.get(cacheKey);
    if (cached) return cached;
    if (record.imageDataUrl) {
      imageCacheRef.current.set(cacheKey, record.imageDataUrl);
      return record.imageDataUrl;
    }
    if (!record.imageSource) throw new Error("当前部件未找到图片");
    if (!window.electronAPI?.loadCabinetImage) throw new Error("当前环境不支持加载屏柜原图");

    const result = await window.electronAPI.loadCabinetImage(record.imageSource.id);
    if (!result.success || !result.dataUrl) {
      throw new Error(result.error || "图片加载失败");
    }
    imageCacheRef.current.set(cacheKey, result.dataUrl);
    return result.dataUrl;
  }, []);

  /**
   * 打开批量识别弹窗，只做项目和数据存在性校验。
   */
  const handleOpenBatchRecognition = useCallback(() => {
    if (ocrLoading || batchProgress) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!components.length) {
      message.warning("请先导入屏柜图像");
      return;
    }
    setBatchMode("new");
    setBatchModalOpen(true);
  }, [batchProgress, components.length, message, ocrLoading, reportRecognitionBusy, selectedProject]);

  const handleCancelBatchRecognition = useCallback(() => {
    if (batchProgress) {
      if (!batchCancelling) {
        setBatchCancelling(true);
        batchRecognitionAbortRef.current?.abort();
      }
      return;
    }
    setBatchModalOpen(false);
  }, [batchCancelling, batchProgress]);

  /**
   * 批量识别串行执行。
   * 每张图片先切到左侧部件节点、加载图片、校验是否具备识别框，再复用单张识别流程并立即保存中间态。
   */
  const handleStartBatchRecognition = useCallback(async () => {
    if (ocrLoading || batchProgress) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }

    const targets = components.filter((record) => {
      const recordKey = getCabinetRecordKey(record);
      if (batchMode === "all") return true;
      return !hasComponentPointData(
        recordKey,
        ocrRowsByComponentRef.current,
        singlePointsByComponentRef.current,
      );
    });
    if (!targets.length) {
      message.warning(batchMode === "new" ? "暂无未识别的屏柜图像" : "暂无可识别的屏柜图像");
      return;
    }

    clearAnnotationInteraction();
    setBatchModalOpen(true);
    setOcrLoading(true);
    setBatchCancelling(false);
    setBatchNodeStatus({});
    const controller = new AbortController();
    batchRecognitionAbortRef.current = controller;
    let success = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = false;

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        const record = targets[index];
        const componentCode = getCabinetRecordKey(record);
        const currentName = getComponentDisplayName(record);
        setSelectedComponentCode(componentCode);
        setImageError("");
        setLoadingImage(false);
        setBatchNodeStatus((prev) => ({ ...prev, [componentCode]: "loading" }));
        setBatchProgress({
          mode: batchMode,
          current: index + 1,
          total: targets.length,
          currentName,
          success,
          failed,
          skipped,
        });
        await waitForBrowserPaint();

        try {
          throwIfRecognitionCancelled(controller.signal);
          const imageDataUrl = await loadCabinetImageDataUrl(record);
          throwIfRecognitionCancelled(controller.signal);
          setSelectedImageDataUrl(imageDataUrl);
          const currentAnnotations = annotationsByComponentRef.current[componentCode] || createEmptyAnnotations();
          const readiness = getRecognitionReadiness(currentAnnotations, "whole");
          if (!readiness.ready) {
            skipped += 1;
            setBatchNodeStatus((prev) => ({ ...prev, [componentCode]: "done" }));
            continue;
          }

          const result = await recognizeComponentImage({
            imageDataUrl,
            annotations: currentAnnotations,
            existingRows: ocrRowsByComponentRef.current[componentCode] || [],
            existingSinglePoints: singlePointsByComponentRef.current[componentCode] || [],
            mode: "whole",
            signal: controller.signal,
          });
          updateComponentAnnotations(componentCode, () => result.annotations);
          setComponentOcrRows(componentCode, result.rows);
          setComponentSinglePoints(componentCode, result.singlePoints);
          await saveComponentAnnotations(
            record,
            componentCode,
            result.annotations,
            result.rows,
            result.singlePoints,
            { silent: true },
          );
          success += 1;
          if (controller.signal.aborted) {
            cancelled = true;
            break;
          }
        } catch (e) {
          if (isRecognitionRequestCancelled(e) || controller.signal.aborted) {
            cancelled = true;
            break;
          }
          failed += 1;
          console.warn("[screen-verify] batch recognition failed", {
            recordKey: componentCode,
            componentName: currentName,
            error: e,
          });
        } finally {
          setBatchNodeStatus((prev) => ({ ...prev, [componentCode]: "done" }));
          setBatchProgress({
            mode: batchMode,
            current: index + 1,
            total: targets.length,
            currentName,
            success,
            failed,
            skipped,
          });
        }
      }
    } finally {
      if (batchRecognitionAbortRef.current === controller) batchRecognitionAbortRef.current = null;
      setOcrLoading(false);
      setBatchCancelling(false);
      setBatchNodeStatus({});
      setBatchProgress(null);
      setBatchModalOpen(false);
    }

    const summary = `${cancelled ? "批量识别已停止" : "批量识别完成"}：成功 ${success}，跳过 ${skipped}，失败 ${failed}`;
    if (cancelled) {
      message.info(summary);
    } else if (failed || (!success && skipped)) {
      message.warning(summary);
    } else {
      message.success(summary);
    }
  }, [
    batchMode,
    batchProgress,
    clearAnnotationInteraction,
    components,
    loadCabinetImageDataUrl,
    message,
    ocrLoading,
    reportRecognitionBusy,
    saveComponentAnnotations,
    selectedProject,
    setComponentOcrRows,
    setComponentSinglePoints,
    updateComponentAnnotations,
  ]);

  /**
   * 屏柜名称 OCR：用户框选名称区域后裁图识别，再弹窗确认是否覆盖左侧主设备名称。
   */
  const runCabinetNameRecognition = useCallback(async (rect: ImageRect) => {
    if (!selectedComponentCode || !selectedImageDataUrl) return;

    singleRecognitionAbortRef.current?.abort();
    const controller = new AbortController();
    singleRecognitionAbortRef.current = controller;
    setOcrLoading(true);
    try {
      const crop = await cropCabinetOcrImage(selectedImageDataUrl, rect, 8);
      throwIfRecognitionCancelled(controller.signal);
      const result = await recognizeCabinetName({
        regionId: "cabinet_name",
        title: "屏柜名称",
        dataUrl: crop.dataUrl,
      }, { signal: controller.signal });
      console.info("[screen-verify] cabinet name OCR result", {
        rect,
        rawText: result.rawText,
        name: result.name,
        confidence: result.confidence,
      });
      if (!result.name) {
        message.warning("未识别到屏柜名称，请手动输入");
      }
      setCabinetNameRecognizedText(result.name);
      setCabinetNameDraft(result.name || selectedComponent?.mainDeviceName || "");
      setCabinetNameConfidence(result.confidence);
      setCabinetNameModalOpen(true);
    } catch (e: any) {
      if (isRecognitionRequestCancelled(e)) message.info("识别已取消");
      else message.error(e?.message || "屏柜名称识别失败");
    } finally {
      if (singleRecognitionAbortRef.current === controller) singleRecognitionAbortRef.current = null;
      setOcrLoading(false);
      setCabinetNameDrawing(false);
      setActiveAnnotationTool(null);
    }
  }, [message, selectedComponent, selectedComponentCode, selectedImageDataUrl]);

  const handleCabinetRecognition = useCallback(() => {
    if (ocrLoading) {
      reportRecognitionBusy();
      return;
    }
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (loadingImage || !selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return;
    }
    if (cabinetNameDrawing) {
      setCabinetNameDrawing(false);
      setActiveAnnotationTool(null);
      return;
    }

    setSinglePointDrawing(false);
    setSelectedAnnotation(null);
    setCabinetNameDrawing(true);
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
    setActiveAnnotationTool("appearance");
    message.info("请框选屏柜名称区域");
  }, [cabinetNameDrawing, loadingImage, message, ocrLoading, reportRecognitionBusy, selectedComponent, selectedImageDataUrl]);

  const handleCancelCabinetNameConfirm = useCallback(() => {
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
  }, []);

  const handleSubmitCabinetNameConfirm = useCallback(async () => {
    const nextName = cabinetNameDraft.trim();
    if (!nextName) {
      message.warning("屏柜名称不能为空");
      return;
    }
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    const mainKey = buildMainDeviceKey(selectedComponent);
    if (!(await renameMainDeviceByKey(mainKey, nextName))) return;
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
    message.success("屏柜名称已更新");
  }, [cabinetNameDraft, message, renameMainDeviceByKey, selectedComponent]);

  const toggleAnnotationTool = useCallback((tool: AnnotationTool) => {
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    setSinglePointDrawing(false);
    setCabinetNameDrawing(false);
    setSelectedAnnotation(null);
    setActiveAnnotationTool((current) => (current === tool ? null : tool));
  }, [message, selectedComponent]);

  /**
   * 画布新建框后的统一入口。
   * 普通设备框会弹出类型选择，单点新增会弹出点位表单，屏柜名称框会立即进入 OCR。
   */
  const handleCreateAnnotationRect = useCallback((tool: AnnotationTool, rect: ImageRect) => {
    if (!selectedComponentCode) return;
    const createSinglePoint = singlePointDrawing && tool === "deviceBox";
    const recognizeCabinetNameRect = cabinetNameDrawing && tool === "appearance";
    if (recognizeCabinetNameRect) {
      setSelectedAnnotation(null);
      void runCabinetNameRecognition(rect);
      return;
    }
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => ({
      standardPartRects: tool === "standardPart" ? [...current.standardPartRects, rect] : current.standardPartRects,
      deviceLabelRects: tool === "deviceLabel" ? [...current.deviceLabelRects, rect] : current.deviceLabelRects,
      deviceBoxRects: tool === "deviceBox" ? [...current.deviceBoxRects, rect] : current.deviceBoxRects,
      appearanceRects: tool === "appearance" ? [...current.appearanceRects, rect] : current.appearanceRects,
    }));
    setSelectedAnnotation({ tool, id: rect.id });
    if (tool === "deviceBox" && !createSinglePoint) {
      setEditingTargetTypeRow({
        key: `manual-device:${rect.id}`,
        index: 0,
        name: "",
        type: rect.recognitionLabelDesc || rect.recognitionLabel || "",
        boundRectId: rect.id,
        boundRectTool: "deviceBox",
        recognitionLabel: rect.recognitionLabel,
        recognitionLabelDesc: rect.recognitionLabelDesc,
        deviceName: rect.deviceName,
      });
      setTargetTypeModalOpen(true);
    }
    if (createSinglePoint) {
      setSinglePointDrawing(false);
      setActiveAnnotationTool(null);
      setSinglePointTargetRect({ ...rect });
      setSinglePointCreatedRect({ componentCode: selectedComponentCode, rectId: rect.id });
      setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
      setSinglePointModalOpen(true);
    }
  }, [
    cabinetNameDrawing,
    pushAnnotationHistory,
    runCabinetNameRecognition,
    selectedComponentCode,
    singlePointDrawing,
    updateComponentAnnotations,
  ]);

  /**
   * 更新标注框坐标，并同步刷新绑定到该设备框的单点快照。
   */
  const handleUpdateAnnotationRect = useCallback((tool: AnnotationTool, rect: ImageRect) => {
    if (!selectedComponentCode) return;
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => {
      const key = annotationToolKey(tool);
      const nextRect: ImageRect = {
        ...rect,
        saved: false,
        generationStatus: rect.source === "manual" || !rect.source ? "pending" : "generated",
      };
      return {
        ...current,
        [key]: current[key].map((item) => (item.id === rect.id ? nextRect : item)),
      };
    });
    if (tool === "deviceBox") {
      const points = singlePointsByComponentRef.current[selectedComponentCode] || [];
      if (points.some((point) => point.boundRectId === rect.id && point.boundRectTool === tool)) {
        setComponentSinglePoints(selectedComponentCode, points.map((point) => (
          point.boundRectId === rect.id && point.boundRectTool === tool
            ? { ...point, rectSnapshot: { ...rect }, saved: false }
            : point
        )));
      }
    }
    setSelectedAnnotation({ tool, id: rect.id });
  }, [pushAnnotationHistory, selectedComponentCode, setComponentSinglePoints, updateComponentAnnotations]);

  /**
   * 删除标注框时同步清理右侧点位表和单点记录中的绑定关系。
   */
  const handleDeleteAnnotationRect = useCallback((selection: AnnotationSelection) => {
    if (!selectedComponentCode) return;
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => {
      const key = annotationToolKey(selection.tool);
      return {
        ...current,
        [key]: current[key].filter((item) => item.id !== selection.id),
      };
    });
    const points = singlePointsByComponentRef.current[selectedComponentCode] || [];
    if (points.some((point) => point.boundRectId === selection.id && point.boundRectTool === selection.tool)) {
      setComponentSinglePoints(
        selectedComponentCode,
        points.filter((point) => point.boundRectId !== selection.id || point.boundRectTool !== selection.tool),
      );
    }
    if (selection.tool === "deviceLabel" || selection.tool === "deviceBox" || selection.tool === "appearance") {
      const rows = ocrRowsByComponentRef.current[selectedComponentCode] || [];
      const shouldRemoveRow = (row: CabinetPointRow) => (
        (row.boundRectId === selection.id && row.boundRectTool === selection.tool)
        || (row.relatedRectId === selection.id && row.relatedRectTool === selection.tool)
      );
      if (rows.some(shouldRemoveRow)) {
        setComponentOcrRows(selectedComponentCode, rows.filter((row) => !shouldRemoveRow(row)));
      }
    }
    setSelectedAnnotation(null);
  }, [pushAnnotationHistory, selectedComponentCode, setComponentOcrRows, setComponentSinglePoints, updateComponentAnnotations]);

  const handleUndoAnnotation = useCallback(() => {
    const previous = annotationHistoryRef.current.pop();
    if (!previous) return;
    const nextAnnotations = {
      ...annotationsByComponentRef.current,
      [previous.componentCode]: cloneAnnotations(previous.annotations),
    };
    annotationsByComponentRef.current = nextAnnotations;
    setAnnotationsByComponent(nextAnnotations);
    if (previous.ocrRows) {
      const nextOcrRows = {
        ...ocrRowsByComponentRef.current,
        [previous.componentCode]: previous.ocrRows.map((row) => ({ ...row })),
      };
      ocrRowsByComponentRef.current = nextOcrRows;
      setOcrRowsByComponent(nextOcrRows);
    }
    if (previous.singlePoints) {
      const nextSinglePoints = {
        ...singlePointsByComponentRef.current,
        [previous.componentCode]: previous.singlePoints.map((point) => ({
          ...point,
          rectSnapshot: { ...point.rectSnapshot },
        })),
      };
      singlePointsByComponentRef.current = nextSinglePoints;
      setSinglePointsByComponent(nextSinglePoints);
    }
    resetComponentPointVerification(previous.componentCode);
    setSelectedAnnotation(null);
  }, [resetComponentPointVerification]);

  const handleExitAnnotationTool = useCallback(() => {
    setActiveAnnotationTool(null);
    setSinglePointDrawing(false);
  }, []);

  const handleSelectAnnotation = useCallback((selection: AnnotationSelection | null) => {
    setSelectedAnnotation(selection);
  }, []);

  const handleSelectTableRow = useCallback((row: CabinetPointRow) => {
    const selection = findTableRowSelection(row, selectedAnnotations);
    if (!selection) {
      message.warning("绑定的框已不存在");
      return;
    }
    setSelectedAnnotation(selection);
  }, [message, selectedAnnotations]);

  const handleStartEditTableRowName = useCallback((row: CabinetPointRow) => {
    skipNameEditSubmitRef.current = false;
    setEditingNameRow(row);
    setEditingNameValue(row.name || "");
  }, []);

  const handleCancelTableRowNameEdit = useCallback(() => {
    skipNameEditSubmitRef.current = true;
    setEditingNameRow(null);
    setEditingNameValue("");
  }, []);

  const handleSubmitTableRowNameEdit = useCallback(() => {
    if (skipNameEditSubmitRef.current) {
      skipNameEditSubmitRef.current = false;
      return;
    }
    if (!selectedComponentCode || !editingNameRow) return;
    const nextName = editingNameValue.trim();
    if (nextName === (editingNameRow.name || "")) {
      handleCancelTableRowNameEdit();
      return;
    }

    pushAnnotationHistory(selectedComponentCode);
    if (editingNameRow.source === "single") {
      setComponentSinglePoints(selectedComponentCode, (singlePointsByComponentRef.current[selectedComponentCode] || []).map((point) => (
        point.id === editingNameRow.key
          ? { ...point, pointName: nextName, saved: false }
          : point
      )));
    } else {
      setComponentOcrRows(selectedComponentCode, (ocrRowsByComponentRef.current[selectedComponentCode] || []).map((row) => (
        row.key === editingNameRow.key
          ? { ...row, name: nextName }
          : row
      )));
    }

    setEditingNameRow(null);
    setEditingNameValue("");
  }, [
    editingNameRow,
    editingNameValue,
    handleCancelTableRowNameEdit,
    pushAnnotationHistory,
    selectedComponentCode,
    setComponentOcrRows,
    setComponentSinglePoints,
  ]);

  const handleEditTableRowType = useCallback((row: CabinetPointRow) => {
    setEditingTargetTypeRow(row);
    setTargetTypeModalOpen(true);
  }, []);

  const handleCancelTargetTypeEdit = useCallback(() => {
    setTargetTypeModalOpen(false);
    setEditingTargetTypeRow(null);
  }, []);

  const handleSubmitTargetTypeEdit = useCallback((option: TargetTypeOption) => {
    if (!selectedComponentCode || !editingTargetTypeRow) return;

    pushAnnotationHistory(selectedComponentCode);
    if (editingTargetTypeRow.source === "single") {
      setComponentSinglePoints(selectedComponentCode, (singlePointsByComponentRef.current[selectedComponentCode] || []).map((point) => (
        point.id === editingTargetTypeRow.key
          ? {
            ...point,
            pointName: buildCabinetGeneratedPointName(point.pointName, option.value, option.label, editingTargetTypeRow.index || 1),
            recognitionType: option.label,
            recognitionLabel: option.value,
            recognitionLabelDesc: option.label,
            deviceName: option.deviceName,
            rectSnapshot: {
              ...point.rectSnapshot,
              text: option.label,
              recognitionLabel: option.value,
              recognitionLabelDesc: option.label,
              deviceName: option.deviceName,
            },
            saved: false,
          }
          : point
      )));
    } else {
      setComponentOcrRows(selectedComponentCode, (ocrRowsByComponentRef.current[selectedComponentCode] || []).map((row) => (
        row.key === editingTargetTypeRow.key
          ? {
            ...row,
            name: buildCabinetGeneratedPointName(row.name, option.value, option.label, editingTargetTypeRow.index || row.index || 1),
            type: option.label,
            recognitionLabel: option.value,
            recognitionLabelDesc: option.label,
            deviceName: option.deviceName,
          }
          : row
      )));
    }

    const targetSelection = editingTargetTypeRow.relatedRectId && editingTargetTypeRow.relatedRectTool
      ? { id: editingTargetTypeRow.relatedRectId, tool: editingTargetTypeRow.relatedRectTool }
      : editingTargetTypeRow.boundRectId && (editingTargetTypeRow.boundRectTool === "deviceBox" || editingTargetTypeRow.boundRectTool === "appearance")
        ? { id: editingTargetTypeRow.boundRectId, tool: editingTargetTypeRow.boundRectTool }
        : null;
    if (targetSelection) {
      updateComponentAnnotations(selectedComponentCode, (current) => ({
        ...current,
        [annotationToolKey(targetSelection.tool)]: current[annotationToolKey(targetSelection.tool)].map((rect) => (
          rect.id === targetSelection.id
            ? {
              ...rect,
              text: option.label,
              recognitionLabel: option.value,
              recognitionLabelDesc: option.label,
              deviceName: option.deviceName,
              saved: false,
              generationStatus: rect.source === "manual" || !rect.source ? "pending" : "generated",
            }
            : rect
        )),
      }));
    }

    setTargetTypeModalOpen(false);
    setEditingTargetTypeRow(null);
    message.success("目标类型已修改");
  }, [
    editingTargetTypeRow,
    message,
    pushAnnotationHistory,
    selectedComponentCode,
    setComponentOcrRows,
    setComponentSinglePoints,
    updateComponentAnnotations,
  ]);

  const tableColumns = useMemo(
    () => createCabinetPointColumns({
      editingNameRowKey: editingNameRow?.key || "",
      editingNameValue,
      onStartEditName: handleStartEditTableRowName,
      onChangeEditName: setEditingNameValue,
      onSubmitEditName: handleSubmitTableRowNameEdit,
      onCancelEditName: handleCancelTableRowNameEdit,
      onEditType: handleEditTableRowType,
    }),
    [
      editingNameRow?.key,
      editingNameValue,
      handleCancelTableRowNameEdit,
      handleEditTableRowType,
      handleStartEditTableRowName,
      handleSubmitTableRowNameEdit,
    ],
  );

  const generateMenu = useMemo<MenuProps>(() => ({
    items: [
      { key: "whole", label: generateModeLabels.whole },
      { key: "add", label: generateModeLabels.add },
    ],
    onClick: ({ key }) => {
      if (key === "whole") {
        handleWholeImageGenerate();
        return;
      }
      if (key === "add") handleAddGenerate();
    },
  }), [handleAddGenerate, handleWholeImageGenerate]);

  const resetCabinetWorkspace = useCallback(() => {
    singleRecognitionAbortRef.current?.abort();
    batchRecognitionAbortRef.current?.abort();
    imageCacheRef.current.clear();
    setSelectedImageDataUrl("");
    setImageError("");
    setActiveAnnotationTool(null);
    setSelectedAnnotation(null);
    annotationHistoryRef.current = [];
    annotationsByComponentRef.current = {};
    ocrRowsByComponentRef.current = {};
    singlePointsByComponentRef.current = {};
    pointVerifiedByComponentRef.current = {};
    persistedAnnotationKeysRef.current = new Set();
    setAnnotationsByComponent({});
    setOcrRowsByComponent({});
    setSinglePointsByComponent({});
    setPointVerifiedByComponentState({});
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDrawing(false);
    setSinglePointCreatedRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    setCabinetNameDrawing(false);
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
    setComponents([]);
    setExpandedKeys([]);
    setSelectedComponentCode("");
    setBatchModalOpen(false);
    setBatchProgress(null);
    setBatchCancelling(false);
    setBatchNodeStatus({});
  }, []);

  const applyCabinetWorkspaceResult = useCallback((result: CabinetImagePackageResult) => {
    const records = result.records || [];
    const nextAnnotations = (result.annotationsByComponent || {}) as Record<string, ComponentAnnotations>;
    const nextOcrRows = (result.ocrRowsByComponent || {}) as Record<string, CabinetPointRow[]>;
    const nextSinglePoints = (result.singlePointsByComponent || {}) as Record<string, CabinetSinglePoint[]>;
    const nextPointVerified = (result.pointVerifiedByComponent || {}) as Record<string, boolean>;
    imageCacheRef.current.clear();
    setSelectedImageDataUrl("");
    setImageError("");
    setActiveAnnotationTool(null);
    setSelectedAnnotation(null);
    annotationHistoryRef.current = [];
    annotationsByComponentRef.current = nextAnnotations;
    ocrRowsByComponentRef.current = nextOcrRows;
    singlePointsByComponentRef.current = nextSinglePoints;
    pointVerifiedByComponentRef.current = nextPointVerified;
    persistedAnnotationKeysRef.current = new Set([
      ...Object.keys(nextAnnotations),
      ...Object.keys(nextOcrRows),
      ...Object.keys(nextSinglePoints),
    ]);
    setAnnotationsByComponent(nextAnnotations);
    setOcrRowsByComponent(nextOcrRows);
    setSinglePointsByComponent(nextSinglePoints);
    setPointVerifiedByComponentState(nextPointVerified);
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDrawing(false);
    setSinglePointCreatedRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    setCabinetNameDrawing(false);
    setCabinetNameModalOpen(false);
    setCabinetNameDraft("");
    setCabinetNameRecognizedText("");
    setCabinetNameConfidence(null);
    setBatchModalOpen(false);
    setBatchProgress(null);
    setBatchNodeStatus({});
    setComponents(records);
    setExpandedKeys(buildInitialExpandedKeys(records));
    setSelectedComponentCode((current) => {
      if (current && records.some((record) => getCabinetRecordKey(record) === current)) return current;
      const firstWithImage = records.find((item) => item.imageSource || item.imageDataUrl) || records[0];
      return firstWithImage ? getCabinetRecordKey(firstWithImage) : "";
    });
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      resetCabinetWorkspace();
      return;
    }
    if (!window.electronAPI?.loadLocalCabinetImagePackage) return;

    let cancelled = false;
    setLoadingPackage(true);
    window.electronAPI.loadLocalCabinetImagePackage(selectedProject)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) throw new Error(result.error || "加载本地屏柜图像失败");
        applyCabinetWorkspaceResult(result);
        if (result.warnings?.length) message.warning(`本地屏柜图像加载完成，${result.warnings.length} 条数据需要检查`);
      })
      .catch((e: any) => {
        if (!cancelled) {
          resetCabinetWorkspace();
          message.error(e?.message || "加载本地屏柜图像失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPackage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyCabinetWorkspaceResult, message, resetCabinetWorkspace, selectedProject]);

  useEffect(() => {
    let cancelled = false;
    const component = selectedComponent;
    setImageError("");
    setSelectedImageDataUrl("");

    if (!component) {
      setLoadingImage(false);
      return () => {
        cancelled = true;
      };
    }

    const cacheKey = buildCabinetImageCacheKey(component);
    const cached = imageCacheRef.current.get(cacheKey);
    if (cached) {
      setSelectedImageDataUrl(cached);
      setLoadingImage(false);
      return () => {
        cancelled = true;
      };
    }

    if (component.imageDataUrl) {
      imageCacheRef.current.set(cacheKey, component.imageDataUrl);
      setSelectedImageDataUrl(component.imageDataUrl);
      setLoadingImage(false);
      return () => {
        cancelled = true;
      };
    }

    if (!component.imageSource) {
      setLoadingImage(false);
      return () => {
        cancelled = true;
      };
    }

    if (!window.electronAPI?.loadCabinetImage) {
      setLoadingImage(false);
      setImageError("当前环境不支持加载屏柜原图");
      return () => {
        cancelled = true;
      };
    }

    setLoadingImage(true);
    window.electronAPI.loadCabinetImage(component.imageSource.id)
      .then((result) => {
        if (cancelled) return;
        if (!result.success || !result.dataUrl) {
          throw new Error(result.error || "图片加载失败");
        }
        imageCacheRef.current.set(cacheKey, result.dataUrl);
        setSelectedImageDataUrl(result.dataUrl);
      })
      .catch((e: any) => {
        if (!cancelled) setImageError(e?.message || "图片加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingImage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedComponent]);

  /**
   * 导入屏柜图像包。
   * 主进程会根据机器人编码决定新增目录还是全量替换同编码目录。
   */
  const handleImportCabinetImages = async () => {
    if (!window.electronAPI?.selectZipFile || !window.electronAPI?.importCabinetImagePackage) {
      message.warning("仅 Electron 环境支持导入屏柜图像压缩包");
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    const zipPath = await window.electronAPI.selectZipFile();
    if (!zipPath) return;

    setLoadingPackage(true);
    try {
      const result = await window.electronAPI.importCabinetImagePackage(selectedProject, zipPath);
      if (!result.success) throw new Error(result.error || "导入屏柜图像失败");
      const records = result.records || [];
      applyCabinetWorkspaceResult(result);
      if (result.warnings?.length) {
        message.warning(`导入完成，${result.warnings.length} 个部件缺少图片`);
      } else {
        message.success(`已导入 ${records.length} 个屏柜部件`);
      }
    } catch (e: any) {
      message.error(e?.message || "导入屏柜图像失败");
    } finally {
      setLoadingPackage(false);
    }
  };

  /**
   * 导出屏柜点表 ZIP，数据来源包括原始部件 Excel 和当前保存的识别/人工点位。
   * ZIP 内包含 point.xlsx 和 calibration.json，且只导出已核查点位。
   */
  const handleExportCabinetPointTable = useCallback(async (triggerElement?: HTMLElement) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!components.length) {
      message.warning("请先导入屏柜图像");
      return;
    }
    if (!window.electronAPI?.downloadTasks || !window.electronAPI?.selectDir) {
      message.warning("仅 Electron 环境支持导出屏柜点表");
      return;
    }

    const summary = buildCabinetPointExportSummary(
      components,
      ocrRowsByComponentRef.current,
      singlePointsByComponentRef.current,
      pointVerifiedByComponentRef.current,
    );
    if (!summary.verifiedPoints) {
      message.warning("暂无已核查的屏柜点表数据");
      return;
    }
    if (summary.totalPoints > summary.verifiedPoints) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "确认导出屏柜点表",
          content: `当前共有 ${summary.verifiedPoints} 条已核查点位、${summary.totalPoints - summary.verifiedPoints} 条未核查点位，导出时只包含已核查数据。`,
          okText: "继续导出",
          cancelText: "取消",
          centered: true,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    setExportingPointTable(true);
    try {
      const result = await createLocalExportTask({
        name: "屏柜点表导出",
        operation: "cabinet-point-table",
        destTitle: "选择屏柜点表导出目录",
        payload: { projectName: selectedProject },
        triggerElement,
      });
      if (!result.success) {
        message.warning(result.error || "创建导出任务失败");
      }
    } catch (e: any) {
      message.error(e?.message || "创建导出任务失败");
    } finally {
      setExportingPointTable(false);
    }
  }, [components, message, modal, selectedProject]);

  /**
   * 导出 detector.json 标注参数。
   * 这里会先做强校验，确保名称、类型、目标框和标定 id 都完整。
   */
  const handleExportAnnotationParams = useCallback(async (triggerElement?: HTMLElement) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!components.length) {
      message.warning("请先导入屏柜图像");
      return;
    }
    if (!window.electronAPI?.downloadTasks || !window.electronAPI?.selectDir) {
      message.warning("仅 Electron 环境支持导出标注参数");
      return;
    }

    const summary = buildCabinetPointExportSummary(
      components,
      ocrRowsByComponentRef.current,
      singlePointsByComponentRef.current,
      pointVerifiedByComponentRef.current,
    );
    if (!summary.verifiedPoints) {
      message.warning("暂无已核查的标注点位");
      return;
    }
    if (summary.totalPoints > summary.verifiedPoints) {
      const confirmed = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "确认导出标注参数",
          content: `当前共有 ${summary.verifiedPoints} 条已核查点位、${summary.totalPoints - summary.verifiedPoints} 条未核查点位，导出时只包含已核查数据。`,
          okText: "继续导出",
          cancelText: "取消",
          centered: true,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    const exportResult = buildCabinetAnnotationParamsExport({
      projectName: selectedProject,
      records: components,
      annotationsByComponent: annotationsByComponentRef.current,
      ocrRowsByComponent: ocrRowsByComponentRef.current,
      singlePointsByComponent: singlePointsByComponentRef.current,
      pointVerifiedByComponent: pointVerifiedByComponentRef.current,
    });

    if (exportResult.errors.length) {
      modal.error({
        title: "导出标注参数失败",
        width: 620,
        content: (
          <div className="screen-verify-export-errors">
            {exportResult.errors.slice(0, 12).map((error) => (
              <div key={error}>{error}</div>
            ))}
            {exportResult.errors.length > 12 ? (
              <div>还有 {exportResult.errors.length - 12} 条问题，请继续检查标注数据。</div>
            ) : null}
          </div>
        ),
      });
      return;
    }

    setExportingAnnotationParams(true);
    try {
      const result = await createLocalExportTask({
        name: "屏柜标注参数导出",
        operation: "cabinet-annotation-params",
        destTitle: "选择标注参数导出目录",
        payload: { projectName: selectedProject, data: exportResult.data },
        triggerElement,
      });
      if (!result.success) {
        message.warning(result.error || "创建导出任务失败");
      }
    } catch (e: any) {
      message.error(e?.message || "创建导出任务失败");
    } finally {
      setExportingAnnotationParams(false);
    }
  }, [components, message, modal, selectedProject]);

  return (
    <div className={`screen-verify-page${leftResizing || rightResizing ? " is-resizing" : ""}`}>
      <div className="screen-verify-toolbar">
        <Space size={12} wrap>
          <Button loading={loadingPackage} onClick={handleImportCabinetImages}>导入屏柜图像</Button>
          <Button loading={exportingPointTable} onClick={(event) => handleExportCabinetPointTable(event.currentTarget)}>导出屏柜点表</Button>
          <Button loading={exportingAnnotationParams} onClick={(event) => handleExportAnnotationParams(event.currentTarget)}>导出标注参数</Button>
          <Button onClick={handleOpenBatchRecognition}>批量识别</Button>
        </Space>
      </div>

      <div className="screen-verify-body" ref={containerRef}>
        <aside className="screen-verify-left" style={{ width: leftWidth }}>
          <div className="screen-verify-left-filters">
            <Select
              className="screen-verify-status-select"
              size="middle"
              value={statusFilter}
              onChange={setStatusFilter}
              options={statusOptions}
            />
            <Input
              className="screen-verify-search"
              size="middle"
              placeholder="筛选屏柜名称"
              allowClear
              value={nameFilter}
              onChange={(event) => setNameFilter(event.target.value)}
            />
          </div>
          <div className="screen-verify-tree">
            {loadingPackage ? (
              <div className="screen-verify-tree-empty"><Spin /></div>
            ) : treeData.length > 0 ? (
              <Tree
                blockNode
                showLine
                treeData={treeData}
                titleRender={(node) => {
                  const treeNode = node as CabinetTreeNode;
                  const componentCode = String(treeNode.key).startsWith("component:")
                    ? String(treeNode.key).slice("component:".length)
                    : String(treeNode.key);
                  return (
                    <CabinetTreeTitle
                      node={treeNode}
                      batchStatus={batchNodeStatus[componentCode]}
                      pointVerified={Boolean(pointVerifiedByComponent[componentCode])}
                      onRenameMainDevice={openRenameMainDevice}
                    />
                  );
                }}
                selectedKeys={selectedComponentCode ? [`component:${selectedComponentCode}`] : []}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  if (key.startsWith("component:")) setSelectedComponentCode(key.slice("component:".length));
                }}
              />
            ) : (
              <div className="screen-verify-tree-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={components.length ? "未找到匹配的屏柜" : "请导入屏柜图像"}
                />
              </div>
            )}
          </div>
        </aside>

        <div className="screen-verify-resizer" onMouseDown={onLeftResizeStart} />

        <main className="screen-verify-main">
          <div className="screen-verify-actionbar">
            <div className="screen-verify-action-group screen-verify-action-group-left">
              <Button type={activeAnnotationTool === "standardPart" ? "primary" : "default"} onClick={() => toggleAnnotationTool("standardPart")}>标准部件框</Button>
              <Button type={activeAnnotationTool === "deviceLabel" ? "primary" : "default"} onClick={() => toggleAnnotationTool("deviceLabel")}>设备标签框</Button>
              <Button type={activeAnnotationTool === "deviceBox" ? "primary" : "default"} onClick={() => toggleAnnotationTool("deviceBox")}>设备框</Button>
              <Button type={activeAnnotationTool === "appearance" ? "primary" : "default"} onClick={() => toggleAnnotationTool("appearance")}>外观框</Button>
            </div>
            <div className="screen-verify-action-spacer" />
            <div className="screen-verify-action-group">
              <Dropdown.Button
                icon={<DownOutlined />}
                menu={generateMenu}
                onClick={handleWholeImageGenerate}
              >
                {generateModeLabels.whole}
              </Dropdown.Button>
              <Button onClick={handleSortPointRows}>一键排序</Button>
              <Button onClick={handleSaveCurrentImage}>保存</Button>
            </div>
            <div className="screen-verify-action-spacer" />
            <div className="screen-verify-action-group">
              <Button type={singlePointDrawing ? "primary" : "default"} onClick={handleSinglePointAddGenerate}>单点新增生成</Button>
              <Button type={cabinetNameDrawing ? "primary" : "default"} onClick={handleCabinetRecognition}>屏柜识别</Button>
            </div>
          </div>
          <div className="screen-verify-canvas">
            {loadingPackage || loadingImage ? (
              <Spin />
            ) : selectedComponent ? (
              imageError ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={imageError} />
              ) : selectedImageDataUrl ? (
                <CabinetImageCanvas
                  imageDataUrl={selectedImageDataUrl}
                  title={selectedComponent.componentName || selectedComponent.componentCode}
                  activeTool={activeAnnotationTool}
                  annotations={selectedAnnotations}
                  selectedAnnotation={selectedAnnotation}
                  onCreateRect={handleCreateAnnotationRect}
                  onUpdateRect={handleUpdateAnnotationRect}
                  onDeleteRect={handleDeleteAnnotationRect}
                  onSelectRect={handleSelectAnnotation}
                  onUndo={handleUndoAnnotation}
                  onExitTool={handleExitAnnotationTool}
                  onLoadError={setImageError}
                />
              ) : selectedComponent.imageSource || selectedComponent.imageDataUrl ? (
                <Spin />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前部件未找到图片" />
              )
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择左侧部件" />
            )}
            {ocrLoading && selectedImageDataUrl && !loadingPackage && !loadingImage ? (
              <div className="screen-verify-canvas-loading">
                <Spin tip="识别中..." />
              </div>
            ) : null}
          </div>
        </main>

        <div className="screen-verify-resizer" onMouseDown={onRightResizeStart} />

        <aside className="screen-verify-right" style={{ width: rightWidth }}>
          <div className="screen-verify-check">
            <Checkbox
              checked={selectedPointVerified}
              disabled={!selectedTableRows.length || ocrLoading || loadingPackage || loadingImage}
              onChange={handlePointVerificationChange}
            >
              点位核查完成
            </Checkbox>
          </div>
          <div className="screen-verify-table-wrap" ref={rightTableWrapRef}>
            <Table<CabinetPointRow>
              className="screen-verify-table"
              columns={tableColumns}
              dataSource={selectedTableRows}
              size="small"
              tableLayout="fixed"
              pagination={false}
              scroll={{ y: rightTableScrollY }}
              onRow={(record) => ({
                className: [
                  selectedTableRowKeys.has(record.key) ? "screen-verify-table-row-selected" : "",
                  !record.name.trim() ? "screen-verify-table-row-empty-name" : "",
                ].filter(Boolean).join(" "),
                onClick: () => handleSelectTableRow(record),
              })}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }}
            />
          </div>
        </aside>
      </div>

      <BatchRecognitionModal
        open={batchModalOpen}
        mode={batchMode}
        progress={batchProgress}
        cancelling={batchCancelling}
        onModeChange={setBatchMode}
        onStart={handleStartBatchRecognition}
        onCancel={handleCancelBatchRecognition}
      />

      <Modal
        title="修改屏柜名称"
        open={Boolean(renameMainKey)}
        centered
        onOk={commitRenameMainDevice}
        onCancel={cancelRenameMainDevice}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameMainName}
          placeholder="请输入屏柜名称"
          onChange={(event) => setRenameMainName(event.target.value)}
          onPressEnter={commitRenameMainDevice}
        />
      </Modal>

      <Modal
        title="确认屏柜名称"
        open={cabinetNameModalOpen}
        centered
        onOk={handleSubmitCabinetNameConfirm}
        onCancel={handleCancelCabinetNameConfirm}
        okText="确认修改"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="screen-verify-cabinet-name-confirm">
          <div className="screen-verify-cabinet-name-meta">
            <span>识别结果：{cabinetNameRecognizedText || "未识别到名称"}</span>
            {cabinetNameConfidence != null && (
              <span>置信度：{Math.round(cabinetNameConfidence * 100)}%</span>
            )}
          </div>
          <Input
            autoFocus
            value={cabinetNameDraft}
            placeholder="请输入屏柜名称"
            onChange={(event) => setCabinetNameDraft(event.target.value)}
            onPressEnter={handleSubmitCabinetNameConfirm}
          />
        </div>
      </Modal>

      <SinglePointModal
        open={singlePointModalOpen}
        initialValues={singlePointDraft}
        onCancel={handleCancelSinglePoint}
        onSubmit={handleSubmitSinglePoint}
      />

      <TargetTypeModal
        open={targetTypeModalOpen}
        value={resolveTargetTypeValue(editingTargetTypeRow)}
        onCancel={handleCancelTargetTypeEdit}
        onSubmit={handleSubmitTargetTypeEdit}
      />
    </div>
  );
}
