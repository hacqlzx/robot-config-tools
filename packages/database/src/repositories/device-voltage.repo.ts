import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceVoltage, CreateDeviceVoltageDTO, UpdateDeviceVoltageDTO } from "../types";

export class DeviceVoltageRepo {
  constructor(private db: DbWrapper) {}

  list(): DeviceVoltage[] {
    return this.db.prepare("SELECT * FROM device_voltage ORDER BY sort_num").all() as DeviceVoltage[];
  }

  getById(id: number): DeviceVoltage | undefined {
    return this.db.prepare("SELECT * FROM device_voltage WHERE id = ?").get(id) as DeviceVoltage | undefined;
  }

  findByStationId(stationId: number): DeviceVoltage[] {
    return this.db.prepare("SELECT * FROM device_voltage WHERE station_id = ? ORDER BY sort_num").all(stationId) as DeviceVoltage[];
  }

  create(dto: CreateDeviceVoltageDTO): DeviceVoltage {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO device_voltage (
        volt_name, volt_code, alarm_level,
        station_id, station_name, station_code,
        sort_num, create_time, create_by, update_time, update_by
      ) VALUES (
        @voltName, @voltCode, @alarmLevel,
        @stationId, @stationName, @stationCode,
        @sortNum, @createTime, @createBy, @updateTime, @updateBy
      )
    `);
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, dto: UpdateDeviceVoltageDTO): void {
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
    this.db.prepare(`UPDATE device_voltage SET ${fields.join(", ")} WHERE id = @id`).run(params);
  }


  findByVoltNameAndStationId(voltName: string, stationId: number): DeviceVoltage | undefined {
    return this.db.prepare("SELECT * FROM device_voltage WHERE volt_name = ? AND station_id = ?").get(voltName, stationId) as DeviceVoltage | undefined;
  }

  upsert(dto: CreateDeviceVoltageDTO & { voltName: string; stationId: number }): DeviceVoltage {
    const existing = this.findByVoltNameAndStationId(dto.voltName, dto.stationId);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM device_voltage WHERE id = ?").run(id);
  }
}

