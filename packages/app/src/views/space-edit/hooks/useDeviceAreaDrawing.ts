import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { DeviceAreaDrawing, DeviceAreaDrawingOptions } from "./drawing/DeviceAreaDrawing";

interface UseDeviceAreaDrawingAPI {
  deviceAreaMode: boolean;
  boxCount: number;
  height: number;
  selectedBoxId: string | null;
  selectedBoxBay: { id: number; name: string; code: string } | null;
  handleToggleDeviceArea: () => void;
  handleUndo: () => void;
  handleBindBay: (bay: { id: number; name: string; code: string }) => void;
  handleUnbind: () => void;
  handleSave: () => void;
  handleSetHeight: (h: number) => void;
  getBoxDatas: () => { id: string; verts: number[][]; height: number; bay: { id: number; name: string; code: string } | null }[];
  getBoundBayIds: () => number[];
  loadBoxes: (datas: { id: string; verts: number[][]; height?: number; bay: { id: number; name: string; code: string } | null }[]) => void;
  setupDeviceAreaDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
  drawingRef: React.MutableRefObject<DeviceAreaDrawing | null>;
}

export function useDeviceAreaDrawing(
  onSave?: () => void,
): UseDeviceAreaDrawingAPI {
  const [deviceAreaMode, setDeviceAreaMode] = useState(false);
  const [boxCount, setBoxCount] = useState(0);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedBoxBay, setSelectedBoxBay] = useState<{ id: number; name: string; code: string } | null>(null);
  const [height, setHeight] = useState(2);
  const drawingRef = useRef<DeviceAreaDrawing | null>(null);
  const saveCbRef = useRef(onSave);
  saveCbRef.current = onSave;

  const setupDeviceAreaDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const drawing = new DeviceAreaDrawing(app, camera, requestRender, entitiesRef, {
      snap: true,
      onChange: (count) => {
        setBoxCount(count);
      },
      onSelectChange: (boxId) => {
        setSelectedBoxId(boxId);
        if (boxId) {
          const bay = drawing.getSelectedBoxBay();
          setSelectedBoxBay(bay);
          const h = drawing.getSelectedBoxHeight();
          if (h != null) setHeight(h);
        } else {
          setSelectedBoxBay(null);
        }
      },
    });
    drawingRef.current = drawing;
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(deviceAreaMode);
  }, [deviceAreaMode]);

  const handleToggleDeviceArea = useCallback(() => {
    setDeviceAreaMode((prev) => !prev);
  }, []);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  const handleBindBay = useCallback((bay: { id: number; name: string; code: string }) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.bindBayToSelected(bay);
    setSelectedBoxBay(bay);
  }, []);

  const handleUnbind = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.unbindSelected();
    setSelectedBoxBay(null);
  }, []);

  const handleSave = useCallback(() => {
    saveCbRef.current?.();
  }, []);

  const handleSetHeight = useCallback((h: number) => {
    setHeight(h);
    drawingRef.current?.setHeight(h);
  }, []);

  const getBoxDatas = useCallback(() => {
    return drawingRef.current?.getBoxDatas() ?? [];
  }, []);

  const getBoundBayIds = useCallback(() => {
    return drawingRef.current?.getBoundBayIds() ?? [];
  }, []);

  const loadBoxes = useCallback((datas: { id: string; verts: number[][]; height?: number; bay: { id: number; name: string; code: string } | null }[]) => {
    drawingRef.current?.loadBoxes(datas);
  }, []);

  return {
    deviceAreaMode, boxCount, height, selectedBoxId, selectedBoxBay,
    handleToggleDeviceArea, handleUndo, handleBindBay, handleUnbind, handleSave, handleSetHeight,
    getBoxDatas, getBoundBayIds, loadBoxes,
    setupDeviceAreaDrawing, drawingRef,
  };
}
