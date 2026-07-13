import { useEffect } from "react";
import { Layout, ConfigProvider, App, message as antdMessage } from "antd";
import { Outlet } from "react-router-dom";
import AppHeader from "./pages/app-header";
import { useSelectedProject } from "./stores/appContextStore";
import "./styles/global.css";
import "./styles/title-bar.scss";

declare global { interface Window { __removeSplash?: () => void; } }

export const APP_HEADER_HEIGHT = 48;
export const MESSAGE_TOP_OFFSET = APP_HEADER_HEIGHT + 12;

const { Content } = Layout;

export default function AppLayout() {
  const selectedProject = useSelectedProject();

  useEffect(() => {
    antdMessage.config({ top: MESSAGE_TOP_OFFSET });
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
        top: MESSAGE_TOP_OFFSET,
      }}
    >
      <App message={{ top: MESSAGE_TOP_OFFSET }}>
        <Layout style={{ height: "100vh", overflow: "hidden" }}>
          <AppHeader />
          <Content style={{ height: `calc(100vh - ${APP_HEADER_HEIGHT}px)`, padding: 0, background: "#f5f5f5", overflow: "hidden" }}>
            <div style={{ height: "100%", boxSizing: "border-box" }}>
              <Outlet key={selectedProject || "no-project"} />
            </div>
          </Content>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
