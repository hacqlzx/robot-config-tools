import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { app } from "electron";


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
  run(...params: any[]): { lastInsertRowid: number | bigint; changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export class DbWrapper {
  private dirty = false;
  private autoSave = true;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private db: SqlJsDatabase,
    private SQL: SqlJsStatic,
    private filePath: string,
  ) {}

  prepare(sql: string): Statement {
    const self = this;
    return {
      run(...params: any[]) {
        const flat = params.length === 1 ? params[0] : params;
        self.db.run(
          sql,
          !Array.isArray(flat) && typeof flat === "object" && flat !== null
            ? flat
            : Array.isArray(flat) ? flat : [flat],
        );
        const row = self.db.exec("SELECT last_insert_rowid()")[0];
        self.dirty = true;
        self.scheduleSave();
        return {
          lastInsertRowid: row ? (row.values[0][0] as number) : 0,
          changes: self.db.getRowsModified(),
        };
      },
      get(...params: any[]) {
        const stmt = self.db.prepare(sql);
        if (params.length > 0) {
          const flat = params.length === 1 ? params[0] : params;
          stmt.bind(flat);
        }
        let result: any = null;
        if (stmt.step()) result = toCamel(stmt.getAsObject());
        stmt.free();
        return result;
      },
      all(...params: any[]) {
        const stmt = self.db.prepare(sql);
        if (params.length > 0) {
          const flat = params.length === 1 ? params[0] : params;
          stmt.bind(flat);
        }
        const rows: any[] = [];
        while (stmt.step()) rows.push(toCamel(stmt.getAsObject()));
        stmt.free();
        return rows;
      },
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.dirty = true;
    this.scheduleSave();
  }

  /** 批量导入时关闭自动保存 */
  batchMode<T>(fn: () => T): T {
    this.autoSave = false;
    try {
      return fn();
    } finally {
      this.autoSave = true;
      this.saveToDisk();
    }
  }

  /** 手动保存到磁盘 */
  saveToDisk(): void {
    if (!this.dirty) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = this.db.export();
    fs.writeFileSync(this.filePath, Buffer.from(data));
    this.dirty = false;
  }

  /** 延迟保存：单次操作用 debounce，批量操作不触发 */
  private scheduleSave(): void {
    if (!this.autoSave) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveToDisk(), 5000);
  }

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
    this.saveToDisk();
    this.db.close();
  }
}

let db: DbWrapper | null = null;
let dbPath = "";

function getDataDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath("exe")), "data");
  }
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "..", "..", "..", "data");
}

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

export function getDatabase(): DbWrapper {
  if (!db) throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

export function getDatabasePath(): string { return dbPath; }

export function closeDatabase(): void {
  if (db) { db.close(); db = null; }
}