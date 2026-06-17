import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import AppLayout from "../App";

const SpaceEdit = lazy(() => import("../views/space-edit"));
const ImageEdit = lazy(() => import("../views/image-edit"));
const ScreenVerify = lazy(() => import("../views/screen-verify"));
const DeviceVerify = lazy(() => import("../views/device-verify"));
const Config = lazy(() => import("../views/config"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>{children}</Suspense>;
}

const router = createHashRouter([
  {
    path: "/*",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="space-edit" replace /> },
      { path: "space-edit", element: <LazyPage><SpaceEdit /></LazyPage> },
      { path: "image-edit", element: <LazyPage><ImageEdit /></LazyPage> },
      { path: "screen-verify", element: <LazyPage><ScreenVerify /></LazyPage> },
      { path: "device-verify", element: <LazyPage><DeviceVerify /></LazyPage> },
      { path: "config", element: <LazyPage><Config /></LazyPage> },
    ],
  },
]);

export default router;