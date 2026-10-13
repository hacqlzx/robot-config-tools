import { useState } from "react";
import { Layout } from "antd";
import { EnvironmentOutlined, RobotOutlined, AimOutlined, CloudServerOutlined, WifiOutlined } from "@ant-design/icons";
import StationConfig from "./station";
import RobotConfig from "./robot";
import MapConfig from "./map";
import PlatformConfig from "./platform";
import NetworkConfig from "./network";
import "./index.scss";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "station", label: "厂站", icon: <EnvironmentOutlined /> },
  { key: "robot", label: "机器人", icon: <RobotOutlined /> },
  { key: "map", label: "地图", icon: <AimOutlined /> },
  { key: "platform", label: "平台", icon: <CloudServerOutlined /> },
  { key: "network", label: "网络", icon: <WifiOutlined /> },
];

export default function ConfigPage() {
  const [selectedKey, setSelectedKey] = useState("station");

  const renderContent = () => {
    switch (selectedKey) {
      case "station":
        return <StationConfig />;
      case "robot":
        return <RobotConfig />;
      case "map":
        return <MapConfig />;
      case "platform":
        return <PlatformConfig />;
      case "network":
        return <NetworkConfig />;
      default:
        return null;
    }
  };

  return (
    <Layout className="config-page" style={{ height: "100%", background: "#f5f5f5" }}>
      <Sider width={80} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <div className="config-side-menu">
          {menuItems.map((item) => (
            <div
              key={item.key}
              className={`config-side-menu-item ${selectedKey === item.key ? "active" : ""}`}
              onClick={() => setSelectedKey(item.key)}
            >
              <div className="menu-item-inner">
                {item.icon}
                <span>{item.label}</span>
              </div>
            </div>
          ))}
        </div>
      </Sider>
      <Content className="config-page__frame">
        <div className="config-page__content">
          {selectedKey !== "platform" && (
            <h3 style={{ margin: 0, padding: "0 0 12px 0", fontSize: 16, display: "flex", alignItems: "center", gap: 10, lineHeight: "24px" }}>
              <span style={{ display: "inline-block", width: 3, height: 18, background: "#546BF7", borderRadius: 2 }} />
              {menuItems.find((m) => m.key === selectedKey)?.label}配置
            </h3>
          )}
          <div style={{ height: selectedKey === "platform" ? "100%" : "calc(100% - 36px)" }}>
            {renderContent()}
          </div>
        </div>
      </Content>
    </Layout>
  );
}
