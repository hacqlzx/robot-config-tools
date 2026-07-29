import * as XLSX from "xlsx";
import type { PointExcelRow } from "@robot/database";

// ---- 枚举：中文 → 数字 ----

const RECOGNITION_TYPE: Record<string, string> = {
  "表计读取": "meter_read", "位置状态识别": "position_state",
  "设备外观查看": "appearance", "声音检测": "sound",
  "红外测温": "ir_temp", "可见光查看": "visible",
};
const SAVE_TYPE: Record<string, number> = {
  "红外图谱": 1, "可见光图片": 2, "音频": 3, "视频": 4, "取油": 5,
};
const METER_TYPE: Record<string, number> = {
  "油位表": 1, "避雷器动作次数表": 2, "泄漏电流表": 3,
  "SF6压力表": 4, "液压表": 5, "油温表": 6, "档位表": 7,
};
const POSITION_STATE: Record<string, number> = {
  "断路器状态": 1, "接地刀闸状态": 2, "隔离刀闸状态": 3,
};
const IMPORTANT_LEVEL: Record<string, number> = { "Ⅰ类": 1, "Ⅱ类": 2, "Ⅲ类": 3 };
const MAIN_DEVICE_TYPE: Record<string, number> = {
  "油浸式变压器(电抗器)": 1, "断路器": 2, "组合电器": 3, "GIS": 3,
  "隔离开关": 4, "电压互感器": 5, "电流互感器": 6,
  "避雷器": 7, "电容器": 8, "电抗器": 9,
  "开关柜": 10, "二次屏柜": 29,
};
const PHASE_TYPE: Record<string, number> = {
  "主体": 0, "A相": 1, "B相": 2, "C相": 3,
};
const BAY_TYPE: Record<string, string> = {
  "设备区": "设备区", "屏柜区": "屏柜区", "屏柜": "屏柜区", "主变间隔": "主变间隔",
  "站用变间隔": "站用变间隔", "主变低压侧间隔": "主变低压侧间隔",
};

/** 巡检类型中文 → 编码 */
const INSPECTION_TYPE: Record<string, string> = {
  "例行巡检": "101", "气温骤变特巡": "201", "高温特巡": "202",
  "雾霾特巡": "203", "大风特巡": "204", "下雪特巡": "205",
  "覆冰特巡": "206", "雷暴特巡": "207", "大负荷特巡": "208",
  "雨后特巡": "209", "冰雹特巡": "210", "沙尘暴特巡": "211",
  "雪后特巡": "212", "缺陷跟踪": "213", "新设备投运": "214",
  "重新投运": "215", "远方异常告警确认": "216", "协助应急事故处理": "217",
  "安防联动": "218", "保供电任务": "219", "远方状态确认": "220",
  "鸟巢特巡": "221", "设备红外测温": "301", "油位油温表抄录": "302",
  "避雷器表计抄录": "303", "SF6压力表抄录": "304",
  "液压表抄录": "305", "位置状态识别": "306", "调压档位抄录": "307",
  "自定义巡检": "401", "熄灯巡检": "501",
};

// ---- 列名映射（Excel 表头 → 字段） ----

const COLUMN_MAP: Record<string, string> = {
  "*点位名称": "pointName", "点位名称": "pointName",
  "点位编码": "pointCode",
  "*识别类型1": "recognitionType1", "识别类型1": "recognitionType1",
  "*识别类型2": "recognitionType2", "识别类型2": "recognitionType2",
  "采集类型": "saveTypeList",
  "表计类型": "meterType",
  "位置状态类型": "positionStateType",
  "*重要等级": "importantLevel", "重要等级": "importantLevel",
  "*部件名称": "componentName", "部件名称": "componentName",
  "部件编码": "componentCode",
  "*主设备名称": "mainDeviceName", "主设备名称": "mainDeviceName",
  "主设备编码": "mainDeviceCode",
  "*主设备类型": "mainDeviceType", "主设备类型": "mainDeviceType",
  "*相位": "phaseType", "相位": "phaseType",
  "*间隔名称": "bayName", "间隔名称": "bayName",
  "间隔编码": "bayCode",
  "*间隔类型": "bayType", "间隔类型": "bayType",
  "*区域": "voltName", "区域": "voltName",
  "区域编码": "voltCode",
  "*厂站": "stationName", "厂站": "stationName",
  "巡视类型1": "inspect1", "巡视类型2": "inspect2",
  "巡视类型3": "inspect3", "巡视类型4": "inspect4",
  "巡视类型5": "inspect5", "巡视类型6": "inspect6",
  "巡视类型7": "inspect7", "巡视类型8": "inspect8",
};

const HIERARCHY_FIELDS = ["voltName", "bayName", "mainDeviceName", "componentName", "pointName"] as const;
const HIERARCHY_LABELS = ["区域", "间隔", "主设备", "部件", "点位"] as const;

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function getHierarchyError(row: Record<string, any>): string | null {
  const values = HIERARCHY_FIELDS.map((field) => textValue(row[field]));
  const firstEmptyIndex = values.findIndex((value) => !value);

  if (firstEmptyIndex === 0) {
    return "区域不能为空";
  }
  if (firstEmptyIndex !== -1 && values.slice(firstEmptyIndex + 1).some(Boolean)) {
    return `${HIERARCHY_LABELS[firstEmptyIndex]}为空时，下层层级也必须为空`;
  }

  return null;
}

/**
 * 解析 Excel 点位表
 * 自动检测：若第 2 行含表头字段，则第 1 行为描述行，表头在行 2，数据从行 3 起
 * 否则表头在行 1，数据从行 2 起
 */
export function parsePointExcel(file: File): Promise<{ rows: PointExcelRow[]; stationName: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
          header: 1, defval: "",
        }) as any[][];

        if (jsonData.length < 2) {
          reject(new Error("Excel 至少需要表头 + 1 行数据"));
          return;
        }

        // 自动检测是否有描述行：若行 2 中可匹配 COLUMN_MAP 的字段数 > 0，说明行 1 是描述
        const row1 = jsonData[0] as string[];
        const row2 = jsonData.length > 1 ? (jsonData[1] as string[]) : [];
        const row1Headers = row1.filter((c) => COLUMN_MAP[c?.trim() ?? ""]).length;
        const row2Headers = row2.filter((c) => COLUMN_MAP[c?.trim() ?? ""]).length;
        const hasDescRow = row2Headers > row1Headers && row2Headers > 0;
        const headerRow = hasDescRow ? row2 : row1;
        const dataStart = hasDescRow ? 2 : 1;

        const rows: PointExcelRow[] = [];
        const errors: string[] = [];
        let stationName = "";

        for (let r = dataStart; r < jsonData.length; r++) {
          const rawRow = jsonData[r] as any[];
          const row: any = {};

          for (let c = 0; c < headerRow.length; c++) {
            const key = COLUMN_MAP[headerRow[c]?.trim() ?? ""];
            if (key) {
              row[key] = rawRow[c] ?? "";
            }
          }

          Object.keys(row).forEach((key) => {
            if (typeof row[key] === "string") row[key] = row[key].trim();
          });

          if (Object.values(row).every((value) => textValue(value) === "")) {
            continue;
          }

          // 跳过示例行（点位名称以 "示例" 开头）
          if (row.pointName && String(row.pointName).startsWith("示例")) {
            continue;
          }

          // ---- 枚举转换 ----
          if (row.recognitionType1 && RECOGNITION_TYPE[row.recognitionType1]) {
            row.recognitionTypeList = RECOGNITION_TYPE[row.recognitionType1];
            if (row.recognitionType2 && RECOGNITION_TYPE[row.recognitionType2]) {
              row.recognitionTypeList += "," + RECOGNITION_TYPE[row.recognitionType2];
            }
          }
          if (row.saveTypeList !== undefined && row.saveTypeList !== null && row.saveTypeList !== "") {
            const numericSaveType = Number(row.saveTypeList);
            const saveType = Number.isInteger(numericSaveType) && numericSaveType >= 1 && numericSaveType <= 5
              ? numericSaveType
              : SAVE_TYPE[String(row.saveTypeList)];
            if (saveType === undefined) {
              errors.push(`第 ${r + 1} 行: 采集类型“${row.saveTypeList}”无效`);
              continue;
            }
            row.saveTypeList = saveType;
          }
          if (row.meterType && METER_TYPE[row.meterType] !== undefined) row.meterType = METER_TYPE[row.meterType];
          if (row.positionStateType && POSITION_STATE[row.positionStateType] !== undefined) row.positionStateType = POSITION_STATE[row.positionStateType];
          if (row.importantLevel && IMPORTANT_LEVEL[row.importantLevel] !== undefined) row.importantLevel = IMPORTANT_LEVEL[row.importantLevel];
          else row.importantLevel = 1;
          if (row.mainDeviceType && MAIN_DEVICE_TYPE[row.mainDeviceType] !== undefined) row.mainDeviceType = MAIN_DEVICE_TYPE[row.mainDeviceType];
          else row.mainDeviceType = 29;
          if (row.phaseType && PHASE_TYPE[row.phaseType] !== undefined) row.phaseType = PHASE_TYPE[row.phaseType];
          else row.phaseType = 0;
          if (row.bayType && BAY_TYPE[row.bayType]) row.bayType = BAY_TYPE[row.bayType];

          // 巡检类型拼接
          const inspects: string[] = [];
          for (let i = 1; i <= 8; i++) {
            const val = row["inspect" + i];
            if (val && INSPECTION_TYPE[val]) inspects.push(INSPECTION_TYPE[val]);
          }
          if (inspects.length > 0) row.inspectionSubType = inspects.join(",");

          // 获取厂站名（取第一个非空值）
          if (!stationName && row.stationName) stationName = String(row.stationName);

          const hierarchyError = getHierarchyError(row);
          if (hierarchyError) {
            errors.push(`第 ${r + 1} 行: ${hierarchyError}`);
            continue;
          }

          rows.push(row as PointExcelRow);
        }

        if (rows.length === 0 && errors.length > 0) {
          reject(new Error(errors.join("\n")));
          return;
        }

        resolve({ rows, stationName: stationName || "未命名厂站" });
      } catch (err: any) {
        reject(new Error("Excel 解析失败: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}
