import type { SaveStatus } from "../types";

interface SaveStatusBadgeProps {
  status: SaveStatus;
}

export default function SaveStatusBadge({ status }: SaveStatusBadgeProps) {
  if (status === "idle") return null;

  const presentation = {
    dirty: { text: "有未保存修改", color: "#ad6800", background: "rgba(255,251,230,0.96)", border: "#ffc53d" },
    saving: { text: "保存中...", color: "#fff", background: "rgba(0,0,0,0.72)", border: "rgba(255,255,255,0.12)" },
    saved: { text: "已保存", color: "#237804", background: "rgba(246,255,237,0.96)", border: "#52c41a" },
    failed: { text: "保存失败，请重试", color: "#a8071a", background: "rgba(255,241,240,0.97)", border: "#ff7875" },
  }[status];

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        background: presentation.background,
        border: `1px solid ${presentation.border}`,
        borderRadius: 6,
        padding: "6px 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        zIndex: 10,
        pointerEvents: "none",
        boxShadow: "0 2px 8px rgba(0,0,0,0.22)",
      }}
    >
      <span style={{ color: presentation.color, fontSize: 13, fontWeight: 600 }}>
        {status === "saved" ? "\u2713 " : ""}{presentation.text}
      </span>
    </div>
  );
}
