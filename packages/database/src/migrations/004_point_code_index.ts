import type { DbWrapper } from "../core/connection";

export const version = 4;
export const name = "add_point_code_index";

export function up(db: DbWrapper): void {
  // point_code 现在作为点位唯一键，加复合索引
  db.exec("CREATE INDEX IF NOT EXISTS idx_point_code_project ON device_point(point_code, project_name)");
}

export function down(_db: DbWrapper): void {
  // no-op
}
