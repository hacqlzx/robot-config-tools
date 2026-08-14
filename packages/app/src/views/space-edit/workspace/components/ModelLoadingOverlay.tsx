import { Progress, Spin } from "antd";

interface ModelLoadingOverlayProps {
  title: string;
  message: string;
  percent?: number;
}

export default function ModelLoadingOverlay({ title, message, percent }: ModelLoadingOverlayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        background: "rgba(20, 22, 26, 0.88)",
      }}
    >
      <div style={{ width: "min(360px, calc(100% - 48px))", textAlign: "center" }}>
        <Spin size="large" />
        <div style={{ marginTop: 18, color: "#f2f4f7", fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ marginTop: 6, color: "#aeb4bf", fontSize: 13 }}>{message}</div>
        {typeof percent === "number" && (
          <Progress
            percent={Math.max(0, Math.min(100, Math.round(percent)))}
            size="small"
            strokeColor="#52c41a"
            trailColor="#40444c"
            style={{ marginTop: 14 }}
          />
        )}
      </div>
    </div>
  );
}
