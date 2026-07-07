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
  // 所有绘制模式共享同一个 canvas 和鼠标/键盘事件，必须互斥。
  // closeAllDrawingModes 用在加载模型、切换文件等会改变点云坐标上下文的操作前。
  const closeAllDrawingModes = useCallback(() => {
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
  }, [cabinetMode, chargingMode, deviceAreaMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath]);

  const toggleCabinetExclusive = useCallback(() => {
    // 进入屏柜绘制前关闭其他模式，避免其他 Drawing 类继续响应同一次鼠标事件。
    if (chargingMode) handleToggleCharging();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCabinet();
  }, [chargingMode, deviceAreaMode, pathMode, handleToggleCharging, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCabinet]);

  const toggleChargingExclusive = useCallback(() => {
    // 充电区是单例区域；进入时保持其他编辑工具关闭。
    if (cabinetMode) handleToggleCabinet();
    if (deviceAreaMode) handleForceCloseDeviceArea();
    if (pathMode) handleForceClosePath();
    handleToggleCharging();
  }, [cabinetMode, deviceAreaMode, pathMode, handleToggleCabinet, handleForceCloseDeviceArea, handleForceClosePath, handleToggleCharging]);

  const toggleDeviceAreaExclusive = useCallback(() => {
    // 设备区支持多个框，但仍与屏柜/充电区/路径编辑互斥。
    if (cabinetMode) handleToggleCabinet();
    if (chargingMode) handleToggleCharging();
    if (pathMode) handleForceClosePath();
    handleToggleDeviceArea();
  }, [cabinetMode, chargingMode, pathMode, handleToggleCabinet, handleToggleCharging, handleForceClosePath, handleToggleDeviceArea]);

  const togglePathExclusive = useCallback(() => {
    // 路径编辑有自己的点/线选中和 Delete 行为，必须独占键盘事件。
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
