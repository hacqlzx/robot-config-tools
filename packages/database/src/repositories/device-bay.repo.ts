import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceBay, CreateDeviceBayDTO, UpdateDeviceBayDTO } from "../types";

const COLUMNS = [
  "bay_type", "bay_name", "bay_code", "alarm_level",
  "volt_id", "volt_name", "volt_code",
  "station_id", "station_name", "station_code",
  "sort_num", "create_time", "create_by", "update_time", "update_by", "repair_flag",
] as const;

function toRow(dto: CreateDeviceBayDTO, now: string): any[] {
  return [
    dto.bayType, dto.bayName, dto.bayCode, dto.alarmLevel,
    dto.voltId, dto.voltName, dto.voltCode,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.sortNum, now, dto.createBy, now, dto.updateBy, dto.repairFlag,
  ];
}

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
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_bay (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_bay failed: changes=0, bayName="${dto.bayName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_bay done but getById(${result.lastInsertRowid}) returned null, bayName="${dto.bayName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDeviceBayDTO): void {
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
    this.db.prepare(`UPDATE device_bay SET ${fields.join(", ")} WHERE id = ?`).run(vals);
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
