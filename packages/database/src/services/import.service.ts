import { DbWrapper } from "../core/connection";
import { DeviceVoltageRepo } from "../repositories/device-voltage.repo";
import { DeviceBayRepo } from "../repositories/device-bay.repo";
import { DeviceMainRepo } from "../repositories/device-main.repo";
import { DeviceComponentRepo } from "../repositories/device-component.repo";
import { DevicePointRepo } from "../repositories/device-point.repo";
import { ProjectStationRepo } from "../repositories/project-station.repo";

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

  for (const row of rows) {
    try {
      // 字段值去首尾空格
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
      // 1. voltage（按名称+厂站+项目 upsert）
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

      // 2. bay（按名称+电压+项目 upsert）
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

      // 3. main device（按名称+间隔+项目 upsert）
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

      // 4. component（按名称+主设备+项目 upsert）
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

      // 5. point（按 pointCode 查重，cruiseId 仅作传参字段）
      if (!row.pointCode) {
        result.errors.push(`行 "${row.pointName}": pointCode 为空，跳过`);
        continue;
      }

      const existingPoint = pointRepo.findByPointCode(row.pointCode, projectName);

      if (existingPoint) {
        pointRepo.update(existingPoint.id, {
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId: row.cruiseId ?? existingPoint.cruiseId,
          recognitionTypeList: row.recognitionTypeList ?? existingPoint.recognitionTypeList,
          saveTypeList: row.saveTypeList ?? existingPoint.saveTypeList,
          meterType: row.meterType ?? existingPoint.meterType,
          positionStateType: row.positionStateType ?? existingPoint.positionStateType,
          importantLevel: row.importantLevel ?? existingPoint.importantLevel,
          inspectionSubType: row.inspectionSubType ?? existingPoint.inspectionSubType,
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
      result.errors.push(`行 "${row.pointName}": ${e.message}`);
    }
  }

  // 首次导入时创建项目-厂站绑定
  if (!existingBinding) {
    psRepo.bind(projectName, stationName);
  }

  return result;
}
