import { DbWrapper } from "../core/connection";
import { DeviceVoltageRepo } from "../repositories/device-voltage.repo";
import { DeviceBayRepo } from "../repositories/device-bay.repo";
import { DeviceMainRepo } from "../repositories/device-main.repo";
import { DeviceComponentRepo } from "../repositories/device-component.repo";
import { DevicePointRepo } from "../repositories/device-point.repo";
import { ProjectStationRepo } from "../repositories/project-station.repo";
import type { DevicePoint } from "../types";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 生成 32 位大小写字母+数字唯一编码 */
function generateCode(prefix: string): string {
  let result = prefix;
  const randLen = 32 - prefix.length;
  for (let i = 0; i < randLen; i++) {
    result += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return result;
}

/**
 * 同名设备编码缓存，仅按名称全路径匹配，不依赖编码/ID。
 * 电压区: key=voltName
 * 间隔:   key=voltName|bayName
 * 主设备: key=voltName|bayName|mainDeviceName
 * 部件:   key=voltName|bayName|mainDeviceName|componentName
 * 点位:   key=voltName|bayName|mainDeviceName|componentName|pointName
 */
const voltCodeCache = new Map<string, string>();
const bayCodeCache = new Map<string, string>();
const mainCodeCache = new Map<string, string>();
const compCodeCache = new Map<string, string>();
const pointCodeCache = new Map<string, string>();

const textValue = (value: unknown): string => String(value ?? "").trim();
const pathKey = (...parts: unknown[]): string => parts.map(textValue).join("|");
const hierarchyFields = ["voltName", "bayName", "mainDeviceName", "componentName", "pointName"] as const;
const hierarchyLabels = ["区域", "间隔", "主设备", "部件", "点位"] as const;

function normalizeRow(row: PointExcelRow): void {
  row.voltName = textValue(row.voltName);
  row.voltCode = textValue(row.voltCode);
  row.bayName = textValue(row.bayName);
  row.bayCode = textValue(row.bayCode);
  row.bayType = textValue(row.bayType);
  row.mainDeviceName = textValue(row.mainDeviceName);
  row.mainDeviceCode = textValue(row.mainDeviceCode);
  row.componentName = textValue(row.componentName);
  row.componentCode = textValue(row.componentCode);
  row.componentType = textValue(row.componentType);
  row.pointName = textValue(row.pointName);
  row.pointCode = textValue(row.pointCode);
  row.cruiseId = textValue(row.cruiseId);
  row.stationName = textValue(row.stationName);
  row.stationCode = textValue(row.stationCode);
}

function getHierarchyDepth(row: PointExcelRow): { depth: number; error?: string } {
  const values = hierarchyFields.map((field) => textValue(row[field]));
  const firstEmptyIndex = values.findIndex((value) => !value);

  if (firstEmptyIndex === 0) {
    return { depth: 0, error: "区域不能为空" };
  }
  if (firstEmptyIndex !== -1 && values.slice(firstEmptyIndex + 1).some(Boolean)) {
    return {
      depth: firstEmptyIndex,
      error: `${hierarchyLabels[firstEmptyIndex]}为空时，下层层级也必须为空`,
    };
  }

  return { depth: firstEmptyIndex === -1 ? values.length : firstEmptyIndex };
}

function describeRow(row: PointExcelRow): string {
  return hierarchyFields
    .map((field) => textValue(row[field]))
    .filter(Boolean)
    .join(" / ");
}

function matchesPointPath(
  point: DevicePoint,
  voltName: string,
  bayName: string,
  mainDeviceName: string,
  componentName: string,
  pointName: string,
): boolean {
  return point.voltName === voltName
    && point.bayName === bayName
    && point.mainDeviceName === mainDeviceName
    && point.componentName === componentName
    && point.pointName === pointName;
}

/** Excel 每行数据结构（与 excel-parser.ts 共享） */
export interface PointExcelRow {
  voltName: string;
  voltCode?: string;
  bayName: string;
  bayType?: string;
  bayCode?: string;
  mainDeviceName: string;
  mainDeviceType?: number;
  mainDeviceCode?: string;
  phaseType?: number;
  componentName: string;
  componentType?: string;
  componentCode?: string;
  pointName: string;
  pointCode?: string;
  cruiseId?: string;
  recognitionTypeList?: string;
  saveTypeList?: number;
  meterType?: number;
  positionStateType?: number;
  importantLevel?: number;
  inspectionSubType?: string;
  stationName?: string;
  stationCode?: string;
  alarmLevel?: number;
  sortNum?: number;
}

export interface ImportResult {
  total: number;
  inserted: number;
  updated: number;
  errors: string[];
}

/**
 * 导入点表数据：Excel 行 → 设备树（增量 upsert）
 *
 * stationName / stationCode 直接透传到各层级，厂站仅作为筛选字段不单独建表。
 * stationId 传 0 表示不关联外部厂站记录。
 */
export function importPointExcel(
  db: DbWrapper,
  rows: PointExcelRow[],
  stationName: string,
  stationCode: string,
  projectName: string,
): ImportResult {
  const voltageRepo = new DeviceVoltageRepo(db);
  const bayRepo = new DeviceBayRepo(db);
  const mainRepo = new DeviceMainRepo(db);
  const compRepo = new DeviceComponentRepo(db);
  const pointRepo = new DevicePointRepo(db);
  const psRepo = new ProjectStationRepo(db);

  voltCodeCache.clear();
  bayCodeCache.clear();
  mainCodeCache.clear();
  compCodeCache.clear();
  pointCodeCache.clear();

  // 项目-厂站绑定校验
  const existingBinding = psRepo.getByProjectName(projectName);
  if (existingBinding) {
    if (existingBinding.stationName !== stationName) {
      throw new Error(
        `导入失败：当前项目 "${projectName}" 已绑定厂站 "${existingBinding.stationName}"，` +
        `与导入点表中的厂站 "${stationName}" 不一致，请确认点表文件是否正确`
      );
    }
  }

  const result: ImportResult = { total: rows.length, inserted: 0, updated: 0, errors: [] };
  const pointPathRows = new Map<string, number>();
  const pointCodeRows = new Map<string, number>();

  rows.forEach((row, index) => {
    normalizeRow(row);
    const hierarchy = getHierarchyDepth(row);
    if (hierarchy.error) {
      result.errors.push(`第 ${index + 1} 行: ${hierarchy.error}`);
      return;
    }

    if (hierarchy.depth >= 5) {
      const pointPath = pathKey(row.voltName, row.bayName, row.mainDeviceName, row.componentName, row.pointName);
      const firstPathRow = pointPathRows.get(pointPath);
      if (firstPathRow !== undefined) {
        result.errors.push(`第 ${index + 1} 行: 同一部件下点位名称不能重复（与第 ${firstPathRow + 1} 行完整路径相同）`);
      } else {
        pointPathRows.set(pointPath, index);
      }

      if (row.pointCode) {
        const firstCodeRow = pointCodeRows.get(row.pointCode);
        if (firstCodeRow !== undefined) {
          result.errors.push(`第 ${index + 1} 行: 点位编码已存在（与第 ${firstCodeRow + 1} 行重复）`);
        } else {
          pointCodeRows.set(row.pointCode, index);
        }
      }
    }
  });

  rows.forEach((row, index) => {
    const hierarchy = getHierarchyDepth(row);
    if (hierarchy.error || hierarchy.depth < 5 || !row.pointCode) return;

    const existingPoint = pointRepo.findByPointCode(row.pointCode, projectName);
    if (existingPoint && !matchesPointPath(existingPoint, row.voltName, row.bayName, row.mainDeviceName, row.componentName, row.pointName)) {
      result.errors.push(`第 ${index + 1} 行: 点位编码 "${row.pointCode}" 已属于其他点位路径`);
    }
  });

  if (result.errors.length > 0) {
    return result;
  }

  for (const [index, row] of rows.entries()) {
    try {
      const hierarchy = getHierarchyDepth(row);
      if (hierarchy.error) {
        result.errors.push(`第 ${index + 1} 行: ${hierarchy.error}`);
        continue;
      }

      // ====== 编码自动填充 + 逐层 upsert（对齐 Java insertOrUpdate* 模式） ======
      // 1. 电压区编码
      let existingVoltage = row.voltCode ? voltageRepo.findByVoltCode(row.voltCode, projectName) : undefined;
      if (!existingVoltage) {
        existingVoltage = voltageRepo.findByVoltNameAndStationId(row.voltName, 0, projectName);
      }
      if (!row.voltCode) {
        const exist = voltCodeCache.get(row.voltName);
        row.voltCode = exist || existingVoltage?.voltCode || generateCode("V");
      }
      const volt = voltageRepo.upsert({
        voltName: row.voltName,
        voltCode: row.voltCode ?? "",
        stationId: 0,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        projectName,
        createBy: "import",
        updateBy: "import",
      });
      row.voltCode = volt.voltCode;
      voltCodeCache.set(row.voltName, volt.voltCode);
      if (hierarchy.depth === 1) {
        if (existingVoltage) result.updated++;
        else result.inserted++;
        continue;
      }

      // 2. 间隔编码
      const bayCacheKey = pathKey(row.voltName, row.bayName);
      let existingBay = row.bayCode ? bayRepo.findByBayCode(row.bayCode, projectName) : undefined;
      if (!existingBay) {
        existingBay = bayRepo.findByBayNameAndVoltId(row.bayName, volt.id, projectName);
      }
      if (!row.bayCode) {
        const exist = bayCodeCache.get(bayCacheKey);
        row.bayCode = exist || existingBay?.bayCode || generateCode("B");
      }
      const bay = bayRepo.upsert({
        bayName: row.bayName,
        bayType: row.bayType ?? "",
        bayCode: row.bayCode ?? "",
        voltId: volt.id,
        voltName: volt.voltName,
        voltCode: volt.voltCode,
        stationId: 0,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        projectName,
        repairFlag: 0,
        createBy: "import",
        updateBy: "import",
      });
      row.bayCode = bay.bayCode;
      bayCodeCache.set(bayCacheKey, bay.bayCode);
      if (hierarchy.depth === 2) {
        if (existingBay) result.updated++;
        else result.inserted++;
        continue;
      }

      // 3. 主设备编码
      const mainCacheKey = pathKey(row.voltName, row.bayName, row.mainDeviceName);
      let existingMain = row.mainDeviceCode ? mainRepo.findByMainDeviceCode(row.mainDeviceCode, projectName) : undefined;
      if (!existingMain) {
        existingMain = mainRepo.findByMainDeviceNameAndBayId(row.mainDeviceName, bay.id, projectName);
      }
      if (!row.mainDeviceCode) {
        const exist = mainCodeCache.get(mainCacheKey);
        row.mainDeviceCode = exist || existingMain?.mainDeviceCode || generateCode("MD");
      }
      const main = mainRepo.upsert({
        mainDeviceName: row.mainDeviceName,
        mainDeviceType: row.mainDeviceType ?? 29,
        mainDeviceCode: row.mainDeviceCode ?? "",
        phaseType: row.phaseType ?? 0,
        threePhaseFlag: 0,
        threePhaseAssociateId: "",
        entityId: "",
        bayId: bay.id,
        bayType: bay.bayType,
        bayName: bay.bayName,
        bayCode: bay.bayCode,
        voltId: volt.id,
        voltName: volt.voltName,
        voltCode: volt.voltCode,
        stationId: 0,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        projectName,
        repairFlag: 0,
        deviceModel: "",
        deviceSource: "",
        manufacturer: "",
        productionCode: "",
        useCompany: "",
        productionDate: "",
        commissioningDate: "",
        remarkInfo: "",
        createBy: "import",
        updateBy: "import",
      });
      row.mainDeviceCode = main.mainDeviceCode;
      mainCodeCache.set(mainCacheKey, main.mainDeviceCode);
      if (hierarchy.depth === 3) {
        if (existingMain) result.updated++;
        else result.inserted++;
        continue;
      }

      // 4. 部件编码
      const compCacheKey = pathKey(row.voltName, row.bayName, row.mainDeviceName, row.componentName);
      let existingComp = row.componentCode ? compRepo.findByComponentCode(row.componentCode, projectName) : undefined;
      if (!existingComp) {
        existingComp = compRepo.findByComponentNameAndMainDeviceId(row.componentName, main.id, projectName);
      }
      if (!row.componentCode) {
        const exist = compCodeCache.get(compCacheKey);
        row.componentCode = exist || existingComp?.componentCode || generateCode("C");
      }
      const comp = compRepo.upsert({
        componentName: row.componentName,
        componentType: row.componentType ?? "",
        componentCode: row.componentCode ?? "",
        mainDeviceId: main.id,
        mainDeviceType: main.mainDeviceType,
        mainDeviceName: main.mainDeviceName,
        mainDeviceCode: main.mainDeviceCode,
        phaseType: main.phaseType,
        bayId: bay.id,
        bayType: bay.bayType,
        bayName: bay.bayName,
        bayCode: bay.bayCode,
        voltId: volt.id,
        voltName: volt.voltName,
        voltCode: volt.voltCode,
        stationId: 0,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        projectName,
        repairFlag: 0,
        createBy: "import",
        updateBy: "import",
      });
      row.componentCode = comp.componentCode;
      compCodeCache.set(compCacheKey, comp.componentCode);
      if (hierarchy.depth === 4) {
        if (existingComp) result.updated++;
        else result.inserted++;
        continue;
      }

      // 5. 点位：有编码按编码匹配；无编码按完整树路径匹配，避免重复导入生成新点位。
      const pointCacheKey = pathKey(row.voltName, row.bayName, row.mainDeviceName, row.componentName, row.pointName);
      let existingPoint = row.pointCode ? pointRepo.findByPointCode(row.pointCode, projectName) : undefined;
      const existingPointByPath = pointRepo.findByPath(
        projectName,
        volt.voltName,
        bay.bayName,
        main.mainDeviceName,
        comp.componentName,
        row.pointName,
      );

      if (existingPoint && !matchesPointPath(existingPoint, volt.voltName, bay.bayName, main.mainDeviceName, comp.componentName, row.pointName)) {
        throw new Error(`点位编码 "${row.pointCode}" 已属于其他点位路径`);
      }

      if (!existingPoint) {
        existingPoint = existingPointByPath;
      }

      if (!row.pointCode) {
        const exist = pointCodeCache.get(pointCacheKey);
        row.pointCode = exist || existingPoint?.pointCode || generateCode("P");
      }
      if (!row.cruiseId && !existingPoint) {
        row.cruiseId = generateCode("CRU");
      }
      pointCodeCache.set(pointCacheKey, row.pointCode ?? "");

      if (existingPoint) {
        pointRepo.update(existingPoint.id, {
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId: row.cruiseId || existingPoint.cruiseId,
          recognitionTypeList: row.recognitionTypeList ?? existingPoint.recognitionTypeList,
          saveTypeList: row.saveTypeList ?? existingPoint.saveTypeList,
          meterType: row.meterType ?? existingPoint.meterType,
          positionStateType: row.positionStateType ?? existingPoint.positionStateType,
          importantLevel: row.importantLevel ?? existingPoint.importantLevel,
          inspectionSubType: row.inspectionSubType ?? existingPoint.inspectionSubType,
          componentId: comp.id,
          componentType: comp.componentType,
          componentName: comp.componentName,
          componentCode: comp.componentCode,
          mainDeviceId: main.id,
          mainDeviceType: main.mainDeviceType,
          mainDeviceName: main.mainDeviceName,
          mainDeviceCode: main.mainDeviceCode,
          phaseType: main.phaseType,
          bayId: bay.id,
          bayType: bay.bayType,
          bayName: bay.bayName,
          bayCode: bay.bayCode,
          voltId: volt.id,
          voltName: volt.voltName,
          voltCode: volt.voltCode,
          stationId: 0,
          stationName,
          stationCode,
          projectName,
          updateBy: "import",
          alarmLevel: row.alarmLevel ?? existingPoint.alarmLevel,
        });
        result.updated++;
      } else {
        pointRepo.create({
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId: row.cruiseId ?? "",
          recognitionTypeList: row.recognitionTypeList ?? "",
          saveTypeList: row.saveTypeList ?? 1,
          meterType: row.meterType ?? 0,
          positionStateType: row.positionStateType ?? 0,
          appearanceType: 0,
          defectRecType: "",
          pointTagsCodeList: "",
          defectJudgeType: 0,
          importantLevel: row.importantLevel ?? 2,
          sortNum: row.sortNum ?? 1,
          threePhaseFlag: 0,
          threePhaseAssociateId: "",
          demarcateState: 0,
          robotId: 0,
          robotName: "",
          originCalibrationPath: "",
          extendCalibrationPath: "",
          visibleCalibrationPath: "",
          latestCollectPath: "",
          thermalRegion: "",
          calibrationId: "",
          componentId: comp.id,
          componentType: comp.componentType,
          componentName: comp.componentName,
          componentCode: comp.componentCode,
          mainDeviceId: main.id,
          mainDeviceType: main.mainDeviceType,
          mainDeviceName: main.mainDeviceName,
          mainDeviceCode: main.mainDeviceCode,
          phaseType: main.phaseType,
          bayId: bay.id,
          bayType: bay.bayType,
          bayName: bay.bayName,
          bayCode: bay.bayCode,
          voltId: volt.id,
          voltName: volt.voltName,
          voltCode: volt.voltCode,
          stationId: 0,
          stationName,
          stationCode,
          inspectionSubType: row.inspectionSubType ?? "",
          projectName,
          createBy: "import",
          updateBy: "import",
          alarmLevel: row.alarmLevel ?? 0,
          mapCode: "",
          repairFlag: 0,
          deviceInfo: "",
          remark: "",
        });
        result.inserted++;
      }
    } catch (e: any) {
      result.errors.push(`第 ${index + 1} 行 "${describeRow(row)}": ${e.message}`);
    }
  }

  // 首次导入时创建项目-厂站绑定
  if (!existingBinding) {
    psRepo.bind(projectName, stationName);
  }

  return result;
}
