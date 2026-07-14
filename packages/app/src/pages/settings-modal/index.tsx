import { ApiOutlined } from "@ant-design/icons";
import { Menu, Modal } from "antd";
import BackendSettingsPanel from "@/pages/backend-modal";

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
];

export default function SettingsModal({ open, onClose }: Props) {
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
            selectedKeys={["backend"]}
            items={menuItems}
            style={{ borderInlineEnd: 0, background: "transparent" }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1, padding: "24px 28px" }}>
          <div style={{ marginBottom: 24, color: "#262626", fontSize: 18, fontWeight: 600 }}>连接后台</div>
          <BackendSettingsPanel onConnected={onClose} />
        </div>
      </div>
    </Modal>
  );
}
