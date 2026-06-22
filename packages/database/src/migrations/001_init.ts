import type { DbWrapper } from "../core/connection";

export const version = 1;
export const name = "init_all_tables";

export function up(db: DbWrapper): void {



  // ==================================================
  // device_voltage
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_voltage (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 涓婚敭id
      volt_name                TEXT DEFAULT NULL,  -- 鐢靛帇鍚嶇О
      volt_code                TEXT DEFAULT NULL,  -- 鐢靛帇缂栫爜
      alarm_level              INTEGER DEFAULT NULL,  -- 鍛婅绛夌骇
      station_id               INTEGER DEFAULT NULL,  -- 鍘傜珯id
      station_name             TEXT DEFAULT NULL,  -- 鍘傜珯鍚嶇О
      station_code             TEXT DEFAULT NULL,  -- 鍘傜珯缂栫爜
      sort_num                 INTEGER DEFAULT NULL,  -- 鍘傜珯涓嬬數鍘嬮『搴?
      create_time              TEXT DEFAULT NULL,  -- 鍒涘缓鏃堕棿
      create_by                TEXT DEFAULT NULL,  -- 鍒涘缓浜?
      update_time              TEXT DEFAULT NULL,  -- 鏇存柊鏃堕棿
      update_by                TEXT DEFAULT NULL  -- 鏇存柊浜?
    )
  `);

  // ==================================================
  // device_bay
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_bay (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 涓婚敭id
      bay_type                 TEXT DEFAULT NULL,  -- 闂撮殧绫诲瀷
      bay_name                 TEXT DEFAULT NULL,  -- 闂撮殧鍚嶇О
      bay_code                 TEXT DEFAULT NULL,  -- 闂撮殧缂栫爜
      alarm_level              INTEGER DEFAULT NULL,  -- 鍛婅绛夌骇
      volt_id                  INTEGER DEFAULT NULL,  -- 鐢靛帇id
      volt_name                TEXT DEFAULT NULL,  -- 鐢靛帇鍚嶇О
      volt_code                TEXT DEFAULT NULL,  -- 鐢靛帇缂栫爜
      station_id               INTEGER DEFAULT NULL,  -- 鍘傜珯id
      station_name             TEXT DEFAULT NULL,  -- 鍘傜珯鍚嶇О
      station_code             TEXT DEFAULT NULL,  -- 鍘傜珯缂栫爜
      sort_num                 INTEGER DEFAULT NULL,  -- 鐢靛帇涓嬮棿闅旈『搴?
      create_time              TEXT DEFAULT NULL,  -- 鍒涘缓鏃堕棿
      create_by                TEXT DEFAULT NULL,  -- 鍒涘缓浜?
      update_time              TEXT DEFAULT NULL,  -- 鏇存柊鏃堕棿
      update_by                TEXT DEFAULT NULL,  -- 鏇存柊浜?
      repair_flag              INTEGER DEFAULT 0  -- 妫€淇姸鎬?
    )
  `);

  // ==================================================
  // device_main
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_main (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 涓婚敭id
      main_device_type         INTEGER DEFAULT NULL,  -- 涓昏澶囩被鍨?
      main_device_name         TEXT DEFAULT NULL,  -- 涓昏澶囧悕绉?
      main_device_code         TEXT DEFAULT NULL,  -- 涓昏澶囩紪鐮?
      phase_type               INTEGER DEFAULT NULL,  -- 鐩镐綅绫诲瀷锛?-涓讳綋锛?-A鐩革紝2-B鐩革紝3-C鐩?
      three_phase_flag         INTEGER DEFAULT NULL,  -- 鏄惁鏄笁鐩歌澶囩殑鏍囪瘑锛?-鍚︼紝1-鏄?
      three_phase_associate_id TEXT DEFAULT NULL,  -- 涓夌浉璁惧鍏宠仈id
      entity_id                TEXT DEFAULT NULL,  -- 瀹炵墿id
      alarm_level              INTEGER DEFAULT NULL,  -- 鍛婅绛夌骇
      bay_id                   INTEGER DEFAULT NULL,  -- 闂撮殧id
      bay_type                 TEXT DEFAULT NULL,  -- 闂撮殧绫诲瀷
      bay_name                 TEXT DEFAULT NULL,  -- 闂撮殧鍚嶇О
      bay_code                 TEXT DEFAULT NULL,  -- 闂撮殧缂栫爜
      volt_id                  INTEGER DEFAULT NULL,  -- 鐢靛帇id
      volt_name                TEXT DEFAULT NULL,  -- 鐢靛帇鍚嶇О
      volt_code                TEXT DEFAULT NULL,  -- 鐢靛帇缂栫爜
      station_id               INTEGER DEFAULT NULL,  -- 鍘傜珯id
      station_name             TEXT DEFAULT NULL,  -- 鍘傜珯鍚嶇О
      station_code             TEXT DEFAULT NULL,  -- 鍘傜珯缂栫爜
      sort_num                 INTEGER DEFAULT NULL,  -- 闂撮殧涓嬩富璁惧椤哄簭
      create_time              TEXT DEFAULT NULL,  -- 鍒涘缓鏃堕棿
      create_by                TEXT DEFAULT NULL,  -- 鍒涘缓浜?
      update_time              TEXT DEFAULT NULL,  -- 鏇存柊鏃堕棿
      update_by                TEXT DEFAULT NULL,  -- 鏇存柊浜?
      device_model             TEXT DEFAULT NULL,  -- 璁惧鍨嬪彿
      device_source            TEXT DEFAULT NULL,  -- 璁惧鏉ユ簮
      manufacturer             TEXT DEFAULT NULL,  -- 鐢熶骇鍘傚
      production_code          TEXT DEFAULT NULL,  -- 鍑哄巶缂栧彿
      use_company              TEXT DEFAULT NULL,  -- 浣跨敤鍗曚綅
      production_date          TEXT DEFAULT NULL,  -- 鐢熶骇鏃ユ湡
      commissioning_date       TEXT DEFAULT NULL,  -- 鎶曡繍鏃ユ湡
      remark_info              TEXT DEFAULT NULL,  -- 澶囨敞淇℃伅
      repair_flag              INTEGER DEFAULT 0  -- 妫€淇姸鎬?
    )
  `);

  // ==================================================
  // device_component
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_component (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 涓婚敭id
      component_name           TEXT DEFAULT NULL,  -- 閮ㄤ欢鍚嶇О
      component_type           TEXT DEFAULT NULL,  -- 閮ㄤ欢绫诲瀷
      component_code           TEXT DEFAULT NULL,  -- 閮ㄤ欢缂栫爜
      alarm_level              INTEGER DEFAULT NULL,  -- 鍛婅绛夌骇
      main_device_id           INTEGER DEFAULT NULL,  -- 涓昏澶噄d
      main_device_type         INTEGER DEFAULT NULL,  -- 涓昏澶囩被鍨?
      main_device_name         TEXT DEFAULT NULL,  -- 涓昏澶囧悕绉?
      main_device_code         TEXT DEFAULT NULL,  -- 涓昏澶囩紪鐮?
      phase_type               INTEGER DEFAULT NULL,  -- 涓昏澶囩浉浣嶇被鍨嬶紝0-涓讳綋锛?-A鐩革紝2-B鐩革紝3-C鐩?
      bay_id                   INTEGER DEFAULT NULL,  -- 闂撮殧id
      bay_type                 TEXT DEFAULT NULL,  -- 闂撮殧绫诲瀷
      bay_name                 TEXT DEFAULT NULL,  -- 闂撮殧鍚嶇О
      bay_code                 TEXT DEFAULT NULL,  -- 闂撮殧缂栫爜
      volt_id                  INTEGER DEFAULT NULL,  -- 鐢靛帇id
      volt_name                TEXT DEFAULT NULL,  -- 鐢靛帇鍚嶇О
      volt_code                TEXT DEFAULT NULL,  -- 鐢靛帇缂栫爜
      station_id               INTEGER DEFAULT NULL,  -- 鍘傜珯id
      station_name             TEXT DEFAULT NULL,  -- 鍘傜珯鍚嶇О
      station_code             TEXT DEFAULT NULL,  -- 鍘傜珯缂栫爜
      sort_num                 INTEGER DEFAULT NULL,  -- 涓昏澶囦笅閮ㄤ欢椤哄簭
      create_time              TEXT DEFAULT NULL,  -- 鍒涘缓鏃堕棿
      create_by                TEXT DEFAULT NULL,  -- 鍒涘缓浜?
      update_time              TEXT DEFAULT NULL,  -- 鏇存柊鏃堕棿
      update_by                TEXT DEFAULT NULL,  -- 鏇存柊浜?
      repair_flag              INTEGER DEFAULT 0  -- 妫€淇姸鎬?
    )
  `);

  // ==================================================
  // device_point
  // ==================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_point (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,  -- 涓婚敭id
      point_name               TEXT DEFAULT NULL,  -- 鐐逛綅鍚嶇О
      point_code               TEXT DEFAULT NULL,  -- 鐐逛綅缂栫爜
      recognition_type_list    TEXT DEFAULT NULL,  -- 璇嗗埆绫诲瀷锛屽涓敤閫楀彿鍒嗛殧
      save_type_list           INTEGER DEFAULT NULL,  -- 閲囬泦绫诲瀷
      meter_type               INTEGER DEFAULT NULL,  -- 琛ㄨ绫诲瀷
      position_state_type      INTEGER DEFAULT NULL,  -- 浣嶇疆鐘舵€佺被鍨?
      appearance_type          INTEGER DEFAULT NULL,  -- 杈呭姪璁炬柦绫诲瀷
      defect_rec_type          TEXT DEFAULT NULL,  -- 缂洪櫡璇嗗埆绫诲瀷锛屽涓敤閫楀彿鍒嗛殧
      point_tags_code_list     TEXT DEFAULT NULL,  -- 鐐逛綅鏍囩缂栫爜锛屽涓敤,鎷兼帴
      defect_judge_type        INTEGER DEFAULT NULL,  -- 鏄惁鏄己闄峰垽鍒紝0-鍚︼紝1-鏄?
      important_level          INTEGER DEFAULT NULL,  -- 閲嶈绛夌骇锛?-鈪犵被锛?-鈪＄被锛?-鈪㈢被
      sort_num                 INTEGER DEFAULT NULL,  -- 閮ㄤ欢涓嬬偣浣嶉『搴?
      three_phase_flag         INTEGER DEFAULT NULL,  -- 鏄惁鏄笁鐩稿叧鑱旂偣浣嶏紝0-鍚︼紝1-鏄?
      three_phase_associate_id TEXT DEFAULT NULL,  -- 涓夌浉鍏宠仈id
      demarcate_state          INTEGER DEFAULT NULL,  -- 鏍囧畾鐘舵€侊紝0-鏈爣瀹氾紝1-宸叉爣瀹?
      robot_id                 INTEGER DEFAULT NULL,  -- 鏈哄櫒浜篿d
      robot_name               TEXT DEFAULT NULL,  -- 鏈哄櫒浜哄悕绉?
      cruise_id                TEXT NOT NULL,  -- 宸℃鐐笽D锛岀敤浜庡拰鍥惧儚绯荤粺浜や簰
      origin_calibration_path  TEXT DEFAULT NULL,  -- 鍘熷鏍囧畾鏂囦欢璺緞
      extend_calibration_path  TEXT DEFAULT NULL,  -- 鎵╁睍鏍囧畾鏂囦欢璺緞
      visible_calibration_path TEXT DEFAULT NULL,  -- 鍙鍏夋爣瀹氬浘鐗囪矾寰?
      latest_collect_path      TEXT DEFAULT NULL,  -- 鏈€鏂扮殑閲囬泦鏂囦欢璺緞
      thermal_region           TEXT DEFAULT NULL,  -- 绮楃硻妗?
      calibration_id           TEXT DEFAULT NULL,  -- 鏍囧畾id锛岀敤浜庡拰鏈哄櫒浜烘湰浣撲氦浜?
      component_id             INTEGER DEFAULT NULL,  -- 閮ㄤ欢id
      component_type           TEXT DEFAULT NULL,  -- 閮ㄤ欢绫诲瀷
      component_name           TEXT DEFAULT NULL,  -- 閮ㄤ欢鍚嶇О
      component_code           TEXT DEFAULT NULL,  -- 閮ㄤ欢缂栫爜
      main_device_id           INTEGER DEFAULT NULL,  -- 涓昏澶噄d
      main_device_type         INTEGER DEFAULT NULL,  -- 涓昏澶囩被鍨?
      main_device_name         TEXT DEFAULT NULL,  -- 涓昏澶囧悕绉?
      main_device_code         TEXT DEFAULT NULL,  -- 涓昏澶囩紪鐮?
      phase_type               INTEGER DEFAULT NULL,  -- 涓昏澶囩浉浣嶇被鍨嬶紝0-涓讳綋锛?-A鐩革紝2-B鐩革紝3-C鐩?
      bay_id                   INTEGER DEFAULT NULL,  -- 闂撮殧id
      bay_type                 TEXT DEFAULT NULL,  -- 闂撮殧绫诲瀷
      bay_name                 TEXT DEFAULT NULL,  -- 闂撮殧鍚嶇О
      bay_code                 TEXT DEFAULT NULL,  -- 闂撮殧缂栫爜
      volt_id                  INTEGER DEFAULT NULL,  -- 鐢靛帇id
      volt_name                TEXT DEFAULT NULL,  -- 鐢靛帇鍚嶇О
      volt_code                TEXT DEFAULT NULL,  -- 鐢靛帇缂栫爜
      station_id               INTEGER DEFAULT NULL,  -- 鍘傜珯id
      station_name             TEXT DEFAULT NULL,  -- 鍘傜珯鍚嶇О
      station_code             TEXT DEFAULT NULL,  -- 鍘傜珯缂栫爜
      inspection_sub_type      TEXT DEFAULT NULL,  -- 宸¤瀛愮被鍨?閫楀彿鍒嗛殧(101:渚嬭宸¤, 201:姘旀俯楠ゅ彉鐗瑰贰, 202:楂樻俯鐗瑰贰, 203:闆鹃溇鐗瑰贰, 204:澶ч鐗瑰贰, 205:涓嬮洩鐗瑰贰, 206:瑕嗗啺鐗瑰贰, 207:闆锋毚鐗瑰贰, 208:澶э紙杩囷級璐熻嵎鐗瑰贰, 209:闆ㄥ悗鐗瑰贰, 210:鍐伴浌鐗瑰贰, 211:娌欏皹鏆寸壒宸? 212:闆悗鐗瑰贰, 213:缂洪櫡璺熻釜, 214:鏂拌澶囨姇杩? 215:閲嶆柊鎶曡繍, 216:杩滄柟寮傚父鍛婅纭, 217:鍗忓姪搴旀€ヤ簨鏁呭鐞? 218:瀹夐槻鑱斿姩, 219:淇濅緵鐢典换鍔? 220:杩滄柟鐘舵€佺‘璁? 221:楦熷发鐗瑰贰, 301:璁惧绾㈠娴嬫俯, 302:娌逛綅娌规俯琛ㄦ妱褰? 303:閬块浄鍣ㄨ〃璁℃妱褰? 304:SF6鍘嬪姏琛ㄦ妱褰? 305:娑插帇琛ㄦ妱褰? 306:浣嶇疆鐘舵€佽瘑鍒? 307:璋冨帇妗ｄ綅銆佹鏁版妱褰? 401:鑷畾涔夊贰瑙? 501:鐔勭伅宸¤)
      create_time              TEXT DEFAULT NULL,  -- 鍒涘缓鏃堕棿
      create_by                TEXT DEFAULT NULL,  -- 鍒涘缓浜?
      update_time              TEXT DEFAULT NULL,  -- 鏇存柊鏃堕棿
      update_by                TEXT DEFAULT NULL,  -- 鏇存柊浜?
      alarm_level              INTEGER DEFAULT NULL,  -- 鍛婅绛夌骇
      map_code                 TEXT DEFAULT NULL,  -- 宸℃鐐规墍鍦ㄥ湴鍥?
      repair_flag              INTEGER DEFAULT 0,  -- 妫€淇姸鎬?
      device_info              TEXT DEFAULT NULL,  -- 瀵逛笂绾фā鍨嬪悓姝ヤ娇鐢紝鍏朵粬鍦版柟涓嶇敤
      remark                   TEXT DEFAULT NULL  -- 澶囨敞
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

