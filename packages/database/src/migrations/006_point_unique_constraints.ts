import type { DbWrapper } from "../core/connection";
import { diagnosePointUniqueness } from "../services/data-integrity.service";

export const version = 6;
export const name = "add_point_unique_constraints";

export function up(db: DbWrapper): void {
  const diagnostics = diagnosePointUniqueness(db);
  if (diagnostics.hasConflicts) {
    throw new Error(
      `点位唯一索引迁移已中止，请先确认并清理冲突数据：${JSON.stringify(diagnostics)}`,
    );
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_point_project_code
    ON device_point(project_name, point_code)
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_point_calibration_id
    ON device_point(TRIM(calibration_id))
    WHERE calibration_id IS NOT NULL
      AND TRIM(calibration_id) <> ''
  `);
}

export function down(_db: DbWrapper): void {
  // no-op
}
