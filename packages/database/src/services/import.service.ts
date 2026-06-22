import { DbWrapper } from "../core/connection";
import { DeviceVoltageRepo } from "../repositories/device-voltage.repo";
import { DeviceBayRepo } from "../repositories/device-bay.repo";
import { DeviceMainRepo } from "../repositories/device-main.repo";
import { DeviceComponentRepo } from "../repositories/device-component.repo";
import { DevicePointRepo } from "../repositories/device-point.repo";

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
): ImportResult {
  const voltageRepo = new DeviceVoltageRepo(db);
  const bayRepo = new DeviceBayRepo(db);
  const mainRepo = new DeviceMainRepo(db);
  const compRepo = new DeviceComponentRepo(db);
  const pointRepo = new DevicePointRepo(db);

  const result: ImportResult = { total: rows.length, inserted: 0, updated: 0, errors: [] };

  for (const row of rows) {
    try {
    // ??????????????
    row.voltName = row.voltName?.trim() ?? "";
    row.voltCode = row.voltCode?.trim() ?? "";
    row.bayName = row.bayName?.trim() ?? "";
    row.bayCode = row.bayCode?.trim() ?? "";
    row.bayType = row.bayType?.trim() ?? "";
    row.mainDeviceName = row.mainDeviceName?.trim() ?? "";
    row.mainDeviceCode = row.mainDeviceCode?.trim() ?? "";
    row.componentName = row.componentName?.trim() ?? "";
    row.componentCode = row.componentCode?.trim() ?? "";
    row.componentType = row.componentType?.trim() ?? "";
    row.pointName = row.pointName?.trim() ?? "";
    row.pointCode = row.pointCode?.trim() ?? "";
    row.cruiseId = row.cruiseId?.trim() ?? "";
    row.stationName = row.stationName?.trim() ?? "";
    row.stationCode = row.stationCode?.trim() ?? "";
      // 1. voltage（按名称+厂站 upsert）
      const volt = voltageRepo.upsert({
        voltName: row.voltName,
        voltCode: row.voltCode ?? "",
        stationId: 0,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        createBy: "import",
        updateBy: "import",
      });

      // 2. bay（按名称+电压 upsert）
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
        repairFlag: 0,
        createBy: "import",
        updateBy: "import",
      });

      // 3. main device（按名称+间隔 upsert）
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

      // 4. component（按名称+主设备 upsert）
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
        repairFlag: 0,
        createBy: "import",
        updateBy: "import",
      });

      // 5. point（按 cruiseId upsert，空则按 pointCode 回退）
      const cruiseId = row.cruiseId || row.pointCode || "";
      if (!cruiseId) {
        result.errors.push(`行 "${row.pointName}": cruiseId 和 pointCode 均为空，跳过`);
        continue;
      }

      const existing = pointRepo.findByCruiseId(cruiseId);
      if (existing) {
        pointRepo.update(existing.id, {
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId,
          recognitionTypeList: row.recognitionTypeList ?? existing.recognitionTypeList,
          saveTypeList: row.saveTypeList ?? existing.saveTypeList,
          meterType: row.meterType ?? existing.meterType,
          positionStateType: row.positionStateType ?? existing.positionStateType,
          importantLevel: row.importantLevel ?? existing.importantLevel,
          inspectionSubType: row.inspectionSubType ?? existing.inspectionSubType,
        });
        result.updated++;
      } else {
        pointRepo.create({
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId,
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
      result.errors.push(`行 "${row.pointName}": ${e.message}`);
    }
  }

  return result;
}
