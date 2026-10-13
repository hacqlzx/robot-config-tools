import type { DbWrapper } from "../core/connection";

const PROJECT_DATA_TABLES = [
  ["stationBindings", "project_station"],
  ["voltages", "device_voltage"],
  ["bays", "device_bay"],
  ["mainDevices", "device_main"],
  ["components", "device_component"],
  ["points", "device_point"],
] as const;

export interface ProjectDataCounts {
  /** 项目-厂站绑定记录数 */
  stationBindings: number;
  /** 电压区记录数 */
  voltages: number;
  /** 间隔记录数 */
  bays: number;
  /** 主设备记录数 */
  mainDevices: number;
  /** 部件记录数 */
  components: number;
  /** 点位记录数 */
  points: number;
  /** 以上记录总数 */
  total: number;
}

function emptyCounts(): ProjectDataCounts {
  return {
    stationBindings: 0,
    voltages: 0,
    bays: 0,
    mainDevices: 0,
    components: 0,
    points: 0,
    total: 0,
  };
}

/**
 * 统计某个项目在本地数据库中的关联数据量。
 * 项目删除/重命名前用它给前端提示影响范围。
 */
export function getProjectDataCounts(db: DbWrapper, projectName: string): ProjectDataCounts {
  const counts = emptyCounts();
  for (const [key, table] of PROJECT_DATA_TABLES) {
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_name = ?`)
      .get(projectName) as { count?: number } | undefined;
    counts[key] = Number(row?.count ?? 0);
  }
  counts.total = PROJECT_DATA_TABLES.reduce((sum, [key]) => sum + counts[key], 0);
  return counts;
}

/**
 * 重命名数据库中的项目字段。
 * 如果目标项目名已经有数据，直接拒绝，避免两个项目数据混合。
 */
export function renameProjectData(db: DbWrapper, oldName: string, newName: string): ProjectDataCounts {
  const sourceCounts = getProjectDataCounts(db, oldName);
  const targetCounts = getProjectDataCounts(db, newName);
  if (targetCounts.total > 0) {
    throw new Error(`数据库中已存在项目 "${newName}" 的关联数据，无法重命名`);
  }

  db.transaction(() => {
    for (const [, table] of PROJECT_DATA_TABLES) {
      db.prepare(`UPDATE ${table} SET project_name = ? WHERE project_name = ?`).run(newName, oldName);
    }
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_database_meta'").get()) {
      db.prepare("UPDATE project_database_meta SET project_name = ?, updated_at = ? WHERE id = 1 AND project_name = ?")
        .run(newName, new Date().toISOString(), oldName);
    }
  })();
  db.saveToDisk("project-rename");
  return sourceCounts;
}

/**
 * 删除项目关联的数据库数据。
 * 按从点位到上层设备的反向顺序删除，减少外键/层级残留风险。
 */
export function deleteProjectData(db: DbWrapper, projectName: string): ProjectDataCounts {
  const counts = getProjectDataCounts(db, projectName);
  db.transaction(() => {
    for (const [, table] of [...PROJECT_DATA_TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table} WHERE project_name = ?`).run(projectName);
    }
  })();
  db.saveToDisk("project-delete");
  return counts;
}
