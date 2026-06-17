import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DevicePoint, CreateDevicePointDTO, UpdateDevicePointDTO } from "../types";

export class DevicePointRepo {
  constructor(private db: DbWrapper) {}

  list(): DevicePoint[] {
    return this.db.prepare("SELECT * FROM device_point ORDER BY sort_num").all() as DevicePoint[];
  }

  getById(id: number): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE id = ?").get(id) as DevicePoint | undefined;
  }

  findByPointCode(pointCode: string): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE point_code = ?").get(pointCode) as DevicePoint | undefined;
  }

  findByCalibrationId(calibrationId: string): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE calibration_id = ?").get(calibrationId) as DevicePoint | undefined;
  }

  findByStationId(stationId: number): DevicePoint[] {
    return this.db.prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num").all(stationId) as DevicePoint[];
  }

  findByComponentId(componentId: number): DevicePoint[] {
    return this.db.prepare("SELECT * FROM device_point WHERE component_id = ? ORDER BY sort_num").all(componentId) as DevicePoint[];
  }

  paginate(page: number, pageSize: number, stationId?: number): { data: DevicePoint[]; total: number } {
    const offset = (page - 1) * pageSize;
    if (stationId !== undefined) {
      const total = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE station_id = ?").get(stationId) as { cnt: number }
      ).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(stationId, pageSize, offset) as DevicePoint[];
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
    const stmt = this.db.prepare(`
      INSERT INTO device_point (
        point_name, point_code, recognition_type_list,
        save_type_list, meter_type, position_state_type, appearance_type,
        defect_rec_type, point_tags_code_list, defect_judge_type,
        important_level, sort_num,
        three_phase_flag, three_phase_associate_id,
        demarcate_state, robot_id, robot_name, cruise_id,
        origin_calibration_path, extend_calibration_path, visible_calibration_path,
        latest_collect_path, thermal_region, calibration_id,
        component_id, component_type, component_name, component_code,
        main_device_id, main_device_type, main_device_name, main_device_code,
        phase_type,
        bay_id, bay_type, bay_name, bay_code,
        volt_id, volt_name, volt_code,
        station_id, station_name, station_code,
        inspection_sub_type,
        create_time, create_by, update_time, update_by,
        alarm_level, map_code, repair_flag, device_info, remark
      ) VALUES (
        @pointName, @pointCode, @recognitionTypeList,
        @saveTypeList, @meterType, @positionStateType, @appearanceType,
        @defectRecType, @pointTagsCodeList, @defectJudgeType,
        @importantLevel, @sortNum,
        @threePhaseFlag, @threePhaseAssociateId,
        @demarcateState, @robotId, @robotName, @cruiseId,
        @originCalibrationPath, @extendCalibrationPath, @visibleCalibrationPath,
        @latestCollectPath, @thermalRegion, @calibrationId,
        @componentId, @componentType, @componentName, @componentCode,
        @mainDeviceId, @mainDeviceType, @mainDeviceName, @mainDeviceCode,
        @phaseType,
        @bayId, @bayType, @bayName, @bayCode,
        @voltId, @voltName, @voltCode,
        @stationId, @stationName, @stationCode,
        @inspectionSubType,
        @createTime, @createBy, @updateTime, @updateBy,
        @alarmLevel, @mapCode, @repairFlag, @deviceInfo, @remark
      )
    `);
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, dto: UpdateDevicePointDTO): void {
    const fields: string[] = [];
    const params: Record<string, any> = { id };
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        fields.push(toSnake(key) + " = @" + key);
        params[key] = value;
      }
    }
    if (fields.length === 0) return;
    fields.push("update_time = @_now");
    params["_now"] = new Date().toISOString();
    this.db.prepare("UPDATE device_point SET " + fields.join(", ") + " WHERE id = @id").run(params);
  }


  findByCruiseId(cruiseId: string): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE cruise_id = ?").get(cruiseId) as DevicePoint | undefined;
  }

  findByPointName(pointName: string): DevicePoint[] {
    return this.db.prepare("SELECT * FROM device_point WHERE point_name = ?").all(pointName) as DevicePoint[];
  }

  upsert(dto: CreateDevicePointDTO & { cruiseId: string }): DevicePoint {
    const existing = this.findByCruiseId(dto.cruiseId);
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
