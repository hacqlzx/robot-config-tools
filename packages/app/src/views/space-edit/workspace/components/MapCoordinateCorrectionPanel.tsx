import { Button } from "antd";
import { CheckOutlined, CloseOutlined, RedoOutlined } from "@ant-design/icons";

interface MapCoordinateCorrectionPanelProps {
  mapName: string;
  origin: [number, number, number] | null;
  saving: boolean;
  progress?: number;
  onReselect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

export default function MapCoordinateCorrectionPanel({
  mapName,
  origin,
  saving,
  progress,
  onReselect,
  onConfirm,
  onCancel,
}: MapCoordinateCorrectionPanelProps) {
  return (
    <div
      role="dialog"
      aria-label="坐标纠正"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 22,
        width: "min(520px, calc(100% - 32px))",
        padding: "14px 16px",
        border: "1px solid #d9dde5",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.98)",
        boxShadow: "0 5px 20px rgba(0, 0, 0, 0.2)",
      }}
    >
      <div style={{ color: "#1f2329", fontSize: 14, fontWeight: 600 }}>坐标纠正</div>
      <div style={{ marginTop: 5, color: "#69707d", fontSize: 12 }}>
        {origin ? "已选择新的坐标原点，确认后生成纠正地图" : "请在点云中点击一个点作为新的坐标原点"}
      </div>
      {origin && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 12,
            padding: "9px 10px",
            border: "1px solid #e8eaef",
            borderRadius: 6,
            background: "#fafbfc",
          }}
        >
          {origin.map((value, index) => (
            <div key={index} style={{ minWidth: 0 }}>
              <div style={{ color: "#8a929e", fontSize: 11 }}>{["X", "Y", "Z"][index]}</div>
              <div style={{ marginTop: 2, color: "#252a32", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                {formatCoordinate(value)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, color: "#69707d", fontSize: 12 }}>
        目标地图：<span style={{ color: "#252a32", fontWeight: 500 }}>{mapName}_纠正</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 13 }}>
        <Button size="small" icon={<CloseOutlined />} onClick={onCancel} disabled={saving}>取消</Button>
        <Button size="small" icon={<RedoOutlined />} onClick={onReselect} disabled={saving}>重新选择</Button>
        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={onConfirm} disabled={!origin || saving}>
          {saving ? "生成中" : "确认生成"}
        </Button>
      </div>
      {saving && typeof progress === "number" && (
        <div style={{ height: 3, marginTop: 12, overflow: "hidden", borderRadius: 2, background: "#e8eaef" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, progress))}%`, height: "100%", background: "#1677ff", transition: "width 0.2s" }} />
        </div>
      )}
    </div>
  );
}
