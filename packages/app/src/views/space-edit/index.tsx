import { useRef, useEffect, useState, useCallback } from "react";
import { useLasLoader } from "./hooks/useLasLoader";
import { usePlayCanvas } from "./hooks/usePlayCanvas";
import { useSaveHandlers } from "./hooks/useSaveHandlers";
import { useFileOperations } from "./hooks/useFileOperations";
import { useMapDrawingVisibility } from "./hooks/useMapDrawingVisibility";
import { useProjectBoundBayIds } from "./hooks/useProjectBoundBayIds";
import { useClipCompletion } from "./hooks/useClipCompletion";
import { useDrawingModeToggles } from "./hooks/useDrawingModeToggles";
import * as pc from "playcanvas";
import { useCabinetDrawing } from "./hooks/useCabinetDrawing";
import { useChargingAreaDrawing } from "./hooks/useChargingAreaDrawing";
import { useDeviceAreaDrawing } from "./hooks/useDeviceAreaDrawing";
import { usePathDrawing } from "./hooks/usePathDrawing";
import { App } from "antd";
import Toolbar from "./components/Toolbar";
import ViewCube from "./components/ViewCube";
import SidePanel from "./components/SidePanel";
import { useResizable } from "@/components/useResizable";
import ExportModal from "./components/ExportModal";
import SpaceEditLayout from "./components/SpaceEditLayout";
import SpaceEditScene from "./components/SpaceEditScene";
import type { CabinetItem } from "./hooks/drawing/drawing-storage";
import type { ModelCenter, ModelPointStats, SaveStatus, ViewDirection } from "./types";

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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const entitiesRef = useRef<Map<string, pc.Entity>>(new Map());
  const { width: panelWidth, resizing, onMouseDown: onResizeStart } = useResizable({
    containerRef: useRef(null),
    initialWidth: 260,
    minWidth: 200,
    maxWidth: 520,
    maxPercent: 0,
  });
  const savedCabinetRef = useRef<{ item: CabinetItem; jsonPath: string } | null>(null);
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, ModelPointStats>>(new Map());
  const modelExtentRef = useRef(10);
  const modelCenterRef = useRef<ModelCenter>({ x: 0, y: 0, z: 0 });
  const hasAutoFocusedRef = useRef(false);
  const modelGroundYRef = useRef(-Infinity);
  const isAutoSavingRef = useRef(false);

  // ---- 绘制 Hook ----
  const { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, handleUndo, setCabinetNames, getCabinetGeometry, setupCabinetDrawing } = useCabinetDrawing();
  const { chargingMode, pointCount: chargingPointCount, height: chargingHeight, handleToggleCharging, handleUndo: handleChargingUndo, handleSave: handleChargingSave, handleSetHeight: handleChargingSetHeight, setupChargingAreaDrawing, drawingRef: chargingDrawingRef, hasExistingRef: chargingExistingRef } = useChargingAreaDrawing(
    () => handleSaveChargingArea(),
    () => { isAutoSavingRef.current = true; handleSaveChargingArea(); },
  );
  const { deviceAreaMode, boxCount: deviceAreaBoxCount, height: deviceAreaHeight, selectedBoxId: deviceAreaSelectedBoxId, selectedBoxBay: deviceAreaSelectedBoxBay, handleToggleDeviceArea, handleForceCloseDeviceArea, handleUndo: handleDeviceAreaUndo, handleBindBay: handleDeviceAreaBindBay, handleUnbind: handleDeviceAreaUnbind, handleSave: handleDeviceAreaSave, handleSetHeight: handleDeviceAreaSetHeight, getBoxDatas, getBoundBayIds, setupDeviceAreaDrawing, drawingRef: deviceAreaDrawingRef, markSaved: markDeviceAreaSaved } = useDeviceAreaDrawing(
    () => handleSaveDeviceAreas(),
    () => { isAutoSavingRef.current = true; handleSaveDeviceAreas(); },
  );
  const { pathMode, handleTogglePath, handleForceClose: handleForceClosePath, getPathData, setupPathDrawing, drawingRef: pathDrawingRef } = usePathDrawing();
  const projectBoundBayIdsRef = useProjectBoundBayIds(deviceAreaMode);

  // ---- PlayCanvas 引擎 ----
  const { appRef, orbitRef, cabinetViewerRef, requestRender } = usePlayCanvas({
    canvasRef, containerRef, entitiesRef,
    setupCabinetDrawing, setupChargingAreaDrawing, setupDeviceAreaDrawing, setupPathDrawing,
    chargingDrawingRef, deviceAreaDrawingRef, pathDrawingRef,
  });

  const {
    closeAllDrawingModes,
    toggleCabinetExclusive,
    toggleChargingExclusive,
    toggleDeviceAreaExclusive,
    togglePathExclusive,
  } = useDrawingModeToggles({
    cabinetMode,
    chargingMode,
    deviceAreaMode,
    pathMode,
    handleToggleCabinet,
    handleToggleCharging,
    handleToggleDeviceArea,
    handleTogglePath,
    handleForceCloseDeviceArea,
    handleForceClosePath,
  });

  const refreshTree = useCallback(() => setTreeKey((k) => k + 1), []);

  const {
    drawingShown,
    pathShown,
    markDrawingFileShown,
    markPathFileShown,
    handleCabinetCheck,
    handleTogglePathFile,
    handleToggleDrawing,
    handleDeleteCabinetItem,
  } = useMapDrawingVisibility({
    entitiesRef, filePathRef,
    cabinetViewerRef, pathDrawingRef, chargingDrawingRef, deviceAreaDrawingRef,
    chargingExistingRef, savedCabinetRef,
    cabinetMode, deviceAreaMode,
    refreshTree, message,
  });

  // ---- 保存处理器 + 自动保存 ----
  const {
    handleSaveCabinet, handleSaveChargingArea, handleSaveDeviceAreas,
    handleSaveAll, resetAutoSaveTimer,
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
  const handleViewChange = useCallback((direction: ViewDirection) => {
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
  const handleClipComplete = useClipCompletion({
    clipEntityName,
    entitiesRef,
    hasAutoFocusedRef,
    setLoadedFiles,
    setTreeKey,
    setLoadingText,
    setLoadingProgress,
    loadLasFromPath,
  });

  // ---- 手动保存后重置自动保存计时器 ----
  const handleManualSave = useCallback(async () => {
    await handleSaveAll();
    resetAutoSaveTimer();
  }, [handleSaveAll, resetAutoSaveTimer]);

  // ---- 副作用：交互、设备区、屏柜回显 ----
  useEffect(() => { cabinetViewerRef.current?.setOnRequestDelete(handleDeleteCabinetItem); }, [handleDeleteCabinetItem]);
  useEffect(() => { cabinetViewerRef.current?.setInteractive(!cabinetMode && !chargingMode && !deviceAreaMode && !pathMode); }, [cabinetMode, chargingMode, deviceAreaMode, pathMode]);

  // ==================== JSX ====================

  return (
    <SpaceEditLayout
      containerRef={containerRef}
      resizing={resizing}
      onResizeStart={onResizeStart}
      toolbar={(
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
      )}
      viewControls={<ViewCube onViewChange={handleViewChange} />}
      sidePanel={(
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
      )}
      scene={(
        <SpaceEditScene
          canvasRef={canvasRef}
          saveStatus={saveStatus}
          loading={loading}
          loadingProgress={loadingProgress}
          loadingText={loadingText}
          cabinetMode={cabinetMode}
          cabinetCornerCount={cornerCount}
          cabinetCount={cabinetCount}
          onCabinetUndo={handleUndo}
          onCabinetClose={handleToggleCabinet}
          onCabinetSave={handleSaveCabinet}
          onCabinetNamesChange={setCabinetNames}
          chargingMode={chargingMode}
          chargingPointCount={chargingPointCount}
          chargingHeight={chargingHeight}
          onChargingUndo={handleChargingUndo}
          onChargingClose={handleToggleCharging}
          onChargingSave={handleChargingSave}
          onChargingSetHeight={handleChargingSetHeight}
          deviceAreaMode={deviceAreaMode}
          deviceAreaBoxCount={deviceAreaBoxCount}
          deviceAreaHeight={deviceAreaHeight}
          deviceAreaSelectedBoxId={deviceAreaSelectedBoxId}
          deviceAreaSelectedBoxBay={deviceAreaSelectedBoxBay}
          deviceAreaBoundBayIds={new Set([...getBoundBayIds(), ...projectBoundBayIdsRef.current])}
          onDeviceAreaUndo={handleDeviceAreaUndo}
          onDeviceAreaClose={handleToggleDeviceArea}
          onDeviceAreaSave={handleDeviceAreaSave}
          onDeviceAreaSetHeight={handleDeviceAreaSetHeight}
          onDeviceAreaBindBay={handleDeviceAreaBindBay}
          onDeviceAreaUnbind={handleDeviceAreaUnbind}
          clipMode={clipMode}
          clipEntityName={clipEntityName}
          app={appRef.current}
          lasHeadersRef={lasHeadersRef}
          filePathRef={filePathRef}
          onClipClose={() => setClipMode(false)}
          onClipProgress={(pct) => { setLoadingProgress(pct); setLoadingText(pct >= 100 ? "" : "正在保存..."); }}
          onClipComplete={handleClipComplete}
        />
      )}
      importing={importing}
      exportModal={<ExportModal open={exportModalOpen} onClose={() => setExportModalOpen(false)} />}
    />
  );
}
