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
  name?: string;
  geometry: CabinetGeometryData;
  bay?: DrawingBayRef | null;
  cabinets?: DrawingCabinetRef[];
}

export interface BoxRenderItem {
  type: "device-area" | "charging-area";
  name?: string;
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

export interface RobotAreaRecord {
  id?: string | number;
  type?: string | number;
  name?: string;
  pose?: string;
  time?: string;
  parent_id?: string | number;
  [key: string]: unknown;
}

type VecTuple = [number, number, number];

const AREA_TYPE_CABINET_ROW = "1";
const AREA_TYPE_CABINET = "2";
const AREA_TYPE_CHARGING = "4";
const AREA_TYPE_DEVICE = "8";

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

export function isRobotAreaList(data: unknown): data is RobotAreaRecord[] {
  return Array.isArray(data) && data.every(isRecord);
}

export function isCabinetRenderItem(item: unknown): item is CabinetRenderItem {
  return isRecord(item) && item.type === "cabinet";
}

export function isBoxRenderItem(item: unknown): item is BoxRenderItem {
  return isRecord(item) && (item.type === "device-area" || item.type === "charging-area");
}

function areaType(area: RobotAreaRecord): string {
  return String(area.type ?? "");
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value);
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parsePose(pose: unknown): VecTuple[] | null {
  if (typeof pose !== "string") return null;
  const points = pose.split(";")
    .map((part) => part.split(",").map((n) => Number(n.trim())))
    .map((nums) => (nums.length >= 3 && nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2]] as VecTuple : null));
  return points.length === 4 && points.every(Boolean) ? points as VecTuple[] : null;
}

function add(a: VecTuple, b: VecTuple): VecTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: VecTuple, b: VecTuple): VecTuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: VecTuple, b: VecTuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cabinetPoseToVerts(points: VecTuple[]): number[][] {
  const [p0, p1, p2, p6] = points;
  const up = sub(p2, p1);
  const depth = sub(p6, p2);
  const p3 = add(p0, up);
  const p4 = add(p0, depth);
  const p5 = add(p1, depth);
  const p7 = add(p3, depth);
  return [p0, p1, p2, p3, p4, p5, p6, p7].map((p) => [...p]);
}

function boxPoseToVerts(points: VecTuple[]): number[][] {
  const [p0, p1, p5, p6] = points;
  const up = sub(p5, p1);
  const depth = sub(p6, p5);
  const p2 = add(p1, depth);
  const p3 = add(p0, depth);
  const p4 = add(p0, up);
  const p7 = add(p4, depth);
  return [p0, p1, p2, p3, p4, p5, p6, p7].map((p) => [...p]);
}

function frontBottomParam(rowVerts: number[][], point: number[]): number | null {
  const a = pointToTuple(rowVerts[0]);
  const b = pointToTuple(rowVerts[1]);
  const p = pointToTuple(point);
  if (!a || !b || !p) return null;
  const width = sub(b, a);
  const len2 = dot(width, width);
  if (len2 < 1e-9) return null;
  return clamp01(dot(sub(p, a), width) / len2);
}

function buildCabinetRenderItem(row: RobotAreaRecord, children: RobotAreaRecord[]): CabinetRenderItem | null {
  const rowPose = parsePose(row.pose);
  if (!rowPose) return null;
  const rowVerts = cabinetPoseToVerts(rowPose);
  const rowId = positiveInt(row.id) ?? 0;
  const rowName = valueText(row.name) || `柜排${valueText(row.id) || rowId}`;
  const childInfos = children
    .map((child, index) => {
      const pose = parsePose(child.pose);
      const verts = pose ? cabinetPoseToVerts(pose) : null;
      const start = verts ? frontBottomParam(rowVerts, verts[0]) : null;
      const end = verts ? frontBottomParam(rowVerts, verts[1]) : null;
      return { child, index, start, end };
    })
    .sort((a, b) => {
      const ta = a.start ?? (a.index / Math.max(1, children.length));
      const tb = b.start ?? (b.index / Math.max(1, children.length));
      if (Math.abs(ta - tb) > 1e-6) return ta - tb;
      return (positiveInt(a.child.id) ?? a.index) - (positiveInt(b.child.id) ?? b.index);
    });
  const cabinets = childInfos.length > 0
    ? childInfos.map(({ child }, idx) => ({ name: valueText(child.name) || `屏柜${idx + 1}` }))
    : [{ name: rowName }];
  const splits = childInfos.length > 1
    ? childInfos.slice(0, -1).map((info, idx) => info.end == null ? (idx + 1) / childInfos.length : clamp01(info.end))
    : [];
  return {
    type: "cabinet",
    name: rowName,
    geometry: { verts: rowVerts, splits },
    bay: { id: rowId, name: rowName },
    cabinets,
  };
}

export function robotAreasToDrawingItemsData(records: RobotAreaRecord[]): DrawingItemsData {
  const childrenByParent = new Map<string, RobotAreaRecord[]>();
  for (const record of records) {
    if (areaType(record) !== AREA_TYPE_CABINET) continue;
    const parentId = valueText(record.parent_id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) || [];
    children.push(record);
    childrenByParent.set(parentId, children);
  }

  const items: DrawingRenderItem[] = [];
  for (const record of records) {
    const type = areaType(record);
    if (type === AREA_TYPE_CABINET_ROW) {
      const item = buildCabinetRenderItem(record, childrenByParent.get(valueText(record.id)) || []);
      if (item) items.push(item);
    } else if (type === AREA_TYPE_CHARGING) {
      const pose = parsePose(record.pose);
      if (!pose) continue;
      items.push({
        type: "charging-area",
        name: valueText(record.name) || "充电区域",
        geometry: { verts: boxPoseToVerts(pose) },
      });
    } else if (type === AREA_TYPE_DEVICE) {
      const pose = parsePose(record.pose);
      if (!pose) continue;
      const name = valueText(record.name);
      items.push({
        type: "device-area",
        name,
        geometry: { verts: boxPoseToVerts(pose) },
        bay: name ? { id: 0, name } : null,
      });
    }
  }
  return { items };
}
