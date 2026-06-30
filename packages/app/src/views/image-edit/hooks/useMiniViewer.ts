import { useRef, useEffect, useCallback } from "react";
import { MiniViewer } from "./MiniViewer";

interface UseMiniViewerParams {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useMiniViewer({ canvasRef, containerRef }: UseMiniViewerParams) {
  const viewerRef = useRef<MiniViewer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const viewer = new MiniViewer(canvas);
    viewer.observeResize(container);
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  const loadLasFromPath = useCallback(async (filePath: string) => {
    await viewerRef.current?.loadLasFile(filePath);
  }, []);

  const loadJsonFromPath = useCallback(async (filePath: string, cx: number, cy: number, cz: number) => {
    await viewerRef.current?.loadJsonFile(filePath, cx, cy, cz);
  }, []);

  return { loadLasFromPath, loadJsonFromPath };
}
