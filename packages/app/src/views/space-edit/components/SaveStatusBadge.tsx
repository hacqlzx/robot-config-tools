import type { SaveStatus } from "../types";

interface SaveStatusBadgeProps {
  status: SaveStatus;
}

export default function SaveStatusBadge({ status }: SaveStatusBadgeProps) {
  if (status === "idle") return null;

  const isSaved = status === "saved";

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        background: isSaved ? "rgba(246,255,237,0.96)" : "rgba(0,0,0,0.72)",
        border: isSaved ? "1px solid #52c41a" : "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        padding: isSaved ? "7px 14px" : "5px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        zIndex: 10,
        pointerEvents: "none",
        boxShadow: isSaved ? "0 4px 14px rgba(82,196,26,0.28)" : "0 2px 8px rgba(0,0,0,0.22)",
        transform: isSaved ? "scale(1.02)" : "none",
      }}
    >
      {status === "saving" ? (
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>保存中...</span>
      ) : (
        <span style={{ color: "#237804", fontSize: 15, fontWeight: 700 }}>&#10003; 已保存</span>
      )}
    </div>
  );
}
