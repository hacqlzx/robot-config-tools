import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import {
  ANNOTATION_COLORS,
  ANNOTATION_HANDLE_HIT_RADIUS,
  ANNOTATION_HANDLE_RADIUS,
  MIN_ANNOTATION_RECT_SIZE,
} from "../utils/constants";
import { findSelectedAnnotation } from "../utils/annotation-utils";
import type { AnnotationSelection, AnnotationTool, ComponentAnnotations, ImageRect } from "../types";

type RectHandle = "nw" | "ne" | "se" | "sw";
type RectDragMode = "move" | "resize";

interface RectDragState {
  tool: AnnotationTool;
  id: string;
  mode: RectDragMode;
  handle?: RectHandle;
  startX: number;
  startY: number;
  startRect: ImageRect;
  currentRect: ImageRect;
}

interface CabinetImageCanvasProps {
  imageDataUrl: string;
  title: string;
  activeTool: AnnotationTool | null;
  annotations: ComponentAnnotations;
  selectedAnnotation: AnnotationSelection | null;
  onCreateRect: (tool: AnnotationTool, rect: ImageRect) => void;
  onUpdateRect: (tool: AnnotationTool, rect: ImageRect) => void;
  onDeleteRect: (selection: AnnotationSelection) => void;
  onSelectRect: (selection: AnnotationSelection | null) => void;
  onUndo: () => void;
  onExitTool: () => void;
  onLoadError?: (message: string) => void;
}

export function CabinetImageCanvas({
  imageDataUrl,
  title,
  activeTool,
  annotations,
  selectedAnnotation,
  onCreateRect,
  onUpdateRect,
  onDeleteRect,
  onSelectRect,
  onUndo,
  onExitTool,
  onLoadError,
}: CabinetImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const annotationsRef = useRef(annotations);
  const selectedAnnotationRef = useRef(selectedAnnotation);
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const rectDragRef = useRef<RectDragState | null>(null);
  const drawingRef = useRef<{ tool: AnnotationTool; startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const pendingFitRef = useRef(false);

  annotationsRef.current = annotations;
  selectedAnnotationRef.current = selectedAnnotation;

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return { width: 0, height: 0, dpr: 1 };

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.round(width * dpr);
    const nextHeight = Math.round(height * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return { width, height, dpr };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const { width, height, dpr } = resizeCanvas();
    if (!width || !height) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { scale, offsetX, offsetY } = viewRef.current;
    ctx.imageSmoothingEnabled = scale < 1;
    if (scale < 1) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, offsetX, offsetY, image.naturalWidth * scale, image.naturalHeight * scale);

    const currentAnnotations = annotationsRef.current;
    const currentDrag = rectDragRef.current;
    const currentStandardPartRects = currentAnnotations.standardPartRects || [];
    const currentDeviceLabelRects = currentAnnotations.deviceLabelRects || [];
    const currentDeviceBoxRects = currentAnnotations.deviceBoxRects || [];
    const currentAppearanceRects = currentAnnotations.appearanceRects || [];
    const standardPartRects = currentDrag?.tool === "standardPart"
      ? currentStandardPartRects.map((rect) => (rect.id === currentDrag.id ? currentDrag.currentRect : rect))
      : currentStandardPartRects;
    const deviceLabelRects = currentDrag?.tool === "deviceLabel"
      ? currentDeviceLabelRects.map((rect) => (rect.id === currentDrag.id ? currentDrag.currentRect : rect))
      : currentDeviceLabelRects;
    const deviceBoxRects = currentDrag?.tool === "deviceBox"
      ? currentDeviceBoxRects.map((rect) => (rect.id === currentDrag.id ? currentDrag.currentRect : rect))
      : currentDeviceBoxRects;
    const appearanceRects = currentDrag?.tool === "appearance"
      ? currentAppearanceRects.map((rect) => (rect.id === currentDrag.id ? currentDrag.currentRect : rect))
      : currentAppearanceRects;
    drawAnnotationRects(ctx, appearanceRects, "appearance", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, standardPartRects, "standardPart", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, deviceBoxRects, "deviceBox", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, deviceLabelRects, "deviceLabel", viewRef.current, false, selectedAnnotationRef.current);
    const draft = drawingRef.current;
    if (draft) {
      drawAnnotationRects(ctx, [normalizeRect(draft.startX, draft.startY, draft.currentX, draft.currentY)], draft.tool, viewRef.current, true);
    }
  }, [resizeCanvas]);

  const fitToView = useCallback(() => {
    const image = imageRef.current;
    const container = containerRef.current;
    if (!image || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 1 || height <= 1) {
      pendingFitRef.current = true;
      return;
    }

    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    pendingFitRef.current = false;
    viewRef.current = {
      scale: safeScale,
      offsetX: (width - image.naturalWidth * safeScale) / 2,
      offsetY: (height - image.naturalHeight * safeScale) / 2,
    };
    draw();
  }, [draw]);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      fitToView();
    };
    image.onerror = () => {
      if (!cancelled) onLoadError?.("图片解码失败");
    };
    image.src = imageDataUrl;
    return () => {
      cancelled = true;
      imageRef.current = null;
    };
  }, [fitToView, imageDataUrl, onLoadError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (pendingFitRef.current && imageRef.current) {
        fitToView();
        return;
      }
      resizeCanvas();
      draw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw, fitToView, resizeCanvas]);

  useEffect(() => {
    draw();
  }, [annotations, draw, selectedAnnotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndo();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        drawingRef.current = null;
        rectDragRef.current = null;
        dragRef.current = null;
        onExitTool();
        draw();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const selection = selectedAnnotationRef.current;
        if (!selection) return;
        event.preventDefault();
        onDeleteRect(selection);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draw, onDeleteRect, onExitTool, onUndo]);

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const current = viewRef.current;
    const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextScale = Math.min(8, Math.max(0.05, current.scale * zoomFactor));
    const ratio = nextScale / current.scale;

    viewRef.current = {
      scale: nextScale,
      offsetX: pointerX - (pointerX - current.offsetX) * ratio,
      offsetY: pointerY - (pointerY - current.offsetY) * ratio,
    };
    draw();
  };

  const getImagePoint = useCallback((event: ReactMouseEvent<HTMLCanvasElement>, clampToImage = true) => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return null;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = viewRef.current;
    if (!scale) return null;
    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;
    if (!clampToImage) return { x, y };
    return {
      x: clamp(x, 0, image.naturalWidth),
      y: clamp(y, 0, image.naturalHeight),
    };
  }, []);

  const getCanvasPoint = useCallback((event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const setCanvasCursor = useCallback((cursor: string | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.cursor = cursor || "";
  }, []);

  useEffect(() => {
    setCanvasCursor(null);
  }, [activeTool, setCanvasCursor]);

  const handleMouseDown = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const canvasPoint = getCanvasPoint(event);
    if (activeTool) {
      const point = getImagePoint(event);
      if (!point) return;
      onSelectRect(null);
      drawingRef.current = {
        tool: activeTool,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      };
      draw();
      return;
    }

    const point = getImagePoint(event, false);
    const selectedHit = selectedAnnotationRef.current && canvasPoint
      ? findSelectedAnnotation(annotationsRef.current, selectedAnnotationRef.current)
      : null;
    const selectedHandle = selectedHit && canvasPoint
      ? findRectHandleAtCanvasPoint(selectedHit, viewRef.current, canvasPoint.x, canvasPoint.y)
      : null;
    if (selectedHit && selectedHandle && point) {
      rectDragRef.current = {
        ...selectedAnnotationRef.current!,
        mode: "resize",
        handle: selectedHandle,
        startX: point.x,
        startY: point.y,
        startRect: selectedHit,
        currentRect: selectedHit,
      };
      dragRef.current = null;
      setCanvasCursor(getRectHandleCursor(selectedHandle));
      draw();
      return;
    }

    if (point) {
      const hit = findAnnotationAtPoint(annotationsRef.current, point.x, point.y);
      if (hit) {
        const selection = { tool: hit.tool, id: hit.rect.id };
        selectedAnnotationRef.current = selection;
        onSelectRect(selection);
        rectDragRef.current = {
          ...selection,
          mode: "move",
          startX: point.x,
          startY: point.y,
          startRect: hit.rect,
          currentRect: hit.rect,
        };
        dragRef.current = null;
        setCanvasCursor("move");
        draw();
        return;
      }
    }

    selectedAnnotationRef.current = null;
    onSelectRect(null);
    const current = viewRef.current;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: current.offsetX,
      offsetY: current.offsetY,
    };
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (drawing) {
      const point = getImagePoint(event);
      if (!point) return;
      drawing.currentX = point.x;
      drawing.currentY = point.y;
      draw();
      return;
    }

    const rectDrag = rectDragRef.current;
    if (rectDrag) {
      const point = getImagePoint(event);
      const image = imageRef.current;
      if (!point || !image) return;
      if (rectDrag.mode === "resize" && rectDrag.handle) {
        rectDrag.currentRect = resizeRectFromHandle(
          rectDrag.startRect,
          rectDrag.handle,
          point.x,
          point.y,
          image.naturalWidth,
          image.naturalHeight,
          event.shiftKey,
        );
        setCanvasCursor(getRectHandleCursor(rectDrag.handle));
      } else {
        const rawPoint = getImagePoint(event, false);
        if (!rawPoint) return;
        const dx = rawPoint.x - rectDrag.startX;
        const dy = rawPoint.y - rectDrag.startY;
        rectDrag.currentRect = clampRectToImage({
          ...rectDrag.startRect,
          x: rectDrag.startRect.x + dx,
          y: rectDrag.startRect.y + dy,
        }, image.naturalWidth, image.naturalHeight);
        setCanvasCursor("move");
      }
      draw();
      return;
    }

    const drag = dragRef.current;
    if (!drag) {
      if (activeTool) {
        setCanvasCursor(null);
        return;
      }
      const canvasPoint = getCanvasPoint(event);
      const imagePoint = getImagePoint(event, false);
      const selectedHit = selectedAnnotationRef.current && canvasPoint
        ? findSelectedAnnotation(annotationsRef.current, selectedAnnotationRef.current)
        : null;
      const selectedHandle = selectedHit && canvasPoint
        ? findRectHandleAtCanvasPoint(selectedHit, viewRef.current, canvasPoint.x, canvasPoint.y)
        : null;
      if (selectedHandle) {
        setCanvasCursor(getRectHandleCursor(selectedHandle));
        return;
      }
      const hit = imagePoint ? findAnnotationAtPoint(annotationsRef.current, imagePoint.x, imagePoint.y) : null;
      setCanvasCursor(hit ? "move" : null);
      return;
    }
    setCanvasCursor("grabbing");
    viewRef.current = {
      ...viewRef.current,
      offsetX: drag.offsetX + event.clientX - drag.x,
      offsetY: drag.offsetY + event.clientY - drag.y,
    };
    draw();
  };

  const finishDrawing = () => {
    const drawing = drawingRef.current;
    if (!drawing) return false;
    drawingRef.current = null;
    const rect = normalizeRect(drawing.startX, drawing.startY, drawing.currentX, drawing.currentY);
    if (rect.w >= MIN_ANNOTATION_RECT_SIZE && rect.h >= MIN_ANNOTATION_RECT_SIZE) {
      onCreateRect(drawing.tool, {
        ...rect,
        id: `${drawing.tool}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        source: "manual",
        saved: false,
        generationStatus: "pending",
      });
    } else {
      draw();
    }
    return true;
  };

  const finishRectDrag = () => {
    const rectDrag = rectDragRef.current;
    if (!rectDrag) return false;
    rectDragRef.current = null;
    if (!sameRect(rectDrag.startRect, rectDrag.currentRect)) {
      onUpdateRect(rectDrag.tool, rectDrag.currentRect);
    } else {
      draw();
    }
    return true;
  };

  const stopDrag = () => {
    if (finishDrawing()) {
      setCanvasCursor(null);
      return;
    }
    if (finishRectDrag()) {
      setCanvasCursor(null);
      return;
    }
    dragRef.current = null;
    setCanvasCursor(null);
  };

  return (
    <div ref={containerRef} className="screen-verify-image-canvas-wrap">
      <canvas
        ref={canvasRef}
        className={`screen-verify-image-canvas${activeTool ? " is-drawing" : ""}`}
        title={title}
        tabIndex={0}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onDoubleClick={fitToView}
      />
    </div>
  );
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Omit<ImageRect, "id"> {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function drawAnnotationRects(
  ctx: CanvasRenderingContext2D,
  rects: (ImageRect | Omit<ImageRect, "id">)[],
  tool: AnnotationTool,
  view: { scale: number; offsetX: number; offsetY: number },
  draft = false,
  selected: AnnotationSelection | null = null,
) {
  ctx.save();
  ctx.lineWidth = draft ? 2 : 1.5;
  ctx.setLineDash(draft ? [6, 4] : []);
  for (const rect of rects) {
    const selectedRect = "id" in rect && selected?.tool === tool && selected.id === rect.id;
    const color = getAnnotationStrokeColor(tool, rect);
    ctx.strokeStyle = color;
    const x = view.offsetX + rect.x * view.scale;
    const y = view.offsetY + rect.y * view.scale;
    const w = rect.w * view.scale;
    const h = rect.h * view.scale;
    ctx.strokeRect(x, y, w, h);
    if (selectedRect) {
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);
      if (tool !== "deviceLabel" && "text" in rect && rect.text) {
        drawRectInfo(ctx, rect.text, rect.confidence, x, y, color);
      }
      ctx.fillStyle = "#fff";
      for (const handle of getRectCanvasHandles(rect as ImageRect, view)) {
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, ANNOTATION_HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

function getAnnotationStrokeColor(
  tool: AnnotationTool,
  rect: ImageRect | Omit<ImageRect, "id">,
): string {
  const recognized = "source" in rect && (rect.source === "ocr" || rect.source === "mock");
  if (tool === "standardPart") {
    return recognized ? ANNOTATION_COLORS.standardPartRecognition : ANNOTATION_COLORS.standardPartManual;
  }
  if (tool === "deviceLabel") {
    return recognized ? ANNOTATION_COLORS.deviceLabelRecognition : ANNOTATION_COLORS.deviceLabelManual;
  }
  if (tool === "deviceBox") {
    return recognized ? ANNOTATION_COLORS.deviceBoxRecognition : ANNOTATION_COLORS.deviceBoxManual;
  }
  return ANNOTATION_COLORS.appearance;
}

function drawRectInfo(ctx: CanvasRenderingContext2D, text: string, confidence: number | undefined, x: number, y: number, color: string) {
  const label = confidence == null ? text : `${text} ${Math.round(confidence * 100)}%`;
  ctx.save();
  ctx.font = "12px sans-serif";
  const metrics = ctx.measureText(label);
  const labelWidth = Math.min(metrics.width + 8, 260);
  const labelHeight = 20;
  const labelX = x;
  const labelY = Math.max(0, y - labelHeight - 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
  ctx.fillStyle = "#262626";
  ctx.textBaseline = "middle";
  ctx.fillText(label, labelX + 4, labelY + labelHeight / 2, labelWidth - 8);
  ctx.restore();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findAnnotationAtPoint(annotations: ComponentAnnotations, x: number, y: number): { tool: AnnotationTool; rect: ImageRect } | null {
  const hits: { tool: AnnotationTool; rect: ImageRect; area: number }[] = [];
  for (const rect of annotations.standardPartRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "standardPart", rect, area: rect.w * rect.h });
  }
  for (const rect of annotations.deviceLabelRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "deviceLabel", rect, area: rect.w * rect.h });
  }
  for (const rect of annotations.deviceBoxRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "deviceBox", rect, area: rect.w * rect.h });
  }
  for (const rect of annotations.appearanceRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "appearance", rect, area: rect.w * rect.h });
  }
  hits.sort((a, b) => a.area - b.area);
  return hits[0] ? { tool: hits[0].tool, rect: hits[0].rect } : null;
}

function getRectCanvasHandles(rect: ImageRect, view: { scale: number; offsetX: number; offsetY: number }): { handle: RectHandle; x: number; y: number }[] {
  const left = view.offsetX + rect.x * view.scale;
  const top = view.offsetY + rect.y * view.scale;
  const right = view.offsetX + (rect.x + rect.w) * view.scale;
  const bottom = view.offsetY + (rect.y + rect.h) * view.scale;
  return [
    { handle: "nw", x: left, y: top },
    { handle: "ne", x: right, y: top },
    { handle: "se", x: right, y: bottom },
    { handle: "sw", x: left, y: bottom },
  ];
}

function findRectHandleAtCanvasPoint(
  rect: ImageRect,
  view: { scale: number; offsetX: number; offsetY: number },
  x: number,
  y: number,
): RectHandle | null {
  for (const item of getRectCanvasHandles(rect, view)) {
    if (Math.hypot(x - item.x, y - item.y) <= ANNOTATION_HANDLE_HIT_RADIUS) return item.handle;
  }
  return null;
}

function getRectHandleCursor(handle: RectHandle): string {
  return handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize";
}

function resizeRectFromHandle(
  startRect: ImageRect,
  handle: RectHandle,
  pointerX: number,
  pointerY: number,
  imageWidth: number,
  imageHeight: number,
  keepRatio: boolean,
): ImageRect {
  const anchor = getResizeAnchor(startRect, handle);
  let nextX = pointerX;
  let nextY = pointerY;

  if (keepRatio) {
    const ratio = startRect.w > 0 && startRect.h > 0 ? startRect.w / startRect.h : 1;
    const directionX = handle === "nw" || handle === "sw" ? -1 : 1;
    const directionY = handle === "nw" || handle === "ne" ? -1 : 1;
    const rawWidth = Math.max(MIN_ANNOTATION_RECT_SIZE, Math.abs(pointerX - anchor.x));
    const rawHeight = Math.max(MIN_ANNOTATION_RECT_SIZE, Math.abs(pointerY - anchor.y));
    const widthFromPointer = Math.max(rawWidth, rawHeight * ratio);
    const maxWidth = directionX > 0 ? imageWidth - anchor.x : anchor.x;
    const maxHeight = directionY > 0 ? imageHeight - anchor.y : anchor.y;
    const maxWidthForRatio = Math.max(0, Math.min(maxWidth, maxHeight * ratio));
    const minWidthForRatio = Math.min(maxWidthForRatio, ratio >= 1 ? MIN_ANNOTATION_RECT_SIZE * ratio : MIN_ANNOTATION_RECT_SIZE);
    const width = clamp(widthFromPointer, minWidthForRatio, maxWidthForRatio);
    const height = width / ratio;
    nextX = anchor.x + directionX * width;
    nextY = anchor.y + directionY * height;
  }

  let rect = {
    ...startRect,
    ...normalizeRect(anchor.x, anchor.y, nextX, nextY),
  };
  rect = enforceMinimumRectSize(rect, anchor, handle, imageWidth, imageHeight);
  return {
    ...rect,
    x: clamp(rect.x, 0, imageWidth - rect.w),
    y: clamp(rect.y, 0, imageHeight - rect.h),
  };
}

function getResizeAnchor(rect: ImageRect, handle: RectHandle): { x: number; y: number } {
  switch (handle) {
    case "nw":
      return { x: rect.x + rect.w, y: rect.y + rect.h };
    case "ne":
      return { x: rect.x, y: rect.y + rect.h };
    case "se":
      return { x: rect.x, y: rect.y };
    case "sw":
      return { x: rect.x + rect.w, y: rect.y };
  }
}

function enforceMinimumRectSize(
  rect: ImageRect,
  anchor: { x: number; y: number },
  handle: RectHandle,
  imageWidth: number,
  imageHeight: number,
): ImageRect {
  const leftHandle = handle === "nw" || handle === "sw";
  const topHandle = handle === "nw" || handle === "ne";
  const w = Math.min(Math.max(rect.w, MIN_ANNOTATION_RECT_SIZE), imageWidth);
  const h = Math.min(Math.max(rect.h, MIN_ANNOTATION_RECT_SIZE), imageHeight);
  const x = leftHandle ? anchor.x - w : anchor.x;
  const y = topHandle ? anchor.y - h : anchor.y;
  return {
    ...rect,
    x: clamp(x, 0, imageWidth - w),
    y: clamp(y, 0, imageHeight - h),
    w,
    h,
  };
}

function pointInRect(x: number, y: number, rect: ImageRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clampRectToImage(rect: ImageRect, imageWidth: number, imageHeight: number): ImageRect {
  return {
    ...rect,
    x: clamp(rect.x, 0, Math.max(0, imageWidth - rect.w)),
    y: clamp(rect.y, 0, Math.max(0, imageHeight - rect.h)),
  };
}

function sameRect(a: ImageRect, b: ImageRect): boolean {
  return a.id === b.id && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}
