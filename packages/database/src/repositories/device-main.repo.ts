import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceMain, CreateDeviceMainDTO, UpdateDeviceMainDTO } from "../types";

export class DeviceMainRepo {
  constructor(private db: DbWrapper) {}

  list(): DeviceMain[] {
    return this.db.prepare("SELECT * FROM device_main ORDER BY sort_num").all() as DeviceMain[];
  }

  getById(id: number): DeviceMain | undefined {
    return this.db.prepare("SELECT * FROM device_main WHERE id = ?").get(id) as DeviceMain | undefined;
  }

  findByBayId(bayId: number): DeviceMain[] {
    return this.db.prepare("SELECT * FROM device_main WHERE bay_id = ? ORDER BY sort_num").all(bayId) as DeviceMain[];
  }

  findByStationId(stationId: number): DeviceMain[] {
    return this.db.prepare("SELECT * FROM device_main WHERE station_id = ? ORDER BY sort_num").all(stationId) as DeviceMain[];
  }

  create(dto: CreateDeviceMainDTO): DeviceMain {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO device_main (
        main_device_type, main_device_name, main_device_code,
        phase_type, three_phase_flag, three_phase_associate_id, entity_id,
        alarm_level,
        bay_id, bay_type, bay_name, bay_code,
        volt_id, volt_name, volt_code,
        station_id, station_name, station_code,
        sort_num, create_time, create_by, update_time, update_by,
        device_model, device_source, manufacturer, production_code,
        use_company, production_date, commissioning_date, remark_info, repair_flag
      ) VALUES (
        @mainDeviceType, @mainDeviceName, @mainDeviceCode,
        @phaseType, @threePhaseFlag, @threePhaseAssociateId, @entityId,
        @alarmLevel,
        @bayId, @bayType, @bayName, @bayCode,
        @voltId, @voltName, @voltCode,
        @stationId, @stationName, @stationCode,
        @sortNum, @createTime, @createBy, @updateTime, @updateBy,
        @deviceModel, @deviceSource, @manufacturer, @productionCode,
        @useCompany, @productionDate, @commissioningDate, @remarkInfo, @repairFlag
      )
    `);
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, dto: UpdateDeviceMainDTO): void {
    const fields: string[] = [];
    const params: Record<string, any> = { id };
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        fields.push(`${toSnake(key)} = @${key}`);
        params[key] = value;
      }
    }
    if (fields.length === 0) return;
    fields.push("update_time = @_now");
    params["_now"] = new Date().toISOString();
    this.db.prepare(`UPDATE device_main SET ${fields.join(", ")} WHERE id = @id`).run(params);
  }


  findByMainDeviceNameAndBayId(mainDeviceName: string, bayId: number): DeviceMain | undefined {
    return this.db.prepare("SELECT * FROM device_main WHERE main_device_name = ? AND bay_id = ?").get(mainDeviceName, bayId) as DeviceMain | undefined;
  }

  upsert(dto: CreateDeviceMainDTO & { mainDeviceName: string; bayId: number }): DeviceMain {
    const existing = this.findByMainDeviceNameAndBayId(dto.mainDeviceName, dto.bayId);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM device_main WHERE id = ?").run(id);
  }
}

