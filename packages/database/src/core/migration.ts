import type { DbWrapper } from "./connection";

interface Migration {
  /** 递增版本号，必须大于当前 schema_version 才会执行 */
  version: number;
  /** 迁移名称，写入 schema_version 便于排查 */
  name: string;
  /** 正向迁移 */
  up: (db: DbWrapper) => void;
  /** 回滚迁移，当前运行器暂未自动调用 */
  down: (db: DbWrapper) => void;
}

/**
 * 确保迁移版本表存在。
 */
function ensureVersionTable(db: DbWrapper): void {
  if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get()) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      name      TEXT    NOT NULL,
      applied_at TEXT   NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * 读取当前已应用的最大迁移版本。
 */
function getCurrentVersion(db: DbWrapper): number {
  ensureVersionTable(db);
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_version")
    .get() as { version: number | null };
  return row.version ?? 0;
}

/**
 * 按版本顺序执行未应用的迁移。
 * 每条迁移独立事务执行，成功后写入 schema_version。
 */
export function runMigrations(
  db: DbWrapper,
  migrations: Migration[]
): void {
  const currentVersion = getCurrentVersion(db);
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_version (version, name) VALUES (?, ?)"
      ).run(migration.version, migration.name);
    });
    run();
  }
}
