import { useRef, useEffect, useState, useCallback } from "react";

export interface ImageItem {
  img?: HTMLImageElement;
  imagePath: string;
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  naturalWidth?: number;
  naturalHeight?: number;
  side: "left" | "right";
  spId: number;
  columnKey?: string;
  columnLabel?: string;
  visName: string;
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  images: ImageItem[];
  visible?: boolean;
  onImageDoubleClick?: (item: ImageItem) => void | Promise<void>;
  calibrationRects?: Map<number, { x: number; y: number; w: number; h: number }[]>;
  resetViewRef?: React.MutableRefObject<(() => void) | null>;
}

interface ThumbEntry {
  canvas: HTMLCanvasElement;
  naturalWidth: number;
  naturalHeight: number;
  lastUsed: number;
}

const THUMB_CACHE_SCALE = 4;
const MAX_THUMB_CACHE_SIZE = 180;
const MAX_CONCURRENT_LOADS = 3;
const COLUMN_HEADER_HEIGHT = 28;
const COLUMN_HEADER_GAP = 8;
const CALIBRATION_BOX_COLOR = "#00ff3b";
const CALIBRATION_BOX_WIDTH = 4;
const CALIBRATION_BOX_HALO_WIDTH = 7;

/** 图片画布：缩放/平移，rAF 驱动渲染，懒加载缩略图缓存，视口裁剪 */
export default function ImageCanvas({ canvasRef, containerRef, images, visible = true, onImageDoubleClick, calibrationRects, resetViewRef }: Props) {
  const [displayScale, setDisplayScale] = useState(1);
  const [, setCacheVersion] = useState(0);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);
  const rafIdRef = useRef(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const calibratedRef = useRef(calibrationRects);
  calibratedRef.current = calibrationRects;
  const resizeTimerRef = useRef(0);
  const thumbCacheRef = useRef<Map<string, ThumbEntry>>(new Map());
  const loadingThumbsRef = useRef<Set<string>>(new Set());
  const loadQueueRef = useRef<ImageItem[]>([]);
  const activeLoadsRef = useRef(0);
  const generationRef = useRef(0);

  const imageKey = (item: ImageItem) => item.imagePath || String(item.id);

  const drawColumnHeader = (
    ctx: CanvasRenderingContext2D,
    label: string,
    x: number,
    y: number,
    w: number,
  ) => {
    ctx.save();
    ctx.fillStyle = "rgba(245, 247, 250, 0.96)";
    ctx.strokeStyle = "#d9dee7";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, COLUMN_HEADER_HEIGHT);
    ctx.strokeRect(x, y, w, COLUMN_HEADER_HEIGHT);

    ctx.fillStyle = "#2f3a4a";
    ctx.font = "13px sans-serif";
    ctx.textBaseline = "middle";
    let text = label;
    const maxTextW = Math.max(20, w - 16);
    while (ctx.measureText(text).width > maxTextW && text.length > 4) {
      text = `${text.slice(0, -4)}...`;
    }
    ctx.fillText(text, x + 8, y + COLUMN_HEADER_HEIGHT / 2);
    ctx.restore();
  };

  const scheduleDraw = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(draw);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pruneThumbCache = useCallback(() => {
    const cache = thumbCacheRef.current;
    if (cache.size <= MAX_THUMB_CACHE_SIZE) return;
    const removable = [...cache.entries()]
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
      .slice(0, cache.size - MAX_THUMB_CACHE_SIZE);
    for (const [key] of removable) cache.delete(key);
  }, []);

  const loadImageElement = useCallback(async (item: ImageItem): Promise<HTMLImageElement> => {
    if (item.img?.complete) return item.img;
    if (!item.imagePath) throw new Error("图片路径为空");
    const buf = await window.electronAPI!.readLargeFile(item.imagePath);
    const blob = new Blob([buf]);
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`图片加载失败: ${item.visName}`));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  const pumpQueue = useCallback(() => {
    while (activeLoadsRef.current < MAX_CONCURRENT_LOADS && loadQueueRef.current.length > 0) {
      const item = loadQueueRef.current.shift()!;
      const key = imageKey(item);
      if (thumbCacheRef.current.has(key) || loadingThumbsRef.current.has(key)) continue;
      const generation = generationRef.current;
      loadingThumbsRef.current.add(key);
      activeLoadsRef.current++;

      loadImageElement(item)
        .then((img) => {
          if (generation !== generationRef.current) return;
          const ratio = img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : item.w / item.h;
          const targetW = Math.min(img.naturalWidth || item.w * THUMB_CACHE_SCALE, Math.max(item.w * THUMB_CACHE_SCALE, item.w));
          const targetH = Math.min(img.naturalHeight || Math.round(targetW / ratio), Math.max(Math.round(targetW / ratio), item.h));
          const thumb = document.createElement("canvas");
          thumb.width = Math.max(1, Math.round(targetW));
          thumb.height = Math.max(1, Math.round(targetH));
          const tCtx = thumb.getContext("2d");
          if (tCtx) {
            tCtx.imageSmoothingEnabled = true;
            tCtx.imageSmoothingQuality = "high";
            tCtx.drawImage(img, 0, 0, thumb.width, thumb.height);
          }
          thumbCacheRef.current.set(key, {
            canvas: thumb,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            lastUsed: performance.now(),
          });
          pruneThumbCache();
          setCacheVersion((v) => v + 1);
          scheduleDraw();
        })
        .catch((err) => console.warn("[ImageCanvas] 缩略图加载失败:", item.visName, err))
        .finally(() => {
          loadingThumbsRef.current.delete(key);
          activeLoadsRef.current--;
          pumpQueue();
        });
    }
  }, [loadImageElement, pruneThumbCache, scheduleDraw]);

  const requestThumbnail = useCallback((item: ImageItem) => {
    const key = imageKey(item);
    if (thumbCacheRef.current.has(key) || loadingThumbsRef.current.has(key)) return;
    if (loadQueueRef.current.some((queued) => imageKey(queued) === key)) return;
    loadQueueRef.current.push(item);
    pumpQueue();
  }, [pumpQueue]);

  useEffect(() => {
    generationRef.current++;
    loadQueueRef.current = [];

    const currentKeys = new Set(images.map(imageKey));
    for (const [key] of thumbCacheRef.current) {
      if (!currentKeys.has(key) && thumbCacheRef.current.size > MAX_THUMB_CACHE_SIZE / 2) {
        thumbCacheRef.current.delete(key);
      }
    }
    scheduleDraw();
  }, [images, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [calibrationRects, scheduleDraw]);

  // 绘制：从 ref 读取 pan/scale，缩略图 + 视口裁剪
  const draw = useCallback(() => {
    rafIdRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = scaleRef.current;
    const p = panRef.current;
    const cw = canvas.width;
    const ch = canvas.height;

    // 视口在世界坐标中的范围
    const vpLeft = (0 - p.x) / s;
    const vpTop = (0 - p.y) / s;
    const vpRight = (cw - p.x) / s;
    const vpBottom = (ch - p.y) / s;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);

    const imgs = imagesRef.current;
    const cache = thumbCacheRef.current;
    const drawnColumns = new Set<string>();

    for (const item of imgs) {
      const label = item.columnLabel;
      if (!label) continue;
      if (item.x + item.w < vpLeft || item.x > vpRight) continue;
      const headerY = item.y - COLUMN_HEADER_GAP - COLUMN_HEADER_HEIGHT;
      if (headerY + COLUMN_HEADER_HEIGHT < vpTop || headerY > vpBottom) continue;

      const key = item.columnKey || `${item.x}`;
      if (drawnColumns.has(key)) continue;
      drawnColumns.add(key);
      drawColumnHeader(ctx, label, item.x, headerY, item.w);
    }

    for (const item of imgs) {
      // 视口裁剪
      if (item.x + item.w < vpLeft || item.x > vpRight) continue;
      if (item.y + item.h < vpTop || item.y > vpBottom) continue;

      const key = imageKey(item);
      const entry = cache.get(key);
      if (entry) {
        entry.lastUsed = performance.now();
        try {
          ctx.drawImage(entry.canvas, item.x, item.y, item.w, item.h);
        } catch {
          // skip corrupt thumb
        }
      } else if (item.img?.complete) {
        try {
          ctx.drawImage(item.img, item.x, item.y, item.w, item.h);
        } catch {
          // skip corrupt image
        }
      } else {
        ctx.fillStyle = "#f5f7fa";
        ctx.fillRect(item.x, item.y, item.w, item.h);
        ctx.strokeStyle = "#d9dee7";
        ctx.lineWidth = 1 / s;
        ctx.strokeRect(item.x, item.y, item.w, item.h);
        ctx.fillStyle = "#8c95a3";
        ctx.font = `${12 / s}px sans-serif`;
        ctx.fillText("加载中", item.x + 10, item.y + 22);
        requestThumbnail(item);
      }

      // 绘制标定框（缩放到缩略图比例）
      const rects = calibratedRef.current?.get(item.id);
      const naturalWidth = entry?.naturalWidth || item.img?.naturalWidth || item.naturalWidth;
      const naturalHeight = entry?.naturalHeight || item.img?.naturalHeight || item.naturalHeight;
      if (rects && naturalWidth && naturalHeight) {
        const sx = item.w / naturalWidth;
        const sy = item.h / naturalHeight;
        for (const r of rects) {
          const x = item.x + r.x * sx;
          const y = item.y + r.y * sy;
          const w = r.w * sx;
          const h = r.h * sy;
          ctx.strokeStyle = "rgba(0,0,0,0.62)";
          ctx.lineWidth = CALIBRATION_BOX_HALO_WIDTH / s;
          ctx.strokeRect(x, y, w, h);
          ctx.strokeStyle = CALIBRATION_BOX_COLOR;
          ctx.lineWidth = CALIBRATION_BOX_WIDTH / s;
          ctx.strokeRect(x, y, w, h);
        }
      }
    }
    ctx.restore();

    if (s !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${Math.round(s * 100)}%`, 8, 20);
    }
  }, [canvasRef, requestThumbnail]);

  // 计算内容范围并适配容器
  const fitToContent = useCallback(() => {
    const imgs = imagesRef.current;
    if (imgs.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of imgs) {
      if (item.columnLabel) {
        minY = Math.min(minY, item.y - COLUMN_HEADER_GAP - COLUMN_HEADER_HEIGHT);
      }
      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + item.w > maxX) maxX = item.x + item.w;
      if (item.y + item.h > maxY) maxY = item.y + item.h;
    }
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const pad = 12;
    const s = Math.min((cw - pad * 2) / contentW, (ch - pad * 2) / contentH);
    scaleRef.current = s;
    panRef.current = {
      x: (cw - contentW * s) / 2 - minX * s,
      y: (ch - contentH * s) / 2 - minY * s,
    };
    setDisplayScale(s);
    scheduleDraw();
  }, [containerRef, scheduleDraw]);

  // 暴露重置视角方法
  if (resetViewRef) resetViewRef.current = fitToContent;

  // images 变化时自适应
  useEffect(() => { fitToContent(); }, [images, fitToContent]);

  // 尺寸适配：拖拽中不重设画布缓冲避免闪烁，稳定后对齐
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const applySize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      canvas.width = w;
      canvas.height = h;
      scheduleDraw();
    };
    applySize();
    const ro = new ResizeObserver(() => {
      scheduleDraw();
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = window.setTimeout(applySize, 100);
    });
    ro.observe(container);
    return () => { ro.disconnect(); clearTimeout(resizeTimerRef.current); };
  }, [containerRef, canvasRef, scheduleDraw]);

  // 滚轮缩放
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const oldScale = scaleRef.current;
      const oldPan = panRef.current;
      const newScale = Math.max(0.1, Math.min(5, oldScale * factor));

      const worldX = (mx - oldPan.x) / oldScale;
      const worldY = (my - oldPan.y) / oldScale;
      const newPanX = mx - worldX * newScale;
      const newPanY = my - worldY * newScale;

      scaleRef.current = newScale;
      panRef.current = { x: newPanX, y: newPanY };
      setDisplayScale(newScale);
      scheduleDraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvasRef, scheduleDraw]);

  // 双击检测：屏幕坐标转世界坐标，命中图片后回调
  const onDoubleClickRef = useRef(onImageDoubleClick);
  onDoubleClickRef.current = onImageDoubleClick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDblClick = (e: MouseEvent) => {
      if (!onDoubleClickRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const s = scaleRef.current;
      const p = panRef.current;
      const worldX = (mx - p.x) / s;
      const worldY = (my - p.y) / s;
      const imgs = imagesRef.current;
      for (const item of imgs) {
        if (worldX >= item.x && worldX <= item.x + item.w && worldY >= item.y && worldY <= item.y + item.h) {
          void onDoubleClickRef.current(item);
          break;
        }
      }
    };
    canvas.addEventListener("dblclick", onDblClick);
    return () => canvas.removeEventListener("dblclick", onDblClick);
  }, [canvasRef]);

  // 拖拽：只更新 ref + 调度绘制，不经过 React state
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { mx: e.clientX, my: e.clientY, sx: panRef.current.x, sy: panRef.current.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    panRef.current = {
      x: dragRef.current.sx + e.clientX - dragRef.current.mx,
      y: dragRef.current.sy + e.clientY - dragRef.current.my,
    };
    scheduleDraw();
  };
  const onMouseUp = () => { dragRef.current = null; };

  return (
    <div ref={containerRef} style={{ display: visible ? "flex" : "none", flex: 1, position: "relative", overflow: "hidden", cursor: dragRef.current ? "grabbing" : "grab" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );
}
