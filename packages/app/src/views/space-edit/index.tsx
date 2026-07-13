import { useRef, useEffect, useState, useCallback } from "react";
import { useLasLoader } from "./hooks/useLasLoader";
import { usePlayCanvas } from "./hooks/usePlayCanvas";
import { useSaveHandlers } from "./hooks/useSaveHandlers";
import { useFileOperations } from "./hooks/useFileOperations";
import { useMapDrawingVisibility } from "./hooks/useMapDrawingVisibility";
import { useProjectBoundBayIds } from "./hooks/useProjectBoundBayIds";
import { useClipCompletion } from "./hooks/useClipCompletion";
import { useDrawingModeToggles } from "./hooks/useDrawingModeToggles";
import { useDrawingHistory, type DrawingHistoryScope } from "./hooks/useDrawingHistory";
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

interface CabinetSaveData {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  cabinetRow?: { key: string; code: string; name: string } | null;
  rows: { key: string; code: string; name: string }[];
}

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
  const cabinetDraftRef = useRef<CabinetSaveData | null>(null);
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, ModelPointStats>>(new Map());
  const modelExtentRef = useRef(10);
  const modelCenterRef = useRef<ModelCenter>({ x: 0, y: 0, z: 0 });
  const hasAutoFocusedRef = useRef(false);
  const modelGroundYRef = useRef(-Infinity);
  const isAutoSavingRef = useRef(false);
  const drawingHistoryRecordRef = useRef<(scope: DrawingHistoryScope, before: any, after: any, label: string) => void>(() => {});
  const handleDrawingHistory = useCallback((scope: DrawingHistoryScope, before: any, after: any, label: string) => {
    drawingHistoryRecordRef.current(scope, before, after, label);
  }, []);

  // ---- 绘制 Hook ----
  // 这些 hook 只暴露模式状态和 setup 函数；真正的 canvas 事件绑定在 usePlayCanvas 中统一完成。
  const { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, setCabinetNames, getCabinetGeometry, clearCabinetDraft, setupCabinetDrawing, drawingRef: cabinetDrawingRef } = useCabinetDrawing(handleDrawingHistory);
  const { chargingMode, pointCount: chargingPointCount, height: chargingHeight, handleToggleCharging, handleSave: handleChargingSave, handleSetHeight: handleChargingSetHeight, clearChargingDraft, setupChargingAreaDrawing, drawingRef: chargingDrawingRef, hasExistingRef: chargingExistingRef } = useChargingAreaDrawing(
    () => handleSaveChargingArea(),
    () => { isAutoSavingRef.current = true; handleSaveChargingArea(); },
    handleDrawingHistory,
  );
  const { deviceAreaMode, boxCount: deviceAreaBoxCount, height: deviceAreaHeight, selectedBoxId: deviceAreaSelectedBoxId, selectedBoxBay: deviceAreaSelectedBoxBay, handleToggleDeviceArea, handleForceCloseDeviceArea, handleBindBay: handleDeviceAreaBindBay, handleUnbind: handleDeviceAreaUnbind, handleSave: handleDeviceAreaSave, handleSetHeight: handleDeviceAreaSetHeight, getBoxDatas, getBoundBayIds, clearDeviceAreaDraft, setupDeviceAreaDrawing, drawingRef: deviceAreaDrawingRef, markSaved: markDeviceAreaSaved } = useDeviceAreaDrawing(
    () => handleSaveDeviceAreas(),
    () => { isAutoSavingRef.current = true; handleSaveDeviceAreas(); },
    handleDrawingHistory,
  );
  const { pathMode, handleTogglePath, handleForceClose: handleForceClosePath, getPathData, clearPathDraft, setupPathDrawing, drawingRef: pathDrawingRef } = usePathDrawing(handleDrawingHistory);
  const drawingHistory = useDrawingHistory({
    cabinetDrawingRef,
    chargingDrawingRef,
    deviceAreaDrawingRef,
    pathDrawingRef,
  });
  drawingHistoryRecordRef.current = drawingHistory.record;
  const projectBoundBayIds = useProjectBoundBayIds(deviceAreaMode);

  // ---- PlayCanvas 引擎 ----
  // usePlayCanvas 是 space-edit 的三维装配点：公共 ThreeDEngine + 四类编辑 Drawing + CabinetViewer。
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
  const handleCabinetDraftChange = useCallback((data: CabinetSaveData | null) => {
    cabinetDraftRef.current = data;
  }, []);
  const clearDrawingDrafts = useCallback(() => {
    clearCabinetDraft();
    clearChargingDraft();
    clearDeviceAreaDraft();
    clearPathDraft();
  }, [clearCabinetDraft, clearChargingDraft, clearDeviceAreaDraft, clearPathDraft]);

  // 地图树里 JSON 的勾选/回显状态独立管理，避免把树组件和三维实体生命周期绑死。
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
  // 保存层只从 Drawing 类读取几何快照，然后写入模型同目录 JSON；不会直接操作 canvas。
  const {
    handleSaveCabinet, handleSaveChargingArea, handleSaveDeviceAreas,
    handleSaveAll, resetAutoSaveTimer,
  } = useSaveHandlers({
    entitiesRef, filePathRef, isAutoSavingRef,
    saveStatusSetter: setSaveStatus, message,
    savedCabinetRef,
    getCabinetGeometry, clearCabinetDraft, handleToggleCabinet,
    chargingDrawingRef, chargingMode, handleToggleCharging,
    getBoxDatas, markDeviceAreaSaved,
    getPathData,
    onDrawingFileSaved: markDrawingFileShown,
    onPathFileSaved: markPathFileShown,
    onCabinetSaved: drawingHistory.clear,
  });

  // ---- 大模型显示比例 ----
  // 这里主要保留给 gsplat/历史显示路径。LAS/LAZ 已在 PointCloudLoader 内按 MAX_POINTS 降采样。
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
    // 首次加载模型自动聚焦；后续加载更多模型只扩展相机范围，不强行打断用户当前视角。
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
  // loadLasFromPath 会同步 entities/headers/path/stat refs，后续裁切、显隐、保存都依赖这些索引。
  const { loadLasFromPath } = useLasLoader({
    appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef,
    requestRender, focusOnModel,
    setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
    setLoadedFiles,
  });

  // ---- 文件操作 ----
  // 文件操作负责“项目文件系统 + 三维状态”的桥接，例如导入模型、切换可见性、进入裁切。
  const { handleLoadLasFromPath, handleImportPointTable, handleFileSelect, handleToggleVisible, handleUnloadModelFromPath, handleClipModel } = useFileOperations({
    entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef, hasAutoFocusedRef,
    loadLasFromPath, requestRender, closeAllDrawingModes,
    setImporting, setLoadedFiles, setTreeKey, setClipEntityName, setClipMode, message,
  });
  const handleLoadLasFromPathWithHistoryReset = useCallback(async (filePath: string) => {
    drawingHistory.clear();
    clearDrawingDrafts();
    await handleLoadLasFromPath(filePath);
  }, [clearDrawingDrafts, drawingHistory.clear, handleLoadLasFromPath]);
  const handleFileSelectWithHistoryReset = useCallback(async (file: File) => {
    drawingHistory.clear();
    clearDrawingDrafts();
    await handleFileSelect(file);
  }, [clearDrawingDrafts, drawingHistory.clear, handleFileSelect]);
  const handleToggleVisibleWithHistoryReset = useCallback((filePath: string) => {
    drawingHistory.clear();
    clearDrawingDrafts();
    handleToggleVisible(filePath);
  }, [clearDrawingDrafts, drawingHistory.clear, handleToggleVisible]);
  const handleUnloadModelFromPathWithHistoryReset = useCallback((filePath: string) => {
    drawingHistory.clear();
    clearDrawingDrafts();
    return handleUnloadModelFromPath(filePath);
  }, [clearDrawingDrafts, drawingHistory.clear, handleUnloadModelFromPath]);
  const handleToggleDrawingWithHistoryReset = useCallback((jsonPath: string, checked: boolean) => {
    drawingHistory.clear();
    return handleToggleDrawing(jsonPath, checked);
  }, [drawingHistory.clear, handleToggleDrawing]);
  const handleTogglePathFileWithHistoryReset = useCallback((jsonPath: string, checked: boolean) => {
    drawingHistory.clear();
    return handleTogglePathFile(jsonPath, checked);
  }, [drawingHistory.clear, handleTogglePathFile]);
  const handleClipComplete = useClipCompletion({
    clipEntityName,
    entitiesRef,
    lasHeadersRef,
    filePathRef,
    pointStatsRef,
    hasAutoFocusedRef,
    setLoadedFiles,
    setTreeKey,
    setLoadingText,
    setLoadingProgress,
    loadLasFromPath,
  });

  // ---- 手动保存后重置自动保存计时器 ----
  const handleManualSave = useCallback(async () => {
    if (cabinetMode) {
      const draft = cabinetDraftRef.current;
      if (!draft) {
        message.warning("请先选择区域和间隔");
        return;
      }
      await handleSaveCabinet(draft);
      resetAutoSaveTimer();
      return;
    }
    await handleSaveAll();
    resetAutoSaveTimer();
  }, [cabinetMode, handleSaveCabinet, handleSaveAll, message, resetAutoSaveTimer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && !event.shiftKey
        && event.key.toLowerCase() === "s";
      if (!isSaveShortcut) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      void handleManualSave();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [handleManualSave]);

  // ---- 副作用：交互、设备区、屏柜回显 ----
  useEffect(() => { cabinetViewerRef.current?.setOnRequestDelete(handleDeleteCabinetItem); }, [handleDeleteCabinetItem]);
  useEffect(() => { cabinetViewerRef.current?.setInteractive(!cabinetMode && !chargingMode && !deviceAreaMode && !pathMode); }, [cabinetMode, chargingMode, deviceAreaMode, pathMode]);
  useEffect(() => {
    const mode = cabinetMode
      ? "cabinet"
      : chargingMode
        ? "charging"
        : deviceAreaMode
          ? "device-area"
          : pathMode
            ? "path"
            : "idle";
    (window as any).__spaceEditInteractionMode = mode;
    return () => {
      if ((window as any).__spaceEditInteractionMode === mode) {
        (window as any).__spaceEditInteractionMode = "idle";
      }
    };
  }, [cabinetMode, chargingMode, deviceAreaMode, pathMode]);

  // ==================== JSX ====================

  return (
    <SpaceEditLayout
      containerRef={containerRef}
      resizing={resizing}
      onResizeStart={onResizeStart}
      toolbar={(
        <Toolbar
          onFileSelect={handleFileSelectWithHistoryReset}
          onClipModel={handleClipModel}
          cabinetMode={cabinetMode} onToggleCabinet={toggleCabinetExclusive}
          chargingMode={chargingMode} onToggleCharging={toggleChargingExclusive}
          deviceAreaMode={deviceAreaMode} onToggleDeviceArea={toggleDeviceAreaExclusive}
          pathMode={pathMode} onTogglePath={togglePathExclusive}
          onUndo={drawingHistory.undo}
          onRedo={drawingHistory.redo}
          canUndo={drawingHistory.canUndo}
          canRedo={drawingHistory.canRedo}
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
          treeKey={treeKey} onLoadLas={handleLoadLasFromPathWithHistoryReset}
          onToggleVisible={handleToggleVisibleWithHistoryReset}
          onUnloadMapFile={handleUnloadModelFromPathWithHistoryReset}
          loadedFiles={loadedFiles} loadingFile={loadingFile}
          onCabinetCheck={handleCabinetCheck}
          mapDrawingShown={drawingShown} onToggleDrawing={handleToggleDrawingWithHistoryReset}
          mapPathShown={pathShown} onTogglePath={handleTogglePathFileWithHistoryReset}
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
          onCabinetClose={handleToggleCabinet}
          onCabinetSave={handleSaveCabinet}
          onCabinetDraftChange={handleCabinetDraftChange}
          onCabinetNamesChange={setCabinetNames}
          chargingMode={chargingMode}
          chargingPointCount={chargingPointCount}
          chargingHeight={chargingHeight}
          onChargingClose={handleToggleCharging}
          onChargingSave={handleChargingSave}
          onChargingSetHeight={handleChargingSetHeight}
          deviceAreaMode={deviceAreaMode}
          deviceAreaBoxCount={deviceAreaBoxCount}
          deviceAreaHeight={deviceAreaHeight}
          deviceAreaSelectedBoxId={deviceAreaSelectedBoxId}
          deviceAreaSelectedBoxBay={deviceAreaSelectedBoxBay}
          deviceAreaBoundBayIds={new Set([...getBoundBayIds(), ...projectBoundBayIds])}
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
