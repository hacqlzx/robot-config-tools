// ============================================================
// device_voltage
// ============================================================

export interface DeviceVoltage {
  id: number;
  voltName: string;
  voltCode: string;
  alarmLevel: number;
  stationId: number;
  stationName: string;
  stationCode: string;
  sortNum: number;
  createTime: string;
  createBy: string;
  updateTime: string;
  updateBy: string;
}

export type CreateDeviceVoltageDTO = Omit<DeviceVoltage, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceVoltageDTO = Partial<Omit<DeviceVoltage, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_bay
// ============================================================

export interface DeviceBay {
  id: number;
  bayType: string;
  bayName: string;
  bayCode: string;
  alarmLevel: number;
  voltId: number;
  voltName: string;
  voltCode: string;
  stationId: number;
  stationName: string;
  stationCode: string;
  sortNum: number;
  createTime: string;
  createBy: string;
  updateTime: string;
  updateBy: string;
  repairFlag: number;
}

export type CreateDeviceBayDTO = Omit<DeviceBay, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceBayDTO = Partial<Omit<DeviceBay, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_main
// ============================================================

export interface DeviceMain {
  id: number;
  mainDeviceType: number;
  mainDeviceName: string;
  mainDeviceCode: string;
  phaseType: number;
  threePhaseFlag: number;
  threePhaseAssociateId: string;
  entityId: string;
  alarmLevel: number;
  bayId: number;
  bayType: string;
  bayName: string;
  bayCode: string;
  voltId: number;
  voltName: string;
  voltCode: string;
  stationId: number;
  stationName: string;
  stationCode: string;
  sortNum: number;
  createTime: string;
  createBy: string;
  updateTime: string;
  updateBy: string;
  deviceModel: string;
  deviceSource: string;
  manufacturer: string;
  productionCode: string;
  useCompany: string;
  productionDate: string;
  commissioningDate: string;
  remarkInfo: string;
  repairFlag: number;
}

export type CreateDeviceMainDTO = Omit<DeviceMain, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceMainDTO = Partial<Omit<DeviceMain, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_component
// ============================================================

export interface DeviceComponent {
  id: number;
  componentName: string;
  componentType: string;
  componentCode: string;
  alarmLevel: number;
  mainDeviceId: number;
  mainDeviceType: number;
  mainDeviceName: string;
  mainDeviceCode: string;
  phaseType: number;
  bayId: number;
  bayType: string;
  bayName: string;
  bayCode: string;
  voltId: number;
  voltName: string;
  voltCode: string;
  stationId: number;
  stationName: string;
  stationCode: string;
  sortNum: number;
  createTime: string;
  createBy: string;
  updateTime: string;
  updateBy: string;
  repairFlag: number;
}

export type CreateDeviceComponentDTO = Omit<DeviceComponent, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceComponentDTO = Partial<Omit<DeviceComponent, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_point
// ============================================================

export interface DevicePoint {
  id: number;
  pointName: string;
  pointCode: string;
  recognitionTypeList: string;
  saveTypeList: number;
  meterType: number;
  positionStateType: number;
  appearanceType: number;
  defectRecType: string;
  pointTagsCodeList: string;
  defectJudgeType: number;
  importantLevel: number;
  sortNum: number;
  threePhaseFlag: number;
  threePhaseAssociateId: string;
  demarcateState: number;
  robotId: number;
  robotName: string;
  cruiseId: string;
  originCalibrationPath: string;
  extendCalibrationPath: string;
  visibleCalibrationPath: string;
  latestCollectPath: string;
  thermalRegion: string;
  calibrationId: string;
  componentId: number;
  componentType: string;
  componentName: string;
  componentCode: string;
  mainDeviceId: number;
  mainDeviceType: number;
  mainDeviceName: string;
  mainDeviceCode: string;
  phaseType: number;
  bayId: number;
  bayType: string;
  bayName: string;
  bayCode: string;
  voltId: number;
  voltName: string;
  voltCode: string;
  stationId: number;
  stationName: string;
  stationCode: string;
  inspectionSubType: string;
  createTime: string;
  createBy: string;
  updateTime: string;
  updateBy: string;
  alarmLevel: number;
  mapCode: string;
  repairFlag: number;
  deviceInfo: string;
  remark: string;
}

export type CreateDevicePointDTO = Omit<DevicePoint, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDevicePointDTO = Partial<Omit<DevicePoint, 'id' | 'createTime' | 'updateTime'>>;
