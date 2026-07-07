import { useCallback } from "react";
import * as pc from "playcanvas";
import { isLasFileName, mapDirSubPath } from "../utils/space-paths";

interface UseClipCompletionParams {
  clipEntityName: string;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  hasAutoFocusedRef: React.MutableRefObject<boolean>;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
  setLoadingText: React.Dispatch<React.SetStateAction<string>>;
  setLoadingProgress: React.Dispatch<React.SetStateAction<number>>;
  loadLasFromPath: (filePath: string) => Promise<void>;
}

export function useClipCompletion({
  clipEntityName,
  entitiesRef,
  hasAutoFocusedRef,
  setLoadedFiles,
  setTreeKey,
  setLoadingText,
  setLoadingProgress,
  loadLasFromPath,
}: UseClipCompletionParams) {
  return useCallback((clipName: string) => {
    setTreeKey((k) => k + 1);
    setLoadingText("");
    setLoadingProgress(0);
    if (!clipName) return;

    const oldEnt = entitiesRef.current.get(clipEntityName);
    if (oldEnt) {
      oldEnt.destroy();
      entitiesRef.current.delete(clipEntityName);
    }
    setLoadedFiles((prev) => {
      const next = new Set(prev);
      next.delete(clipEntityName);
      return next;
    });
    hasAutoFocusedRef.current = false;

    setTimeout(async () => {
      const project = localStorage.getItem("selectedProject");
      if (project && window.electronAPI) {
        const files = await window.electronAPI.project.listTree(project, mapDirSubPath(clipName));
        const lasFile: any = files.find((f: any) => isLasFileName(f.name));
        if (lasFile) loadLasFromPath(lasFile.path);
      }
    }, 500);
  }, [clipEntityName, entitiesRef, hasAutoFocusedRef, loadLasFromPath, setLoadedFiles, setLoadingProgress, setLoadingText, setTreeKey]);
}
