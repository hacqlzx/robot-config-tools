import { Button, Input, Spin } from "antd";
import { FolderOutlined } from "@ant-design/icons";

export interface ExportMapOption {
  label: string;
  value: string;
}

interface ExportMapPickerProps {
  currentProject?: string | null;
  loading?: boolean;
  mapOptions: ExportMapOption[];
  selectedMap?: string;
  onSelect: (mapName: string) => void;
}

interface ExportMapFooterProps {
  selectedMap?: string;
  confirming?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}

export default function ExportMapPicker({
  currentProject,
  loading = false,
  mapOptions,
  selectedMap,
  onSelect,
}: ExportMapPickerProps) {
  return (
    <div style={{ padding: "4px 2px 0" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b7280", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          <FolderOutlined style={{ color: "#9ca3af" }} />
          <span>当前项目</span>
        </div>
        <Input
          value={currentProject || "未选择"}
          readOnly
          size="small"
          style={{ height: 32, borderRadius: 5, color: "#374151", fontSize: 13, background: "#fff" }}
        />
      </div>

      <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>地图列表</div>
      <div style={{ height: 210, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 5, background: "#fff" }}>
        {loading ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Spin />
          </div>
        ) : mapOptions.length === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>暂无地图</div>
        ) : (
          mapOptions.map((option) => {
            const selected = option.value === selectedMap;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                style={{
                  width: "100%",
                  minHeight: 42,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  border: 0,
                  borderBottom: "1px solid #f0f0f0",
                  background: selected ? "#eef5ff" : "#fff",
                  color: selected ? "#2f7af8" : "#1f2937",
                  fontSize: 13,
                  fontWeight: selected ? 600 : 400,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {option.label}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ExportMapFooter({ selectedMap, confirming, disabled, onConfirm }: ExportMapFooterProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <span style={{ color: "#2f7af8", fontSize: 13, fontWeight: 600 }}>
        已选择：{selectedMap || "未选择"}
      </span>
      <Button size="small" type="primary" onClick={onConfirm} loading={confirming} disabled={disabled} style={{ minWidth: 64 }}>
        确定
      </Button>
    </div>
  );
}
