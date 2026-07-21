import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Tooltip } from "antd";
import { CompressOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";

interface VerificationImageCanvasProps {
  src: string;
  label: string;
  correctionMode?: boolean;
  correctionRect?: DeviceCorrectionRect | null;
  onCorrectionChange?: (rect: DeviceCorrectionRect) => void;
  onCorrectionDelete?: () => void;
  onLoadError?: (message: string) => void;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 24;

export default function VerificationImageCanvas({
  src,
  label,
  correctionMode,
  correctionRect,
  onCorrectionChange,
  onCorrectionDelete,
  onLoadError,
}: VerificationImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const onLoadErrorRef = useRef(onLoadError);
  const viewRef = useRef<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);
  const correctionModeRef = useRef(false);
  const correctionRectRef = useRef<DeviceCorrectionRect | null>(null);
  const correctionSelectedRef = useRef(false);
  const correctionDraftRef = useRef<{
    action: "draw" | "move";
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    originRect: DeviceCorrectionRect | null;
    previewRect: DeviceCorrectionRect | null;
    moved: boolean;
  } | null>(null);
  const pendingFitRef = useRef(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dragging, setDragging] = useState(false);
  const [correctionSelected, setCorrectionSelected] = useState(false);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const previous = sizeRef.current;
    sizeRef.current = { width, height };
    return { width, height, dpr, previous };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const size = syncCanvasSize();
    if (!size) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    const view = viewRef.current;
    context.imageSmoothingEnabled = view.scale < 1;
    if (view.scale < 1) context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      view.offsetX,
      view.offsetY,
      image.naturalWidth * view.scale,
      image.naturalHeight * view.scale,
    );
    const draft = correctionDraftRef.current;
    const shouldDrawStoredRect = !(draft?.action === "move" && draft.previewRect);
    drawCorrectionRect(context, shouldDrawStoredRect ? correctionRectRef.current : null, view, correctionSelectedRef.current, false);
    drawCorrectionRect(context, draft?.previewRect || null, view, true, draft?.action === "draw");
  }, [syncCanvasSize]);

  const applyView = useCallback((nextView: ViewState) => {
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

    const availableWidth = Math.max(1, width - FIT_PADDING * 2);
    const availableHeight = Math.max(1, height - FIT_PADDING * 2);
    const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight, 1);
    const safeScale = clampScale(scale);
    pendingFitRef.current = false;
    applyView({
      scale: safeScale,
      offsetX: (width - image.naturalWidth * safeScale) / 2,
      offsetY: (height - image.naturalHeight * safeScale) / 2,
    });
  }, [applyView]);

  const zoomAt = useCallback((factor: number, centerX: number, centerY: number) => {
    const current = viewRef.current;
    const nextScale = clampScale(current.scale * factor);
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
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    correctionModeRef.current = Boolean(correctionMode);
    draw();
  }, [correctionMode, draw]);

  useEffect(() => {
    correctionRectRef.current = correctionRect || null;
    if (!correctionRect) setCorrectionSelected(false);
    draw();
  }, [correctionRect, draw]);

  useEffect(() => {
    correctionSelectedRef.current = correctionSelected;
    draw();
  }, [correctionSelected, draw]);

  useEffect(() => {
    setCorrectionSelected(false);
  }, [src]);

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
      if (!cancelled) onLoadErrorRef.current?.("图片解码失败");
    };
    image.src = src;

    return () => {
      cancelled = true;
      imageRef.current = null;
      dragRef.current = null;
      correctionDraftRef.current = null;
    };
  }, [fitToView, src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const previous = sizeRef.current;
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      if (pendingFitRef.current && imageRef.current) {
        fitToView();
        return;
      }
      if (previous.width > 0 && previous.height > 0) {
        viewRef.current = {
          ...viewRef.current,
          offsetX: viewRef.current.offsetX + (nextWidth - previous.width) / 2,
          offsetY: viewRef.current.offsetY + (nextHeight - previous.height) / 2,
        };
      }
      draw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw, fitToView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (event: WheelEvent) => {
      if (!imageRef.current) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || !imageRef.current) return;
    event.preventDefault();
    containerRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (correctionModeRef.current) {
      const point = canvasEventToImagePoint(event, event.currentTarget, imageRef.current, viewRef.current);
      if (!point) return;
      const rect = correctionRectRef.current;
      const hitRect = Boolean(rect && rectContainsPoint(rect, point.x, point.y));
      setCorrectionSelected(hitRect);
      correctionDraftRef.current = {
        action: hitRect ? "move" : "draw",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: point.x,
        startY: point.y,
        originRect: hitRect ? rect : null,
        previewRect: hitRect ? rect : null,
        moved: false,
      };
      draw();
      return;
    }

    const view = viewRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      moved: false,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const correctionDraft = correctionDraftRef.current;
    const image = imageRef.current;
    if (correctionDraft && correctionDraft.pointerId === event.pointerId && image) {
      const point = canvasEventToImagePoint(event, event.currentTarget, image, viewRef.current);
      if (!point) return;
      correctionDraft.moved = correctionDraft.moved
        || Math.hypot(event.clientX - correctionDraft.startClientX, event.clientY - correctionDraft.startClientY) >= 3;
      if (correctionDraft.action === "move" && correctionDraft.originRect) {
        correctionDraft.previewRect = moveCorrectionRect(
          correctionDraft.originRect,
          point.x - correctionDraft.startX,
          point.y - correctionDraft.startY,
          image.naturalWidth,
          image.naturalHeight,
        );
      } else {
        correctionDraft.previewRect = correctionDraft.moved
          ? buildSquareRect(correctionDraft.startX, correctionDraft.startY, point.x, point.y, image.naturalWidth, image.naturalHeight)
          : null;
      }
      draw();
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 3;
    viewRef.current = {
      ...viewRef.current,
      offsetX: drag.offsetX + event.clientX - drag.clientX,
      offsetY: drag.offsetY + event.clientY - drag.clientY,
    };
    draw();
  };

  const stopDragging = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const correctionDraft = correctionDraftRef.current;
    if (correctionDraft?.pointerId === event.pointerId) {
      correctionDraftRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (correctionDraft.moved && correctionDraft.previewRect) {
        correctionRectRef.current = correctionDraft.previewRect;
        setCorrectionSelected(true);
        onCorrectionChange?.(correctionDraft.previewRect);
      } else {
        const image = imageRef.current;
        const point = image ? canvasEventToImagePoint(event, event.currentTarget, image, viewRef.current) : null;
        const rect = correctionRectRef.current;
        setCorrectionSelected(Boolean(point && rect && rectContainsPoint(rect, point.x, point.y)));
      }
      draw();
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved && correctionRectRef.current && imageRef.current) {
      const point = canvasEventToImagePoint(event, event.currentTarget, imageRef.current, viewRef.current);
      setCorrectionSelected(Boolean(point && rectContainsPoint(correctionRectRef.current, point.x, point.y)));
    }
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Delete" || !correctionSelectedRef.current || !correctionRectRef.current) return;
    event.preventDefault();
    correctionRectRef.current = null;
    setCorrectionSelected(false);
    onCorrectionDelete?.();
    draw();
  };

  return (
    <div ref={containerRef} className="device-verify-canvas-wrap" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="device-verify-canvas-toolbar">
        <Tooltip title="缩小">
          <Button type="text" size="small" aria-label="缩小" icon={<ZoomOutOutlined />} onClick={() => zoomAtCenter(1 / ZOOM_STEP)} />
        </Tooltip>
        <span className="device-verify-canvas-scale">{zoomPercent}%</span>
        <Tooltip title="放大">
          <Button type="text" size="small" aria-label="放大" icon={<ZoomInOutlined />} onClick={() => zoomAtCenter(ZOOM_STEP)} />
        </Tooltip>
        <Tooltip title="适应窗口">
          <Button type="text" size="small" aria-label="适应窗口" icon={<CompressOutlined />} onClick={fitToView} />
        </Tooltip>
      </div>
      <canvas
        ref={canvasRef}
        className={`device-verify-image-canvas${dragging ? " is-dragging" : ""}${correctionMode ? " is-correcting" : ""}`}
        role="img"
        aria-label={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onDoubleClick={fitToView}
      />
    </div>
  );
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function canvasEventToImagePoint(
  event: ReactPointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  view: ViewState,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  const x = (canvasX - view.offsetX) / view.scale;
  const y = (canvasY - view.offsetY) / view.scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clampNumber(x, 0, image.naturalWidth),
    y: clampNumber(y, 0, image.naturalHeight),
  };
}

function buildSquareRect(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  imageWidth: number,
  imageHeight: number,
): DeviceCorrectionRect | null {
  const signX = currentX < startX ? -1 : 1;
  const signY = currentY < startY ? -1 : 1;
  const maxSizeX = signX < 0 ? startX : imageWidth - startX;
  const maxSizeY = signY < 0 ? startY : imageHeight - startY;
  const size = Math.min(Math.max(Math.abs(currentX - startX), Math.abs(currentY - startY)), maxSizeX, maxSizeY);
  if (!Number.isFinite(size) || size < 2) return null;

  const x = signX < 0 ? startX - size : startX;
  const y = signY < 0 ? startY - size : startY;
  return {
    x: Math.round(clampNumber(x, 0, imageWidth)),
    y: Math.round(clampNumber(y, 0, imageHeight)),
    size: Math.round(size),
    imageWidth,
    imageHeight,
  };
}

function moveCorrectionRect(
  rect: DeviceCorrectionRect,
  deltaX: number,
  deltaY: number,
  imageWidth: number,
  imageHeight: number,
): DeviceCorrectionRect {
  return {
    ...rect,
    x: Math.round(clampNumber(rect.x + deltaX, 0, Math.max(0, imageWidth - rect.size))),
    y: Math.round(clampNumber(rect.y + deltaY, 0, Math.max(0, imageHeight - rect.size))),
    imageWidth,
    imageHeight,
  };
}

function drawCorrectionRect(
  context: CanvasRenderingContext2D,
  rect: DeviceCorrectionRect | null,
  view: ViewState,
  selected: boolean,
  preview: boolean,
): void {
  if (!rect) return;
  const x = view.offsetX + rect.x * view.scale;
  const y = view.offsetY + rect.y * view.scale;
  const size = rect.size * view.scale;
  if (size <= 0) return;

  context.save();
  context.lineWidth = selected ? 2.5 : 2;
  context.strokeStyle = selected ? "#fa8c16" : "#1677ff";
  context.fillStyle = preview ? "rgba(250, 140, 22, 0.12)" : "rgba(22, 119, 255, 0.10)";
  context.fillRect(x, y, size, size);
  context.strokeRect(x, y, size, size);
  context.restore();
}

function rectContainsPoint(rect: DeviceCorrectionRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.size && y >= rect.y && y <= rect.y + rect.size;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
