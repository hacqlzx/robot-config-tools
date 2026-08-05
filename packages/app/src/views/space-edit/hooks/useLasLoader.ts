import { useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { PointCloudLoader } from "../../../components/three-d-engine/PointCloudLoader";
import type { FileSource } from "../../../components/three-d-engine/file-source";
import type { ModelPointStats } from "../types";
import { loadedFileKey } from "../utils/space-paths";

interface UseLasLoaderParams {
  /** PlayCanvas Application，由空间编辑专用引擎初始化。 */
  appRef: React.MutableRefObject<pc.Application | null>;
  /** 加载后的模型实体索引，和 PointCloudLoader 内部 Map 保持同步引用。 */
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  /** LAS/LAZ 文件头信息，裁切保存和坐标转换会读取 header bbox/scale/offset。 */
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  /** 实体名到模型绝对路径映射，用于地图树可见性、保存和同目录文件推导。 */
  filePathRef: React.MutableRefObject<Map<string, string>>;
  /** 模型点数统计：total 为原始点数，loaded 为降采样后实际上传点数。 */
  pointStatsRef: React.MutableRefObject<Map<string, ModelPointStats>>;
  /** 当前模型推算地面高度，用作区域绘制默认底面。 */
  modelGroundYRef: React.MutableRefObject<number>;
  /** 通知 PlayCanvas 按需渲染一帧。 */
  requestRender: () => void;
  /** 根据模型局部中心和范围聚焦相机。 */
  focusOnModel: (cx: number, cy: number, cz: number, extent: number) => void;
  /** loading 状态 setter：空间编辑页顶部/遮罩使用。 */
  setLoading: (v: boolean) => void;
  setLoadingFile: (v: string) => void;
  setLoadingText: (v: string) => void;
  setLoadingProgress: (v: number) => void;
  /** 当前已加载文件 key 集合，用于地图树勾选状态。 */
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** 可替换文件读取源；默认走 Electron IPC，测试或其他环境可注入自定义实现。 */
  fileSource?: FileSource;
}

export function useLasLoader({
  appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef,
  requestRender, focusOnModel,
  setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
  setLoadedFiles,
  fileSource,
}: UseLasLoaderParams) {
  const loaderRef = useRef<PointCloudLoader | null>(null);
  const activeLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
  const latestLoadRequestRef = useRef(0);

  // 当 app 就绪时初始化 loader。这里仍保留 space-edit 自己的 ref 同步，
  // 因为裁切、可见性、保存状态都需要直接访问已加载实体和 LAS header。
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const loader = new PointCloudLoader(app, {
      onProgress: (pct) => setLoadingProgress(pct),
      onFileLoaded: (name) => {},
    }, fileSource);
    loaderRef.current = loader;
    return () => {
      loader.destroy();
      loaderRef.current = null;
    };
  }, []);

  const syncRefs = () => {
    const loader = loaderRef.current;
    if (!loader) return;
    // PointCloudLoader 持有真实 Map；同步引用而不是拷贝，避免 remove/destroy 后状态不同步。
    entitiesRef.current = loader.entities;
    lasHeadersRef.current = loader.lasHeaders;
    filePathRef.current = loader.filePaths;
    pointStatsRef.current = loader.pointStats;
  };

  const removeLoadedFile = (loader: PointCloudLoader, fileKey: string) => {
    // 用 loadedFileKey 比较而不是实体名比较，兼容 map.las 这种实体名取父目录的情况。
    for (const [name, loadedPath] of Array.from(loader.filePaths.entries())) {
      if (loadedFileKey(loadedPath) !== fileKey) continue;
      loader.entities.get(name)?.destroy();
      loader.entities.delete(name);
      loader.lasHeaders.delete(name);
      loader.filePaths.delete(name);
      loader.pointStats.delete(name);
    }
    setLoadedFiles((prev) => {
      if (!prev.has(fileKey)) return prev;
      const next = new Set(prev);
      next.delete(fileKey);
      return next;
    });
  };

  const loadLasFromPath = useCallback(async (filePath: string) => {
    const loader = loaderRef.current;
    if (!loader) return;
    const fileKey = loadedFileKey(filePath);
    const existingLoad = activeLoadsRef.current.get(fileKey);
    if (existingLoad) return existingLoad;
    const alreadyLoaded = Array.from(loader.filePaths.values()).some((loadedPath) => loadedFileKey(loadedPath) === fileKey);
    if (alreadyLoaded) {
      setLoadedFiles((prev) => prev.has(fileKey) ? prev : new Set([...prev, fileKey]));
      return;
    }

    const requestId = ++latestLoadRequestRef.current;
    const loadPromise = (async () => {
      setLoading(true);
      setLoadingFile(fileKey);
      setLoadingText("正在加载模型...");
      try {
        const model = await loader.loadLasFromPath(filePath);
        if (requestId !== latestLoadRequestRef.current) {
          // 用户快速切换模型时，旧加载任务可能后完成；完成后立即清理，避免旧地图重新出现在场景里。
          removeLoadedFile(loader, fileKey);
          syncRefs();
          requestRender();
          return;
        }
        syncRefs();
        // 地面 Y 来自点云高度直方图，用作充电区/设备区默认底面，避免第一点高度漂浮。
        modelGroundYRef.current = model.groundY;
        // loader 返回的是局部坐标中心，必须直接用于相机聚焦。
        focusOnModel(model.center[0], model.center[1], model.center[2], model.extent);
        requestRender();
        setLoadedFiles((prev) => new Set([...prev, fileKey]));
      } catch (e: any) {
        if (requestId === latestLoadRequestRef.current) console.error("LAS 加载失败:", e.message);
      } finally {
        activeLoadsRef.current.delete(fileKey);
        if (requestId === latestLoadRequestRef.current) {
          setLoading(false);
          setLoadingFile("");
          setLoadingText("");
          setLoadingProgress(0);
        }
      }
    })();
    activeLoadsRef.current.set(fileKey, loadPromise);
    return loadPromise;
  }, [focusOnModel, requestRender, setLoadedFiles]);

  return { loadLasFromPath };
}
