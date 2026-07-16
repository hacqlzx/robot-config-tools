/**
 * 编辑器路径模型与机器人路径文件之间的纯编解码。
 *
 * 当前需要兼容两套外部格式：
 * - `reference_path.txt`：编辑器写入的单条连续示意路径，每行依次为序号和 LAS x/y/z；
 * - `path.json` + `stop_points.json`：机器人只读路径，路线通过起止停靠点和中间 waypoints 组成。
 *
 * 本模块不读取文件、不访问 Electron，也不转换 LAS/场景坐标。调用方负责提供已经解析的
 * JSON 或文本，并在模块输出 `PathData` 后通过 `drawing-coordinate-transform` 转换坐标。
 * 这种边界可让协议兼容、拓扑校验和文本生成脱离运行环境独立验证。
 */

import type { Vec3Tuple } from "../../utils/las-coordinate-transform";
import { toTuple } from "./drawing-coordinate-transform";
import { asFiniteNumber, formatCoord, isRecord, valueText } from "./drawing-codec-utils";
import type {
  ChargingAreaItem,
  PathData,
  PathPoint,
  PathSegment,
} from "./drawing-schema";

export const PATH_START_CHARGING_AREA_MESSAGE = "可行驶路径起点需要在充电区域中";

/** path.json 中当前参与回显的字段；索引签名用于兼容机器人协议的其他扩展字段。 */
interface RobotPathRecord {
  id?: string | number;
  name?: string;
  start_id?: string | number;
  end_id?: string | number;
  /** 中间点字符串，格式为 x,y,z;x,y,z；缺少 z 时按 0 处理。 */
  waypoints?: string;
  [key: string]: unknown;
}

/**
 * 兼容外部 JSON 的数组包装方式。
 * 机器人文件可能直接使用数组，也可能把记录放在 `paths`、`routes`、`stop_points` 等字段中。
 */
function normalizeRecordArray(data: unknown, keys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function parseRobotStopPoint(record: Record<string, unknown>): { id: string; point: PathPoint } | null {
  const id = valueText(record.id);
  const x = asFiniteNumber(record.pose_x);
  const y = asFiniteNumber(record.pose_y);
  const z = asFiniteNumber(record.pose_z) ?? 0;
  if (!id || x == null || y == null) return null;
  return {
    id,
    point: {
      // 添加命名空间，避免机器人停靠点 id 与编辑器生成的普通路径点 id 碰撞。
      id: `stop:${id}`,
      x,
      y,
      z,
    },
  };
}

/**
 * 解析一个停靠点文件。
 * 无效记录会被忽略；同一 id 重复出现时以后出现的有效记录为准，与 Map 的覆盖语义一致。
 */
export function parseRobotStopPoints(data: unknown): Map<string, PathPoint> {
  const records = normalizeRecordArray(data, ["stop_points", "stopPoints", "items"]);
  const result = new Map<string, PathPoint>();
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

function samePathPosition(a: PathPoint | null | undefined, b: PathPoint | null | undefined): boolean {
  if (!a || !b) return false;
  // 起止停靠点可能与首尾 waypoint 重复；按容差去重可避免生成零长度线段。
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-5;
}

function addPathPoint(points: PathPoint[], byId: Map<string, PathPoint>, point: PathPoint): string {
  const existing = byId.get(point.id);
  if (existing) return existing.id;
  points.push(point);
  byId.set(point.id, point);
  return point.id;
}

function addRobotRouteSegment(paths: PathSegment[], routeKey: string, from: string, to: string, index: number) {
  if (from === to) return;
  paths.push({
    id: `route:${routeKey}:seg:${index}`,
    from,
    to,
    // 机器人 waypoints 只描述折线节点，没有贝塞尔控制点，因此按直线段回显。
    bezier: null,
  });
}

/**
 * 将 path.json 与已解析的停靠点合并为编辑器路径。
 *
 * 每条路线按“起点停靠点 → waypoints → 终点停靠点”重建拓扑。路线 id/name 可能缺失或重复，
 * 因此稳定 id 中额外加入数组序号；停靠点则跨路线复用同一个 PathPoint，使共享站点保持同一引用。
 * 找不到起点或终点时仍保留可解析的中间点，至少让不完整的机器人文件可以部分回显。
 */
export function parseRobotRoutePathData(
  data: unknown,
  stopPoints: ReadonlyMap<string, PathPoint>,
): PathData | null {
  const routes = normalizeRecordArray(data, ["paths", "routes", "items"]) as RobotPathRecord[];
  const points: PathPoint[] = [];
  const pointById = new Map<string, PathPoint>();
  const paths: PathSegment[] = [];

  routes.forEach((route, routeIndex) => {
    const startId = valueText(route.start_id);
    const endId = valueText(route.end_id);
    const routeBaseKey = valueText(route.id) || valueText(route.name) || `${startId}_${endId}` || "route";
    const routeKey = `${routeBaseKey}:${routeIndex + 1}`;
    const pointIds: string[] = [];

    const pushPoint = (point: PathPoint | null | undefined) => {
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

/**
 * 按路径段顺序还原保存到 reference_path.txt 的单条折线。
 *
 * 文本协议没有分支、线段 id 或贝塞尔控制点的表达能力，所以保存前必须确认每一段都从上一段
 * 终点继续。孤立点在没有任何线段时允许按当前数组顺序保存；一旦存在路径段则严格按拓扑排序。
 */
export function orderedPathPoints(data: PathData): PathPoint[] {
  if (!data.points.length) return [];
  if (!data.paths.length) return data.points;

  const pointById = new Map(data.points.map((point) => [point.id, point]));
  const ordered: PathPoint[] = [];
  let expectedFrom = "";

  for (const segment of data.paths) {
    const from = pointById.get(segment.from);
    const to = pointById.get(segment.to);
    if (!from || !to) throw new Error("路径包含无效点位，请重新绘制");

    if (ordered.length === 0) {
      ordered.push(from, to);
      expectedFrom = to.id;
      continue;
    }

    if (segment.from !== expectedFrom) {
      throw new Error("示意路径不能有分支，请按单条连续路线绘制");
    }

    ordered.push(to);
    expectedFrom = to.id;
  }

  return ordered;
}

function pointInPolygon2D(point: PathPoint, polygon: Vec3Tuple[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const x = polygon[index][0];
    const z = polygon[index][2];
    const previousX = polygon[previousIndex][0];
    const previousZ = polygon[previousIndex][2];
    const onEdge = Math.abs((point.z - z) * (previousX - x) - (point.x - x) * (previousZ - z)) < 1e-8
      && point.x >= Math.min(x, previousX) - 1e-8
      && point.x <= Math.max(x, previousX) + 1e-8
      && point.z >= Math.min(z, previousZ) - 1e-8
      && point.z <= Math.max(z, previousZ) + 1e-8;
    if (onEdge) return true;
    const intersects = ((z > point.z) !== (previousZ > point.z))
      && point.x < ((previousX - x) * (point.z - z)) / ((previousZ - z) || 1e-12) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * 检查示意路径起点是否落在充电区域底面的 XZ 投影内。
 * 点位于多边形边界时也视为合法；Y 高度不参与判断，以兼容地面采样和区域高度的细小误差。
 */
export function isPathStartInChargingArea(
  startPoint: PathPoint,
  chargingArea: ChargingAreaItem | null,
): boolean {
  const verts = chargingArea?.geometry?.verts || [];
  const base = [verts[0], verts[1], verts[2], verts[3]]
    .map((vertex) => toTuple(vertex))
    .filter((vertex): vertex is Vec3Tuple => vertex !== null);
  return base.length >= 3 && pointInPolygon2D(startPoint, base);
}

/** 生成 reference_path.txt；序号从 1 开始，坐标使用稳定精度且文件末尾保留换行。 */
export function pathTextFromLasPoints(points: PathPoint[]): string {
  const lines = points.map((point, index) =>
    `${index + 1} ${formatCoord(point.x)} ${formatCoord(point.y)} ${formatCoord(point.z)}`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * 解析 reference_path.txt。
 *
 * 同时接受空白或逗号分隔，并忽略常见的中文/英文表头和无效行。文本协议只保存有序点，
 * 因此读取时按相邻点重建直线路段，并生成稳定、与原序号对应的编辑器 id。
 */
export function parseReferencePathText(text: string): PathData | null {
  const points: PathPoint[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^(编号|id|index)(\s|$)/i.test(line)) continue;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 4) continue;
    const id = Number.parseInt(parts[0], 10);
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    if (!Number.isInteger(id) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    points.push({ id: `path:${id}`, x, y, z });
  }
  if (points.length === 0) return null;
  const paths = points.slice(1).map((point, index): PathSegment => ({
    id: `path:${index + 1}_${index + 2}`,
    from: points[index].id,
    to: point.id,
    bezier: null,
  }));
  return { points, paths };
}
