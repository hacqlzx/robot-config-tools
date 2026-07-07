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
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const [pathShown, setPathShown] = useState<Set<string>>(new Set());
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
    (async () => {
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
