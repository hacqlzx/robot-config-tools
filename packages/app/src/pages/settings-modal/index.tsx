import { ApiOutlined, PictureOutlined } from "@ant-design/icons";
import { Menu, Modal } from "antd";
import { useState } from "react";
import BackendSettingsPanel from "@/pages/backend-modal";
import ImageAnnotationSettings from "@/pages/image-annotation-settings";

interface Props {
  open: boolean;
  onClose: () => void;
}

const menuItems = [
  {
    key: "backend",
    icon: <ApiOutlined />,
    label: "连接后台",
  },
  {
    key: "image-annotation",
    icon: <PictureOutlined />,
    label: "图像标注",
  },
];

const menuTitles: Record<string, string> = {
  backend: "连接后台",
  "image-annotation": "图像标注配置",
};

export default function SettingsModal({ open, onClose }: Props) {
  const [selectedKey, setSelectedKey] = useState("backend");

  return (
    <Modal
      title="设置"
      open={open}
      centered
      width={780}
      mask={{ closable: false }}
      footer={null}
      destroyOnHidden
      onCancel={onClose}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: "flex", minHeight: 420, borderTop: "1px solid #f0f0f0" }}>
        <div style={{ width: 180, flexShrink: 0, padding: "12px 8px", background: "#f7f8fa", borderRight: "1px solid #f0f0f0" }}>
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onSelect={({ key }) => setSelectedKey(key)}
            style={{ borderInlineEnd: 0, background: "transparent" }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1, padding: "24px 28px" }}>
          <div style={{ marginBottom: 24, color: "#262626", fontSize: 18, fontWeight: 600 }}>
            {menuTitles[selectedKey] || "设置"}
          </div>
          {selectedKey === "backend" && <BackendSettingsPanel onConnected={onClose} />}
          {selectedKey === "image-annotation" && <ImageAnnotationSettings />}
        </div>
      </div>
    </Modal>
  );
}
