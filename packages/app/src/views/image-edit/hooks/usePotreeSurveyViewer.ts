import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PotreeSpaceSceneAdapter } from "@/views/space-edit/workspace/engine/PotreeSpaceSceneAdapter";
import { useSpaceSceneHost } from "@/views/space-edit/workspace/engine/useSpaceSceneHost";
import type {
  SpaceRenderSettings,
  SpaceDrawingLayer,
  SpaceDrawingSelection,
  SpaceSceneAdapterFactory,
} from "@/views/space-edit/workspace/engine/types";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  migrateSpaceRenderSettings,
  normalizeSpaceRenderSettings,
} from "@/views/space-edit/workspace/engine/types";
import {
  loadAllItemsFromJsonInLasCoordinates,
  loadPathDrawingInLasCoordinates,
} from "@/views/space-edit/hooks/drawing/drawing-storage";
import { loadedFileKey } from "@/views/space-edit/utils/space-paths";
import type { RayRenderData, RayRenderItem } from "@/space-model/drawing-data";

export interface PotreeSurveySelectInfo {
  type: "cabinet" | "device-area" | "charging-area";
  bayId: number;
}

interface UsePotreeSurveyViewerOptions {
  selectedProject?: string | null;
  onSelect?: (info: PotreeSurveySelectInfo) => void;
  active?: boolean;
}

interface LoadSurveyModelOptions {
  mapName: string;
  modelPath: string;
}

const SURVEY_RAY_LAYER_ID = "__survey-image-rays__";
const POTREE_RENDER_SETTINGS_STORAGE_KEY = "space-edit:potree-render-settings";

function loadRenderSettings(): SpaceRenderSettings {
  try {
    const saved = window.localStorage.getItem(POTREE_RENDER_SETTINGS_STORAGE_KEY);
    if (!saved) return { ...DEFAULT_SPACE_RENDER_SETTINGS };
    return migrateSpaceRenderSettings(
      normalizeSpaceRenderSettings(JSON.parse(saved) as Partial<SpaceRenderSettings>),
    );
  } catch {
    return { ...DEFAULT_SPACE_RENDER_SETTINGS };
  }
}

function selectionToInfo(selection: SpaceDrawingSelection | null): PotreeSurveySelectInfo | null {
  const item = selection?.item;
  if (!item) return null;
  if (item.type === "device-area") {
    return { type: item.type, bayId: item.bay?.id ?? 0 };
  }
  if (item.type === "cabinet") {
    const cabinetBay = item.cabinets.find((cabinet) => cabinet.bay?.id)?.bay;
    return { type: item.type, bayId: item.bay?.id ?? cabinetBay?.id ?? 0 };
  }
  return { type: item.type, bayId: 0 };
}

function ensureElectronApi(): NonNullable<Window["electronAPI"]> {
  const api = window.electronAPI;
  if (!api) throw new Error("勘察地图仅支持 Electron 模式");
  return api;
}

export function usePotreeSurveyViewer({ selectedProject, onSelect, active = true }: UsePotreeSurveyViewerOptions) {
  const adapter = useMemo(() => new PotreeSpaceSceneAdapter(), []);
  const adapterFactory = useMemo<SpaceSceneAdapterFactory>(() => () => adapter, [adapter]);
  const { hostRef, state, error } = useSpaceSceneHost(adapterFactory, active);
  const [modelLoading, setModelLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState("");
  const [progress, setProgress] = useState(0);
  const [renderSettings, setRenderSettings] = useState<SpaceRenderSettings>(loadRenderSettings);
  const loadVersion = useRef(0);
  const loadingModelPathRef = useRef("");

  useEffect(() => {
    adapter.setDrawingInteractionCallbacks({
      onSelect: (selection) => {
        const info = selectionToInfo(selection);
        if (info) onSelect?.(info);
      },
      onDelete: () => undefined,
    });
    return () => adapter.setDrawingInteractionCallbacks(null);
  }, [adapter, onSelect]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.potree?.onConversionProgress((next) => {
      if (next.projectName !== selectedProject) return;
      if (!loadingModelPathRef.current || loadedFileKey(next.modelPath) !== loadedFileKey(loadingModelPathRef.current)) return;
      setLoadingFile(next.message || "正在准备 Potree 数据");
      setProgress(Math.max(0, Math.min(100, Math.round(next.percent))));
    });
    return () => unsubscribe?.();
  }, [selectedProject]);

  useEffect(() => {
    adapter.setRenderSettings(renderSettings);
    try {
      window.localStorage.setItem(POTREE_RENDER_SETTINGS_STORAGE_KEY, JSON.stringify(renderSettings));
    } catch {
      // Rendering still works when storage is unavailable.
    }
  }, [adapter, renderSettings]);

  const clearRays = useCallback(() => {
    adapter.removeDrawingLayer(SURVEY_RAY_LAYER_ID);
  }, [adapter]);

  const clear = useCallback(() => {
    loadVersion.current += 1;
    loadingModelPathRef.current = "";
    adapter.clearModel();
    setModelLoading(false);
    setLoadingFile("");
    setProgress(0);
  }, [adapter]);

  const loadModel = useCallback(async ({ mapName, modelPath }: LoadSurveyModelOptions): Promise<string | null> => {
    if (!selectedProject) throw new Error("请先选择项目");
    const api = ensureElectronApi();
    if (!api.potree) throw new Error("Potree 点云转换仅支持 Electron 模式");

    const version = ++loadVersion.current;
    loadingModelPathRef.current = modelPath;
    setModelLoading(true);
    setLoadingFile("正在检查 Potree 数据");
    setProgress(2);

    try {
      const result = await api.potree.ensureModel(selectedProject, modelPath);
      if (version !== loadVersion.current) return null;
      setLoadingFile("正在加载点云层级");
      setProgress(98);
      await adapter.loadModel({ name: mapName, metadataUrl: result.metadataUrl, clipBounds: result.bounds });
      if (version !== loadVersion.current) return null;
      setProgress(100);
      return result.modelPath;
    } finally {
      if (version === loadVersion.current) {
        loadingModelPathRef.current = "";
        setModelLoading(false);
        setLoadingFile("");
        setProgress(0);
      }
    }
  }, [adapter, selectedProject]);

  const setLayerData = useCallback((layerId: string, data: SpaceDrawingLayer) => {
    adapter.setDrawingLayer(layerId, data);
  }, [adapter]);

  const loadDrawing = useCallback(async (jsonPath: string) => {
    const api = ensureElectronApi();
    const items = await loadAllItemsFromJsonInLasCoordinates(api, jsonPath);
    adapter.setDrawingLayer(jsonPath, { areas: items });
  }, [adapter]);

  const loadPath = useCallback(async (pathFilePath: string) => {
    const api = ensureElectronApi();
    const path = await loadPathDrawingInLasCoordinates(api, pathFilePath);
    adapter.setDrawingLayer(pathFilePath, { path });
  }, [adapter]);

  const showRays = useCallback((data: RayRenderData | null) => {
    if (!data || data.rays.length === 0) {
      clearRays();
      return;
    }
    adapter.setDrawingLayer(SURVEY_RAY_LAYER_ID, { rays: data.rays });
  }, [adapter, clearRays]);

  const showRay = useCallback((ray: RayRenderItem | null) => {
    showRays(ray ? { rays: [ray] } : null);
  }, [showRays]);

  const focusAlongDirection = useCallback((
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    extent: number,
  ) => {
    adapter.focusAlongDirection(cx, cy, cz, dx, dy, dz, extent);
  }, [adapter]);

  const loading = modelLoading || state === "mounting";
  const displayLoadingFile = state === "mounting"
    ? "正在初始化 Potree 场景"
    : loadingFile;

  return {
    hostRef,
    state,
    error,
    loading,
    loadingFile: displayLoadingFile,
    progress,
    clear,
    clearRays,
    focusAlongDirection,
    loadDrawing,
    loadModel,
    loadPath,
    renderSettings,
    setLayerData,
    setRenderSettings,
    showRay,
    showRays,
  };
}
