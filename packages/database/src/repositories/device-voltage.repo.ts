import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceVoltage, CreateDeviceVoltageDTO, UpdateDeviceVoltageDTO } from "../types";

const COLUMNS = [
  "volt_name", "volt_code", "alarm_level",
  "station_id", "station_name", "station_code",
  "sort_num", "create_time", "create_by", "update_time", "update_by",
] as const;

function toRow(dto: CreateDeviceVoltageDTO, now: string): any[] {
  return [
    dto.voltName, dto.voltCode, dto.alarmLevel,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.sortNum, now, dto.createBy, now, dto.updateBy,
  ];
}

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
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_voltage (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_voltage failed: changes=0, voltName="${dto.voltName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_voltage done but getById(${result.lastInsertRowid}) returned null, voltName="${dto.voltName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDeviceVoltageDTO): void {
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
    this.db.prepare(`UPDATE device_voltage SET ${fields.join(", ")} WHERE id = ?`).run(vals);
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
