import type { ReactNode, RefObject } from "react";
import type { SaveStatus } from "../types";
import LoadingOverlay from "./LoadingOverlay";
import SaveStatusBadge from "./SaveStatusBadge";

interface SceneViewportProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  saveStatus: SaveStatus;
  loading: boolean;
  loadingProgress: number;
  loadingText: string;
  children?: ReactNode;
}

/**
 * 三维视口基础容器。
 *
 * canvas 永远铺满内容区，DOM 浮层（保存状态、加载遮罩、绘制面板）叠在 canvas 上方。
 * 这里不直接访问 PlayCanvas app，避免展示层和三维生命周期耦合。
 */
export default function SceneViewport({ canvasRef, saveStatus, loading, loadingProgress, loadingText, children }: SceneViewportProps) {
  return (
    <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: "8px 8px 8px 0", overflow: "hidden", borderRadius: 4 }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
      {/* 保存状态和加载遮罩是纯 DOM，避免进入 PlayCanvas 渲染管线。 */}
      <SaveStatusBadge status={saveStatus} />
      {(loading || loadingProgress > 0) && (
        <LoadingOverlay text={loadingText || "处理中..."} progress={loadingProgress} />
      )}
      {children}
    </div>
  );
}
