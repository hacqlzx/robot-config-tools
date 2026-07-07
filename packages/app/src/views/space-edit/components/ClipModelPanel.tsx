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

/**
 * 裁切面板挂载入口。
 *
 * ClipController 需要读取当前模型的 LAS header 和原始文件路径；这里从 ref 中按实体名取数据，
 * 保证裁切操作始终针对当前可见实体，而不是树上任意文件。
 */
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
