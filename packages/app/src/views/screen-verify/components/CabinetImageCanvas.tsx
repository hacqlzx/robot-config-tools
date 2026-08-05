import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Button, Tooltip } from "antd";
import { CompressOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
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
type ViewDragState = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  pendingSelection?: AnnotationSelection;
};

const VIEW_DRAG_CLICK_TOLERANCE = 3;
const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 8;
const ZOOM_STEP = 1.2;

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

/**
 * 屏柜图像标注画布。
 *
 * 交互规则：
 * 1. 空白拖动平移整张图片。
 * 2. 单击框体只选中，不立即移动，避免误拖图片时带动框。
 * 3. 已选中的框再次按住才进入移动，拖拽控制点进入缩放。
 * 4. 当前绘制工具激活时，只允许选择/编辑同类型框，空白处开始新建框。
 */
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
  const dragRef = useRef<ViewDragState | null>(null);
  const rectDragRef = useRef<RectDragState | null>(null);
  const drawingRef = useRef<{ tool: AnnotationTool; startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const pendingFitRef = useRef(false);
  const [zoomPercent, setZoomPercent] = useState(100);

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
    // 绘制顺序让标签框最后覆盖在设备框上，便于人工校对名称位置。
    drawAnnotationRects(ctx, appearanceRects, "appearance", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, standardPartRects, "standardPart", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, deviceBoxRects, "deviceBox", viewRef.current, false, selectedAnnotationRef.current);
    drawAnnotationRects(ctx, deviceLabelRects, "deviceLabel", viewRef.current, false, selectedAnnotationRef.current);
    const draft = drawingRef.current;
    if (draft) {
      drawAnnotationRects(ctx, [normalizeRect(draft.startX, draft.startY, draft.currentX, draft.currentY)], draft.tool, viewRef.current, true);
    }
  }, [resizeCanvas]);

  const applyView = useCallback((nextView: { scale: number; offsetX: number; offsetY: number }) => {
    viewRef.current = nextView;
    setZoomPercent(Math.round(nextView.scale * 100));
    draw();
  }, [draw]);

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
    const safeScale = clampViewScale(scale);
    pendingFitRef.current = false;
    applyView({
      scale: safeScale,
      offsetX: (width - image.naturalWidth * safeScale) / 2,
      offsetY: (height - image.naturalHeight * safeScale) / 2,
    });
  }, [applyView]);

  const zoomAt = useCallback((factor: number, centerX: number, centerY: number) => {
    const current = viewRef.current;
    const nextScale = clampViewScale(current.scale * factor);
    if (nextScale === current.scale) return;
    const ratio = nextScale / current.scale;
    applyView({
      scale: nextScale,
      offsetX: centerX - (centerX - current.offsetX) * ratio,
      offsetY: centerY - (centerY - current.offsetY) * ratio,
    });
  }, [applyView]);

  const zoomAtCenter = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container || !imageRef.current) return;
    zoomAt(factor, container.clientWidth / 2, container.clientHeight / 2);
  }, [zoomAt]);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      if (!imageRef.current) return;
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, pointerX, pointerY);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);


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
      const point = getImagePoint(event, false);
      if (!point) return;

      const selectedHit = selectedAnnotationRef.current?.tool === activeTool && canvasPoint
        ? findSelectedAnnotation(annotationsRef.current, selectedAnnotationRef.current)
        : null;
      const selectedHandle = selectedHit && canvasPoint
        ? findRectHandleAtCanvasPoint(selectedHit, viewRef.current, canvasPoint.x, canvasPoint.y)
        : null;
      // 当前工具下，已选中的同类型框可以直接拖拽控制点缩放。
      if (selectedHit && selectedHandle) {
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

      const hit = findAnnotationAtPoint(annotationsRef.current, point.x, point.y, activeTool);
      if (hit) {
        const selection: AnnotationSelection = { tool: hit.tool, id: hit.rect.id };
        if (isSameSelection(selection, selectedAnnotationRef.current)) {
          // 第二次按住已选框才移动框体，第一次点击只负责选中。
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

        // 点击未选中的框时先延迟选中；如果用户继续拖动，则当作图片平移。
        const current = viewRef.current;
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          offsetX: current.offsetX,
          offsetY: current.offsetY,
          moved: false,
          pendingSelection: selection,
        };
        setCanvasCursor(null);
        return;
      }

      // 绘制工具激活且没有命中已有框时，开始创建新标注框。
      const drawPoint = getImagePoint(event);
      if (!drawPoint) return;
      selectedAnnotationRef.current = null;
      onSelectRect(null);
      drawingRef.current = {
        tool: activeTool,
        startX: drawPoint.x,
        startY: drawPoint.y,
        currentX: drawPoint.x,
        currentY: drawPoint.y,
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
    // 非绘制模式下，已选框控制点仍可缩放。
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
        const selection: AnnotationSelection = { tool: hit.tool, id: hit.rect.id };
        if (isSameSelection(selection, selectedAnnotationRef.current)) {
          // 普通模式同样采用“先选中、再拖动”的移动规则。
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
        // 未选中的框被点击时先作为 pendingSelection，鼠标抬起且未移动才真正选中。
        const current = viewRef.current;
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          offsetX: current.offsetX,
          offsetY: current.offsetY,
          moved: false,
          pendingSelection: selection,
        };
        setCanvasCursor(null);
        return;
      }
    }

    // 点击空白区域清空选中，拖动时平移图片视图。
    selectedAnnotationRef.current = null;
    onSelectRect(null);
    const current = viewRef.current;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: current.offsetX,
      offsetY: current.offsetY,
      moved: false,
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
      const canvasPoint = getCanvasPoint(event);
      const imagePoint = getImagePoint(event, false);
      const selectedHit = selectedAnnotationRef.current
        && (!activeTool || selectedAnnotationRef.current.tool === activeTool)
        && canvasPoint
        ? findSelectedAnnotation(annotationsRef.current, selectedAnnotationRef.current)
        : null;
      const selectedHandle = selectedHit && canvasPoint
        ? findRectHandleAtCanvasPoint(selectedHit, viewRef.current, canvasPoint.x, canvasPoint.y)
        : null;
      if (selectedHandle) {
        setCanvasCursor(getRectHandleCursor(selectedHandle));
        return;
      }
      const hit = imagePoint ? findAnnotationAtPoint(annotationsRef.current, imagePoint.x, imagePoint.y, activeTool || undefined) : null;
      const hitSelection: AnnotationSelection | null = hit ? { tool: hit.tool, id: hit.rect.id } : null;
      setCanvasCursor(hitSelection && isSameSelection(hitSelection, selectedAnnotationRef.current) ? "move" : null);
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > VIEW_DRAG_CLICK_TOLERANCE) {
      drag.moved = true;
    }
    if (drag.pendingSelection && !drag.moved) {
      return;
    }
    setCanvasCursor("grabbing");
    viewRef.current = {
      ...viewRef.current,
      offsetX: drag.offsetX + dx,
      offsetY: drag.offsetY + dy,
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
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.pendingSelection && !drag.moved) {
      selectedAnnotationRef.current = drag.pendingSelection;
      onSelectRect(drag.pendingSelection);
      draw();
    }
    setCanvasCursor(null);
  };

  return (
    <div ref={containerRef} className="screen-verify-image-canvas-wrap">
      <div className="screen-verify-canvas-toolbar">
        <Tooltip title="缩小">
          <Button type="text" size="small" aria-label="缩小" icon={<ZoomOutOutlined />} onClick={() => zoomAtCenter(1 / ZOOM_STEP)} />
        </Tooltip>
        <span className="screen-verify-canvas-scale">{zoomPercent}%</span>
        <Tooltip title="放大">
          <Button type="text" size="small" aria-label="放大" icon={<ZoomInOutlined />} onClick={() => zoomAtCenter(ZOOM_STEP)} />
        </Tooltip>
        <Tooltip title="适应窗口">
          <Button type="text" size="small" aria-label="适应窗口" icon={<CompressOutlined />} onClick={fitToView} />
        </Tooltip>
      </div>
      <canvas
        ref={canvasRef}
        className={`screen-verify-image-canvas${activeTool ? " is-drawing" : ""}`}
        title={title}
        tabIndex={0}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onDoubleClick={fitToView}
      />
    </div>
  );
}

function clampViewScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
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

/**
 * 统一绘制标注框。
 * source=inferred 的自动补框使用虚线，人工框和识别框用颜色区分来源。
 */
function drawAnnotationRects(
  ctx: CanvasRenderingContext2D,
  rects: (ImageRect | Omit<ImageRect, "id">)[],
  tool: AnnotationTool,
  view: { scale: number; offsetX: number; offsetY: number },
  draft = false,
  selected: AnnotationSelection | null = null,
) {
  ctx.save();
  for (const rect of rects) {
    const selectedRect = "id" in rect && selected?.tool === tool && selected.id === rect.id;
    const color = getAnnotationStrokeColor(tool, rect);
    const inferred = "source" in rect && rect.source === "inferred";
    ctx.lineWidth = draft ? 2 : inferred ? 2.5 : 1.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(draft || inferred ? [6, 4] : []);
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

/**
 * 根据工具类型和识别来源返回框颜色。
 */
function getAnnotationStrokeColor(
  tool: AnnotationTool,
  rect: ImageRect | Omit<ImageRect, "id">,
): string {
  const source = "source" in rect ? rect.source : undefined;
  const recognized = source === "ocr" || source === "mock" || source === "ai";
  if (tool === "standardPart") {
    return recognized ? ANNOTATION_COLORS.standardPartRecognition : ANNOTATION_COLORS.standardPartManual;
  }
  if (tool === "deviceLabel") {
    if (source === "inferred") return ANNOTATION_COLORS.deviceLabelInferred;
    return recognized ? ANNOTATION_COLORS.deviceLabelRecognition : ANNOTATION_COLORS.deviceLabelManual;
  }
  if (tool === "deviceBox") {
    if (source === "inferred") return ANNOTATION_COLORS.deviceBoxInferred;
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

/**
 * 查找鼠标命中的最小面积框，解决大框套小框时优先选中内部框的问题。
 */
function findAnnotationAtPoint(
  annotations: ComponentAnnotations,
  x: number,
  y: number,
  targetTool?: AnnotationTool,
): { tool: AnnotationTool; rect: ImageRect } | null {
  const hits: { tool: AnnotationTool; rect: ImageRect; area: number }[] = [];
  if (!targetTool || targetTool === "standardPart") for (const rect of annotations.standardPartRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "standardPart", rect, area: rect.w * rect.h });
  }
  if (!targetTool || targetTool === "deviceLabel") for (const rect of annotations.deviceLabelRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "deviceLabel", rect, area: rect.w * rect.h });
  }
  if (!targetTool || targetTool === "deviceBox") for (const rect of annotations.deviceBoxRects || []) {
    if (pointInRect(x, y, rect)) hits.push({ tool: "deviceBox", rect, area: rect.w * rect.h });
  }
  if (!targetTool || targetTool === "appearance") for (const rect of annotations.appearanceRects || []) {
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

/**
 * 按控制点缩放标注框；按住 Shift 时保持原始宽高比。
 */
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

function isSameSelection(a: AnnotationSelection | null, b: AnnotationSelection | null): boolean {
  return Boolean(a && b && a.tool === b.tool && a.id === b.id);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}
