import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import type { SpaceSceneAdapter, SpaceScenePerformanceStats } from "../engine/types";

interface SpacePerformanceMonitorProps {
  active: boolean;
  adapterRef: RefObject<SpaceSceneAdapter | null>;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

interface PerformanceSample {
  fps: number;
  frameTime: number;
  updateTime: number;
  renderTime: number;
  longFrames: number;
  stats: SpaceScenePerformanceStats;
  memory: PerformanceMemory | null;
}

const EMPTY_STATS: SpaceScenePerformanceStats = {
  frameCount: 0,
  longFrames: 0,
  workMs: 0,
  updateMs: 0,
  renderMs: 0,
  totalPointCount: null,
  visiblePointCount: null,
  visibleNodeCount: 0,
  residentPointCount: null,
  gpuNodeCount: null,
  drawCalls: null,
  drawCallsEstimated: false,
  triangles: null,
  geometries: null,
  textures: null,
  canvasWidth: 0,
  canvasHeight: 0,
};

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  zIndex: 13,
  width: 254,
  padding: "10px 12px",
  border: "1px solid rgba(148, 163, 184, 0.32)",
  borderRadius: 6,
  background: "rgba(15, 23, 42, 0.93)",
  boxShadow: "0 6px 20px rgba(0, 0, 0, 0.28)",
  color: "#e2e8f0",
  fontFamily: "Consolas, 'SFMono-Regular', monospace",
  fontSize: 12,
  lineHeight: 1.5,
  pointerEvents: "none",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 7,
  color: "#f8fafc",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontSize: 13,
  fontWeight: 600,
};

const keyStyle: CSSProperties = {
  padding: "1px 5px",
  border: "1px solid rgba(148, 163, 184, 0.38)",
  borderRadius: 3,
  color: "#cbd5e1",
  fontFamily: "Consolas, 'SFMono-Regular', monospace",
  fontSize: 11,
  fontWeight: 500,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 12,
  alignItems: "baseline",
  borderTop: "1px solid rgba(148, 163, 184, 0.15)",
  padding: "3px 0",
};

function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getMemory(): PerformanceMemory | null {
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory || !Number.isFinite(memory.usedJSHeapSize) || !Number.isFinite(memory.jsHeapSizeLimit)) return null;
  return memory;
}

export default function SpacePerformanceMonitor({ active, adapterRef }: SpacePerformanceMonitorProps) {
  const [visible, setVisible] = useState(false);
  const [sample, setSample] = useState<PerformanceSample | null>(null);

  useEffect(() => {
    if (!active) return undefined;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "F1" && event.key !== "F1") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setVisible((current) => !current);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active]);

  useEffect(() => {
    if (!visible || !active) return undefined;

    let previous = adapterRef.current?.getPerformanceStats() ?? EMPTY_STATS;
    let previousTime = performance.now();
    const update = (): void => {
      const now = performance.now();
      const stats = adapterRef.current?.getPerformanceStats() ?? EMPTY_STATS;
      if (stats.frameCount < previous.frameCount) previous = EMPTY_STATS;
      const frames = Math.max(0, stats.frameCount - previous.frameCount);
      const elapsed = Math.max(1, now - previousTime);
      setSample({
        fps: frames * 1000 / elapsed,
        frameTime: frames ? (stats.workMs - previous.workMs) / frames : 0,
        updateTime: frames ? (stats.updateMs - previous.updateMs) / frames : 0,
        renderTime: frames ? (stats.renderMs - previous.renderMs) / frames : 0,
        longFrames: Math.max(0, stats.longFrames - previous.longFrames),
        stats,
        memory: getMemory(),
      });
      previous = stats;
      previousTime = now;
    };

    const interval = window.setInterval(update, 500);
    return () => window.clearInterval(interval);
  }, [active, adapterRef, visible]);

  if (!visible || !active) return null;

  const stats = sample?.stats ?? adapterRef.current?.getPerformanceStats() ?? EMPTY_STATS;
  const memory = sample?.memory ?? getMemory();

  return (
    <div role="status" aria-label="性能监控" style={panelStyle}>
      <div style={headerStyle}>
        <span>性能监控</span>
        <span style={keyStyle}>F1</span>
      </div>
      <div style={rowStyle}><span>FPS</span><strong>{sample ? sample.fps.toFixed(1) : "--"}</strong></div>
      <div style={rowStyle}><span>帧耗时（CPU）</span><strong>{sample ? `${sample.frameTime.toFixed(1)} ms` : "--"}</strong></div>
      <div style={rowStyle}><span>更新 / 渲染</span><strong>{sample ? `${sample.updateTime.toFixed(1)} / ${sample.renderTime.toFixed(1)} ms` : "--"}</strong></div>
      <div style={rowStyle}><span>长帧（≥50 ms）</span><strong>{sample?.longFrames ?? "--"}</strong></div>
      <div style={rowStyle}><span>点云总点数</span><strong>{formatCount(stats.totalPointCount)}</strong></div>
      <div style={rowStyle}><span>当前可见点数</span><strong>{formatCount(stats.visiblePointCount)}</strong></div>
      <div style={rowStyle}><span>可见节点</span><strong>{formatCount(stats.visibleNodeCount)}</strong></div>
      <div style={rowStyle}><span>LRU 驻留点数</span><strong>{formatCount(stats.residentPointCount)}</strong></div>
      <div style={rowStyle}><span>点云 GPU 节点</span><strong>{formatCount(stats.gpuNodeCount)}</strong></div>
      <div style={rowStyle}><span>点云绘制调用{stats.drawCallsEstimated ? "（约）" : ""}</span><strong>{formatCount(stats.drawCalls)}</strong></div>
      <div style={rowStyle}><span>辅助三角形</span><strong>{formatCount(stats.triangles)}</strong></div>
      <div style={rowStyle}><span>辅助几何 / 纹理</span><strong>{formatCount(stats.geometries)} / {formatCount(stats.textures)}</strong></div>
      <div style={rowStyle}><span>画布</span><strong>{stats.canvasWidth} × {stats.canvasHeight}</strong></div>
      <div style={rowStyle}><span>JS 堆内存</span><strong>{memory ? `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}` : "不可用"}</strong></div>
    </div>
  );
}
