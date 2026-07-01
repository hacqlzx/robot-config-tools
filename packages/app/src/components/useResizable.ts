import { useState, useRef, useEffect, useCallback } from "react";

interface UseResizableOptions {
  /** 最小宽度，默认 120 */
  minWidth?: number;
  /** 最大宽度，默认不限制（传 0 表示不限制） */
  maxWidth?: number;
  /** 初始宽度占容器百分比（0~1），与 initialWidth 二选一，percentage 优先 */
  initialPercent?: number;
  /** 固定初始宽度（px），percentage 为 0 时生效 */
  initialWidth?: number;
  /** 最大宽度占容器百分比（0~1），与 maxWidth 取较小值 */
  maxPercent?: number;
  /** 容器 ref，用于计算百分比宽度 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 拖拽方向：默认向右拖拽增大宽度（如左侧面板），设为 true 则向左拖拽增大宽度（如右侧面板） */
  reverse?: boolean;
}

export function useResizable(options: UseResizableOptions) {
  const {
    minWidth = 120,
    maxWidth = 0,
    initialPercent = 0,
    initialWidth = 240,
    maxPercent = 0.5,
    containerRef,
    reverse = false,
  } = options;

  const [width, setWidth] = useState(initialWidth);
  const [resizing, setResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(initialWidth);

  // 首帧后按百分比计算初始宽度
  useEffect(() => {
    if (initialPercent > 0) {
      const w = containerRef.current?.offsetWidth;
      if (w) setWidth(Math.round(w * initialPercent));
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setResizing(true);
  }, [width]);

  useEffect(() => {
    if (!resizing) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = reverse
        ? startXRef.current - e.clientX
        : e.clientX - startXRef.current;
      const containerW = containerRef.current?.offsetWidth ?? window.innerWidth;
      const effectiveMax = maxPercent > 0 ? containerW * maxPercent : (maxWidth > 0 ? maxWidth : Infinity);
      const w = Math.round(Math.min(effectiveMax, Math.max(minWidth, startWidthRef.current + delta)));
      setWidth(w);
    };

    const onMouseUp = () => setResizing(false);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing, minWidth, maxWidth, maxPercent, reverse, containerRef]);

  return { width, resizing, onMouseDown, setWidth };
}
