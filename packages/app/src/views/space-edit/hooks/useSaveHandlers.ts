import { useCallback, useRef, useEffect } from "react";
import * as pc from "playcanvas";
import { saveCabinetDrawing, saveChargingArea, saveDeviceAreas, savePathDrawing, DRAWING_FILE_NAME, type CabinetItem, type ChargingAreaItem, type DeviceAreaItem } from "../hooks/drawing/drawing-storage";

interface UseSaveHandlersParams {
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  isAutoSavingRef: React.MutableRefObject<boolean>;
  saveStatusSetter: React.Dispatch<React.SetStateAction<"idle" | "saving" | "saved">>;
  message: { success: (msg: string) => void; warning: (msg: string) => void; error: (msg: string) => void };
  /** 屏柜保存后回显：设置此 ref 供 cabinetMode useEffect 消费 */
  savedCabinetRef: React.MutableRefObject<{ item: CabinetItem; jsonPath: string } | null>;
  /** 屏柜绘制相关 */
  getCabinetGeometry: () => { verts: number[][]; splits: number[] } | null;
  handleToggleCabinet: () => void;
  /** 充电区域相关 */
  chargingDrawingRef: React.MutableRefObject<any>;
  chargingMode: boolean;
  handleToggleCharging: () => void;
  /** 设备区相关 */
  getBoxDatas: () => { id: string; verts: number[][]; height: number; bay: any }[];
  markDeviceAreaSaved: () => void;
  /** 路径相关 */
  getPathData: () => any;
}

export function useSaveHandlers(params: UseSaveHandlersParams) {
  const { entitiesRef, filePathRef, isAutoSavingRef, saveStatusSetter, message } = params;

  /** 当前绘制模型路径：优先可见且有路径的模型 */
  const getCurrentModelPath = useCallback((): string => {
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) return p;
    }
    return filePathRef.current.values().next().value || "";
  }, [entitiesRef, filePathRef]);

  /** 保存屏柜 */
  const handleSaveCabinet = useCallback(async (data: { area: { id: number; name: string; code: string }; bay: { id: number; name: string; code: string }; rows: { key: string; code: string; name: string }[] }) => {
    const api = window.electronAPI;
    if (!api) { message.warning("仅 Electron 模式下可保存"); return; }
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName) { message.warning("请先选择项目"); return; }
    const geometry = params.getCabinetGeometry();
    if (!geometry) { message.warning("请先完成屏柜绘制（四点成体）"); return; }

    let modelPath = "";
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) { modelPath = p; break; }
    }
    if (!modelPath) {
      const first = filePathRef.current.values().next().value;
      if (first) modelPath = first;
    }
    if (!modelPath) { message.warning("未找到绘制模型，无法保存"); return; }

    const item: CabinetItem = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "cabinet",
      area: data.area,
      bay: data.bay,
      geometry,
      cabinets: data.rows.map((r) => ({ code: r.code, name: r.name })),
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveCabinetDrawing({ api, projectName, modelPath, item });
      params.savedCabinetRef.current = { item, jsonPath: modelPath.replace(/[^\\/]+$/, DRAWING_FILE_NAME) };
      message.success(`保存成功（${item.cabinets.length} 个屏柜）`);
      params.handleToggleCabinet();
    } catch (e: any) {
      message.error("保存失败: " + (e?.message || e));
    }
  }, [entitiesRef, filePathRef, message, params]);

  /** 保存充电区域 */
  const handleSaveChargingArea = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) { if (!isAutoSavingRef.current) message.warning("仅 Electron 模式下可保存"); return; }
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName) { if (!isAutoSavingRef.current) message.warning("请先选择项目"); return; }
    const drawing = params.chargingDrawingRef.current;
    if (!drawing) return;
    const verts = drawing.getBoxVerts();

    let modelPath = "";
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) { modelPath = p; break; }
    }
    if (!modelPath) {
      const first = filePathRef.current.values().next().value;
      if (first) modelPath = first;
    }
    if (!modelPath) return;

    const item: ChargingAreaItem | null = verts ? {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "charging-area",
      geometry: { verts },
      updatedAt: new Date().toISOString(),
    } : null;

    try {
      await saveChargingArea({ api, projectName, modelPath, item });
      if (!isAutoSavingRef.current) message.success("保存成功");
      if (params.chargingMode) params.handleToggleCharging();
    } catch (e: any) {
      message.error("保存充电区失败: " + (e?.message || e));
    }
  }, [entitiesRef, filePathRef, isAutoSavingRef, message, params]);

  /** 保存设备区 */
  const handleSaveDeviceAreas = useCallback(async () => {
    const silent = isAutoSavingRef.current;
    const api = window.electronAPI;
    if (!api) { if (!silent) message.warning("仅 Electron 模式下可保存"); return; }
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName) { if (!silent) message.warning("请先选择项目"); return; }
    const datas = params.getBoxDatas();

    let modelPath = "";
    for (const [name, ent] of entitiesRef.current) {
      const p = filePathRef.current.get(name);
      if (ent.enabled && p) { modelPath = p; break; }
    }
    if (!modelPath) {
      const first = filePathRef.current.values().next().value;
      if (first) modelPath = first;
    }
    if (!modelPath) { if (!silent) message.warning("未找到模型路径，无法保存"); return; }

    const items: DeviceAreaItem[] = datas.map((d) => ({
      id: d.id,
      type: "device-area" as const,
      geometry: { verts: d.verts },
      height: d.height,
      bay: d.bay,
      updatedAt: new Date().toISOString(),
    }));

    try {
      await saveDeviceAreas({ api, projectName, modelPath, items });
      if (!silent) message.success("保存成功");
      params.markDeviceAreaSaved();
    } catch (e: any) {
      message.error("保存设备区失败: " + (e?.message || e));
    }
  }, [entitiesRef, filePathRef, isAutoSavingRef, message, params]);

  /** 保存可行路径 */
  const handleSavePath = useCallback(async () => {
    const silent = isAutoSavingRef.current;
    const api = window.electronAPI;
    if (!api) { if (!silent) message.warning("仅 Electron 模式下可保存"); return; }
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName) { if (!silent) message.warning("请先选择项目"); return; }
    const data = params.getPathData();
    if (!data) return;
    const modelPath = getCurrentModelPath();
    if (!modelPath) { if (!silent) message.warning("未找到模型路径，无法保存"); return; }
    try {
      await savePathDrawing({ api, projectName, modelPath, data });
    } catch (e: any) {
      if (!silent) message.error("保存路径失败: " + (e?.message || e));
    }
  }, [isAutoSavingRef, message, params, getCurrentModelPath]);

  // HandleSaveAll uses a ref to avoid circular deps with itself
  const handleSaveAllRef = useRef<() => Promise<void>>(async () => {});

  /** 保存全部：充电区域 + 设备区 + 可行路径（屏柜已单独保存到JSON） */
  const handleSaveAll = useCallback(async () => {
    const silent = isAutoSavingRef.current;
    const drawing = params.chargingDrawingRef.current;
    const hasCharging = drawing?.hasBox();
    const hasDeviceAreas = params.getBoxDatas().length > 0;
    const hasPath = !!params.getPathData();

    // 自动保存时：无任何数据且 JSON 文件不存在 → 不创建空文件
    if (silent && !hasCharging && !hasDeviceAreas && !hasPath) {
      const modelPath = getCurrentModelPath();
      if (!modelPath) return;
      try {
        const buf = await window.electronAPI?.readLargeFile?.(modelPath.replace(/[^\\/]+$/, DRAWING_FILE_NAME));
        if (!buf) return;
      } catch {
        return; // JSON 不存在，跳过自动保存
      }
    }

    if (!silent) saveStatusSetter("saving");
    isAutoSavingRef.current = true;
    if (hasCharging) await handleSaveChargingArea();
    await handleSaveDeviceAreas();
    await handleSavePath();
    isAutoSavingRef.current = false;
    if (!silent) {
      saveStatusSetter("saved");
      message.success("保存成功");
      setTimeout(() => saveStatusSetter("idle"), 2000);
    }
  }, [handleSaveChargingArea, handleSaveDeviceAreas, handleSavePath, isAutoSavingRef, saveStatusSetter, message, params, getCurrentModelPath]);
  handleSaveAllRef.current = handleSaveAll;

  // Auto-save timer
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
