import { Spin } from "antd";

interface LoadingOverlayProps {
  text: string;
  progress?: number;
  zIndex?: number;
}

export default function LoadingOverlay({ text, progress = 0, zIndex = 100 }: LoadingOverlayProps) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
      <Spin size="large" />
      <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>{text}</div>
      {progress > 0 && (
        <div style={{ width: 200, marginTop: 12 }}>
          <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#fff", borderRadius: 2, transition: "width 0.2s" }} />
          </div>
          <div style={{ color: "#fff", fontSize: 12, textAlign: "center", marginTop: 4 }}>{progress}%</div>
        </div>
      )}
    </div>
  );
}
