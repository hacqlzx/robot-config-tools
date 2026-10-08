import { useRef } from "react";
import type { ReactNode } from "react";
import { useElementActive } from "@/components/useElementActive";
import type { SpaceSceneAdapterFactory, SpaceSceneLifecycleState } from "../engine/types";
import { useSpaceSceneHost } from "../engine/useSpaceSceneHost";
import SpacePerformanceMonitor from "./SpacePerformanceMonitor";

interface SpaceSceneHostProps {
  adapterFactory: SpaceSceneAdapterFactory | null;
  overlay?: ReactNode | ((state: SpaceSceneLifecycleState) => ReactNode);
  onSceneClick?: (clientX: number, clientY: number) => void;
  picking?: boolean;
  busy?: boolean;
}

const stateText = {
  detached: "三维场景未连接",
  mounting: "正在初始化三维场景...",
  ready: "",
  failed: "三维场景初始化失败",
} as const;

export default function SpaceSceneHost({ adapterFactory, overlay, onSceneClick, picking = false, busy = false }: SpaceSceneHostProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const active = useElementActive(sectionRef);
  const { hostRef, adapterRef, state, error } = useSpaceSceneHost(adapterFactory, active);
  const renderedOverlay = typeof overlay === "function" ? overlay(state) : overlay;

  return (
    <section
      ref={sectionRef}
      aria-label="三维场景"
      data-space-edit-busy={busy ? "true" : "false"}
      onPointerDownCapture={(event) => {
        const target = event.target as Node;
        if (event.button === 0 && hostRef.current?.contains(target)) {
          pointerDownRef.current = { x: event.clientX, y: event.clientY };
        } else {
          pointerDownRef.current = null;
        }
      }}
      onPointerUpCapture={(event) => {
        const start = pointerDownRef.current;
        pointerDownRef.current = null;
        const target = event.target as Node;
        if (!start || event.button !== 0 || !hostRef.current?.contains(target)) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
        onSceneClick?.(event.clientX, event.clientY);
      }}
      style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: "#181a1f", cursor: picking ? "crosshair" : undefined }}
    >
      <div ref={hostRef} data-scene-state={state} style={{ position: "absolute", inset: 0 }} />
      <SpacePerformanceMonitor active={active} adapterRef={adapterRef} />
      {state !== "ready" && (
        <div
          role={state === "failed" ? "alert" : "status"}
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: state === "failed" ? "#ff7875" : "#aeb4bf",
            fontSize: 14,
            pointerEvents: "none",
          }}
        >
          <span title={error?.message}>{stateText[state]}</span>
        </div>
      )}
      {renderedOverlay}
    </section>
  );
}
