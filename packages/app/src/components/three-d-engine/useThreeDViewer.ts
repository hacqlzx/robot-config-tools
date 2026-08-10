import { useRef, useEffect, useCallback, useState } from "react";
import { ThreeDEngine, type ThreeDEngineOptions } from "./ThreeDEngine";
import { PointCloudLoader, type LoadedModel } from "./PointCloudLoader";
import { DrawingRenderer, type DrawingRendererSelectInfo } from "./DrawingRenderer";
import type { DrawingRenderData } from "./drawing-data";
import type { FileSource } from "./file-source";

interface UseThreeDEngineParams {
  /** 由调用页面持有的 canvas ref。 */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** canvas 外层容器 ref，用于 ResizeObserver 计算真实显示尺寸。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 透传给 ThreeDEngine 的相机、背景、灯光配置。 */
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
  /** 点云/绘制回显使用的 canvas。 */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** canvas 容器，用于自适应尺寸。 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 3D 引擎显示参数。 */
  engineOptions?: ThreeDEngineOptions;
  /** 文件读取源；默认 Electron IPC，单测或浏览器 demo 可注入。 */
  fileSource?: FileSource;
  /** 区域/路径点击选中回调，用于联动右侧点表或树。 */
  onSelect?: (info: DrawingRendererSelectInfo) => void;
}

/**
 * 统一 3D 查看器 Hook — 引擎 + 点云加载 + 绘制回显 + loading 状态
 *
 * 适用于勘察图片等简单使用场景，空间编辑应使用 useThreeDEngine + 自行管理 loader。
 *
 * 这个 Hook 是“只读/轻交互”组合层：调用方给它 canvas 和文件路径，它负责加载点云、
 * 加载绘制 JSON、聚焦相机和维护 loading。空间编辑页因为有复杂编辑状态、互斥绘制模式、
 * 保存和裁切流程，所以只复用底层 ThreeDEngine / PointCloudLoader。
 */
export function useThreeDViewer({
  canvasRef,
  containerRef,
  engineOptions,
  fileSource,
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
    }, fileSource);
    loaderRef.current = loader;

    const drawing = new DrawingRenderer(engine.app, engine.cameraEntity, () => engine.requestRender(), fileSource);
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
      // 点云 loader 返回的是已经做过 floating-origin 后的局部中心和范围。
      // 聚焦时必须使用这个局部坐标，不要再拿 LAS header 的全局坐标直接喂相机。
      engineRef.current?.focusOn(model.center[0], model.center[1], model.center[2], model.extent);
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

  const loadDrawingData = useCallback((data: DrawingRenderData | unknown) => {
    // 业务层如果已经按 manifest/文件名解析出数据，可以绕过 loadJson 的文件读取。
    // 这样 DrawingRenderer 就不需要知道项目目录结构。
    drawingRef.current?.loadData(data);
    engineRef.current?.requestRender();
  }, []);

  return {
    loadFile,
    loadDrawing,
    loadDrawingData,
    loading,
    loadingFile,
    progress,
    engineRef,
    loaderRef,
    drawingRef,
    requestRender: () => engineRef.current?.requestRender(),
    focusOn: (cx: number, cy: number, cz: number, extent: number) => engineRef.current?.focusOn(cx, cy, cz, extent),
    focusTopOn: (cx: number, cy: number, cz: number, extent: number) => engineRef.current?.focusTopOn(cx, cy, cz, extent),
    focusAlongDirection: (cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number) => (
      engineRef.current?.focusAlongDirection(cx, cy, cz, dx, dy, dz, extent)
    ),
  };
}
