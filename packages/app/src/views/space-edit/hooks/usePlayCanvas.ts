import { useRef, useEffect, useCallback } from "react";
import * as pc from "playcanvas";
import { SimpleOrbitCamera } from "../../../playcanvas-core/simple-camera";
import { CabinetViewer } from "../hooks/drawing/CabinetViewer";

interface UsePlayCanvasParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  /** 屏柜绘制初始化 */
  setupCabinetDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  /** 充电区域绘制初始化 */
  setupChargingAreaDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  /** 设备区域绘制初始化 */
  setupDeviceAreaDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  /** 路径绘制初始化 */
  setupPathDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  /** 充电区域绘制器引用 */
  chargingDrawingRef: React.MutableRefObject<any>;
  /** 设备区域绘制器引用 */
  deviceAreaDrawingRef: React.MutableRefObject<any>;
  /** 路径绘制器引用 */
  pathDrawingRef: React.MutableRefObject<any>;
}

export function usePlayCanvas({
  canvasRef,
  containerRef,
  entitiesRef,
  setupCabinetDrawing,
  setupChargingAreaDrawing,
  setupDeviceAreaDrawing,
  setupPathDrawing,
  chargingDrawingRef,
  deviceAreaDrawingRef,
  pathDrawingRef,
}: UsePlayCanvasParams) {
  const appRef = useRef<pc.Application | null>(null);
  const orbitRef = useRef<SimpleOrbitCamera | null>(null);
  const cabinetViewerRef = useRef<CabinetViewer | null>(null);
  const renderDirtyRef = useRef(true);

  const requestRender = useCallback(() => {
    renderDirtyRef.current = true;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      componentSystems: [
        pc.AnimComponentSystem,
        pc.RenderComponentSystem,
        pc.CameraComponentSystem,
        pc.LightComponentSystem,
        pc.GSplatComponentSystem,
      ],
      resourceHandlers: [
        pc.RenderHandler,
        pc.AnimClipHandler,
        pc.TextureHandler,
        pc.CubemapHandler,
        pc.ContainerHandler,
        pc.GSplatHandler,
      ],
      graphicsDeviceOptions: {
        preferWebGl2: true,
        powerPreference: "high-performance",
        // 按需渲染(autoRender=false)下必须保留绘制缓冲，否则未重绘的帧缓冲被丢弃
        preserveDrawingBuffer: true,
      },
    } as any);

    let rafId: number;
    const doResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const cvs = canvasRef.current;
        const ct = containerRef.current;
        if (!cvs || !ct || !app.graphicsDevice) return;
        const rect = ct.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (w > 0 && h > 0 && (cvs.width !== w || cvs.height !== h)) {
          cvs.width = w;
          cvs.height = h;
          app.resizeCanvas(w, h);
        }
        renderDirtyRef.current = true;
      });
    };
    const observer = new ResizeObserver(doResize);
    observer.observe(container);
    window.addEventListener("resize", doResize);
    doResize();

    app.scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);
    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", color: pc.Color.WHITE, intensity: 1 });
    light.setEulerAngles(45, 45, 0);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", { fov: 60, clearColor: new pc.Color(0.12, 0.12, 0.12) });
    app.root.addChild(camera);

    const orbit = new SimpleOrbitCamera(app, camera, () => { renderDirtyRef.current = true; });
    orbitRef.current = orbit;
    app.graphicsDevice.maxPixelRatio = 1;

    // 关闭持续渲染循环，改用按需渲染
    app.autoRender = false;
    app.start();
    appRef.current = app;
    const pathCleanup = setupPathDrawing(app, camera, requestRender, entitiesRef);
    const cabinetCleanup = setupCabinetDrawing(app, camera, requestRender, entitiesRef);
    const chargingCleanup = setupChargingAreaDrawing(app, camera, requestRender, entitiesRef);
    const deviceAreaCleanup = setupDeviceAreaDrawing(app, camera, requestRender, entitiesRef);
    const viewer = new CabinetViewer(app, camera, requestRender);
    cabinetViewerRef.current = viewer;

    // 互斥选中：路径点选中时取消屏柜、充电区域、设备区选中
    pathDrawingRef.current?.setSelectChangeCallback((selected: boolean) => {
      if (selected) {
        viewer.deselect();
        chargingDrawingRef.current?.deselectBox();
        deviceAreaDrawingRef.current?.deselectAll();
      }
    });

    // 互斥选中：屏柜、充电区域、设备区同时只能选中一个
    viewer.setOnSelectChange((cabSelected: boolean) => {
      if (cabSelected) {
        chargingDrawingRef.current?.deselectBox();
        deviceAreaDrawingRef.current?.deselectAll();
        pathDrawingRef.current?.deselectPoint();
      }
    });
    chargingDrawingRef.current?.setOnSelectChange((chargingSelected: boolean) => {
      if (chargingSelected) {
        viewer.deselect();
        deviceAreaDrawingRef.current?.deselectAll();
        pathDrawingRef.current?.deselectPoint();
      }
    });
    deviceAreaDrawingRef.current?.setOnSelectChange((devAreaBoxId: any) => {
      if (devAreaBoxId) {
        viewer.deselect();
        chargingDrawingRef.current?.deselectBox();
        pathDrawingRef.current?.deselectPoint();
      }
    });

    // 统一渲染循环：每帧先更新相机飞行(WASD)，再按需渲染，避免飞行与渲染分属两个 rAF 循环导致顿挫
    let renderRafId = 0;
    let lastFrameTime = performance.now();
    const renderLoop = () => {
      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
      lastFrameTime = now;
      orbitRef.current?.updateFly(dt);
      if (renderDirtyRef.current) {
        app.render();
        renderDirtyRef.current = false;
      }
      renderRafId = requestAnimationFrame(renderLoop);
    };
    renderRafId = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener("resize", doResize);
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (renderRafId) cancelAnimationFrame(renderRafId);
      cabinetCleanup();
      chargingCleanup();
      deviceAreaCleanup();
      pathCleanup();
      viewer.destroy();
      cabinetViewerRef.current = null;
      orbit.destroy();
      app.destroy();
    };
  }, []);

  return { appRef, orbitRef, cabinetViewerRef, requestRender };
}
