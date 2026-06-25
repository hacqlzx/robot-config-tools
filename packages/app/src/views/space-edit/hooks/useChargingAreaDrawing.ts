import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { ChargingAreaDrawing } from "./drawing/ChargingAreaDrawing";

interface ChargingAreaDrawingAPI {
  chargingMode: boolean;
  /** 已放置的点数量（0~3） */
  pointCount: number;
  handleToggleCharging: () => void;
  /** 撤销最后一个点 */
  handleUndo: () => void;
  setupChargingAreaDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
}

/**
 * 绘制充电区域：点击 3 个点定平面矩形，默认拉伸 1m 成立体矩形。
 * 仅一个：每次进入绘制会清空当前。
 */
export function useChargingAreaDrawing(): ChargingAreaDrawingAPI {
  const [chargingMode, setChargingMode] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const drawingRef = useRef<ChargingAreaDrawing | null>(null);

  const setupChargingAreaDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const drawing = new ChargingAreaDrawing(app, camera, requestRender, entitiesRef, {
      snap: true,
      onChange: (count) => setPointCount(count),
    });
    drawingRef.current = drawing;
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  // 进入/退出绘制都清空（保证只有一个充电区域，再次进入重画）
  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(chargingMode);
    drawing.clear();
  }, [chargingMode]);

  const handleToggleCharging = useCallback(() => {
    setChargingMode((prev) => !prev);
  }, []);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  return { chargingMode, pointCount, handleToggleCharging, handleUndo, setupChargingAreaDrawing };
}
