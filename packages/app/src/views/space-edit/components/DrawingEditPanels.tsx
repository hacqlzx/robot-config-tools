import CabinetPanel from "./CabinetPanel";
import ChargingAreaPanel from "./ChargingAreaPanel";
import DeviceAreaPanel from "./DeviceAreaPanel";

interface CabinetSaveData {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  cabinetRow?: { key: string; code: string; name: string } | null;
  rows: { key: string; code: string; name: string }[];
}

interface DrawingEditPanelsProps {
  cabinetMode: boolean;
  cabinetCornerCount: number;
  cabinetCount: number;
  cabinetNameSequence?: { cabinetRowStart: number; cabinetStart: number };
  onCabinetClose: () => void;
  onCabinetSave: (data: CabinetSaveData) => void;
  onCabinetDraftChange?: (data: CabinetSaveData | null) => void;
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
}

/**
 * 绘制模式面板分发器。
 *
 * 每种绘制模式最多显示一个对应面板；面板只收集业务输入和触发命令，
 * 真正的 3D 几何编辑由 usePlayCanvas 中注册的 Drawing 类处理。
 */
export default function DrawingEditPanels({
  cabinetMode,
  cabinetCornerCount,
  cabinetCount,
  cabinetNameSequence,
  onCabinetClose,
  onCabinetSave,
  onCabinetDraftChange,
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
}: DrawingEditPanelsProps) {
  return (
    <>
      {cabinetMode && (
        <CabinetPanel
          cornerCount={cabinetCornerCount}
          cabinetCount={cabinetCount}
          nameSequence={cabinetNameSequence}
          onClose={onCabinetClose}
          onSave={onCabinetSave}
          onDraftChange={onCabinetDraftChange}
          onNamesChange={onCabinetNamesChange}
        />
      )}
      {chargingMode && (
        <ChargingAreaPanel
          pointCount={chargingPointCount}
          height={chargingHeight}
          onClose={onChargingClose}
          onSave={onChargingSave}
          onSetHeight={onChargingSetHeight}
        />
      )}
      {deviceAreaMode && (
        <DeviceAreaPanel
          boxCount={deviceAreaBoxCount}
          height={deviceAreaHeight}
          selectedBoxId={deviceAreaSelectedBoxId}
          selectedBoxBay={deviceAreaSelectedBoxBay}
          boundBayIds={deviceAreaBoundBayIds}
          onClose={onDeviceAreaClose}
          onSave={onDeviceAreaSave}
          onSetHeight={onDeviceAreaSetHeight}
          onBindBay={onDeviceAreaBindBay}
          onUnbind={onDeviceAreaUnbind}
        />
      )}
    </>
  );
}
