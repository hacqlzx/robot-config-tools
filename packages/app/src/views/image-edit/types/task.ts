/** 任务 JSON 中每张图的配置 */
export interface TaskImageConfig {
  camera_id: number;
  focus: number;
  height: number;
  ir_name: string;
  pan: number;
  pic_loc: [number, number];
  pic_loc_flag: "left" | "right";
  tilt: number;
  vis_name: string;
  zoom: number;
}

/** 任务 JSON 中单个停靠点的采集布局 */
export interface TaskLayout {
  left: [number, number];
  right: [number, number];
}

/** 停靠点位姿 */
export interface TaskSPPose {
  x: number;
  y: number;
  yaw: number;
  z: number;
}

/** 相机内参 */
export interface TaskCameraParams {
  viscamera: { fx: number; fy: number };
  ircamera: { fx: number; fy: number };
}

/** 单停靠点 JSON (sp_id=4 或 7 的配置文件) */
export interface TaskSPConfig {
  calibr_rp: { pitch: number; roll: number };
  collect_divide: { height_divide: number; horizontal_divide: number; vertical_divide: number };
  cp_id: number;
  current_rp: { pitch: number; roll: number };
  icp_result: number[];
  images: Record<string, TaskImageConfig>;
  layout: TaskLayout;
  sp_id: number;
  sp_pose: TaskSPPose;
}

/** json_list.json 任务总配置 */
export interface TaskManifest {
  camera_params: TaskCameraParams;
  fac_id?: string;
  file_names: string[];
  map_code?: string;
  map_id?: string;
  ordered_sp: number[];
  robot_id: string;
}

/** 加载完成后供渲染使用的图片信息 */
export interface TaskLoadedImage {
  /** HTMLImageElement */
  img: HTMLImageElement;
  /** 原始配置 */
  config: TaskImageConfig;
  /** 所属停靠点 ID */
  spId: number;
  /** 所属停靠点目录（相对路径） */
  spDir: string;
  /** 网格列 */
  col: number;
  /** 网格行 */
  row: number;
  /** 云台方向 */
  side: "left" | "right";
  /** 在 canvas 上的绘制区域（由 grid 计算得出） */
  x: number;
  y: number;
  w: number;
  h: number;
}
