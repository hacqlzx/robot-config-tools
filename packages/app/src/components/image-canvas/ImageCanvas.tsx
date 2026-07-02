import { useRef, useEffect, useState, useCallback } from "react";

export interface ImageItem {
  img: HTMLImageElement;
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  side: "left" | "right";
  spId: number;
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  images: ImageItem[];
  visible?: boolean;
}

/** 图片画布：缩放/平移，rAF 驱动渲染，预缩放缩略图，视口裁剪 */
export default function ImageCanvas({ canvasRef, containerRef, images, visible = true }: Props) {
  const [displayScale, setDisplayScale] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const dragRef = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);
  const rafIdRef = useRef(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const thumbScale = 2;

  // 预缩放缩略图缓存：id → 2x 缩略尺寸的离屏 canvas，避免每帧从大图缩放，同时保证 2x 内不糊
  const thumbCacheRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // 重建缩略图缓存
  useEffect(() => {
    const cache = thumbCacheRef.current;
    const newIds = new Set(images.map((item) => item.id));
    for (const id of cache.keys()) {
      if (!newIds.has(id)) cache.delete(id);
    }
    for (const item of images) {
      if (cache.has(item.id)) continue;
      if (!item.img || !item.img.complete) continue;
      const thumb = document.createElement("canvas");
      thumb.width = item.w * thumbScale;
      thumb.height = item.h * thumbScale;
      const tCtx = thumb.getContext("2d");
      if (tCtx) tCtx.drawImage(item.img, 0, 0, thumb.width, thumb.height);
      cache.set(item.id, thumb);
    }
  }, [images]);

  // 尺寸适配
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      canvas.width = w;
      canvas.height = h;
      scheduleDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, canvasRef]);

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
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);

    let drawn = 0;
    const imgs = imagesRef.current;
    const cache = thumbCacheRef.current;
    for (const item of imgs) {
      // 视口裁剪
      if (item.x + item.w < vpLeft || item.x > vpRight) continue;
      if (item.y + item.h < vpTop || item.y > vpBottom) continue;

      const src = cache.get(item.id) || item.img;
      try { ctx.drawImage(src, item.x, item.y, item.w, item.h); drawn++; } catch { /* skip */ }
    }
    ctx.restore();

    if (s !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${Math.round(s * 100)}%`, 8, 20);
    }
    if (imgs.length > 0) console.log(`[ImageCanvas] 绘制 ${drawn}/${imgs.length} 张, scale=${s.toFixed(2)}`);
  }, [canvasRef]);

  const scheduleDraw = useCallback(() => {
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(draw);
    }
  }, [draw]);

  // images 变化时触发重绘
  useEffect(() => {
    scheduleDraw();
  }, [images, scheduleDraw]);

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
