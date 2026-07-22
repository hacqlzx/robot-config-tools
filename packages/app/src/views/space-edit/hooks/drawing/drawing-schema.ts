/**
 * 空间绘制持久化使用的纯数据模型。
 *
 * 本文件只描述编辑器内存结构和机器人文件协议，不依赖 React、PlayCanvas 或 Electron。
 * 这样编解码、文件读写和绘制交互可以共享同一套类型，同时避免底层协议反向依赖 UI 实现。
 */

export type DrawingType = "cabinet" | "device-area" | "charging-area";

export interface CabinetItem {
  /** 编辑器内用于更新已有记录的稳定标识；写入机器人协议时通常对应柜排/独立屏柜的 id。 */
  id: string;
  type: "cabinet";
  /** 所属区域和间隔信息来自本地设备台账，不属于机器人区域 pose 的几何字段。 */
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  /** 有值时表示整组几何是一排屏柜；独立屏柜保持 null 或省略。 */
  cabinetRow?: { code: string; name: string; bay?: CabinetBayRef | null } | null;
  /** verts 为场景中的 8 个包围盒顶点；splits 为沿柜排宽度方向、取值在 (0, 1) 的分割比例。 */
  geometry: { verts: number[][]; splits: number[] };
  /** 按柜排从左到右排列；顺序必须与 splits 划分出的几何分段一致。 */
  cabinets: { code: string; name: string; bay?: CabinetBayRef | null }[];
  updatedAt: string;
}

export interface CabinetBayRef {
  id: number;
  name: string;
  code: string;
}

export interface ChargingAreaItem {
  id: string;
  type: "charging-area";
  geometry: { verts: number[][] };
  updatedAt: string;
}

export interface DeviceAreaItem {
  id: string;
  type: "device-area";
  geometry: { verts: number[][] };
  height: number;
  bay: { id: number; name: string; code: string } | null;
  updatedAt: string;
}

export interface PathPoint {
  /** 路径拓扑通过稳定 id 关联，不依赖点在数组中的位置。 */
  id: string;
  /** 外部机器人停靠点名称；编辑器手绘点通常没有名称。 */
  name?: string;
  x: number;
  y: number;
  z: number;
}

export interface PathSegment {
  id: string;
  /** 起止值引用 PathPoint.id，点数组重排后连接关系仍然有效。 */
  from: string;
  to: string;
  /** null 表示直线；非 null 时 cp1/cp2 是三次贝塞尔曲线的两个控制点。 */
  bezier: {
    cp1: [number, number, number];
    cp2: [number, number, number];
  } | null;
}

export interface PathData {
  points: PathPoint[];
  paths: PathSegment[];
}

/** 带保存时间的持久化条目；PathData 则是绘制器和坐标转换使用的最小路径数据。 */
export interface PathItem extends PathData {
  updatedAt: string;
}

export type DrawingItem = CabinetItem | ChargingAreaItem | DeviceAreaItem;

/**
 * description_file.json 中的一条机器人区域记录。
 *
 * 该文件来自外部系统，字段类型可能是字符串或数字，因此边界模型保留宽松类型，
 * 真正参与计算前统一由 codec 做格式校验和归一化。索引签名用于无损保留当前编辑器
 * 尚未识别的扩展字段，更新某类区域时不应误删其他系统写入的数据。
 */
export interface RobotAreaRecord {
  /** 区域 id；屏柜子记录通过 parent_id 指向柜排根记录。 */
  id?: string | number;
  /** 区域类型：1=柜排，2=屏柜，4=充电区域，8=设备区域。 */
  type?: string | number;
  name?: string;
  /** 4 个三维点组成的字符串，格式为 x,y,z;x,y,z;x,y,z;x,y,z。 */
  pose?: string;
  /** 保留编辑器 3D 区域四点；点序与旧 pose 一致。 */
  pose_3d?: string;
  time?: string;
  ip?: string;
  port?: string | number;
  parent_id?: string | number;
  class_id?: string | number;
  waste_oil_volume?: string | number;
  sp_id?: string | number;
  cp_id?: string | number;
  start_time?: string;
  end_time?: string;
  code?: string | number;
  /** 屏柜/柜排所属间隔编码。 */
  bay_code?: string | number;
  [key: string]: unknown;
}

export const DRAWING_FILE_NAME = "description_file.json";
export const PATH_FILE_NAME = "reference_path.txt";
export const ROBOT_PATH_FILE_NAME = "path.json";
export const ROBOT_STOP_POINTS_FILE_NAMES = ["stop_points.json", "stop_point.json"] as const;

// 机器人区域协议的类型编码。保持字符串形式，兼容外部 JSON 同时以数字或字符串写入 type。
export const AREA_TYPE_CABINET_ROW = "1";
export const AREA_TYPE_CABINET = "2";
export const AREA_TYPE_CHARGING = "4";
export const AREA_TYPE_DEVICE = "8";
