import { loadLasCoordinateTransform, type Vec3Tuple } from "./coordinate-transform";
import { drawingDataLasToScene, type PathPointObject, type PathRenderData, type PathSegmentValue } from "./drawing-data";
import type { FileSource } from "./file-source";

export const ROBOT_PATH_FILE_NAME = "path.json";
export const ROBOT_STOP_POINT_FILE_NAMES = ["stop_points.json", "stop_point.json"] as const;

interface RobotPathRecord {
  id?: string | number;
  name?: string;
  start_id?: string | number;
  end_id?: string | number;
  waypoints?: string;
  [key: string]: unknown;
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

function parseRobotStopPoint(record: Record<string, unknown>): { id: string; point: PathPointObject } | null {
  const id = valueText(record.id);
  const x = asFiniteNumber(record.pose_x);
  const y = asFiniteNumber(record.pose_y);
  const z = asFiniteNumber(record.pose_z) ?? 0;
  if (!id || x == null || y == null) return null;
  return {
    id,
    point: {
      id: `stop:${id}`,
      name: valueText(record.name) || id,
      x,
      y,
      z,
    },
  };
}

export function parseRobotStopPoints(data: unknown): Map<string, PathPointObject> {
  const records = normalizeRecordArray(data, ["stop_points", "stopPoints", "items", "data"]);
  const result = new Map<string, PathPointObject>();
  for (const record of records) {
    const parsed = parseRobotStopPoint(record);
    if (parsed) result.set(parsed.id, parsed.point);
  }
  return result;
}

function parseRobotWaypointString(value: unknown): Vec3Tuple[] {
  if (typeof value !== "string" || !value.trim()) return [];
  return value.split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const numbers = part.split(",").map((number) => Number(number.trim()));
      if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
      const z = Number.isFinite(numbers[2]) ? numbers[2] : 0;
      return [numbers[0], numbers[1], z] as Vec3Tuple;
    })
    .filter((point): point is Vec3Tuple => point !== null);
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

function addRobotRouteSegment(paths: PathSegmentValue[], routeKey: string, from: string | number, to: string | number, index: number) {
  if (from === to) return;
  paths.push({
    id: `route:${routeKey}:seg:${index}`,
    from,
    to,
    bezier: null,
  });
}

export function parseRobotRoutePathData(
  data: unknown,
  stopPoints: ReadonlyMap<string, PathPointObject>,
): PathRenderData | null {
  const routes = normalizeRecordArray(data, ["paths", "routes", "items", "data"]) as RobotPathRecord[];
  const points: PathPointObject[] = [];
  const pointById = new Map<string | number, PathPointObject>();
  const paths: PathSegmentValue[] = [];

  routes.forEach((route, routeIndex) => {
    const startId = valueText(route.start_id);
    const endId = valueText(route.end_id);
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

    parseRobotWaypointString(route.waypoints).forEach((tuple, waypointIndex) => {
      pushPoint({
        id: `route:${routeKey}:wp:${waypointIndex + 1}`,
        x: tuple[0],
        y: tuple[1],
        z: tuple[2],
      });
    });

    pushPoint(stopPoints.get(endId));

    for (let index = 0; index < pointIds.length - 1; index++) {
      addRobotRouteSegment(paths, routeKey, pointIds[index], pointIds[index + 1], index + 1);
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
  const [pathBuffer, stopPointBuffer, coordinate] = await Promise.all([
    fileSource.readAll(pathFilePath),
    fileSource.readAll(stopPointFilePath),
    loadLasCoordinateTransform(fileSource, pathFilePath),
  ]);
  const pathData = parseLooseJsonText(new TextDecoder("utf-8").decode(pathBuffer));
  const stopPointData = parseLooseJsonText(new TextDecoder("utf-8").decode(stopPointBuffer));
  const stopPoints = parseRobotStopPoints(stopPointData);
  const routeData = mergeAllStopPoints(parseRobotRoutePathData(pathData, stopPoints), stopPoints);
  return routeData ? drawingDataLasToScene(routeData, coordinate) as PathRenderData : null;
}
