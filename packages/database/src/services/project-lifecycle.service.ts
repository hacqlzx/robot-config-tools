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
  stationBindings: number;
  voltages: number;
  bays: number;
  mainDevices: number;
  components: number;
  points: number;
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
  })();
  db.saveToDisk();
  return sourceCounts;
}

export function deleteProjectData(db: DbWrapper, projectName: string): ProjectDataCounts {
  const counts = getProjectDataCounts(db, projectName);
  db.transaction(() => {
    for (const [, table] of [...PROJECT_DATA_TABLES].reverse()) {
      db.prepare(`DELETE FROM ${table} WHERE project_name = ?`).run(projectName);
    }
  })();
  db.saveToDisk();
  return counts;
}
