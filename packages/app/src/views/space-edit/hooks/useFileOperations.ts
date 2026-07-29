import { useCallback } from "react";
import { Modal } from "antd";
import * as pc from "playcanvas";
import { parsePointExcel } from "@/utils/excel-parser";
import { getSelectedProject } from "@/stores/appContextStore";
import type { ModelPointStats, SpaceMessageApi } from "../types";
import { POINT_TABLE_DIR_NAME, POINT_TABLE_FILE_RE, isLasOrLazFileName, isZipFileName, loadedFileKey, pointTableFileSubPath, stripModelExtension } from "../utils/space-paths";

interface UseFileOperationsParams {
  /** PlayCanvas 实体 Map，key 为模型名称 */
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  /** LAS 文件头信息 Map，key 同 entitiesRef */
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  /** 实体对应的文件绝对路径 Map */
  filePathRef: React.MutableRefObject<Map<string, string>>;
  /** 每个模型的点数统计信息 */
  pointStatsRef: React.MutableRefObject<Map<string, ModelPointStats>>;
  /** 当前已加载模型推算的地面 Y 坐标（场景坐标系），用于绘制高度对齐 */
  modelGroundYRef: React.MutableRefObject<number>;
  /** 是否已自动聚焦到模型，防止重复触发 */
  hasAutoFocusedRef: React.MutableRefObject<boolean>;
  /** 从磁盘路径加载 LAS/LAZ 到 GPU 的函数 */
  loadLasFromPath: (filePath: string) => Promise<void>;
  /** 请求 PlayCanvas 重新渲染一帧 */
  requestRender: () => void;
  /** 关闭所有绘制模式（屏柜/充电区/设备区/路径） */
  closeAllDrawingModes: () => void;
  setImporting: React.Dispatch<React.SetStateAction<boolean>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadingFile: React.Dispatch<React.SetStateAction<string>>;
  setLoadingText: React.Dispatch<React.SetStateAction<string>>;
  setLoadingProgress: React.Dispatch<React.SetStateAction<number>>;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 变更树 key 强制刷新地图/文件树 */
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  setClipEntityName: React.Dispatch<React.SetStateAction<string>>;
  setClipMode: React.Dispatch<React.SetStateAction<boolean>>;
  message: SpaceMessageApi;
}

/**
 * 替换空间模型前的二次确认弹窗。
 * 使用 Modal.confirm 静态方法（不在 React 树内），返回 Promise<boolean>。
 * 注意：此处不受 ConfigProvider centered 配置影响，如需居中需单独设置。
 */
function confirmReplaceModel(plan: { mapCode: string; mapName: string; existingMapName?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: "确认替换空间模型",
      content: `检测到地图编码 ${plan.mapCode || "未填写"} 已存在，将全量替换地图"${plan.existingMapName || plan.mapName}"。是否继续？`,
      okText: "替换",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * 空间编辑页的文件操作 Hook，集中管理：
 * - 从路径加载 LAS/LAZ 模型
 * - 导入点表 Excel
 * - 导入空间模型文件（LAS/LAZ/ZIP）
 * - 切换模型可见性（已加载则卸载，未加载则加载）
 * - 卸载指定路径的模型（用于删除前清理 GPU 实体）
 * - 进入裁切模式
 *
 * 重要：所有需要读取当前项目的操作均通过 getSelectedProject() 在调用时实时读取
 * store 的值，而非在 hook 初始化时捕获 React 渲染时的快照。
 * 这样可以确保在 LoadModelModal 弹窗内切换项目后，导入操作仍能读到最新的项目名。
 */
export function useFileOperations(params: UseFileOperationsParams) {
  const { entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef, hasAutoFocusedRef,
    loadLasFromPath, requestRender, closeAllDrawingModes,
    setImporting, setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
    setLoadedFiles, setTreeKey, setClipEntityName, setClipMode, message } = params;

  /**
   * 路径标准化：将 Windows 反斜杠统一为正斜杠并转小写，
   * 用于跨平台比较文件路径是否相等。
   */
  const normalizePath = (value: string) => value.replace(/\\/g, "/").toLowerCase();

  /**
   * 清空当前所有已加载的模型实体及相关索引。
   * 切换地图或导入新模型前必须调用，避免旧实体残留导致可见性树错乱。
   */
  const clearLoadedModels = useCallback(() => {
    entitiesRef.current.forEach((ent) => ent.destroy());
    entitiesRef.current.clear();
    lasHeadersRef.current.clear();
    filePathRef.current.clear();
    pointStatsRef.current.clear();
    setLoadedFiles(new Set());
    modelGroundYRef.current = -Infinity;
    hasAutoFocusedRef.current = false;
    requestRender();
  }, [
    entitiesRef,
    filePathRef,
    hasAutoFocusedRef,
    lasHeadersRef,
    modelGroundYRef,
    pointStatsRef,
    requestRender,
    setLoadedFiles,
  ]);

  /**
   * 从磁盘路径加载模型（地图树点击时使用）。
   * 切换前先关闭所有绘制模式，防止新旧模型的点云坐标混用导致绘制偏移。
   */
  const handleLoadLasFromPath = useCallback(async (filePath: string) => {
    closeAllDrawingModes();
    clearLoadedModels();
    await loadLasFromPath(filePath);
  }, [clearLoadedModels, closeAllDrawingModes, loadLasFromPath]);

  /**
   * 点表 Excel 导入。
   * 流程：解析 Excel → 清理旧点表文件 → 写入项目目录 → 数据库 upsert。
   * 当前厂站编码由名称+时间尾号临时生成，后续接正式编码源后需替换。
   */
  const handleImportPointTable = useCallback(async (file: File) => {
    setImporting(true);
    try {
      const { rows, stationName } = await parsePointExcel(file);
      if (rows.length === 0) { message.warning("Excel 中无有效数据行"); setImporting(false); return; }
      if (!stationName) { message.warning("Excel 中未找到厂站名称"); setImporting(false); return; }

      const api = (window as any).electronAPI;
      if (!api) { message.warning("仅 Electron 模式下可用"); setImporting(false); return; }

      // 实时读取 store，确保获取最新项目名
      const project = getSelectedProject();
      if (!project) {
        message.warning("请先在顶部菜单栏选择一个项目");
        return;
      }

      // 一个项目只保留一份点表文件，新导入前先删除旧文件
      const ext = file.name.match(/\.(xlsx|xls)$/i)?.[0] || ".xlsx";
      const savedName = `${stationName}${ext}`;
      try {
        const pointTableFiles = await api.project.listTree(project, POINT_TABLE_DIR_NAME);
        for (const node of pointTableFiles) {
          if (!node.isDir && POINT_TABLE_FILE_RE.test(node.name)) await api.project.deletePath(node.path);
        }
      } catch {}
      const arrayBuf = await file.arrayBuffer();
      const savedSubPath = pointTableFileSubPath(savedName);
      await api.project.writeFile(project, savedSubPath, arrayBuf);

      // 数据库导入需要厂站编码；当前客户端未接正式编码源，先按名称+时间尾号生成
      const stationCode = stationName.substring(0, 10) + Date.now().toString().slice(-4);
      const result = await api.importPoints(rows, stationName, stationCode, project);

      message.success(`导入成功: ${result.inserted} 新增, ${result.updated} 更新, 文件已保存至 ${savedSubPath}`);
      if (result.errors.length > 0) message.warning("错误: " + result.errors.slice(0, 3).join("; "));
    } catch (e: any) {
      message.error("导入失败: " + e.message);
    } finally {
      setImporting(false);
    }
  }, [setImporting, message]);

  /**
   * 导入空间模型文件（LAS/LAZ 或 ZIP 空间模型包）。
   *
   * LAS/LAZ 流程：复制到项目地图目录 → 加载到 GPU。
   * ZIP 流程：检查是否存在同编码地图（willReplace）→ 二次确认替换 → 解压导入 → 加载。
   *
   * 注意：通过 getSelectedProject() 在调用时读取最新项目，
   * 而非依赖 React hook 的渲染时闭包，避免 LoadModelModal 内切换项目后读到旧值。
   */
  const handleFileSelect = useCallback(async (file: File) => {
    const isPointCloud = isLasOrLazFileName(file.name);
    const isZip = isZipFileName(file.name);
    if (!isPointCloud && !isZip) {
      message.warning("仅支持 LAS/LAZ 模型文件或 ZIP 空间模型包");
      return;
    }

    if (!window.electronAPI) {
      message.warning("模型导入仅 Electron 模式可用");
      return;
    }

    // 调用时从 store 实时读取，确保能获取弹窗内刚写入的最新项目名
    const project = getSelectedProject();
    if (!project) {
      message.warning("请先选择一个项目");
      return;
    }

    setLoading(true);
    setLoadingFile(file.name);
    setLoadingProgress(0);
    setLoadingText(isZip ? "正在检查空间模型包..." : "正在准备导入模型...");

    try {
      const sourcePath = window.electronAPI.getFilePath(file);
      if (!sourcePath) throw new Error("无法读取源文件路径");
      let targetPath = "";
      let replaced = false;
      if (isZip) {
        // 检查是否会覆盖同编码的已有地图
        const plan = await window.electronAPI.project.inspectModelZipImport(project, sourcePath);
        if (plan.willReplace) {
          setLoading(false);
          setLoadingText("");
          const confirmed = await confirmReplaceModel(plan);
          if (!confirmed) {
            setLoadingFile("");
            setLoadingProgress(0);
            return;
          }
          setLoading(true);
          setLoadingFile(file.name);
          setLoadingProgress(0);
          replaced = true;
        }
        setLoadingText(replaced ? "正在替换并解压空间模型包..." : "正在解压导入空间模型包...");
        const result = await window.electronAPI.project.importModelZip(project, sourcePath);
        targetPath = result.modelPath;
      } else {
        const baseName = stripModelExtension(file.name);
        setLoadingText("正在导入模型文件...");
        targetPath = await window.electronAPI.project.importFile(project, sourcePath, baseName);
      }

      closeAllDrawingModes();
      // 导入新模型等价于切换当前地图：清空旧 GPU 实体和 loader 侧索引，避免可见性树误操作旧实体
      clearLoadedModels();
      await loadLasFromPath(targetPath);
      setTreeKey((k) => k + 1);
      message.success(isZip ? (replaced ? "空间模型包替换成功" : "空间模型包导入成功") : "模型导入成功");
    } catch (err: any) {
      message.error("模型导入失败: " + (err?.message || err));
    } finally {
      setLoading(false);
      setLoadingFile("");
      setLoadingText("");
      setLoadingProgress(0);
    }
  }, [
    clearLoadedModels,
    closeAllDrawingModes,
    loadLasFromPath,
    message,
    setLoading,
    setLoadingFile,
    setLoadingProgress,
    setLoadingText,
    setTreeKey,
  ]);

  /**
   * 仅卸载指定路径对应的 GPU 实体，不触发重新加载。
   * 在删除地图文件前调用，防止删除后仍有残留实体占用内存。
   * 路径完全匹配才卸载，防止同名文件位于不同地图目录时误删其他实体。
   * 返回 true 表示卸载成功，false 表示未找到对应实体。
   */
  const handleUnloadModelFromPath = useCallback((filePath: string) => {
    const targetPath = normalizePath(filePath);
    const entityName = Array.from(filePathRef.current.entries())
      .find(([, loadedPath]) => normalizePath(loadedPath) === targetPath)?.[0];
    if (!entityName) return false;
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
      next.delete(loadedFileKey(filePath));
      return next;
    });
    requestRender();
    return true;
  }, [entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, setLoadedFiles, requestRender]);

  /**
   * 切换模型可见性（地图树勾选框）。
   * 已加载则卸载（GPU 实体销毁），未加载则清空当前并加载目标模型。
   * 树节点的勾选状态由 loadedFiles 集合和实体 Map 间接反映，不单独维护。
   */
  const handleToggleVisible = useCallback((filePath: string) => {
    if (handleUnloadModelFromPath(filePath)) return;
    closeAllDrawingModes();
    clearLoadedModels();
    loadLasFromPath(filePath);
  }, [clearLoadedModels, handleUnloadModelFromPath, loadLasFromPath, closeAllDrawingModes]);

  /**
   * 进入裁切模式。
   * 要求当前有且仅有一个可见模型；若存在隐藏实体会先销毁，减少裁切时误读多模型的风险。
   */
  const handleClipModel = useCallback(() => {
    const entries = Array.from(entitiesRef.current.entries());
    if (entries.length === 0) { message.warning("请先加载模型"); return; }

    // 销毁所有隐藏实体，确保裁切只针对当前可见模型
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
