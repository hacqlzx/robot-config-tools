import { useCallback } from "react";
import * as pc from "playcanvas";
import { parsePointExcel } from "@/utils/excel-parser";

interface UseFileOperationsParams {
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  pointStatsRef: React.MutableRefObject<Map<string, { total: number; loaded: number }>>;
  modelGroundYRef: React.MutableRefObject<number>;
  hasAutoFocusedRef: React.MutableRefObject<boolean>;
  loadLasFromPath: (filePath: string) => Promise<void>;
  requestRender: () => void;
  closeAllDrawingModes: () => void;
  setImporting: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  setClipEntityName: React.Dispatch<React.SetStateAction<string>>;
  setClipMode: React.Dispatch<React.SetStateAction<boolean>>;
  message: { success: (msg: string) => void; warning: (msg: string) => void; error: (msg: string) => void };
}

export function useFileOperations(params: UseFileOperationsParams) {
  const { entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef, hasAutoFocusedRef,
    loadLasFromPath, requestRender, closeAllDrawingModes,
    setImporting, setLoadedFiles, setTreeKey, setClipEntityName, setClipMode, message } = params;

  const normalizePath = (value: string) => value.replace(/\\/g, "/").toLowerCase();

  /** 从路径加载模型 */
  const handleLoadLasFromPath = useCallback(async (filePath: string) => {
    closeAllDrawingModes();
    hasAutoFocusedRef.current = false;
    await loadLasFromPath(filePath);
  }, [closeAllDrawingModes, loadLasFromPath, hasAutoFocusedRef]);

  /** 点表 Excel 导入 */
  const handleImportPointTable = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const { rows, stationName } = await parsePointExcel(file);
      if (rows.length === 0) { message.warning("Excel 中无有效数据行"); setImporting(false); return; }
      if (!stationName) { message.warning("Excel 中未找到厂站名称"); setImporting(false); return; }

      const api = (window as any).electronAPI;
      if (!api) { message.warning("仅 Electron 模式下可用"); setImporting(false); return; }

      const projectName = localStorage.getItem("selectedProject") || "默认项目";

      // 保存 Excel 到项目点表目录
      const ext = file.name.match(/\.(xlsx|xls)$/i)?.[0] || ".xlsx";
      const savedName = `${stationName}${ext}`;
      try {
        const pointTableFiles = await api.project.listTree(projectName, "点表");
        for (const node of pointTableFiles) {
          if (!node.isDir && /\.(xlsx|xls)$/i.test(node.name)) await api.project.deletePath(node.path);
        }
      } catch {}
      const arrayBuf = await file.arrayBuffer();
      await api.project.writeFile(projectName, `点表/${savedName}`, arrayBuf);

      const stationCode = stationName.substring(0, 10) + Date.now().toString().slice(-4);
      await api.startBatch();
      const result = await api.importPoints(rows, stationName, stationCode, projectName);
      await api.endBatch();

      message.success(`导入成功: ${result.inserted} 新增, ${result.updated} 更新, 文件已保存至 点表/${savedName}`);
      if (result.errors.length > 0) message.warning("错误: " + result.errors.slice(0, 3).join("; "));
    } catch (e: any) {
      message.error("导入失败: " + e.message);
    } finally {
      setImporting(false);
    }
  }, [setImporting, message, closeAllDrawingModes]);

  /** 选择模型文件 */
  const handleFileSelect = useCallback(async (file: File) => {
    if (!/\.(las|laz)$/i.test(file.name)) {
      message.warning("仅支持 LAS/LAZ 模型文件");
      return;
    }

    const selectedProject = localStorage.getItem("selectedProject");
    if (!window.electronAPI) {
      message.warning("模型导入仅 Electron 模式可用");
      return;
    }
    if (!selectedProject) {
      message.warning("请先在顶部菜单栏选择一个项目");
      return;
    }

    closeAllDrawingModes();
    entitiesRef.current.forEach((ent) => ent.destroy());
    entitiesRef.current.clear();
    lasHeadersRef.current.clear();
    filePathRef.current.clear();
    pointStatsRef.current.clear();
    setLoadedFiles(new Set());
    modelGroundYRef.current = -Infinity;
    hasAutoFocusedRef.current = false;

    try {
      const sourcePath = window.electronAPI.getFilePath(file);
      if (!sourcePath) throw new Error("无法读取源文件路径");
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const targetPath = await window.electronAPI.project.importFile(selectedProject, sourcePath, baseName);
      await loadLasFromPath(targetPath);
      setTreeKey((k) => k + 1);
    } catch (err: any) {
      message.error("模型导入失败: " + (err?.message || err));
    }
  }, [closeAllDrawingModes, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, setLoadedFiles, modelGroundYRef, hasAutoFocusedRef, loadLasFromPath, setTreeKey, message]);

  /** 仅卸载指定路径对应的模型；删除文件前使用，避免误触发加载 */
  const handleUnloadModelFromPath = useCallback((filePath: string) => {
    const entityName = filePath.split(/[\\/]/).pop() || filePath;
    const entity = entitiesRef.current.get(entityName);
    const loadedPath = filePathRef.current.get(entityName);
    if (!entity) return false;
    if (loadedPath && normalizePath(loadedPath) !== normalizePath(filePath)) return false;

    entity.destroy();
    entitiesRef.current.delete(entityName);
    lasHeadersRef.current.delete(entityName);
    filePathRef.current.delete(entityName);
    pointStatsRef.current.delete(entityName);
    setLoadedFiles((prev) => {
      const next = new Set(prev);
      next.delete(entityName);
      return next;
    });
    requestRender();
    return true;
  }, [entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, setLoadedFiles, requestRender]);

  /** 切换模型可见性 */
  const handleToggleVisible = useCallback((filePath: string) => {
    if (handleUnloadModelFromPath(filePath)) return;
    closeAllDrawingModes();
    loadLasFromPath(filePath);
  }, [handleUnloadModelFromPath, loadLasFromPath, closeAllDrawingModes]);

  /** 裁切模型 */
  const handleClipModel = useCallback(() => {
    const entries = Array.from(entitiesRef.current.entries());
    if (entries.length === 0) { message.warning("请先加载模型"); return; }

    entries.forEach(([key, ent]) => {
      if (!ent.enabled) { ent.destroy(); entitiesRef.current.delete(key); }
    });

    const visible = Array.from(entitiesRef.current.entries());
    if (visible.length > 1) { message.warning("存在多个可见模型，请只保留一个模型后再裁切"); return; }
    if (visible.length === 0) { message.warning("没有可见模型"); return; }

    setClipEntityName(visible[0][0]);
    setClipMode(true);
  }, [entitiesRef, setClipEntityName, setClipMode, message]);

  return { handleLoadLasFromPath, handleImportPointTable, handleFileSelect, handleToggleVisible, handleUnloadModelFromPath, handleClipModel };
}
