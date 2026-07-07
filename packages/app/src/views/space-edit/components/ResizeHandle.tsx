import type { MouseEventHandler } from "react";

interface ResizeHandleProps {
  onMouseDown: MouseEventHandler<HTMLDivElement>;
}

export default function ResizeHandle({ onMouseDown }: ResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width: 8,
        cursor: "col-resize",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 2,
          borderRadius: 1,
          transition: "background 0.15s",
        }}
        onMouseOver={(e) => {
          const el = e.currentTarget;
          el.style.background = "#d9d9d9";
          el.parentElement!.style.background = "transparent";
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      />
    </div>
  );
}
