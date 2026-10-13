import type { MouseEventHandler, ReactNode, RefObject } from "react";
import LoadingOverlay from "./LoadingOverlay";
import ResizeHandle from "./ResizeHandle";

interface SpaceEditLayoutProps {
  containerRef: RefObject<HTMLDivElement>;
  resizing: boolean;
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  toolbar: ReactNode;
  viewControls: ReactNode;
  sidePanel: ReactNode;
  scene: ReactNode;
  importing: boolean;
  exportModal: ReactNode;
}

export default function SpaceEditLayout({
  containerRef,
  resizing,
  onResizeStart,
  toolbar,
  viewControls,
  sidePanel,
  scene,
  importing,
  exportModal,
}: SpaceEditLayoutProps) {
  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", userSelect: resizing ? "none" : undefined, cursor: resizing ? "col-resize" : undefined }}>
      {toolbar}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {viewControls}
        {sidePanel}
        <ResizeHandle onMouseDown={onResizeStart} />
        <div className="space-edit-scene-frame" style={{ flex: 1, display: "flex", minWidth: 0, minHeight: 0, padding: "var(--app-workspace-padding) var(--app-workspace-padding) var(--app-workspace-padding) 0", boxSizing: "border-box" }}>
          {scene}
        </div>
      </div>
      {importing && <LoadingOverlay text="正在导入点表..." zIndex={200} />}
      {exportModal}
    </div>
  );
}
