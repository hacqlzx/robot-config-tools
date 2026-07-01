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

/** 图片画布：支持缩放/平移，图片按传入坐标静态排布 */
export default function ImageCanvas({ canvasRef, containerRef, images, visible = true }: Props) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ mx: number; my: number; sx: number; sy: number } | null>(null);

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
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, canvasRef]);

  // 重绘（应用 scale + pan 变换）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(scale, scale);

    let drawn = 0;
    for (const item of images) {
      if (!item.img || !item.img.complete) continue;
      try { ctx.drawImage(item.img, item.x, item.y, item.w, item.h); drawn++; } catch { /* skip */ }
    }
    ctx.restore();

    // 缩放提示
    if (scale !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${Math.round(scale * 100)}%`, 8, 20);
    }
    if (images.length > 0) console.log(`[ImageCanvas] 绘制 ${drawn}/${images.length} 张, scale=${scale.toFixed(2)}, pan=(${pan.x.toFixed(0)},${pan.y.toFixed(0)})`);
  }, [images, scale, pan, canvasRef]);

  // 滚轮缩放
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.max(0.1, Math.min(5, s + delta)));
  }, []);

  // 画布拖拽平移
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { mx: e.clientX, my: e.clientY, sx: pan.x, sy: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.mx;
    const dy = e.clientY - dragRef.current.my;
    setPan({ x: dragRef.current.sx + dx, y: dragRef.current.sy + dy });
  };
  const onMouseUp = () => { dragRef.current = null; };

  return (
    <div ref={containerRef} style={{ display: visible ? "flex" : "none", flex: 1, position: "relative", overflow: "hidden", cursor: dragRef.current ? "grabbing" : "grab" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );
}
