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
  run(...params: any[]): { lastInsertRowid: number; changes: number };
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

  exec(sql: string): void {
    this.db.exec(sql);
    this.dirty = true;
    this.scheduleSave();
  }

  batchMode<T>(fn: () => T): T {
    this.autoSave = false;
    try {
      return fn();
    } finally {
      this.autoSave = true;
      this.saveToDisk();
    }
  }

  saveToDisk(): void {
    if (!this.dirty) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = this.db.export();
    fs.writeFileSync(this.filePath, Buffer.from(data));
    this.dirty = false;
  }

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
    // 数据库放用户目录，不受安装覆盖
    return path.join(app.getPath("userData"), "database");
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
