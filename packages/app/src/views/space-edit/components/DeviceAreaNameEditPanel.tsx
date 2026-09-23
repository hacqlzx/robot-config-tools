import { useState } from "react";
import { Button, Input } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";

interface Props {
  name: string;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export default function DeviceAreaNameEditPanel({ name, saving = false, onClose, onConfirm }: Props) {
  const [draft, setDraft] = useState(name);
  const trimmedDraft = draft.trim();
  const changed = trimmedDraft !== name.trim();

  const handleConfirm = () => {
    if (!trimmedDraft) return;
    if (changed) onConfirm(trimmedDraft);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="编辑设备区域名称"
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        width: 340,
        maxWidth: "calc(100% - 32px)",
        zIndex: 31,
        overflow: "hidden",
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div style={{
        minHeight: 40,
        padding: "8px 8px 8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#1677ff",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
      }}>
        <span>编辑设备区域</span>
        <Button
          type="text"
          size="small"
          aria-label="关闭"
          title="关闭"
          icon={<CloseOutlined />}
          disabled={saving}
          onClick={onClose}
          style={{ color: "#fff" }}
        />
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ marginBottom: 6, fontSize: 12, color: "#666" }}>设备区域名称</div>
        <Input
          autoFocus
          size="small"
          value={draft}
          maxLength={100}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onPressEnter={handleConfirm}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Button size="small" disabled={saving} onClick={onClose}>取消</Button>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            disabled={saving || !trimmedDraft}
            onClick={handleConfirm}
          >
            确定
          </Button>
        </div>
      </div>
    </div>
  );
}
