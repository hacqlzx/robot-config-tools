import { useRef, useEffect, useState, useCallback } from "react";
import { useLasLoader } from "./hooks/useLasLoader";
import { usePlayCanvas } from "./hooks/usePlayCanvas";
import { useSaveHandlers } from "./hooks/useSaveHandlers";
import { useFileOperations } from "./hooks/useFileOperations";
import * as pc from "playcanvas";
import { useCabinetDrawing } from "./hooks/useCabinetDrawing";
import { useChargingAreaDrawing } from "./hooks/useChargingAreaDrawing";
import { useDeviceAreaDrawing } from "./hooks/useDeviceAreaDrawing";
import { usePathDrawing } from "./hooks/usePathDrawing";
import { Spin, App } from "antd";
import Toolbar from "./components/Toolbar";
import ViewCube from "./components/ViewCube";
import SidePanel from "./components/SidePanel";
import { useResizable } from "@/components/useResizable";
import ClipController from "./components/ClipController";
import CabinetPanel from "./components/CabinetPanel";
import ChargingAreaPanel from "./components/ChargingAreaPanel";
import DeviceAreaPanel from "./components/DeviceAreaPanel";
import ExportModal from "./components/ExportModal";
import { loadCabinetItems, deleteCabinetItem, loadPathDrawing, loadAllItemsFromJson, getBoundBayIdsInProject, DRAWING_FILE_NAME, type CabinetItem, type ChargingAreaItem, type DeviceAreaItem, type DrawingType } from "./hooks/drawing/drawing-storage";

/** 根据点数和硬件决定加载比例 */
function getLoadFraction(pointCount: number): number {
  if (pointCount > 20_000_000) return 0.25;
  if (pointCount > 10_000_000) return 0.5;
  return 1;
}

export default function SpaceEdit() {
  const { message } = App.useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingFile, setLoadingFile] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<Set<string>>(new Set());
  const [treeKey, setTreeKey] = useState(0);
  const [clipMode, setClipMode] = useState(false);
  const [clipEntityName, setClipEntityName] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const entitiesRef = useRef<Map<string, pc.Entity>>(new Map());
  const { width: panelWidth, resizing, onMouseDown: onResizeStart } = useResizable({
    containerRef: useRef(null),
    initialWidth: 260,
    minWidth: 200,
    maxWidth: 520,
    maxPercent: 0,
  });
  const [drawingShown, setDrawingShown] = useState<Set<string>>(new Set());
  const [pathShown, setPathShown] = useState<Set<string>>(new Set());
  const shownByJsonRef = useRef<Map<string, number[]>>(new Map());
  const savedCabinetRef = useRef<{ item: CabinetItem; jsonPath: string } | null>(null);
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, { total: number; loaded: number }>>(new Map());
  const modelExtentRef = useRef(10);
  const modelCenterRef = useRef({ x: 0, y: 0, z: 0 });
  const hasAutoFocusedRef = useRef(false);
  const modelGroundYRef = useRef(-Infinity);
  const projectBoundBayIdsRef = useRef<Set<number>>(new Set());
  const chargingAreaSavedRef = useRef(false);
  const chargedJsonPathRef = useRef("");
  const isAutoSavingRef = useRef(false);

  // ---- 绘制 Hook ----
  const { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, handleUndo, setCabinetNames, getCabinetGeometry, setupCabinetDrawing } = useCabinetDrawing();
  const { chargingMode, pointCount: chargingPointCount, height: chargingHeight, handleToggleCharging, handleUndo: handleChargingUndo, handleSave: handleChargingSave, handleSetHeight: handleChargingSetHeight, setupChargingAreaDrawing, drawingRef: chargingDrawingRef, hasExistingRef: chargingExistingRef } = useChargingAreaDrawing(
    () => handleSaveChargingArea(),
    () => { isAutoSavingRef.current = true; handleSaveChargingArea(); },
  );
  const { deviceAreaMode, boxCount: deviceAreaBoxCount, height: deviceAreaHeight, selectedBoxId: deviceAreaSelectedBoxId, selectedBoxBay: deviceAreaSelectedBoxBay, handleToggleDeviceArea, handleForceCloseDeviceArea, handleUndo: handleDeviceAreaUndo, handleBindBay: handleDeviceAreaBindBay, handleUnbind: handleDeviceAreaUnbind, handleSave: handleDeviceAreaSave, handleSetHeight: handleDeviceAreaSetHeight, getBoxDatas, getBoundBayIds, loadBoxes, setupDeviceAreaDrawing, drawingRef: deviceAreaDrawingRef, markSaved: markDeviceAreaSaved } = useDeviceAreaDrawing(
    () => handleSaveDeviceAreas(),
    () => { isAutoSavingRef.current = true; handleSaveDeviceAreas(); },
  );
  const { pathMode, handleTogglePath, handleForceClose: handleForceClosePath, getPathData, setupPathDrawing, drawingRef: pathDrawingRef } = usePathDrawing();

  // ---- PlayCanvas 引擎 ----
  const { appRef, orbitRef, cabinetViewerRef, requestRender } = usePlayCanvas({
    canvasRef, containerRef, entitiesRef,
    setupCabinetDrawing, setupChargingAreaDrawing, setupDeviceAreaDrawing, setupPathDrawing,
    chargingDrawingRef, deviceAreaDrawingRef, pathDrawingRef,
  });

  // ---- 绘制模式互斥 ----
  const closeAllDrawingModes = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
  }, [cabinetMode, chargingMode, deviceAreaMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath]);

  const toggleCabinetExclusive = useCallback(() => {
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCabinet();
  }, [chargingMode, deviceAreaMode, pathMode, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCabinet]);

  const toggleChargingExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCharging();
  }, [cabinetMode, deviceAreaMode, pathMode, handleToggleCabinet, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCharging]);

  const toggleDeviceAreaExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (pathMode) handleForceClosePath();
    handleToggleDeviceArea();
  }, [cabinetMode, chargingMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceClosePath, handleToggleDeviceArea]);

  const togglePathExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    handleTogglePath();
  }, [cabinetMode, chargingMode, deviceAreaMode, handleToggleCabinet, handleToggleCharging, handleForceCloseDeviceArea, handleTogglePath]);

  const markDrawingFileShown = useCallback((jsonPath: string, type: DrawingType) => {
    setDrawingShown((prev) => new Set(prev).add(jsonPath));
    if (type === "charging-area") {
      chargingExistingRef.current = true;
      chargingAreaSavedRef.current = true;
      chargedJsonPathRef.current = jsonPath;
    }
    setTreeKey((k) => k + 1);
  }, []);

  const markPathFileShown = useCallback((jsonPath: string) => {
    setPathShown((prev) => new Set(prev).add(jsonPath));
    setTreeKey((k) => k + 1);
  }, []);

  // ---- 保存处理器 + 自动保存 ----
  const {
    handleSaveCabinet, handleSaveChargingArea, handleSaveDeviceAreas, handleSavePath,
    handleSaveAll, getCurrentModelPath, startAutoSave, resetAutoSaveTimer,
  } = useSaveHandlers({
    entitiesRef, filePathRef, isAutoSavingRef,
    saveStatusSetter: setSaveStatus, message,
    savedCabinetRef,
    getCabinetGeometry, handleToggleCabinet,
    chargingDrawingRef, chargingMode, handleToggleCharging,
    getBoxDatas, markDeviceAreaSaved,
    getPathData,
    onDrawingFileSaved: markDrawingFileShown,
    onPathFileSaved: markPathFileShown,
  });

  // ---- 大模型显示比例 ----
  useEffect(() => {
    if (loadedFiles.size === 0) return;
    entitiesRef.current.forEach((ent) => {
      if (!ent.gsplat) return;
      const mi = ent.render?.meshInstances?.[0];
      if (mi?.material) {
        const vb = mi.mesh?.vertexBuffer;
        if (vb) {
          (mi.material as any).setParameter?.("uDisplayRatio", getLoadFraction(vb.getNumVertices()));
          mi.material.update?.();
        }
      }
    });
    requestRender();
  }, [loadedFiles, requestRender]);

  // ---- 视角 / 焦点 ----
  const handleViewChange = useCallback((direction: "前" | "后" | "左" | "右" | "上" | "下") => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    const c = modelCenterRef.current;
    const ext = modelExtentRef.current;
    orbit.lookAt.set(c.x, c.y, c.z);
    orbit.distance = ext * 1.5;
    orbit.setViewDirection(direction);
    orbit.updateCamera();
    requestRender();
  }, [requestRender]);

  const focusOnModel = useCallback((centerX: number, centerY: number, centerZ: number, extent: number) => {
    modelExtentRef.current = extent;
    modelCenterRef.current = { x: centerX, y: centerY, z: centerZ };
    const orbit = orbitRef.current;
    if (orbit) {
      orbit.sceneRadius = Math.max(orbit.sceneRadius, extent);
      orbit.sceneCenter.set(centerX, centerY, centerZ);
      orbit.maxDistance = Math.max(orbit.maxDistance, extent * 5);
      if (!hasAutoFocusedRef.current) {
        hasAutoFocusedRef.current = true;
        orbit.lookAt.set(centerX, centerY, centerZ);
        orbit.distance = extent * 1.5;
      }
      orbit.updateCamera();
      requestRender();
    }
  }, [requestRender]);

  // ---- 点云加载 ----
  const { loadLasFromPath } = useLasLoader({
    appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef,
    requestRender, focusOnModel,
    setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
    setLoadedFiles,
  });

  // ---- 文件操作 ----
  const { handleLoadLasFromPath, handleImportPointTable, handleFileSelect, handleToggleVisible, handleUnloadModelFromPath, handleClipModel } = useFileOperations({
    entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef, hasAutoFocusedRef,
    loadLasFromPath, requestRender, closeAllDrawingModes,
    setImporting, setLoadedFiles, setTreeKey, setClipEntityName, setClipMode, message,
  });

  // ---- 自动保存生命周期（已关闭） ----
  // useEffect(() => {
  //   if (loadedFiles.size === 0) return;
  //   startAutoSave();
  //   return () => { startAutoSave(); };
  // }, [loadedFiles, startAutoSave]);

  // ---- 手动保存后重置自动保存计时器 ----
  const handleManualSave = useCallback(async () => {
    await handleSaveAll();
    resetAutoSaveTimer();
  }, [handleSaveAll, resetAutoSaveTimer]);

  // ---- 屏柜树勾选回显 ----
  const handleCabinetCheck = useCallback(async (bayIds: number[]) => {
    const viewer = cabinetViewerRef.current;
    const api = window.electronAPI;
    if (!viewer || !api) return;
    const modelPath = getCurrentModelPath();
    if (!modelPath) return;
    let items: CabinetItem[] = [];
    try { items = await loadCabinetItems(api, modelPath); } catch { return; }
    const byBay = new Map(items.map((it) => [it.bay.id, it]));
    const want = new Set(bayIds.filter((id) => byBay.has(id)));
    const jsonPath = modelPath.replace(/[^\\/]+$/, DRAWING_FILE_NAME);
    for (const id of viewer.getShownIds()) if (!want.has(id)) viewer.hide(id);
    for (const id of want) if (!viewer.has(id)) viewer.show(byBay.get(id)!, jsonPath);
  }, [getCurrentModelPath]);

  // ---- 地图树勾选路径 / 绘制 ----
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
  }, []);

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
          drawing.loadBox((chargingItem as ChargingAreaItem).geometry.verts);
          chargingExistingRef.current = true;
          chargingAreaSavedRef.current = true;
          chargedJsonPathRef.current = jsonPath;
        }
      }

      const das = items.filter((it): it is DeviceAreaItem => it.type === "device-area") as DeviceAreaItem[];
      if (das.length > 0) {
        deviceAreaDrawingRef.current?.loadBoxes(das.map((it) => ({ id: it.id, verts: it.geometry.verts, height: it.height, bay: it.bay })));
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
  }, []);

  // ---- 屏柜删除 ----
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
  }, [message]);

  // ---- 副作用：交互、设备区、屏柜回显 ----
  useEffect(() => { cabinetViewerRef.current?.setOnRequestDelete(handleDeleteCabinetItem); }, [handleDeleteCabinetItem]);
  useEffect(() => { cabinetViewerRef.current?.setInteractive(!cabinetMode && !chargingMode && !deviceAreaMode && !pathMode); }, [cabinetMode, chargingMode, deviceAreaMode, pathMode]);

  useEffect(() => {
    if (!deviceAreaMode) return;
    const api = window.electronAPI;
    if (!api) return;
    getBoundBayIdsInProject(api, localStorage.getItem("selectedProject") || "").then((ids) => { projectBoundBayIdsRef.current = ids; });
  }, [deviceAreaMode]);

  const drawingShownRef = useRef(drawingShown);
  drawingShownRef.current = drawingShown;
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
  }, [deviceAreaMode]);

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
  }, [cabinetMode]);

  // ==================== JSX ====================

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", userSelect: resizing ? "none" : undefined, cursor: resizing ? "col-resize" : undefined }}>
      <Toolbar
        onFileSelect={handleFileSelect}
        onClipModel={handleClipModel}
        cabinetMode={cabinetMode} onToggleCabinet={toggleCabinetExclusive}
        chargingMode={chargingMode} onToggleCharging={toggleChargingExclusive}
        deviceAreaMode={deviceAreaMode} onToggleDeviceArea={toggleDeviceAreaExclusive}
        pathMode={pathMode} onTogglePath={togglePathExclusive}
        onSaveAll={handleManualSave}
        onImportPointTable={handleImportPointTable}
        onExportModel={() => setExportModalOpen(true)}
        importing={importing}
      />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ViewCube onViewChange={handleViewChange} />
        <SidePanel
          panelWidth={panelWidth}
          treeKey={treeKey} onLoadLas={handleLoadLasFromPath}
          onToggleVisible={handleToggleVisible}
          onUnloadMapFile={handleUnloadModelFromPath}
          loadedFiles={loadedFiles} loadingFile={loadingFile}
          onCabinetCheck={handleCabinetCheck}
          mapDrawingShown={drawingShown} onToggleDrawing={handleToggleDrawing}
          mapPathShown={pathShown} onTogglePath={handleTogglePathFile}
        />
        <div
          onMouseDown={onResizeStart}
          style={{
            flexShrink: 0,
            width: 8,
            cursor: "col-resize",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 2,
              borderRadius: 1,
              transition: "background 0.15s",
            }}
            onMouseOver={(e) => {
              const el = e.currentTarget;
              el.style.background = "#d9d9d9";
              el.parentElement!.style.background = "transparent";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          />
        </div>
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: "8px 8px 8px 0", overflow: "hidden", borderRadius: 4 }}>
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
          </div>
          {saveStatus !== "idle" && (
            <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "4px 10px", display: "flex", alignItems: "center", gap: 6, zIndex: 10, pointerEvents: "none" }}>
              {saveStatus === "saving" ? <span style={{ color: "#fff", fontSize: 12 }}>保存中...</span> : <span style={{ color: "#52c41a", fontSize: 12 }}>&#10003; 已保存</span>}
            </div>
          )}
          {(loading || loadingProgress > 0) && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
              <Spin size="large" />
              <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>{loadingText || "处理中..."}</div>
              {loadingProgress > 0 && (
                <div style={{ width: 200, marginTop: 12 }}>
                  <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${loadingProgress}%`, height: "100%", background: "#fff", borderRadius: 2, transition: "width 0.2s" }} />
                  </div>
                  <div style={{ color: "#fff", fontSize: 12, textAlign: "center", marginTop: 4 }}>{loadingProgress}%</div>
                </div>
              )}
            </div>
          )}
          {cabinetMode && <CabinetPanel cornerCount={cornerCount} cabinetCount={cabinetCount} onUndo={handleUndo} onClose={handleToggleCabinet} onSave={handleSaveCabinet} onNamesChange={setCabinetNames} />}
          {chargingMode && <ChargingAreaPanel pointCount={chargingPointCount} height={chargingHeight} onUndo={handleChargingUndo} onClose={handleToggleCharging} onSave={handleChargingSave} onSetHeight={handleChargingSetHeight} />}
          {deviceAreaMode && <DeviceAreaPanel boxCount={deviceAreaBoxCount} height={deviceAreaHeight} selectedBoxId={deviceAreaSelectedBoxId} selectedBoxBay={deviceAreaSelectedBoxBay} boundBayIds={new Set([...getBoundBayIds(), ...projectBoundBayIdsRef.current])} onUndo={handleDeviceAreaUndo} onClose={handleToggleDeviceArea} onSave={handleDeviceAreaSave} onSetHeight={handleDeviceAreaSetHeight} onBindBay={handleDeviceAreaBindBay} onUnbind={handleDeviceAreaUnbind} />}
          {clipMode && appRef.current && (
            <ClipController
              app={appRef.current} entityName={clipEntityName}
              lasHeader={lasHeadersRef.current.get(clipEntityName) || null}
              origFilePath={filePathRef.current.get(clipEntityName) || ""}
              onClose={() => setClipMode(false)}
              onProgress={(pct) => { setLoadingProgress(pct); setLoadingText(pct >= 100 ? "" : "正在保存..."); }}
              onComplete={(clipName) => {
                setTreeKey((k) => k + 1); setLoadingText(""); setLoadingProgress(0);
                if (clipName) {
                  const oldEnt = entitiesRef.current.get(clipEntityName);
                  if (oldEnt) { oldEnt.destroy(); entitiesRef.current.delete(clipEntityName); }
                  setLoadedFiles((prev) => { const next = new Set(prev); next.delete(clipEntityName); return next; });
                  hasAutoFocusedRef.current = false;
                  setTimeout(async () => {
                    const project = localStorage.getItem("selectedProject");
                    if (project && window.electronAPI) {
                      const files = await window.electronAPI.project.listTree(project, `地图/${clipName}`);
                      const lasFile: any = files.find((f: any) => f.name.endsWith(".las"));
                      if (lasFile) loadLasFromPath(lasFile.path);
                    }
                  }, 500);
                }
              }}
            />
          )}
        </div>
      </div>
      {importing && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
          <Spin size="large" />
          <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>正在导入点表...</div>
        </div>
      )}
      <ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />
    </div>
  );
}
