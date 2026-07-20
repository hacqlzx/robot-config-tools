import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button, Tooltip } from "antd";
import { CompressOutlined, ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";

interface VerificationImageCanvasProps {
  src: string;
  label: string;
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

export default function VerificationImageCanvas({ src, label, onLoadError }: VerificationImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const pendingFitRef = useRef(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dragging, setDragging] = useState(false);

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
    image.src = src;

    return () => {
      cancelled = true;
      imageRef.current = null;
      dragRef.current = null;
    };
  }, [fitToView, onLoadError, src]);

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
    event.currentTarget.setPointerCapture(event.pointerId);
    const view = viewRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
    };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewRef.current = {
      ...viewRef.current,
      offsetX: drag.offsetX + event.clientX - drag.clientX,
      offsetY: drag.offsetY + event.clientY - drag.clientY,
    };
    draw();
  };

  const stopDragging = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  return (
    <div ref={containerRef} className="device-verify-canvas-wrap">
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
        className={`device-verify-image-canvas${dragging ? " is-dragging" : ""}`}
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
