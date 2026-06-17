import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceComponent, CreateDeviceComponentDTO, UpdateDeviceComponentDTO } from "../types";

export class DeviceComponentRepo {
  constructor(private db: DbWrapper) {}

  list(): DeviceComponent[] {
    return this.db.prepare("SELECT * FROM device_component ORDER BY sort_num").all() as DeviceComponent[];
  }

  getById(id: number): DeviceComponent | undefined {
    return this.db.prepare("SELECT * FROM device_component WHERE id = ?").get(id) as DeviceComponent | undefined;
  }

  findByMainDeviceId(mainDeviceId: number): DeviceComponent[] {
    return this.db.prepare("SELECT * FROM device_component WHERE main_device_id = ? ORDER BY sort_num").all(mainDeviceId) as DeviceComponent[];
  }

  findByStationId(stationId: number): DeviceComponent[] {
    return this.db.prepare("SELECT * FROM device_component WHERE station_id = ? ORDER BY sort_num").all(stationId) as DeviceComponent[];
  }

  create(dto: CreateDeviceComponentDTO): DeviceComponent {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO device_component (
        component_name, component_type, component_code, alarm_level,
        main_device_id, main_device_type, main_device_name, main_device_code,
        phase_type,
        bay_id, bay_type, bay_name, bay_code,
        volt_id, volt_name, volt_code,
        station_id, station_name, station_code,
        sort_num, create_time, create_by, update_time, update_by, repair_flag
      ) VALUES (
        @componentName, @componentType, @componentCode, @alarmLevel,
        @mainDeviceId, @mainDeviceType, @mainDeviceName, @mainDeviceCode,
        @phaseType,
        @bayId, @bayType, @bayName, @bayCode,
        @voltId, @voltName, @voltCode,
        @stationId, @stationName, @stationCode,
        @sortNum, @createTime, @createBy, @updateTime, @updateBy, @repairFlag
      )
    `);
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, dto: UpdateDeviceComponentDTO): void {
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
    this.db.prepare(`UPDATE device_component SET ${fields.join(", ")} WHERE id = @id`).run(params);
  }


  findByComponentNameAndMainDeviceId(componentName: string, mainDeviceId: number): DeviceComponent | undefined {
    return this.db.prepare("SELECT * FROM device_component WHERE component_name = ? AND main_device_id = ?").get(componentName, mainDeviceId) as DeviceComponent | undefined;
  }

  upsert(dto: CreateDeviceComponentDTO & { componentName: string; mainDeviceId: number }): DeviceComponent {
    const existing = this.findByComponentNameAndMainDeviceId(dto.componentName, dto.mainDeviceId);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM device_component WHERE id = ?").run(id);
  }
}

