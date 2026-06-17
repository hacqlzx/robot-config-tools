import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import AppLayout from "../App";

const SpaceEdit = lazy(() => import("../views/space-edit"));
const ImageEdit = lazy(() => import("../views/image-edit"));
const ScreenVerify = lazy(() => import("../views/screen-verify"));
const DeviceVerify = lazy(() => import("../views/device-verify"));
const Config = lazy(() => import("../views/config"));
const ConnectionTest = lazy(() => import("../views/connection-test"));
const DbTest = lazy(() => import("../views/db-test"));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>Loading...</div>}>{children}</Suspense>;
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
      { path: "db-test", element: <LazyPage><DbTest /></LazyPage> },
    ],
  },
]);

export default router;