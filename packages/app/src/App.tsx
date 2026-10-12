import { lazy, Suspense, useEffect, useState } from "react";
import { Layout, ConfigProvider, App, message as antdMessage } from "antd";
import { Outlet, useLocation } from "react-router-dom";
import AppHeader from "./pages/app-header";
import AppFooter from "./pages/app-footer";
import { useSelectedProject } from "./stores/appContextStore";
import SpaceEdit from "./views/space-edit/workspace";
import "./styles/global.css";
import "./styles/title-bar.scss";

declare global { interface Window { __removeSplash?: () => void; } }

/** 顶部导航栏高度（px），供各页面计算内容区高度使用 */
export const APP_HEADER_HEIGHT = 48;
/** 全局 message 提示距顶部的偏移，避免被顶部栏遮挡 */
export const MESSAGE_TOP_OFFSET = APP_HEADER_HEIGHT + 12;

const { Content } = Layout;

// 屏柜验证图和设备验证图按需加载，减少首屏体积
const ScreenVerify = lazy(() => import("./views/screen-verify"));
const DeviceVerify = lazy(() => import("./views/device-verify"));
const ImageEdit = lazy(() => import("./views/image-edit"));

/**
 * 全局布局组件，负责：
 * 1. ConfigProvider：统一 Ant Design 主题和弹窗默认行为。
 * 2. 根据当前路由渲染页面，并对核心页做 keepalive 缓存。
 * 3. 项目切换时通过 key 重建业务页，清理旧项目的地图/绘制/列表状态。
 * 4. 空间编辑、勘察图片、屏柜/设备验证图页面保持缓存，切换回来时不重新初始化。
 */
export default function AppLayout() {
  const selectedProject = useSelectedProject();
  const location = useLocation();
  const isSpaceEdit = location.pathname === "/space-edit";
  const isImageEdit = location.pathname === "/image-edit";
  const isScreenVerify = location.pathname === "/screen-verify";
  const isDeviceVerify = location.pathname === "/device-verify";

  // 以项目名作为页面 key，切换项目时强制重建 Outlet，清理旧状态
  const projectPageKey = selectedProject || "no-project";

  // 空间编辑、勘察图片和验证图都需要缓存 key，离开页面后再切回来时复用同一实例
  const [spaceEditCacheKey, setSpaceEditCacheKey] = useState(isSpaceEdit ? projectPageKey : "");
  const [imageEditCacheKey, setImageEditCacheKey] = useState(isImageEdit ? projectPageKey : "");
  const [screenVerifyCacheKey, setScreenVerifyCacheKey] = useState(isScreenVerify ? projectPageKey : "");
  const [deviceVerifyCacheKey, setDeviceVerifyCacheKey] = useState(isDeviceVerify ? projectPageKey : "");

  useEffect(() => {
    // 兼容旧版静态 message API 的 top 偏移配置
    antdMessage.config({ top: MESSAGE_TOP_OFFSET });
    // 移除 HTML 中的启动占位 splash 元素
    window.__removeSplash?.();
  }, []);

  // 进入空间编辑页时更新缓存 key
  useEffect(() => {
    if (isSpaceEdit) {
      setSpaceEditCacheKey(projectPageKey);
    }
  }, [isSpaceEdit, projectPageKey]);

  // 进入勘察图片页时更新缓存 key
  useEffect(() => {
    if (isImageEdit) {
      setImageEditCacheKey(projectPageKey);
    }
  }, [isImageEdit, projectPageKey]);

  // 进入屏柜验证图页面时更新缓存 key，使缓存与当前项目对应
  useEffect(() => {
    if (isScreenVerify) {
      setScreenVerifyCacheKey(projectPageKey);
    }
  }, [isScreenVerify, projectPageKey]);

  // 进入设备验证图页面时更新缓存 key
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
            // 全局弹窗标题字号，保持紧凑
            titleFontSize: 14,
            titleColor: "#1a1a1a",
          },
          Select: {
            // 提高下拉层级，防止被弹窗遮挡
            zIndexPopup: 2100,
          },
        },
      }}
      modal={{
        // 所有弹窗默认垂直居中
        centered: true,
        // 响应式宽度：最大 400px，窗口小时收窄到 90vw
        width: "min(400px, 90vw)",
        styles: {
          header: { marginBottom: 8 },
          // body 限制最大高度并支持滚动，防止内容过多撑破视口
          body: { paddingTop: 12, maxHeight: "60vh", overflowY: "auto" },
        },
      }}
      message={{
        // 全局提示距顶部偏移，与顶部栏对齐
        top: MESSAGE_TOP_OFFSET,
      }}
    >
      <App message={{ top: MESSAGE_TOP_OFFSET }}>
        <Layout style={{ height: "100vh", overflow: "hidden" }}>
          <AppHeader />
          <Content style={{ flex: "1 1 0", minHeight: 0, padding: 0, background: "#f5f5f5", overflow: "hidden" }}>
            <div style={{ height: "100%", boxSizing: "border-box" }}>
              {/*
                空间编辑页：通过 display 切换显隐而非卸载，保留模型、绘制、历史栈和自动保存状态。
              */}
              {(isSpaceEdit || spaceEditCacheKey === projectPageKey) && (
                <div
                  key={`space-edit:${projectPageKey}`}
                  style={{ display: isSpaceEdit ? "block" : "none", height: "100%" }}
                >
                  <SpaceEdit />
                </div>
              )}
              {/*
                勘察图片页：同样保持缓存，切走后不重新拉取 Potree / 任务 / 标定状态。
              */}
              {(isImageEdit || imageEditCacheKey === projectPageKey) && (
                <div
                  key={`image-edit:${projectPageKey}`}
                  style={{ display: isImageEdit ? "block" : "none", height: "100%" }}
                >
                  <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>
                    <ImageEdit />
                  </Suspense>
                </div>
              )}
              {/*
                屏柜验证图：通过 display 切换显隐而非卸载，保持 canvas/状态不重置。
                cacheKey === projectPageKey 时说明缓存是当前项目的，可以保留。
              */}
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
              {/* 设备验证图：同上，保持缓存 */}
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
              {/*
                其他业务页面通过 key 控制重建：
                切换项目时 projectPageKey 变化，Outlet 会卸载旧实例并挂载新实例，
                确保地图树、设备树、绘制状态等随项目刷新。
              */}
              {!isSpaceEdit && !isImageEdit && !isScreenVerify && !isDeviceVerify && <Outlet key={projectPageKey} />}
            </div>
          </Content>
          <AppFooter />
        </Layout>
      </App>
    </ConfigProvider>
  );
}
