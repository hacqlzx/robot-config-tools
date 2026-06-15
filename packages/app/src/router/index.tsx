import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "../App";

const SpaceEdit = lazy(() => import("../pages/space-edit"));
const ImageEdit = lazy(() => import("../pages/image-edit"));
const ScreenVerify = lazy(() => import("../pages/screen-verify"));
const DeviceVerify = lazy(() => import("../pages/device-verify"));
const Config = lazy(() => import("../pages/config"));
const ConnectionTest = lazy(() => import("../pages/connection-test"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>加载中...</div>}>{children}</Suspense>;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/space-edit" replace /> },
      { path: "space-edit", element: <LazyPage><SpaceEdit /></LazyPage> },
      { path: "image-edit", element: <LazyPage><ImageEdit /></LazyPage> },
      { path: "screen-verify", element: <LazyPage><ScreenVerify /></LazyPage> },
      { path: "device-verify", element: <LazyPage><DeviceVerify /></LazyPage> },
      { path: "config", element: <LazyPage><Config /></LazyPage> },
      { path: "connection-test", element: <LazyPage><ConnectionTest /></LazyPage> },
    ],
  },
]);

export default router;
