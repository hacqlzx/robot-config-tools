import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Modal } from "antd";
import { CloudOutlined } from "@ant-design/icons";
import { createLocalExportTask } from "@/components/download-task/task-actions";
import { useResizable } from "@/components/useResizable";
import { useSelectedProject } from "@/stores/appContextStore";
import { parsePointExcel } from "@/utils/excel-parser";
import ExportModal from "../components/ExportModal";
import CabinetPanel, { type CabinetSaveData } from "../components/CabinetPanel";
import ChargingAreaPanel from "../components/ChargingAreaPanel";
import DeviceAreaPanel from "../components/DeviceAreaPanel";
import LoadModelModal from "../components/LoadModelModal";
import SaveStatusBadge from "../components/SaveStatusBadge";
import SidePanel from "../components/SidePanel";
import SpaceEditLayout from "../components/SpaceEditLayout";
import Toolbar from "../components/Toolbar";
import ViewCube from "../components/ViewCube";
import type { SaveStatus, SpaceTreeNode, ViewDirection } from "../types";
import { useElementActive } from "@/components/useElementActive";
import {
  deleteCabinetItem,
  deleteDrawingTypeFromJson,
  DRAWING_FILE_NAME,
  NORMAL_ANNOTATIONS_FILE_NAME,
  INSPECTION_POINTS_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  loadAllItemsFromJsonInLasCoordinates,
  loadDrawingItemsByTypeInLasCoordinates,
  loadPathDrawingInLasCoordinates,
  loadNormalAnnotations,
  loadInspectionPoints,
  getBoundBayIdsInProject,
  loadCabinetNameSequence,
  saveCabinetDrawingInLasCoordinates,
  saveChargingAreaInLasCoordinates,
  saveDeviceAreasInLasCoordinates,
  savePathDrawingInLasCoordinates,
  saveNormalAnnotationsInLasCoordinates,
  saveInspectionPointsInLasCoordinates,
  type CabinetItem,
  type ChargingAreaItem,
  type DeviceAreaItem,
  type NormalAnnotationItem,
  type InspectionPointItem,
  type PathData,
} from "../hooks/drawing/drawing-storage";
import {
  PATH_CHARGING_AREA_REQUIRED_MESSAGE,
  isPathStartInChargingArea,
  orderedPathPoints,
  PATH_START_CHARGING_AREA_MESSAGE,
} from "../hooks/drawing/path-codec";
import {
  MAP_DIR_NAME,
  POINT_TABLE_DIR_NAME,
  POINT_TABLE_FILE_RE,
  isZipFileName,
  loadedFileKey,
  mapSiblingFilePath,
  pointTableFileSubPath,
  stripModelExtension,
} from "../utils/space-paths";
import ModelLoadingOverlay from "./components/ModelLoadingOverlay";
import PotreeClipController from "./components/PotreeClipController";
import PotreeRenderSettings from "./components/PotreeRenderSettings";
import NormalAnnotationPanel from "./components/NormalAnnotationPanel";
import InspectionPointPanel from "./components/InspectionPointPanel";
import MapCoordinateCorrectionPanel from "./components/MapCoordinateCorrectionPanel";
import SpaceSceneHost from "./components/SpaceSceneHost";
import SpaceShortcutHelp from "./components/SpaceShortcutHelp";
import { PotreeSpaceSceneAdapter } from "./engine/PotreeSpaceSceneAdapter";
import {
  useSpaceDrawingHistory,
  type SpaceDrawingHistoryCheckpoint,
} from "./hooks/useSpaceDrawingHistory";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  type SpaceCabinetState,
  type SpaceChargingAreaState,
  type SpaceClipBounds,
  type SpaceDeviceAreaBox,
  type SpaceDeviceAreaState,
  type SpaceDrawingHistoryScope,
  type SpaceDrawingLayer,
  type SpaceDrawingSelection,
  type SpacePathState,
  type SpaceNormalAnnotationState,
  type SpaceInspectionPointState,
  type SpaceRenderSettings,
} from "./engine/types";

const DEFAULT_CHARGING_STATE: SpaceChargingAreaState = {
  pointCount: 0,
  height: 1,
  hasBox: false,
  selected: false,
  canUndo: false,
  canRedo: false,
};

const DEFAULT_DEVICE_AREA_STATE: SpaceDeviceAreaState = {
  pointCount: 0,
  boxCount: 0,
  height: 2,
  selectedBoxId: null,
  selectedBoxBay: null,
  boundBayIds: [],
  hasDraft: false,
  canUndo: false,
  canRedo: false,
};

const DEFAULT_CABINET_STATE: SpaceCabinetState = {
  cornerCount: 0,
  cabinetCount: 0,
  hasDraft: false,
  canUndo: false,
  canRedo: false,
};

const DEFAULT_PATH_STATE: SpacePathState = {
  pointCount: 0,
  connectionCount: 0,
  active: false,
  selectedPointId: null,
  selectedPathId: null,
};

const DEFAULT_NORMAL_ANNOTATION_STATE: SpaceNormalAnnotationState = {
  count: 0,
  selectedId: null,
  active: false,
};

const DEFAULT_INSPECTION_POINT_STATE: SpaceInspectionPointState = {
  count: 0,
  selectedId: null,
  active: false,
};

interface LoadingState {
  kind: "model" | "correction";
  modelPath: string | null;
  title: string;
  message: string;
  percent?: number;
}

interface MapModelItem {
  mapName: string;
  modelPath: string;
}

interface SpaceFileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: SpaceFileNode[];
}

interface ChargingAreaSession {
  filePath: string;
  sourceData: SpaceDrawingLayer;
  wasVisible: boolean;
}

interface DeviceAreaSession {
  filePath: string;
  sourceData: SpaceDrawingLayer;
  wasVisible: boolean;
}

interface CabinetSession {
  filePath: string;
  sourceData: SpaceDrawingLayer;
  wasVisible: boolean;
}

interface PathSession {
  filePath: string;
}

interface InspectionPointEditSession {
  items: InspectionPointItem[];
  historyCheckpoint: SpaceDrawingHistoryCheckpoint;
  wasDirty: boolean;
  dirtyVersion: number;
}

interface PersistOptions {
  silent?: boolean;
  closeAfterSave?: boolean;
  markFileShown?: boolean;
  clearHistory?: boolean;
  dirtyVersion?: number;
}

interface SaveAllOptions extends PersistOptions {
  includeCabinet?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizePointCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function mapNameFromModelPath(modelPath: string): string {
  const parts = modelPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : stripModelExtension(parts.at(-1) || "地图模型");
}

function mapDirSubPathFromModelPath(modelPath: string): string {
  const parts = modelPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const index = parts.lastIndexOf(MAP_DIR_NAME);
  return index >= 0 && index + 1 < parts.length ? `${MAP_DIR_NAME}/${parts[index + 1]}` : "";
}

function findFilesByName(nodes: SpaceFileNode[], names: readonly string[]): string[] {
  const wanted = new Set(names);
  const files: string[] = [];
  const walk = (items: SpaceFileNode[]) => {
    items.forEach((item) => {
      if (item.isDir) {
        if (item.children) walk(item.children);
      } else if (wanted.has(item.name)) {
        files.push(item.path);
      }
    });
  };
  walk(nodes);
  return files;
}

function confirmReplaceModel(plan: { mapCode: string; mapName: string; existingMapName?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: "替换已有地图",
      content: `检测到地图编码 ${plan.mapCode || "未填写"} 已存在，将全量替换地图“${plan.existingMapName || plan.mapName}”。是否继续？`,
      okText: "替换",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function confirmReplaceChargingArea(): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: "确认",
      content: "绘制新的充电区域将删除原有的充电区域，是否继续？",
      okText: "确认删除",
      cancelText: "取消",
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function sameFilePath(left: string, right: string): boolean {
  return loadedFileKey(left) === loadedFileKey(right);
}

type DrawingSubType = "cabinet" | "charging" | "device";

const DRAWING_SUB_TYPES: DrawingSubType[] = ["cabinet", "charging", "device"];

function parseDrawingLayerPath(layerId: string): { filePath: string; type: DrawingSubType } | null {
  const match = layerId.match(/^(.+)#(cabinet|charging|device)$/);
  return match ? { filePath: match[1], type: match[2] as DrawingSubType } : null;
}

function drawingFilePathFromLayerId(layerId: string): string {
  return parseDrawingLayerPath(layerId)?.filePath ?? layerId;
}

function drawingLayerId(filePath: string, type: DrawingSubType): string {
  return `${drawingFilePathFromLayerId(filePath)}#${type}`;
}

function sameDrawingFilePath(left: string, right: string): boolean {
  return sameFilePath(drawingFilePathFromLayerId(left), drawingFilePathFromLayerId(right));
}

function drawingItemType(item: NonNullable<SpaceDrawingLayer["areas"]>[number]): DrawingSubType | null {
  if (item.type === "cabinet") return "cabinet";
  if (item.type === "charging-area") return "charging";
  if (item.type === "device-area") return "device";
  return null;
}

export default function SpaceEditWorkspace() {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const adapter = useMemo(() => new PotreeSpaceSceneAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageActive = useElementActive(containerRef);
  const operationVersion = useRef(0);
  const modelBusyRef = useRef(false);
  const [modelOperationBusy, setModelOperationBusy] = useState(false);
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null);
  const [activeSourcePath, setActiveSourcePath] = useState<string | null>(null);
  const [hideDraftBounds, setHideDraftBounds] = useState<SpaceClipBounds | null>(null);
  const [hiddenModelBounds, setHiddenModelBounds] = useState<SpaceClipBounds | null>(null);
  const hideDraftBoundsRef = useRef<SpaceClipBounds | null>(null);
  const hiddenModelBoundsRef = useRef<SpaceClipBounds | null>(null);
  hideDraftBoundsRef.current = hideDraftBounds;
  hiddenModelBoundsRef.current = hiddenModelBounds;
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionOrigin, setCorrectionOrigin] = useState<[number, number, number] | null>(null);
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionProgress, setCorrectionProgress] = useState<number | undefined>();
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const [pointImporting, setPointImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderSettings, setRenderSettings] = useState<SpaceRenderSettings>(
    () => ({ ...DEFAULT_SPACE_RENDER_SETTINGS }),
  );
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const [drawingAvailableTypes, setDrawingAvailableTypes] = useState<Map<string, Set<"cabinet" | "charging" | "device">>>(new Map());
  const drawingShownRef = useRef(drawingShown);
  drawingShownRef.current = drawingShown;
  const [pathShown, setPathShown] = useState<Set<string>>(new Set());
  const [cabinetMode, setCabinetMode] = useState(false);
  const [cabinetState, setCabinetState] = useState<SpaceCabinetState>(DEFAULT_CABINET_STATE);
  const [cabinetSaving, setCabinetSaving] = useState(false);
  const [cabinetNameSequence, setCabinetNameSequence] = useState({ cabinetRowStart: 1, cabinetStart: 1 });
  const [existingCabinetNames, setExistingCabinetNames] = useState<string[]>([]);
  const [chargingMode, setChargingMode] = useState(false);
  const [chargingState, setChargingState] = useState<SpaceChargingAreaState>(DEFAULT_CHARGING_STATE);
  const [chargingSaving, setChargingSaving] = useState(false);
  const [deviceAreaMode, setDeviceAreaMode] = useState(false);
  const [deviceAreaState, setDeviceAreaState] = useState<SpaceDeviceAreaState>(DEFAULT_DEVICE_AREA_STATE);
  const [deviceAreaSaving, setDeviceAreaSaving] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathState, setPathState] = useState<SpacePathState>(DEFAULT_PATH_STATE);
  const [, setPathSaving] = useState(false);
  const [normalMode, setNormalMode] = useState(false);
  const [normalItems, setNormalItems] = useState<NormalAnnotationItem[]>([]);
  const [normalState, setNormalState] = useState<SpaceNormalAnnotationState>(DEFAULT_NORMAL_ANNOTATION_STATE);
  const [normalSaving, setNormalSaving] = useState(false);
  const [normalExporting, setNormalExporting] = useState(false);
  const [inspectionExporting, setInspectionExporting] = useState(false);
  const [inspectionMode, setInspectionMode] = useState(false);
  const [inspectionItems, setInspectionItems] = useState<InspectionPointItem[]>([]);
  const [shownInspectionPointIds, setShownInspectionPointIds] = useState<Set<string>>(new Set());
  const [inspectionState, setInspectionState] = useState<SpaceInspectionPointState>(DEFAULT_INSPECTION_POINT_STATE);
  const [inspectionBayFilter, setInspectionBayFilter] = useState<string | undefined>(undefined);
  const [inspectionSaving, setInspectionSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [projectBoundBayIds, setProjectBoundBayIds] = useState<Set<number>>(new Set());
  const drawingLifecycleVersion = useRef(0);
  const drawingLayerVersions = useRef(new Map<string, number>());
  const drawingTypeScanVersions = useRef(new Map<string, number>());
  const drawingLayerData = useRef(new Map<string, SpaceDrawingLayer>());
  const cabinetSession = useRef<CabinetSession | null>(null);
  const cabinetSavingRef = useRef(false);
  const cabinetDraftRef = useRef<CabinetSaveData | null>(null);
  const chargingSession = useRef<ChargingAreaSession | null>(null);
  const chargingSavingRef = useRef(false);
  const chargingDeleteHandler = useRef<() => void>(() => undefined);
  const deviceAreaSession = useRef<DeviceAreaSession | null>(null);
  const deviceAreaSavingRef = useRef(false);
  const deviceAreaDeleteHandler = useRef<() => void>(() => undefined);
  const pathSession = useRef<PathSession | null>(null);
  const pathSavingRef = useRef(false);
  const normalSavingRef = useRef(false);
  const inspectionSavingRef = useRef(false);
  const inspectionEditSessionRef = useRef<InspectionPointEditSession | null>(null);
  const dirtyScopesRef = useRef<Set<SpaceDrawingHistoryScope>>(new Set());
  const dirtyScopeVersionsRef = useRef<Map<SpaceDrawingHistoryScope, number>>(new Map());
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveInFlightRef = useRef(false);
  const saveOperationInFlightRef = useRef(false);
  const saveAllRef = useRef<(options?: SaveAllOptions) => Promise<boolean>>(async () => false);
  const discardUnsavedChangesRef = useRef<() => void>(() => undefined);
  const { width: panelWidth, resizing, onMouseDown: onResizeStart } = useResizable({
    containerRef,
    minWidth: 220,
    maxWidth: 520,
    initialWidth: 260,
    maxPercent: 0.45,
  });

  const markDirty = useCallback((scope: SpaceDrawingHistoryScope) => {
    dirtyScopeVersionsRef.current.set(scope, (dirtyScopeVersionsRef.current.get(scope) ?? 0) + 1);
    dirtyScopesRef.current.add(scope);
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
    setSaveStatus((current) => current === "saving" ? current : "dirty");
  }, []);

  const drawingHistory = useSpaceDrawingHistory({
    adapter,
    onRestore: markDirty,
  });

  const recordDrawingHistory = useCallback((
    scope: SpaceDrawingHistoryScope,
    before: unknown,
    after: unknown,
    label: string,
  ) => {
    if (drawingHistory.record(scope, before, after, label)) {
      markDirty(scope);
    }
  }, [drawingHistory.record, markDirty]);

  useEffect(() => {
    adapter.setInspectionPointCallbacks({
      onChange: (state) => {
        setInspectionState(state);
        setInspectionItems(adapter.getInspectionPoints());
        if (state.selectedId) {
          setShownInspectionPointIds((current) => {
            if (current.has(state.selectedId!)) return current;
            return new Set([...current, state.selectedId!]);
          });
        }
      },
      onHistory: (before, after, label) => recordDrawingHistory("inspection-point", before, after, label),
      onAddBlocked: () => message.info({
        key: "inspection-point-pending-new",
        content: "请先保存当前新增的巡检点，再继续新增",
      }),
    });
    return () => adapter.setInspectionPointCallbacks(null);
  }, [adapter, message, recordDrawingHistory]);

  const showSavedStatus = useCallback(() => {
    if (dirtyScopesRef.current.size > 0) {
      setSaveStatus("dirty");
      return;
    }
    setSaveStatus("saved");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => {
      setSaveStatus(dirtyScopesRef.current.size > 0 ? "dirty" : "idle");
      saveStatusTimerRef.current = null;
    }, 2000);
  }, []);

  const showSavingStatus = useCallback(() => {
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
    setSaveStatus("saving");
  }, []);

  const clearDirtyScope = useCallback((scope: SpaceDrawingHistoryScope, savedVersion: number): boolean => {
    if ((dirtyScopeVersionsRef.current.get(scope) ?? 0) !== savedVersion) return false;
    dirtyScopesRef.current.delete(scope);
    return true;
  }, []);

  const showSaveFailedStatus = useCallback(() => {
    if (saveStatusTimerRef.current) {
      clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
    setSaveStatus(dirtyScopesRef.current.size > 0 ? "failed" : "idle");
  }, []);

  const runSaveOperation = useCallback(async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (saveOperationInFlightRef.current) return false;
    saveOperationInFlightRef.current = true;
    showSavingStatus();
    try {
      const saved = await operation();
      if (saved) showSavedStatus();
      else showSaveFailedStatus();
      return saved;
    } catch (error) {
      showSaveFailedStatus();
      message.error(`保存失败: ${errorMessage(error)}`);
      return false;
    } finally {
      saveOperationInFlightRef.current = false;
    }
  }, [message, showSaveFailedStatus, showSavedStatus, showSavingStatus]);

  const dirtyScopeText = useCallback(() => {
    const labels: Record<SpaceDrawingHistoryScope, string> = {
      cabinet: "屏柜",
      charging: "充电区域",
      "device-area": "设备区域",
      path: "可行路径",
      normal: "法线标注",
      "inspection-point": "巡检点",
    };
    return [...dirtyScopesRef.current].map((scope) => labels[scope]).join("、") || "空间编辑";
  }, []);

  const confirmUnsavedChanges = useCallback((actionText: string): Promise<boolean> => {
    if (dirtyScopesRef.current.size === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      let modalRef: ReturnType<typeof Modal.confirm> | null = null;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const discard = () => {
        discardUnsavedChangesRef.current();
        modalRef?.destroy();
        settle(true);
      };

      modalRef = Modal.confirm({
        title: "存在未保存编辑",
        content: (
          <div style={{ display: "grid", gap: 10 }}>
            <div>{dirtyScopeText()} 有未保存修改，是否先保存再{actionText}？</div>
            <Button size="small" danger onClick={discard} style={{ justifySelf: "start" }}>
              放弃修改并{actionText}
            </Button>
          </div>
        ),
        okText: "保存并继续",
        cancelText: "取消",
        onOk: async () => {
          const saved = await runSaveOperation(() => saveAllRef.current({
            silent: false,
            closeAfterSave: true,
            markFileShown: true,
            includeCabinet: true,
          }));
          if (saved) {
            settle(true);
            return;
          }
          return Promise.reject(new Error("保存未完成"));
        },
        onCancel: () => settle(false),
      });
    });
  }, [dirtyScopeText, runSaveOperation]);

  const startAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    if (!selectedProject || !activeSourcePath) return;
    autoSaveTimerRef.current = setInterval(() => {
      const hasAutoSavableChanges = [...dirtyScopesRef.current].some((scope) => scope !== "cabinet");
      if (autoSaveInFlightRef.current || !hasAutoSavableChanges) return;
      autoSaveInFlightRef.current = true;
      void runSaveOperation(() => saveAllRef.current({
        silent: true,
        closeAfterSave: false,
        markFileShown: false,
        clearHistory: false,
        includeCabinet: false,
      })).finally(() => {
        autoSaveInFlightRef.current = false;
      });
    }, 30_000);
  }, [activeSourcePath, runSaveOperation, selectedProject]);

  const loadedFiles = useMemo(
    () => new Set(activeModelPath ? [loadedFileKey(activeModelPath)] : []),
    [activeModelPath],
  );

  const cancelHideDraft = useCallback(() => {
    if (!hideDraftBoundsRef.current) return;
    const committed = hiddenModelBoundsRef.current;
    if (committed) {
      adapter.setClipBounds(committed);
      adapter.commitClipping();
    } else {
      adapter.stopClipping();
    }
    setHideDraftBounds(null);
  }, [adapter]);

  const clearHideState = useCallback(() => {
    adapter.stopClipping();
    setHideDraftBounds(null);
    setHiddenModelBounds(null);
  }, [adapter]);

  const clearDrawingVisibility = useCallback(() => {
    drawingLifecycleVersion.current += 1;
    drawingLayerVersions.current.clear();
    drawingTypeScanVersions.current.clear();
    drawingLayerData.current.clear();
    cabinetSession.current = null;
    cabinetSavingRef.current = false;
    cabinetDraftRef.current = null;
    chargingSession.current = null;
    chargingSavingRef.current = false;
    deviceAreaSession.current = null;
    deviceAreaSavingRef.current = false;
    pathSession.current = null;
    pathSavingRef.current = false;
    normalSavingRef.current = false;
    inspectionSavingRef.current = false;
    inspectionEditSessionRef.current = null;
    dirtyScopesRef.current.clear();
    dirtyScopeVersionsRef.current.clear();
    setSaveStatus("idle");
    drawingHistory.clear();
    adapter.clearCabinetDrawing();
    adapter.clearChargingAreaDrawing();
    adapter.clearDeviceAreaDrawing();
    adapter.clearPathDrawing();
    adapter.clearNormalAnnotations();
    adapter.clearInspectionPoints();
    adapter.clearDrawingLayers();
    adapter.setCoordinateCorrectionMarker(null);
    setCabinetMode(false);
    setCabinetState(DEFAULT_CABINET_STATE);
    setCabinetSaving(false);
    setCabinetNameSequence({ cabinetRowStart: 1, cabinetStart: 1 });
    setChargingMode(false);
    setChargingState(DEFAULT_CHARGING_STATE);
    setChargingSaving(false);
    setDeviceAreaMode(false);
    setDeviceAreaState(DEFAULT_DEVICE_AREA_STATE);
    setDeviceAreaSaving(false);
    setPathMode(false);
    setPathState(DEFAULT_PATH_STATE);
    setPathSaving(false);
    setCorrectionMode(false);
    setCorrectionOrigin(null);
    setCorrectionSaving(false);
    setCorrectionProgress(undefined);
    setNormalMode(false);
    setNormalItems([]);
    setNormalState(DEFAULT_NORMAL_ANNOTATION_STATE);
    setNormalSaving(false);
    setInspectionMode(false);
    setInspectionItems([]);
    setShownInspectionPointIds(new Set());
    setInspectionState(DEFAULT_INSPECTION_POINT_STATE);
    setInspectionSaving(false);
    setProjectBoundBayIds(new Set());
    drawingShownRef.current = new Set();
    setDrawingShown(new Set());
    setPathShown(new Set());
  }, [adapter, drawingHistory.clear]);
  discardUnsavedChangesRef.current = clearDrawingVisibility;

  const clearLoadedModelState = useCallback(() => {
    operationVersion.current += 1;
    modelBusyRef.current = false;
    setModelOperationBusy(false);
    adapter.clearModel();
    setActiveModelPath(null);
    setActiveSourcePath(null);
    setHideDraftBounds(null);
    setHiddenModelBounds(null);
    setCorrectionMode(false);
    setCorrectionOrigin(null);
    setCorrectionSaving(false);
    setCorrectionProgress(undefined);
    setLoading(null);
    clearDrawingVisibility();
  }, [adapter, clearDrawingVisibility]);

  const updateLayerVisibility = useCallback((kind: "drawing" | "path", filePath: string, visible: boolean) => {
    const setter = kind === "drawing" ? setDrawingShown : setPathShown;
    setter((current) => {
      const next = new Set(current);
      if (visible) next.add(filePath);
      else next.delete(filePath);
      if (kind === "drawing") drawingShownRef.current = next;
      return next;
    });
  }, []);

  const nextLayerVersion = useCallback((kind: "drawing" | "path", filePath: string): number => {
    const key = `${kind}:${loadedFileKey(filePath)}`;
    const next = (drawingLayerVersions.current.get(key) ?? 0) + 1;
    drawingLayerVersions.current.set(key, next);
    return next;
  }, []);

  const renderDrawingLayer = useCallback((filePath: string, data: SpaceDrawingLayer) => {
    const editingTypes = new Set<string>();
    const charging = chargingSession.current;
    const deviceArea = deviceAreaSession.current;
    if (charging && sameDrawingFilePath(charging.filePath, filePath)) {
      editingTypes.add("charging-area");
    }
    if (deviceArea && sameDrawingFilePath(deviceArea.filePath, filePath)) {
      editingTypes.add("device-area");
    }
    const areas = (data.areas ?? []).filter((item) => !editingTypes.has(item.type));
    adapter.setDrawingLayer(filePath, { ...data, areas });
  }, [adapter]);

  const syncDrawingFileLayers = useCallback((
    filePath: string,
    items: NonNullable<SpaceDrawingLayer["areas"]>,
    forceVisibleTypes: DrawingSubType[] = [],
  ) => {
    const actualFilePath = drawingFilePathFromLayerId(filePath);
    const actualKey = loadedFileKey(actualFilePath);
    drawingTypeScanVersions.current.set(actualKey, (drawingTypeScanVersions.current.get(actualKey) ?? 0) + 1);

    const itemsByType = new Map<DrawingSubType, NonNullable<SpaceDrawingLayer["areas"]>>(
      DRAWING_SUB_TYPES.map((type) => [type, []]),
    );
    items.forEach((item) => {
      const type = drawingItemType(item);
      if (type) itemsByType.get(type)?.push(item);
    });
    const availableTypes = new Set(
      DRAWING_SUB_TYPES.filter((type) => (itemsByType.get(type)?.length ?? 0) > 0),
    );
    setDrawingAvailableTypes((current) => {
      const next = new Map(current);
      for (const existingPath of next.keys()) {
        if (sameFilePath(existingPath, actualFilePath)) next.delete(existingPath);
      }
      next.set(actualFilePath, availableTypes);
      return next;
    });

    const previousShown = drawingShownRef.current;
    const visibleTypes = new Set(forceVisibleTypes);
    let legacyLayerWasVisible = false;
    previousShown.forEach((layerId) => {
      if (!sameDrawingFilePath(layerId, actualFilePath)) return;
      const parsed = parseDrawingLayerPath(layerId);
      if (parsed) visibleTypes.add(parsed.type);
      else legacyLayerWasVisible = true;
    });
    if (legacyLayerWasVisible) availableTypes.forEach((type) => visibleTypes.add(type));

    const nextShown = new Set(previousShown);
    [...nextShown].forEach((layerId) => {
      if (sameDrawingFilePath(layerId, actualFilePath)) nextShown.delete(layerId);
    });
    adapter.removeDrawingLayer(actualFilePath);
    DRAWING_SUB_TYPES.forEach((type) => adapter.removeDrawingLayer(drawingLayerId(actualFilePath, type)));
    for (const cachedLayerId of [...drawingLayerData.current.keys()]) {
      if (sameDrawingFilePath(cachedLayerId, actualFilePath)) drawingLayerData.current.delete(cachedLayerId);
    }

    availableTypes.forEach((type) => {
      const layerId = drawingLayerId(actualFilePath, type);
      const data: SpaceDrawingLayer = { areas: itemsByType.get(type) ?? [] };
      drawingLayerData.current.set(layerId, data);
      if (!visibleTypes.has(type)) return;
      renderDrawingLayer(layerId, data);
      nextShown.add(layerId);
    });
    drawingShownRef.current = nextShown;
    setDrawingShown(nextShown);
  }, [adapter, renderDrawingLayer]);

  // 预扫描区域文件，检测其包含的类型（不加载渲染）
  const scanDrawingFileTypes = useCallback(async (filePath: string) => {
    const api = window.electronAPI;
    if (!api) return;
    const actualFilePath = drawingFilePathFromLayerId(filePath);
    const scanKey = loadedFileKey(actualFilePath);
    const lifecycleVersion = drawingLifecycleVersion.current;
    const scanVersion = (drawingTypeScanVersions.current.get(scanKey) ?? 0) + 1;
    drawingTypeScanVersions.current.set(scanKey, scanVersion);
    
    try {
      // 加载完整数据仅用于类型检测
      const items = await loadAllItemsFromJsonInLasCoordinates(api, actualFilePath);
      if (lifecycleVersion !== drawingLifecycleVersion.current
        || drawingTypeScanVersions.current.get(scanKey) !== scanVersion) return;
      
      const availableTypes = new Set<"cabinet" | "charging" | "device">();
      if (items.some(item => item.type === "cabinet")) availableTypes.add("cabinet");
      if (items.some(item => item.type === "charging-area")) availableTypes.add("charging");
      if (items.some(item => item.type === "device-area")) availableTypes.add("device");
      
      setDrawingAvailableTypes(prev => new Map(prev).set(actualFilePath, availableTypes));
      console.log(`[区域扫描] ${actualFilePath} 包含类型:`, Array.from(availableTypes));
    } catch (error) {
      if (lifecycleVersion !== drawingLifecycleVersion.current
        || drawingTypeScanVersions.current.get(scanKey) !== scanVersion) return;
      console.warn(`[区域扫描] 无法读取文件 ${actualFilePath}`, error);
      // 扫描失败时设置为空集合
      setDrawingAvailableTypes(prev => new Map(prev).set(actualFilePath, new Set()));
    }
  }, []);

  // 地图树加载完成后，扫描所有区域文件
  const handleMapTreeLoaded = useCallback((nodes: SpaceTreeNode[]) => {
    const findDrawingFiles = (list: SpaceTreeNode[]): string[] => {
      const result: string[] = [];
      for (const node of list) {
        if (!node.isDir && node.name === DRAWING_FILE_NAME) {
          result.push(node.path);
        }
        if (node.isDir && node.children) {
          result.push(...findDrawingFiles(node.children));
        }
      }
      return result;
    };
    
    const drawingFiles = findDrawingFiles(nodes);
    console.log(`[地图树加载] 发现 ${drawingFiles.length} 个区域文件，开始扫描`);
    
    // 并发扫描所有区域文件
    drawingFiles.forEach(filePath => {
      scanDrawingFileTypes(filePath);
    });
  }, [scanDrawingFileTypes]);


  const handleToggleDrawing = useCallback(async (virtualPath: string, checked: boolean) => {
    const parsedLayer = parseDrawingLayerPath(virtualPath);
    const filePath = parsedLayer?.filePath ?? virtualPath;
    const filterType = parsedLayer?.type ?? null;
    
    const layerVersion = nextLayerVersion("drawing", virtualPath);
    const lifecycleVersion = drawingLifecycleVersion.current;
    if (!checked) {
      if (parsedLayer) {
        adapter.removeDrawingLayer(virtualPath);
        for (const cachedPath of [...drawingLayerData.current.keys()]) {
          if (sameFilePath(cachedPath, virtualPath)) drawingLayerData.current.delete(cachedPath);
        }
        updateLayerVisibility("drawing", virtualPath, false);
      } else {
        adapter.removeDrawingLayer(filePath);
        DRAWING_SUB_TYPES.forEach((type) => {
          const layerId = drawingLayerId(filePath, type);
          nextLayerVersion("drawing", layerId);
          adapter.removeDrawingLayer(layerId);
        });
        for (const cachedPath of [...drawingLayerData.current.keys()]) {
          if (sameDrawingFilePath(cachedPath, filePath)) drawingLayerData.current.delete(cachedPath);
        }
        setDrawingShown((current) => {
          const next = new Set(
            [...current].filter((layerId) => !sameDrawingFilePath(layerId, filePath)),
          );
          drawingShownRef.current = next;
          return next;
        });
      }
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    
    // 如果有类型过滤，使用按类型加载函数
    const items = filterType 
      ? await loadDrawingItemsByTypeInLasCoordinates(api, filePath, filterType)
      : await loadAllItemsFromJsonInLasCoordinates(api, filePath);

    if (lifecycleVersion !== drawingLifecycleVersion.current
      || layerVersion !== drawingLayerVersions.current.get(`drawing:${loadedFileKey(virtualPath)}`)) return;

    if (filterType && items.length === 0) {
      adapter.removeDrawingLayer(virtualPath);
      drawingLayerData.current.delete(virtualPath);
      updateLayerVisibility("drawing", virtualPath, false);
      return;
    }
    
    // 检测并记录该 JSON 文件包含哪些类型（仅在首次加载完整数据时）
    if (!filterType) {
      const availableTypes = new Set<"cabinet" | "charging" | "device">();
      if (items.some(item => item.type === "cabinet")) availableTypes.add("cabinet");
      if (items.some(item => item.type === "charging-area")) availableTypes.add("charging");
      if (items.some(item => item.type === "device-area")) availableTypes.add("device");
      setDrawingAvailableTypes(prev => new Map(prev).set(filePath, availableTypes));
      
      // 检测完类型后，如果是勾选操作且有可用类型，自动加载各个类型
      if (checked && availableTypes.size > 0) {
        // 不渲染完整数据，而是触发各个子类型的加载
        console.log(`[绘制加载] 检测到 ${availableTypes.size} 种区域类型，准备分类加载`);
        // 异步加载各个子类型（不阻塞当前函数）
        availableTypes.forEach(type => {
          handleToggleDrawing(`${filePath}#${type}`, true);
        });
        return;
      }
      
      // 如果没有任何类型或是取消勾选，继续原有逻辑（不做任何操作）
      if (availableTypes.size === 0) {
        console.log(`[绘制加载] 区域文件为空，不显示`);
        return;
      }
    }
    
    const data: SpaceDrawingLayer = { areas: items };
    drawingLayerData.current.set(virtualPath, data);
    renderDrawingLayer(virtualPath, data);
    updateLayerVisibility("drawing", virtualPath, true);
  }, [adapter, nextLayerVersion, renderDrawingLayer, updateLayerVisibility]);

  const handleTogglePath = useCallback(async (filePath: string, checked: boolean) => {
    const layerVersion = nextLayerVersion("path", filePath);
    const lifecycleVersion = drawingLifecycleVersion.current;
    const fileName = filePath.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
    const isEditableReferencePath = fileName === PATH_FILE_NAME.toLowerCase();
    if (!checked) {
      if (isEditableReferencePath) adapter.setEditablePathData(null);
      else adapter.removeDrawingLayer(filePath);
      updateLayerVisibility("path", filePath, false);
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    const path = await loadPathDrawingInLasCoordinates(api, filePath);
    if (lifecycleVersion !== drawingLifecycleVersion.current
      || layerVersion !== drawingLayerVersions.current.get(`path:${loadedFileKey(filePath)}`)) return;
    if (isEditableReferencePath) adapter.setEditablePathData(path);
    else adapter.setDrawingLayer(filePath, { path });
    updateLayerVisibility("path", filePath, true);
  }, [adapter, nextLayerVersion, updateLayerVisibility]);

  const loadModelCompanionFiles = useCallback(async (modelPath: string, loadAllContents: boolean) => {
    if (!selectedProject || !window.electronAPI?.project) return;
    const subDir = mapDirSubPathFromModelPath(modelPath);
    if (!subDir) return;
    try {
      const tree = await window.electronAPI.project.listTree(selectedProject, subDir) as SpaceFileNode[];
      const drawingFile = findFilesByName(tree, [DRAWING_FILE_NAME])[0];
      if (loadAllContents && drawingFile) await handleToggleDrawing(drawingFile, true);
      const normalFile = findFilesByName(tree, [NORMAL_ANNOTATIONS_FILE_NAME])[0];
      const normalItems = normalFile ? await loadNormalAnnotations(window.electronAPI, normalFile) : [];
      adapter.setNormalAnnotations(normalItems);
      setNormalItems(normalItems);
      setNormalState({ ...DEFAULT_NORMAL_ANNOTATION_STATE, count: normalItems.length });
      const inspectionFile = findFilesByName(tree, [INSPECTION_POINTS_FILE_NAME])[0];
      const inspectionItems = inspectionFile ? await loadInspectionPoints(window.electronAPI, modelPath) : [];
      adapter.setVisibleInspectionPointIds([]);
      adapter.setInspectionPoints(inspectionItems);
      setInspectionItems(inspectionItems);
      setShownInspectionPointIds(loadAllContents
        ? new Set(inspectionItems.map((item) => item.id))
        : new Set());
      setInspectionState({ ...DEFAULT_INSPECTION_POINT_STATE, count: inspectionItems.length });
      const pathFiles = findFilesByName(tree, [PATH_FILE_NAME, ROBOT_PATH_FILE_NAME])
        .sort((left, right) => left.localeCompare(right));
      if (loadAllContents) {
        for (const pathFile of pathFiles) await handleTogglePath(pathFile, true);
      }
    } catch (error) {
      console.warn("[space-edit] 自动加载区域/路径失败", { modelPath, error });
    }
  }, [adapter, handleToggleDrawing, handleTogglePath, selectedProject]);

  const closeCabinetMode = useCallback(() => {
    adapter.setCabinetDrawingEnabled(false);
    setCabinetMode(false);
  }, [adapter]);

  const closeChargingMode = useCallback(() => {
    adapter.setChargingAreaDrawingEnabled(false);
    setChargingMode(false);
  }, [adapter]);

  const closeDeviceAreaMode = useCallback(() => {
    adapter.setDeviceAreaDrawingEnabled(false);
    setDeviceAreaMode(false);
  }, [adapter]);

  const closePathMode = useCallback(() => {
    adapter.setPathDrawingActive(false);
    setPathMode(false);
  }, [adapter]);

  const closeNormalMode = useCallback(() => {
    const inspectionSession = inspectionEditSessionRef.current;
    if (inspectionSession) {
      inspectionEditSessionRef.current = null;
      adapter.setInspectionPoints(inspectionSession.items);
      drawingHistory.restoreCheckpoint(inspectionSession.historyCheckpoint);
      if (inspectionSession.wasDirty) {
        dirtyScopesRef.current.add("inspection-point");
        dirtyScopeVersionsRef.current.set("inspection-point", inspectionSession.dirtyVersion);
      } else {
        dirtyScopesRef.current.delete("inspection-point");
        dirtyScopeVersionsRef.current.delete("inspection-point");
      }
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = null;
      }
      setSaveStatus(dirtyScopesRef.current.size > 0 ? "dirty" : "idle");
    }
    adapter.setNormalAnnotationEnabled(false);
    adapter.setInspectionPointEnabled(false);
    adapter.selectInspectionPoint(null);
    setNormalMode(false);
    setInspectionMode(false);
    setNormalState((current) => ({ ...current, active: false }));
    setInspectionState((current) => ({ ...current, selectedId: null, active: false }));
  }, [adapter, drawingHistory.restoreCheckpoint]);

  const closeCorrectionMode = useCallback(() => {
    if (correctionSaving) return;
    adapter.setCoordinateCorrectionMarker(null);
    setCorrectionMode(false);
    setCorrectionOrigin(null);
    setCorrectionProgress(undefined);
  }, [adapter, correctionSaving]);

  const persistNormalAnnotations = useCallback(async (options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const closeAfterSave = options.closeAfterSave !== false;
    const clearHistory = options.clearHistory !== false && closeAfterSave;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("法线标注保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (normalSavingRef.current) return false;

    const version = operationVersion.current;
    const items = adapter.getNormalAnnotations().map((item: NormalAnnotationItem) => ({
      ...item,
      updatedAt: new Date().toISOString(),
    }));
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("normal") ?? 0;
    normalSavingRef.current = true;
    setNormalSaving(true);
    try {
      await saveNormalAnnotationsInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        items,
      });
      if (version !== operationVersion.current) return false;
      if (closeAfterSave) closeNormalMode();
      setNormalState((current) => ({
        ...current,
        count: items.length,
        active: closeAfterSave ? false : current.active,
      }));
      const scopeSaved = clearDirtyScope("normal", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("normal");
      if (!silent) message.success(items.length > 0 ? "法线标注保存成功" : "法线标注已清空");
      return true;
    } catch (error) {
      if (!silent) message.error(`保存法线标注失败: ${errorMessage(error)}`);
      return false;
    } finally {
      normalSavingRef.current = false;
      if (version === operationVersion.current) setNormalSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, closeNormalMode, drawingHistory.clearScope, message, selectedProject]);

  const handleToggleNormal = useCallback(() => {
    if (normalMode) {
      closeNormalMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || normalSavingRef.current) {
      message.warning("模型或法线标注正在处理中，请稍后再试");
      return;
    }
    if (!window.electronAPI) {
      message.warning("法线标注仅支持 Electron 模式");
      return;
    }
    cancelHideDraft();
    closeCabinetMode();
    closeChargingMode();
    closeCorrectionMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    const started = adapter.startNormalAnnotationEditing({
      onChange: (state) => {
        setNormalState(state);
        setNormalItems(adapter.getNormalAnnotations());
      },
      onHistory: (before, after, label) => recordDrawingHistory("normal", before, after, label),
    });
    if (!started) {
      message.error("法线标注编辑器初始化失败");
      return;
    }
    setNormalMode(true);
  }, [activeSourcePath, adapter, cancelHideDraft, closeCabinetMode, closeChargingMode, closeCorrectionMode, closeDeviceAreaMode, closeNormalMode, closePathMode, message, normalMode, recordDrawingHistory]);

  const handleNormalSelect = useCallback((item: NormalAnnotationItem) => {
    const current = adapter.getNormalAnnotations().find((candidate) => candidate.id === item.id) ?? item;
    adapter.selectNormalAnnotation(current.id);
    adapter.focusAlongDirection(
      current.origin[0],
      current.origin[1],
      current.origin[2],
      current.direction[0],
      current.direction[1],
      current.direction[2],
      Math.max(0.5, current.length * 1.5, current.diameter * 1.2),
    );
  }, [adapter]);

  const handleNormalRename = useCallback((normalId: string, name: string) => {
    adapter.renameNormalAnnotation(normalId, name);
  }, [adapter]);

  const handleNormalBindPoint = useCallback((normalId: string, point: { pointCode: string; pointName: string }) => {
    const pointCodeKey = normalizePointCode(point.pointCode);
    const alreadyBound = normalItems.some((item) => item.id !== normalId && normalizePointCode(item.pointCode) === pointCodeKey);
    if (alreadyBound) {
      message.warning("该点位已绑定其他法线");
      return;
    }
    adapter.bindNormalAnnotationPoint(normalId, point);
  }, [adapter, message, normalItems]);

  const handleNormalUnbindPoint = useCallback((normalId: string) => {
    adapter.unbindNormalAnnotationPoint(normalId);
  }, [adapter]);

  const handleNormalDelete = useCallback((normalId: string) => {
    adapter.deleteNormalAnnotation(normalId);
  }, [adapter]);

  const handleNormalExport = useCallback(async (triggerElement?: HTMLElement) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    const unbound = normalItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !normalizePointCode(item.pointCode));
    if (unbound.length > 0) {
      const names = unbound.map(({ item, index }) => item.name?.trim() || `第 ${index + 1} 个法线`);
      message.warning(`请先为以下法线绑定点位：${names.join("、")}`);
      return;
    }

    const boundByCode = new Map<string, number>();
    for (let index = 0; index < normalItems.length; index += 1) {
      const pointCode = normalizePointCode(normalItems[index].pointCode);
      const firstIndex = boundByCode.get(pointCode);
      if (firstIndex !== undefined) {
        message.warning(`点位“${normalItems[index].pointCode}”已绑定多个法线（第 ${firstIndex + 1} 个和第 ${index + 1} 个）`);
        return;
      }
      boundByCode.set(pointCode, index);
    }

    setNormalExporting(true);
    try {
      const result = await createLocalExportTask({
        name: "法线标注导出",
        operation: "normal-annotations",
        destTitle: "选择法线标注保存目录",
        payload: {
          projectName: selectedProject,
          items: normalItems,
        },
        triggerElement,
      });
      if (!result.success) message.error(result.error || "创建法线标注导出任务失败");
    } catch (error) {
      message.error(`创建法线标注导出任务失败：${errorMessage(error)}`);
    } finally {
      setNormalExporting(false);
    }
  }, [message, normalItems, selectedProject]);

  const persistInspectionPoints = useCallback(async (options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const closeAfterSave = options.closeAfterSave !== false;
    const clearHistory = options.clearHistory !== false && closeAfterSave;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("巡检点保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (inspectionSavingRef.current) return false;

    const version = operationVersion.current;
    const items = adapter.getInspectionPoints().map((item: InspectionPointItem) => ({
      ...item,
      updatedAt: new Date().toISOString(),
    }));
    const unboundItem = items.find((item) => !item.pointCode?.trim());
    if (unboundItem) {
      adapter.selectInspectionPoint(unboundItem.id);
      if (!silent) message.warning("请为每个巡检点绑定点位后再保存");
      return false;
    }
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("inspection-point") ?? 0;
    inspectionSavingRef.current = true;
    setInspectionSaving(true);
    try {
      await saveInspectionPointsInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        items,
      });
      if (version !== operationVersion.current) return false;
      setInspectionItems(items);
      setInspectionState((current) => ({
        ...current,
        count: items.length,
        active: closeAfterSave ? false : current.active,
      }));
      adapter.markInspectionPointsSaved();
      const scopeSaved = clearDirtyScope("inspection-point", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("inspection-point");
      if (closeAfterSave) {
        inspectionEditSessionRef.current = null;
        closeNormalMode();
      } else if (scopeSaved) {
        inspectionEditSessionRef.current = {
          items,
          historyCheckpoint: drawingHistory.createCheckpoint(),
          wasDirty: false,
          dirtyVersion: dirtyScopeVersionsRef.current.get("inspection-point") ?? 0,
        };
      }
      if (!silent) message.success(items.length > 0 ? "巡检点保存成功" : "巡检点已清空");
      return true;
    } catch (error) {
      if (!silent) message.error(`保存巡检点失败: ${errorMessage(error)}`);
      return false;
    } finally {
      inspectionSavingRef.current = false;
      if (version === operationVersion.current) setInspectionSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, closeNormalMode, drawingHistory.clearScope, drawingHistory.createCheckpoint, message, selectedProject]);

  const handleToggleInspection = useCallback(() => {
    if (inspectionMode) {
      closeNormalMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || inspectionSavingRef.current) {
      message.warning("模型或巡检点正在处理中，请稍后再试");
      return;
    }
    if (!window.electronAPI) {
      message.warning("巡检点标注仅支持 Electron 模式");
      return;
    }
    cancelHideDraft();
    closeCabinetMode();
    closeChargingMode();
    closeCorrectionMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    inspectionEditSessionRef.current = {
      items: adapter.getInspectionPoints(),
      historyCheckpoint: drawingHistory.createCheckpoint(),
      wasDirty: dirtyScopesRef.current.has("inspection-point"),
      dirtyVersion: dirtyScopeVersionsRef.current.get("inspection-point") ?? 0,
    };
    const started = adapter.startInspectionPointEditing();
    if (!started) {
      message.error("巡检点编辑器初始化失败");
      return;
    }
    setInspectionMode(true);
  }, [activeSourcePath, adapter, cancelHideDraft, closeCabinetMode, closeChargingMode, closeCorrectionMode, closeDeviceAreaMode, closeNormalMode, closePathMode, drawingHistory.createCheckpoint, inspectionMode, message]);

  const handleInspectionSelect = useCallback((item: InspectionPointItem) => {
    if (modelBusyRef.current || inspectionSavingRef.current || saveStatus === "saving" || correctionSaving) return;
    const current = adapter.getInspectionPoints().find((candidate) => candidate.id === item.id);
    if (!current) return;
    if (!inspectionMode) {
      cancelHideDraft();
      closeCabinetMode();
      closeChargingMode();
      closeCorrectionMode();
      closeDeviceAreaMode();
      closePathMode();
      closeNormalMode();
    }
    setShownInspectionPointIds((current) => {
      if (current.has(item.id)) return current;
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    adapter.selectInspectionPoint(current.id);
    adapter.focusAlongDirection(
      current.position[0],
      current.position[1],
      current.position[2],
      current.direction[0],
      current.direction[1],
      current.direction[2],
      Math.max(0.5, current.length * 1.5),
    );
  }, [adapter, cancelHideDraft, closeCabinetMode, closeChargingMode, closeCorrectionMode, closeDeviceAreaMode, closeNormalMode, closePathMode, correctionSaving, inspectionMode, saveStatus]);

  const handleCloseInspectionPanel = useCallback(() => {
    if (inspectionMode) closeNormalMode();
    else adapter.selectInspectionPoint(null);
  }, [adapter, closeNormalMode, inspectionMode]);

  const handleInspectionVisibility = useCallback((ids: string[], visible: boolean) => {
    const idSet = new Set(ids);
    setShownInspectionPointIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => visible ? next.add(id) : next.delete(id));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
    if (!visible && inspectionState.selectedId && idSet.has(inspectionState.selectedId)) {
      adapter.selectInspectionPoint(null);
    }
  }, [adapter, inspectionState.selectedId]);

  useEffect(() => {
    const validIds = new Set(inspectionItems.map((item) => item.id));
    setShownInspectionPointIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [inspectionItems]);

  useEffect(() => {
    adapter.setVisibleInspectionPointIds([...shownInspectionPointIds]);
  }, [adapter, shownInspectionPointIds]);

  const handleInspectionRename = useCallback((inspectionId: string, name: string) => {
    adapter.renameInspectionPoint(inspectionId, name);
  }, [adapter]);

  const handleSaveInspection = useCallback(() => {
    void runSaveOperation(() => persistInspectionPoints({
      silent: false,
      closeAfterSave: false,
      markFileShown: true,
    }));
  }, [persistInspectionPoints, runSaveOperation]);

  const handleInspectionBindPoint = useCallback((inspectionId: string, point: { pointCode: string; pointName: string }) => {
    const pointCodeKey = normalizePointCode(point.pointCode);
    const alreadyBound = inspectionItems.some((item) => item.id !== inspectionId && normalizePointCode(item.pointCode) === pointCodeKey);
    if (alreadyBound) {
      message.warning("该点位已绑定其他巡检点");
      return;
    }
    adapter.bindInspectionPointPoint(inspectionId, point);
  }, [adapter, inspectionItems, message]);

  const handleInspectionUnbindPoint = useCallback((inspectionId: string) => {
    adapter.unbindInspectionPointPoint(inspectionId);
  }, [adapter]);

  const handleInspectionDelete = useCallback((inspectionId: string) => {
    adapter.deleteInspectionPoint(inspectionId);
  }, [adapter]);

  const handleInspectionExport = useCallback(async (triggerElement?: HTMLElement) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    const unbound = inspectionItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !normalizePointCode(item.pointCode));
    if (unbound.length > 0) {
      const names = unbound.map(({ item, index }) => item.name?.trim() || `第 ${index + 1} 个巡检点`);
      message.warning(`请先为以下巡检点绑定点位：${names.join("、")}`);
      return;
    }

    const boundByCode = new Map<string, number>();
    for (let index = 0; index < inspectionItems.length; index += 1) {
      const pointCode = normalizePointCode(inspectionItems[index].pointCode);
      const firstIndex = boundByCode.get(pointCode);
      if (firstIndex !== undefined) {
        message.warning(`点位“${inspectionItems[index].pointCode}”已绑定多个巡检点（第 ${firstIndex + 1} 个和第 ${index + 1} 个）`);
        return;
      }
      boundByCode.set(pointCode, index);
    }

    setInspectionExporting(true);
    try {
      const result = await createLocalExportTask({
        name: "巡检点标注导出",
        operation: "inspection-points",
        destTitle: "选择巡检点标注保存目录",
        payload: {
          projectName: selectedProject,
          items: inspectionItems,
        },
        triggerElement,
      });
      if (!result.success) message.error(result.error || "创建巡检点标注导出任务失败");
    } catch (error) {
      message.error(`创建巡检点标注导出任务失败：${errorMessage(error)}`);
    } finally {
      setInspectionExporting(false);
    }
  }, [inspectionItems, message, selectedProject]);

  const persistPath = useCallback(async (options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const closeAfterSave = options.closeAfterSave !== false;
    const markFileShown = options.markFileShown !== false;
    const clearHistory = options.clearHistory !== false && closeAfterSave;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("可行路径保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (pathSavingRef.current) return false;

    const pathData = adapter.getPathData();
    // 如果没有路径点和路径段，直接返回成功，不显示提示
    if ((!pathData?.points || pathData.points.length === 0) && (!pathData?.paths || pathData.paths.length === 0) && closeAfterSave) {
      return true;
    }

    const version = operationVersion.current;
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("path") ?? 0;
    const pathFilePath = pathSession.current?.filePath || mapSiblingFilePath(modelPath, PATH_FILE_NAME);
    pathSavingRef.current = true;
    setPathSaving(true);
    try {
      await savePathDrawingInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        data: pathData,
      });
      if (version !== operationVersion.current) return false;

      pathSession.current = { filePath: pathFilePath };
      if (closeAfterSave) {
        const savedPath = await loadPathDrawingInLasCoordinates(api, pathFilePath);
        if (version !== operationVersion.current) return false;
        adapter.setEditablePathData(savedPath);
        adapter.setPathDrawingActive(false);
        setPathMode(false);
        setPathState({ ...DEFAULT_PATH_STATE, pointCount: savedPath?.points.length ?? 0, connectionCount: savedPath?.paths.length ?? 0 });
      }
      if (markFileShown) {
        updateLayerVisibility("path", pathFilePath, true);
        setTreeKey((value) => value + 1);
      }
      const scopeSaved = clearDirtyScope("path", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("path");
      if (!silent) message.success("可行路径保存成功");
      return true;
    } catch (error) {
      if (!silent) message.error(`保存可行路径失败: ${errorMessage(error)}`);
      return false;
    } finally {
      pathSavingRef.current = false;
      if (version === operationVersion.current) setPathSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, drawingHistory.clearScope, message, selectedProject, updateLayerVisibility]);

  const handleTogglePathMode = useCallback(async () => {
    if (pathMode) {
      closePathMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || pathSavingRef.current) {
      message.warning("模型或路径正在处理中，请稍后再试");
      return;
    }
    const api = window.electronAPI;
    if (!api) {
      message.warning("可行路径绘制仅支持 Electron 模式");
      return;
    }

    const version = operationVersion.current;
    const pathFilePath = mapSiblingFilePath(activeSourcePath, PATH_FILE_NAME);
    const data = await loadPathDrawingInLasCoordinates(api, pathFilePath);
    if (version !== operationVersion.current) return;
    cancelHideDraft();
    closeCabinetMode();
    closeChargingMode();
    closeDeviceAreaMode();
    closeNormalMode();
    adapter.setEditablePathData(data);
    pathSession.current = { filePath: pathFilePath };
    const started = adapter.startPathDrawing({
      onChange: setPathState,
      onHistory: (before, after, label) => recordDrawingHistory("path", before, after, label),
    });
    if (!started) {
      pathSession.current = null;
      message.error("可行路径编辑器初始化失败");
      return;
    }
    setPathMode(true);
  }, [activeSourcePath, adapter, cancelHideDraft, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closeNormalMode, closePathMode, message, pathMode, recordDrawingHistory]);

  const persistCabinet = useCallback(async (data: CabinetSaveData | null, options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const clearHistory = options.clearHistory !== false;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("屏柜保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (!data) {
      if (!silent) message.warning("请先选择区域和间隔");
      return false;
    }
    if (cabinetSavingRef.current) return false;

    const geometry = adapter.getCabinetGeometry();
    if (!geometry) {
      // 没有几何体，直接返回成功，不提示
      return true;
    }
    const rows = data.rows.map((row) => ({ ...row, code: row.code.trim(), name: row.name.trim() }));
    const requiresCabinetRow = geometry.splits.length > 0 || rows.length > 1;
    const cabinetRow = requiresCabinetRow && data.cabinetRow
      ? { ...data.cabinetRow, code: data.cabinetRow.code.trim(), name: data.cabinetRow.name.trim() }
      : null;
    if (rows.length === 0) {
      // 没有完成分隔，直接返回成功，不提示
      return true;
    }
    if (requiresCabinetRow && !cabinetRow?.name) {
      if (!silent) message.warning("柜排名称不能为空");
      return false;
    }
    if (rows.some((row) => !row.name)) {
      if (!silent) message.warning("屏柜名称不能为空");
      return false;
    }
    if (rows.some((row) => !row.code)) {
      if (!silent) message.warning("屏柜编码不能为空");
      return false;
    }
    const duplicateName = rows.find((row, index) => rows.findIndex((item) => item.name === row.name) !== index);
    if (duplicateName) {
      if (!silent) message.warning(`屏柜名称重复：${duplicateName.name}`);
      return false;
    }
    // 检查与当前地图已有屏柜名称重复
    const existingDuplicate = rows.find((row) => existingCabinetNames.includes(row.name));
    if (existingDuplicate) {
      if (!silent) message.warning(`当前地图已存在同名屏柜：${existingDuplicate.name}`);
      return false;
    }
    const duplicateCode = rows.find((row, index) => rows.findIndex((item) => item.code === row.code) !== index);
    if (duplicateCode) {
      if (!silent) message.warning(`屏柜编码重复：${duplicateCode.code}`);
      return false;
    }

    const version = operationVersion.current;
    const session = cabinetSession.current;
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("cabinet") ?? 0;
    const drawingFilePath = session?.filePath || mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
    const item: CabinetItem = {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type: "cabinet",
      area: data.area,
      bay: data.bay,
      cabinetRow: cabinetRow ? { code: cabinetRow.code, name: cabinetRow.name } : null,
      geometry,
      cabinets: rows.map((row) => ({ code: row.code, name: row.name })),
      updatedAt: new Date().toISOString(),
    };
    cabinetSavingRef.current = true;
    setCabinetSaving(true);
    try {
      const devices = rows.map((row) => ({ code: row.code, name: row.name }));
      const deviceResult = await api.saveCabinetMainDevices(selectedProject, {
        area: data.area,
        bay: data.bay,
        rows: devices,
      });
      if (!deviceResult || deviceResult.total !== devices.length || deviceResult.ids.length !== devices.length) {
        throw new Error("屏柜主设备保存结果异常，请重试");
      }
      await saveCabinetDrawingInLasCoordinates({ api, projectName: selectedProject, modelPath, item });
      if (version !== operationVersion.current) return false;

      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return false;
      adapter.setCabinetDrawingEnabled(false);
      adapter.clearCabinetDrawing();
      adapter.setCabinetNames([]);
      cabinetSession.current = null;
      cabinetDraftRef.current = null;
      syncDrawingFileLayers(drawingFilePath, items, ["cabinet"]);
      setCabinetMode(false);
      setCabinetState(DEFAULT_CABINET_STATE);
      try {
        setCabinetNameSequence(await loadCabinetNameSequence(api, drawingFilePath));
      } catch {
        setCabinetNameSequence({ cabinetRowStart: 1, cabinetStart: 1 });
      }
      // 更新已有屏柜名称列表
      const cabinetItems = items.filter((item): item is CabinetItem => item.type === "cabinet");
      const updatedNames = cabinetItems.flatMap((item) => item.cabinets?.map((c: any) => c.name) || []).filter(Boolean);
      setExistingCabinetNames(updatedNames);
      const scopeSaved = clearDirtyScope("cabinet", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("cabinet");
      setTreeKey((value) => value + 1);
      if (!silent) message.success("屏柜保存成功");
      return true;
    } catch (error) {
      if (!silent) message.error(`保存屏柜失败: ${errorMessage(error)}`);
      return false;
    } finally {
      cabinetSavingRef.current = false;
      if (version === operationVersion.current) setCabinetSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, drawingHistory.clearScope, existingCabinetNames, message, selectedProject, syncDrawingFileLayers]);

  const handleCabinetDraftChange = useCallback((data: CabinetSaveData | null) => {
    cabinetDraftRef.current = data;
  }, []);

  const handleToggleCabinet = useCallback(async () => {
    if (cabinetMode) {
      closeCabinetMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || cabinetSavingRef.current) {
      message.warning("模型或屏柜正在处理中，请稍后再试");
      return;
    }
    const api = window.electronAPI;
    if (!api) {
      message.warning("屏柜绘制仅支持 Electron 模式");
      return;
    }

    // 检查是否有屏柜区间隔
    if (selectedProject) {
      try {
        const bayList = await api.db.bay.list(selectedProject);
        const hasCabinetBay = bayList.some((b: any) => b.bayType === "屏柜区");
        if (!hasCabinetBay) {
          message.warning("当前项目没有可用的屏柜区间隔，请先加载点表");
          return;
        }
      } catch (error) {
        message.error("检查间隔失败，请重试");
        return;
      }
    }

    const version = operationVersion.current;
    const expectedPath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
    const cachedPath = [...drawingLayerData.current.keys()]
      .find((filePath) => sameDrawingFilePath(filePath, expectedPath));
    const drawingFilePath = drawingFilePathFromLayerId(cachedPath || expectedPath);
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    cancelHideDraft();
    closeChargingMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    const wasVisible = [...drawingShown].some((filePath) => sameDrawingFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    cabinetSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    if (wasVisible) {
      syncDrawingFileLayers(drawingFilePath, items);
    }

    const started = adapter.startCabinetDrawing({
      onChange: setCabinetState,
      onHistory: (before, after, label) => recordDrawingHistory("cabinet", before, after, label),
    });
    if (!started) {
      cabinetSession.current = null;
      if (wasVisible) syncDrawingFileLayers(drawingFilePath, items);
      message.error("屏柜编辑器初始化失败");
      return;
    }
    try {
      setCabinetNameSequence(await loadCabinetNameSequence(api, drawingFilePath));
    } catch {
      setCabinetNameSequence({ cabinetRowStart: 1, cabinetStart: 1 });
    }
    // 加载当前地图已有的屏柜名称
    const cabinetItems = items.filter((item): item is CabinetItem => item.type === "cabinet");
    const existingNames = cabinetItems.flatMap((item) => item.cabinets?.map((c: any) => c.name) || []).filter(Boolean);
    setExistingCabinetNames(existingNames);
    setCabinetMode(true);
  }, [activeSourcePath, adapter, cabinetMode, cancelHideDraft, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closeNormalMode, closePathMode, drawingShown, message, recordDrawingHistory, selectedProject, syncDrawingFileLayers]);

  const handleCabinetUndo = useCallback(() => {
    adapter.undoCabinet();
  }, [adapter]);

  const handleCabinetRedo = useCallback(() => {
    adapter.redoCabinet();
  }, [adapter]);

  const handleDrawingSelection = useCallback((selection: SpaceDrawingSelection | null) => {
    void selection;
    adapter.selectInspectionPoint(null);
  }, [adapter]);

  const handleDeleteDrawingType = useCallback(async (filePath: string, type: DrawingSubType): Promise<void> => {
    const api = window.electronAPI;
    if (!api || !selectedProject) throw new Error("项目文件服务不可用");
    if (saveOperationInFlightRef.current) throw new Error("正在保存区域，请稍后再试");
    saveOperationInFlightRef.current = true;
    showSavingStatus();
    const drawingFilePath = drawingFilePathFromLayerId(filePath);
    try {
      await deleteDrawingTypeFromJson(api, selectedProject, drawingFilePath, type);

      let clearedActiveDraft = false;
      if (type === "cabinet" && cabinetSession.current
        && sameDrawingFilePath(cabinetSession.current.filePath, drawingFilePath)) {
        adapter.setCabinetDrawingEnabled(false);
        adapter.clearCabinetDrawing();
        adapter.setCabinetNames([]);
        cabinetSession.current = null;
        cabinetDraftRef.current = null;
        setCabinetMode(false);
        setCabinetState(DEFAULT_CABINET_STATE);
        setExistingCabinetNames([]);
        clearedActiveDraft = true;
      } else if (type === "charging" && chargingSession.current
        && sameDrawingFilePath(chargingSession.current.filePath, drawingFilePath)) {
        adapter.setChargingAreaDrawingEnabled(false);
        adapter.clearChargingAreaDrawing();
        chargingSession.current = null;
        setChargingMode(false);
        setChargingState(DEFAULT_CHARGING_STATE);
        clearedActiveDraft = true;
      } else if (type === "device" && deviceAreaSession.current
        && sameDrawingFilePath(deviceAreaSession.current.filePath, drawingFilePath)) {
        adapter.setDeviceAreaDrawingEnabled(false);
        adapter.clearDeviceAreaDrawing();
        deviceAreaSession.current = null;
        setDeviceAreaMode(false);
        setDeviceAreaState(DEFAULT_DEVICE_AREA_STATE);
        setProjectBoundBayIds(new Set());
        clearedActiveDraft = true;
      }

      if (clearedActiveDraft) {
        const scope: SpaceDrawingHistoryScope = type === "cabinet"
          ? "cabinet"
          : type === "charging" ? "charging" : "device-area";
        dirtyScopesRef.current.delete(scope);
        dirtyScopeVersionsRef.current.delete(scope);
        drawingHistory.clearScope(scope);
      }

      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      syncDrawingFileLayers(drawingFilePath, items);
      const activeDrawingFile = activeSourcePath
        ? mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME)
        : null;
      if (type === "cabinet" && activeDrawingFile
        && sameDrawingFilePath(activeDrawingFile, drawingFilePath)) {
        const cabinetItems = items.filter((item): item is CabinetItem => item.type === "cabinet");
        setExistingCabinetNames(cabinetItems.flatMap((item) => item.cabinets?.map((cabinet) => cabinet.name) || []).filter(Boolean));
      }
      setTreeKey((value) => value + 1);
      showSavedStatus();
    } catch (error) {
      showSaveFailedStatus();
      throw error;
    } finally {
      saveOperationInFlightRef.current = false;
    }
  }, [activeSourcePath, adapter, drawingHistory.clearScope, selectedProject, showSaveFailedStatus, showSavedStatus, showSavingStatus, syncDrawingFileLayers]);

  const handleDrawingDelete = useCallback(async (selection: SpaceDrawingSelection) => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api || !selectedProject || !modelPath) return;
    const drawingFilePath = drawingFilePathFromLayerId(selection.layerId);
    const sourceData = drawingLayerData.current.get(selection.layerId);
    if (selection.item.type === "cabinet") {
      const cabinetId = Number(selection.item.id);
      if (!Number.isSafeInteger(cabinetId) || cabinetId <= 0) {
        message.error("当前屏柜缺少可删除的协议编号");
        return;
      }
      try {
        await deleteCabinetItem(api, selectedProject, drawingFilePath, cabinetId);
        const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
        syncDrawingFileLayers(drawingFilePath, items);
        // 更新已有屏柜名称列表
        const cabinetItems = items.filter((item): item is CabinetItem => item.type === "cabinet");
        const updatedNames = cabinetItems.flatMap((item) => item.cabinets?.map((c: any) => c.name) || []).filter(Boolean);
        setExistingCabinetNames(updatedNames);
        setTreeKey((value) => value + 1);
        message.success("屏柜已删除");
      } catch (error) {
        message.error(`删除屏柜失败：${errorMessage(error)}`);
      }
      return;
    }
    try {
      if (selection.item.type === "charging-area") {
        await saveChargingAreaInLasCoordinates({
          api,
          projectName: selectedProject,
          modelPath,
          item: null,
        });
      } else if (selection.item.type === "device-area") {
        if (!sourceData) {
          message.error("设备区域数据尚未加载，无法删除");
          return;
        }
        const remainingItems: DeviceAreaItem[] = (sourceData?.areas ?? [])
          .filter((item): item is DeviceAreaItem => item.type === "device-area" && item.id !== selection.item.id)
          .map((item) => ({
            ...item,
            geometry: { verts: item.geometry.verts },
          }));
        await saveDeviceAreasInLasCoordinates({
          api,
          projectName: selectedProject,
          modelPath,
          items: remainingItems,
        });
      } else {
        return;
      }
      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      syncDrawingFileLayers(drawingFilePath, items);
      setTreeKey((value) => value + 1);
      message.success(selection.item.type === "charging-area" ? "充电区域已删除" : "设备区域已删除");
    } catch (error) {
      message.error(`删除区域失败：${errorMessage(error)}`);
    }
  }, [activeSourcePath, message, selectedProject, syncDrawingFileLayers]);

  const persistChargingArea = useCallback(async (item: ChargingAreaItem | null, options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const closeAfterSave = options.closeAfterSave !== false;
    const markFileShown = options.markFileShown !== false;
    const clearHistory = options.clearHistory !== false && closeAfterSave;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("充电区域保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (chargingSavingRef.current) return false;

    const version = operationVersion.current;
    const session = chargingSession.current;
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("charging") ?? 0;
    const drawingFilePath = session?.filePath || mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
    chargingSavingRef.current = true;
    setChargingSaving(true);
    try {
      await saveChargingAreaInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        item,
      });
      if (version !== operationVersion.current) return false;

      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return false;
      const data: SpaceDrawingLayer = { areas: items };
      if (closeAfterSave) {
        chargingSession.current = null;
      } else if (chargingSession.current) {
        chargingSession.current = { ...chargingSession.current, filePath: drawingFilePath, sourceData: data };
      }
      syncDrawingFileLayers(drawingFilePath, items, markFileShown ? ["charging"] : []);
      if (closeAfterSave) {
        adapter.setChargingAreaDrawingEnabled(false);
        adapter.clearChargingAreaDrawing();
        setChargingMode(false);
        setChargingState(DEFAULT_CHARGING_STATE);
      }
      const scopeSaved = clearDirtyScope("charging", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("charging");
      if (markFileShown) setTreeKey((value) => value + 1);
      if (!silent) message.success(item ? "充电区域保存成功" : "充电区域已删除");
      return true;
    } catch (error) {
      if (!silent) message.error(`${item ? "保存" : "删除"}充电区域失败: ${errorMessage(error)}`);
      return false;
    } finally {
      chargingSavingRef.current = false;
      if (version === operationVersion.current) setChargingSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, drawingHistory.clearScope, message, selectedProject, syncDrawingFileLayers]);

  const handleSaveChargingArea = useCallback(async (): Promise<boolean> => {
    const verts = adapter.getChargingAreaVerts();
    if (!verts) {
      message.warning("请先完成 3 个点的绘制");
      return false;
    }
    const item: ChargingAreaItem = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "charging-area",
      geometry: { verts },
      updatedAt: new Date().toISOString(),
    };
    return persistChargingArea(item);
  }, [adapter, message, persistChargingArea]);

  chargingDeleteHandler.current = () => {
    void runSaveOperation(() => persistChargingArea(null));
  };

  const handleToggleCharging = useCallback(async () => {
    if (chargingMode) {
      closeChargingMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || chargingSavingRef.current) {
      message.warning("模型或区域正在处理中，请稍后再试");
      return;
    }
    const api = window.electronAPI;
    if (!api) {
      message.warning("充电区域绘制仅支持 Electron 模式");
      return;
    }

    const version = operationVersion.current;
    const expectedPath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
    const cachedPath = [...drawingLayerData.current.keys()]
      .find((filePath) => sameDrawingFilePath(filePath, expectedPath));
    const drawingFilePath = drawingFilePathFromLayerId(cachedPath || expectedPath);
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    const hasExisting = items.some((item) => item.type === "charging-area")
      || adapter.hasChargingAreaDraft();
    if (hasExisting && !(await confirmReplaceChargingArea())) return;
    if (version !== operationVersion.current) return;

    cancelHideDraft();
    closeCabinetMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    const wasVisible = [...drawingShown].some((filePath) => sameDrawingFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    chargingSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    if (wasVisible) {
      syncDrawingFileLayers(drawingFilePath, items);
    }

    const started = adapter.startChargingAreaDrawing({
      onChange: setChargingState,
      onDelete: () => chargingDeleteHandler.current(),
      onHistory: (before, after, label) => recordDrawingHistory("charging", before, after, label),
    });
    if (!started) {
      chargingSession.current = null;
      if (wasVisible) syncDrawingFileLayers(drawingFilePath, items);
      message.error("充电区域编辑器初始化失败");
      return;
    }
    setChargingMode(true);
  }, [activeSourcePath, adapter, chargingMode, cancelHideDraft, closeCabinetMode, closeDeviceAreaMode, closeChargingMode, closeNormalMode, closePathMode, drawingShown, message, recordDrawingHistory, syncDrawingFileLayers]);

  const handleChargingHeightChange = useCallback((height: number) => {
    adapter.setChargingAreaHeight(height);
  }, [adapter]);

  const handleChargingUndo = useCallback(() => {
    adapter.undoChargingArea();
  }, [adapter]);

  const handleChargingRedo = useCallback(() => {
    adapter.redoChargingArea();
  }, [adapter]);

  const persistDeviceAreas = useCallback(async (boxes: SpaceDeviceAreaBox[], options: PersistOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const closeAfterSave = options.closeAfterSave !== false;
    const markFileShown = options.markFileShown !== false;
    const clearHistory = options.clearHistory !== false && closeAfterSave;
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      if (!silent) message.warning("设备区域保存仅支持 Electron 模式");
      return false;
    }
    if (!selectedProject) {
      if (!silent) message.warning("请先选择项目");
      return false;
    }
    if (!modelPath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }
    if (deviceAreaSavingRef.current) return false;

    // 如果没有设备区域，直接返回成功，不显示提示
    if (boxes.length === 0 && closeAfterSave) {
      return true;
    }

    const version = operationVersion.current;
    const session = deviceAreaSession.current;
    const dirtyVersion = options.dirtyVersion ?? dirtyScopeVersionsRef.current.get("device-area") ?? 0;
    const drawingFilePath = session?.filePath || mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
    const items: DeviceAreaItem[] = boxes.map((box) => ({
      id: box.id,
      type: "device-area",
      name: box.name,
      geometry: { verts: box.verts },
      height: box.height,
      bay: box.bay,
      updatedAt: new Date().toISOString(),
    }));
    deviceAreaSavingRef.current = true;
    setDeviceAreaSaving(true);
    try {
      await saveDeviceAreasInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        items,
      });
      if (version !== operationVersion.current) return false;

      const savedItems = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return false;
      const data: SpaceDrawingLayer = { areas: savedItems };
      if (closeAfterSave) {
        deviceAreaSession.current = null;
      } else if (deviceAreaSession.current) {
        deviceAreaSession.current = { ...deviceAreaSession.current, filePath: drawingFilePath, sourceData: data };
      }
      syncDrawingFileLayers(drawingFilePath, savedItems, markFileShown ? ["device"] : []);
      if (closeAfterSave) {
        adapter.setDeviceAreaDrawingEnabled(false);
        adapter.clearDeviceAreaDrawing();
        setDeviceAreaMode(false);
        setDeviceAreaState(DEFAULT_DEVICE_AREA_STATE);
      }
      if (closeAfterSave) setProjectBoundBayIds(new Set());
      const scopeSaved = clearDirtyScope("device-area", dirtyVersion);
      if (clearHistory && scopeSaved) drawingHistory.clearScope("device-area");
      if (markFileShown) setTreeKey((value) => value + 1);
      if (!silent) message.success(items.length > 0 ? "设备区域保存成功" : "设备区域已删除");
      return true;
    } catch (error) {
      if (!silent) message.error(`保存设备区域失败: ${errorMessage(error)}`);
      return false;
    } finally {
      deviceAreaSavingRef.current = false;
      if (version === operationVersion.current) setDeviceAreaSaving(false);
    }
  }, [activeSourcePath, adapter, clearDirtyScope, drawingHistory.clearScope, message, selectedProject, syncDrawingFileLayers]);

  const handleSaveDeviceAreas = useCallback(async (): Promise<boolean> => {
    const boxes = adapter.getDeviceAreaBoxes();
    const unboundBoxes = boxes.filter(box => !box.bay);
    if (unboundBoxes.length > 0) {
      message.warning(`还有 ${unboundBoxes.length} 个设备区域未绑定间隔，请先绑定后再保存`);
      return false;
    }
    return persistDeviceAreas(boxes);
  }, [adapter, message, persistDeviceAreas]);

  deviceAreaDeleteHandler.current = () => {
    void runSaveOperation(() => persistDeviceAreas(adapter.getDeviceAreaBoxes()));
  };

  const handleToggleDeviceArea = useCallback(async () => {
    if (deviceAreaMode) {
      closeDeviceAreaMode();
      return;
    }
    if (!activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current || deviceAreaSavingRef.current) {
      message.warning("模型或区域正在处理中，请稍后再试");
      return;
    }
    const api = window.electronAPI;
    if (!api) {
      message.warning("设备区域绘制仅支持 Electron 模式");
      return;
    }

    // 检查是否有设备区间隔
    if (selectedProject) {
      try {
        const bayList = await api.db.bay.list(selectedProject);
        const hasDeviceAreaBay = bayList.some((b: any) => b.bayType === "设备区");
        if (!hasDeviceAreaBay) {
          message.warning("当前项目没有可用的设备区间隔，请先加载点表");
          return;
        }
      } catch (error) {
        message.error("检查间隔失败，请重试");
        return;
      }
    }

    const version = operationVersion.current;
    const expectedPath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
    const cachedPath = [...drawingLayerData.current.keys()]
      .find((filePath) => sameDrawingFilePath(filePath, expectedPath));
    const drawingFilePath = drawingFilePathFromLayerId(cachedPath || expectedPath);
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    cancelHideDraft();
    closeCabinetMode();
    closeChargingMode();
    closePathMode();
    closeNormalMode();
    const wasVisible = [...drawingShown].some((filePath) => sameDrawingFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    deviceAreaSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    if (wasVisible) {
      syncDrawingFileLayers(drawingFilePath, items);
    }

    const started = adapter.startDeviceAreaDrawing({
      onChange: setDeviceAreaState,
      onDelete: () => deviceAreaDeleteHandler.current(),
      onHistory: (before, after, label) => recordDrawingHistory("device-area", before, after, label),
    });
    if (!started) {
      deviceAreaSession.current = null;
      if (wasVisible) syncDrawingFileLayers(drawingFilePath, items);
      message.error("设备区域编辑器初始化失败");
      return;
    }

    const boxes: SpaceDeviceAreaBox[] = items
      .filter((item): item is DeviceAreaItem => item.type === "device-area")
      .map((item) => ({
        id: item.id,
        verts: item.geometry.verts,
        height: item.height,
        bay: item.bay,
        name: item.name,
      }));
    adapter.loadDeviceAreaBoxes(boxes);
    setDeviceAreaMode(true);

    if (selectedProject) {
      try {
        const boundIds = await getBoundBayIdsInProject(api, selectedProject);
        if (version !== operationVersion.current) return;
        // The current map's bindings are supplied by the editor state. Remove
        // them here so an unbind takes effect immediately in the panel.
        boxes.forEach((box) => {
          if (box.bay?.id) boundIds.delete(box.bay.id);
        });
        setProjectBoundBayIds(boundIds);
      } catch {
        if (version === operationVersion.current) setProjectBoundBayIds(new Set());
      }
    }
  }, [activeSourcePath, adapter, cancelHideDraft, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closeNormalMode, closePathMode, deviceAreaMode, drawingShown, message, recordDrawingHistory, selectedProject, syncDrawingFileLayers]);

  const handleDeviceAreaHeightChange = useCallback((height: number) => {
    adapter.setDeviceAreaHeight(height);
  }, [adapter]);

  const handleDeviceAreaBindBay = useCallback((bay: { id: number; name: string; code: string }) => {
    adapter.bindSelectedDeviceAreaBay(bay);
  }, [adapter]);

  const handleDeviceAreaUnbind = useCallback(() => {
    adapter.unbindSelectedDeviceAreaBay();
  }, [adapter]);

  const handleDeviceAreaUndo = useCallback(() => {
    adapter.undoDeviceArea();
  }, [adapter]);

  const handleDeviceAreaRedo = useCallback(() => {
    adapter.redoDeviceArea();
  }, [adapter]);

  const handleHistoryUndo = useCallback(() => {
    drawingHistory.undo();
  }, [drawingHistory.undo]);

  const handleHistoryRedo = useCallback(() => {
    drawingHistory.redo();
  }, [drawingHistory.redo]);

  const validatePathBeforeSave = useCallback(async (
    data: PathData | null,
    chargingVerts: number[][] | null,
    silent: boolean,
  ): Promise<boolean> => {
    if (!data || data.points.length === 0) return true;
    try {
      const points = orderedPathPoints(data);
      if (points.length === 0) return true;
      let chargingArea: ChargingAreaItem | null = chargingVerts
        ? {
          id: "current",
          type: "charging-area",
          geometry: { verts: chargingVerts },
          updatedAt: "",
        }
        : null;
      if (!chargingArea && window.electronAPI && activeSourcePath) {
        const drawingFilePath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
        const items = await loadAllItemsFromJsonInLasCoordinates(window.electronAPI, drawingFilePath);
        chargingArea = items.find((item): item is ChargingAreaItem => item.type === "charging-area") ?? null;
      }

      if (!chargingArea) {
        if (!silent) message.warning(PATH_CHARGING_AREA_REQUIRED_MESSAGE);
        return false;
      }

      const start = points[0];
      const end = points.length > 1 ? points[points.length - 1] : null;
      if (isPathStartInChargingArea(start, chargingArea)
        || (end && isPathStartInChargingArea(end, chargingArea))) return true;
      if (!silent) message.warning(PATH_START_CHARGING_AREA_MESSAGE);
      return false;
    } catch (error) {
      if (!silent) message.error(`保存路径失败: ${errorMessage(error)}`);
      return false;
    }
  }, [activeSourcePath, message]);

  const saveAll = useCallback(async (options: SaveAllOptions = {}): Promise<boolean> => {
    const silent = !!options.silent;
    const includeCabinet = options.includeCabinet !== false;
    const closeAfterSave = options.closeAfterSave !== false;
    const dirty = new Set(dirtyScopesRef.current);
    const saveStartedVersions = new Map(dirtyScopeVersionsRef.current);
    if (!activeSourcePath) {
      if (!silent) message.warning("请先加载模型");
      return false;
    }

    const persistOptions: PersistOptions = {
      silent,
      closeAfterSave,
      markFileShown: options.markFileShown,
      clearHistory: false,
    };
    let savedAny = false;

    const chargingVerts = adapter.getChargingAreaVerts();
    const shouldSaveCharging = !!chargingVerts && (!silent || dirty.has("charging"));
    const deviceBoxes = adapter.getDeviceAreaBoxes();
    const shouldSaveDevice = !silent || dirty.has("device-area");
    const pathData = adapter.getPathData();
    const shouldSavePath = dirty.has("path") || (!silent && (pathMode || adapter.hasPathDraft()));
    const shouldSaveNormal = dirty.has("normal") || (!silent && normalMode);
    const shouldSaveInspection = dirty.has("inspection-point") || (!silent && inspectionMode);

    if (!silent && chargingState.pointCount > 0 && !chargingVerts) {
      message.warning("充电区域请先完成 3 个点的绘制");
      return false;
    }

    if (shouldSaveDevice && deviceAreaState.pointCount > 0) {
      if (!silent) message.warning("设备区域存在未完成的点位，请先完成 3 个点");
      return false;
    }

    if (shouldSavePath && !(await validatePathBeforeSave(pathData, chargingVerts, silent))) {
      return false;
    }

    if (includeCabinet && adapter.hasCabinetDraft() && (!silent || dirty.has("cabinet"))) {
      const saved = await persistCabinet(cabinetDraftRef.current, {
        ...persistOptions,
        dirtyVersion: saveStartedVersions.get("cabinet") ?? 0,
      });
      if (!saved) return false;
      savedAny = true;
    }

    if (chargingVerts && shouldSaveCharging) {
      const item: ChargingAreaItem = {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        type: "charging-area",
        geometry: { verts: chargingVerts },
        updatedAt: new Date().toISOString(),
      };
      const saved = await persistChargingArea(item, {
        ...persistOptions,
        dirtyVersion: saveStartedVersions.get("charging") ?? 0,
      });
      if (!saved) return false;
      savedAny = true;
    }

    if (shouldSaveDevice) {
      if (deviceBoxes.length > 0 || dirty.has("device-area")) {
        const saved = await persistDeviceAreas(deviceBoxes, {
          ...persistOptions,
          dirtyVersion: saveStartedVersions.get("device-area") ?? 0,
        });
        if (!saved) return false;
        savedAny = true;
      }
    }

    if (shouldSavePath) {
      const saved = await persistPath({
        ...persistOptions,
        dirtyVersion: saveStartedVersions.get("path") ?? 0,
      });
      if (!saved) return false;
      savedAny = true;
    }

    if (shouldSaveNormal) {
      const saved = await persistNormalAnnotations({
        ...persistOptions,
        dirtyVersion: saveStartedVersions.get("normal") ?? 0,
      });
      if (!saved) return false;
      savedAny = true;
    }

    if (shouldSaveInspection) {
      const saved = await persistInspectionPoints({
        ...persistOptions,
        dirtyVersion: saveStartedVersions.get("inspection-point") ?? 0,
      });
      if (!saved) return false;
      savedAny = true;
    }

    if (!savedAny) {
      if (!silent) message.info("没有需要保存的编辑内容");
      return false;
    }

    const changedDuringSave = [...saveStartedVersions.entries()].some(
      ([scope, version]) => (dirtyScopeVersionsRef.current.get(scope) ?? 0) !== version,
    );
    if (options.clearHistory !== false && closeAfterSave && !changedDuringSave) drawingHistory.clear();
    return true;
  }, [
    activeSourcePath,
    adapter,
    chargingState.pointCount,
    deviceAreaState.pointCount,
    drawingHistory.clear,
    message,
    inspectionMode,
    normalMode,
    pathMode,
    persistCabinet,
    persistChargingArea,
    persistDeviceAreas,
    persistPath,
    persistNormalAnnotations,
    persistInspectionPoints,
    validatePathBeforeSave,
  ]);
  saveAllRef.current = saveAll;

  const handleSaveAll = useCallback(async () => {
    await runSaveOperation(() => saveAll({ silent: false, closeAfterSave: true, markFileShown: true, includeCabinet: true }));
    startAutoSaveTimer();
  }, [runSaveOperation, saveAll, startAutoSaveTimer]);

  useEffect(() => {
    adapter.setRenderSettings(renderSettings);
  }, [adapter, renderSettings]);

  useEffect(() => {
    startAutoSaveTimer();
    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [startAutoSaveTimer]);

  useEffect(() => () => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyScopesRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    const busy = saveStatus === "saving" || !!loading || correctionSaving;
    const mode = busy ? "busy" : hideDraftBounds ? "clip" : correctionMode ? "correction" : cabinetMode ? "cabinet" : chargingMode ? "charging" : deviceAreaMode ? "device-area" : pathMode ? "path" : inspectionMode ? "inspection-point" : normalMode ? "normal" : "idle";
    adapter.setInteractionMode(mode);
    return () => adapter.setInteractionMode("idle");
  }, [adapter, cabinetMode, chargingMode, hideDraftBounds, correctionMode, correctionSaving, deviceAreaMode, inspectionMode, loading, normalMode, pathMode, saveStatus]);

  useEffect(() => {
    adapter.setDrawingInteractionCallbacks({
      onSelect: handleDrawingSelection,
      onDelete: (selection) => { void handleDrawingDelete(selection); },
    });
    return () => adapter.setDrawingInteractionCallbacks(null);
  }, [adapter, handleDrawingDelete, handleDrawingSelection]);

  useEffect(() => {
    if (!pageActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && correctionMode) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!event.repeat) closeCorrectionMode();
        return;
      }
      if (event.key === "Escape" && (normalMode || inspectionMode || inspectionState.selectedId)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!event.repeat) {
          if (normalMode) closeNormalMode();
          else handleCloseInspectionPanel();
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
      const isMod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const isUndo = isMod && !event.altKey && key === "z" && !event.shiftKey;
      const isRedo = isMod && !event.altKey && (key === "y" || (key === "z" && event.shiftKey));
      if (isUndo || isRedo) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        isUndo ? handleHistoryUndo() : handleHistoryRedo();
        return;
      }

      const saveShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "s";
      const hasDraft = adapter.hasCabinetDraft()
        || adapter.hasDeviceAreaDraft()
        || adapter.hasChargingAreaDraft()
        || pathMode
        || normalMode
        || inspectionMode
        || dirtyScopesRef.current.size > 0;
      if (!saveShortcut || !hasDraft) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      void handleSaveAll();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    adapter,
    cabinetMode,
    chargingMode,
    deviceAreaMode,
    handleHistoryRedo,
    handleHistoryUndo,
    handleCloseInspectionPanel,
    handleSaveAll,
    closeNormalMode,
    closeCorrectionMode,
    correctionMode,
    inspectionMode,
    inspectionState.selectedId,
    normalMode,
    pathMode,
    pageActive,
  ]);

  useEffect(() => {
    clearLoadedModelState();
    // 区域类型映射按项目隔离；同一项目切换模型时保留已扫描结果，
    // 让地图树在新一轮扫描期间保持稳定。
    setDrawingAvailableTypes(new Map());
  }, [clearLoadedModelState, selectedProject]);

  useEffect(() => {
    const api = window.electronAPI?.potree;
    if (!api) return;
    return api.onConversionProgress((progress) => {
      setLoading((current) => {
        if (current?.kind !== "model" || !current.modelPath || progress.projectName !== selectedProject) return current;
        if (loadedFileKey(current.modelPath) !== loadedFileKey(progress.modelPath)) return current;
        return { ...current, message: progress.message, percent: progress.percent };
      });
    });
  }, [selectedProject]);

  useEffect(() => {
    const api = window.electronAPI?.potree;
    if (!api) return;
    return api.onCorrectionProgress((progress) => {
      setLoading((current) => {
        if (current?.kind !== "correction" || !current.modelPath || progress.projectName !== selectedProject) return current;
        if (loadedFileKey(current.modelPath) !== loadedFileKey(progress.modelPath)) return current;
        setCorrectionProgress(progress.percent);
        return { ...current, message: progress.message, percent: progress.percent };
      });
    });
  }, [selectedProject]);

  const notifyPending = useCallback((feature: string) => {
    message.info(`${feature}正在迁移到 Potree`);
  }, [message]);

  const handleViewChange = useCallback((direction: ViewDirection) => {
    adapter.setViewDirection(direction);
  }, [adapter]);

  const loadModel = useCallback(async (
    item: MapModelItem,
    skipUnsavedConfirmation = false,
    loadAllContents = true,
  ) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (modelBusyRef.current) {
      message.warning({ key: "space-model-busy", content: "模型正在处理中，请稍后再试" });
      return;
    }
    const api = window.electronAPI?.potree;
    if (!api) {
      message.error("点云转换仅支持 Electron 模式");
      return;
    }

    modelBusyRef.current = true;
    setModelOperationBusy(true);
    let version = operationVersion.current;

    try {
      if (!skipUnsavedConfirmation && !(await confirmUnsavedChanges("加载地图"))) return;
      clearHideState();
      version = ++operationVersion.current;
      setLoading({ kind: "model", modelPath: item.modelPath, title: item.mapName, message: "正在检查 Potree 数据", percent: 2 });
      const result = await api.ensureModel(selectedProject, item.modelPath);
      if (version !== operationVersion.current) return;
      clearDrawingVisibility();
      setLoading({ kind: "model", modelPath: item.modelPath, title: item.mapName, message: "正在加载点云层级", percent: 98 });
      await adapter.loadModel({ name: item.mapName, metadataUrl: result.metadataUrl, clipBounds: result.bounds });
      if (version !== operationVersion.current) return;
      const defaultRenderSettings = { ...DEFAULT_SPACE_RENDER_SETTINGS };
      adapter.setRenderSettings(defaultRenderSettings);
      setRenderSettings(defaultRenderSettings);
      setActiveModelPath(item.modelPath);
      setActiveSourcePath(result.modelPath);
      await loadModelCompanionFiles(result.modelPath, loadAllContents);
      if (result.generated) message.success("模型转换并加载完成");
    } catch (error) {
      if (version === operationVersion.current) message.error(errorMessage(error));
    } finally {
      if (version === operationVersion.current) setLoading(null);
      modelBusyRef.current = false;
      setModelOperationBusy(false);
    }
  }, [adapter, clearDrawingVisibility, clearHideState, confirmUnsavedChanges, loadModelCompanionFiles, message, selectedProject]);

  const clearModel = useCallback(async (modelPath?: string): Promise<boolean> => {
    if (modelPath && activeModelPath && loadedFileKey(modelPath) !== loadedFileKey(activeModelPath)) return false;
    if (!(await confirmUnsavedChanges("卸载地图"))) return false;
    clearLoadedModelState();
    return true;
  }, [activeModelPath, clearLoadedModelState, confirmUnsavedChanges]);

  const handleLoadFromTree = useCallback(async (modelPath: string, loadAllContents = false) => {
    await loadModel({ mapName: mapNameFromModelPath(modelPath), modelPath }, false, loadAllContents);
  }, [loadModel]);

  const handleToggleFromTree = useCallback((modelPath: string) => {
    if (activeModelPath && loadedFileKey(activeModelPath) === loadedFileKey(modelPath)) {
      void clearModel(modelPath);
      return;
    }
    void handleLoadFromTree(modelPath);
  }, [activeModelPath, clearModel, handleLoadFromTree]);

  const handleImport = useCallback(async (file: File) => {
    if (!selectedProject) return;
    if (modelBusyRef.current) {
      message.warning({ key: "space-model-busy", content: "模型正在处理中，请稍后再试" });
      return;
    }
    const electronApi = window.electronAPI;
    const sourcePath = electronApi?.getFilePath(file);
    if (!electronApi?.project || !sourcePath) {
      message.error("无法读取导入文件路径");
      return;
    }

    modelBusyRef.current = true;
    setModelOperationBusy(true);
    let version = operationVersion.current;
    try {
      if (!(await confirmUnsavedChanges("导入模型"))) return;
      version = ++operationVersion.current;
      setLoading({ kind: "model", modelPath: null, title: file.name, message: "正在导入模型" });
      let modelPath: string;
      let mapName: string;
      if (isZipFileName(file.name)) {
        const plan = await electronApi.project.inspectModelZipImport(selectedProject, sourcePath);
        if (plan.willReplace && !(await confirmReplaceModel(plan))) return;
        adapter.clearModel();
        clearDrawingVisibility();
        setActiveModelPath(null);
        setActiveSourcePath(null);
        clearHideState();
        const result = await electronApi.project.importModelZip(selectedProject, sourcePath);
        modelPath = result.modelPath;
        mapName = result.mapName;
      } else {
        adapter.clearModel();
        clearDrawingVisibility();
        setActiveModelPath(null);
        setActiveSourcePath(null);
        clearHideState();
        mapName = stripModelExtension(file.name);
        modelPath = await electronApi.project.importFile(selectedProject, sourcePath, file.name);
      }

      if (version !== operationVersion.current) return;
      setTreeKey((value) => value + 1);
      modelBusyRef.current = false;
      setModelOperationBusy(false);
      await loadModel({ mapName, modelPath }, true);
    } catch (error) {
      if (version === operationVersion.current) message.error(errorMessage(error));
    } finally {
      if (version === operationVersion.current) setLoading(null);
      modelBusyRef.current = false;
      setModelOperationBusy(false);
    }
  }, [adapter, clearDrawingVisibility, clearHideState, confirmUnsavedChanges, loadModel, message, selectedProject]);

  const handleImportPointTable = useCallback(async (file: File) => {
    setPointImporting(true);
    try {
      const { rows, stationName } = await parsePointExcel(file);
      if (rows.length === 0) {
        message.warning("Excel 中无有效数据行");
        return;
      }
      if (!stationName) {
        message.warning("Excel 中未找到厂站名称");
        return;
      }
      const api = window.electronAPI;
      if (!api) {
        message.warning("点表导入仅支持 Electron 模式");
        return;
      }
      if (!selectedProject) {
        message.warning("请先在顶部菜单栏选择一个项目");
        return;
      }

      const ext = file.name.match(/\.(xlsx|xls)$/i)?.[0] || ".xlsx";
      const savedName = `${stationName}${ext}`;
      try {
        const oldFiles = await api.project.listTree(selectedProject, POINT_TABLE_DIR_NAME);
        for (const node of oldFiles) {
          if (!node.isDir && POINT_TABLE_FILE_RE.test(node.name)) await api.project.deletePath(node.path);
        }
      } catch {
        // The point-table directory may not exist in a new project.
      }

      const savedSubPath = pointTableFileSubPath(savedName);
      await api.project.writeFile(selectedProject, savedSubPath, await file.arrayBuffer());
      const stationCode = stationName.substring(0, 10) + Date.now().toString().slice(-4);
      const result = await api.importPoints(rows, stationName, stationCode, selectedProject);
      setTreeKey((value) => value + 1);
      message.success(`导入成功: ${result.inserted} 新增, ${result.updated} 更新`);
      if (result.errors.length > 0) message.warning(result.errors.slice(0, 3).join("; "));
    } catch (error) {
      message.error(`导入失败: ${errorMessage(error)}`);
    } finally {
      setPointImporting(false);
    }
  }, [message, selectedProject]);

  const handleHide = useCallback(() => {
    if (!activeModelPath || !activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current) {
      message.warning({ key: "space-model-busy", content: "模型正在处理中，请稍后再试" });
      return;
    }
    closeCabinetMode();
    closeChargingMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    closeCorrectionMode();
    const initialBounds = adapter.startClipping(
      (bounds) => setHideDraftBounds(bounds),
      hideDraftBoundsRef.current ?? hiddenModelBoundsRef.current,
    );
    if (!initialBounds) {
      message.error("无法读取当前模型范围");
      return;
    }
    setHideDraftBounds(initialBounds);
  }, [activeModelPath, activeSourcePath, adapter, closeCabinetMode, closeChargingMode, closeCorrectionMode, closeDeviceAreaMode, closeNormalMode, closePathMode, message]);

  const handleHideBoundsChange = useCallback((bounds: SpaceClipBounds) => {
    setHideDraftBounds(bounds);
    adapter.setClipBounds(bounds);
  }, [adapter]);

  const handleHideCancel = useCallback(() => {
    cancelHideDraft();
  }, [cancelHideDraft]);

  const handleHideConfirm = useCallback(() => {
    const bounds = adapter.commitClipping() ?? hideDraftBoundsRef.current;
    if (!bounds) {
      message.error("无法保存隐藏范围");
      return;
    }
    setHiddenModelBounds(bounds);
    setHideDraftBounds(null);
  }, [adapter, message]);

  const handleRestoreModel = useCallback(() => {
    clearHideState();
  }, [clearHideState]);

  const handleToggleCorrection = useCallback(async () => {
    if (correctionMode) {
      closeCorrectionMode();
      return;
    }
    if (!activeModelPath || !activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current) {
      message.warning({ key: "space-model-busy", content: "模型正在处理中，请稍后再试" });
      return;
    }
    if (!(await confirmUnsavedChanges("纠正地图坐标"))) return;
    cancelHideDraft();
    closeCabinetMode();
    closeChargingMode();
    closeDeviceAreaMode();
    closePathMode();
    closeNormalMode();
    adapter.setCoordinateCorrectionMarker(null);
    setCorrectionOrigin(null);
    setCorrectionProgress(undefined);
    setCorrectionMode(true);
  }, [
    activeModelPath,
    activeSourcePath,
    adapter,
    cancelHideDraft,
    closeCabinetMode,
    closeChargingMode,
    closeCorrectionMode,
    closeDeviceAreaMode,
    closeNormalMode,
    closePathMode,
    confirmUnsavedChanges,
    correctionMode,
    message,
  ]);

  const handleCorrectionPointClick = useCallback((clientX: number, clientY: number) => {
    if (!correctionMode || correctionSaving || loading) return;
    const point = adapter.pickPointAt(clientX, clientY);
    if (!point) {
      message.warning("未选中点云，请重新选择");
      return;
    }
    adapter.setCoordinateCorrectionMarker(point);
    setCorrectionOrigin(point);
  }, [adapter, correctionMode, correctionSaving, loading, message]);

  const handleCorrectionConfirm = useCallback(async () => {
    if (!correctionOrigin || !activeSourcePath || !selectedProject || modelBusyRef.current) return;
    const api = window.electronAPI?.potree;
    if (!api) {
      message.error("坐标纠正仅支持 Electron 模式");
      return;
    }

    const sourcePath = activeSourcePath;
    const sourceMapName = mapNameFromModelPath(sourcePath);
    modelBusyRef.current = true;
    setModelOperationBusy(true);
    setCorrectionSaving(true);
    setCorrectionProgress(0);
    const version = ++operationVersion.current;
    setLoading({
      kind: "correction",
      modelPath: sourcePath,
      title: `正在生成 ${sourceMapName}_纠正`,
      message: "正在准备纠正地图",
      percent: 0,
    });

    try {
      const result = await api.correctMap(selectedProject, sourcePath, correctionOrigin);
      if (version !== operationVersion.current) return;
      setTreeKey((value) => value + 1);
      setCorrectionMode(false);
      adapter.setCoordinateCorrectionMarker(null);
      setCorrectionOrigin(null);
      setCorrectionSaving(false);
      setCorrectionProgress(undefined);
      modelBusyRef.current = false;
      setModelOperationBusy(false);
      setLoading(null);
      message.success(`坐标纠正完成，已生成地图“${result.mapName}”`);
      await loadModel({ mapName: result.mapName, modelPath: result.modelPath });
    } catch (error) {
      if (version === operationVersion.current) message.error(`坐标纠正失败: ${errorMessage(error)}`);
    } finally {
      if (version === operationVersion.current) setLoading(null);
      setCorrectionSaving(false);
      setCorrectionProgress(undefined);
      modelBusyRef.current = false;
      setModelOperationBusy(false);
    }
  }, [activeSourcePath, adapter, correctionOrigin, loadModel, message, selectedProject]);

  return (
    <>
      <SpaceEditLayout
        containerRef={containerRef}
        resizing={resizing}
        onResizeStart={onResizeStart}
        toolbar={(
          <Toolbar
            onOpenLoadModel={() => setImportOpen(true)}
            hideMode={!!hideDraftBounds}
            onToggleHide={handleHide}
            modelHidden={!!(hideDraftBounds || hiddenModelBounds)}
            onRestoreModel={handleRestoreModel}
            correctionMode={correctionMode}
            onToggleCorrection={() => void handleToggleCorrection()}
            cabinetMode={cabinetMode}
            onToggleCabinet={() => void handleToggleCabinet()}
            chargingMode={chargingMode}
            onToggleCharging={() => void handleToggleCharging()}
            deviceAreaMode={deviceAreaMode}
            onToggleDeviceArea={() => void handleToggleDeviceArea()}
            pathMode={pathMode}
            onTogglePath={() => void handleTogglePathMode()}
            inspectionMode={inspectionMode}
            inspectionCount={inspectionState.count}
            inspectionSaving={inspectionSaving}
            inspectionExporting={inspectionExporting}
            onToggleInspection={handleToggleInspection}
            onExportInspection={handleInspectionExport}
            onUndo={handleHistoryUndo}
            onRedo={handleHistoryRedo}
            canUndo={drawingHistory.canUndo}
            canRedo={drawingHistory.canRedo}
            onSaveAll={() => { void handleSaveAll(); }}
            onImportPointTable={handleImportPointTable}
            onExportModel={() => setExportOpen(true)}
            importing={pointImporting}
            modelBusy={modelOperationBusy || saveStatus === "saving" || !!loading || correctionSaving}
          />
        )}
        viewControls={<ViewCube onViewChange={handleViewChange} />}
        sidePanel={(
          <SidePanel
            panelWidth={panelWidth}
            treeKey={treeKey}
            onLoadLas={handleLoadFromTree}
            onToggleVisible={handleToggleFromTree}
            onUnloadMapFile={clearModel}
            loadedFiles={loadedFiles}
            loadingFile={loading?.kind === "model" ? loading.modelPath || "" : ""}
            mapDrawingShown={drawingShown}
            mapDrawingAvailableTypes={drawingAvailableTypes}
            onToggleDrawing={(filePath, checked) => void handleToggleDrawing(filePath, checked)}
            onDeleteDrawingType={handleDeleteDrawingType}
            mapPathShown={pathShown}
            onTogglePath={(filePath, checked) => void handleTogglePath(filePath, checked)}
            modelBusy={modelOperationBusy}
            onMapTreeLoaded={handleMapTreeLoaded}
            activeModelPath={activeSourcePath}
            inspectionPoints={inspectionItems}
            shownInspectionPointIds={shownInspectionPointIds}
            selectedInspectionPointId={inspectionState.selectedId}
            onSelectInspectionPoint={handleInspectionSelect}
            onSetInspectionPointVisibility={handleInspectionVisibility}
          />
        )}
        scene={(
          <SpaceSceneHost
            adapterFactory={adapterFactory}
            picking={correctionMode && !correctionSaving}
            busy={modelOperationBusy || saveStatus === "saving" || !!loading || correctionSaving}
            onSceneClick={handleCorrectionPointClick}
            overlay={(sceneState) => (
              <>
                {loading ? (
                  <ModelLoadingOverlay {...loading} />
                ) : sceneState === "ready" && !activeModelPath ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      display: "grid",
                      placeItems: "center",
                      color: "#747b86",
                      pointerEvents: "none",
                    }}
                  >
                    <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
                      <CloudOutlined style={{ fontSize: 30 }} />
                      <span style={{ fontSize: 13 }}>暂无已加载模型</span>
                    </div>
                  </div>
                ) : null}
                {!normalMode && !inspectionMode && <SpaceShortcutHelp />}
                {correctionMode && !correctionSaving && activeSourcePath && (
                  <MapCoordinateCorrectionPanel
                    mapName={mapNameFromModelPath(activeSourcePath)}
                    origin={correctionOrigin}
                    saving={correctionSaving}
                    progress={correctionProgress}
                    onReselect={() => {
                      adapter.setCoordinateCorrectionMarker(null);
                      setCorrectionOrigin(null);
                    }}
                    onConfirm={() => void handleCorrectionConfirm()}
                    onCancel={closeCorrectionMode}
                  />
                )}
                {normalMode && (
                  <NormalAnnotationPanel
                    items={normalItems}
                    selectedId={normalState.selectedId}
                    saving={normalSaving || normalExporting}
                    exporting={normalExporting}
                    onClose={closeNormalMode}
                    onSelect={handleNormalSelect}
                    onRename={handleNormalRename}
                    onBindPoint={handleNormalBindPoint}
                    onUnbindPoint={handleNormalUnbindPoint}
                    onDelete={handleNormalDelete}
                    onExport={handleNormalExport}
                  />
                )}
                {(inspectionMode || inspectionState.selectedId) && (
                  <InspectionPointPanel
                    marking={inspectionMode}
                    item={inspectionItems.find((item) => item.id === inspectionState.selectedId) ?? null}
                    count={inspectionState.count}
                    items={inspectionItems}
                    saving={inspectionSaving || modelOperationBusy || saveStatus === "saving" || !!loading || correctionSaving}
                    bayFilter={inspectionBayFilter}
                    onClose={handleCloseInspectionPanel}
                    onSave={handleSaveInspection}
                    onBayFilterChange={setInspectionBayFilter}
                    onRename={handleInspectionRename}
                    onBindPoint={handleInspectionBindPoint}
                    onUnbindPoint={handleInspectionUnbindPoint}
                    onDelete={handleInspectionDelete}
                  />
                )}
                <SaveStatusBadge status={saveStatus} />
                <PotreeRenderSettings settings={renderSettings} onChange={setRenderSettings} />
                {cabinetMode && (
                  <CabinetPanel
                    cornerCount={cabinetState.cornerCount}
                    cabinetCount={cabinetState.cabinetCount}
                    nameSequence={cabinetNameSequence}
                    existingCabinetNames={existingCabinetNames}
                    onClose={closeCabinetMode}
                    onSave={(data) => { void runSaveOperation(() => persistCabinet(data)); }}
                    onDraftChange={handleCabinetDraftChange}
                    onNamesChange={(names) => adapter.setCabinetNames(names)}
                    saving={cabinetSaving}
                  />
                )}
                {chargingMode && (
                  <ChargingAreaPanel
                    pointCount={chargingState.pointCount}
                    height={chargingState.height}
                    onClose={closeChargingMode}
                    onSave={() => { void runSaveOperation(handleSaveChargingArea); }}
                    onSetHeight={handleChargingHeightChange}
                    saving={chargingSaving}
                  />
                )}
                {deviceAreaMode && (
                  <DeviceAreaPanel
                    boxCount={deviceAreaState.boxCount}
                    boundBoxCount={deviceAreaState.boundBayIds.length}
                    height={deviceAreaState.height}
                    selectedBoxId={deviceAreaState.selectedBoxId}
                    selectedBoxBay={deviceAreaState.selectedBoxBay}
                    boundBayIds={new Set([
                      ...deviceAreaState.boundBayIds,
                      ...projectBoundBayIds,
                    ])}
                    onClose={closeDeviceAreaMode}
                    onSave={() => { void runSaveOperation(handleSaveDeviceAreas); }}
                    onSetHeight={handleDeviceAreaHeightChange}
                    onBindBay={handleDeviceAreaBindBay}
                    onUnbind={handleDeviceAreaUnbind}
                    saving={deviceAreaSaving}
                  />
                )}
                {hideDraftBounds && (
                  <PotreeClipController
                    bounds={hideDraftBounds}
                    saving={false}
                    onChange={handleHideBoundsChange}
                    onConfirm={handleHideConfirm}
                    onCancel={handleHideCancel}
                  />
                )}
              </>
            )}
          />
        )}
        importing={pointImporting}
        exportModal={(
          <ExportModal
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            modelPath={activeModelPath || ""}
          />
        )}
      />
      <LoadModelModal
        open={importOpen}
        selectedProject={selectedProject}
        onClose={() => setImportOpen(false)}
        onConfirm={(file) => void handleImport(file)}
      />
    </>
  );
}
