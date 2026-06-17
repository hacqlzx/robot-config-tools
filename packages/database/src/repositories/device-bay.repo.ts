import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceBay, CreateDeviceBayDTO, UpdateDeviceBayDTO } from "../types";

export class DeviceBayRepo {
  constructor(private db: DbWrapper) {}

  list(): DeviceBay[] {
    return this.db.prepare("SELECT * FROM device_bay ORDER BY sort_num").all() as DeviceBay[];
  }

  getById(id: number): DeviceBay | undefined {
    return this.db.prepare("SELECT * FROM device_bay WHERE id = ?").get(id) as DeviceBay | undefined;
  }

  findByVoltId(voltId: number): DeviceBay[] {
    return this.db.prepare("SELECT * FROM device_bay WHERE volt_id = ? ORDER BY sort_num").all(voltId) as DeviceBay[];
  }

  findByStationId(stationId: number): DeviceBay[] {
    return this.db.prepare("SELECT * FROM device_bay WHERE station_id = ? ORDER BY sort_num").all(stationId) as DeviceBay[];
  }

  create(dto: CreateDeviceBayDTO): DeviceBay {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO device_bay (
        bay_type, bay_name, bay_code, alarm_level,
        volt_id, volt_name, volt_code,
        station_id, station_name, station_code,
        sort_num, create_time, create_by, update_time, update_by, repair_flag
      ) VALUES (
        @bayType, @bayName, @bayCode, @alarmLevel,
        @voltId, @voltName, @voltCode,
        @stationId, @stationName, @stationCode,
        @sortNum, @createTime, @createBy, @updateTime, @updateBy, @repairFlag
      )
    `);
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    return this.getById(Number(result.lastInsertRowid))!;
  }

  update(id: number, dto: UpdateDeviceBayDTO): void {
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
    this.db.prepare(`UPDATE device_bay SET ${fields.join(", ")} WHERE id = @id`).run(params);
  }


  findByBayNameAndVoltId(bayName: string, voltId: number): DeviceBay | undefined {
    return this.db.prepare("SELECT * FROM device_bay WHERE bay_name = ? AND volt_id = ?").get(bayName, voltId) as DeviceBay | undefined;
  }

  upsert(dto: CreateDeviceBayDTO & { bayName: string; voltId: number }): DeviceBay {
    const existing = this.findByBayNameAndVoltId(dto.bayName, dto.voltId);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM device_bay WHERE id = ?").run(id);
  }
}

