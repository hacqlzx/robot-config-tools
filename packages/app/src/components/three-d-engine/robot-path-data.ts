import { loadLasCoordinateTransform, type Vec3Tuple } from "./coordinate-transform";
import { drawingDataLasToScene, type PathPointObject, type PathRenderData, type PathSegmentValue } from "./drawing-data";
import type { FileSource } from "./file-source";

export const ROBOT_PATH_FILE_NAME = "path.json";
export const ROBOT_STOP_POINT_FILE_NAMES = ["stop_points.json", "stop_point.json"] as const;
const REFERENCE_PATH_FILE_NAME = "reference_path.txt";

interface RobotPathRecord {
  id?: string | number;
  name?: string;
  start_id?: string | number;
  end_id?: string | number;
  type?: string | number;
  road_direction?: string | number;
  control_point_a?: string | number;
  control_point_b?: string | number;
  waypoints?: string;
  [key: string]: unknown;
}

interface RobotPathParseOptions {
  /** 机器人路径文件通常省略高度，使用同目录 reference_path.txt 的 LAS-Z 补齐地面高度。 */
  groundZ?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecordArray(data: unknown, keys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

export function parseLooseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

function siblingFilePath(filePath: string, nextFileName: string): string {
  return filePath.replace(/[^\\/]+$/, nextFileName);
}

function referencePathGroundZ(text: string): number | null {
  const zs: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 4 || /^(编号|id|index)$/i.test(parts[0])) continue;
    const z = Number(parts[3]);
    if (Number.isFinite(z)) zs.push(z);
  }
  if (zs.length === 0) return null;
  zs.sort((a, b) => a - b);
  const middle = Math.floor(zs.length / 2);
  return zs.length % 2 === 1 ? zs[middle] : (zs[middle - 1] + zs[middle]) / 2;
}

async function readReferencePathGroundZ(fileSource: FileSource, pathFilePath: string): Promise<number | undefined> {
  try {
    const buffer = await fileSource.readAll(siblingFilePath(pathFilePath, REFERENCE_PATH_FILE_NAME));
    return referencePathGroundZ(new TextDecoder("utf-8").decode(buffer)) ?? undefined;
  } catch {
    return undefined;
  }
}

function robotStopPointName(id: string, type: string, rawName: string): string | undefined {
  if (rawName) return rawName;
  if (type === "4") return undefined;
  return id;
}

function robotGroundZ(options?: RobotPathParseOptions): number {
  return Number.isFinite(options?.groundZ) ? options.groundZ! : 0;
}

function parseRobotStopPoint(record: Record<string, unknown>, options?: RobotPathParseOptions): { id: string; point: PathPointObject } | null {
  const id = valueText(record.id);
  const x = asFiniteNumber(record.pose_x);
  const y = asFiniteNumber(record.pose_y);
  const yaw = asFiniteNumber(record.pose_yaw);
  const type = valueText(record.type);
  if (!id || x == null || y == null) return null;
  return {
    id,
    point: {
      id: `stop:${id}`,
      name: robotStopPointName(id, type, valueText(record.name)),
      x,
      y,
      // 真实机器人停靠点文件通常省略 pose_z；路径回显用参考路径地面高度补齐。
      z: robotGroundZ(options),
      role: "stop",
      ...(type ? { robotType: type } : {}),
      ...(yaw != null ? { yaw } : {}),
    },
  };
}

export function parseRobotStopPoints(data: unknown, options?: RobotPathParseOptions): Map<string, PathPointObject> {
  const records = normalizeRecordArray(data, ["stop_points", "stopPoints", "items", "data"]);
  const result = new Map<string, PathPointObject>();
  for (const record of records) {
    const parsed = parseRobotStopPoint(record, options);
    if (parsed) result.set(parsed.id, parsed.point);
  }
  return result;
}

function parseRobotWaypointString(value: unknown, options?: RobotPathParseOptions): Vec3Tuple[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const groundZ = robotGroundZ(options);
  return value.split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const numbers = part.split(",").map((number) => Number(number.trim()));
      if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
      return [numbers[0], numbers[1], groundZ] as Vec3Tuple;
    })
    .filter((point): point is Vec3Tuple => point !== null);
}

function parseRobotPlanarPoint(value: unknown, options?: RobotPathParseOptions): Vec3Tuple | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const numbers = text.split(/[,_\s]+/)
    .map((part) => Number(part.trim()))
    .filter((number) => Number.isFinite(number));
  if (numbers.length < 2) return null;
  return [numbers[0], numbers[1], robotGroundZ(options)];
}

function samePathPosition(a: PathPointObject | null | undefined, b: PathPointObject | null | undefined): boolean {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-5;
}

function addPathPoint(points: PathPointObject[], byId: Map<string | number, PathPointObject>, point: PathPointObject): string | number {
  const existing = byId.get(point.id);
  if (existing) return existing.id;
  points.push(point);
  byId.set(point.id, point);
  return point.id;
}

function addRobotRouteSegment(
  paths: PathSegmentValue[],
  routeKey: string,
  from: string | number,
  to: string | number,
  index: number,
  options: {
    bezier?: { cp1: Vec3Tuple; cp2: Vec3Tuple } | null;
    routeType?: string;
    roadDirection?: string;
  } = {},
) {
  if (from === to) return;
  paths.push({
    id: `route:${routeKey}:seg:${index}`,
    from,
    to,
    bezier: options.bezier ?? null,
    ...(options.routeType ? { routeType: options.routeType } : {}),
    ...(options.roadDirection ? { roadDirection: options.roadDirection } : {}),
  });
}

export function parseRobotRoutePathData(
  data: unknown,
  stopPoints: ReadonlyMap<string, PathPointObject>,
  options?: RobotPathParseOptions,
): PathRenderData | null {
  const routes = normalizeRecordArray(data, ["paths", "routes", "items", "data"]) as RobotPathRecord[];
  const points: PathPointObject[] = [];
  const pointById = new Map<string | number, PathPointObject>();
  const paths: PathSegmentValue[] = [];

  routes.forEach((route, routeIndex) => {
    const startId = valueText(route.start_id);
    const endId = valueText(route.end_id);
    const routeType = valueText(route.type);
    const roadDirection = valueText(route.road_direction);
    const routeBaseKey = valueText(route.id) || valueText(route.name) || `${startId}_${endId}` || "route";
    const routeKey = `${routeBaseKey}:${routeIndex + 1}`;
    const pointIds: (string | number)[] = [];

    const pushPoint = (point: PathPointObject | null | undefined) => {
      if (!point) return;
      const previousPoint = pointById.get(pointIds[pointIds.length - 1]);
      if (samePathPosition(previousPoint, point)) return;
      pointIds.push(addPathPoint(points, pointById, point));
    };

    pushPoint(stopPoints.get(startId));

    const cp1 = parseRobotPlanarPoint(route.control_point_a, options);
    const cp2 = parseRobotPlanarPoint(route.control_point_b, options);
    if (cp1 && cp2 && stopPoints.has(startId) && stopPoints.has(endId)) {
      pushPoint(stopPoints.get(endId));
      if (pointIds.length >= 2) {
        addRobotRouteSegment(paths, routeKey, pointIds[0], pointIds[1], 1, {
          bezier: { cp1, cp2 },
          routeType,
          roadDirection,
        });
      }
      return;
    }

    parseRobotWaypointString(route.waypoints, options).forEach((tuple, waypointIndex) => {
      pushPoint({
        id: `route:${routeKey}:wp:${waypointIndex + 1}`,
        x: tuple[0],
        y: tuple[1],
        z: tuple[2],
        role: "waypoint",
      });
    });

    pushPoint(stopPoints.get(endId));

    for (let index = 0; index < pointIds.length - 1; index++) {
      addRobotRouteSegment(paths, routeKey, pointIds[index], pointIds[index + 1], index + 1, {
        routeType,
        roadDirection,
      });
    }
  });

  return points.length > 0 ? { points, paths } : null;
}

function mergeAllStopPoints(data: PathRenderData | null, stopPoints: ReadonlyMap<string, PathPointObject>): PathRenderData | null {
  const points = data ? [...data.points] : [];
  const seen = new Set(points.map((point) => isRecord(point) ? point.id : undefined));
  for (const point of stopPoints.values()) {
    if (seen.has(point.id)) continue;
    points.push(point);
    seen.add(point.id);
  }
  return points.length > 0 ? { points, paths: data?.paths || [] } : null;
}

export async function loadRobotRouteDrawingData(params: {
  fileSource: FileSource;
  pathFilePath: string;
  stopPointFilePath: string;
}): Promise<PathRenderData | null> {
  const { fileSource, pathFilePath, stopPointFilePath } = params;
  const [pathBuffer, stopPointBuffer, groundZ, coordinate] = await Promise.all([
    fileSource.readAll(pathFilePath),
    fileSource.readAll(stopPointFilePath),
    readReferencePathGroundZ(fileSource, pathFilePath),
    loadLasCoordinateTransform(fileSource, pathFilePath),
  ]);
  const pathData = parseLooseJsonText(new TextDecoder("utf-8").decode(pathBuffer));
  const stopPointData = parseLooseJsonText(new TextDecoder("utf-8").decode(stopPointBuffer));
  const options = groundZ == null ? undefined : { groundZ };
  const stopPoints = parseRobotStopPoints(stopPointData, options);
  const routeData = mergeAllStopPoints(parseRobotRoutePathData(pathData, stopPoints, options), stopPoints);
  return routeData ? drawingDataLasToScene(routeData, coordinate) as PathRenderData : null;
}
