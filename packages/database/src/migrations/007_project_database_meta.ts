import type { DbWrapper } from "../core/connection";

export const version = 7;
export const name = "add_project_database_metadata";

export function up(db: DbWrapper): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_database_meta (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      project_id          TEXT NOT NULL,
      project_name        TEXT NOT NULL,
      format_version      INTEGER NOT NULL,
      migration_batch_id  TEXT,
      source_fingerprint  TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function down(db: DbWrapper): void {
  db.exec("DROP TABLE IF EXISTS project_database_meta");
}
