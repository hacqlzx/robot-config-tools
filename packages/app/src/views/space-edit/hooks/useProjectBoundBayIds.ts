import { useEffect, useRef } from "react";
import { getBoundBayIdsInProject } from "./drawing/drawing-storage";

export function useProjectBoundBayIds(deviceAreaMode: boolean) {
  const projectBoundBayIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!deviceAreaMode) return;
    const api = window.electronAPI;
    if (!api) return;
    getBoundBayIdsInProject(api, localStorage.getItem("selectedProject") || "").then((ids) => {
      projectBoundBayIdsRef.current = ids;
    });
  }, [deviceAreaMode]);

  return projectBoundBayIdsRef;
}
