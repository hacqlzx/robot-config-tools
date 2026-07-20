import { lazy, Suspense } from "react";
import { createHashRouter, Navigate } from "react-router-dom";
import AppLayout from "../App";
import SpaceEdit from "../views/space-edit";

const ImageEdit = lazy(() => import("../views/image-edit"));
const ImportExport = lazy(() => import("../views/import-export"));
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
      { path: "space-edit", element: <SpaceEdit /> },
      { path: "image-edit", element: <LazyPage><ImageEdit /></LazyPage> },
      { path: "screen-verify", element: <></> },
      { path: "device-verify", element: <></> },
      { path: "import-export", element: <LazyPage><ImportExport /></LazyPage> },
      { path: "config", element: <LazyPage><Config /></LazyPage> },
    ],
  },
]);

export default router;
