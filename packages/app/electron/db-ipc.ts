import { ipcMain } from "electron";
import {
  initDatabase,
  closeDatabase,
  runMigrations,
  getDatabase,
  DeviceVoltageRepo,
  DeviceBayRepo,
  DeviceMainRepo,
  DeviceComponentRepo,
  DevicePointRepo,
  migration001Version,
  migration001Name,
  migration001Up,
  migration001Down,
  migration002Version,
  migration002Name,
  migration002Up,
  migration002Down,
  migration003Version,
  migration003Name,
  migration003Up,
  migration003Down,
  migration004Version,
  migration004Name,
  migration004Up,
  migration004Down,
  migration005Version,
  migration005Name,
  migration005Up,
  migration005Down,
  migration006Version,
  migration006Name,
  migration006Up,
  migration006Down,
  diagnosePointUniqueness,
} from "@robot/database";
import type { PointExcelRow, ImportResult } from "@robot/database";

// ---- repo IPC helpers ----

function registerRepoHandlers(def: { name: string; repo: any; methods: string[] }): void {
  for (const method of def.methods) {
    const channel = `db:${def.name}:${method}`;
    ipcMain.handle(channel, (_event, ...args: any[]) => {
      try {
        const result = (def.repo as any)[method](...args);
        return { ok: true, data: result ?? null };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });
  }
}

// ---- import helpers ----

function registerImportHandler(): void {
  ipcMain.handle(
    "db:importPoints",
    async (_event, rows: PointExcelRow[], stationName: string, stationCode: string, projectName: string) => {
      try {
        const { importPointExcel } = await import("@robot/database");
        const db = getDatabase();
        const result: ImportResult = db.batchMode(() => (
          importPointExcel(db, rows, stationName, stationCode, projectName)
        ), "point-import");
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

const MAIN_DEVICE_TYPE_CABINET = 29;

function registerCabinetDeviceHandler(): void {
  ipcMain.handle("db:saveCabinetMainDevices", async (_event, projectName: string, payload: CabinetDeviceSavePayload) => {
    try {
      const db = getDatabase();
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

      for (const row of rows) {
        const sameName = existingByBay.find((item: any) =>
          item.mainDeviceType === MAIN_DEVICE_TYPE_CABINET
          && item.mainDeviceName === row.name,
        );
        if (sameName) throw new Error(`当前间隔下已存在同名屏柜：${row.name}`);

        const sameCode = existingByCode.find((item: any) =>
          item.mainDeviceCode === row.code
        );
        if (sameCode) throw new Error(`屏柜编码已存在：${row.code}`);
      }

      let inserted = 0;
      let updated = 0;
      const savedIds: number[] = [];
      db.transaction(() => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const existing = existingByCode.find((item: any) => item.mainDeviceCode === row.code)
            ?? existingByBay.find((item: any) =>
              item.mainDeviceType === MAIN_DEVICE_TYPE_CABINET
              && item.mainDeviceName === row.name,
            );

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
            mainRepo.update(existing.id, dto);
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
    } catch (e: any) {
      console.error("[DB][屏柜保存] 保存失败", {
        projectName,
        payload,
        error: e?.message || e,
      });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("db:deleteCabinetMainDevices", async (_event, projectName: string, payload: CabinetDeviceDeletePayload) => {
    try {
      const db = getDatabase();
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

export async function initDbIpc(): Promise<void> {
  const db = await initDatabase();

  runMigrations(db, [
    { version: migration001Version, name: migration001Name, up: migration001Up, down: migration001Down },
    { version: migration002Version, name: migration002Name, up: migration002Up, down: migration002Down },
    { version: migration003Version, name: migration003Name, up: migration003Up, down: migration003Down },
    { version: migration004Version, name: migration004Name, up: migration004Up, down: migration004Down },
    { version: migration005Version, name: migration005Name, up: migration005Up, down: migration005Down },
    { version: migration006Version, name: migration006Name, up: migration006Up, down: migration006Down },
  ]);

  const uniquenessDiagnostics = diagnosePointUniqueness(db);
  if (uniquenessDiagnostics.hasConflicts) {
    console.error("[DB] 点位唯一性诊断发现冲突，增加唯一索引前必须人工确认并清理", uniquenessDiagnostics);
  } else {
    console.log("[DB] 点位唯一性诊断通过");
  }

  const repos = [
    { name: "voltage", repo: new DeviceVoltageRepo(db), methods: ["list", "getById", "findByStationId", "create", "update", "delete"] },
    { name: "bay", repo: new DeviceBayRepo(db), methods: ["list", "getById", "findByVoltId", "findByStationId", "create", "update", "delete"] },
    { name: "mainDevice", repo: new DeviceMainRepo(db), methods: ["list", "getById", "findByBayId", "findByStationId", "findByMainDeviceNameAndBayId", "findByMainDeviceCode", "create", "update", "delete", "deleteCascade"] },
    { name: "component", repo: new DeviceComponentRepo(db), methods: ["list", "getById", "findByMainDeviceId", "findByStationId", "create", "update", "delete"] },
    { name: "point", repo: new DevicePointRepo(db), methods: ["list", "getById", "findByPointCode", "findByCalibrationId", "bindCalibrationId", "bindCalibrationIds", "clearCalibrationId", "clearCalibrationIds", "findByStationId", "findByComponentId", "paginate", "create", "update", "delete"] },
  ];

  for (const def of repos) {
    registerRepoHandlers(def);
  }
  registerImportHandler();
  registerCabinetDeviceHandler();

  console.log("[DB] IPC handlers registered");
}

export function closeDbIpc(): void {
  closeDatabase();
}
