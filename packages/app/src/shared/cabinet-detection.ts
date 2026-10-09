export type CabinetRecognitionKind = "position" | "meter" | "appearance" | "infrared" | "none";

export interface CabinetDetectionDefinition {
  label: string;
  chDesc: string;
  deviceName: string;
  kind: CabinetRecognitionKind;
  positionStateType?: number;
  meterTypeDesc?: string;
  meterInstrumentDesc?: string;
  algorithmType: number;
}

/** device_property.type_group=position 的默认映射，用于离线导出屏柜点表。 */
export const CABINET_POSITION_STATE_TYPES: Record<number, string> = {
  1: "断路器状态",
  2: "接地刀闸状态",
  3: "隔离刀闸状态",
  4: "压板状态",
  5: "指示灯状态",
  6: "指示灯三态",
  7: "空开状态",
  8: "切换开关",
  9: "旋钮开关",
  10: "分合指示器",
  11: "带电状态",
  12: "储能状态",
};

const INDOOR_DL_TARGET_DETECTION = 49;
const APPEARANCE_RECOGNITION = 13;
const POINTER_TABLE_INTELLIGENT = 5;
const DIGITAL_TABLE_DETECTION = 23;
const INFRARED_TEMPERATURE_MEASUREMENT = 256;

function position(label: string, chDesc: string, deviceName: string, positionStateType: number): CabinetDetectionDefinition {
  return { label, chDesc, deviceName, kind: "position", positionStateType, algorithmType: INDOOR_DL_TARGET_DETECTION };
}

function appearance(label: string, chDesc: string, deviceName: string): CabinetDetectionDefinition {
  return { label, chDesc, deviceName, kind: "appearance", algorithmType: APPEARANCE_RECOGNITION };
}

function meter(
  label: string,
  chDesc: string,
  deviceName: string,
  meterTypeDesc: string,
  meterInstrumentDesc: string,
  algorithmType: number,
): CabinetDetectionDefinition {
  return { label, chDesc, deviceName, kind: "meter", meterTypeDesc, meterInstrumentDesc, algorithmType };
}

export const CABINET_DETECTION_DEFINITIONS: CabinetDetectionDefinition[] = [
  position("backup", "压板备用", "压板", 4),
  position("yb_close", "压板合", "压板", 4),
  position("yb_left", "压板左", "压板", 4),
  position("yb_open", "压板分", "压板", 4),

  position("bl_off", "灯灭", "指示灯", 5),
  position("bl_on", "灯亮", "指示灯", 5),
  position("led_off", "LED灯灭", "led灯", 5),
  position("led_on", "LED灯亮", "led灯", 5),
  position("rect_led_off", "矩形LED灯灭", "矩形灯", 5),
  position("rect_led_on", "矩形LED灯亮", "矩形灯", 5),
  { ...position("little_light", "小灯", "小灯", 5), algorithmType: APPEARANCE_RECOGNITION },
  { ...position("show_off", "显示屏灭", "显示屏", 5), algorithmType: APPEARANCE_RECOGNITION },
  { ...position("show_on", "显示屏亮", "显示屏", 5), algorithmType: APPEARANCE_RECOGNITION },

  position("fd_off", "放电开关自动", "放电开关", 9),
  position("fhkg_off", "分合开关分", "旋钮开关", 9),
  position("fhkg_on", "分合开关合", "旋钮开关", 9),
  position("jd", "旋钮开关就地", "旋钮开关", 9),
  position("xnkg_off", "旋钮开关分", "旋钮开关", 9),
  position("xnkg_on", "旋钮开关合", "旋钮开关", 9),
  position("yf", "旋钮开关远方", "旋钮开关", 9),

  position("handle_0", "把手水平向左", "把手", 8),
  position("handle_180", "把手水平向右", "把手", 8),
  position("handle_270", "把手垂直向上", "把手", 8),
  position("handle_90", "把手垂直向下", "把手", 8),
  position("keyhole_0", "钥匙孔开关向右", "钥匙孔开关", 8),
  position("keyhole_135", "钥匙孔开关左上45", "钥匙孔开关", 8),
  position("keyhole_45", "钥匙孔开关右上45", "钥匙孔开关", 8),
  position("keyhole_90", "钥匙孔开关垂直向上", "钥匙孔开关", 8),

  position("s_down", "空开下", "空开", 7),
  position("s_left", "空开左", "空开", 7),
  position("s_right", "空开右", "空开", 7),
  position("s_up", "空开上", "空开", 7),

  position("zldlq_left", "直流断路器合(左)", "直流断路器", 1),
  position("zldlq_off", "直流断路器分(下)", "直流断路器", 1),
  position("zldlq_on", "直流断路器合(上)", "直流断路器", 1),
  position("zldlq_right", "直流断路器分(右)", "直流断路器", 1),

  meter("meter_sf6", "室内屏柜SF6表", "指针表", "SF6压力表", "指针表", POINTER_TABLE_INTELLIGENT),
  meter("zzb", "指针表", "指针表", "SF6压力表", "指针表", POINTER_TABLE_INTELLIGENT),
  meter("num_led", "数字表", "数字表", "泄漏电流表", "数字表", DIGITAL_TABLE_DETECTION),

  appearance("facade", "外观", "设备外观"),
  appearance("ybzz", "仪表装置", "仪表装置"),

  { label: "infrared", chDesc: "红外测温", deviceName: "红外测温", kind: "infrared", algorithmType: INFRARED_TEMPERATURE_MEASUREMENT },
  { label: "unknown", chDesc: "未知", deviceName: "未知设备", kind: "none", algorithmType: 0 },
];

const DETECTION_BY_LABEL = new Map(CABINET_DETECTION_DEFINITIONS.map((item) => [item.label, item]));
const DETECTION_BY_DESC = new Map(CABINET_DETECTION_DEFINITIONS.map((item) => [item.chDesc, item]));

/** 屏柜点表导出时使用的业务字段映射。识别定义和导出字典分开维护。 */
const CABINET_EXPORT_METER_TYPES: Record<string, string> = {
  meter_sf6: "SF6压力表",
  zzb: "SF6压力表",
  // 后台 meter_type=3 的标准名称；识别页面显示为“数字表”。
  num_led: "泄漏电流表",
};

const CABINET_EXPORT_POSITION_STATE_TYPES: Record<string, string> = {
  zldlq_left: "断路器状态",
  zldlq_off: "断路器状态",
  zldlq_on: "断路器状态",
  zldlq_right: "断路器状态",
  fd_off: "接地刀闸状态",
};

const CABINET_EXPORT_APPEARANCE_TYPES: Record<string, string> = {
  facade: "设备外观查看",
  ybzz: "设备外观查看",
};

const POINT_NAME_TYPE_SUFFIXES = [
  ...Object.values(CABINET_POSITION_STATE_TYPES),
  "指针表",
  "数字表",
  "外观",
  "红外测温",
].sort((left, right) => right.length - left.length);

function valueText(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveCabinetDetection(label?: unknown, labelDesc?: unknown): CabinetDetectionDefinition | null {
  const normalizedLabel = valueText(label);
  const normalizedDesc = valueText(labelDesc);
  if (normalizedLabel && DETECTION_BY_LABEL.has(normalizedLabel)) {
    return DETECTION_BY_LABEL.get(normalizedLabel) || null;
  }
  if (normalizedDesc && DETECTION_BY_DESC.has(normalizedDesc)) {
    return DETECTION_BY_DESC.get(normalizedDesc) || null;
  }
  return null;
}

export function getCabinetPointTypeDescription(label?: unknown, labelDesc?: unknown): string {
  const detection = resolveCabinetDetection(label, labelDesc);
  if (!detection) return "";
  if (detection.kind === "position") {
    return detection.positionStateType ? CABINET_POSITION_STATE_TYPES[detection.positionStateType] || "" : "";
  }
  if (detection.kind === "meter") return detection.meterInstrumentDesc || detection.meterTypeDesc || "";
  if (detection.kind === "appearance") return "外观";
  if (detection.kind === "infrared") return "红外测温";
  return "";
}

export function stripCabinetGeneratedPointNameSuffix(pointName: unknown): string {
  let name = valueText(pointName);
  if (!name) return "";
  for (const suffix of POINT_NAME_TYPE_SUFFIXES) {
    const pattern = new RegExp(`_${escapeRegExp(suffix)}_\\d+$`);
    if (pattern.test(name)) {
      name = name.replace(pattern, "");
      break;
    }
  }
  return name.trim();
}

export function buildCabinetGeneratedPointName(
  ocrName: unknown,
  label: unknown,
  labelDesc: unknown,
  recNum: number,
): string {
  const baseName = stripCabinetGeneratedPointNameSuffix(ocrName);
  if (!baseName) return "";
  // 新逻辑：默认使用标签名称，不拼接类型和序号
  // recNum 只在需要区分重名时使用（由调用方判断）
  return baseName;
}

/**
 * 构建带去重后缀的点位名称（当存在重名时）
 * @param baseName 基础名称（标签名称）
 * @param suffix 后缀序号（1、2、3...）
 */
export function buildCabinetPointNameWithSuffix(baseName: string, suffix: number): string {
  if (!baseName) return "";
  if (suffix <= 1) return baseName;
  return `${baseName}_${suffix}`;
}

/**
 * 检测并解决点位名称重名问题
 * @param rows 所有点位行
 * @returns 包含重名信息的结果
 */
export function detectDuplicateCabinetPointNames(rows: Array<{ name: string }>): {
  hasDuplicates: boolean;
  duplicateNames: Set<string>;
  nameCounts: Map<string, number>;
} {
  const nameCounts = new Map<string, number>();
  const duplicateNames = new Set<string>();

  for (const row of rows) {
    const name = valueText(row.name);
    if (!name) continue;
    const count = nameCounts.get(name) || 0;
    nameCounts.set(name, count + 1);
    if (count > 0) {
      duplicateNames.add(name);
    }
  }

  return {
    hasDuplicates: duplicateNames.size > 0,
    duplicateNames,
    nameCounts,
  };
}

export function resolveCabinetPointExcelColumns(label?: unknown, labelDesc?: unknown): Record<string, string> {
  const detection = resolveCabinetDetection(label, labelDesc);
  const columns: Record<string, string> = { "采集类型": "可见光图片" };
  if (!detection || detection.kind === "none") return columns;

  if (detection.kind === "infrared") {
    return { ...columns, "*识别类型1": "红外测温", "采集类型": "红外图谱" };
  }
  if (detection.kind === "meter") {
    return {
      ...columns,
      "*识别类型1": "表计读取",
      "表计类型": CABINET_EXPORT_METER_TYPES[detection.label] || detection.meterTypeDesc || "",
    };
  }
  if (detection.kind === "appearance") {
    return {
      ...columns,
      "*识别类型1": CABINET_EXPORT_APPEARANCE_TYPES[detection.label] || "设备外观查看",
    };
  }
  const positionStateType = CABINET_EXPORT_POSITION_STATE_TYPES[detection.label]
    || (detection.positionStateType ? CABINET_POSITION_STATE_TYPES[detection.positionStateType] : "")
    || "";
  return {
    ...columns,
    "*识别类型1": "位置状态识别",
    "位置状态类型": positionStateType,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
