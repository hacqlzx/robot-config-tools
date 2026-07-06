import { useEffect } from "react";
import { Layout, ConfigProvider, App } from "antd";
import { Outlet } from "react-router-dom";
import AppHeader from "./pages/app-header";
import "./styles/global.css";
import "./styles/title-bar.scss";

declare global { interface Window { __removeSplash?: () => void; } }

const { Content } = Layout;

export default function AppLayout() {
  useEffect(() => {
    window.__removeSplash?.();
  }, []);

  return (
    <ConfigProvider
      theme={{
        components: {
          Modal: {
            titleFontSize: 16,
            titleColor: "#1a1a1a",
          },
        },
      }}
      modal={{
        styles: {
          header: { marginBottom: 16 },
          body: { paddingTop: 28 },
        },
      }}
      message={{
        top: 60, // 消息提示移到 header(48px) 下方，避免被顶部栏遮挡
      }}
    >
      <App>
        <Layout style={{ height: "100vh", overflow: "hidden" }}>
          <AppHeader />
          <Content style={{ height: "calc(100vh - 48px)", padding: 0, background: "#f5f5f5", overflow: "hidden" }}>
            <div style={{ height: "100%", boxSizing: "border-box" }}>
              <Outlet />
            </div>
          </Content>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
