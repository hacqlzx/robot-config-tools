import type { DbWrapper } from "../core/connection";

export const version = 1;
export const name = "init_all_tables";

export function up(db: DbWrapper): void {
  // ==================================================
  // fac_info
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS fac_info (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      station_name             TEXT DEFAULT NULL,  -- 变电站名称
      station_code             TEXT DEFAULT NULL,  -- 变电站编码
      out_station_code         TEXT DEFAULT NULL,  -- 对外变电站编码，用于对接巡视主机
      fac_type                 TEXT DEFAULT NULL,  -- 厂站类型：1-变电站，2-变电房，3-开闭所
      station_type             TEXT DEFAULT NULL,  -- 变电站类型：1-常规站（敞开式），2-室内站，3-GIS站，4-半GIS半常规站，5-AIS站，6-常规站（敞开式），7-HGIS站
      province_name            TEXT DEFAULT NULL,  -- 省份名称
      city_name                TEXT DEFAULT NULL,  -- 城市名称
      area_name                TEXT DEFAULT NULL,  -- 区域名称
      create_by                TEXT DEFAULT NULL,  -- 创建人
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      volt_name                TEXT DEFAULT NULL,  -- 电压名称
      use_time                 TEXT DEFAULT NULL,  -- 投用时间
      responsible_person       TEXT DEFAULT NULL,  -- 负责人
      telephone                TEXT DEFAULT NULL,  -- 电话
      env_data_robot_id        INTEGER DEFAULT NULL,  -- 微气象数据来源 微气象设备：0，机器人：1，无人机：2
      current_fac              INTEGER DEFAULT NULL,  -- 是否当前厂站 0-是 1-不是
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      sort_num                 INTEGER DEFAULT NULL  -- 厂站顺序
    )
  `);

  // ==================================================
  // device_voltage
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
      sort_num                 INTEGER DEFAULT NULL,  -- 厂站下电压顺序
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL  -- 更新人
    )
  `);

  // ==================================================
  // device_bay
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
      sort_num                 INTEGER DEFAULT NULL,  -- 电压下间隔顺序
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      repair_flag              INTEGER DEFAULT 0  -- 检修状态
    )
  `);

  // ==================================================
  // device_main
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_main (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      main_device_type         INTEGER DEFAULT NULL,  -- 主设备类型
      main_device_name         TEXT DEFAULT NULL,  -- 主设备名称
      main_device_code         TEXT DEFAULT NULL,  -- 主设备编码
      phase_type               INTEGER DEFAULT NULL,  -- 相位类型：0-主体，1-A相，2-B相，3-C相
      three_phase_flag         INTEGER DEFAULT NULL,  -- 是否是三相设备的标识，0-否，1-是
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
      sort_num                 INTEGER DEFAULT NULL,  -- 间隔下主设备顺序
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
  // device_component
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
      phase_type               INTEGER DEFAULT NULL,  -- 主设备相位类型，0-主体，1-A相，2-B相，3-C相
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
      sort_num                 INTEGER DEFAULT NULL,  -- 主设备下部件顺序
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      repair_flag              INTEGER DEFAULT 0  -- 检修状态
    )
  `);

  // ==================================================
  // device_point
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_point (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 主键id
      point_name               TEXT DEFAULT NULL,  -- 点位名称
      point_code               TEXT DEFAULT NULL,  -- 点位编码
      recognition_type_list    TEXT DEFAULT NULL,  -- 识别类型，多个用逗号分隔
      save_type_list           INTEGER DEFAULT NULL,  -- 采集类型
      meter_type               INTEGER DEFAULT NULL,  -- 表计类型
      position_state_type      INTEGER DEFAULT NULL,  -- 位置状态类型
      appearance_type          INTEGER DEFAULT NULL,  -- 辅助设施类型
      defect_rec_type          TEXT DEFAULT NULL,  -- 缺陷识别类型，多个用逗号分隔
      point_tags_code_list     TEXT DEFAULT NULL,  -- 点位标签编码，多个用,拼接
      defect_judge_type        INTEGER DEFAULT NULL,  -- 是否是缺陷判别，0-否，1-是
      important_level          INTEGER DEFAULT NULL,  -- 重要等级，1-Ⅰ类，2-Ⅱ类，3-Ⅲ类
      sort_num                 INTEGER DEFAULT NULL,  -- 部件下点位顺序
      three_phase_flag         INTEGER DEFAULT NULL,  -- 是否是三相关联点位，0-否，1-是
      three_phase_associate_id TEXT DEFAULT NULL,  -- 三相关联id
      demarcate_state          INTEGER DEFAULT NULL,  -- 标定状态，0-未标定，1-已标定
      robot_id                 INTEGER DEFAULT NULL,  -- 机器人id
      robot_name               TEXT DEFAULT NULL,  -- 机器人名称
      cruise_id                TEXT NOT NULL,  -- 巡检点ID，用于和图像系统交互
      origin_calibration_path  TEXT DEFAULT NULL,  -- 原始标定文件路径
      extend_calibration_path  TEXT DEFAULT NULL,  -- 扩展标定文件路径
      visible_calibration_path TEXT DEFAULT NULL,  -- 可见光标定图片路径
      latest_collect_path      TEXT DEFAULT NULL,  -- 最新的采集文件路径
      thermal_region           TEXT DEFAULT NULL,  -- 粗糙框
      calibration_id           TEXT DEFAULT NULL,  -- 标定id，用于和机器人本体交互
      component_id             INTEGER DEFAULT NULL,  -- 部件id
      component_type           TEXT DEFAULT NULL,  -- 部件类型
      component_name           TEXT DEFAULT NULL,  -- 部件名称
      component_code           TEXT DEFAULT NULL,  -- 部件编码
      main_device_id           INTEGER DEFAULT NULL,  -- 主设备id
      main_device_type         INTEGER DEFAULT NULL,  -- 主设备类型
      main_device_name         TEXT DEFAULT NULL,  -- 主设备名称
      main_device_code         TEXT DEFAULT NULL,  -- 主设备编码
      phase_type               INTEGER DEFAULT NULL,  -- 主设备相位类型，0-主体，1-A相，2-B相，3-C相
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
      inspection_sub_type      TEXT DEFAULT NULL,  -- 巡视子类型,逗号分隔(101:例行巡视, 201:气温骤变特巡, 202:高温特巡, 203:雾霾特巡, 204:大风特巡, 205:下雪特巡, 206:覆冰特巡, 207:雷暴特巡, 208:大（过）负荷特巡, 209:雨后特巡, 210:冰雹特巡, 211:沙尘暴特巡, 212:雪后特巡, 213:缺陷跟踪, 214:新设备投运, 215:重新投运, 216:远方异常告警确认, 217:协助应急事故处理, 218:安防联动, 219:保供电任务, 220:远方状态确认, 221:鸟巢特巡, 301:设备红外测温, 302:油位油温表抄录, 303:避雷器表计抄录, 304:SF6压力表抄录, 305:液压表抄录, 306:位置状态识别, 307:调压档位、次数抄录, 401:自定义巡视, 501:熄灯巡视)
      create_time              TEXT DEFAULT NULL,  -- 创建时间
      create_by                TEXT DEFAULT NULL,  -- 创建人
      update_time              TEXT DEFAULT NULL,  -- 更新时间
      update_by                TEXT DEFAULT NULL,  -- 更新人
      alarm_level              INTEGER DEFAULT NULL,  -- 告警等级
      map_code                 TEXT DEFAULT NULL,  -- 巡检点所在地图
      repair_flag              INTEGER DEFAULT 0,  -- 检修状态
      device_info              TEXT DEFAULT NULL,  -- 对上级模型同步使用，其他地方不用
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
  db.exec("DROP TABLE IF EXISTS fac_info");
}
