import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { FacInfo, CreateFacInfoDTO, UpdateFacInfoDTO } from "../types";

export class FacInfoRepo {
  constructor(private db: DbWrapper) {}

  list(): FacInfo[] {
    return this.db.prepare("SELECT * FROM fac_info ORDER BY sort_num").all() as FacInfo[];
  }

  getById(id: number): FacInfo | undefined {
    return this.db.prepare("SELECT * FROM fac_info WHERE id = ?").get(id) as FacInfo | undefined;
  }

  create(dto: CreateFacInfoDTO): FacInfo {
    const now = new Date().toISOString();
    const cols = "station_name, station_code, out_station_code, fac_type, station_type, province_name, city_name, area_name, create_by, create_time, update_by, update_time, volt_name, use_time, responsible_person, telephone, env_data_robot_id, current_fac, alarm_level, sort_num";
    const vals = "@stationName, @stationCode, @outStationCode, @facType, @stationType, @provinceName, @cityName, @areaName, @createBy, @createTime, @updateBy, @updateTime, @voltName, @useTime, @responsiblePerson, @telephone, @envDataRobotId, @currentFac, @alarmLevel, @sortNum";
    const stmt = this.db.prepare("INSERT INTO fac_info (" + cols + ") VALUES (" + vals + ")");
    const result = stmt.run({ ...dto, createTime: now, updateTime: now });
    if (result.changes === 0) {
      throw new Error("INSERT fac_info failed: changes=0, lastInsertRowid=" + result.lastInsertRowid);
    }
    const inserted = this.getById(Number(result.lastInsertRowid));
    if (!inserted) {
      throw new Error("INSERT fac_info succeeded but getById returned undefined, lastInsertRowid=" + result.lastInsertRowid);
    }
    return inserted;
  }

  update(id: number, dto: UpdateFacInfoDTO): void {
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
    this.db.prepare("UPDATE fac_info SET " + fields.join(", ") + " WHERE id = @id").run(params);
  }


  findByStationCode(code: string): FacInfo | undefined {
    return this.db.prepare("SELECT * FROM fac_info WHERE station_code = ?").get(code) as FacInfo | undefined;
  }

  findByStationName(name: string): FacInfo | undefined {
    return this.db.prepare("SELECT * FROM fac_info WHERE station_name = ?").get(name) as FacInfo | undefined;
  }

  upsert(dto: CreateFacInfoDTO & { stationName: string }): FacInfo {
    const existing = this.findByStationName(dto.stationName);
    if (existing) {
      this.update(existing.id, dto);
      return this.getById(existing.id)!;
    }
    return this.create(dto);
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM fac_info WHERE id = ?").run(id);
  }
}
