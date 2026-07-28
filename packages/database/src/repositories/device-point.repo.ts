import type { DbWrapper } from "../core/connection";
import { toSnake } from "../core/utils";
import { DevicePoint, CreateDevicePointDTO, UpdateDevicePointDTO } from "../types";

const MAX_CALIBRATION_ID = 999_999_999;
const CALIBRATION_ID_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export interface CalibrationIdBinding {
  pointCode: string;
  calibrationId: string;
}

const COLUMNS = [
  "point_name", "point_code", "recognition_type_list",
  "save_type_list", "meter_type", "position_state_type", "appearance_type",
  "defect_rec_type", "point_tags_code_list", "defect_judge_type",
  "important_level", "sort_num",
  "three_phase_flag", "three_phase_associate_id",
  "demarcate_state", "robot_id", "robot_name", "cruise_id",
  "origin_calibration_path", "extend_calibration_path", "visible_calibration_path",
  "latest_collect_path", "thermal_region", "calibration_id",
  "component_id", "component_type", "component_name", "component_code",
  "main_device_id", "main_device_type", "main_device_name", "main_device_code",
  "phase_type",
  "bay_id", "bay_type", "bay_name", "bay_code",
  "volt_id", "volt_name", "volt_code",
  "station_id", "station_name", "station_code",
  "inspection_sub_type", "project_name",
  "create_time", "create_by", "update_time", "update_by",
  "alarm_level", "map_code", "repair_flag", "device_info", "remark",
] as const;

function toRow(dto: CreateDevicePointDTO, now: string): any[] {
  return [
    dto.pointName, dto.pointCode, dto.recognitionTypeList,
    dto.saveTypeList, dto.meterType, dto.positionStateType, dto.appearanceType,
    dto.defectRecType, dto.pointTagsCodeList, dto.defectJudgeType,
    dto.importantLevel, dto.sortNum,
    dto.threePhaseFlag, dto.threePhaseAssociateId,
    dto.demarcateState, dto.robotId, dto.robotName, dto.cruiseId,
    dto.originCalibrationPath, dto.extendCalibrationPath, dto.visibleCalibrationPath,
    dto.latestCollectPath, dto.thermalRegion, dto.calibrationId,
    dto.componentId, dto.componentType, dto.componentName, dto.componentCode,
    dto.mainDeviceId, dto.mainDeviceType, dto.mainDeviceName, dto.mainDeviceCode,
    dto.phaseType,
    dto.bayId, dto.bayType, dto.bayName, dto.bayCode,
    dto.voltId, dto.voltName, dto.voltCode,
    dto.stationId, dto.stationName, dto.stationCode,
    dto.inspectionSubType, dto.projectName,
    now, dto.createBy, now, dto.updateBy,
    dto.alarmLevel, dto.mapCode, dto.repairFlag, dto.deviceInfo, dto.remark,
  ];
}

function textValue(value: unknown): string {
  return String(value ?? "").trim();
}

function isValidCalibrationId(value: string): boolean {
  return /^[1-9]\d{0,8}$/.test(value) && Number(value) <= MAX_CALIBRATION_ID;
}

function normalizeNextId(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > MAX_CALIBRATION_ID) return 1;
  return Math.floor(numeric);
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createTimeBasedCalibrationSeed(pointCode: string, projectName: string): number {
  const elapsedSeconds = Math.floor((Date.now() - CALIBRATION_ID_EPOCH_MS) / 1000);
  if (elapsedSeconds > MAX_CALIBRATION_ID) {
    throw new Error("无法生成 9 位标定 ID：时间种子超出支持范围");
  }
  const timeSeed = Math.max(1, elapsedSeconds);
  const jitter = hashText(`${projectName}|${pointCode}|${Date.now()}|${Math.random()}`) % 1000;
  return Math.min(MAX_CALIBRATION_ID, timeSeed + jitter);
}

export class DevicePointRepo {
  constructor(private db: DbWrapper) {}

  list(projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE project_name = ? ORDER BY sort_num").all(projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point ORDER BY sort_num").all() as DevicePoint[];
  }

  getById(id: number): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE id = ?").get(id) as DevicePoint | undefined;
  }

  findByPointCode(pointCode: string, projectName?: string): DevicePoint | undefined {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE point_code = ? AND project_name = ?").get(pointCode, projectName) as DevicePoint | undefined;
    }
    return this.db.prepare("SELECT * FROM device_point WHERE point_code = ?").get(pointCode) as DevicePoint | undefined;
  }

  findByPath(
    projectName: string,
    voltName: string,
    bayName: string,
    mainDeviceName: string,
    componentName: string,
    pointName: string,
  ): DevicePoint | undefined {
    return this.db
      .prepare(
        `SELECT * FROM device_point
         WHERE project_name = ?
           AND volt_name = ?
           AND bay_name = ?
           AND main_device_name = ?
           AND component_name = ?
           AND point_name = ?
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(projectName, voltName, bayName, mainDeviceName, componentName, pointName) as DevicePoint | undefined;
  }

  findByCalibrationId(calibrationId: string, projectName?: string): DevicePoint | undefined {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE calibration_id = ? AND project_name = ?").get(calibrationId, projectName) as DevicePoint | undefined;
    }
    return this.db.prepare("SELECT * FROM device_point WHERE calibration_id = ?").get(calibrationId) as DevicePoint | undefined;
  }

  bindCalibrationId(pointCode: string, projectName: string): string {
    const normalizedPointCode = textValue(pointCode);
    if (!normalizedPointCode) throw new Error("点位编码不能为空");
    return this.bindCalibrationIds([normalizedPointCode], projectName)[0].calibrationId;
  }

  bindCalibrationIds(pointCodes: string[], projectName: string): CalibrationIdBinding[] {
    const normalizedProjectName = textValue(projectName);
    const uniquePointCodes = Array.from(new Set(pointCodes.map(textValue).filter(Boolean)));
    if (!normalizedProjectName) throw new Error("项目名称不能为空");
    if (uniquePointCodes.length === 0) return [];

    const assignedByPointCode = new Map<string, string>();
    this.db.batchMode(() => {
      const run = this.db.transaction(() => {
        const points = uniquePointCodes.map((pointCode) => {
          const point = this.findByPointCode(pointCode, normalizedProjectName);
          if (!point) throw new Error(`未找到点位：${pointCode}`);
          return point;
        });
        const usedIds = this.collectUsedCalibrationIds();
        const pendingPoints: DevicePoint[] = [];

        for (const point of points) {
          const currentId = textValue(point.calibrationId);
          if (isValidCalibrationId(currentId)) {
            assignedByPointCode.set(point.pointCode, currentId);
          } else {
            pendingPoints.push(point);
          }
        }

        if (pendingPoints.length === 0) return;
        const sequence = this.db.prepare("SELECT next_id FROM calibration_sequence WHERE id = 1").get() as { nextId: number } | undefined;
        if (!sequence) throw new Error("标定 ID 序列表未初始化");

        let nextId = normalizeNextId(sequence.nextId);
        for (const point of pendingPoints) {
          const startId = Math.max(nextId, createTimeBasedCalibrationSeed(point.pointCode, normalizedProjectName));
          const assignedId = this.allocateCalibrationId(startId, usedIds);
          usedIds.add(assignedId);
          nextId = assignedId + 1;
          const calibrationId = String(assignedId);
          this.update(point.id, { calibrationId });
          assignedByPointCode.set(point.pointCode, calibrationId);
        }
        this.db.prepare("UPDATE calibration_sequence SET next_id = ? WHERE id = 1").run(nextId);
      });
      run();
    }, "calibration-id-bind");

    return uniquePointCodes.map((pointCode) => ({
      pointCode,
      calibrationId: assignedByPointCode.get(pointCode) ?? "",
    }));
  }

  clearCalibrationId(pointCode: string, projectName: string): void {
    const normalizedPointCode = textValue(pointCode);
    if (!normalizedPointCode) throw new Error("点位编码不能为空");
    this.clearCalibrationIds([normalizedPointCode], projectName);
  }

  clearCalibrationIds(pointCodes: string[], projectName: string): number {
    const normalizedProjectName = textValue(projectName);
    const uniquePointCodes = Array.from(new Set(pointCodes.map(textValue).filter(Boolean)));
    if (!normalizedProjectName) throw new Error("项目名称不能为空");
    if (uniquePointCodes.length === 0) return 0;

    let cleared = 0;
    this.db.batchMode(() => {
      const run = this.db.transaction(() => {
        for (const pointCode of uniquePointCodes) {
          const point = this.findByPointCode(pointCode, normalizedProjectName);
          if (!point) throw new Error(`未找到点位：${pointCode}`);
          if (textValue(point.calibrationId)) {
            this.update(point.id, { calibrationId: "" });
            cleared += 1;
          }
        }
      });
      run();
    }, "calibration-id-clear");
    return cleared;
  }

  private collectUsedCalibrationIds(excludePointId?: number): Set<number> {
    const sql = `
      SELECT calibration_id AS calibrationId
      FROM device_point
      WHERE calibration_id IS NOT NULL
        AND calibration_id <> ''
        ${excludePointId === undefined ? "" : "AND id <> ?"}
    `;
    const rows = (
      excludePointId === undefined
        ? this.db.prepare(sql).all()
        : this.db.prepare(sql).all(excludePointId)
    ) as Array<{ calibrationId: string }>;
    const usedIds = new Set<number>();
    for (const row of rows) {
      const value = textValue(row.calibrationId);
      if (isValidCalibrationId(value)) usedIds.add(Number(value));
    }
    return usedIds;
  }

  private allocateCalibrationId(startId: number, usedIds: Set<number>): number {
    if (usedIds.size >= MAX_CALIBRATION_ID) {
      throw new Error("标定 ID 已耗尽");
    }
    const start = normalizeNextId(startId);
    for (let offset = 0; offset <= usedIds.size; offset++) {
      const candidate = ((start - 1 + offset) % MAX_CALIBRATION_ID) + 1;
      if (!usedIds.has(candidate)) return candidate;
    }
    throw new Error("无法生成唯一标定 ID");
  }

  listCruiseIds(): string[] {
    const rows = this.db.prepare(`
      SELECT cruise_id AS identifier
      FROM device_point
      WHERE cruise_id IS NOT NULL AND cruise_id <> ''
    `).all() as Array<{ identifier: string }>;
    return rows.map((row) => String(row.identifier));
  }

  findByStationId(stationId: number, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE station_id = ? AND project_name = ? ORDER BY sort_num").all(stationId, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num").all(stationId) as DevicePoint[];
  }

  findByComponentId(componentId: number, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE component_id = ? AND project_name = ? ORDER BY sort_num").all(componentId, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE component_id = ? ORDER BY sort_num").all(componentId) as DevicePoint[];
  }

  paginate(page: number, pageSize: number, stationId?: number, projectName?: string): { data: DevicePoint[]; total: number } {
    const offset = (page - 1) * pageSize;
    if (stationId !== undefined && projectName) {
      const total = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE station_id = ? AND project_name = ?").get(stationId, projectName) as { cnt: number }
      ).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE station_id = ? AND project_name = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(stationId, projectName, pageSize, offset) as DevicePoint[];
      return { data, total };
    }
    if (stationId !== undefined) {
      const total = (
        this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE station_id = ?").get(stationId) as { cnt: number }
      ).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE station_id = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(stationId, pageSize, offset) as DevicePoint[];
      return { data, total };
    }
    if (projectName) {
      const total = (this.db.prepare("SELECT COUNT(*) AS cnt FROM device_point WHERE project_name = ?").get(projectName) as { cnt: number }).cnt;
      const data = this.db
        .prepare("SELECT * FROM device_point WHERE project_name = ? ORDER BY sort_num LIMIT ? OFFSET ?")
        .all(projectName, pageSize, offset) as DevicePoint[];
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
    const placeholders = COLUMNS.map(() => "?").join(", ");
    const sql = `INSERT INTO device_point (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
    const result = this.db.prepare(sql).run(toRow(dto, now));
    if (result.changes === 0) {
      throw new Error(`INSERT device_point failed: changes=0, pointName="${dto.pointName}"`);
    }
    const row = this.getById(Number(result.lastInsertRowid));
    if (!row) {
      throw new Error(`INSERT device_point done but getById(${result.lastInsertRowid}) returned null, pointName="${dto.pointName}"`);
    }
    return row;
  }

  update(id: number, dto: UpdateDevicePointDTO): void {
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
    this.db.prepare(`UPDATE device_point SET ${fields.join(", ")} WHERE id = ?`).run(vals);
  }

  findByCruiseId(cruiseId: string, projectName: string): DevicePoint | undefined {
    return this.db.prepare("SELECT * FROM device_point WHERE cruise_id = ? AND project_name = ?").get(cruiseId, projectName) as DevicePoint | undefined;
  }

  findByPointName(pointName: string, projectName?: string): DevicePoint[] {
    if (projectName) {
      return this.db.prepare("SELECT * FROM device_point WHERE point_name = ? AND project_name = ?").all(pointName, projectName) as DevicePoint[];
    }
    return this.db.prepare("SELECT * FROM device_point WHERE point_name = ?").all(pointName) as DevicePoint[];
  }

  upsert(dto: CreateDevicePointDTO & { pointCode: string; projectName: string }): DevicePoint {
    const existing = this.findByPointCode(dto.pointCode, dto.projectName);
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
