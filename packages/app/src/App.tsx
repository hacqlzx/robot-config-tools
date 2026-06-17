import { Layout, ConfigProvider, App } from "antd";
import { Outlet } from "react-router-dom";
import AppHeader from "./pages/app-header";
import "./styles/global.css";
import "./styles/title-bar.scss";

const { Content } = Layout;

export default function AppLayout() {
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
