import type { DbWrapper } from "../core/connection";

export interface PointCodeConflict {
  projectName: string;
  pointCode: string;
  count: number;
  pointIds: number[];
}

export interface CalibrationIdConflict {
  calibrationId: string;
  count: number;
  pointIds: number[];
}

export interface PointUniquenessDiagnostics {
  pointCodeConflicts: PointCodeConflict[];
  calibrationIdConflicts: CalibrationIdConflict[];
  hasConflicts: boolean;
}

interface RawPointCodeConflict {
  projectName: string;
  pointCode: string;
  duplicateCount: number;
  pointIds: string;
}

interface RawCalibrationIdConflict {
  calibrationId: string;
  duplicateCount: number;
  pointIds: string;
}

function parsePointIds(value: string): number[] {
  return String(value ?? "")
    .split(",")
    .map((id) => Number(id))
    .filter(Number.isSafeInteger);
}

/**
 * 只读检查即将增加的唯一约束是否会与存量点位数据冲突。
 * 标定 ID 按业务层相同的 trim 语义比较，避免空白字符绕过唯一性。
 */
export function diagnosePointUniqueness(db: DbWrapper): PointUniquenessDiagnostics {
  const pointCodeRows = db.prepare(`
    SELECT
      project_name AS project_name,
      point_code AS point_code,
      COUNT(*) AS duplicate_count,
      GROUP_CONCAT(id, ',') AS point_ids
    FROM device_point
    WHERE project_name IS NOT NULL
      AND point_code IS NOT NULL
    GROUP BY project_name, point_code
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, project_name ASC, point_code ASC
  `).all() as RawPointCodeConflict[];

  const calibrationIdRows = db.prepare(`
    SELECT
      TRIM(calibration_id) AS calibration_id,
      COUNT(*) AS duplicate_count,
      GROUP_CONCAT(id, ',') AS point_ids
    FROM device_point
    WHERE calibration_id IS NOT NULL
      AND TRIM(calibration_id) <> ''
    GROUP BY TRIM(calibration_id)
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, calibration_id ASC
  `).all() as RawCalibrationIdConflict[];

  const pointCodeConflicts = pointCodeRows.map((row) => ({
    projectName: String(row.projectName ?? ""),
    pointCode: String(row.pointCode ?? ""),
    count: Number(row.duplicateCount),
    pointIds: parsePointIds(row.pointIds),
  }));
  const calibrationIdConflicts = calibrationIdRows.map((row) => ({
    calibrationId: String(row.calibrationId ?? ""),
    count: Number(row.duplicateCount),
    pointIds: parsePointIds(row.pointIds),
  }));

  return {
    pointCodeConflicts,
    calibrationIdConflicts,
    hasConflicts: pointCodeConflicts.length > 0 || calibrationIdConflicts.length > 0,
  };
}
