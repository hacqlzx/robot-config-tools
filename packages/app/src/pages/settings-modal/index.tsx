import { ApiOutlined, PictureOutlined, FolderOutlined } from "@ant-design/icons";
import { Menu, Modal } from "antd";
import { useEffect, useState } from "react";
import BackendSettingsPanel from "@/pages/backend-modal";
import ImageAnnotationSettings from "@/pages/image-annotation-settings";
import StorageSettings from "@/pages/storage-settings";
import "./index.scss";

interface Props {
  open: boolean;
  onClose: () => void;
  onStorageMigrationComplete?: () => Promise<void> | void;
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
  { key: "storage", icon: <FolderOutlined />, label: "项目存储" },
];

const menuTitles: Record<string, string> = {
  backend: "连接后台",
  "image-annotation": "图像标注配置",
  storage: "项目存储",
};

export default function SettingsModal({ open, onClose, onStorageMigrationComplete }: Props) {
  const [selectedKey, setSelectedKey] = useState("backend");
  const [storageBusy, setStorageBusy] = useState(false);
  const [compact, setCompact] = useState(window.innerWidth < 620);

  useEffect(() => {
    const updateCompact = () => setCompact(window.innerWidth < 620);
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  return (
    <Modal
      title="设置"
      className="settings-modal"
      open={open}
      centered
      width={compact ? "calc(100vw - 24px)" : 860}
      mask={{ closable: false }}
      footer={null}
      destroyOnHidden
      closable={!storageBusy}
      keyboard={!storageBusy}
      onCancel={() => { if (!storageBusy) onClose(); }}
      styles={{ body: { padding: 0, maxHeight: "none", overflow: "hidden" } }}
    >
      <div className={`settings-modal__layout${compact ? " settings-modal__layout--compact" : ""}`}>
        <div className="settings-modal__navigation">
          <Menu
            mode={compact ? "horizontal" : "inline"}
            selectedKeys={[selectedKey]}
            items={menuItems}
            onSelect={({ key }) => { if (!storageBusy) setSelectedKey(key); }}
            className="settings-modal__menu"
          />
        </div>
        <div className="settings-modal__content">
          <h2 className="settings-modal__title">
            {menuTitles[selectedKey] || "设置"}
          </h2>
          <div className="settings-modal__panel" key={selectedKey}>
            {selectedKey === "backend" && <BackendSettingsPanel onConnected={onClose} />}
            {selectedKey === "image-annotation" && <ImageAnnotationSettings />}
            {selectedKey === "storage" && <StorageSettings onBusyChange={setStorageBusy} onMigrationComplete={onStorageMigrationComplete} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
