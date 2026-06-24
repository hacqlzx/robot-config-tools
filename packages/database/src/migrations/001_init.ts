import type { DbWrapper } from "../core/connection";

export const version = 1;
export const name = "init_all_tables";

export function up(db: DbWrapper): void {

  // ==================================================
  // device_voltage 电压区域表
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_voltage (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      volt_code                TEXT DEFAULT NULL,  -- 电压编码
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      station_id               INTEGER DEFAULT NULL,  -- 厂站id
      station_name             TEXT DEFAULT NULL,  -- 厂站名称
      station_code             TEXT DEFAULT NULL,  -- 厂站编码
      sort_num                 INTEGER DEFAULT NULL,  -- 电压顺序号
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL  -- 更新人
    )
  `);

  // ==================================================
  // device_bay 间隔表
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_bay (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      bay_type                 TEXT DEFAULT NULL,  -- 间隔类型
      bay_name                 TEXT DEFAULT NULL,  -- 间隔名称
      bay_code                 TEXT DEFAULT NULL,  -- 间隔编码
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      volt_id                  INTEGER DEFAULT NULL,  -- 电压id
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      volt_code                TEXT DEFAULT NULL,  -- 电压编码
      station_id               INTEGER DEFAULT NULL,  -- 厂站id
      station_name             TEXT DEFAULT NULL,  -- 厂站名称
      station_code             TEXT DEFAULT NULL,  -- 厂站编码
      sort_num                 INTEGER DEFAULT NULL,  -- 间隔顺序号
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      repair_flag              INTEGER DEFAULT 0  -- 检修状态
    )
  `);

  // ==================================================
  // device_main 主设备表
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_main (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      main_device_type         INTEGER DEFAULT NULL,  -- 主设备类型
      main_device_name         TEXT DEFAULT NULL,  -- 主设备名称
      main_device_code         TEXT DEFAULT NULL,  -- 主设备编码
      phase_type               INTEGER DEFAULT NULL,  -- 相位类型 0-主体 1-A相 2-B相 3-C相
      three_phase_flag         INTEGER DEFAULT NULL,  -- 是否三相设备 0-否 1-是
      three_phase_associate_id TEXT DEFAULT NULL,  -- 三相设备关联id
      entity_id                TEXT DEFAULT NULL,  -- 实物id
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      bay_id                   INTEGER DEFAULT NULL,  -- 间隔id
      bay_type                 TEXT DEFAULT NULL,  -- 间隔类型
      bay_name                 TEXT DEFAULT NULL,  -- 间隔名称
      bay_code                 TEXT DEFAULT NULL,  -- 间隔编码
      volt_id                  INTEGER DEFAULT NULL,  -- 电压id
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      volt_code                TEXT DEFAULT NULL,  -- 电压编码
      station_id               INTEGER DEFAULT NULL,  -- 厂站id
      station_name             TEXT DEFAULT NULL,  -- 厂站名称
      station_code             TEXT DEFAULT NULL,  -- 厂站编码
      sort_num                 INTEGER DEFAULT NULL,  -- 主设备顺序号
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      device_model             TEXT DEFAULT NULL,  -- 设备型号
      device_source            TEXT DEFAULT NULL,  -- 设备来源
      manufacturer             TEXT DEFAULT NULL,  -- 生产厂家
      production_code          TEXT DEFAULT NULL,  -- 出厂编号
      use_company              TEXT DEFAULT NULL,  -- 使用单位
      production_date          TEXT DEFAULT NULL,  -- 生产日期
      commissioning_date       TEXT DEFAULT NULL,  -- 投运日期
      remark_info              TEXT DEFAULT NULL,  -- 备注信息
      repair_flag              INTEGER DEFAULT 0  -- 检修状态
    )
  `);

  // ==================================================
  // device_component 部件表
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_component (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      component_name           TEXT DEFAULT NULL,  -- 部件名称
      component_type           TEXT DEFAULT NULL,  -- 部件类型
      component_code           TEXT DEFAULT NULL,  -- 部件编码
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      main_device_id           INTEGER DEFAULT NULL,  -- 主设备id
      main_device_type         INTEGER DEFAULT NULL,  -- 主设备类型
      main_device_name         TEXT DEFAULT NULL,  -- 主设备名称
      main_device_code         TEXT DEFAULT NULL,  -- 主设备编码
      phase_type               INTEGER DEFAULT NULL,  -- 主设备相位类型 0-主体 1-A相 2-B相 3-C相
      bay_id                   INTEGER DEFAULT NULL,  -- 间隔id
      bay_type                 TEXT DEFAULT NULL,  -- 间隔类型
      bay_name                 TEXT DEFAULT NULL,  -- 间隔名称
      bay_code                 TEXT DEFAULT NULL,  -- 间隔编码
      volt_id                  INTEGER DEFAULT NULL,  -- 电压id
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      volt_code                TEXT DEFAULT NULL,  -- 电压编码
      station_id               INTEGER DEFAULT NULL,  -- 厂站id
      station_name             TEXT DEFAULT NULL,  -- 厂站名称
      station_code             TEXT DEFAULT NULL,  -- 厂站编码
      sort_num                 INTEGER DEFAULT NULL,  -- 部件顺序号
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      repair_flag              INTEGER DEFAULT 0  -- 检修状态
    )
  `);

  // ==================================================
  // device_point 点位表
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_point (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      point_name               TEXT DEFAULT NULL,  -- 点位名称
      point_code               TEXT DEFAULT NULL,  -- 点位编码
      recognition_type_list    TEXT DEFAULT NULL,  -- 识别类型 多个用逗号分隔
      save_type_list           INTEGER DEFAULT NULL,  -- 采集类型
      meter_type               INTEGER DEFAULT NULL,  -- 表计类型
      position_state_type      INTEGER DEFAULT NULL,  -- 位置状态类型
      appearance_type          INTEGER DEFAULT NULL,  -- 外观类型
      defect_rec_type          TEXT DEFAULT NULL,  -- 缺陷识别类型 多个用逗号分隔
      point_tags_code_list     TEXT DEFAULT NULL,  -- 点位标签编码 多个用逗号拼接
      defect_judge_type        INTEGER DEFAULT NULL,  -- 是否缺陷判断 0-否 1-是
      important_level          INTEGER DEFAULT NULL,  -- 重要等级 1-Ⅰ类 2-Ⅱ类 3-Ⅲ类
      sort_num                 INTEGER DEFAULT NULL,  -- 点位顺序号
      three_phase_flag         INTEGER DEFAULT NULL,  -- 否三相关联点位 0-否 1-是
      three_phase_associate_id TEXT DEFAULT NULL,  -- 三相关联id
      demarcate_state          INTEGER DEFAULT NULL,  -- 标定状态 0-未标定 1-已标定
      robot_id                 INTEGER DEFAULT NULL,  -- 机器人id
      robot_name               TEXT DEFAULT NULL,  -- 机器人名称
      cruise_id                TEXT NOT NULL,  -- 巡检点ID 用于和图像系统交互
      origin_calibration_path  TEXT DEFAULT NULL,  -- 原始标定文件路径
      extend_calibration_path  TEXT DEFAULT NULL,  -- 扩展标定文件路径
      visible_calibration_path TEXT DEFAULT NULL,  -- 可见光标定图片路径
      latest_collect_path      TEXT DEFAULT NULL,  -- 最新采集文件路径
      thermal_region           TEXT DEFAULT NULL,  -- 红外热像区域
      calibration_id           TEXT DEFAULT NULL,  -- 标定id 用于和机器人本体交互
      component_id             INTEGER DEFAULT NULL,  -- 部件id
      component_type           TEXT DEFAULT NULL,  -- 部件类型
      component_name           TEXT DEFAULT NULL,  -- 部件名称
      component_code           TEXT DEFAULT NULL,  -- 部件编码
      main_device_id           INTEGER DEFAULT NULL,  -- 主设备id
      main_device_type         INTEGER DEFAULT NULL,  -- 主设备类型
      main_device_name         TEXT DEFAULT NULL,  -- 主设备名称
      main_device_code         TEXT DEFAULT NULL,  -- 主设备编码
      phase_type               INTEGER DEFAULT NULL,  -- 主设备相位类型 0-主体 1-A相 2-B相 3-C相
      bay_id                   INTEGER DEFAULT NULL,  -- 间隔id
      bay_type                 TEXT DEFAULT NULL,  -- 间隔类型
      bay_name                 TEXT DEFAULT NULL,  -- 间隔名称
      bay_code                 TEXT DEFAULT NULL,  -- 间隔编码
      volt_id                  INTEGER DEFAULT NULL,  -- 电压id
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      volt_code                TEXT DEFAULT NULL,  -- 电压编码
      station_id               INTEGER DEFAULT NULL,  -- 厂站id
      station_name             TEXT DEFAULT NULL,  -- 厂站名称
      station_code             TEXT DEFAULT NULL,  -- 厂站编码
      inspection_sub_type      TEXT DEFAULT NULL,  -- 巡检子类型 多个用逗号分隔
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      map_code                 TEXT DEFAULT NULL,  -- 巡检点所在地图编码
      repair_flag              INTEGER DEFAULT 0,  -- 检修状态
      device_info              TEXT DEFAULT NULL,  -- 对上级模型同步使用 其他地方不用
      remark                   TEXT DEFAULT NULL  -- 备注
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_point_code ON device_point(point_code)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_calibration_id ON device_point(calibration_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_station_id ON device_point(station_id)");
}

export function down(db: DbWrapper): void {
  db.exec("DROP TABLE IF EXISTS device_point");
  db.exec("DROP TABLE IF EXISTS device_component");
  db.exec("DROP TABLE IF EXISTS device_main");
  db.exec("DROP TABLE IF EXISTS device_bay");
  db.exec("DROP TABLE IF EXISTS device_voltage");
}
