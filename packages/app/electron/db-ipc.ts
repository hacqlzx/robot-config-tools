import { registerProjectActivityHandler } from "./project-core/project-activity";
import {
  getDatabase,
  DeviceVoltageRepo,
  DeviceBayRepo,
  DeviceMainRepo,
  DeviceComponentRepo,
  DevicePointRepo,
} from "@robot/database";
import type { PointExcelRow, ImportResult } from "@robot/database";
import {
  closeAllProjectDatabases,
  withProjectDatabaseSession,
  type ProjectDatabaseSession,
} from "./project-core/project-database";
import { migrateLegacyProjectDatabases, type ProjectDatabaseMigrationOptions } from "./project-core/project-database-migration";

// ---- repo IPC helpers ----

function assertProjectArguments(method: string, args: any[], projectName: string, indices: number[]): void {
  for (const index of indices) {
    const value = args[index];
    if (typeof value === "string" && value && value !== projectName) {
      throw new Error(`数据库请求项目不匹配：${value} / ${projectName}`);
    }
  }
  for (const value of args) {
    if (value && typeof value === "object" && typeof value.projectName === "string" && value.projectName !== projectName) {
      throw new Error(`数据库请求项目不匹配：${value.projectName} / ${projectName}`);
    }
  }
  void method;
}

function registerRepoHandlers(def: { name: string; Repo: new (db: any) => any; methods: string[]; projectNameArgs?: Record<string, number[]> }): void {
  for (const method of def.methods) {
    const channel = `db:${def.name}:${method}`;
    registerProjectActivityHandler(channel, async (_event, session: ProjectDatabaseSession, ...args: any[]) => {
      try {
        const result = await withProjectDatabaseSession(session?.projectName, Number(session?.sessionVersion), () => {
          assertProjectArguments(method, args, session.projectName, def.projectNameArgs?.[method] || []);
          const repo = new def.Repo(getDatabase());
          return repo[method](...args);
        });
        return { ok: true, data: result ?? null };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });
  }
}

// ---- import helpers ----

function registerImportHandler(): void {
  registerProjectActivityHandler(
    "db:importPoints",
    async (_event, session: ProjectDatabaseSession, rows: PointExcelRow[], stationName: string, stationCode: string, projectName: string) => {
      try {
        if (!session || session.projectName !== projectName) throw new Error("项目数据库会话已切换，请重试导入");
        const { importPointExcel } = await import("@robot/database");
        const result: ImportResult = await withProjectDatabaseSession(session.projectName, session.sessionVersion, (db) => db.batchMode(() => (
          importPointExcel(db, rows, stationName, stationCode, projectName)
        ), "point-import"));
        return { ok: true, data: result };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    },
  );
}

interface CabinetDeviceSaveRow {
  key?: string;
  code: string;
  name: string;
}

interface CabinetDeviceSavePayload {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  rows: CabinetDeviceSaveRow[];
}

interface CabinetDeviceDeletePayload {
  devices?: { code?: string; name?: string }[];
}

interface CabinetDeviceRenameRow {
  code: string;
  name: string;
}

const MAIN_DEVICE_TYPE_CABINET = 29;

function registerCabinetDeviceHandler(): void {
  registerProjectActivityHandler("db:saveCabinetMainDevices", async (_event, session: ProjectDatabaseSession, projectName: string, payload: CabinetDeviceSavePayload) => {
    try {
      if (!session || session.projectName !== projectName) throw new Error("项目数据库会话已切换，请重试保存");
      return await withProjectDatabaseSession(session.projectName, session.sessionVersion, async (db) => {
        const bayRepo = new DeviceBayRepo(db);
        const mainRepo = new DeviceMainRepo(db);

        const rows = (payload?.rows || []).map((row) => ({
          ...row,
          code: String(row.code ?? "").trim(),
          name: String(row.name ?? "").trim(),
        }));
        if (!projectName) throw new Error("项目名称为空，无法保存屏柜设备");
        if (rows.length === 0) throw new Error("请先完成屏柜绘制");
        if (rows.some((row) => !row.name)) throw new Error("屏柜名称不能为空");
        if (rows.some((row) => !row.code)) throw new Error("屏柜编码不能为空");

        const duplicateName = rows.find((row, index) => rows.findIndex((item) => item.name === row.name) !== index);
        if (duplicateName) throw new Error(`屏柜名称重复：${duplicateName.name}`);
        const duplicateCode = rows.find((row, index) => rows.findIndex((item) => item.code === row.code) !== index);
        if (duplicateCode) throw new Error(`屏柜编码重复：${duplicateCode.code}`);

        const bayRecord = bayRepo.getById(Number(payload?.bay?.id));
        if (!bayRecord) throw new Error("所选间隔不存在，无法保存屏柜设备");

        const existingMains = mainRepo.list(projectName);
        const beforeProjectCount = existingMains.length;
        const existingByBay = existingMains.filter((item: any) => item.bayId === bayRecord.id);
        const beforeBayCount = existingByBay.length;
        const existingByCode = existingMains.filter((item: any) =>
          rows.some((row) => row.code === item.mainDeviceCode),
        );

        console.log("[DB][屏柜保存] 保存前主设备数量", {
          projectName,
          bayId: bayRecord.id,
          bayName: bayRecord.bayName,
          devices: rows.map((row) => ({ code: row.code, name: row.name })),
          projectMainDeviceCount: beforeProjectCount,
          bayMainDeviceCount: beforeBayCount,
      });

      let inserted = 0;
      let updated = 0;
      const savedIds: number[] = [];
      db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const existing = existingByCode.find((item: any) => item.mainDeviceCode === row.code);

          const dto = {
            mainDeviceType: MAIN_DEVICE_TYPE_CABINET,
            mainDeviceName: row.name,
            mainDeviceCode: row.code,
            phaseType: 0,
            threePhaseFlag: 0,
            threePhaseAssociateId: "",
            entityId: "",
            alarmLevel: 0,
            bayId: bayRecord.id,
            bayType: bayRecord.bayType || "屏柜区",
            bayName: bayRecord.bayName || payload.bay.name,
            bayCode: bayRecord.bayCode || payload.bay.code,
            voltId: bayRecord.voltId || payload.area.id,
            voltName: bayRecord.voltName || payload.area.name,
            voltCode: bayRecord.voltCode || payload.area.code,
            stationId: bayRecord.stationId || 0,
            stationName: bayRecord.stationName || "",
            stationCode: bayRecord.stationCode || "",
            sortNum: existing?.sortNum ?? (existingByBay.length + i + 1),
            projectName,
            createBy: "space-edit",
            updateBy: "space-edit",
            deviceModel: "",
            deviceSource: "",
            manufacturer: "",
            productionCode: "",
            useCompany: "",
            productionDate: "",
            commissioningDate: "",
            remarkInfo: "",
            repairFlag: 0,
          };

          if (existing) {
            if (Number(existing.mainDeviceType) !== MAIN_DEVICE_TYPE_CABINET) {
              throw new Error(`编码 ${row.code} 已被其他主设备使用`);
            }
            mainRepo.update(existing.id, dto);
            if (existing.mainDeviceName !== row.name) {
              const now = new Date().toISOString();
              db.prepare("UPDATE device_component SET main_device_name = ?, update_time = ? WHERE main_device_id = ? AND project_name = ?")
                .run(row.name, now, existing.id, projectName);
              db.prepare("UPDATE device_point SET main_device_name = ?, update_time = ? WHERE main_device_id = ? AND project_name = ?")
                .run(row.name, now, existing.id, projectName);
            }
            updated += 1;
            savedIds.push(existing.id);
          } else {
            const created = mainRepo.create(dto);
            inserted += 1;
            savedIds.push(created.id);
          }
        }
      })();

      db.saveToDisk("cabinet-main-save");
      const afterMains = mainRepo.list(projectName);
      const afterProjectCount = afterMains.length;
      const afterBayCount = afterMains.filter((item: any) => item.bayId === bayRecord.id).length;
      console.log("[DB][屏柜保存] 保存后主设备数量", {
        projectName,
        bayId: bayRecord.id,
        bayName: bayRecord.bayName,
        beforeProjectCount,
        afterProjectCount,
        projectDelta: afterProjectCount - beforeProjectCount,
        beforeBayCount,
        afterBayCount,
        bayDelta: afterBayCount - beforeBayCount,
        inserted,
        updated,
        ids: savedIds,
      });
      return { ok: true, data: { inserted, updated, total: rows.length, ids: savedIds } };
      });
    } catch (e: any) {
      console.error("[DB][屏柜保存] 保存失败", {
        projectName,
        payload,
        error: e?.message || e,
      });
      return { ok: false, error: e.message };
    }
  });

  registerProjectActivityHandler("db:renameCabinetMainDevices", async (_event, session: ProjectDatabaseSession, projectName: string, rows: CabinetDeviceRenameRow[]) => {
    try {
      if (!session || session.projectName !== projectName) throw new Error("项目数据库会话已切换，请重试重命名");
      return await withProjectDatabaseSession(session.projectName, session.sessionVersion, async (db) => {
        if (!projectName || !Array.isArray(rows) || rows.length === 0) throw new Error("屏柜改名参数无效");
        const normalized = rows.map((row) => ({ code: String(row.code ?? "").trim(), name: String(row.name ?? "").trim() }));
        if (normalized.some((row) => !row.code || !row.name)) throw new Error("屏柜名称和编码不能为空");
        if (new Set(normalized.map((row) => row.code)).size !== normalized.length) throw new Error("屏柜编码不能重复");
        const mainRepo = new DeviceMainRepo(db);
        db.transaction(() => {
          const mains = mainRepo.list(projectName);
          const codes = new Set(normalized.map((row) => row.code));
          const now = new Date().toISOString();
          for (const row of normalized) {
            const main = mains.find((record) => record.mainDeviceCode === row.code && Number(record.mainDeviceType) === MAIN_DEVICE_TYPE_CABINET);
            if (!main) throw new Error(`本地点表中未找到屏柜编码 ${row.code}`);
            if (mains.some((record) => record.bayId === main.bayId && record.mainDeviceName === row.name && !codes.has(record.mainDeviceCode))) {
              throw new Error(`当前间隔已存在同名主设备：${row.name}`);
            }
            mainRepo.update(main.id, { mainDeviceName: row.name, updateBy: "space-edit" });
            db.prepare("UPDATE device_component SET main_device_name = ?, update_time = ? WHERE main_device_id = ? AND project_name = ?")
              .run(row.name, now, main.id, projectName);
            db.prepare("UPDATE device_point SET main_device_name = ?, update_time = ? WHERE main_device_id = ? AND project_name = ?")
              .run(row.name, now, main.id, projectName);
          }
        })();
        db.saveToDisk("cabinet-main-rename");
        return { ok: true, data: { updated: normalized.length } };
      });
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  registerProjectActivityHandler("db:deleteCabinetMainDevices", async (_event, session: ProjectDatabaseSession, projectName: string, payload: CabinetDeviceDeletePayload) => {
    try {
      if (!session || session.projectName !== projectName) throw new Error("项目数据库会话已切换，请重试删除");
      return await withProjectDatabaseSession(session.projectName, session.sessionVersion, async (db) => {
        const mainRepo = new DeviceMainRepo(db);
        const devices = (payload?.devices || [])
          .map((device) => ({
            code: String(device.code ?? "").trim(),
            name: String(device.name ?? "").trim(),
          }))
          .filter((device) => device.code || device.name);

        if (!projectName) throw new Error("项目名称为空，无法删除屏柜设备");
        if (devices.length === 0) {
          console.warn("[DB][屏柜删除] 没有收到待删除屏柜/柜排设备", { projectName, payload });
          return { ok: true, data: { deleted: 0, ids: [], unmatched: [], beforeProjectCount: 0, afterProjectCount: 0 } };
        }

        const beforeMains = mainRepo.list(projectName);
        const beforeProjectCount = beforeMains.length;
        const matched = new Map<number, any>();
        const unmatched: { code: string; name: string; reason: string }[] = [];

        console.log("[DB][屏柜删除] 删除前主设备数量", {
          projectName,
          devices,
          projectMainDeviceCount: beforeProjectCount,
      });

      for (const device of devices) {
        let main: any | null = null;
        if (device.code) {
          main = beforeMains.find((item: any) =>
            item.mainDeviceType === MAIN_DEVICE_TYPE_CABINET
            && item.mainDeviceCode === device.code,
          ) ?? null;
        }
        if (!main && device.name) {
          const sameName = beforeMains.filter((item: any) =>
            item.mainDeviceType === MAIN_DEVICE_TYPE_CABINET
            && item.mainDeviceName === device.name,
          );
          if (sameName.length === 1) {
            main = sameName[0];
          } else if (sameName.length > 1) {
            unmatched.push({ ...device, reason: "同名屏柜/柜排不唯一，未按名称兜底删除" });
            continue;
          }
        }
        if (!main) {
          unmatched.push({ ...device, reason: "未匹配到主设备" });
          continue;
        }
        matched.set(main.id, main);
      }

      const ids = Array.from(matched.keys());
      db.transaction(() => {
        for (const id of ids) {
          mainRepo.deleteCascade(id, projectName);
        }
      })();
      db.saveToDisk("cabinet-main-delete");

      const afterMains = mainRepo.list(projectName);
      const afterProjectCount = afterMains.length;
      console.log("[DB][屏柜删除] 删除后主设备数量", {
        projectName,
        beforeProjectCount,
        afterProjectCount,
        projectDelta: afterProjectCount - beforeProjectCount,
        deleted: ids.length,
        ids,
        matched: Array.from(matched.values()).map((item: any) => ({
          id: item.id,
          code: item.mainDeviceCode,
          name: item.mainDeviceName,
          bayId: item.bayId,
        })),
        unmatched,
      });

      return { ok: true, data: { deleted: ids.length, ids, unmatched, beforeProjectCount, afterProjectCount } };
      });
    } catch (e: any) {
      console.error("[DB][屏柜删除] 删除失败", {
        projectName,
        payload,
        error: e?.message || e,
      });
      return { ok: false, error: e.message };
    }
  });
}

// ---- init / close ----

export interface ProjectDatabaseMigrationStatus {
  failed: boolean;
  error?: string;
}

let projectDatabaseMigrationStatus: ProjectDatabaseMigrationStatus = { failed: false };

export function getProjectDatabaseMigrationStatus(): ProjectDatabaseMigrationStatus {
  return { ...projectDatabaseMigrationStatus };
}

export async function initDbIpc(migrationOptions: ProjectDatabaseMigrationOptions): Promise<void> {
  projectDatabaseMigrationStatus = { failed: false };
  try {
    await migrateLegacyProjectDatabases(migrationOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    projectDatabaseMigrationStatus = { failed: true, error: message };
    console.error("[DB migration] 项目数据库拆分失败，继续打开项目初始化", error);
  }
  const repos = [
    { name: "voltage", Repo: DeviceVoltageRepo, methods: ["list", "getById", "findByStationId", "create", "update", "delete"], projectNameArgs: { list: [0], findByStationId: [1] } },
    { name: "bay", Repo: DeviceBayRepo, methods: ["list", "getById", "findByVoltId", "findByStationId", "create", "update", "delete"], projectNameArgs: { list: [0], findByVoltId: [1], findByStationId: [1] } },
    { name: "mainDevice", Repo: DeviceMainRepo, methods: ["list", "getById", "findByBayId", "findByStationId", "findByMainDeviceNameAndBayId", "findByMainDeviceCode", "create", "update", "delete", "deleteCascade"], projectNameArgs: { list: [0], findByBayId: [1], findByStationId: [1], findByMainDeviceNameAndBayId: [2], findByMainDeviceCode: [1], deleteCascade: [1] } },
    { name: "component", Repo: DeviceComponentRepo, methods: ["list", "getById", "findByMainDeviceId", "findByStationId", "create", "update", "delete"], projectNameArgs: { list: [0], findByMainDeviceId: [1], findByStationId: [1] } },
    { name: "point", Repo: DevicePointRepo, methods: ["list", "getById", "findByPointCode", "findByCalibrationId", "bindCalibrationId", "bindCalibrationIds", "clearCalibrationId", "clearCalibrationIds", "findByStationId", "findByComponentId", "paginate", "create", "update", "delete"], projectNameArgs: { list: [0], findByPointCode: [1], findByCalibrationId: [1], bindCalibrationId: [1], bindCalibrationIds: [1], clearCalibrationId: [1], clearCalibrationIds: [1], findByStationId: [1], findByComponentId: [1], paginate: [3] } },
  ];

  for (const def of repos) {
    registerRepoHandlers(def);
  }
  registerImportHandler();
  registerCabinetDeviceHandler();

  console.log("[DB] IPC handlers registered");
}

export function closeDbIpc(): Promise<void> {
  return closeAllProjectDatabases();
}
