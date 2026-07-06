import { useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { PointCloudLoader } from "../../../components/three-d-engine/PointCloudLoader";

interface UseLasLoaderParams {
  appRef: React.MutableRefObject<pc.Application | null>;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  pointStatsRef: React.MutableRefObject<Map<string, { total: number; loaded: number }>>;
  modelGroundYRef: React.MutableRefObject<number>;
  requestRender: () => void;
  focusOnModel: (cx: number, cy: number, cz: number, extent: number) => void;
  setLoading: (v: boolean) => void;
  setLoadingFile: (v: string) => void;
  setLoadingText: (v: string) => void;
  setLoadingProgress: (v: number) => void;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useLasLoader({
  appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, modelGroundYRef,
  requestRender, focusOnModel,
  setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
  setLoadedFiles,
}: UseLasLoaderParams) {
  const loaderRef = useRef<PointCloudLoader | null>(null);

  // 当 app 就绪时初始化 loader，每次 app 变化时重建
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const loader = new PointCloudLoader(app, {
      onProgress: (pct) => setLoadingProgress(pct),
      onFileLoaded: (name) => {},
    });
    loaderRef.current = loader;
    return () => {
      loader.destroy();
      loaderRef.current = null;
    };
  }, []);

  const syncRefs = () => {
    const loader = loaderRef.current;
    if (!loader) return;
    entitiesRef.current = loader.entities;
    lasHeadersRef.current = loader.lasHeaders;
    filePathRef.current = loader.filePaths;
    pointStatsRef.current = loader.pointStats;
  };

  const loadLasFromPath = useCallback(async (filePath: string) => {
    const loader = loaderRef.current;
    if (!loader) return;
    const fileName = filePath.split(/[\\/]/).pop() || "unknown.las";
    setLoading(true);
    setLoadingFile(fileName);
    setLoadingText("正在加载模型...");
    try {
      const model = await loader.loadLasFromPath(filePath);
      syncRefs();
      modelGroundYRef.current = model.groundY;
      focusOnModel(model.center[0], model.center[1], model.center[2], model.extent);
      requestRender();
      setLoadedFiles((prev) => new Set([...prev, fileName]));
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
