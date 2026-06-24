import type { DbWrapper } from "../core/connection";

export const version = 2;
export const name = "add_project_station";

export function up(db: DbWrapper): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_station (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name  TEXT NOT NULL,
      station_name  TEXT NOT NULL,
      create_time   TEXT DEFAULT NULL,
      update_time   TEXT DEFAULT NULL
    )
  `);

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_name ON project_station(project_name)");
}

export function down(db: DbWrapper): void {
  db.exec("DROP TABLE IF EXISTS project_station");
}
