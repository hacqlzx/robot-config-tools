import type { MutableRefObject, RefObject } from "react";
import * as pc from "playcanvas";
import type { SaveStatus } from "../types";
import ClipModelPanel from "./ClipModelPanel";
import DrawingEditPanels from "./DrawingEditPanels";
import SceneViewport from "./SceneViewport";

interface CabinetSaveData {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  rows: { key: string; code: string; name: string }[];
}

interface SpaceEditSceneProps {
  canvasRef: RefObject<HTMLCanvasElement>;
  saveStatus: SaveStatus;
  loading: boolean;
  loadingProgress: number;
  loadingText: string;

  cabinetMode: boolean;
  cabinetCornerCount: number;
  cabinetCount: number;
  onCabinetClose: () => void;
  onCabinetSave: (data: CabinetSaveData) => void;
  onCabinetNamesChange: (names: string[]) => void;

  chargingMode: boolean;
  chargingPointCount: number;
  chargingHeight: number;
  onChargingClose: () => void;
  onChargingSave: () => void;
  onChargingSetHeight: (height: number) => void;

  deviceAreaMode: boolean;
  deviceAreaBoxCount: number;
  deviceAreaHeight: number;
  deviceAreaSelectedBoxId: string | null;
  deviceAreaSelectedBoxBay: { id: number; name: string; code: string } | null;
  deviceAreaBoundBayIds: Set<number>;
  onDeviceAreaClose: () => void;
  onDeviceAreaSave: () => void;
  onDeviceAreaSetHeight: (height: number) => void;
  onDeviceAreaBindBay: (bay: { id: number; name: string; code: string }) => void;
  onDeviceAreaUnbind: () => void;

  clipMode: boolean;
  clipEntityName: string;
  app: pc.Application | null;
  lasHeadersRef: MutableRefObject<Map<string, any>>;
  filePathRef: MutableRefObject<Map<string, string>>;
  onClipClose: () => void;
  onClipProgress: (pct: number) => void;
  onClipComplete: (clipName: string) => void;
}

/**
 * 空间编辑三维场景的 UI 组合层。
 *
 * 这里只负责把 canvas、loading、保存状态、编辑浮层和裁切浮层摆到同一个视口里；
 * PlayCanvas 初始化、点云加载、绘制状态机和保存逻辑都在 hooks 中，避免组件本身变成业务中枢。
 */
export default function SpaceEditScene({
  canvasRef,
  saveStatus,
  loading,
  loadingProgress,
  loadingText,
  cabinetMode,
  cabinetCornerCount,
  cabinetCount,
  onCabinetClose,
  onCabinetSave,
  onCabinetNamesChange,
  chargingMode,
  chargingPointCount,
  chargingHeight,
  onChargingClose,
  onChargingSave,
  onChargingSetHeight,
  deviceAreaMode,
  deviceAreaBoxCount,
  deviceAreaHeight,
  deviceAreaSelectedBoxId,
  deviceAreaSelectedBoxBay,
  deviceAreaBoundBayIds,
  onDeviceAreaClose,
  onDeviceAreaSave,
  onDeviceAreaSetHeight,
  onDeviceAreaBindBay,
  onDeviceAreaUnbind,
  clipMode,
  clipEntityName,
  app,
  lasHeadersRef,
  filePathRef,
  onClipClose,
  onClipProgress,
  onClipComplete,
}: SpaceEditSceneProps) {
  return (
    <SceneViewport
      canvasRef={canvasRef}
      saveStatus={saveStatus}
      loading={loading}
      loadingProgress={loadingProgress}
      loadingText={loadingText}
    >
      {/* 绘制浮层只在对应模式下显示，实际几何交互由各 Drawing 类监听 canvas 完成。 */}
      <DrawingEditPanels
        cabinetMode={cabinetMode}
        cabinetCornerCount={cabinetCornerCount}
        cabinetCount={cabinetCount}
        onCabinetClose={onCabinetClose}
        onCabinetSave={onCabinetSave}
        onCabinetNamesChange={onCabinetNamesChange}
        chargingMode={chargingMode}
        chargingPointCount={chargingPointCount}
        chargingHeight={chargingHeight}
        onChargingClose={onChargingClose}
        onChargingSave={onChargingSave}
        onChargingSetHeight={onChargingSetHeight}
        deviceAreaMode={deviceAreaMode}
        deviceAreaBoxCount={deviceAreaBoxCount}
        deviceAreaHeight={deviceAreaHeight}
        deviceAreaSelectedBoxId={deviceAreaSelectedBoxId}
        deviceAreaSelectedBoxBay={deviceAreaSelectedBoxBay}
        deviceAreaBoundBayIds={deviceAreaBoundBayIds}
        onDeviceAreaClose={onDeviceAreaClose}
        onDeviceAreaSave={onDeviceAreaSave}
        onDeviceAreaSetHeight={onDeviceAreaSetHeight}
        onDeviceAreaBindBay={onDeviceAreaBindBay}
        onDeviceAreaUnbind={onDeviceAreaUnbind}
      />
      {/* 裁切控制器需要 app/header/filePath 三类三维上下文，因此独立于普通绘制面板。 */}
      <ClipModelPanel
        clipMode={clipMode}
        clipEntityName={clipEntityName}
        app={app}
        lasHeadersRef={lasHeadersRef}
        filePathRef={filePathRef}
        onClose={onClipClose}
        onProgress={onClipProgress}
        onComplete={onClipComplete}
      />
    </SceneViewport>
  );
}
