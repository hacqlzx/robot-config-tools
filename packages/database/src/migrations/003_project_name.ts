import type { DbWrapper } from "../core/connection";

export const version = 3;
export const name = "add_project_name_to_device_tables";

export function up(db: DbWrapper): void {
  db.exec("ALTER TABLE device_voltage ADD COLUMN project_name TEXT DEFAULT ''");
  db.exec("ALTER TABLE device_bay ADD COLUMN project_name TEXT DEFAULT ''");
  db.exec("ALTER TABLE device_main ADD COLUMN project_name TEXT DEFAULT ''");
  db.exec("ALTER TABLE device_component ADD COLUMN project_name TEXT DEFAULT ''");
  db.exec("ALTER TABLE device_point ADD COLUMN project_name TEXT DEFAULT ''");

  db.exec("CREATE INDEX IF NOT EXISTS idx_project_name ON device_voltage(project_name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bay_project_name ON device_bay(project_name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_main_project_name ON device_main(project_name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_component_project_name ON device_component(project_name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_point_project_name ON device_point(project_name)");
}

export function down(db: DbWrapper): void {
  // SQLite 不支持 DROP COLUMN，但 we can leave these as no-op
}
