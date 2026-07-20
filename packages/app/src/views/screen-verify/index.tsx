import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Key } from "react";
import { DownOutlined, EditOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Checkbox, Dropdown, Empty, Input, Modal, Select, Space, Spin, Table, Tree } from "antd";
import type { MenuProps } from "antd";
import { useResizable } from "@/components/useResizable";
import { CabinetImageCanvas } from "./components/CabinetImageCanvas";
import { SinglePointModal } from "./components/SinglePointModal";
import { mockDetectDevices } from "./services/device-detection-service";
import { cropCabinetOcrImage, recognizeCabinetLabels } from "./services/ocr-service";
import type { CabinetOcrDetectedLabel } from "./services/ocr-service";
import { validateAnnotationGroups } from "./utils/annotation-group-utils";
import { annotationToolKey, cloneAnnotations, createEmptyAnnotations, findSelectedAnnotation } from "./utils/annotation-utils";
import { buildCabinetImageCacheKey } from "./utils/cabinet-image-utils";
import { columns, generateModeLabels, MIN_ANNOTATION_RECT_SIZE, statusOptions } from "./utils/constants";
import { buildCabinetTree, buildInitialExpandedKeys, buildMainDeviceKey } from "./utils/tree-utils";
import type {
  AnnotationHistoryEntry,
  AnnotationSelection,
  AnnotationTool,
  CabinetOcrScope,
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
};

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
}

type MultiPointGenerateMode = "whole" | "add";

export default function ScreenVerify() {
  const { message, modal } = AntdApp.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState("marked");
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
  const [singlePointModalOpen, setSinglePointModalOpen] = useState(false);
  const [singlePointDraft, setSinglePointDraft] = useState<SinglePointDraft>(EMPTY_SINGLE_POINT_DRAFT);
  const [singlePointTargetRect, setSinglePointTargetRect] = useState<ImageRect | null>(null);
  const imageCacheRef = useRef(new Map<string, string>());
  const annotationsByComponentRef = useRef<Record<string, ComponentAnnotations>>({});
  const ocrRowsByComponentRef = useRef<Record<string, CabinetPointRow[]>>({});
  const singlePointsByComponentRef = useRef<Record<string, CabinetSinglePoint[]>>({});
  const annotationHistoryRef = useRef<AnnotationHistoryEntry[]>([]);

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
    () => components.find((item) => item.componentCode === selectedComponentCode) || null,
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

  const selectedTableRows = useMemo(() => {
    const rows: CabinetPointRow[] = [
      ...selectedOcrRows.map((row) => ({ ...row, source: row.source || "ocr" as const })),
      ...selectedSinglePoints.map((point) => ({
        key: point.id,
        index: 0,
        name: point.pointName,
        type: point.recognitionType,
        source: "single" as const,
        boundRectId: point.boundRectId,
        boundRectTool: point.boundRectTool,
      })),
    ];
    return rows.map((row, index) => ({ ...row, index: index + 1 }));
  }, [selectedOcrRows, selectedSinglePoints]);

  const { treeData, allExpandableKeys } = useMemo(() => buildCabinetTree(components, nameFilter), [components, nameFilter]);

  useEffect(() => {
    if (nameFilter.trim()) setExpandedKeys(allExpandableKeys);
  }, [allExpandableKeys, nameFilter]);

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
    setSelectedAnnotation(null);
  }, [selectedComponentCode]);

  const openRenameMainDevice = useCallback((node: CabinetTreeNode) => {
    setRenameMainKey(node.key);
    setRenameMainName(node.title);
  }, []);

  const cancelRenameMainDevice = useCallback(() => {
    setRenameMainKey("");
    setRenameMainName("");
  }, []);

  const commitRenameMainDevice = useCallback(() => {
    const mainKey = renameMainKey;
    const nextName = renameMainName.trim();
    if (!nextName) {
      message.warning("屏柜名称不能为空");
      return;
    }

    const matchedRecords = components.filter((record) => buildMainDeviceKey(record) === mainKey);
    const changed = matchedRecords.some((record) => record.mainDeviceName !== nextName);
    const nextMainKey = matchedRecords[0] ? buildMainDeviceKey({ ...matchedRecords[0], mainDeviceName: nextName }) : mainKey;
    setComponents((prev) => prev.map((record) => {
      if (buildMainDeviceKey(record) !== mainKey) return record;
      return { ...record, mainDeviceName: nextName };
    }));
    if (changed && nextMainKey !== mainKey) {
      setExpandedKeys((keys) => keys.map((key) => (key === mainKey ? nextMainKey : key)));
    }
    setRenameMainKey("");
    setRenameMainName("");
  }, [components, message, renameMainKey, renameMainName]);

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

  const updateComponentAnnotations = useCallback((componentCode: string, updater: (current: ComponentAnnotations) => ComponentAnnotations) => {
    if (!componentCode) return;
    const currentState = annotationsByComponentRef.current;
    const current = currentState[componentCode] || createEmptyAnnotations();
    const next = {
      ...currentState,
      [componentCode]: updater(current),
    };
    annotationsByComponentRef.current = next;
    setAnnotationsByComponent(next);
  }, []);

  const buildCabinetOcrSources = useCallback(async (scope: CabinetOcrScope): Promise<CabinetOcrSource[] | null> => {
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return null;
    }
    if (!selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return null;
    }

    if (scope === "whole") {
      const sources = await buildDeviceLabelOcrSources(selectedImageDataUrl, selectedAnnotations.deviceLabelRects);
      if (!sources.length) {
        message.warning("请先框选需要识别的标签区域");
        return null;
      }
      return sources;
    }

    if (scope === "deviceLabels") {
      message.info("多点生成（新增）后续接入");
      return null;
    }

    if (!selectedAnnotation) {
      message.warning("请先选中需要识别的框");
      return null;
    }
    const selectedRect = findSelectedAnnotation(selectedAnnotations, selectedAnnotation);
    if (!selectedRect) {
      message.warning("选中的框已不存在");
      return null;
    }
    const crop = await cropCabinetOcrImage(selectedImageDataUrl, selectedRect, 8);
    return [{
      regionId: "region_1",
      title: "选中框",
      dataUrl: crop.dataUrl,
      originX: crop.originX,
      originY: crop.originY,
      width: crop.width,
      height: crop.height,
      targetX: selectedRect.x,
      targetY: selectedRect.y,
      targetW: selectedRect.w,
      targetH: selectedRect.h,
      sourceRectId: selectedAnnotation.tool === "deviceLabel" ? selectedRect.id : undefined,
    }];
  }, [message, selectedAnnotation, selectedAnnotations, selectedComponent, selectedImageDataUrl]);

  const applyOcrLabelRects = useCallback((sources: CabinetOcrSource[], labelRects: ImageRect[]) => {
    if (!selectedComponentCode || !labelRects.length) return;
    const detectedRegionIds = new Set(labelRects.map((rect) => rect.id.split(":")[1]).filter(Boolean));
    const sourceRectIdsToReplace = new Set(
      sources
        .filter((source) => source.sourceRectId && detectedRegionIds.has(source.regionId))
        .map((source) => source.sourceRectId as string),
    );

    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => ({
      ...current,
      deviceLabelRects: [
        ...current.deviceLabelRects.filter((rect) => !sourceRectIdsToReplace.has(rect.id)),
        ...labelRects,
      ],
    }));
    setSelectedAnnotation(labelRects[0] ? { tool: "deviceLabel", id: labelRects[0].id } : null);
  }, [pushAnnotationHistory, selectedComponentCode, updateComponentAnnotations]);

  const runCabinetOcr = useCallback(async (actionName: string, scope: CabinetOcrScope) => {
    if (ocrLoading) return;

    let sources: CabinetOcrSource[] | null = null;
    try {
      sources = await buildCabinetOcrSources(scope);
    } catch (e: any) {
      message.error(e?.message || "图片裁剪失败");
      return;
    }
    if (!sources?.length) return;

    setOcrLoading(true);
    try {
      const result = await recognizeCabinetLabels(sources.map((source) => ({
        regionId: source.regionId,
        title: source.title,
        dataUrl: source.dataUrl,
      })));
      const labelRects = mapOcrLabelsToImageRects(result.labels, sources);
      console.info("[screen-verify] OCR result", {
        actionName,
        scope,
        sources: sources.map(({ dataUrl, ...source }) => source),
        rawText: result.rawText,
        regions: result.regions,
        labels: result.labels,
        mappedRects: labelRects,
      });
      if (!labelRects.length) {
        message.warning("未识别到标签");
        return;
      }
      applyOcrLabelRects(sources, labelRects);
      if (selectedComponentCode) {
        setOcrRowsByComponent((prev) => ({
          ...prev,
          [selectedComponentCode]: labelRects.map((rect, index) => ({
            key: rect.id,
            index: index + 1,
            name: rect.text || "",
            confidence: rect.confidence,
            source: "ocr",
            boundRectId: rect.id,
            boundRectTool: "deviceLabel",
          })),
        }));
      }
      message.success(`识别完成，共 ${labelRects.length} 条标签`);
    } catch (e: any) {
      message.error(e?.message || "标签识别失败");
    } finally {
      setOcrLoading(false);
    }
  }, [applyOcrLabelRects, buildCabinetOcrSources, message, ocrLoading, selectedComponentCode]);

  const runMockMultiPointGenerate = useCallback(async (mode: MultiPointGenerateMode) => {
    if (ocrLoading) return;
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (!selectedImageDataUrl) {
      message.warning("请等待屏柜图片加载完成");
      return;
    }

    const current = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    const working = mode === "whole" ? retainPendingManualAnnotations(current) : cloneAnnotations(current);
    const targetLabels = working.deviceLabelRects.filter(isPendingManualRect);
    const targetLabelIds = new Set(targetLabels.map((rect) => rect.id));
    const requiredStandardPartIds = new Set(
      working.standardPartRects.filter(isPendingManualRect).map((rect) => rect.id),
    );
    const validation = validateAnnotationGroups(working, { targetLabelIds, requiredStandardPartIds });
    if (validation.issues.length) {
      message.error(validation.issues[0]);
      return;
    }

    setOcrLoading(true);
    try {
      const groupByInputLabelId = new Map<string, string>();
      for (const group of validation.groups) {
        for (const label of group.labelRects) groupByInputLabelId.set(label.id, group.id);
      }
      const sources = await buildDeviceLabelOcrSources(selectedImageDataUrl, targetLabels, groupByInputLabelId);
      const result = await recognizeCabinetLabels(sources.map((source) => ({
        regionId: source.regionId,
        title: source.title,
        dataUrl: source.dataUrl,
      })));
      const recognizedLabelRects = mapOcrLabelsToImageRects(result.labels, sources);
      console.info("[screen-verify] multi-point label OCR result", {
        mode,
        sources: sources.map(({ dataUrl, ...source }) => source),
        rawText: result.rawText,
        regions: result.regions,
        labels: result.labels,
        mappedRects: recognizedLabelRects,
      });
      if (!recognizedLabelRects.length) {
        message.warning("未识别到标签");
        return;
      }

      const recognizedGroups = validation.groups
        .map((group) => ({
          ...group,
          labelRects: recognizedLabelRects.filter((rect) => rect.groupId === group.id),
          deviceRects: [],
        }))
        .filter((group) => group.labelRects.length > 0);
      const response = mockDetectDevices(recognizedGroups);
      if (response.issues.length) {
        message.error(response.issues[0]);
        return;
      }

      const recognizedSourceRectIds = new Set(
        recognizedLabelRects.map((rect) => rect.generatedFromRectId).filter(Boolean) as string[],
      );
      const affectedGroupIds = new Set(recognizedGroups.map((group) => group.id));
      const generationKey = Date.now();
      const generatedDeviceRects: ImageRect[] = response.detections.map((detection, index) => ({
        id: `mock-device:${generationKey}:${index}:${Math.random().toString(16).slice(2)}`,
        ...detection.result.rect,
        confidence: detection.result.score,
        source: "mock",
        saved: false,
        generationStatus: "generated",
        groupId: detection.groupId,
        generatedFromRectId: detection.sourceLabelRectId,
      }));

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

      pushAnnotationHistory(selectedComponentCode);
      updateComponentAnnotations(selectedComponentCode, () => nextAnnotations);
      const recognizedRows: CabinetPointRow[] = recognizedLabelRects.map((rect, index) => ({
        key: rect.id,
        index: index + 1,
        name: rect.text || "",
        confidence: rect.confidence,
        source: "ocr",
        boundRectId: rect.id,
        boundRectTool: "deviceLabel",
      }));
      setOcrRowsByComponent((prev) => ({
        ...prev,
        [selectedComponentCode]: mode === "whole"
          ? recognizedRows
          : [...(prev[selectedComponentCode] || []), ...recognizedRows],
      }));
      if (mode === "whole") {
        setSinglePointsByComponent((prev) => ({ ...prev, [selectedComponentCode]: [] }));
        setSinglePointModalOpen(false);
        setSinglePointTargetRect(null);
      }
      setSelectedAnnotation(generatedDeviceRects[0]
        ? { tool: "deviceBox", id: generatedDeviceRects[0].id }
        : { tool: "deviceLabel", id: recognizedLabelRects[0].id });
      message.success(`已识别 ${recognizedLabelRects.length} 个标签，并模拟生成 ${generatedDeviceRects.length} 个部件框`);
    } catch (e: any) {
      message.error(e?.message || "标签识别失败");
    } finally {
      setOcrLoading(false);
    }
  }, [message, ocrLoading, pushAnnotationHistory, selectedComponentCode, selectedImageDataUrl, updateComponentAnnotations]);

  const handleWholeImageGenerate = useCallback(() => {
    if (ocrLoading) return;
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    modal.confirm({
      title: "确认执行多点生成（整图）？",
      content: "该操作会删除当前图片所有已保存框、识别结果和点位数据，仅识别当前新框选且尚未保存的区域。",
      okText: "删除并生成",
      okType: "danger",
      cancelText: "取消",
      centered: true,
      onOk: () => runMockMultiPointGenerate("whole"),
    });
  }, [message, modal, ocrLoading, runMockMultiPointGenerate, selectedComponentCode]);

  const handleAddGenerate = useCallback(() => {
    void runMockMultiPointGenerate("add");
  }, [runMockMultiPointGenerate]);

  const handleSinglePointAddGenerate = useCallback(() => {
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    if (!selectedAnnotation) {
      message.warning("请先点击选中设备部件框");
      return;
    }
    if (selectedAnnotation.tool !== "deviceBox") {
      message.warning("请先选中设备框");
      return;
    }
    const selectedRect = findSelectedAnnotation(selectedAnnotations, selectedAnnotation);
    if (!selectedRect) {
      message.warning("选中的设备部件框已不存在");
      return;
    }
    setSinglePointTargetRect({ ...selectedRect });
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    setSinglePointModalOpen(true);
  }, [message, selectedAnnotation, selectedAnnotations, selectedComponent]);

  const handleCancelSinglePoint = useCallback(() => {
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
  }, []);

  const handleSubmitSinglePoint = useCallback((values: SinglePointDraft) => {
    if (!selectedComponentCode || !singlePointTargetRect) {
      message.warning("请先选中设备部件框");
      return;
    }

    const point: CabinetSinglePoint = {
      id: createSinglePointId(),
      componentCode: selectedComponentCode,
      pointName: values.pointName,
      recognitionType: values.recognitionType,
      boundRectId: singlePointTargetRect.id,
      boundRectTool: "deviceBox",
      rectSnapshot: { ...singlePointTargetRect },
      createdAt: new Date().toISOString(),
      saved: false,
    };

    setSinglePointsByComponent((prev) => ({
      ...prev,
      [selectedComponentCode]: [...(prev[selectedComponentCode] || []), point],
    }));
    setSinglePointModalOpen(false);
    setSinglePointTargetRect(null);
    setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
    message.success("单点已生成");
  }, [message, selectedComponentCode, singlePointTargetRect]);

  const handleSaveCurrentImage = useCallback(() => {
    if (!selectedComponentCode) {
      message.warning("请先选择左侧部件");
      return;
    }
    const annotations = annotationsByComponentRef.current[selectedComponentCode] || createEmptyAnnotations();
    const points = singlePointsByComponent[selectedComponentCode] || [];
    const annotationCount = getAnnotationCount(annotations);
    if (!annotationCount && !points.length) {
      message.warning("当前图片暂无可保存数据");
      return;
    }

    console.info("[screen-verify] current image save", {
      componentCode: selectedComponentCode,
      annotations,
      points,
    });
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => mapAnnotationRects(current, (rect) => ({
      ...rect,
      saved: true,
      generationStatus: "saved",
    })));
    setSinglePointsByComponent((prev) => ({
      ...prev,
      [selectedComponentCode]: points.map((point) => ({ ...point, saved: true })),
    }));
    message.success(`已保存当前图片的 ${annotationCount} 个框和 ${points.length} 条点位数据`);
  }, [message, pushAnnotationHistory, selectedComponentCode, singlePointsByComponent, updateComponentAnnotations]);

  const handleCabinetRecognition = useCallback(() => {
    runCabinetOcr("屏柜识别", "whole");
  }, [runCabinetOcr]);

  const toggleAnnotationTool = useCallback((tool: AnnotationTool) => {
    if (!selectedComponent) {
      message.warning("请先选择左侧部件");
      return;
    }
    setSelectedAnnotation(null);
    setActiveAnnotationTool((current) => (current === tool ? null : tool));
  }, [message, selectedComponent]);

  const handleCreateAnnotationRect = useCallback((tool: AnnotationTool, rect: ImageRect) => {
    if (!selectedComponentCode) return;
    pushAnnotationHistory(selectedComponentCode);
    updateComponentAnnotations(selectedComponentCode, (current) => ({
      standardPartRects: tool === "standardPart" ? [...current.standardPartRects, rect] : current.standardPartRects,
      deviceLabelRects: tool === "deviceLabel" ? [...current.deviceLabelRects, rect] : current.deviceLabelRects,
      deviceBoxRects: tool === "deviceBox" ? [...current.deviceBoxRects, rect] : current.deviceBoxRects,
      appearanceRects: tool === "appearance" ? [...current.appearanceRects, rect] : current.appearanceRects,
    }));
    setSelectedAnnotation({ tool, id: rect.id });
  }, [pushAnnotationHistory, selectedComponentCode, updateComponentAnnotations]);

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
      setSinglePointsByComponent((prev) => {
        const points = prev[selectedComponentCode] || [];
        if (!points.some((point) => point.boundRectId === rect.id && point.boundRectTool === tool)) return prev;
        return {
          ...prev,
          [selectedComponentCode]: points.map((point) => (
            point.boundRectId === rect.id && point.boundRectTool === tool
              ? { ...point, rectSnapshot: { ...rect }, saved: false }
              : point
          )),
        };
      });
    }
    setSelectedAnnotation({ tool, id: rect.id });
  }, [pushAnnotationHistory, selectedComponentCode, updateComponentAnnotations]);

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
    setSinglePointsByComponent((prev) => {
      const points = prev[selectedComponentCode] || [];
      if (!points.some((point) => point.boundRectId === selection.id && point.boundRectTool === selection.tool)) return prev;
      return {
        ...prev,
        [selectedComponentCode]: points.filter((point) => point.boundRectId !== selection.id || point.boundRectTool !== selection.tool),
      };
    });
    if (selection.tool === "deviceLabel") {
      setOcrRowsByComponent((prev) => {
        const rows = prev[selectedComponentCode] || [];
        if (!rows.some((row) => row.boundRectId === selection.id && row.boundRectTool === selection.tool)) return prev;
        return {
          ...prev,
          [selectedComponentCode]: rows.filter((row) => row.boundRectId !== selection.id || row.boundRectTool !== selection.tool),
        };
      });
    }
    setSelectedAnnotation(null);
  }, [pushAnnotationHistory, selectedComponentCode, updateComponentAnnotations]);

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
    setSelectedAnnotation(null);
  }, []);

  const handleExitAnnotationTool = useCallback(() => {
    setActiveAnnotationTool(null);
  }, []);

  const handleSelectAnnotation = useCallback((selection: AnnotationSelection | null) => {
    setSelectedAnnotation(selection);
  }, []);

  const handleSelectTableRow = useCallback((row: CabinetPointRow) => {
    if (!row.boundRectId || !row.boundRectTool) return;
    const rect = findSelectedAnnotation(selectedAnnotations, {
      tool: row.boundRectTool,
      id: row.boundRectId,
    });
    if (!rect) {
      message.warning("绑定的框已不存在");
      return;
    }
    setSelectedAnnotation({
      tool: row.boundRectTool,
      id: row.boundRectId,
    });
  }, [message, selectedAnnotations]);

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

  const renderTreeTitle = useCallback((node: CabinetTreeNode) => {
    if (node.nodeType !== "main") {
      return <span className="screen-verify-tree-title">{node.title}</span>;
    }

    return (
      <span className="screen-verify-tree-title screen-verify-tree-title-editable">
        <span className="screen-verify-tree-title-text">{node.title}</span>
        <button
          type="button"
          className="screen-verify-tree-rename"
          title="修改屏柜名称"
          onClick={(event) => {
            event.stopPropagation();
            openRenameMainDevice(node);
          }}
        >
          <EditOutlined />
        </button>
      </span>
    );
  }, [openRenameMainDevice]);

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

  const handleImportCabinetImages = async () => {
    if (!window.electronAPI?.selectZipFile || !window.electronAPI?.importCabinetImagePackage) {
      message.warning("仅 Electron 环境支持导入屏柜图像压缩包");
      return;
    }
    const zipPath = await window.electronAPI.selectZipFile();
    if (!zipPath) return;

    setLoadingPackage(true);
    try {
      const result = await window.electronAPI.importCabinetImagePackage(zipPath);
      if (!result.success) throw new Error(result.error || "导入屏柜图像失败");
      const records = result.records || [];
      imageCacheRef.current.clear();
      setSelectedImageDataUrl("");
      setImageError("");
      setActiveAnnotationTool(null);
      setSelectedAnnotation(null);
      annotationHistoryRef.current = [];
      annotationsByComponentRef.current = {};
      setAnnotationsByComponent({});
      setOcrRowsByComponent({});
      setSinglePointsByComponent({});
      setSinglePointModalOpen(false);
      setSinglePointTargetRect(null);
      setSinglePointDraft(EMPTY_SINGLE_POINT_DRAFT);
      setComponents(records);
      setExpandedKeys(buildInitialExpandedKeys(records));
      const firstWithImage = records.find((item) => item.imageSource || item.imageDataUrl) || records[0];
      setSelectedComponentCode(firstWithImage?.componentCode || "");
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

  return (
    <div className={`screen-verify-page${leftResizing || rightResizing ? " is-resizing" : ""}`}>
      <div className="screen-verify-toolbar">
        <Space size={12} wrap>
          <Button type="primary" loading={loadingPackage} onClick={handleImportCabinetImages}>导入屏柜图像</Button>
          <Button type="primary">导出屏柜点表</Button>
          <Button type="primary">导出标注参数</Button>
          <Button type="primary">批量识别</Button>
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
              placeholder="请输入屏柜名称"
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
                titleRender={(node) => renderTreeTitle(node as CabinetTreeNode)}
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
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请导入屏柜图像" />
              </div>
            )}
          </div>
        </aside>

        <div className="screen-verify-resizer" onMouseDown={onLeftResizeStart} />

        <main className="screen-verify-main">
          <div className="screen-verify-actionbar">
            <div className="screen-verify-action-group screen-verify-action-group-left">
              <Button type={activeAnnotationTool === "standardPart" ? "default" : "primary"} onClick={() => toggleAnnotationTool("standardPart")}>标准部件框</Button>
              <Button type={activeAnnotationTool === "deviceLabel" ? "default" : "primary"} onClick={() => toggleAnnotationTool("deviceLabel")}>设备标签框</Button>
              <Button type={activeAnnotationTool === "deviceBox" ? "default" : "primary"} onClick={() => toggleAnnotationTool("deviceBox")}>设备框</Button>
              <Button type={activeAnnotationTool === "appearance" ? "default" : "primary"} onClick={() => toggleAnnotationTool("appearance")}>外观框</Button>
            </div>
            <div className="screen-verify-action-spacer" />
            <div className="screen-verify-action-group">
              <Dropdown.Button
                type="primary"
                icon={<DownOutlined />}
                menu={generateMenu}
                loading={ocrLoading}
                onClick={handleWholeImageGenerate}
              >
                {generateModeLabels.whole}
              </Dropdown.Button>
              <Button type="primary">一键排序</Button>
              <Button type="primary" onClick={handleSaveCurrentImage}>保存</Button>
            </div>
            <div className="screen-verify-action-spacer" />
            <div className="screen-verify-action-group">
              <Button type="primary" loading={ocrLoading} onClick={handleSinglePointAddGenerate}>单点新增生成</Button>
              <Button type="primary" loading={ocrLoading} onClick={handleCabinetRecognition}>屏柜识别</Button>
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
          </div>
        </main>

        <div className="screen-verify-resizer" onMouseDown={onRightResizeStart} />

        <aside className="screen-verify-right" style={{ width: rightWidth }}>
          <div className="screen-verify-check">
            <Checkbox>点位核查完成</Checkbox>
          </div>
          <Table<CabinetPointRow>
            className="screen-verify-table"
            columns={columns}
            dataSource={selectedTableRows}
            size="small"
            tableLayout="fixed"
            pagination={false}
            onRow={(record) => ({
              onClick: () => handleSelectTableRow(record),
            })}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }}
          />
        </aside>
      </div>

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

      <SinglePointModal
        open={singlePointModalOpen}
        initialValues={singlePointDraft}
        onCancel={handleCancelSinglePoint}
        onSubmit={handleSubmitSinglePoint}
      />
    </div>
  );
}

function isPendingManualRect(rect: ImageRect): boolean {
  return (!rect.source || rect.source === "manual")
    && !rect.saved
    && rect.generationStatus !== "generated"
    && rect.generationStatus !== "saved";
}

function retainPendingManualAnnotations(annotations: ComponentAnnotations): ComponentAnnotations {
  return {
    standardPartRects: annotations.standardPartRects.filter(isPendingManualRect),
    deviceLabelRects: annotations.deviceLabelRects.filter(isPendingManualRect),
    deviceBoxRects: annotations.deviceBoxRects.filter(isPendingManualRect),
    appearanceRects: annotations.appearanceRects.filter(isPendingManualRect),
  };
}

function mapAnnotationRects(
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

function getAnnotationCount(annotations: ComponentAnnotations): number {
  return annotations.standardPartRects.length
    + annotations.deviceLabelRects.length
    + annotations.deviceBoxRects.length
    + annotations.appearanceRects.length;
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
  const count = labels.length;
  const targetX = source.targetX ?? 0;
  const targetY = source.targetY ?? 0;
  const targetW = source.targetW ?? 0;
  const targetH = source.targetH ?? 0;
  const segmentW = targetW / count;
  const boxW = Math.max(MIN_ANNOTATION_RECT_SIZE, segmentW * 0.72);
  const boxH = Math.max(MIN_ANNOTATION_RECT_SIZE, targetH);

  return labels.map((label, index) => ({
    id: createOcrRectId(label.regionId, index),
    x: targetX + segmentW * index + (segmentW - boxW) / 2,
    y: targetY,
    w: boxW,
    h: boxH,
    text: label.text,
    confidence: label.confidence,
    source: "ocr",
    saved: false,
    generationStatus: "generated",
    groupId: source.groupId,
    generatedFromRectId: source.sourceRectId,
  }));
}

function createOcrRectId(regionId: string, index: number): string {
  return `ocr:${regionId}:${Date.now()}:${index}:${Math.random().toString(16).slice(2)}`;
}

function createSinglePointId(): string {
  return `single-point:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

async function buildDeviceLabelOcrSources(
  imageDataUrl: string,
  rects: ImageRect[],
  groupByRectId?: Map<string, string>,
): Promise<CabinetOcrSource[]> {
  const validRects = rects.filter((rect) => rect.w >= MIN_ANNOTATION_RECT_SIZE && rect.h >= MIN_ANNOTATION_RECT_SIZE);
  return Promise.all(validRects.map(async (rect, index) => {
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
      groupId: groupByRectId?.get(rect.id),
    };
  }));
}
