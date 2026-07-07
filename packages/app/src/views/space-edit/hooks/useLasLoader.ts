import { useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { PointCloudLoader } from "../../../components/three-d-engine/PointCloudLoader";
import type { FileSource } from "../../../components/three-d-engine/file-source";
import type { ModelPointStats } from "../types";
import { loadedFileKey } from "../utils/space-paths";

interface UseLasLoaderParams {
  appRef: React.MutableRefObject<pc.Application | null>;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  pointStatsRef: React.MutableRefObject<Map<string, ModelPointStats>>;
  modelGroundYRef: React.MutableRefObject<number>;
  requestRender: () => void;
  focusOnModel: (cx: number, cy: number, cz: number, extent: number) => void;
  setLoading: (v: boolean) => void;
  setLoadingFile: (v: string) => void;
  setLoadingText: (v: string) => void;
  setLoadingProgress: (v: number) => void;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
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

  const loadLasFromPath = useCallback(async (filePath: string) => {
    const loader = loaderRef.current;
    if (!loader) return;
    const fileKey = loadedFileKey(filePath);
    setLoading(true);
    setLoadingFile(fileKey);
    setLoadingText("正在加载模型...");
    try {
      const model = await loader.loadLasFromPath(filePath);
      syncRefs();
      // 地面 Y 来自点云高度直方图，用作充电区/设备区默认底面，避免第一点高度漂浮。
      modelGroundYRef.current = model.groundY;
      // loader 返回的是局部坐标中心，必须直接用于相机聚焦。
      focusOnModel(model.center[0], model.center[1], model.center[2], model.extent);
      requestRender();
      setLoadedFiles((prev) => new Set([...prev, fileKey]));
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message);
    }
    setLoading(false);
    setLoadingFile("");
    setLoadingText("");
    setLoadingProgress(0);
  }, [focusOnModel, requestRender, setLoadedFiles]);

  return { loadLasFromPath };
}
