import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { Modal } from "antd";
import { DeviceAreaDrawing, DeviceAreaDrawingOptions } from "./drawing/DeviceAreaDrawing";

interface UseDeviceAreaDrawingAPI {
  deviceAreaMode: boolean;
  boxCount: number;
  height: number;
  selectedBoxId: string | null;
  selectedBoxBay: { id: number; name: string; code: string } | null;
  handleToggleDeviceArea: () => void;
  handleForceCloseDeviceArea: () => void;
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
  markSaved: () => void;
}

export function useDeviceAreaDrawing(
  onSave?: () => void,
  onDelete?: () => void,
): UseDeviceAreaDrawingAPI {
  const [deviceAreaMode, setDeviceAreaMode] = useState(false);
  const [boxCount, setBoxCount] = useState(0);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedBoxBay, setSelectedBoxBay] = useState<{ id: number; name: string; code: string } | null>(null);
  const [height, setHeight] = useState(2);
  const drawingRef = useRef<DeviceAreaDrawing | null>(null);
  const dirtyRef = useRef(false);
  const isLoadingRef = useRef(false);
  const saveCbRef = useRef(onSave);
  saveCbRef.current = onSave;
  const deleteCbRef = useRef(onDelete);
  deleteCbRef.current = onDelete;

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
        if (!isLoadingRef.current) {
          dirtyRef.current = true;
        }
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
      onDelete: () => {
        deleteCbRef.current?.();
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
    setDeviceAreaMode((prev) => {
      if (prev) {
        if (dirtyRef.current) {
          Modal.confirm({
            title: "确认关闭",
            content: "关闭设备区将清除所有未保存的框和点，是否继续？",
            okText: "确认关闭",
            cancelText: "取消",
            onOk: () => {
              drawingRef.current?.clearAll();
              setDeviceAreaMode(false);
            },
          });
          return prev;
        }
      }
      return !prev;
    });
  }, []);

  /** 强制关闭设备区（用于互斥切换），仅清除未保存数据，保留已保存的框 */
  const handleForceCloseDeviceArea = useCallback(() => {
    if (dirtyRef.current) {
      drawingRef.current?.clearAll();
    } else {
      drawingRef.current?.setEnabled(false);
    }
    setDeviceAreaMode(false);
  }, []);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  const handleBindBay = useCallback((bay: { id: number; name: string; code: string }) => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.bindBayToSelected(bay);
    setSelectedBoxBay(bay);
    dirtyRef.current = true;
  }, []);

  const handleUnbind = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.unbindSelected();
    setSelectedBoxBay(null);
    dirtyRef.current = true;
  }, []);

  const handleSave = useCallback(() => {
    saveCbRef.current?.();
    dirtyRef.current = false;
  }, []);

  const handleSetHeight = useCallback((h: number) => {
    setHeight(h);
    drawingRef.current?.setHeight(h);
    dirtyRef.current = true;
  }, []);

  const getBoxDatas = useCallback(() => {
    return drawingRef.current?.getBoxDatas() ?? [];
  }, []);

  const getBoundBayIds = useCallback(() => {
    return drawingRef.current?.getBoundBayIds() ?? [];
  }, []);

  const loadBoxes = useCallback((datas: { id: string; verts: number[][]; height?: number; bay: { id: number; name: string; code: string } | null }[]) => {
    isLoadingRef.current = true;
    drawingRef.current?.loadBoxes(datas);
    isLoadingRef.current = false;
    dirtyRef.current = false;
  }, []);

  const markSaved = useCallback(() => {
    dirtyRef.current = false;
  }, []);

  return {
    deviceAreaMode, boxCount, height, selectedBoxId, selectedBoxBay,
    handleToggleDeviceArea, handleForceCloseDeviceArea, handleUndo, handleBindBay, handleUnbind, handleSave, handleSetHeight,
    getBoxDatas, getBoundBayIds, loadBoxes,
    setupDeviceAreaDrawing, drawingRef, markSaved,
  };
}
