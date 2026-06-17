import type { DbWrapper } from "./connection";

interface Migration {
  version: number;
  name: string;
  up: (db: DbWrapper) => void;
  down: (db: DbWrapper) => void;
}

function ensureVersionTable(db: DbWrapper): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      name      TEXT    NOT NULL,
      applied_at TEXT   NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getCurrentVersion(db: DbWrapper): number {
  ensureVersionTable(db);
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_version")
    .get() as { version: number | null };
  return row.version ?? 0;
}

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