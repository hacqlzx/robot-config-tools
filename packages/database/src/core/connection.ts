import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { app } from "electron";

const DATABASE_LONG_TASK_MS = 50;

function roundDuration(value: number): number {
  return Math.round(value * 100) / 100;
}

function toCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (typeof obj !== 'object') return obj;
  const out: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camelKey] = obj[key];
  }
  return out;
}

interface Statement {
  run(...params: any[]): { lastInsertRowid: number; changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

/**
 * sql.js 数据库包装层。
 *
 * sql.js 是内存数据库，任何写操作都需要 export 后写回磁盘；
 * 这里统一处理 named params、snake_case 转 camelCase、延迟写盘和事务。
 */
export class DbWrapper {
  private dirty = false;
  private batchDepth = 0;
  private batchSaveReason: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private db: SqlJsDatabase,
    private SQL: SqlJsStatic,
    private filePath: string,
  ) {}

  /**
   * 准备 SQL 语句。
   * 返回的 get/all 会把数据库字段从 snake_case 转成前端常用的 camelCase。
   */
  prepare(sql: string): Statement {
    const self = this;
    return {
      run(...params: any[]) {
        const flat = params.length === 1 ? params[0] : params;
        const bindParams: any =
          !Array.isArray(flat) && typeof flat === "object" && flat !== null
            ? flat
            : Array.isArray(flat) ? flat : [flat];

        // sql.js 原生 db.run() 内部走 prepare → bind → step → free，正确处理 @named params
        self.db.run(sql, bindParams);

        // 立即取 changes（在 exec 之前，避免被覆盖）
        const changes = self.db.getRowsModified();

        // exec 取 last_insert_rowid
        const execResult = self.db.exec("SELECT last_insert_rowid()");
        const lastInsertRowid =
          execResult.length > 0 && execResult[0].values.length > 0
            ? (execResult[0].values[0][0] as number)
            : 0;

        self.dirty = true;
        self.scheduleSave();
        return { lastInsertRowid, changes };
      },
      get(...params: any[]) {
        const stmt = self.db.prepare(sql);
        try {
          if (params.length > 0) {
            const flat = params.length === 1 ? params[0] : params;
            const bindParams: any =
              !Array.isArray(flat) && typeof flat === "object" && flat !== null
                ? flat
                : Array.isArray(flat) ? flat : [flat];
            stmt.bind(bindParams);
          }
          let result: any = null;
          if (stmt.step()) result = toCamel(stmt.getAsObject());
          return result;
        } finally {
          stmt.free();
        }
      },
      all(...params: any[]) {
        const stmt = self.db.prepare(sql);
        try {
          if (params.length > 0) {
            const flat = params.length === 1 ? params[0] : params;
            const bindParams: any =
              !Array.isArray(flat) && typeof flat === "object" && flat !== null
                ? flat
                : Array.isArray(flat) ? flat : [flat];
            stmt.bind(bindParams);
          }
          const rows: any[] = [];
          while (stmt.step()) rows.push(toCamel(stmt.getAsObject()));
          return rows;
        } finally {
          stmt.free();
        }
      },
    };
  }

  /** 执行原始 SQL，多用于迁移和批量建表。 */
  exec(sql: string): void {
    this.db.exec(sql);
    this.dirty = true;
    this.scheduleSave();
  }

  /**
   * 批量写入模式。
   * fn 内部的多次写操作不会频繁触发保存，最外层结束后统一写盘。
   */
  batchMode<T>(fn: () => T, saveReason = "batch"): T {
    if (this.batchDepth === 0) this.batchSaveReason = saveReason;
    this.batchDepth += 1;
    try {
      return fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) {
        const outerSaveReason = this.batchSaveReason ?? saveReason;
        this.batchSaveReason = null;
        this.saveToDisk(outerSaveReason);
      }
    }
  }

  /**
   * 将内存数据库完整导出到本地 db 文件。
   * reason 用于日志追踪本次写盘来源。
   */
  saveToDisk(reason = "explicit"): void {
    if (!this.dirty) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const totalStartedAt = performance.now();
    let stage = "prepare-directory";
    let bytes = 0;
    let exportDurationMs = 0;
    let writeDurationMs = 0;

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      stage = "export";
      const exportStartedAt = performance.now();
      const data = this.db.export();
      exportDurationMs = performance.now() - exportStartedAt;
      bytes = data.byteLength;

      stage = "write";
      const writeStartedAt = performance.now();
      fs.writeFileSync(this.filePath, Buffer.from(data));
      writeDurationMs = performance.now() - writeStartedAt;
      this.dirty = false;

      const totalDurationMs = performance.now() - totalStartedAt;
      const metrics = {
        reason,
        bytes,
        exportDurationMs: roundDuration(exportDurationMs),
        writeDurationMs: roundDuration(writeDurationMs),
        totalDurationMs: roundDuration(totalDurationMs),
        longTask: totalDurationMs >= DATABASE_LONG_TASK_MS,
      };
      if (metrics.longTask) {
        console.warn("[DB] 整库同步写盘形成主线程长任务", metrics);
      } else {
        console.info("[DB] 整库同步写盘完成", metrics);
      }
    } catch (error) {
      console.error("[DB] 整库同步写盘失败", {
        reason,
        stage,
        bytes,
        exportDurationMs: roundDuration(exportDurationMs),
        writeDurationMs: roundDuration(writeDurationMs),
        totalDurationMs: roundDuration(performance.now() - totalStartedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private scheduleSave(): void {
    if (this.batchDepth > 0) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveToDisk("scheduled"), 5000);
  }

  /**
   * 事务包装。保持和 better-sqlite3 类似的调用方式：db.transaction(fn)()。
   */
  transaction(fn: () => void): () => void {
    return () => {
      this.db.exec("BEGIN");
      try { fn(); this.db.exec("COMMIT"); this.dirty = true; this.scheduleSave(); }
      catch (e) { this.db.exec("ROLLBACK"); throw e; }
    };
  }

  pragma(_sql: string): void {}

  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveToDisk("close");
    this.db.close();
  }
}

let db: DbWrapper | null = null;
let dbPath = "";

function getDataDir(): string {
  if (app.isPackaged) {
    // 数据库放用户目录，不受安装覆盖
    return path.join(app.getPath("userData"), "database");
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..", "..", "..", "data");
}

/**
 * 初始化本地数据库。
 * dbDir 可用于测试或自定义目录；默认开发环境落到仓库 data，打包后落到 userData/database。
 */
export async function initDatabase(dbDir?: string): Promise<DbWrapper> {
  if (db) return db;
  const dir = dbDir ?? getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = path.join(dir, "robot-config.db");
  const SQL = await initSqlJs();
  let sqlDb: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    sqlDb = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    sqlDb = new SQL.Database();
  }
  db = new DbWrapper(sqlDb, SQL, dbPath);
  console.log("[DB] Database opened:", dbPath);
  return db;
}

/**
 * 获取已初始化数据库实例。
 */
export function getDatabase(): DbWrapper {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

export function getDatabasePath(): string { return dbPath; }

export function closeDatabase(): void {
  if (db) { db.close(); db = null; }
}
