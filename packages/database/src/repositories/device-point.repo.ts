import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DevicePoint, CreateDevicePointDTO, UpdateDevicePointDTO } from "../types";

const COLUMNS = [
  "point_name", "point_code", "recognition_type_list",
  "save_type_list", "meter_type", "position_state_type", "appearance_type",
  "defect_rec_type", "point_tags_code_list", "defect_judge_type",
  "important_level", "sort_num",
  "three_phase_flag", "three_phase_associate_id",
  "demarcate_state", "robot_id", "robot_name", "cruise_id",
  "origin_calibration_path", "extend_calibration_path", "visible_calibration_path",
  "latest_collect_path", "thermal_region", "calibration_id",
  "component_id", "component_type", "component_name", "component_code",
  "main_device_id", "main_device_type", "main_device_name", "main_device_code",
  "phase_type",
  "bay_id", "bay_type", "bay_name", "bay_code",
  "volt_id", "volt_name", "volt_code",
  "station_id", "station_name", "station_code",
  "inspection_sub_type", "project_name",
  "create_time", "create_by", "update_time", "update_by",
  "alarm_level", "map_code", "repair_flag", "device_info", "remark",
] as const;

function toRow(dto: CreateDevicePointDTO, now: string): any[] {
  return [
    dto.pointName, dto.pointCode, dto.recognitionTypeList,
    dto.saveTypeList, dto.meterType, dto.positionStateType, dto.appearanceType,
    dto.defectRecType, dto.pointTagsCodeList, dto.defectJudgeType,
    dto.importantLevel, dto.sortNum,
    dto.threePhaseFlag, dto.threePhaseAssociateId,
    dto.demarcateState, dto.robotId, dto.robotName, dto.cruiseId,
    dto.originCalibrationPath, dto.extendCalibrationPath, dto.visibleCalibrationPath,
    dto.latestCollectPath, dto.thermalRegion, dto.calibrationId,
    dto.componentId, dto.componentType, dto.componentName, dto.componentCode,
    dto.mainDeviceId, dto.mainDeviceType, dto.mainDeviceName, dto.mainDeviceCode,
    dto.phaseType,
    dto.bayId, dto.bayType, dto.bayName, dto.bayCode,
    dto.voltId, dto.voltName, dto.voltCode,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.inspectionSubType, dto.projectName,
    now, dto.createBy, now, dto.updateBy,
    dto.alarmLevel, dto.mapCode, dto.repairFlag, dto.deviceInfo, dto.remark,
  ];
}

export class DevicePointRepo {
  constructor(private db: DbWrapper) {}

  list(projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE project_name = ? ORDER BY sort_num").all(projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point ORDER BY sort_num").all() as DevicePoint[];
  }

  getById(id: number): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE id = ?").get(id) as DevicePoint | undefined;
  }

  findByPointCode(pointCode: string, projectName?: string): DevicePoint | undefined {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE point_code = ? AND project_name = ?").get(pointCode, projectName) as DevicePoint | undefined;
    }
    return this.db.prepare("SELECT * FROM device_point WHERE point_code = ?").get(pointCode) as DevicePoint | undefined;
  }

  findByPath(
    projectName: string,
    voltName: string,
    bayName: string,
    mainDeviceName: string,
    componentName: string,
    pointName: string,
  ): DevicePoint | undefined {
    return this.db
      .prepare(
        `SELECT * FROM device_point
         WHERE project_name = ?
           AND volt_name = ?
           AND bay_name = ?
           AND main_device_name = ?
           AND component_name = ?
           AND point_name = ?
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(projectName, voltName, bayName, mainDeviceName, componentName, pointName) as DevicePoint | undefined;
  }

  findByCalibrationId(calibrationId: string, projectName?: string): DevicePoint | undefined {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE calibration_id = ? AND project_name = ?").get(calibrationId, projectName) as DevicePoint | undefined;
    }
    return this.db.prepare("SELECT * FROM device_point WHERE calibration_id = ?").get(calibrationId) as DevicePoint | undefined;
  }

  findByStationId(stationId: number, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE station_id = ? AND project_name = ? ORDER BY sort_num").all(stationId, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num").all(stationId) as DevicePoint[];
  }

  findByComponentId(componentId: number, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE component_id = ? AND project_name = ? ORDER BY sort_num").all(componentId, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE component_id = ? ORDER BY sort_num").all(componentId) as DevicePoint[];
  }

  paginate(page: number, pageSize: number, stationId?: number, projectName?: string): { data: DevicePoint[]; total: number } {
    const offset = (page - 1) * pageSize;
    if (stationId !== undefined && projectName) {
      const total = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE station_id = ? AND project_name = ?").get(stationId, projectName) as { cnt: number }
      ).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE station_id = ? AND project_name = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(stationId, projectName, pageSize, offset) as DevicePoint[];
      return { data, total };
    }
    if (stationId !== undefined) {
      const total = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE station_id = ?").get(stationId) as { cnt: number }
      ).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(stationId, pageSize, offset) as DevicePoint[];
      return { data, total };
    }
    if (projectName) {
      const total = (this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE project_name = ?").get(projectName) as { cnt: number }).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE project_name = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(projectName, pageSize, offset) as DevicePoint[];
      return { data, total };
    }
    const total = (this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point").get() as { cnt: number }).cnt;
    const data = this.db
      .prepare("SELECT * FROM device_point ORDER BY sort_num LIMIT ? OFFSET ?")
      .all(pageSize, offset) as DevicePoint[];
    return { data, total };
  }

  create(dto: CreateDevicePointDTO): DevicePoint {
    const now = new Date().toISOString();
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_point (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_point failed: changes=0, pointName="${dto.pointName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_point done but getById(${result.lastInsertRowid}) returned null, pointName="${dto.pointName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDevicePointDTO): void {
    const fields: string[] = [];
    const vals: any[] = [];
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        fields.push(`${toSnake(key)} = ?`);
        vals.push(value);
      }
    }
    if (fields.length === 0) return;
    fields.push("update_time = ?");
    vals.push(new Date().toISOString());
    vals.push(id);
    this.db.prepare(`UPDATE device_point SET ${fields.join(", ")} WHERE id = ?`).run(vals);
  }

  findByCruiseId(cruiseId: string, projectName: string): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE cruise_id = ? AND project_name = ?").get(cruiseId, projectName) as DevicePoint | undefined;
  }

  findByPointName(pointName: string, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE point_name = ? AND project_name = ?").all(pointName, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE point_name = ?").all(pointName) as DevicePoint[];
  }

  upsert(dto: CreateDevicePointDTO & { pointCode: string; projectName: string }): DevicePoint {
    const existing = this.findByPointCode(dto.pointCode, dto.projectName);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM device_point WHERE id = ?").run(id);
  }
}
