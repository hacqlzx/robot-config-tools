// ============================================================
// fac_info
// ============================================================

export interface FacInfo {
  id: number;
  /** 变电站名称 */
  stationName: string;
  /** 变电站编码 */
  stationCode: string;
  /** 对外变电站编码，用于对接巡视主机 */
  outStationCode: string;
  /** 厂站类型：1-变电站，2-变电房，3-开闭所 */
  facType: string;
  /** 变电站类型：1-常规站（敞开式），2-室内站，3-GIS站，4-半GIS半常规站，5-AIS站，6-常规站（敞开式），7-HGIS站 */
  stationType: string;
  /** 省份名称 */
  provinceName: string;
  /** 城市名称 */
  cityName: string;
  /** 区域名称 */
  areaName: string;
  /** 创建人 */
  createBy: string;
  /** 创建时间 */
  createTime: string;
  /** 更新人 */
  updateBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 电压名称 */
  voltName: string;
  /** 投用时间 */
  useTime: string;
  /** 负责人 */
  responsiblePerson: string;
  /** 电话 */
  telephone: string;
  /** 微气象数据来源 微气象设备：0，机器人：1，无人机：2 */
  envDataRobotId: number;
  /** 是否当前厂站 0-是 1-不是 */
  currentFac: number;
  /** 告警等级 */
  alarmLevel: number;
  /** 厂站顺序 */
  sortNum: number;
}

export type CreateFacInfoDTO = Omit<FacInfo, 'id' | 'createTime' | 'updateTime'>;
export type UpdateFacInfoDTO = Partial<Omit<FacInfo, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_voltage
// ============================================================

export interface DeviceVoltage {
  /** 主键id */
  id: number;
  /** 电压名称 */
  voltName: string;
  /** 电压编码 */
  voltCode: string;
  /** 告警等级 */
  alarmLevel: number;
  /** 厂站id */
  stationId: number;
  /** 厂站名称 */
  stationName: string;
  /** 厂站编码 */
  stationCode: string;
  /** 厂站下电压顺序 */
  sortNum: number;
  /** 创建时间 */
  createTime: string;
  /** 创建人 */
  createBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 更新人 */
  updateBy: string;
}

export type CreateDeviceVoltageDTO = Omit<DeviceVoltage, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceVoltageDTO = Partial<Omit<DeviceVoltage, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_bay
// ============================================================

export interface DeviceBay {
  /** 主键id */
  id: number;
  /** 间隔类型 */
  bayType: string;
  /** 间隔名称 */
  bayName: string;
  /** 间隔编码 */
  bayCode: string;
  /** 告警等级 */
  alarmLevel: number;
  /** 电压id */
  voltId: number;
  /** 电压名称 */
  voltName: string;
  /** 电压编码 */
  voltCode: string;
  /** 厂站id */
  stationId: number;
  /** 厂站名称 */
  stationName: string;
  /** 厂站编码 */
  stationCode: string;
  /** 电压下间隔顺序 */
  sortNum: number;
  /** 创建时间 */
  createTime: string;
  /** 创建人 */
  createBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 更新人 */
  updateBy: string;
  /** 检修状态 */
  repairFlag: number;
}

export type CreateDeviceBayDTO = Omit<DeviceBay, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceBayDTO = Partial<Omit<DeviceBay, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_main
// ============================================================

export interface DeviceMain {
  /** 主键id */
  id: number;
  /** 主设备类型 */
  mainDeviceType: number;
  /** 主设备名称 */
  mainDeviceName: string;
  /** 主设备编码 */
  mainDeviceCode: string;
  /** 相位类型：0-主体，1-A相，2-B相，3-C相 */
  phaseType: number;
  /** 是否是三相设备的标识，0-否，1-是 */
  threePhaseFlag: number;
  /** 三相设备关联id */
  threePhaseAssociateId: string;
  /** 实物id */
  entityId: string;
  /** 告警等级 */
  alarmLevel: number;
  /** 间隔id */
  bayId: number;
  /** 间隔类型 */
  bayType: string;
  /** 间隔名称 */
  bayName: string;
  /** 间隔编码 */
  bayCode: string;
  /** 电压id */
  voltId: number;
  /** 电压名称 */
  voltName: string;
  /** 电压编码 */
  voltCode: string;
  /** 厂站id */
  stationId: number;
  /** 厂站名称 */
  stationName: string;
  /** 厂站编码 */
  stationCode: string;
  /** 间隔下主设备顺序 */
  sortNum: number;
  /** 创建时间 */
  createTime: string;
  /** 创建人 */
  createBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 更新人 */
  updateBy: string;
  /** 设备型号 */
  deviceModel: string;
  /** 设备来源 */
  deviceSource: string;
  /** 生产厂家 */
  manufacturer: string;
  /** 出厂编号 */
  productionCode: string;
  /** 使用单位 */
  useCompany: string;
  /** 生产日期 */
  productionDate: string;
  /** 投运日期 */
  commissioningDate: string;
  /** 备注信息 */
  remarkInfo: string;
  /** 检修状态 */
  repairFlag: number;
}

export type CreateDeviceMainDTO = Omit<DeviceMain, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceMainDTO = Partial<Omit<DeviceMain, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_component
// ============================================================

export interface DeviceComponent {
  /** 主键id */
  id: number;
  /** 部件名称 */
  componentName: string;
  /** 部件类型 */
  componentType: string;
  /** 部件编码 */
  componentCode: string;
  /** 告警等级 */
  alarmLevel: number;
  /** 主设备id */
  mainDeviceId: number;
  /** 主设备类型 */
  mainDeviceType: number;
  /** 主设备名称 */
  mainDeviceName: string;
  /** 主设备编码 */
  mainDeviceCode: string;
  /** 主设备相位类型，0-主体，1-A相，2-B相，3-C相 */
  phaseType: number;
  /** 间隔id */
  bayId: number;
  /** 间隔类型 */
  bayType: string;
  /** 间隔名称 */
  bayName: string;
  /** 间隔编码 */
  bayCode: string;
  /** 电压id */
  voltId: number;
  /** 电压名称 */
  voltName: string;
  /** 电压编码 */
  voltCode: string;
  /** 厂站id */
  stationId: number;
  /** 厂站名称 */
  stationName: string;
  /** 厂站编码 */
  stationCode: string;
  /** 主设备下部件顺序 */
  sortNum: number;
  /** 创建时间 */
  createTime: string;
  /** 创建人 */
  createBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 更新人 */
  updateBy: string;
  /** 检修状态 */
  repairFlag: number;
}

export type CreateDeviceComponentDTO = Omit<DeviceComponent, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDeviceComponentDTO = Partial<Omit<DeviceComponent, 'id' | 'createTime' | 'updateTime'>>;

// ============================================================
// device_point
// ============================================================

export interface DevicePoint {
  /** 主键id */
  id: number;
  /** 点位名称 */
  pointName: string;
  /** 点位编码 */
  pointCode: string;
  /** 识别类型，多个用逗号分隔 */
  recognitionTypeList: string;
  /** 采集类型 */
  saveTypeList: number;
  /** 表计类型 */
  meterType: number;
  /** 位置状态类型 */
  positionStateType: number;
  /** 辅助设施类型 */
  appearanceType: number;
  /** 缺陷识别类型，多个用逗号分隔 */
  defectRecType: string;
  /** 点位标签编码，多个用,拼接 */
  pointTagsCodeList: string;
  /** 是否是缺陷判别，0-否，1-是 */
  defectJudgeType: number;
  /** 重要等级，1-Ⅰ类，2-Ⅱ类，3-Ⅲ类 */
  importantLevel: number;
  /** 部件下点位顺序 */
  sortNum: number;
  /** 是否是三相关联点位，0-否，1-是 */
  threePhaseFlag: number;
  /** 三相关联id */
  threePhaseAssociateId: string;
  /** 标定状态，0-未标定，1-已标定 */
  demarcateState: number;
  /** 机器人id */
  robotId: number;
  /** 机器人名称 */
  robotName: string;
  /** 巡检点ID，用于和图像系统交互 */
  cruiseId: string;
  /** 原始标定文件路径 */
  originCalibrationPath: string;
  /** 扩展标定文件路径 */
  extendCalibrationPath: string;
  /** 可见光标定图片路径 */
  visibleCalibrationPath: string;
  /** 最新的采集文件路径 */
  latestCollectPath: string;
  /** 粗糙框 */
  thermalRegion: string;
  /** 标定id，用于和机器人本体交互 */
  calibrationId: string;
  /** 部件id */
  componentId: number;
  /** 部件类型 */
  componentType: string;
  /** 部件名称 */
  componentName: string;
  /** 部件编码 */
  componentCode: string;
  /** 主设备id */
  mainDeviceId: number;
  /** 主设备类型 */
  mainDeviceType: number;
  /** 主设备名称 */
  mainDeviceName: string;
  /** 主设备编码 */
  mainDeviceCode: string;
  /** 主设备相位类型，0-主体，1-A相，2-B相，3-C相 */
  phaseType: number;
  /** 间隔id */
  bayId: number;
  /** 间隔类型 */
  bayType: string;
  /** 间隔名称 */
  bayName: string;
  /** 间隔编码 */
  bayCode: string;
  /** 电压id */
  voltId: number;
  /** 电压名称 */
  voltName: string;
  /** 电压编码 */
  voltCode: string;
  /** 厂站id */
  stationId: number;
  /** 厂站名称 */
  stationName: string;
  /** 厂站编码 */
  stationCode: string;
  /** 巡视子类型,逗号分隔(101:例行巡视, 201:气温骤变特巡, 202:高温特巡, 203:雾霾特巡, 204:大风特巡, 205:下雪特巡, 206:覆冰特巡, 207:雷暴特巡, 208:大（过）负荷特巡, 209:雨后特巡, 210:冰雹特巡, 211:沙尘暴特巡, 212:雪后特巡, 213:缺陷跟踪, 214:新设备投运, 215:重新投运, 216:远方异常告警确认, 217:协助应急事故处理, 218:安防联动, 219:保供电任务, 220:远方状态确认, 221:鸟巢特巡, 301:设备红外测温, 302:油位油温表抄录, 303:避雷器表计抄录, 304:SF6压力表抄录, 305:液压表抄录, 306:位置状态识别, 307:调压档位、次数抄录, 401:自定义巡视, 501:熄灯巡视) */
  inspectionSubType: string;
  /** 创建时间 */
  createTime: string;
  /** 创建人 */
  createBy: string;
  /** 更新时间 */
  updateTime: string;
  /** 更新人 */
  updateBy: string;
  /** 告警等级 */
  alarmLevel: number;
  /** 巡检点所在地图 */
  mapCode: string;
  /** 检修状态 */
  repairFlag: number;
  /** 对上级模型同步使用，其他地方不用 */
  deviceInfo: string;
  /** 备注 */
  remark: string;
}

export type CreateDevicePointDTO = Omit<DevicePoint, 'id' | 'createTime' | 'updateTime'>;
export type UpdateDevicePointDTO = Partial<Omit<DevicePoint, 'id' | 'createTime' | 'updateTime'>>;
