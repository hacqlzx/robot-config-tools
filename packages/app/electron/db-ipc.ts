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

// ---- batch / import helpers ----

let _batchMode = false;

function registerBatchHandlers(): void {
  ipcMain.handle("db:startBatch", async () => {
    try {
      _batchMode = true;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("db:endBatch", async () => {
    try {
      _batchMode = false;
      getDatabase().saveToDisk();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle("db:saveToDisk", async () => {
    try {
      getDatabase().saveToDisk();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
}

function registerImportHandler(): void {
  ipcMain.handle(
    "db:importPoints",
    async (_event, rows: PointExcelRow[], stationName: string, stationCode: string) => {
      try {
        const { importPointExcel } = await import("@robot/database");
        const db = getDatabase();
        const result: ImportResult = importPointExcel(db, rows, stationName, stationCode);
        return { ok: true, data: result };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    },
  );
}

// ---- init / close ----

export async function initDbIpc(): Promise<void> {
  const db = await initDatabase();

  runMigrations(db, [
    { version: migration001Version, name: migration001Name, up: migration001Up, down: migration001Down },
  ]);

  const repos = [
    { name: "voltage", repo: new DeviceVoltageRepo(db), methods: ["list", "getById", "findByStationId", "create", "update", "delete"] },
    { name: "bay", repo: new DeviceBayRepo(db), methods: ["list", "getById", "findByVoltId", "findByStationId", "create", "update", "delete"] },
    { name: "mainDevice", repo: new DeviceMainRepo(db), methods: ["list", "getById", "findByBayId", "findByStationId", "create", "update", "delete"] },
    { name: "component", repo: new DeviceComponentRepo(db), methods: ["list", "getById", "findByMainDeviceId", "findByStationId", "create", "update", "delete"] },
    { name: "point", repo: new DevicePointRepo(db), methods: ["list", "getById", "findByPointCode", "findByCalibrationId", "findByStationId", "findByComponentId", "paginate", "create", "update", "delete"] },
  ];

  for (const def of repos) {
    registerRepoHandlers(def);
  }
  registerBatchHandlers();
  registerImportHandler();

  console.log("[DB] IPC handlers registered");
}

export function closeDbIpc(): void {
  closeDatabase();
}
