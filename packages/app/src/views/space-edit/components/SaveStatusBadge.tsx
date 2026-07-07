import type { SaveStatus } from "../types";

interface SaveStatusBadgeProps {
  status: SaveStatus;
}

export default function SaveStatusBadge({ status }: SaveStatusBadgeProps) {
  if (status === "idle") return null;

  return (
    <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "4px 10px", display: "flex", alignItems: "center", gap: 6, zIndex: 10, pointerEvents: "none" }}>
      {status === "saving" ? (
        <span style={{ color: "#fff", fontSize: 12 }}>保存中...</span>
      ) : (
        <span style={{ color: "#52c41a", fontSize: 12 }}>&#10003; 已保存</span>
      )}
    </div>
  );
}
