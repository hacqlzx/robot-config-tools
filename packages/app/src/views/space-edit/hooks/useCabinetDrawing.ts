import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { CabinetDrawing, type CabinetDrawingSnapshot } from "./drawing/CabinetDrawing";
import type { DrawingHistoryScope } from "./useDrawingHistory";

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
  clearCabinetDraft: () => void;
  setupCabinetDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
  drawingRef: React.MutableRefObject<CabinetDrawing | null>;
}

/**
 * 绘制屏柜：四点定方体。
 * 依次点击 前左下→前右下→前右上→后右上 四个角点，自动框出完整立方体。
 */
export function useCabinetDrawing(
  onHistory?: (scope: DrawingHistoryScope, before: CabinetDrawingSnapshot, after: CabinetDrawingSnapshot, label: string) => void,
): CabinetDrawingAPI {
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
      onHistory: (before, after, label) => onHistory?.("cabinet", before, after, label),
    });
    drawingRef.current = drawing;
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  // 同步绘制模式：关闭时只停用交互，草稿保留给跨模式撤销/恢复。
  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(cabinetMode);
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

  const clearCabinetDraft = useCallback(() => {
    drawingRef.current?.clear();
  }, []);

  useEffect(() => {
    drawingRef.current?.setHistoryCallback((before, after, label) => onHistory?.("cabinet", before, after, label));
  }, [onHistory]);

  return { cabinetMode, cornerCount, cabinetCount, handleToggleCabinet, handleUndo, setCabinetNames, getCabinetGeometry, clearCabinetDraft, setupCabinetDrawing, drawingRef };
}
