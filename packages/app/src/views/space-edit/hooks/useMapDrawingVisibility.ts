import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteCabinetItem,
  loadAllItemsFromJson,
  loadCabinetItems,
  loadPathDrawing,
  DRAWING_FILE_NAME,
  type CabinetItem,
  type ChargingAreaItem,
  type DeviceAreaItem,
  type DrawingType,
} from "./drawing/drawing-storage";
import type { SpaceMessageApi } from "../types";
import { getCurrentModelPathFromRefs } from "../utils/model-state";
import { mapSiblingFilePath } from "../utils/space-paths";

interface UseMapDrawingVisibilityParams {
  entitiesRef: React.MutableRefObject<Map<string, any>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  cabinetViewerRef: React.MutableRefObject<any>;
  pathDrawingRef: React.MutableRefObject<any>;
  chargingDrawingRef: React.MutableRefObject<any>;
  deviceAreaDrawingRef: React.MutableRefObject<any>;
  chargingExistingRef: React.MutableRefObject<boolean>;
  savedCabinetRef: React.MutableRefObject<{ item: CabinetItem; jsonPath: string } | null>;
  cabinetMode: boolean;
  deviceAreaMode: boolean;
  refreshTree: () => void;
  message: SpaceMessageApi;
}

export function useMapDrawingVisibility({
  entitiesRef,
  filePathRef,
  cabinetViewerRef,
  pathDrawingRef,
  chargingDrawingRef,
  deviceAreaDrawingRef,
  chargingExistingRef,
  savedCabinetRef,
  cabinetMode,
  deviceAreaMode,
  refreshTree,
  message,
}: UseMapDrawingVisibilityParams) {
  // drawingShown/pathShown 只记录树节点勾选状态；真正的实体分别在 CabinetViewer/各 Drawing 类中。
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const [pathShown, setPathShown] = useState<Set<string>>(new Set());
  // 一个 JSON 文件里可能包含多个屏柜，按 jsonPath 记录 bayId，取消勾选时精准隐藏对应回显。
  const shownByJsonRef = useRef<Map<string, number[]>>(new Map());
  const drawingShownRef = useRef(drawingShown);
  const chargingAreaSavedRef = useRef(false);
  const chargedJsonPathRef = useRef("");

  drawingShownRef.current = drawingShown;

  const markDrawingFileShown = useCallback((jsonPath: string, type: DrawingType) => {
    setDrawingShown((prev) => new Set(prev).add(jsonPath));
    if (type === "charging-area") {
      chargingExistingRef.current = true;
      chargingAreaSavedRef.current = true;
      chargedJsonPathRef.current = jsonPath;
    }
    refreshTree();
  }, [chargingExistingRef, refreshTree]);

  const markPathFileShown = useCallback((jsonPath: string) => {
    setPathShown((prev) => new Set(prev).add(jsonPath));
    refreshTree();
  }, [refreshTree]);

  const handleCabinetCheck = useCallback(async (bayIds: number[]) => {
    // 设备台账树按 bayId 控制屏柜显示；这里从当前模型同目录 JSON 中取对应屏柜记录。
    const viewer = cabinetViewerRef.current;
    const api = window.electronAPI;
    if (!viewer || !api) return;
    const modelPath = getCurrentModelPathFromRefs(entitiesRef.current, filePathRef.current);
    if (!modelPath) return;
    let items: CabinetItem[] = [];
    try { items = await loadCabinetItems(api, modelPath); } catch { return; }
    const byBay = new Map(items.map((it) => [it.bay.id, it]));
    const want = new Set(bayIds.filter((id) => byBay.has(id)));
    const jsonPath = mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
    for (const id of viewer.getShownIds()) if (!want.has(id)) viewer.hide(id);
    for (const id of want) if (!viewer.has(id)) viewer.show(byBay.get(id)!, jsonPath);
  }, [cabinetViewerRef, entitiesRef, filePathRef]);

  const handleTogglePathFile = useCallback(async (jsonPath: string, checked: boolean) => {
    const api = window.electronAPI;
    if (!api) return;
    if (checked) {
      // 路径编辑器本身也承担回显，所以勾选路径文件时直接把保存数据加载进去。
      const data = await loadPathDrawing(api, jsonPath);
      if (data) pathDrawingRef.current?.loadData(data);
      setPathShown((prev) => new Set(prev).add(jsonPath));
    } else {
      pathDrawingRef.current?.clear();
      setPathShown((prev) => { const next = new Set(prev); next.delete(jsonPath); return next; });
    }
  }, [pathDrawingRef]);

  const handleToggleDrawing = useCallback(async (jsonPath: string, checked: boolean) => {
    const viewer = cabinetViewerRef.current;
    const api = window.electronAPI;
    if (!viewer || !api) return;
    if (checked) {
      const items = await loadAllItemsFromJson(api, jsonPath);
      // 同一个绘制 JSON 内混放屏柜、充电区域、设备区，勾选时按 type 分发到不同渲染器。
      const cabItems = items.filter((it): it is CabinetItem => it.type === "cabinet");
      cabItems.forEach((it) => viewer.show(it, jsonPath));
      shownByJsonRef.current.set(jsonPath, cabItems.map((it) => it.bay.id));
      setDrawingShown((prev) => new Set(prev).add(jsonPath));

      const chargingItem = items.find((it): it is ChargingAreaItem => it.type === "charging-area");
      if (chargingItem) {
        const drawing = chargingDrawingRef.current;
        if (drawing && !drawing.hasBox()) {
          drawing.loadBox(chargingItem.geometry.verts);
          chargingExistingRef.current = true;
          chargingAreaSavedRef.current = true;
          chargedJsonPathRef.current = jsonPath;
        }
      }

      const deviceAreaItems = items.filter((it): it is DeviceAreaItem => it.type === "device-area");
      if (deviceAreaItems.length > 0) {
        deviceAreaDrawingRef.current?.loadBoxes(deviceAreaItems.map((it) => ({ id: it.id, verts: it.geometry.verts, height: it.height, bay: it.bay })));
      }
    } else {
      // 取消勾选要同步清理三类回显，否则 UI 树状态和场景内容会不一致。
      const ids = shownByJsonRef.current.get(jsonPath) || [];
      ids.forEach((id) => viewer.hide(id));
      shownByJsonRef.current.delete(jsonPath);
      setDrawingShown((prev) => { const next = new Set(prev); next.delete(jsonPath); return next; });
      if (chargedJsonPathRef.current === jsonPath) {
        if (chargingDrawingRef.current?.hasBox()) chargingDrawingRef.current.clear();
        chargingExistingRef.current = false;
        chargingAreaSavedRef.current = false;
        chargedJsonPathRef.current = "";
      }
      deviceAreaDrawingRef.current?.clearAll();
    }
  }, [cabinetViewerRef, chargingDrawingRef, chargingExistingRef, deviceAreaDrawingRef]);

  const handleDeleteCabinetItem = useCallback(async (jsonPath: string, bayId: number) => {
    const api = window.electronAPI;
    const projectName = localStorage.getItem("selectedProject");
    if (!api || !projectName) return;
    try { await deleteCabinetItem(api, projectName, jsonPath, bayId); }
    catch (e: any) { message.error("删除失败: " + (e?.message || e)); return; }
    cabinetViewerRef.current?.hide(bayId);
    const ids = shownByJsonRef.current.get(jsonPath);
    if (ids) shownByJsonRef.current.set(jsonPath, ids.filter((id) => id !== bayId));
    message.success("已删除");
  }, [cabinetViewerRef, message]);

  useEffect(() => {
    if (deviceAreaMode) return;
    const api = window.electronAPI;
    if (!api) return;
    const drawing = deviceAreaDrawingRef.current;
    if (!drawing) return;
    if (drawing.hasAnyData?.()) return;
    (async () => {
      // 退出设备区编辑模式后，从当前勾选的绘制 JSON 重新回灌设备区，
      // 避免编辑器 clear/load 过程导致树勾选状态和场景回显脱节。
      const allItems: DeviceAreaItem[] = [];
      for (const jsonPath of drawingShownRef.current) {
        const items = await loadAllItemsFromJson(api, jsonPath);
        allItems.push(...items.filter((it): it is DeviceAreaItem => it.type === "device-area"));
      }
      if (allItems.length > 0) drawing.loadBoxes(allItems.map((it) => ({ id: it.id, verts: it.geometry.verts, height: it.height, bay: it.bay })));
    })();
  }, [deviceAreaDrawingRef, deviceAreaMode]);

  useEffect(() => {
    const viewer = cabinetViewerRef.current;
    if (!cabinetMode) {
      // 屏柜保存发生在编辑态，真正回显要等退出屏柜模式后执行，避免同一屏柜显示两套线框。
      const saved = savedCabinetRef.current;
      if (saved && viewer) {
        viewer.show(saved.item, saved.jsonPath);
        const ids = shownByJsonRef.current.get(saved.jsonPath) || [];
        if (!ids.includes(saved.item.bay.id)) shownByJsonRef.current.set(saved.jsonPath, [...ids, saved.item.bay.id]);
        setDrawingShown((prev) => new Set(prev).add(saved.jsonPath));
      }
      savedCabinetRef.current = null;
    }
  }, [cabinetMode, cabinetViewerRef, savedCabinetRef]);

  return {
    drawingShown,
    pathShown,
    markDrawingFileShown,
    markPathFileShown,
    handleCabinetCheck,
    handleTogglePathFile,
    handleToggleDrawing,
    handleDeleteCabinetItem,
  };
}
