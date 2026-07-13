import { useEffect, useState } from "react";
import { getBoundBayIdsInProject } from "./drawing/drawing-storage";
import { useSelectedProject } from "@/stores/appContextStore";

export function useProjectBoundBayIds(deviceAreaMode: boolean) {
  const selectedProject = useSelectedProject();
  const [projectBoundBayIds, setProjectBoundBayIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!deviceAreaMode || !selectedProject) {
      setProjectBoundBayIds(new Set());
      return;
    }
    const api = window.electronAPI;
    if (!api) return;
    let cancelled = false;
    getBoundBayIdsInProject(api, selectedProject).then((ids) => {
      if (!cancelled) setProjectBoundBayIds(ids);
    });
    return () => { cancelled = true; };
  }, [deviceAreaMode, selectedProject]);

  return projectBoundBayIds;
}
