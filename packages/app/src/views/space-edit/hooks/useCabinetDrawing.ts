import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { CabinetDrawing } from "./drawing/CabinetDrawing";

interface CabinetDrawingAPI {
  cabinetMode: boolean;
  /** 当前已放置的角点数量（0~4） */
  cornerCount: number;
  /** 当前屏柜数量（成体后 = 分隔数 + 1，未成体为 0） */
  cabinetCount: number;
  handleToggleCabinet: () => void;
  /** 撤销最后一个角点 */
  handleUndo: () => void;
  /** 设置各屏柜名称（框上方红色标签） */
  setCabinetNames: (names: string[]) => void;
  /** 获取立方体几何（8 顶点 + 分隔参数），未成体返回 null */
  getCabinetGeometry: () => { verts: number[][]; splits: number[] } | null;
  setupCabinetDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
}

/**
 * 绘制屏柜：四点定方体。
 * 依次点击 前左下→前右下→前右上→后右上 四个角点，自动框出完整立方体。
 */
export function useCabinetDrawing(): CabinetDrawingAPI {
  const [cabinetMode, setCabinetMode] = useState(false);
  const [cornerCount, setCornerCount] = useState(0);
  const [cabinetCount, setCabinetCount] = useState(0);
  const drawingRef = useRef<CabinetDrawing | null>(null);

  const setupCabinetDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const drawing = new CabinetDrawing(app, camera, requestRender, entitiesRef, {
      snap: true,
      onChange: (count) => setCornerCount(count),
      onCabinetCountChange: (count) => setCabinetCount(count),
    });
    drawingRef.current = drawing;
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  // 同步绘制模式：关闭时清空当前绘制
  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(cabinetMode);
    if (!cabinetMode) drawing.clear();
  }, [cabinetMode]);

  const handleToggleCabinet = useCallback(() => {
    setCabinetMode((prev) => !prev);
  }, []);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  const setCabinetNames = useCallback((names: string[]) => {
    drawingRef.current?.setCabinetNames(names);
  }, []);

  const getCabinetGeometry = useCallback(() => {
    return drawingRef.current?.getGeometry() ?? null;
  }, []);

  return { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, handleUndo, setCabinetNames, getCabinetGeometry, setupCabinetDrawing };
}
