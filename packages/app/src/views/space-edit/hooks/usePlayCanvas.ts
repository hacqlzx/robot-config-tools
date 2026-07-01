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
    engineRef.current?.requestRender();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const engine = new ThreeDEngine(canvas);
    engine.observeResize(container);
    engineRef.current = engine;
    const app = engine.app;
    const camera = engine.cameraEntity;
    appRef.current = app;
    orbitRef.current = engine.orbit;

    const pathCleanup = setupPathDrawing(app, camera, requestRender, entitiesRef);
    const cabinetCleanup = setupCabinetDrawing(app, camera, requestRender, entitiesRef);
    const chargingCleanup = setupChargingAreaDrawing(app, camera, requestRender, entitiesRef);
    const deviceAreaCleanup = setupDeviceAreaDrawing(app, camera, requestRender, entitiesRef);
    const viewer = new CabinetViewer(app, camera, () => engine.requestRender());
    cabinetViewerRef.current = viewer;

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
