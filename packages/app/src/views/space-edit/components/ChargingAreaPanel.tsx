import { useState, useRef, useCallback } from "react";
import { Button } from "antd";
import { UndoOutlined, CloseOutlined } from "@ant-design/icons";

interface Props {
  /** 已放置的点数量（0~3） */
  pointCount: number;
  /** 撤销最后一个点 */
  onUndo: () => void;
  /** 关闭绘制充电区域 */
  onClose: () => void;
}

/** 绘制充电区域操作小窗（可拖动，提示 + 撤销） */
export default function ChargingAreaPanel({ pointCount, onUndo, onClose }: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset({ x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [offset]);

  const tip = pointCount < 3
    ? `请点击第 ${pointCount + 1}/3 个点`
    : "已生成 ✓ 方向键平移 / Delete 删除";

  return (
    <div
      style={{
        position: "absolute",
        right: 16 - offset.x,
        top: 16 + offset.y,
        width: 260,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        zIndex: 30,
        userSelect: "none",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          cursor: "move",
          padding: "8px 12px",
          background: "#1677ff",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>绘制充电区域</span>
        <CloseOutlined
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{ cursor: "pointer", fontSize: 14 }}
        />
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 12, color: "#333" }}>{tip}</span>
          <Button size="small" icon={<UndoOutlined />} onClick={onUndo} disabled={pointCount === 0}>
            撤销
          </Button>
        </div>
      </div>
    </div>
  );
}
