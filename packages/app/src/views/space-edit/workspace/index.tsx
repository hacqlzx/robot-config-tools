import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Modal } from "antd";
import { CloudOutlined } from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
import { useSelectedProject } from "@/stores/appContextStore";
import { parsePointExcel } from "@/utils/excel-parser";
import ExportModal from "../components/ExportModal";
import CabinetPanel, { type CabinetSaveData } from "../components/CabinetPanel";
import ChargingAreaPanel from "../components/ChargingAreaPanel";
import DeviceAreaPanel from "../components/DeviceAreaPanel";
import LoadModelModal from "../components/LoadModelModal";
import SidePanel from "../components/SidePanel";
import SpaceEditLayout from "../components/SpaceEditLayout";
import Toolbar from "../components/Toolbar";
import ViewCube from "../components/ViewCube";
import type { ViewDirection } from "../types";
import {
  deleteCabinetItem,
  DRAWING_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  loadAllItemsFromJsonInLasCoordinates,
  loadPathDrawingInLasCoordinates,
  getBoundBayIdsInProject,
  loadCabinetNameSequence,
  saveCabinetDrawingInLasCoordinates,
  saveChargingAreaInLasCoordinates,
  saveDeviceAreasInLasCoordinates,
  savePathDrawingInLasCoordinates,
  type CabinetItem,
  type ChargingAreaItem,
  type DeviceAreaItem,
} from "../hooks/drawing/drawing-storage";
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
import SpaceSceneHost from "./components/SpaceSceneHost";
import { PotreeSpaceSceneAdapter } from "./engine/PotreeSpaceSceneAdapter";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  normalizeSpaceRenderSettings,
  type SpaceCabinetState,
  type SpaceChargingAreaState,
  type SpaceClipBounds,
  type SpaceDeviceAreaBox,
  type SpaceDeviceAreaState,
  type SpaceDrawingLayer,
  type SpaceDrawingSelection,
  type SpacePathState,
  type SpaceRenderSettings,
} from "./engine/types";

const RENDER_SETTINGS_STORAGE_KEY = "space-edit:potree-render-settings";
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
  canUndo: false,
  canRedo: false,
};

interface LoadingState {
  kind: "model" | "clip";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadRenderSettings(): SpaceRenderSettings {
  try {
    const saved = window.localStorage.getItem(RENDER_SETTINGS_STORAGE_KEY);
    return saved
      ? normalizeSpaceRenderSettings(JSON.parse(saved) as Partial<SpaceRenderSettings>)
      : { ...DEFAULT_SPACE_RENDER_SETTINGS };
  } catch {
    return { ...DEFAULT_SPACE_RENDER_SETTINGS };
  }
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

export default function SpaceEditWorkspace() {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const adapter = useMemo(() => new PotreeSpaceSceneAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const containerRef = useRef<HTMLDivElement>(null);
  const operationVersion = useRef(0);
  const modelBusyRef = useRef(false);
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null);
  const [activeSourcePath, setActiveSourcePath] = useState<string | null>(null);
  const [clipBounds, setClipBounds] = useState<SpaceClipBounds | null>(null);
  const [clipSaving, setClipSaving] = useState(false);
  const [clipProgress, setClipProgress] = useState<number | undefined>();
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const [pointImporting, setPointImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderSettings, setRenderSettings] = useState(loadRenderSettings);
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const [pathShown, setPathShown] = useState<Set<string>>(new Set());
  const [cabinetMode, setCabinetMode] = useState(false);
  const [cabinetState, setCabinetState] = useState<SpaceCabinetState>(DEFAULT_CABINET_STATE);
  const [cabinetSaving, setCabinetSaving] = useState(false);
  const [cabinetNameSequence, setCabinetNameSequence] = useState({ cabinetRowStart: 1, cabinetStart: 1 });
  const [chargingMode, setChargingMode] = useState(false);
  const [chargingState, setChargingState] = useState<SpaceChargingAreaState>(DEFAULT_CHARGING_STATE);
  const [chargingSaving, setChargingSaving] = useState(false);
  const [deviceAreaMode, setDeviceAreaMode] = useState(false);
  const [deviceAreaState, setDeviceAreaState] = useState<SpaceDeviceAreaState>(DEFAULT_DEVICE_AREA_STATE);
  const [deviceAreaSaving, setDeviceAreaSaving] = useState(false);
  const [pathMode, setPathMode] = useState(false);
  const [pathState, setPathState] = useState<SpacePathState>(DEFAULT_PATH_STATE);
  const [, setPathSaving] = useState(false);
  const [projectBoundBayIds, setProjectBoundBayIds] = useState<Set<number>>(new Set());
  const drawingLifecycleVersion = useRef(0);
  const drawingLayerVersions = useRef(new Map<string, number>());
  const drawingLayerData = useRef(new Map<string, SpaceDrawingLayer>());
  const cabinetBayFilter = useRef<Set<number> | null>(null);
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
  const { width: panelWidth, resizing, onMouseDown: onResizeStart } = useResizable({
    containerRef,
    minWidth: 220,
    maxWidth: 520,
    initialWidth: 260,
    maxPercent: 0.45,
  });

  const loadedFiles = useMemo(
    () => new Set(activeModelPath ? [loadedFileKey(activeModelPath)] : []),
    [activeModelPath],
  );
  const clearDrawingVisibility = useCallback(() => {
    drawingLifecycleVersion.current += 1;
    drawingLayerVersions.current.clear();
    drawingLayerData.current.clear();
    cabinetBayFilter.current = null;
    cabinetSession.current = null;
    cabinetSavingRef.current = false;
    cabinetDraftRef.current = null;
    chargingSession.current = null;
    chargingSavingRef.current = false;
    deviceAreaSession.current = null;
    deviceAreaSavingRef.current = false;
    pathSession.current = null;
    pathSavingRef.current = false;
    adapter.clearCabinetDrawing();
    adapter.clearChargingAreaDrawing();
    adapter.clearDeviceAreaDrawing();
    adapter.clearPathDrawing();
    adapter.clearDrawingLayers();
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
    setProjectBoundBayIds(new Set());
    setDrawingShown(new Set());
    setPathShown(new Set());
  }, [adapter]);

  const updateLayerVisibility = useCallback((kind: "drawing" | "path", filePath: string, visible: boolean) => {
    const setter = kind === "drawing" ? setDrawingShown : setPathShown;
    setter((current) => {
      const next = new Set(current);
      if (visible) next.add(filePath);
      else next.delete(filePath);
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
    const cabinet = cabinetSession.current;
    const charging = chargingSession.current;
    const deviceArea = deviceAreaSession.current;
    if (cabinet && sameFilePath(cabinet.filePath, filePath)) {
      cabinet.filePath = filePath;
      cabinet.sourceData = data;
      editingTypes.add("cabinet");
    }
    if (charging && sameFilePath(charging.filePath, filePath)) {
      charging.filePath = filePath;
      charging.sourceData = data;
      editingTypes.add("charging-area");
    }
    if (deviceArea && sameFilePath(deviceArea.filePath, filePath)) {
      deviceArea.filePath = filePath;
      deviceArea.sourceData = data;
      editingTypes.add("device-area");
    }
    const cabinetFilter = cabinetBayFilter.current;
    const areas = (data.areas ?? [])
      .filter((item) => !editingTypes.has(item.type))
      .filter((item) => {
        if (item.type !== "cabinet" || !cabinetFilter) return true;
        return !!item.bay && cabinetFilter.has(item.bay.id);
      });
    adapter.setDrawingLayer(filePath, { ...data, areas });
  }, [adapter]);

  const handleToggleDrawing = useCallback(async (filePath: string, checked: boolean) => {
    const layerVersion = nextLayerVersion("drawing", filePath);
    const lifecycleVersion = drawingLifecycleVersion.current;
    if (!checked) {
      adapter.removeDrawingLayer(filePath);
      for (const cachedPath of drawingLayerData.current.keys()) {
        if (sameFilePath(cachedPath, filePath)) drawingLayerData.current.delete(cachedPath);
      }
      updateLayerVisibility("drawing", filePath, false);
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    const items = await loadAllItemsFromJsonInLasCoordinates(api, filePath);
      if (lifecycleVersion !== drawingLifecycleVersion.current
        || layerVersion !== drawingLayerVersions.current.get(`drawing:${loadedFileKey(filePath)}`)) return;
      const data: SpaceDrawingLayer = { areas: items };
      drawingLayerData.current.set(filePath, data);
      renderDrawingLayer(filePath, data);
    updateLayerVisibility("drawing", filePath, true);
  }, [adapter, nextLayerVersion, renderDrawingLayer, updateLayerVisibility]);

  const handleCabinetCheck = useCallback(async (bayIds: number[]) => {
    cabinetBayFilter.current = new Set(bayIds);
    const api = window.electronAPI;
    const targetPaths = new Set(drawingLayerData.current.keys());
    const expectedPath = activeSourcePath ? mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME) : "";
    if (expectedPath) {
      const cachedPath = [...drawingLayerData.current.keys()].find((filePath) => sameFilePath(filePath, expectedPath));
      if (cachedPath) {
        targetPaths.add(cachedPath);
      } else if (api && bayIds.length > 0) {
        try {
          const items = await loadAllItemsFromJsonInLasCoordinates(api, expectedPath);
          const data: SpaceDrawingLayer = { areas: items };
          drawingLayerData.current.set(expectedPath, data);
          targetPaths.add(expectedPath);
        } catch {
          return;
        }
      }
    }

    for (const filePath of targetPaths) {
      const data = drawingLayerData.current.get(filePath);
      if (!data) continue;
      const mapLayerVisible = [...drawingShown].some((shownPath) => sameFilePath(shownPath, filePath));
      if (bayIds.length === 0 && !mapLayerVisible) {
        adapter.removeDrawingLayer(filePath);
        continue;
      }
      renderDrawingLayer(filePath, data);
    }
  }, [activeSourcePath, adapter, drawingShown, renderDrawingLayer]);

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

  const loadModelCompanionFiles = useCallback(async (modelPath: string) => {
    if (!selectedProject || !window.electronAPI?.project) return;
    const subDir = mapDirSubPathFromModelPath(modelPath);
    if (!subDir) return;
    try {
      const tree = await window.electronAPI.project.listTree(selectedProject, subDir) as SpaceFileNode[];
      const drawingFile = findFilesByName(tree, [DRAWING_FILE_NAME])[0];
      if (drawingFile) await handleToggleDrawing(drawingFile, true);
      const pathFiles = findFilesByName(tree, [PATH_FILE_NAME, ROBOT_PATH_FILE_NAME])
        .sort((left, right) => left.localeCompare(right));
      for (const pathFile of pathFiles) await handleTogglePath(pathFile, true);
    } catch (error) {
      console.warn("[space-edit] 自动加载区域/路径失败", { modelPath, error });
    }
  }, [handleToggleDrawing, handleTogglePath, selectedProject]);

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

  const persistPath = useCallback(async () => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      message.warning("可行路径保存仅支持 Electron 模式");
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!modelPath) {
      message.warning("请先加载模型");
      return;
    }
    if (pathSavingRef.current) return;

    const version = operationVersion.current;
    const pathFilePath = pathSession.current?.filePath || mapSiblingFilePath(modelPath, PATH_FILE_NAME);
    pathSavingRef.current = true;
    setPathSaving(true);
    try {
      await savePathDrawingInLasCoordinates({
        api,
        projectName: selectedProject,
        modelPath,
        data: adapter.getPathData(),
      });
      if (version !== operationVersion.current) return;

      const savedPath = await loadPathDrawingInLasCoordinates(api, pathFilePath);
      if (version !== operationVersion.current) return;
      adapter.setEditablePathData(savedPath);
      adapter.setPathDrawingActive(false);
      pathSession.current = { filePath: pathFilePath };
      setPathMode(false);
      setPathState({ ...DEFAULT_PATH_STATE, pointCount: savedPath?.points.length ?? 0, connectionCount: savedPath?.paths.length ?? 0 });
      updateLayerVisibility("path", pathFilePath, true);
      setTreeKey((value) => value + 1);
      message.success("可行路径保存成功");
    } catch (error) {
      message.error(`保存可行路径失败: ${errorMessage(error)}`);
    } finally {
      pathSavingRef.current = false;
      if (version === operationVersion.current) setPathSaving(false);
    }
  }, [activeSourcePath, adapter, message, selectedProject, updateLayerVisibility]);

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
    closeCabinetMode();
    closeChargingMode();
    closeDeviceAreaMode();
    adapter.setEditablePathData(data);
    pathSession.current = { filePath: pathFilePath };
    const started = adapter.startPathDrawing({ onChange: setPathState });
    if (!started) {
      pathSession.current = null;
      message.error("可行路径编辑器初始化失败");
      return;
    }
    setPathMode(true);
  }, [activeSourcePath, adapter, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closePathMode, message, pathMode]);

  const handlePathUndo = useCallback(() => {
    adapter.undoPath();
  }, [adapter]);

  const handlePathRedo = useCallback(() => {
    adapter.redoPath();
  }, [adapter]);

  const persistCabinet = useCallback(async (data: CabinetSaveData | null) => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      message.warning("屏柜保存仅支持 Electron 模式");
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!modelPath) {
      message.warning("请先加载模型");
      return;
    }
    if (!data) {
      message.warning("请先选择区域和间隔");
      return;
    }
    if (cabinetSavingRef.current) return;

    const geometry = adapter.getCabinetGeometry();
    if (!geometry) {
      message.warning("请先完成屏柜绘制（四点成体）");
      return;
    }
    const rows = data.rows.map((row) => ({ ...row, code: row.code.trim(), name: row.name.trim() }));
    const requiresCabinetRow = geometry.splits.length > 0 || rows.length > 1;
    const cabinetRow = requiresCabinetRow && data.cabinetRow
      ? { ...data.cabinetRow, code: data.cabinetRow.code.trim(), name: data.cabinetRow.name.trim() }
      : null;
    if (rows.length === 0) {
      message.warning("请先完成屏柜分隔");
      return;
    }
    if (requiresCabinetRow && !cabinetRow?.name) {
      message.warning("柜排名称不能为空");
      return;
    }
    if (rows.some((row) => !row.name)) {
      message.warning("屏柜名称不能为空");
      return;
    }
    if (rows.some((row) => !row.code)) {
      message.warning("屏柜编码不能为空");
      return;
    }
    const duplicateName = rows.find((row, index) => rows.findIndex((item) => item.name === row.name) !== index);
    if (duplicateName) {
      message.warning(`屏柜名称重复：${duplicateName.name}`);
      return;
    }
    const duplicateCode = rows.find((row, index) => rows.findIndex((item) => item.code === row.code) !== index);
    if (duplicateCode) {
      message.warning(`屏柜编码重复：${duplicateCode.code}`);
      return;
    }

    const version = operationVersion.current;
    const session = cabinetSession.current;
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
      if (version !== operationVersion.current) return;

      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return;
      adapter.setCabinetDrawingEnabled(false);
      adapter.clearCabinetDrawing();
      adapter.setCabinetNames([]);
      cabinetSession.current = null;
      cabinetDraftRef.current = null;
      const layer: SpaceDrawingLayer = { areas: items };
      drawingLayerData.current.set(drawingFilePath, layer);
      renderDrawingLayer(drawingFilePath, layer);
      updateLayerVisibility("drawing", drawingFilePath, true);
      setCabinetMode(false);
      setCabinetState(DEFAULT_CABINET_STATE);
      try {
        setCabinetNameSequence(await loadCabinetNameSequence(api, drawingFilePath));
      } catch {
        setCabinetNameSequence({ cabinetRowStart: 1, cabinetStart: 1 });
      }
      setTreeKey((value) => value + 1);
      message.success("屏柜保存成功");
    } catch (error) {
      message.error(`保存屏柜失败: ${errorMessage(error)}`);
    } finally {
      cabinetSavingRef.current = false;
      if (version === operationVersion.current) setCabinetSaving(false);
    }
  }, [activeSourcePath, adapter, message, renderDrawingLayer, selectedProject, updateLayerVisibility]);

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

    const version = operationVersion.current;
    const expectedPath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
    const cachedPath = [...drawingLayerData.current.keys()]
      .find((filePath) => sameFilePath(filePath, expectedPath));
    const drawingFilePath = cachedPath || expectedPath;
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    if (clipBounds) {
      adapter.stopClipping();
      setClipBounds(null);
      setClipProgress(undefined);
    }
    closeChargingMode();
    closeDeviceAreaMode();
    closePathMode();
    const wasVisible = [...drawingShown].some((filePath) => sameFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    cabinetSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    drawingLayerData.current.set(drawingFilePath, sourceData);
    if (wasVisible) {
      renderDrawingLayer(drawingFilePath, sourceData);
    }

    const started = adapter.startCabinetDrawing({ onChange: setCabinetState });
    if (!started) {
      cabinetSession.current = null;
      if (wasVisible) renderDrawingLayer(drawingFilePath, sourceData);
      message.error("屏柜编辑器初始化失败");
      return;
    }
    try {
      setCabinetNameSequence(await loadCabinetNameSequence(api, drawingFilePath));
    } catch {
      setCabinetNameSequence({ cabinetRowStart: 1, cabinetStart: 1 });
    }
    setCabinetMode(true);
  }, [activeSourcePath, adapter, cabinetMode, clipBounds, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closePathMode, drawingShown, message, renderDrawingLayer]);

  const handleCabinetUndo = useCallback(() => {
    adapter.undoCabinet();
  }, [adapter]);

  const handleCabinetRedo = useCallback(() => {
    adapter.redoCabinet();
  }, [adapter]);

  const handleDrawingSelection = useCallback((selection: SpaceDrawingSelection | null) => {
    void selection;
  }, []);

  const handleDrawingDelete = useCallback(async (selection: SpaceDrawingSelection) => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api || !selectedProject || !modelPath) return;
    const sourceData = drawingLayerData.current.get(selection.layerId);
    if (selection.item.type === "cabinet") {
      const cabinetId = Number(selection.item.id);
      if (!Number.isSafeInteger(cabinetId) || cabinetId <= 0) {
        message.error("当前屏柜缺少可删除的协议编号");
        return;
      }
      try {
        await deleteCabinetItem(api, selectedProject, selection.layerId, cabinetId);
        const items = await loadAllItemsFromJsonInLasCoordinates(api, selection.layerId);
        const data: SpaceDrawingLayer = { areas: items };
        drawingLayerData.current.set(selection.layerId, data);
        renderDrawingLayer(selection.layerId, data);
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
      const items = await loadAllItemsFromJsonInLasCoordinates(api, selection.layerId);
      const data: SpaceDrawingLayer = { areas: items };
      drawingLayerData.current.set(selection.layerId, data);
      renderDrawingLayer(selection.layerId, data);
      setTreeKey((value) => value + 1);
      message.success(selection.item.type === "charging-area" ? "充电区域已删除" : "设备区域已删除");
    } catch (error) {
      message.error(`删除区域失败：${errorMessage(error)}`);
    }
  }, [activeSourcePath, message, renderDrawingLayer, selectedProject]);

  const persistChargingArea = useCallback(async (item: ChargingAreaItem | null) => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      message.warning("充电区域保存仅支持 Electron 模式");
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!modelPath) {
      message.warning("请先加载模型");
      return;
    }
    if (chargingSavingRef.current) return;

    const version = operationVersion.current;
    const session = chargingSession.current;
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
      if (version !== operationVersion.current) return;

      const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return;
      adapter.setChargingAreaDrawingEnabled(false);
      adapter.clearChargingAreaDrawing();
      chargingSession.current = null;
      const data: SpaceDrawingLayer = { areas: items };
      drawingLayerData.current.set(drawingFilePath, data);
      renderDrawingLayer(drawingFilePath, data);
      updateLayerVisibility("drawing", drawingFilePath, true);
      setChargingMode(false);
      setChargingState(DEFAULT_CHARGING_STATE);
      setTreeKey((value) => value + 1);
      message.success(item ? "充电区域保存成功" : "充电区域已删除");
    } catch (error) {
      message.error(`${item ? "保存" : "删除"}充电区域失败: ${errorMessage(error)}`);
    } finally {
      chargingSavingRef.current = false;
      if (version === operationVersion.current) setChargingSaving(false);
    }
  }, [activeSourcePath, adapter, message, renderDrawingLayer, selectedProject, updateLayerVisibility]);

  const handleSaveChargingArea = useCallback(async () => {
    const verts = adapter.getChargingAreaVerts();
    if (!verts) {
      message.warning("请先完成 3 个点的绘制");
      return;
    }
    const item: ChargingAreaItem = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "charging-area",
      geometry: { verts },
      updatedAt: new Date().toISOString(),
    };
    await persistChargingArea(item);
  }, [adapter, message, persistChargingArea]);

  chargingDeleteHandler.current = () => {
    void persistChargingArea(null);
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
      .find((filePath) => sameFilePath(filePath, expectedPath));
    const drawingFilePath = cachedPath || expectedPath;
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    const hasExisting = items.some((item) => item.type === "charging-area")
      || adapter.hasChargingAreaDraft();
    if (hasExisting && !(await confirmReplaceChargingArea())) return;
    if (version !== operationVersion.current) return;

    if (clipBounds) {
      adapter.stopClipping();
      setClipBounds(null);
      setClipProgress(undefined);
    }
    closeCabinetMode();
    closeDeviceAreaMode();
    closePathMode();
    const wasVisible = [...drawingShown].some((filePath) => sameFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    chargingSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    drawingLayerData.current.set(drawingFilePath, sourceData);
    if (wasVisible) {
      renderDrawingLayer(drawingFilePath, sourceData);
    }

    const started = adapter.startChargingAreaDrawing({
      onChange: setChargingState,
      onDelete: () => chargingDeleteHandler.current(),
    });
    if (!started) {
      chargingSession.current = null;
      if (wasVisible) renderDrawingLayer(drawingFilePath, sourceData);
      message.error("充电区域编辑器初始化失败");
      return;
    }
    setChargingMode(true);
  }, [activeSourcePath, adapter, chargingMode, clipBounds, closeCabinetMode, closeDeviceAreaMode, closeChargingMode, closePathMode, drawingShown, message, renderDrawingLayer]);

  const handleChargingHeightChange = useCallback((height: number) => {
    adapter.setChargingAreaHeight(height);
  }, [adapter]);

  const handleChargingUndo = useCallback(() => {
    adapter.undoChargingArea();
  }, [adapter]);

  const handleChargingRedo = useCallback(() => {
    adapter.redoChargingArea();
  }, [adapter]);

  const persistDeviceAreas = useCallback(async (boxes: SpaceDeviceAreaBox[]) => {
    const api = window.electronAPI;
    const modelPath = activeSourcePath;
    if (!api) {
      message.warning("设备区域保存仅支持 Electron 模式");
      return;
    }
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!modelPath) {
      message.warning("请先加载模型");
      return;
    }
    if (deviceAreaSavingRef.current) return;

    const version = operationVersion.current;
    const session = deviceAreaSession.current;
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
      if (version !== operationVersion.current) return;

      const savedItems = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
      if (version !== operationVersion.current) return;
      adapter.setDeviceAreaDrawingEnabled(false);
      adapter.clearDeviceAreaDrawing();
      deviceAreaSession.current = null;
      const data: SpaceDrawingLayer = { areas: savedItems };
      drawingLayerData.current.set(drawingFilePath, data);
      renderDrawingLayer(drawingFilePath, data);
      updateLayerVisibility("drawing", drawingFilePath, true);
      setDeviceAreaMode(false);
      setDeviceAreaState(DEFAULT_DEVICE_AREA_STATE);
      setProjectBoundBayIds(new Set());
      setTreeKey((value) => value + 1);
      message.success(items.length > 0 ? "设备区域保存成功" : "设备区域已删除");
    } catch (error) {
      message.error(`保存设备区域失败: ${errorMessage(error)}`);
    } finally {
      deviceAreaSavingRef.current = false;
      if (version === operationVersion.current) setDeviceAreaSaving(false);
    }
  }, [activeSourcePath, adapter, message, renderDrawingLayer, selectedProject, updateLayerVisibility]);

  const handleSaveDeviceAreas = useCallback(async () => {
    await persistDeviceAreas(adapter.getDeviceAreaBoxes());
  }, [adapter, persistDeviceAreas]);

  deviceAreaDeleteHandler.current = () => {
    void persistDeviceAreas(adapter.getDeviceAreaBoxes());
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

    const version = operationVersion.current;
    const expectedPath = mapSiblingFilePath(activeSourcePath, DRAWING_FILE_NAME);
    const cachedPath = [...drawingLayerData.current.keys()]
      .find((filePath) => sameFilePath(filePath, expectedPath));
    const drawingFilePath = cachedPath || expectedPath;
    const items = await loadAllItemsFromJsonInLasCoordinates(api, drawingFilePath);
    if (version !== operationVersion.current) return;
    if (clipBounds) {
      adapter.stopClipping();
      setClipBounds(null);
      setClipProgress(undefined);
    }
    closeCabinetMode();
    closeChargingMode();
    closePathMode();
    const wasVisible = [...drawingShown].some((filePath) => sameFilePath(filePath, drawingFilePath));
    const sourceData: SpaceDrawingLayer = { areas: items };
    deviceAreaSession.current = { filePath: drawingFilePath, sourceData, wasVisible };
    drawingLayerData.current.set(drawingFilePath, sourceData);
    if (wasVisible) {
      renderDrawingLayer(drawingFilePath, sourceData);
    }

    const started = adapter.startDeviceAreaDrawing({
      onChange: setDeviceAreaState,
      onDelete: () => deviceAreaDeleteHandler.current(),
    });
    if (!started) {
      deviceAreaSession.current = null;
      if (wasVisible) renderDrawingLayer(drawingFilePath, sourceData);
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
  }, [activeSourcePath, adapter, clipBounds, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closePathMode, deviceAreaMode, drawingShown, message, renderDrawingLayer, selectedProject]);

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

  useEffect(() => {
    adapter.setRenderSettings(renderSettings);
    try {
      window.localStorage.setItem(RENDER_SETTINGS_STORAGE_KEY, JSON.stringify(renderSettings));
    } catch {
      // Rendering still works when storage is unavailable.
    }
  }, [adapter, renderSettings]);

  useEffect(() => {
    const mode = cabinetMode ? "cabinet" : chargingMode ? "charging" : deviceAreaMode ? "device-area" : pathMode ? "path" : "idle";
    (window as Window & { __spaceEditInteractionMode?: string }).__spaceEditInteractionMode = mode;
    return () => {
      const state = window as Window & { __spaceEditInteractionMode?: string };
      if (state.__spaceEditInteractionMode === mode) state.__spaceEditInteractionMode = "idle";
    };
  }, [cabinetMode, chargingMode, deviceAreaMode, pathMode]);

  useEffect(() => {
    adapter.setDrawingInteractionCallbacks({
      onSelect: handleDrawingSelection,
      onDelete: (selection) => { void handleDrawingDelete(selection); },
    });
    return () => adapter.setDrawingInteractionCallbacks(null);
  }, [adapter, handleDrawingDelete, handleDrawingSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
        if (cabinetMode) isUndo ? handleCabinetUndo() : handleCabinetRedo();
        else if (deviceAreaMode) isUndo ? handleDeviceAreaUndo() : handleDeviceAreaRedo();
        else if (chargingMode) isUndo ? handleChargingUndo() : handleChargingRedo();
        else if (pathMode) isUndo ? handlePathUndo() : handlePathRedo();
        return;
      }

      const saveShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "s";
      const hasCabinetDraft = cabinetMode && adapter.hasCabinetDraft();
      const hasDeviceDraft = deviceAreaMode && adapter.hasDeviceAreaDraft();
      const hasChargingDraft = chargingMode && adapter.hasChargingAreaDraft();
      // Path saving also needs to support deleting the last point and writing
      // an empty reference_path.txt.
      const hasPathDraft = pathMode;
      if (!saveShortcut || (!hasCabinetDraft && !hasDeviceDraft && !hasChargingDraft && !hasPathDraft)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (hasCabinetDraft) {
        void persistCabinet(cabinetDraftRef.current);
      } else if (hasDeviceDraft) {
        void handleSaveDeviceAreas();
      } else if (hasChargingDraft) {
        void handleSaveChargingArea();
      } else if (hasPathDraft) {
        void persistPath();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [
    adapter,
    cabinetMode,
    chargingMode,
    deviceAreaMode,
    handleCabinetRedo,
    handleCabinetUndo,
    handleChargingRedo,
    handleChargingUndo,
    handleDeviceAreaRedo,
    handleDeviceAreaUndo,
    handlePathRedo,
    handlePathUndo,
    handleSaveChargingArea,
    handleSaveDeviceAreas,
    pathMode,
    persistCabinet,
    persistPath,
  ]);

  useEffect(() => {
    operationVersion.current += 1;
    modelBusyRef.current = false;
    setActiveModelPath(null);
    setActiveSourcePath(null);
    setClipBounds(null);
    setClipSaving(false);
    setClipProgress(undefined);
    setLoading(null);
    clearDrawingVisibility();
    adapter.clearModel();
  }, [adapter, clearDrawingVisibility, selectedProject]);

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
    return api.onClipProgress((progress) => {
      setLoading((current) => {
        if (current?.kind !== "clip" || !current.modelPath || progress.projectName !== selectedProject) return current;
        if (loadedFileKey(current.modelPath) !== loadedFileKey(progress.modelPath)) return current;
        setClipProgress(progress.percent);
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

  const loadModel = useCallback(async (item: MapModelItem) => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (modelBusyRef.current) {
      message.warning("模型正在导入或加载中，请稍后再试");
      return;
    }
    const api = window.electronAPI?.potree;
    if (!api) {
      message.error("点云转换仅支持 Electron 模式");
      return;
    }

    modelBusyRef.current = true;
    adapter.stopClipping();
    setClipBounds(null);
    const version = ++operationVersion.current;
    setLoading({ kind: "model", modelPath: item.modelPath, title: item.mapName, message: "正在检查 Potree 数据", percent: 2 });

    try {
      const result = await api.ensureModel(selectedProject, item.modelPath);
      if (version !== operationVersion.current) return;
      clearDrawingVisibility();
      setLoading({ kind: "model", modelPath: item.modelPath, title: item.mapName, message: "正在加载点云层级", percent: 98 });
      await adapter.loadModel({ name: item.mapName, metadataUrl: result.metadataUrl, clipBounds: result.bounds });
      if (version !== operationVersion.current) return;
      setActiveModelPath(item.modelPath);
      setActiveSourcePath(result.modelPath);
      await loadModelCompanionFiles(result.modelPath);
      if (result.generated) message.success("模型转换并加载完成");
    } catch (error) {
      if (version === operationVersion.current) message.error(errorMessage(error));
    } finally {
      if (version === operationVersion.current) setLoading(null);
      modelBusyRef.current = false;
    }
  }, [adapter, clearDrawingVisibility, loadModelCompanionFiles, message, selectedProject]);

  const clearModel = useCallback((modelPath?: string) => {
    if (modelPath && activeModelPath && loadedFileKey(modelPath) !== loadedFileKey(activeModelPath)) return;
    operationVersion.current += 1;
    modelBusyRef.current = false;
    adapter.clearModel();
    setActiveModelPath(null);
    setActiveSourcePath(null);
    setClipBounds(null);
    setClipSaving(false);
    setClipProgress(undefined);
    setLoading(null);
    clearDrawingVisibility();
  }, [activeModelPath, adapter, clearDrawingVisibility]);

  const handleLoadFromTree = useCallback(async (modelPath: string) => {
    await loadModel({ mapName: mapNameFromModelPath(modelPath), modelPath });
  }, [loadModel]);

  const handleToggleFromTree = useCallback((modelPath: string) => {
    if (activeModelPath && loadedFileKey(activeModelPath) === loadedFileKey(modelPath)) {
      clearModel(modelPath);
      return;
    }
    void handleLoadFromTree(modelPath);
  }, [activeModelPath, clearModel, handleLoadFromTree]);

  const handleImport = useCallback(async (file: File) => {
    if (!selectedProject) return;
    if (modelBusyRef.current) {
      message.warning("模型正在导入或加载中，请稍后再试");
      return;
    }
    const electronApi = window.electronAPI;
    const sourcePath = electronApi?.getFilePath(file);
    if (!electronApi?.project || !sourcePath) {
      message.error("无法读取导入文件路径");
      return;
    }

    modelBusyRef.current = true;
    const version = ++operationVersion.current;
    setLoading({ kind: "model", modelPath: null, title: file.name, message: "正在导入模型" });
    try {
      let modelPath: string;
      let mapName: string;
      if (isZipFileName(file.name)) {
        const plan = await electronApi.project.inspectModelZipImport(selectedProject, sourcePath);
        if (plan.willReplace && !(await confirmReplaceModel(plan))) return;
        adapter.clearModel();
        clearDrawingVisibility();
        setActiveModelPath(null);
        setActiveSourcePath(null);
        setClipBounds(null);
        const result = await electronApi.project.importModelZip(selectedProject, sourcePath);
        modelPath = result.modelPath;
        mapName = result.mapName;
      } else {
        adapter.clearModel();
        clearDrawingVisibility();
        setActiveModelPath(null);
        setActiveSourcePath(null);
        setClipBounds(null);
        mapName = stripModelExtension(file.name);
        modelPath = await electronApi.project.importFile(selectedProject, sourcePath, file.name);
      }

      if (version !== operationVersion.current) return;
      setTreeKey((value) => value + 1);
      modelBusyRef.current = false;
      await loadModel({ mapName, modelPath });
    } catch (error) {
      if (version === operationVersion.current) message.error(errorMessage(error));
    } finally {
      if (version === operationVersion.current) setLoading(null);
      modelBusyRef.current = false;
    }
  }, [adapter, clearDrawingVisibility, loadModel, message, selectedProject]);

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

  const handleClip = useCallback(() => {
    if (!activeModelPath || !activeSourcePath) {
      message.warning("请先加载模型");
      return;
    }
    if (modelBusyRef.current) {
      message.warning("模型正在处理中，请稍后再试");
      return;
    }
    closeCabinetMode();
    closeChargingMode();
    closeDeviceAreaMode();
    closePathMode();
    const initialBounds = adapter.startClipping((bounds) => setClipBounds(bounds));
    if (!initialBounds) {
      message.error("无法读取当前模型范围");
      return;
    }
    setClipBounds(initialBounds);
    setClipProgress(undefined);
  }, [activeModelPath, activeSourcePath, adapter, closeCabinetMode, closeChargingMode, closeDeviceAreaMode, closePathMode, message]);

  const handleClipBoundsChange = useCallback((bounds: SpaceClipBounds) => {
    setClipBounds(bounds);
    adapter.setClipBounds(bounds);
  }, [adapter]);

  const handleClipCancel = useCallback(() => {
    if (clipSaving) return;
    adapter.stopClipping();
    setClipBounds(null);
    setClipProgress(undefined);
  }, [adapter, clipSaving]);

  const handleClipConfirm = useCallback(async () => {
    if (!clipBounds || !activeSourcePath || !selectedProject) return;
    const api = window.electronAPI?.potree;
    if (!api) {
      message.error("模型裁切仅支持 Electron 模式");
      return;
    }
    if (modelBusyRef.current) return;

    modelBusyRef.current = true;
    setClipSaving(true);
    setClipProgress(0);
    const version = ++operationVersion.current;
    setLoading({
      kind: "clip",
      modelPath: activeSourcePath,
      title: "正在裁切模型",
      message: "正在读取 LAS 点数据",
      percent: 0,
    });

    try {
      const result = await api.clipModel(selectedProject, activeSourcePath, clipBounds);
      if (version !== operationVersion.current) return;
      adapter.stopClipping();
      setClipBounds(null);
      setTreeKey((value) => value + 1);
      modelBusyRef.current = false;
      setLoading(null);
      await loadModel({ mapName: result.mapName, modelPath: result.modelPath });
      message.success(`裁切完成，保留 ${result.pointCount.toLocaleString()} 个点`);
    } catch (error) {
      if (version === operationVersion.current) message.error(`裁切失败: ${errorMessage(error)}`);
    } finally {
      if (version === operationVersion.current) setLoading(null);
      setClipSaving(false);
      setClipProgress(undefined);
      modelBusyRef.current = false;
    }
  }, [activeSourcePath, adapter, clipBounds, loadModel, message, selectedProject]);

  return (
    <>
      <SpaceEditLayout
        containerRef={containerRef}
        resizing={resizing}
        onResizeStart={onResizeStart}
        toolbar={(
          <Toolbar
            onOpenLoadModel={() => setImportOpen(true)}
            onClipModel={handleClip}
            cabinetMode={cabinetMode}
            onToggleCabinet={() => void handleToggleCabinet()}
            chargingMode={chargingMode}
            onToggleCharging={() => void handleToggleCharging()}
            deviceAreaMode={deviceAreaMode}
            onToggleDeviceArea={() => void handleToggleDeviceArea()}
            pathMode={pathMode}
            onTogglePath={() => void handleTogglePathMode()}
            onUndo={cabinetMode ? handleCabinetUndo : deviceAreaMode ? handleDeviceAreaUndo : chargingMode ? handleChargingUndo : handlePathUndo}
            onRedo={cabinetMode ? handleCabinetRedo : deviceAreaMode ? handleDeviceAreaRedo : chargingMode ? handleChargingRedo : handlePathRedo}
            canUndo={cabinetMode ? cabinetState.canUndo : deviceAreaMode ? deviceAreaState.canUndo : chargingMode ? chargingState.canUndo : pathState.canUndo}
            canRedo={cabinetMode ? cabinetState.canRedo : deviceAreaMode ? deviceAreaState.canRedo : chargingMode ? chargingState.canRedo : pathState.canRedo}
            onSaveAll={() => {
              if (cabinetMode && adapter.hasCabinetDraft()) void persistCabinet(cabinetDraftRef.current);
              else if (deviceAreaMode && adapter.hasDeviceAreaDraft()) void handleSaveDeviceAreas();
              else if (chargingMode && adapter.hasChargingAreaDraft()) void handleSaveChargingArea();
              else if (pathMode) void persistPath();
              else notifyPending("保存全部");
            }}
            onImportPointTable={handleImportPointTable}
            onExportModel={() => setExportOpen(true)}
            importing={pointImporting}
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
            onCabinetCheck={(bayIds) => { void handleCabinetCheck(bayIds); }}
            mapDrawingShown={drawingShown}
            onToggleDrawing={(filePath, checked) => void handleToggleDrawing(filePath, checked)}
            mapPathShown={pathShown}
            onTogglePath={(filePath, checked) => void handleTogglePath(filePath, checked)}
          />
        )}
        scene={(
          <SpaceSceneHost
            adapterFactory={adapterFactory}
            overlay={(
              <>
                {loading ? (
                  <ModelLoadingOverlay {...loading} />
                ) : !activeModelPath ? (
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
                <PotreeRenderSettings settings={renderSettings} onChange={setRenderSettings} />
                {cabinetMode && (
                  <CabinetPanel
                    cornerCount={cabinetState.cornerCount}
                    cabinetCount={cabinetState.cabinetCount}
                    nameSequence={cabinetNameSequence}
                    onClose={closeCabinetMode}
                    onSave={(data) => void persistCabinet(data)}
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
                    onSave={() => void handleSaveChargingArea()}
                    onSetHeight={handleChargingHeightChange}
                    saving={chargingSaving}
                  />
                )}
                {deviceAreaMode && (
                  <DeviceAreaPanel
                    boxCount={deviceAreaState.boxCount}
                    height={deviceAreaState.height}
                    selectedBoxId={deviceAreaState.selectedBoxId}
                    selectedBoxBay={deviceAreaState.selectedBoxBay}
                    boundBayIds={new Set([
                      ...deviceAreaState.boundBayIds,
                      ...projectBoundBayIds,
                    ])}
                    onClose={closeDeviceAreaMode}
                    onSave={() => void handleSaveDeviceAreas()}
                    onSetHeight={handleDeviceAreaHeightChange}
                    onBindBay={handleDeviceAreaBindBay}
                    onUnbind={handleDeviceAreaUnbind}
                    saving={deviceAreaSaving}
                  />
                )}
                {clipBounds && (
                  <PotreeClipController
                    bounds={clipBounds}
                    saving={clipSaving}
                    progress={clipProgress}
                    onChange={handleClipBoundsChange}
                    onConfirm={() => void handleClipConfirm()}
                    onCancel={handleClipCancel}
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
