import { useState } from "react";
import { Menu, Button, Select, Dropdown } from "antd";
import { MinusOutlined, BorderOutlined, CloseOutlined, SettingOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { menuConfig } from "@/config/menu";
import { getCurrentIp } from "@/stores/backendStore";
import BackendModal from "@/components/backend-modal";

const menuItems: MenuProps["items"] = menuConfig.map((item) => ({ key: item.key, label: item.label }));

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);

  const settingMenu: MenuProps["items"] = [
    {
      key: "backend",
      label: "连接后台",
      onClick: () => setModalOpen(true),
    },
  ];

  return (
    <div className="app-header" style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
      <Menu mode="horizontal" selectedKeys={[location.pathname]} items={menuItems} className="app-header__menu" style={{ width: "auto" }} onClick={({ key }) => navigate(key)} />
      <div className="app-header__toolbar">
        <Select placeholder="选择厂站" style={{ width: 120 }} size="small" options={[]} />
        <Select placeholder="选择机器人" style={{ width: 120 }} size="small" options={[]} />
        <Dropdown menu={{ items: settingMenu }} trigger={["hover"]}>
          <Button type="text" size="small" icon={<SettingOutlined />} />
        </Dropdown>
        <div className="app-header__controls">
          <Button type="text" size="small" icon={<MinusOutlined />} onClick={() => window.electronAPI?.minimize()} />
          <Button type="text" size="small" icon={<BorderOutlined />} onClick={() => window.electronAPI?.maximize()} />
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => window.electronAPI?.close()} />
        </div>
      </div>
      <BackendModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
