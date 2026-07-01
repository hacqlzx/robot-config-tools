import { useRef, useEffect, useCallback, useState } from "react";
import { ThreeDEngine, type ThreeDEngineOptions } from "./ThreeDEngine";
import { PointCloudLoader, type PointCloudLoaderCallbacks, type LoadedModel } from "./PointCloudLoader";
import { DrawingRenderer } from "./DrawingRenderer";

interface UseThreeDEngineParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  engineOptions?: ThreeDEngineOptions;
}

/** 仅封装 ThreeDEngine 生命周期的轻量 hook，供需要自行管理 loader / drawing 的场景 */
export function useThreeDEngine({
  canvasRef,
  containerRef,
  engineOptions,
}: UseThreeDEngineParams) {
  const engineRef = useRef<ThreeDEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const engine = new ThreeDEngine(canvas, engineOptions);
    engine.observeResize(container);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  return engineRef;
}

interface UseThreeDViewerParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  engineOptions?: ThreeDEngineOptions;
  onSelect?: (info: { type: "cabinet" | "device-area" | "charging-area"; bayId: number }) => void;
}

/**
 * 统一 3D 查看器 Hook — 引擎 + 点云加载 + 绘制回显 + loading 状态
 *
 * 适用于勘察图片等简单使用场景，空间编辑应使用 useThreeDEngine + 自行管理 loader。
 */
export function useThreeDViewer({
  canvasRef,
  containerRef,
  engineOptions,
  onSelect,
}: UseThreeDViewerParams) {
  const engineRef = useRef<ThreeDEngine | null>(null);
  const loaderRef = useRef<PointCloudLoader | null>(null);
  const drawingRef = useRef<DrawingRenderer | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingFile, setLoadingFile] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const engine = new ThreeDEngine(canvas, engineOptions);
    engine.observeResize(container);
    engineRef.current = engine;

    const loader = new PointCloudLoader(engine.app, {
      onProgress: (pct) => setProgress(pct),
      onFileLoaded: () => {},
    });
    loaderRef.current = loader;

    const drawing = new DrawingRenderer(engine.app, engine.cameraEntity, () => engine.requestRender());
    drawing.onSelect = onSelect;
    drawingRef.current = drawing;

    return () => {
      drawing.destroy();
      loader.destroy();
      engine.destroy();
      engineRef.current = null;
      loaderRef.current = null;
      drawingRef.current = null;
    };
  }, []);

  const loadFile = useCallback(async (filePath: string): Promise<LoadedModel> => {
    if (!loaderRef.current) throw new Error("引擎未初始化");
    const name = filePath.split(/[\\/]/).pop() || "unknown";
    setLoading(true);
    setLoadingFile(name);
    setProgress(0);
    try {
      const model = await loaderRef.current.loadLasFromPath(filePath);
      engineRef.current?.requestRender();
      return model;
    } finally {
      setLoading(false);
      setLoadingFile("");
      setProgress(0);
    }
  }, []);

  const loadDrawing = useCallback(async (filePath: string) => {
    await drawingRef.current?.loadJson(filePath);
    engineRef.current?.requestRender();
  }, []);

  return {
    loadFile,
    loadDrawing,
    loading,
    loadingFile,
    progress,
    engineRef,
    loaderRef,
    drawingRef,
    requestRender: () => engineRef.current?.requestRender(),
    focusOn: (cx: number, cy: number, cz: number, extent: number) => engineRef.current?.focusOn(cx, cy, cz, extent),
  };
}
