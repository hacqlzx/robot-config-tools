import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DeviceComponent, CreateDeviceComponentDTO, UpdateDeviceComponentDTO } from "../types";

const COLUMNS = [
  "component_name", "component_type", "component_code", "alarm_level",
  "main_device_id", "main_device_type", "main_device_name", "main_device_code",
  "phase_type",
  "bay_id", "bay_type", "bay_name", "bay_code",
  "volt_id", "volt_name", "volt_code",
  "station_id", "station_name", "station_code",
  "sort_num", "project_name",
  "create_time", "create_by", "update_time", "update_by", "repair_flag",
] as const;

function toRow(dto: CreateDeviceComponentDTO, now: string): any[] {
  return [
    dto.componentName, dto.componentType, dto.componentCode, dto.alarmLevel,
    dto.mainDeviceId, dto.mainDeviceType, dto.mainDeviceName, dto.mainDeviceCode,
    dto.phaseType,
    dto.bayId, dto.bayType, dto.bayName, dto.bayCode,
    dto.voltId, dto.voltName, dto.voltCode,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.sortNum, dto.projectName,
    now, dto.createBy, now, dto.updateBy, dto.repairFlag,
  ];
}

export class DeviceComponentRepo {
  constructor(private db: DbWrapper) {}

  list(projectName?: string): DeviceComponent[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_component WHERE project_name = ? ORDER BY sort_num").all(projectName) as DeviceComponent[];
    }
    return this.db.prepare("SELECT * FROM device_component ORDER BY sort_num").all() as DeviceComponent[];
  }

  getById(id: number): DeviceComponent | undefined {
    return this.db.prepare("SELECT * FROM device_component WHERE id = ?").get(id) as DeviceComponent | undefined;
  }

  findByMainDeviceId(mainDeviceId: number, projectName?: string): DeviceComponent[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_component WHERE main_device_id = ? AND project_name = ? ORDER BY sort_num").all(mainDeviceId, projectName) as DeviceComponent[];
    }
    return this.db.prepare("SELECT * FROM device_component WHERE main_device_id = ? ORDER BY sort_num").all(mainDeviceId) as DeviceComponent[];
  }

  findByStationId(stationId: number, projectName?: string): DeviceComponent[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_component WHERE station_id = ? AND project_name = ? ORDER BY sort_num").all(stationId, projectName) as DeviceComponent[];
    }
    return this.db.prepare("SELECT * FROM device_component WHERE station_id = ? ORDER BY sort_num").all(stationId) as DeviceComponent[];
  }

  create(dto: CreateDeviceComponentDTO): DeviceComponent {
    const now = new Date().toISOString();
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_component (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_component failed: changes=0, componentName="${dto.componentName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_component done but getById(${result.lastInsertRowid}) returned null, componentName="${dto.componentName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDeviceComponentDTO): void {
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
    this.db.prepare(`UPDATE device_component SET ${fields.join(", ")} WHERE id = ?`).run(vals);
  }

  findByComponentNameAndMainDeviceId(componentName: string, mainDeviceId: number, projectName: string): DeviceComponent | undefined {
    return this.db.prepare("SELECT * FROM device_component WHERE component_name = ? AND main_device_id = ? AND project_name = ?").get(componentName, mainDeviceId, projectName) as DeviceComponent | undefined;
  }

  findByComponentCode(componentCode: string, projectName: string): DeviceComponent | undefined {
    return this.db.prepare("SELECT * FROM device_component WHERE component_code = ? AND project_name = ?").get(componentCode, projectName) as DeviceComponent | undefined;
  }

  upsert(dto: CreateDeviceComponentDTO & { componentName: string; componentCode: string; mainDeviceId: number; projectName: string }): DeviceComponent {
    let existing: DeviceComponent | undefined;
    if (dto.componentCode) {
      existing = this.findByComponentCode(dto.componentCode, dto.projectName);
    }
    if (!existing) {
      existing = this.findByComponentNameAndMainDeviceId(dto.componentName, dto.mainDeviceId, dto.projectName);
    }
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
