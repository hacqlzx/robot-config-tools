import type { DbWrapper } from "../core/connection";

export const version = 5;
export const name = "add_calibration_sequence";

export function up(db: DbWrapper): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calibration_sequence (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      next_id  INTEGER NOT NULL
    )
  `);

  const row = db.prepare(`
    SELECT MAX(CAST(calibration_id AS INTEGER)) AS max_id
    FROM device_point
    WHERE calibration_id IS NOT NULL
      AND calibration_id <> ''
      AND calibration_id NOT GLOB '*[^0-9]*'
  `).get() as { maxId: number | null };
  const nextId = Math.max(1, Number(row?.maxId || 0) + 1);
  db.prepare("INSERT OR IGNORE INTO calibration_sequence (id, next_id) VALUES (1, ?)").run(nextId);
}

export function down(_db: DbWrapper): void {
  // no-op
}
