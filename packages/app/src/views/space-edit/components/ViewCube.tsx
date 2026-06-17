interface Props {
  onViewChange?: (direction: "前" | "后" | "左" | "右" | "上" | "下") => void;
}

const DIRECTIONS = ["前", "后", "左", "右", "上", "下"] as const;

export default function ViewCube({ onViewChange }: Props) {
  return (
    <>
      <style>{`
        .space-edit-view-btn {
          width: 28px;
          height: 28px;
          border: 1px solid #d9d9d9;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          color: #666;
          font-size: 12px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .space-edit-view-btn:hover {
          background: #1677ff;
          color: #fff;
          border-color: #1677ff;
        }
      `}</style>
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
          >
            {v}
          </button>
        ))}
      </div>
    </>
  );
}