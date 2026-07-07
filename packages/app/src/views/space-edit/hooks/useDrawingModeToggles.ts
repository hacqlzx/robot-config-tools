import { useCallback } from "react";

interface UseDrawingModeTogglesParams {
  cabinetMode: boolean;
  chargingMode: boolean;
  deviceAreaMode: boolean;
  pathMode: boolean;
  handleToggleCabinet: () => void;
  handleToggleCharging: () => void;
  handleToggleDeviceArea: () => void;
  handleTogglePath: () => void;
  handleForceCloseDeviceArea: () => void;
  handleForceClosePath: () => void;
}

export function useDrawingModeToggles({
  cabinetMode,
  chargingMode,
  deviceAreaMode,
  pathMode,
  handleToggleCabinet,
  handleToggleCharging,
  handleToggleDeviceArea,
  handleTogglePath,
  handleForceCloseDeviceArea,
  handleForceClosePath,
}: UseDrawingModeTogglesParams) {
  const closeAllDrawingModes = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
  }, [cabinetMode, chargingMode, deviceAreaMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath]);

  const toggleCabinetExclusive = useCallback(() => {
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCabinet();
  }, [chargingMode, deviceAreaMode, pathMode, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCabinet]);

  const toggleChargingExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCharging();
  }, [cabinetMode, deviceAreaMode, pathMode, handleToggleCabinet, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCharging]);

  const toggleDeviceAreaExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (pathMode) handleForceClosePath();
    handleToggleDeviceArea();
  }, [cabinetMode, chargingMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceClosePath, handleToggleDeviceArea]);

  const togglePathExclusive = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    handleTogglePath();
  }, [cabinetMode, chargingMode, deviceAreaMode, handleToggleCabinet, handleToggleCharging, handleForceCloseDeviceArea, handleTogglePath]);

  return {
    closeAllDrawingModes,
    toggleCabinetExclusive,
    toggleChargingExclusive,
    toggleDeviceAreaExclusive,
    togglePathExclusive,
  };
}
