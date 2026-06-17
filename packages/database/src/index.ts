// 核心
export { initDatabase, getDatabase, getDatabasePath, closeDatabase, DbWrapper } from "./core/connection";
export { runMigrations } from "./core/migration";

// 类型
export type {
  FacInfo, CreateFacInfoDTO, UpdateFacInfoDTO,
  DeviceVoltage, CreateDeviceVoltageDTO, UpdateDeviceVoltageDTO,
  DeviceBay, CreateDeviceBayDTO, UpdateDeviceBayDTO,
  DeviceMain, CreateDeviceMainDTO, UpdateDeviceMainDTO,
  DeviceComponent, CreateDeviceComponentDTO, UpdateDeviceComponentDTO,
  DevicePoint, CreateDevicePointDTO, UpdateDevicePointDTO,
} from "./types";

// 迁移
export { version as migration001Version, name as migration001Name, up as migration001Up, down as migration001Down } from "./migrations/001_init";

// Repository
export { FacInfoRepo } from "./repositories/fac-info.repo";
export { DeviceVoltageRepo } from "./repositories/device-voltage.repo";
export { DeviceBayRepo } from "./repositories/device-bay.repo";
export { DeviceMainRepo } from "./repositories/device-main.repo";
export { DeviceComponentRepo } from "./repositories/device-component.repo";
export { DevicePointRepo } from "./repositories/device-point.repo";

// 服务
export { importPointExcel } from "./services/import.service";
export type { PointExcelRow, ImportResult } from "./services/import.service";