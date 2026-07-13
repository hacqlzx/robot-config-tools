// 核心
export { initDatabase, getDatabase, getDatabasePath, closeDatabase, DbWrapper } from "./core/connection";
export { runMigrations } from "./core/migration";

// 类型
export type {
  DeviceVoltage, CreateDeviceVoltageDTO, UpdateDeviceVoltageDTO,
  DeviceBay, CreateDeviceBayDTO, UpdateDeviceBayDTO,
  DeviceMain, CreateDeviceMainDTO, UpdateDeviceMainDTO,
  DeviceComponent, CreateDeviceComponentDTO, UpdateDeviceComponentDTO,
  DevicePoint, CreateDevicePointDTO, UpdateDevicePointDTO,
  ProjectStation,
} from "./types";

// 迁移
export { version as migration001Version, name as migration001Name, up as migration001Up, down as migration001Down } from "./migrations/001_init";
export { version as migration002Version, name as migration002Name, up as migration002Up, down as migration002Down } from "./migrations/002_project_station";
export { version as migration003Version, name as migration003Name, up as migration003Up, down as migration003Down } from "./migrations/003_project_name";
export { version as migration004Version, name as migration004Name, up as migration004Up, down as migration004Down } from "./migrations/004_point_code_index";

// Repository
export { DeviceVoltageRepo } from "./repositories/device-voltage.repo";
export { DeviceBayRepo } from "./repositories/device-bay.repo";
export { DeviceMainRepo } from "./repositories/device-main.repo";
export { DeviceComponentRepo } from "./repositories/device-component.repo";
export { DevicePointRepo } from "./repositories/device-point.repo";
export { ProjectStationRepo } from "./repositories/project-station.repo";

// 服务
export { importPointExcel } from "./services/import.service";
export type { PointExcelRow, ImportResult } from "./services/import.service";
export { deleteProjectData, getProjectDataCounts, renameProjectData } from "./services/project-lifecycle.service";
export type { ProjectDataCounts } from "./services/project-lifecycle.service";
