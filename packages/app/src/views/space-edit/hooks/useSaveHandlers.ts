import { useCallback, useRef, useEffect } from "react";
import * as pc from "playcanvas";
import { loadChargingArea, saveCabinetDrawing, saveChargingArea, saveDeviceAreas, savePathDrawing, DRAWING_FILE_NAME, PATH_FILE_NAME, type CabinetItem, type ChargingAreaItem, type DeviceAreaItem, type DrawingType, type PathData } from "../hooks/drawing/drawing-storage";
import { isPathStartInChargingArea, orderedPathPoints, PATH_START_CHARGING_AREA_MESSAGE } from "./drawing/path-codec";
import type { SaveStatus, SpaceMessageApi } from "../types";
import { getCurrentModelPathFromRefs } from "../utils/model-state";
import { mapSiblingFilePath } from "../utils/space-paths";
import { useSelectedProject } from "@/stores/appContextStore";

interface UseSaveHandlersParams {
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  isAutoSavingRef: React.MutableRefObject<boolean>;
  saveStatusSetter: React.Dispatch<React.SetStateAction<SaveStatus>>;
  message: SpaceMessageApi;
  /** 屏柜保存后回显：设置此 ref 供 cabinetMode useEffect 消费 */
  savedCabinetRef: React.MutableRefObject<{ item: CabinetItem; jsonPath: string } | null>;
  /** 屏柜绘制相关 */
  getCabinetGeometry: () => { verts: number[][]; splits: number[] } | null;
  clearCabinetDraft?: () => void;
  handleToggleCabinet: () => void;
  onCabinetSaved?: () => void;
  /** 充电区域相关 */
  chargingDrawingRef: React.MutableRefObject<any>;
  chargingMode: boolean;
  handleToggleCharging: () => void;
  /** 设备区相关 */
  getBoxDatas: () => { id: string; verts: number[][]; height: number; bay: any }[];
  markDeviceAreaSaved: () => void;
  /** 路径相关 */
  getPathData: () => PathData | null;
  onDrawingFileSaved?: (jsonPath: string, type: DrawingType) => void;
  onPathFileSaved?: (jsonPath: string) => void;
}

interface CabinetDeviceInput {
  key?: string;
  code: string;
  name: string;
}

interface CabinetSaveData {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  cabinetRow?: CabinetDeviceInput | null;
  rows: CabinetDeviceInput[];
}

export function useSaveHandlers(params: UseSaveHandlersParams) {
  const selectedProject = useSelectedProject();
  const { entitiesRef, filePathRef, isAutoSavingRef, saveStatusSetter, message } = params;

  const getDrawingJsonPath = (modelPath: string) => mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
  const getPathJsonPath = (modelPath: string) => mapSiblingFilePath(modelPath, PATH_FILE_NAME);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSavedStatus = useCallback(() => {
    saveStatusSetter("saved");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => {
      saveStatusSetter("idle");
      saveStatusTimerRef.current = null;
    }, 2000);
  }, [saveStatusSetter]);

  useEffect(() => () => {
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
  }, []);

  /** 当前绘制模型路径：优先可见且有路径的模型 */
  const getCurrentModelPath = useCallback((): string => {
    return getCurrentModelPathFromRefs(entitiesRef.current, filePathRef.current);
  }, [entitiesRef, filePathRef]);

  const saveCabinetMainDevices = useCallback(async (
    api: NonNullable<Window["electronAPI"]>,
    projectName: string,
    data: CabinetSaveData,
  ): Promise<void> => {
    const devices = [
      ...(data.cabinetRow ? [data.cabinetRow] : []),
      ...data.rows,
    ].map((row) => ({
      ...row,
      code: row.code.trim(),
      name: row.name.trim(),
    }));
    const result = await api.saveCabinetMainDevices(projectName, { area: data.area, bay: data.bay, rows: devices });
    if (!result || result.total !== devices.length || result.ids.length !== devices.length) {
      throw new Error("屏柜主设备保存结果异常，请重试");
    }
  }, []);

  /** 保存屏柜 */
  const handleSaveCabinet = useCallback(async (data: CabinetSaveData) => {
    const api = window.electronAPI;
    if (!api) { message.warning("仅 Electron 模式下可保存"); return; }
    if (!selectedProject) { message.warning("请先选择项目"); return; }
    const geometry = params.getCabinetGeometry();
    if (!geometry) { message.warning("请先完成屏柜绘制（四点成体）"); return; }

    const modelPath = getCurrentModelPath();
    if (!modelPath) { message.warning("未找到绘制模型，无法保存"); return; }

    const rows = data.rows.map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() }));
    const requiresCabinetRow = (geometry.splits || []).length > 0 || rows.length > 1;
    const cabinetRow = requiresCabinetRow && data.cabinetRow
      ? { ...data.cabinetRow, code: data.cabinetRow.code.trim(), name: data.cabinetRow.name.trim() }
      : null;
    const devices = cabinetRow ? [cabinetRow, ...rows] : rows;
    if (rows.length === 0) { message.warning("请先完成屏柜分隔"); return; }
    if (requiresCabinetRow && !cabinetRow) { message.warning("请填写柜排信息"); return; }
    if (devices.some((r) => !r.name)) { message.warning("屏柜/柜排名称不能为空"); return; }
    if (devices.some((r) => !r.code)) { message.warning("屏柜/柜排编号不能为空"); return; }
    const duplicateName = devices.find((row, index) => devices.findIndex((item) => item.name === row.name) !== index);
    if (duplicateName) { message.warning(`屏柜/柜排名称重复：${duplicateName.name}`); return; }
    const duplicateCode = devices.find((row, index) => devices.findIndex((item) => item.code === row.code) !== index);
    if (duplicateCode) { message.warning(`屏柜/柜排编号重复：${duplicateCode.code}`); return; }

    const item: CabinetItem = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "cabinet",
      area: data.area,
      bay: data.bay,
      cabinetRow: cabinetRow ? { code: cabinetRow.code, name: cabinetRow.name } : null,
      geometry,
      cabinets: rows.map((r) => ({ code: r.code, name: r.name })),
      updatedAt: new Date().toISOString(),
    };
    try {
      saveStatusSetter("saving");
      await saveCabinetMainDevices(api, selectedProject, { ...data, cabinetRow, rows });
      const savedItem = await saveCabinetDrawing({ api, projectName: selectedProject, modelPath, item });
      const jsonPath = getDrawingJsonPath(modelPath);
      // 屏柜保存后立即回显给 CabinetViewer。这里用 ref 暂存，等绘制模式关闭后再 show，
      // 避免编辑态线框和只读回显线框重叠。
      params.savedCabinetRef.current = { item: savedItem, jsonPath };
      params.onDrawingFileSaved?.(jsonPath, "cabinet");
      showSavedStatus();
      params.clearCabinetDraft?.();
      params.onCabinetSaved?.();
      params.handleToggleCabinet();
    } catch (e: any) {
      saveStatusSetter("idle");
      message.error("保存失败: " + (e?.message || e));
    }
  }, [getCurrentModelPath, message, params, saveCabinetMainDevices, saveStatusSetter, selectedProject, showSavedStatus]);

  /** 保存充电区域 */
  const handleSaveChargingArea = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) { if (!isAutoSavingRef.current) message.warning("仅 Electron 模式下可保存"); return; }
    if (!selectedProject) { if (!isAutoSavingRef.current) message.warning("请先选择项目"); return; }
    const drawing = params.chargingDrawingRef.current;
    if (!drawing) return;
    const verts = drawing.getBoxVerts();

    const modelPath = getCurrentModelPath();
    if (!modelPath) return;

    // 充电区域是单例；没有 verts 时传 null，持久化层会删除旧记录。
    const item: ChargingAreaItem | null = verts ? {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "charging-area",
      geometry: { verts },
      updatedAt: new Date().toISOString(),
    } : null;

    try {
      await saveChargingArea({ api, projectName: selectedProject, modelPath, item });
      if (item) params.onDrawingFileSaved?.(getDrawingJsonPath(modelPath), "charging-area");
      if (!isAutoSavingRef.current) showSavedStatus();
      if (params.chargingMode) params.handleToggleCharging();
    } catch (e: any) {
      message.error("保存充电区失败: " + (e?.message || e));
    }
  }, [getCurrentModelPath, isAutoSavingRef, message, params, selectedProject, showSavedStatus]);

  /** 保存设备区 */
  const handleSaveDeviceAreas = useCallback(async () => {
    const silent = isAutoSavingRef.current;
    const api = window.electronAPI;
    if (!api) { if (!silent) message.warning("仅 Electron 模式下可保存"); return; }
    if (!selectedProject) { if (!silent) message.warning("请先选择项目"); return; }
    const datas = params.getBoxDatas();

    const modelPath = getCurrentModelPath();
    if (!modelPath) { if (!silent) message.warning("未找到模型路径，无法保存"); return; }

    // 设备区可多个，每个框可绑定一个间隔；保存时整体替换当前 JSON 中的 device-area 集合。
    const items: DeviceAreaItem[] = datas.map((d) => ({
      id: d.id,
      type: "device-area" as const,
      geometry: { verts: d.verts },
      height: d.height,
      bay: d.bay,
      updatedAt: new Date().toISOString(),
    }));

    try {
      await saveDeviceAreas({ api, projectName: selectedProject, modelPath, items });
      if (items.length > 0) params.onDrawingFileSaved?.(getDrawingJsonPath(modelPath), "device-area");
      if (!silent) showSavedStatus();
      params.markDeviceAreaSaved();
    } catch (e: any) {
      message.error("保存设备区失败: " + (e?.message || e));
    }
  }, [getCurrentModelPath, isAutoSavingRef, message, params, selectedProject, showSavedStatus]);

  const savePathInternal = useCallback(async (showError: boolean): Promise<boolean> => {
    const api = window.electronAPI;
    if (!api) { if (showError) message.warning("仅 Electron 模式下可保存"); return false; }
    if (!selectedProject) { if (showError) message.warning("请先选择项目"); return false; }
    const data = params.getPathData();
    if (!data) return true;
    const modelPath = getCurrentModelPath();
    if (!modelPath) { if (showError) message.warning("未找到模型路径，无法保存"); return false; }
    try {
      await savePathDrawing({ api, projectName: selectedProject, modelPath, data });
      params.onPathFileSaved?.(getPathJsonPath(modelPath));
      return true;
    } catch (e: any) {
      if (showError) {
        const errorMessage = e?.message || String(e);
        if (errorMessage === PATH_START_CHARGING_AREA_MESSAGE) message.warning(errorMessage);
        else message.error("保存路径失败: " + errorMessage);
      }
      return false;
    }
  }, [message, params, getCurrentModelPath, selectedProject]);

  /** 保存可行路径 */
  const handleSavePath = useCallback(async () => {
    await savePathInternal(!isAutoSavingRef.current);
  }, [isAutoSavingRef, savePathInternal]);

  // handleSaveAll 会被定时器调用。用 ref 保存最新函数，避免定时器闭包拿到旧状态。
  const handleSaveAllRef = useRef<() => Promise<void>>(async () => {});

  /** 保存全部：充电区域 + 设备区 + 可行路径（屏柜已单独保存到JSON） */
  const handleSaveAll = useCallback(async () => {
    const silent = isAutoSavingRef.current;
    const drawing = params.chargingDrawingRef.current;
    const hasCharging = drawing?.hasBox();
    const hasDeviceAreas = params.getBoxDatas().length > 0;
    const pathData = params.getPathData();
    const hasPath = !!pathData;
    const modelPath = getCurrentModelPath();

    // 自动保存时：无任何数据且 JSON 文件不存在 → 不创建空文件。
    // 这样新项目只打开地图不会生成空的 description_file.json。
    if (silent && !hasCharging && !hasDeviceAreas && !hasPath) {
      if (!modelPath) {
        isAutoSavingRef.current = false;
        return;
      }
      try {
        const buf = await window.electronAPI?.readLargeFile?.(getDrawingJsonPath(modelPath));
        if (!buf) {
          isAutoSavingRef.current = false;
          return;
        }
      } catch {
        isAutoSavingRef.current = false;
        return; // JSON 不存在，跳过自动保存
      }
    }

    // 路径依赖充电区域，先校验再写任何文件，避免保存到一半才失败。
    if (pathData && modelPath && window.electronAPI) {
      try {
        const orderedPoints = orderedPathPoints(pathData);
        if (orderedPoints.length > 0) {
          const verts = drawing?.getBoxVerts();
          const chargingArea: ChargingAreaItem | null = verts ? {
            id: "current",
            type: "charging-area",
            geometry: { verts },
            updatedAt: "",
          } : await loadChargingArea(window.electronAPI, modelPath);
          if (!isPathStartInChargingArea(orderedPoints[0], chargingArea)) {
            isAutoSavingRef.current = false;
            if (!silent) message.warning(PATH_START_CHARGING_AREA_MESSAGE);
            return;
          }
        }
      } catch (e: any) {
        isAutoSavingRef.current = false;
        if (!silent) message.error("保存路径失败: " + (e?.message || e));
        return;
      }
    }

    if (!silent) saveStatusSetter("saving");
    isAutoSavingRef.current = true;
    let pathSaved = false;
    try {
      if (hasCharging) await handleSaveChargingArea();
      await handleSaveDeviceAreas();
      pathSaved = await savePathInternal(!silent);
    } finally {
      isAutoSavingRef.current = false;
    }
    if (!pathSaved) {
      if (!silent) saveStatusSetter("idle");
      return;
    }
    if (!silent) {
      showSavedStatus();
    }
  }, [handleSaveChargingArea, handleSaveDeviceAreas, savePathInternal, isAutoSavingRef, saveStatusSetter, showSavedStatus, params, getCurrentModelPath]);
  handleSaveAllRef.current = handleSaveAll;

  // 自动保存只负责同步当前编辑态几何，不弹成功提示；手动保存才更新 SaveStatusBadge。
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSaveEnabledRef = useRef(false);

  /** 重置自动保存计时器（手动保存后调用） */
  const resetAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setInterval(() => {
        if (!autoSaveEnabledRef.current) return;
        isAutoSavingRef.current = true;
        handleSaveAllRef.current();
      }, 30000);
    }
  }, [isAutoSavingRef]);

  const startAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    autoSaveEnabledRef.current = true;
    autoSaveTimerRef.current = setInterval(() => {
      if (!autoSaveEnabledRef.current) return;
      isAutoSavingRef.current = true;
      handleSaveAllRef.current();
    }, 30000);
  }, [isAutoSavingRef]);

  return {
    handleSaveCabinet,
    handleSaveChargingArea,
    handleSaveDeviceAreas,
    handleSavePath,
    handleSaveAll,
    startAutoSave,
    resetAutoSaveTimer,
    getCurrentModelPath,
    autoSaveTimerRef,
    autoSaveEnabledRef,
  };
}
