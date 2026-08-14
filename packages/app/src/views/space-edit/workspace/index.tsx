import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Modal } from "antd";
import { CloudOutlined } from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
import { useSelectedProject } from "@/stores/appContextStore";
import { parsePointExcel } from "@/utils/excel-parser";
import ExportModal from "../components/ExportModal";
import LoadModelModal from "../components/LoadModelModal";
import SidePanel from "../components/SidePanel";
import SpaceEditLayout from "../components/SpaceEditLayout";
import Toolbar from "../components/Toolbar";
import ViewCube from "../components/ViewCube";
import {
  POINT_TABLE_DIR_NAME,
  POINT_TABLE_FILE_RE,
  isZipFileName,
  loadedFileKey,
  pointTableFileSubPath,
  stripModelExtension,
} from "../utils/space-paths";
import ModelLoadingOverlay from "./components/ModelLoadingOverlay";
import PotreeRenderSettings from "./components/PotreeRenderSettings";
import SpaceSceneHost from "./components/SpaceSceneHost";
import { PotreeSpaceSceneAdapter } from "./engine/PotreeSpaceSceneAdapter";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  normalizeSpaceRenderSettings,
  type SpaceRenderSettings,
} from "./engine/types";

const RENDER_SETTINGS_STORAGE_KEY = "space-edit:potree-render-settings";

interface LoadingState {
  modelPath: string | null;
  title: string;
  message: string;
  percent?: number;
}

interface MapModelItem {
  mapName: string;
  modelPath: string;
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

export default function SpaceEditWorkspace() {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const adapter = useMemo(() => new PotreeSpaceSceneAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);
  const containerRef = useRef<HTMLDivElement>(null);
  const operationVersion = useRef(0);
  const modelBusyRef = useRef(false);
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null);
  const [loading, setLoading] = useState<LoadingState | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const [pointImporting, setPointImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderSettings, setRenderSettings] = useState(loadRenderSettings);
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
  const emptyPathSet = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    adapter.setRenderSettings(renderSettings);
    try {
      window.localStorage.setItem(RENDER_SETTINGS_STORAGE_KEY, JSON.stringify(renderSettings));
    } catch {
      // Rendering still works when storage is unavailable.
    }
  }, [adapter, renderSettings]);

  useEffect(() => {
    operationVersion.current += 1;
    modelBusyRef.current = false;
    setActiveModelPath(null);
    setLoading(null);
    adapter.clearModel();
  }, [adapter, selectedProject]);

  useEffect(() => {
    const api = window.electronAPI?.potree;
    if (!api) return;
    return api.onConversionProgress((progress) => {
      setLoading((current) => {
        if (!current?.modelPath || progress.projectName !== selectedProject) return current;
        if (loadedFileKey(current.modelPath) !== loadedFileKey(progress.modelPath)) return current;
        return { ...current, message: progress.message, percent: progress.percent };
      });
    });
  }, [selectedProject]);

  const notifyPending = useCallback((feature: string) => {
    message.info(`${feature}正在迁移到 Potree`);
  }, [message]);

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
    const version = ++operationVersion.current;
    setLoading({ modelPath: item.modelPath, title: item.mapName, message: "正在检查 Potree 数据", percent: 2 });

    try {
      const result = await api.ensureModel(selectedProject, item.modelPath);
      if (version !== operationVersion.current) return;
      setLoading({ modelPath: item.modelPath, title: item.mapName, message: "正在加载点云层级", percent: 98 });
      await adapter.loadModel({ name: item.mapName, metadataUrl: result.metadataUrl });
      if (version !== operationVersion.current) return;
      setActiveModelPath(item.modelPath);
      if (result.generated) message.success("模型转换并加载完成");
    } catch (error) {
      if (version === operationVersion.current) message.error(errorMessage(error));
    } finally {
      if (version === operationVersion.current) setLoading(null);
      modelBusyRef.current = false;
    }
  }, [adapter, message, selectedProject]);

  const clearModel = useCallback((modelPath?: string) => {
    if (modelPath && activeModelPath && loadedFileKey(modelPath) !== loadedFileKey(activeModelPath)) return;
    operationVersion.current += 1;
    modelBusyRef.current = false;
    adapter.clearModel();
    setActiveModelPath(null);
    setLoading(null);
  }, [activeModelPath, adapter]);

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
    setLoading({ modelPath: null, title: file.name, message: "正在导入模型" });
    try {
      let modelPath: string;
      let mapName: string;
      if (isZipFileName(file.name)) {
        const plan = await electronApi.project.inspectModelZipImport(selectedProject, sourcePath);
        if (plan.willReplace && !(await confirmReplaceModel(plan))) return;
        adapter.clearModel();
        setActiveModelPath(null);
        const result = await electronApi.project.importModelZip(selectedProject, sourcePath);
        modelPath = result.modelPath;
        mapName = result.mapName;
      } else {
        adapter.clearModel();
        setActiveModelPath(null);
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
  }, [adapter, loadModel, message, selectedProject]);

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
    if (!activeModelPath) {
      message.warning("请先加载模型");
      return;
    }
    notifyPending("裁切模型");
  }, [activeModelPath, message, notifyPending]);

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
            onToggleCabinet={() => notifyPending("绘制屏柜")}
            onToggleCharging={() => notifyPending("绘制充电区域")}
            onToggleDeviceArea={() => notifyPending("绘制设备区域")}
            onTogglePath={() => notifyPending("可行路径设定")}
            onUndo={() => notifyPending("撤销")}
            onRedo={() => notifyPending("恢复")}
            canUndo
            canRedo
            onSaveAll={() => notifyPending("保存全部")}
            onImportPointTable={handleImportPointTable}
            onExportModel={() => setExportOpen(true)}
            importing={pointImporting}
          />
        )}
        viewControls={<ViewCube onViewChange={() => notifyPending("视角切换")} />}
        sidePanel={(
          <SidePanel
            panelWidth={panelWidth}
            treeKey={treeKey}
            onLoadLas={handleLoadFromTree}
            onToggleVisible={handleToggleFromTree}
            onUnloadMapFile={clearModel}
            loadedFiles={loadedFiles}
            loadingFile={loading?.modelPath || ""}
            onCabinetCheck={(bayIds) => { if (bayIds.length > 0) notifyPending("屏柜回显"); }}
            mapDrawingShown={emptyPathSet}
            onToggleDrawing={() => notifyPending("区域回显")}
            mapPathShown={emptyPathSet}
            onTogglePath={() => notifyPending("路径回显")}
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
