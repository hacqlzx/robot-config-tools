import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { Modal } from "antd";
import { ChargingAreaDrawing } from "./drawing/ChargingAreaDrawing";

interface ChargingAreaDrawingAPI {
  chargingMode: boolean;
  /** 已放置的点数量（0~3） */
  pointCount: number;
  /** 当前高度（米） */
  height: number;
  handleToggleCharging: () => void;
  /** 撤销最后一个点 */
  handleUndo: () => void;
  /** 保存充电区域 */
  handleSave: () => void;
  /** 修改高度 */
  handleSetHeight: (h: number) => void;
  setupChargingAreaDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
  drawingRef: React.MutableRefObject<ChargingAreaDrawing | null>;
  /** 当前是否有充电区域（已绘制或已加载） */
  hasExistingRef: React.MutableRefObject<boolean>;
}

/**
 * 绘制充电区域：点击 3 个点定平面矩形，默认拉伸 1m 成立体矩形。
 * 仅一个：每次进入绘制会先确认删除原有充电区域。
 */
export function useChargingAreaDrawing(
  onSaveCharging?: () => void,
): ChargingAreaDrawingAPI {
  const [chargingMode, setChargingMode] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [height, setHeight] = useState(1);
  const drawingRef = useRef<ChargingAreaDrawing | null>(null);
  const hasExistingRef = useRef(false);
  const saveCbRef = useRef(onSaveCharging);
  saveCbRef.current = onSaveCharging;

  const setupChargingAreaDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const drawing = new ChargingAreaDrawing(app, camera, requestRender, entitiesRef, {
      snap: true,
      onChange: (count) => {
        setPointCount(count);
        if (count === 3) hasExistingRef.current = true;
        else if (count === 0) hasExistingRef.current = false;
      },
    });
    drawingRef.current = drawing;
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  const doToggle = useCallback(() => {
    setChargingMode((prev) => {
      if (prev) return false;
      const drawing = drawingRef.current;
      if (drawing?.hasBox() || hasExistingRef.current) {
        Modal.confirm({
          title: "确认",
          content: "绘制新的充电区域将删除原有的充电区域，是否继续？",
          okText: "确认删除",
          cancelText: "取消",
          onOk: () => {
            hasExistingRef.current = false;
            drawing?.clear();
            setChargingMode(true);
          },
        });
        return prev;
      }
      drawing?.clear();
      return true;
    });
  }, []);

  const handleToggleCharging = useCallback(() => {
    if (chargingMode) {
      drawingRef.current?.setEnabled(false);
      setChargingMode(false);
    } else {
      doToggle();
    }
  }, [chargingMode, doToggle]);

  // 进入/退出绘制都清空（保证只有一个充电区域，再次进入重画）
  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(chargingMode);
    if (chargingMode) drawing.clear();
  }, [chargingMode]);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  const handleSave = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing || !drawing.hasBox()) return;
    saveCbRef.current?.();
  }, []);

  const handleSetHeight = useCallback((h: number) => {
    setHeight(h);
    drawingRef.current?.setHeight(h);
  }, []);

  return { chargingMode, pointCount, height, handleToggleCharging, handleUndo, handleSave, handleSetHeight, setupChargingAreaDrawing, drawingRef, hasExistingRef };
}
