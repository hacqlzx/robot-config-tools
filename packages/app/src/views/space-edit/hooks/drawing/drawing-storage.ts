// 空间绘制数据持久化。
//
// area.json 对外使用机器人区域协议：一个 flat JSON 数组，每条记录用 type 区分区域。
// 编辑器内部仍使用 8 顶点结构，读写时在这里完成 pose(4 点字符串) <-> 8 顶点的转换。

import type { SpaceTreeNode } from "../../types";
import { MAP_DIR_NAME, mapSiblingFilePath, mapSiblingSubPath, projectSubPathFromDir } from "../../utils/space-paths";
import type { PathPoint, PathSegment, PathData } from "./PathDrawing";

/** 绘制类型标识 */
export type DrawingType = "cabinet" | "device-area" | "charging-area";

/** 屏柜绘制记录（一次绘制 = 一个立方体，可沿宽度分隔成多个屏柜） */
export interface CabinetItem {
  id: string;
  type: "cabinet";
  /** 所属区域（电压） */
  area: { id: number; name: string; code: string };
  /** 所属间隔 */
  bay: { id: number; name: string; code: string };
  /** 几何：立方体 8 顶点世界坐标 + 沿前底边的分隔参数 */
  geometry: { verts: number[][]; splits: number[] };
  /** 各分隔屏柜（编码 + 名称） */
  cabinets: { code: string; name: string }[];
  updatedAt: string;
}

/** 充电区域绘制记录（一个矩形区域） */
export interface ChargingAreaItem {
  id: string;
  type: "charging-area";
  /** 几何：立体矩形 8 顶点世界坐标 */
  geometry: { verts: number[][] };
  updatedAt: string;
}

/** 设备区域绘制记录（可多个矩形，每个可绑定间隔） */
export interface DeviceAreaItem {
  id: string;
  type: "device-area";
  /** 几何：立体矩形 8 顶点世界坐标 */
  geometry: { verts: number[][] };
  /** 高度（米） */
  height: number;
  /** 绑定的间隔 */
  bay: { id: number; name: string; code: string } | null;
  updatedAt: string;
}

/** 可行路径绘制记录 */
export interface PathItem {
  points: PathPoint[];
  paths: PathSegment[];
  updatedAt: string;
}

export type DrawingItem = CabinetItem | ChargingAreaItem | DeviceAreaItem;

export interface RobotAreaRecord {
  id?: string | number;
  type?: string | number;
  name?: string;
  pose?: string;
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
  [key: string]: unknown;
}

/** 绘制数据文件名（充电区域、设备区、屏柜共用一个文件） */
export const DRAWING_FILE_NAME = "area.json";
export const LEGACY_DRAWING_FILE_NAME = "充电区域、设备区、屏柜.json";

/** 可行路径单独存储文件名 */
export const PATH_FILE_NAME = "reference_path.txt";
export const LEGACY_PATH_FILE_NAME = "可行驶路径.json";

const AREA_TYPE_CABINET_ROW = "1";
const AREA_TYPE_CABINET = "2";
const AREA_TYPE_CHARGING = "4";
const AREA_TYPE_DEVICE = "8";

type ElectronAPI = NonNullable<Window["electronAPI"]>;
type VecTuple = [number, number, number];

/** 由模型绝对路径推导同目录下 JSON 的绝对路径（读用） */
function jsonAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
}

function legacyJsonAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, LEGACY_DRAWING_FILE_NAME);
}

/** 由模型绝对路径推导项目相对子路径（写用，writeFile 需要项目相对路径） */
function jsonSubPath(modelPath: string): string {
  return mapSiblingSubPath(modelPath, DRAWING_FILE_NAME);
}

/** 路径文件绝对路径（读用） */
function pathAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, PATH_FILE_NAME);
}

function legacyPathAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, LEGACY_PATH_FILE_NAME);
}

/** 路径文件项目相对子路径（写用） */
function pathSubPath(modelPath: string): string {
  return mapSiblingSubPath(modelPath, PATH_FILE_NAME);
}

export function isDrawingDataFileName(name: string): boolean {
  return name === DRAWING_FILE_NAME || name === LEGACY_DRAWING_FILE_NAME;
}

export function isReferencePathFileName(name: string): boolean {
  return name === PATH_FILE_NAME || name === LEGACY_PATH_FILE_NAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatTime(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCoord(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

function toTuple(value: number[]): VecTuple | null {
  const [x, y, z] = value;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : null;
}

function parsePose(pose: unknown): VecTuple[] | null {
  if (typeof pose !== "string") return null;
  const points = pose.split(";")
    .map((part) => part.split(",").map((n) => Number(n.trim())))
    .map((nums) => (nums.length >= 3 && nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2]] as VecTuple : null));
  return points.length === 4 && points.every(Boolean) ? points as VecTuple[] : null;
}

function poseString(points: VecTuple[]): string {
  return points.map((p) => p.map(formatCoord).join(",")).join(";");
}

function add(a: VecTuple, b: VecTuple): VecTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: VecTuple, b: VecTuple): VecTuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lerp(a: VecTuple, b: VecTuple, t: number): VecTuple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function dot(a: VecTuple, b: VecTuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function vertsToPose(verts: number[][], indices: number[]): string | null {
  const points = indices.map((idx) => toTuple(verts[idx])).filter(Boolean) as VecTuple[];
  return points.length === indices.length ? poseString(points) : null;
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

function boxHeightFromPose(points: VecTuple[]): number {
  const up = sub(points[2], points[1]);
  return Math.abs(up[1]) || Math.hypot(up[0], up[1], up[2]) || 1;
}

function cabinetPoseFromVerts(verts: number[][]): string | null {
  return vertsToPose(verts, [0, 1, 2, 6]);
}

function boxPoseFromVerts(verts: number[][]): string | null {
  return vertsToPose(verts, [0, 1, 5, 6]);
}

function sortedSplitBounds(splits: number[]): number[] {
  const middle = splits
    .filter((t) => Number.isFinite(t) && t > 0 && t < 1)
    .sort((a, b) => a - b);
  const deduped = middle.filter((t, idx) => idx === 0 || Math.abs(t - middle[idx - 1]) > 1e-6);
  return [0, ...deduped, 1];
}

function cabinetSegmentVerts(verts: number[][], leftT: number, rightT: number): number[][] | null {
  const v = verts.map(toTuple);
  if (v.some((p) => !p)) return null;
  const vs = v as VecTuple[];
  return [
    lerp(vs[0], vs[1], leftT),
    lerp(vs[0], vs[1], rightT),
    lerp(vs[3], vs[2], rightT),
    lerp(vs[3], vs[2], leftT),
    lerp(vs[4], vs[5], leftT),
    lerp(vs[4], vs[5], rightT),
    lerp(vs[7], vs[6], rightT),
    lerp(vs[7], vs[6], leftT),
  ].map((p) => [...p]);
}

function frontBottomParam(rowVerts: number[][], point: number[]): number | null {
  const a = toTuple(rowVerts[0]);
  const b = toTuple(rowVerts[1]);
  const p = toTuple(point);
  if (!a || !b || !p) return null;
  const width = sub(b, a);
  const len2 = dot(width, width);
  if (len2 < 1e-9) return null;
  return clamp01(dot(sub(p, a), width) / len2);
}

function normalizeAreaData(data: unknown): RobotAreaRecord[] {
  if (Array.isArray(data)) {
    return data.filter(isRecord).map((item) => ({ ...item } as RobotAreaRecord));
  }
  if (isRecord(data) && Array.isArray(data.items)) {
    return legacyItemsToRobotAreas(data.items as DrawingItem[]);
  }
  return [];
}

async function readAreaRecordsFromPath(api: ElectronAPI, filePath: string): Promise<RobotAreaRecord[]> {
  const buf = await api.readLargeFile(filePath);
  const text = new TextDecoder("utf-8").decode(buf);
  return normalizeAreaData(JSON.parse(text));
}

async function readAreaRecords(api: ElectronAPI, modelPath: string): Promise<RobotAreaRecord[]> {
  for (const candidate of [jsonAbsPath(modelPath), legacyJsonAbsPath(modelPath)]) {
    try {
      return await readAreaRecordsFromPath(api, candidate);
    } catch {}
  }
  return [];
}

async function writeAreaRecords(api: ElectronAPI, projectName: string, modelPath: string, records: RobotAreaRecord[]): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(records, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, jsonSubPath(modelPath), buffer);
}

function nextAvailableId(used: Set<number>, start = 1, max = Number.MAX_SAFE_INTEGER): number {
  for (let id = start; id <= max; id++) {
    if (!used.has(id)) return id;
  }
  return Math.max(start, ...Array.from(used)) + 1;
}

function findCabinetRowForItem(records: RobotAreaRecord[], item: CabinetItem): RobotAreaRecord | null {
  const itemName = item.bay?.name || "";
  return records.find((record) =>
    areaType(record) === AREA_TYPE_CABINET_ROW
    && itemName
    && valueText(record.name) === itemName
  ) ?? null;
}

function chooseCabinetRowId(records: RobotAreaRecord[], item: CabinetItem, existingRow: RobotAreaRecord | null): number {
  const existingId = positiveInt(existingRow?.id);
  if (existingId && existingId <= 99) return existingId;

  const used = new Set<number>();
  for (const record of records) {
    if (areaType(record) !== AREA_TYPE_CABINET_ROW) continue;
    const id = positiveInt(record.id);
    if (id && (!existingRow || valueText(existingRow.id) !== valueText(record.id))) used.add(id);
  }

  if (item.bay.id > 0 && item.bay.id <= 99 && !used.has(item.bay.id)) return item.bay.id;
  return nextAvailableId(used, 1, 99);
}

function makeCabinetRobotAreas(item: CabinetItem, rowId: number, time: string, existingRow?: RobotAreaRecord | null): RobotAreaRecord[] {
  const rowPose = cabinetPoseFromVerts(item.geometry.verts);
  if (!rowPose) return [];
  const rowIdText = String(rowId);
  const ip = valueText(existingRow?.ip) || "127.0.0.1";
  const port = asFiniteNumber(existingRow?.port) ?? 0;
  const rowName = item.bay?.name || `柜排${rowIdText}`;
  const records: RobotAreaRecord[] = [{
    id: rowIdText,
    ip,
    name: rowName,
    port,
    pose: rowPose,
    time,
    type: AREA_TYPE_CABINET_ROW,
  }];

  const bounds = sortedSplitBounds(item.geometry.splits || []);
  const count = Math.max(item.cabinets.length, bounds.length - 1);
  for (let i = 0; i < count; i++) {
    const left = bounds[i] ?? (i / count);
    const right = bounds[i + 1] ?? ((i + 1) / count);
    const segmentVerts = cabinetSegmentVerts(item.geometry.verts, left, right);
    const pose = segmentVerts ? cabinetPoseFromVerts(segmentVerts) : null;
    if (!pose) continue;
    const cabinet = item.cabinets[i];
    records.push({
      id: String(rowId * 100 + i + 1),
      ip,
      name: cabinet?.name || `屏柜${i + 1}`,
      parent_id: rowIdText,
      port,
      pose,
      time,
      type: AREA_TYPE_CABINET,
    });
  }
  return records;
}

function legacyItemsToRobotAreas(items: DrawingItem[]): RobotAreaRecord[] {
  const records: RobotAreaRecord[] = [];
  let cabinetRowId = 1;
  let deviceId = 1;
  const time = formatTime();

  for (const item of items || []) {
    if (item?.type === "cabinet") {
      const rowId = cabinetRowId++;
      records.push(...makeCabinetRobotAreas(item, rowId, item.updatedAt || time));
    } else if (item?.type === "charging-area") {
      const pose = boxPoseFromVerts(item.geometry?.verts || []);
      if (pose) {
        records.push({ id: "1", type: AREA_TYPE_CHARGING, name: "充电区域", pose, time: item.updatedAt || time });
      }
    } else if (item?.type === "device-area") {
      const pose = boxPoseFromVerts(item.geometry?.verts || []);
      if (pose) {
        records.push({
          id: String(deviceId++),
          type: AREA_TYPE_DEVICE,
          name: item.bay?.name || `设备区域${deviceId - 1}`,
          pose,
          time: item.updatedAt || time,
        });
      }
    }
  }
  return records;
}

function buildCabinetItem(row: RobotAreaRecord, children: RobotAreaRecord[]): CabinetItem | null {
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
    ? childInfos.map(({ child }, idx) => ({ code: "", name: valueText(child.name) || `屏柜${idx + 1}` }))
    : [{ code: "", name: rowName }];
  const splits = childInfos.length > 1
    ? childInfos.slice(0, -1).map((info, idx) => {
      const fallback = (idx + 1) / childInfos.length;
      return info.end == null ? fallback : clamp01(info.end);
    })
    : [];

  return {
    id: valueText(row.id) || String(rowId),
    type: "cabinet",
    area: { id: 0, name: "", code: "" },
    bay: { id: rowId, name: rowName, code: "" },
    geometry: { verts: rowVerts, splits },
    cabinets,
    updatedAt: valueText(row.time),
  };
}

function robotAreasToDrawingItems(records: RobotAreaRecord[]): DrawingItem[] {
  const items: DrawingItem[] = [];
  const childrenByParent = new Map<string, RobotAreaRecord[]>();
  for (const record of records) {
    if (areaType(record) !== AREA_TYPE_CABINET) continue;
    const parentId = valueText(record.parent_id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) || [];
    children.push(record);
    childrenByParent.set(parentId, children);
  }

  for (const record of records) {
    const type = areaType(record);
    if (type === AREA_TYPE_CABINET_ROW) {
      const item = buildCabinetItem(record, childrenByParent.get(valueText(record.id)) || []);
      if (item) items.push(item);
    } else if (type === AREA_TYPE_CHARGING) {
      const pose = parsePose(record.pose);
      if (!pose) continue;
      items.push({
        id: valueText(record.id) || "1",
        type: "charging-area",
        geometry: { verts: boxPoseToVerts(pose) },
        updatedAt: valueText(record.time),
      });
    } else if (type === AREA_TYPE_DEVICE) {
      const pose = parsePose(record.pose);
      if (!pose) continue;
      const name = valueText(record.name);
      items.push({
        id: valueText(record.id) || String(items.length + 1),
        type: "device-area",
        geometry: { verts: boxPoseToVerts(pose) },
        height: boxHeightFromPose(pose),
        bay: name ? { id: 0, name, code: "" } : null,
        updatedAt: valueText(record.time),
      });
    }
  }
  return items;
}

/**
 * 保存屏柜绘制：读现有 area.json → 替换同名柜排及其柜子 → 写回 flat 数组。
 * 未被当前编辑器处理的其他区域类型会原样保留。
 */
export async function saveCabinetDrawing(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: CabinetItem;
}): Promise<CabinetItem> {
  const { api, projectName, modelPath, item } = params;
  const records = await readAreaRecords(api, modelPath);
  const existingRow = findCabinetRowForItem(records, item);
  const rowId = chooseCabinetRowId(records, item, existingRow);
  const rowIdText = String(rowId);
  const rowIdsToRemove = new Set<string>([rowIdText]);
  if (existingRow?.id != null) rowIdsToRemove.add(valueText(existingRow.id));

  const next = records.filter((record) => {
    const type = areaType(record);
    if (type === AREA_TYPE_CABINET_ROW && rowIdsToRemove.has(valueText(record.id))) return false;
    if (type === AREA_TYPE_CABINET && rowIdsToRemove.has(valueText(record.parent_id))) return false;
    return true;
  });
  const time = formatTime();
  const cabinetRecords = makeCabinetRobotAreas(item, rowId, time, existingRow);
  next.push(...cabinetRecords);
  await writeAreaRecords(api, projectName, modelPath, next);

  return {
    ...item,
    id: rowIdText,
    bay: { id: rowId, name: item.bay.name || `柜排${rowIdText}`, code: item.bay.code },
    updatedAt: time,
  };
}

/** 读取该模型已保存的全部屏柜记录（用于回显） */
export async function loadCabinetItems(api: ElectronAPI, modelPath: string): Promise<CabinetItem[]> {
  return robotAreasToDrawingItems(await readAreaRecords(api, modelPath))
    .filter((it): it is CabinetItem => it.type === "cabinet");
}

/** 保存充电区域：读现有 area.json → 移除旧充电区域记录 → 写入新记录 */
export async function saveChargingArea(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: ChargingAreaItem | null;
}): Promise<void> {
  const { api, projectName, modelPath, item } = params;
  const records = await readAreaRecords(api, modelPath);
  const oldCharging = records.find((record) => areaType(record) === AREA_TYPE_CHARGING);
  const next = records.filter((record) => areaType(record) !== AREA_TYPE_CHARGING);
  if (item) {
    const pose = boxPoseFromVerts(item.geometry.verts);
    if (pose) {
      next.push({
        id: valueText(oldCharging?.id) || "1",
        type: AREA_TYPE_CHARGING,
        name: valueText(oldCharging?.name) || "充电区域",
        pose,
        time: formatTime(),
      });
    }
  }
  await writeAreaRecords(api, projectName, modelPath, next);
}

/** 读取该模型已保存的充电区域记录（用于回显） */
export async function loadChargingArea(api: ElectronAPI, modelPath: string): Promise<ChargingAreaItem | null> {
  const items = robotAreasToDrawingItems(await readAreaRecords(api, modelPath));
  return items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
}

/** 保存设备区域列表：读现有 area.json → 移除旧设备区记录 → 写入新记录列表 */
export async function saveDeviceAreas(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  items: DeviceAreaItem[];
}): Promise<void> {
  const { api, projectName, modelPath, items } = params;
  const records = await readAreaRecords(api, modelPath);
  const next = records.filter((record) => areaType(record) !== AREA_TYPE_DEVICE);
  const used = new Set<number>();

  for (const item of items) {
    let id = positiveInt(item.id);
    if (!id || used.has(id)) id = nextAvailableId(used);
    used.add(id);
    const pose = boxPoseFromVerts(item.geometry.verts);
    if (!pose) continue;
    next.push({
      id: String(id),
      type: AREA_TYPE_DEVICE,
      name: item.bay?.name || `设备区域${id}`,
      pose,
      time: formatTime(),
    });
  }
  await writeAreaRecords(api, projectName, modelPath, next);
}

/** 读取该模型已保存的全部设备区记录（用于回显） */
export async function loadDeviceAreas(api: ElectronAPI, modelPath: string): Promise<DeviceAreaItem[]> {
  return robotAreasToDrawingItems(await readAreaRecords(api, modelPath))
    .filter((it): it is DeviceAreaItem => it.type === "device-area");
}

/** 递归收集目录下所有 JSON 文件中已绑定的间隔 ID（跨模型去重） */
async function collectBoundBayIds(api: ElectronAPI, nodes: SpaceTreeNode[], ids: Set<number>) {
  for (const node of nodes) {
    if (node.isDir && node.children) {
      await collectBoundBayIds(api, node.children, ids);
    } else if (isDrawingDataFileName(node.name)) {
      try {
        const records = await readAreaRecordsFromPath(api, node.path);
        for (const it of robotAreasToDrawingItems(records)) {
          if (it.type === "device-area" && it.bay?.id > 0) ids.add(it.bay.id);
        }
      } catch {}
    }
  }
}

/** 查询整个项目下所有模型里已被设备区绑定的间隔 ID 集合 */
export async function getBoundBayIdsInProject(api: ElectronAPI, projectName: string): Promise<Set<number>> {
  const ids = new Set<number>();
  try {
    const nodes = await api.project.listTree(projectName, MAP_DIR_NAME);
    await collectBoundBayIds(api, nodes, ids);
  } catch {}
  return ids;
}

/** 直接按绘制 JSON 的绝对路径读取屏柜记录（地图树勾选 json 时用） */
export async function loadCabinetItemsFromJson(api: ElectronAPI, jsonPath: string): Promise<CabinetItem[]> {
  try {
    return robotAreasToDrawingItems(await readAreaRecordsFromPath(api, jsonPath))
      .filter((it): it is CabinetItem => it.type === "cabinet");
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取全部记录（地图树勾选 json 时用） */
export async function loadAllItemsFromJson(api: ElectronAPI, jsonPath: string): Promise<DrawingItem[]> {
  try {
    return robotAreasToDrawingItems(await readAreaRecordsFromPath(api, jsonPath));
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取充电区域记录（地图树勾选 json 时用） */
export async function loadChargingAreaFromJson(api: ElectronAPI, jsonPath: string): Promise<ChargingAreaItem | null> {
  try {
    const items = robotAreasToDrawingItems(await readAreaRecordsFromPath(api, jsonPath));
    return items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
  } catch {
    return null;
  }
}

/** 由绘制 JSON 绝对路径推导项目相对子路径（写回用） */
function subPathFromJson(jsonPath: string): string {
  return projectSubPathFromDir(jsonPath, MAP_DIR_NAME, DRAWING_FILE_NAME);
}

/** 删除某柜排记录及其柜子并写回 JSON */
export async function deleteCabinetItem(api: ElectronAPI, projectName: string, jsonPath: string, bayId: number): Promise<void> {
  let records: RobotAreaRecord[] = [];
  try {
    records = await readAreaRecordsFromPath(api, jsonPath);
  } catch {
    return;
  }
  const rowId = String(bayId);
  const next = records.filter((record) => {
    const type = areaType(record);
    if (type === AREA_TYPE_CABINET_ROW && valueText(record.id) === rowId) return false;
    if (type === AREA_TYPE_CABINET && valueText(record.parent_id) === rowId) return false;
    return true;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(next, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, subPathFromJson(jsonPath), buffer);
}

/** 保存可行路径：写入独立的 reference_path.txt */
export async function savePathDrawing(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  data: PathData | null;
}): Promise<void> {
  const { api, projectName, modelPath, data } = params;
  if (!data || data.points.length === 0) {
    // 允许保存空路径，等价于清空当前模型的路径文件内容。
    const bytes = new TextEncoder().encode(JSON.stringify(null));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await api.project.writeFile(projectName, pathSubPath(modelPath), buffer);
    return;
  }
  const content: PathItem = {
    points: data.points,
    paths: data.paths,
    updatedAt: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(content, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, pathSubPath(modelPath), buffer);
}

/** 读取该模型已保存的可行路径记录 */
export async function loadPathDrawing(api: ElectronAPI, modelPath: string): Promise<PathData | null> {
  for (const candidate of [pathAbsPath(modelPath), legacyPathAbsPath(modelPath)]) {
    try {
      const buf = await api.readLargeFile(candidate);
      const text = new TextDecoder("utf-8").decode(buf);
      const data = JSON.parse(text);
      if (!data) return null;
      if (Array.isArray(data.points)) {
        const firstPt = data.points[0];
        if (firstPt && typeof firstPt === "object" && !Array.isArray(firstPt) && "id" in firstPt) {
          return {
            points: (data.points as PathPoint[]).map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z })),
            paths: Array.isArray(data.paths) ? (data.paths as PathSegment[]).map((s) => ({
              id: s.id,
              from: s.from,
              to: s.to,
              bezier: s.bezier,
            })) : [],
          };
        }
        // 旧格式兼容：{ points: number[][], connections: [number, number][] }
        return data as any;
      }
    } catch {}
  }
  return null;
}
