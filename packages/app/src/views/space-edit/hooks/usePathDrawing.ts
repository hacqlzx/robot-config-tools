import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";
import { PathDrawing, type PathData } from "./drawing/PathDrawing";

interface PathDrawingAPI {
  pathMode: boolean;
  pointCount: number;
  connectionCount: number;
  handleTogglePath: () => void;
  handleForceClose: () => void;
  handleUndo: () => void;
  getPathData: () => PathData | null;
  loadPathData: (data: PathData) => void;
  setupPathDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
  drawingRef: { current: PathDrawing | null };
}

export function usePathDrawing(): PathDrawingAPI {
  const [pathMode, setPathMode] = useState(false);
  const [pointCount, setPointCount] = useState(0);
  const [connectionCount, setConnectionCount] = useState(0);
  const drawingRef = useRef<PathDrawing | null>(null);

  const setupPathDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const drawing = new PathDrawing(app, camera, requestRender, entitiesRef, {
      snap: true,
      onChange: (data) => {
        setPointCount(data.points.length);
        setConnectionCount(data.paths.length);
      },
    });
    drawingRef.current = drawing;
    drawing.setEnabled(true);
    return () => {
      drawing.destroy();
      drawingRef.current = null;
    };
  }, []);

  useEffect(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    drawing.setEnabled(true);
    drawing.setActive(pathMode);
  }, [pathMode]);

  const handleTogglePath = useCallback(() => {
    setPathMode((prev) => !prev);
  }, []);

  const handleForceClose = useCallback(() => {
    setPathMode(false);
  }, []);

  const handleUndo = useCallback(() => {
    drawingRef.current?.undo();
  }, []);

  const getPathData = useCallback((): PathData | null => {
    const drawing = drawingRef.current;
    if (!drawing || drawing.getPointCount() === 0) return null;
    return drawing.getData();
  }, []);

  const loadPathData = useCallback((data: PathData) => {
    drawingRef.current?.loadData(data);
  }, []);

  return {
    pathMode,
    pointCount,
    connectionCount,
    handleTogglePath,
    handleForceClose,
    handleUndo,
    getPathData,
    loadPathData,
    setupPathDrawing,
    drawingRef,
  };
}
