import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import AppLayout from "../App";

const ImportExport = lazy(() => import("../views/import-export"));
const Config = lazy(() => import("../views/config"));

/**
 * 延迟加载页面的统一包裹组件。
 * 只用于非首屏核心页，减少启动阶段需要加载的 JS 体积。
 */
function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>{children}</Suspense>;
}

/**
 * 应用主路由。
 *
 * 注意：space-edit、image-edit、screen-verify 和 device-verify 的真实组件
 * 都由 AppLayout 缓存渲染，这里保留空 element 只是为了让菜单路由和地址栏匹配。
 */
const router = createHashRouter([
  {
    path: "/*",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="space-edit" replace /> },
      { path: "space-edit", element: <></> },
      { path: "image-edit", element: <></> },
      { path: "screen-verify", element: <></> },
      { path: "device-verify", element: <></> },
      { path: "import-export", element: <LazyPage><ImportExport /></LazyPage> },
      { path: "config", element: <LazyPage><Config /></LazyPage> },
    ],
  },
]);

export default router;
