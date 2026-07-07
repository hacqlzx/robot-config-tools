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
  onCabinetUndo: () => void;
  onCabinetClose: () => void;
  onCabinetSave: (data: CabinetSaveData) => void;
  onCabinetNamesChange: (names: string[]) => void;

  chargingMode: boolean;
  chargingPointCount: number;
  chargingHeight: number;
  onChargingUndo: () => void;
  onChargingClose: () => void;
  onChargingSave: () => void;
  onChargingSetHeight: (height: number) => void;

  deviceAreaMode: boolean;
  deviceAreaBoxCount: number;
  deviceAreaHeight: number;
  deviceAreaSelectedBoxId: string | null;
  deviceAreaSelectedBoxBay: { id: number; name: string; code: string } | null;
  deviceAreaBoundBayIds: Set<number>;
  onDeviceAreaUndo: () => void;
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

export default function SpaceEditScene({
  canvasRef,
  saveStatus,
  loading,
  loadingProgress,
  loadingText,
  cabinetMode,
  cabinetCornerCount,
  cabinetCount,
  onCabinetUndo,
  onCabinetClose,
  onCabinetSave,
  onCabinetNamesChange,
  chargingMode,
  chargingPointCount,
  chargingHeight,
  onChargingUndo,
  onChargingClose,
  onChargingSave,
  onChargingSetHeight,
  deviceAreaMode,
  deviceAreaBoxCount,
  deviceAreaHeight,
  deviceAreaSelectedBoxId,
  deviceAreaSelectedBoxBay,
  deviceAreaBoundBayIds,
  onDeviceAreaUndo,
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
      <DrawingEditPanels
        cabinetMode={cabinetMode}
        cabinetCornerCount={cabinetCornerCount}
        cabinetCount={cabinetCount}
        onCabinetUndo={onCabinetUndo}
        onCabinetClose={onCabinetClose}
        onCabinetSave={onCabinetSave}
        onCabinetNamesChange={onCabinetNamesChange}
        chargingMode={chargingMode}
        chargingPointCount={chargingPointCount}
        chargingHeight={chargingHeight}
        onChargingUndo={onChargingUndo}
        onChargingClose={onChargingClose}
        onChargingSave={onChargingSave}
        onChargingSetHeight={onChargingSetHeight}
        deviceAreaMode={deviceAreaMode}
        deviceAreaBoxCount={deviceAreaBoxCount}
        deviceAreaHeight={deviceAreaHeight}
        deviceAreaSelectedBoxId={deviceAreaSelectedBoxId}
        deviceAreaSelectedBoxBay={deviceAreaSelectedBoxBay}
        deviceAreaBoundBayIds={deviceAreaBoundBayIds}
        onDeviceAreaUndo={onDeviceAreaUndo}
        onDeviceAreaClose={onDeviceAreaClose}
        onDeviceAreaSave={onDeviceAreaSave}
        onDeviceAreaSetHeight={onDeviceAreaSetHeight}
        onDeviceAreaBindBay={onDeviceAreaBindBay}
        onDeviceAreaUnbind={onDeviceAreaUnbind}
      />
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
