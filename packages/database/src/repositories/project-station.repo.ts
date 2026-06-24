import type { DbWrapper } from "../core/connection";
import { ProjectStation } from "../types";

export class ProjectStationRepo {
  constructor(private db: DbWrapper) {}

  getByProjectName(projectName: string): ProjectStation | undefined {
    return this.db
      .prepare("SELECT * FROM project_station WHERE project_name = ?")
      .get(projectName) as ProjectStation | undefined;
  }

  bind(projectName: string, stationName: string): ProjectStation {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "INSERT INTO project_station (project_name, station_name, create_time, update_time) VALUES (?, ?, ?, ?)"
      )
      .run(projectName, stationName, now, now);

    const row = this.db
      .prepare("SELECT * FROM project_station WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as ProjectStation;

    if (!row) {
      throw new Error(`绑定项目 "${projectName}" 失败`);
    }
    return row;
  }
}
