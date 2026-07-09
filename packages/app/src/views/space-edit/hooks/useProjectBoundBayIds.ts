import { useEffect, useState } from "react";
import { getBoundBayIdsInProject } from "./drawing/drawing-storage";

export function useProjectBoundBayIds(deviceAreaMode: boolean) {
  const [projectBoundBayIds, setProjectBoundBayIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!deviceAreaMode) return;
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;
    getBoundBayIdsInProject(api, localStorage.getItem("selectedProject") || "").then((ids) => {
      if (!cancelled) setProjectBoundBayIds(ids);
    });
    return () => { cancelled = true; };
  }, [deviceAreaMode]);

  return projectBoundBayIds;
}
