import { runMigrations } from "./core/migration";
import type { DbWrapper } from "./core/connection";
import * as migration001 from "./migrations/001_init";
import * as migration002 from "./migrations/002_project_station";
import * as migration003 from "./migrations/003_project_name";
import * as migration004 from "./migrations/004_point_code_index";
import * as migration005 from "./migrations/005_calibration_sequence";
import * as migration006 from "./migrations/006_point_unique_constraints";
import * as migration007 from "./migrations/007_project_database_meta";

const migrations = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
].map(({ version, name, up, down }) => ({ version, name, up, down }));

export const CURRENT_DATABASE_SCHEMA_VERSION = migration007.version;

export function runCurrentDatabaseMigrations(db: DbWrapper): void {
  runMigrations(db, migrations);
}
