import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceMain, CreateDeviceMainDTO, UpdateDeviceMainDTO } from "../types";

const COLUMNS = [
  "main_device_type", "main_device_name", "main_device_code",
  "phase_type", "three_phase_flag", "three_phase_associate_id", "entity_id",
  "alarm_level",
  "bay_id", "bay_type", "bay_name", "bay_code",
  "volt_id", "volt_name", "volt_code",
  "station_id", "station_name", "station_code",
  "sort_num", "create_time", "create_by", "update_time", "update_by",
  "device_model", "device_source", "manufacturer", "production_code",
  "use_company", "production_date", "commissioning_date", "remark_info", "repair_flag",
] as const;

function toRow(dto: CreateDeviceMainDTO, now: string): any[] {
  return [
    dto.mainDeviceType, dto.mainDeviceName, dto.mainDeviceCode,
    dto.phaseType, dto.threePhaseFlag, dto.threePhaseAssociateId, dto.entityId,
    dto.alarmLevel,
    dto.bayId, dto.bayType, dto.bayName, dto.bayCode,
    dto.voltId, dto.voltName, dto.voltCode,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.sortNum, now, dto.createBy, now, dto.updateBy,
    dto.deviceModel, dto.deviceSource, dto.manufacturer, dto.productionCode,
    dto.useCompany, dto.productionDate, dto.commissioningDate, dto.remarkInfo, dto.repairFlag,
  ];
}

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
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_main (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_main failed: changes=0, mainDeviceName="${dto.mainDeviceName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_main done but getById(${result.lastInsertRowid}) returned null, mainDeviceName="${dto.mainDeviceName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDeviceMainDTO): void {
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
    this.db.prepare(`UPDATE device_main SET ${fields.join(", ")} WHERE id = ?`).run(vals);
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
