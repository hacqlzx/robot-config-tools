import { lazy, Suspense, useEffect, useState } from "react";
import { Layout, ConfigProvider, App, message as antdMessage } from "antd";
import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./pages/app-header";
import { useSelectedProject } from "./stores/appContextStore";
import "./styles/global.css";
import "./styles/title-bar.scss";

declare global { interface Window { __removeSplash?: () => void; } }

export const APP_HEADER_HEIGHT = 48;
export const MESSAGE_TOP_OFFSET = APP_HEADER_HEIGHT + 12;

const { Content } = Layout;
const ScreenVerify = lazy(() => import("./views/screen-verify"));
const DeviceVerify = lazy(() => import("./views/device-verify"));

export default function AppLayout() {
  const selectedProject = useSelectedProject();
  const location = useLocation();
  const isScreenVerify = location.pathname === "/screen-verify";
  const isDeviceVerify = location.pathname === "/device-verify";
  const projectPageKey = selectedProject || "no-project";
  const [screenVerifyCacheKey, setScreenVerifyCacheKey] = useState(isScreenVerify ? projectPageKey : "");
  const [deviceVerifyCacheKey, setDeviceVerifyCacheKey] = useState(isDeviceVerify ? projectPageKey : "");

  useEffect(() => {
    antdMessage.config({ top: MESSAGE_TOP_OFFSET });
    window.__removeSplash?.();
  }, []);

  useEffect(() => {
    if (isScreenVerify) {
      setScreenVerifyCacheKey(projectPageKey);
    }
  }, [isScreenVerify, projectPageKey]);

  useEffect(() => {
    if (isDeviceVerify) {
      setDeviceVerifyCacheKey(projectPageKey);
    }
  }, [isDeviceVerify, projectPageKey]);

  return (
    <ConfigProvider
      theme={{
        components: {
          Modal: {
            titleFontSize: 16,
            titleColor: "#1a1a1a",
          },
          Select: {
            zIndexPopup: 2100,
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
              {(isScreenVerify || screenVerifyCacheKey === projectPageKey) && (
                <div
                  key={`screen-verify:${projectPageKey}`}
                  style={{ display: isScreenVerify ? "block" : "none", height: "100%" }}
                >
                  <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>
                    <ScreenVerify />
                  </Suspense>
                </div>
              )}
              {(isDeviceVerify || deviceVerifyCacheKey === projectPageKey) && (
                <div
                  key={`device-verify:${projectPageKey}`}
                  style={{ display: isDeviceVerify ? "block" : "none", height: "100%" }}
                >
                  <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>
                    <DeviceVerify />
                  </Suspense>
                </div>
              )}
              {!isScreenVerify && !isDeviceVerify && <Outlet key={projectPageKey} />}
            </div>
          </Content>
        </Layout>
      </App>
    </ConfigProvider>
  );
}
