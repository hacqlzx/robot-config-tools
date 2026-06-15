interface Props {
  onViewChange?: (direction: "前" | "后" | "左" | "右" | "上" | "下") => void;
}

const DIRECTIONS = ["前", "后", "左", "右", "上", "下"] as const;

export default function ViewCube({ onViewChange }: Props) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 4,
      padding: "8px 6px",
      background: "#fff",
      borderRight: "1px solid #e8e8e8",
      flexShrink: 0,
    }}>
      {DIRECTIONS.map((v) => (
        <button
          key={v}
          className="space-edit-view-btn"
          onClick={() => onViewChange?.(v)}
          style={{
            width: 28,
            height: 28,
            border: "1px solid #d9d9d9",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
            color: "#666",
            fontSize: 12,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
