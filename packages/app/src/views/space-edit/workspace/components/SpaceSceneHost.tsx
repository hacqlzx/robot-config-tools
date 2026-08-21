import { useRef } from "react";
import type { ReactNode } from "react";
import { useElementActive } from "@/components/useElementActive";
import type { SpaceSceneAdapterFactory, SpaceSceneLifecycleState } from "../engine/types";
import { useSpaceSceneHost } from "../engine/useSpaceSceneHost";

interface SpaceSceneHostProps {
  adapterFactory: SpaceSceneAdapterFactory | null;
  overlay?: ReactNode | ((state: SpaceSceneLifecycleState) => ReactNode);
}

const stateText = {
  detached: "三维场景未连接",
  mounting: "正在初始化三维场景...",
  ready: "",
  failed: "三维场景初始化失败",
} as const;

export default function SpaceSceneHost({ adapterFactory, overlay }: SpaceSceneHostProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const active = useElementActive(sectionRef);
  const { hostRef, state, error } = useSpaceSceneHost(adapterFactory, active);
  const renderedOverlay = typeof overlay === "function" ? overlay(state) : overlay;

  return (
    <section
      ref={sectionRef}
      aria-label="三维场景"
      style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: "#181a1f" }}
    >
      <div ref={hostRef} data-scene-state={state} style={{ position: "absolute", inset: 0 }} />
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
