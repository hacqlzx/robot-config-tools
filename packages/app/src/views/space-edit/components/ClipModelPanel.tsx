import type { MutableRefObject } from "react";
import * as pc from "playcanvas";
import ClipController from "./ClipController";

interface ClipModelPanelProps {
  clipMode: boolean;
  clipEntityName: string;
  app: pc.Application | null;
  lasHeadersRef: MutableRefObject<Map<string, any>>;
  filePathRef: MutableRefObject<Map<string, string>>;
  onClose: () => void;
  onProgress: (pct: number) => void;
  onComplete: (clipName: string) => void;
}

export default function ClipModelPanel({
  clipMode,
  clipEntityName,
  app,
  lasHeadersRef,
  filePathRef,
  onClose,
  onProgress,
  onComplete,
}: ClipModelPanelProps) {
  if (!clipMode || !app) return null;

  return (
    <ClipController
      app={app}
      entityName={clipEntityName}
      lasHeader={lasHeadersRef.current.get(clipEntityName) || null}
      origFilePath={filePathRef.current.get(clipEntityName) || ""}
      onClose={onClose}
      onProgress={onProgress}
      onComplete={onComplete}
    />
  );
}
