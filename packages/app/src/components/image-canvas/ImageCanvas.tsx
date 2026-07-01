import { useRef, useEffect } from "react";

export interface ImageItem {
  img: HTMLImageElement;
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  images: ImageItem[];
  visible?: boolean;
  onDragImage?: (id: number, x: number, y: number) => void;
}

/** 图片画布：渲染多张图片，支持拖拽 */
export default function ImageCanvas({ canvasRef, containerRef, images, visible = true, onDragImage }: Props) {
  const dragRef = useRef<{ id: number; mx: number; my: number; startX: number; startY: number } | null>(null);

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

  // 重绘
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let drawn = 0;
    for (const item of images) {
      if (!item.img || !item.img.complete) continue;
      try { ctx.drawImage(item.img, item.x, item.y, item.w, item.h); drawn++; } catch { /* skip */ }
    }
    if (images.length > 0) console.log(`[ImageCanvas] 绘制 ${drawn}/${images.length} 张, canvas=${canvas.width}x${canvas.height}`);
  }, [images, canvasRef, containerRef]);

  const getPos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getPos(e);
    for (let i = images.length - 1; i >= 0; i--) {
      const item = images[i];
      if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
        dragRef.current = { id: item.id, mx: x, my: y, startX: item.x, startY: item.y };
        return;
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const { x, y } = getPos(e);
    const dx = x - dragRef.current.mx;
    const dy = y - dragRef.current.my;
    onDragImage?.(dragRef.current.id, dragRef.current.startX + dx, dragRef.current.startY + dy);
  };

  const onMouseUp = () => { dragRef.current = null; };

  return (
    <div ref={containerRef} style={{ display: visible ? "flex" : "none", flex: 1, position: "relative", overflow: "hidden" }}>
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
