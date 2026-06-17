import { DbWrapper } from "../core/connection";
import { FacInfoRepo } from "../repositories/fac-info.repo";
import { DeviceVoltageRepo } from "../repositories/device-voltage.repo";
import { DeviceBayRepo } from "../repositories/device-bay.repo";
import { DeviceMainRepo } from "../repositories/device-main.repo";
import { DeviceComponentRepo } from "../repositories/device-component.repo";
import { DevicePointRepo } from "../repositories/device-point.repo";

/** Excel 每行数据结构 */
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
  cruiseId: string;
  robotId?: number;
  robotName?: string;
  alarmLevel?: number;
  sortNum?: number;
}

export interface ImportResult {
  total: number;
  inserted: number;
  updated: number;
  errors: string[];
}

/** 导入点表数据（Excel 行转设备树） */
export function importPointExcel(
  db: DbWrapper,
  rows: PointExcelRow[],
  stationId: number,
  stationName: string,
  stationCode: string,
): ImportResult {
  const facRepo = new FacInfoRepo(db);
  const voltageRepo = new DeviceVoltageRepo(db);
  const bayRepo = new DeviceBayRepo(db);
  const mainRepo = new DeviceMainRepo(db);
  const compRepo = new DeviceComponentRepo(db);
  const pointRepo = new DevicePointRepo(db);

  const result: ImportResult = { total: rows.length, inserted: 0, updated: 0, errors: [] };

  // 确保厂站存在
  let fac = facRepo.findByStationName(stationName);
  if (!fac) {
    fac = facRepo.create({
      stationName, stationCode,
      outStationCode: "", facType: "1", stationType: "1",
      provinceName: "", cityName: "", areaName: "",
      createBy: "import", updateBy: "import",
      voltName: rows[0]?.voltName ?? "",
      useTime: "", responsiblePerson: "", telephone: "",
      envDataRobotId: 0, currentFac: 1, alarmLevel: 0, sortNum: 1,
    });
  }
  const localStationId = fac.id;

  for (const row of rows) {
    try {
      // 1. voltage
      const volt = voltageRepo.upsert({
        voltName: row.voltName,
        voltCode: row.voltCode ?? "",
        stationId: localStationId,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        createBy: "import", updateBy: "import",
      });

      // 2. bay
      const bay = bayRepo.upsert({
        bayName: row.bayName,
        bayType: row.bayType ?? "",
        bayCode: row.bayCode ?? "",
        voltId: volt.id,
        voltName: volt.voltName,
        voltCode: volt.voltCode,
        stationId: localStationId,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        repairFlag: 0,
        createBy: "import", updateBy: "import",
      });

      // 3. main device
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
        stationId: localStationId,
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
        createBy: "import", updateBy: "import",
      });

      // 4. component
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
        stationId: localStationId,
        stationName,
        stationCode,
        alarmLevel: row.alarmLevel ?? 0,
        sortNum: 1,
        repairFlag: 0,
        createBy: "import", updateBy: "import",
      });

      // 5. point
      const existing = pointRepo.findByCruiseId(row.cruiseId);
      if (existing) {
        pointRepo.update(existing.id, {
          pointName: row.pointName,
          pointCode: row.pointCode,
          cruiseId: row.cruiseId,
        });
        result.updated++;
      } else {
        pointRepo.create({
          pointName: row.pointName,
          pointCode: row.pointCode ?? "",
          cruiseId: row.cruiseId,
          recognitionTypeList: "",
          saveTypeList: 1,
          meterType: 0,
          positionStateType: 0,
          appearanceType: 0,
          defectRecType: "",
          pointTagsCodeList: "",
          defectJudgeType: 0,
          importantLevel: 2,
          sortNum: row.sortNum ?? 1,
          threePhaseFlag: 0,
          threePhaseAssociateId: "",
          demarcateState: 0,
          robotId: row.robotId ?? 0,
          robotName: row.robotName ?? "",
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
          stationId: localStationId,
          stationName,
          stationCode,
          inspectionSubType: "",
          createBy: "import", updateBy: "import",
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
