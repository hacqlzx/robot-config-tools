/**
 * 公共三维回显层的数据契约。
 *
 * 这里刻意只描述“渲染需要的最小形状”，不 import space-edit 的保存类型：
 * - space-edit 可以继续维护更完整的业务字段和持久化逻辑；
 * - image-edit / 其他页面也可以把解析后的 manifest 或 JSON 转成这里的形状再渲染；
 * - DrawingRenderer 只做只读回显和命中选择，不承担业务校验。
 */
export type DrawingItemType = "cabinet" | "device-area" | "charging-area";

export interface DrawingBayRef {
  id: number;
  name?: string;
  code?: string;
}

export interface DrawingCabinetRef {
  code?: string;
  name: string;
}

export interface BoxGeometryData {
  verts: number[][];
}

export interface CabinetGeometryData extends BoxGeometryData {
  splits?: number[];
}

export interface CabinetRenderItem {
  type: "cabinet";
  geometry: CabinetGeometryData;
  bay?: DrawingBayRef | null;
  cabinets?: DrawingCabinetRef[];
}

export interface BoxRenderItem {
  type: "device-area" | "charging-area";
  geometry: BoxGeometryData;
  bay?: DrawingBayRef | null;
}

export type DrawingRenderItem = CabinetRenderItem | BoxRenderItem;

export interface DrawingItemsData {
  version?: number;
  items: DrawingRenderItem[];
}

export interface PathPointObject {
  id: string | number;
  x: number;
  y: number;
  z: number;
}

export type PathPointValue = PathPointObject | number[];

export interface PathSegmentValue {
  /** 旧格式：通过点数组下标连线。 */
  start?: number;
  end?: number;
  /** 新格式：通过点 id 连线，便于后续路径编辑时保持稳定引用。 */
  from?: string | number;
  to?: string | number;
  /** 当前公共回显仍按直线显示，字段先保留给空间编辑里的贝塞尔路径。 */
  bezier?: unknown;
}

export interface PathRenderData {
  points: PathPointValue[];
  paths: PathSegmentValue[];
}

export type DrawingRenderData = DrawingItemsData | PathRenderData;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isPathPointObject(value: unknown): value is PathPointObject {
  return isRecord(value)
    && (typeof value.id === "string" || typeof value.id === "number")
    && isFiniteNumber(value.x)
    && isFiniteNumber(value.y)
    && isFiniteNumber(value.z);
}

export function pointToTuple(point: PathPointValue): [number, number, number] | null {
  if (Array.isArray(point)) {
    const [x, y, z] = point;
    return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? [x, y, z] : null;
  }
  return isPathPointObject(point) ? [point.x, point.y, point.z] : null;
}

export function isPathRenderData(data: unknown): data is PathRenderData {
  if (!isRecord(data)) return false;
  // 路径文件的核心特征是 points + paths；具体点/边格式在渲染时再逐条容错。
  return Array.isArray(data.points) && Array.isArray(data.paths);
}

export function isDrawingItemsData(data: unknown): data is DrawingItemsData {
  if (!isRecord(data)) return false;
  // 屏柜/设备区/充电区统一存储在 items 数组，type 决定具体渲染方式。
  return Array.isArray(data.items);
}

export function isCabinetRenderItem(item: unknown): item is CabinetRenderItem {
  return isRecord(item) && item.type === "cabinet";
}

export function isBoxRenderItem(item: unknown): item is BoxRenderItem {
  return isRecord(item) && (item.type === "device-area" || item.type === "charging-area");
}
