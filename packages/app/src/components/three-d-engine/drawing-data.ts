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
  start?: number;
  end?: number;
  from?: string | number;
  to?: string | number;
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
  return Array.isArray(data.points) && Array.isArray(data.paths);
}

export function isDrawingItemsData(data: unknown): data is DrawingItemsData {
  if (!isRecord(data)) return false;
  return Array.isArray(data.items);
}

export function isCabinetRenderItem(item: unknown): item is CabinetRenderItem {
  return isRecord(item) && item.type === "cabinet";
}

export function isBoxRenderItem(item: unknown): item is BoxRenderItem {
  return isRecord(item) && (item.type === "device-area" || item.type === "charging-area");
}
