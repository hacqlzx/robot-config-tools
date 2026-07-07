import { useRef, useEffect, useCallback } from "react";
import * as pc from "playcanvas";
import { ThreeDEngine } from "../../../components/three-d-engine/ThreeDEngine";
import { SimpleOrbitCamera } from "../../../playcanvas-core/simple-camera";
import { CabinetViewer } from "../hooks/drawing/CabinetViewer";

interface UsePlayCanvasParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  setupCabinetDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  setupChargingAreaDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  setupDeviceAreaDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  setupPathDrawing: (app: pc.Application, camera: pc.Entity, reqRender: () => void, entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>) => () => void;
  chargingDrawingRef: React.MutableRefObject<any>;
  deviceAreaDrawingRef: React.MutableRefObject<any>;
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
  const engineRef = useRef<ThreeDEngine | null>(null);

  const requestRender = useCallback(() => {
    // space-edit 复用公共 ThreeDEngine 的按需渲染机制；所有绘制类只需要调用这个入口。
    engineRef.current?.requestRender();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // 空间编辑使用公共引擎提供 canvas/app/camera/orbit，但编辑状态由本 hook 组装。
    const engine = new ThreeDEngine(canvas);
    engine.observeResize(container);
    engineRef.current = engine;
    const app = engine.app;
    const camera = engine.cameraEntity;
    appRef.current = app;
    orbitRef.current = engine.orbit;

    // 绘制工具都绑定到同一个 canvas 和点云实体集合。setup 返回清理函数，保证卸载时移除事件监听。
    const pathCleanup = setupPathDrawing(app, camera, requestRender, entitiesRef);
    const cabinetCleanup = setupCabinetDrawing(app, camera, requestRender, entitiesRef);
    const chargingCleanup = setupChargingAreaDrawing(app, camera, requestRender, entitiesRef);
    const deviceAreaCleanup = setupDeviceAreaDrawing(app, camera, requestRender, entitiesRef);
    const viewer = new CabinetViewer(app, camera, () => engine.requestRender());
    cabinetViewerRef.current = viewer;

    // 同一时间只允许一种编辑对象处于选中态；否则 Delete、方向键和拖拽都会出现归属歧义。
    pathDrawingRef.current?.setSelectChangeCallback((selected: boolean) => {
      if (selected) {
        viewer.deselect();
        chargingDrawingRef.current?.deselectBox();
        deviceAreaDrawingRef.current?.deselectAll();
      }
    });

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

    return () => {
      // 销毁顺序：先清理业务绘制事件，再销毁只读 viewer，最后释放 PlayCanvas app。
      cabinetCleanup();
      chargingCleanup();
      deviceAreaCleanup();
      pathCleanup();
      viewer.destroy();
      cabinetViewerRef.current = null;
      engine.destroy();
      engineRef.current = null;
      appRef.current = null;
      orbitRef.current = null;
    };
  }, []);

  return { appRef, orbitRef, cabinetViewerRef, requestRender };
}
