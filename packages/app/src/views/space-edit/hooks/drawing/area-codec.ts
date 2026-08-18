/**
 * 编辑器区域模型与机器人 description_file.json 协议之间的编解码。
 *
 * 两侧的数据表达并不相同：
 * - 编辑器使用完整的 8 顶点包围盒，便于渲染、拖拽和柜排分段；
 * - 机器人协议使用由 4 个三维点组成的 pose 字符串，其余顶点由平行关系推导；
 * - 机器人协议是 flat 数组，柜排(type=1)与屏柜(type=2)通过 parent_id 表达层级；
 * - 充电区域(type=4)和设备区域(type=8)使用另一套 4 点顺序。
 *
 * 本模块只负责数据和几何转换，不执行文件 IO 或数据库操作。涉及文件坐标时，公开的
 * toLas/toScene 方法会显式完成 LAS 绝对坐标与编辑场景 floating-origin 坐标的转换。
 */

import type { LasCoordinateTransform, Vec3Tuple } from "../../utils/las-coordinate-transform";
import {
  lasVertsToScene,
  sceneVertsToLas,
  toTuple,
} from "./drawing-coordinate-transform";
import {
  formatCoord,
  isRecord,
  positiveInt,
  valueText,
} from "./drawing-codec-utils";
import {
  AREA_TYPE_CABINET,
  AREA_TYPE_CABINET_ROW,
  AREA_TYPE_CHARGING,
  AREA_TYPE_DEVICE,
  type CabinetItem,
  type ChargingAreaItem,
  type DeviceAreaItem,
  type DrawingItem,
  type RobotAreaRecord,
} from "./drawing-schema";

type VecTuple = Vec3Tuple;

/** 将外部协议可能出现的数字 type 统一成字符串，后续比较只使用协议常量。 */
export function areaType(area: RobotAreaRecord): string {
  return String(area.type ?? "");
}

export function cabinetMainDeviceCode(record: RobotAreaRecord): string {
  return valueText(record.code);
}

export function defaultDeviceAreaName(id: string | number): string {
  return `设备区域${valueText(id)}`;
}

function splitTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitTextList(item));
  }
  return valueText(value)
    .split(/[,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function recordBayCodes(record: RobotAreaRecord): string[] {
  return uniqueTexts(splitTextList(record.bay_code));
}

function bayFromRecord(record: RobotAreaRecord, fallback?: CabinetItem["bay"]): CabinetItem["bay"] {
  const code = recordBayCodes(record)[0] || valueText(fallback?.code);
  const name = valueText(fallback?.name);
  return { id: fallback?.id && fallback.id > 0 ? fallback.id : 0, name, code };
}

function bayRecordFields(bay?: CabinetItem["bay"] | null): Partial<RobotAreaRecord> {
  const code = valueText(bay?.code);
  const fields: Partial<RobotAreaRecord> = {};
  if (code) fields.bay_code = code;
  return fields;
}

function aggregateBayRecordFields(bays: Array<CabinetItem["bay"] | null | undefined>): Partial<RobotAreaRecord> {
  const codes = uniqueTexts(bays.map((bay) => valueText(bay?.code)).filter(Boolean));
  const fields: Partial<RobotAreaRecord> = {};
  if (codes.length > 0) fields.bay_code = codes[0];
  return fields;
}

function deviceAreaBayFromRecord(record: RobotAreaRecord): DeviceAreaItem["bay"] {
  // 默认名称表示“只有几何、尚未绑定间隔”，不能伪造一个设备台账关联。
  const id = positiveInt(record.id);
  const name = valueText(record.name);
  if (!id || !name || name === defaultDeviceAreaName(record.id ?? "")) return null;
  return { id, name, code: "" };
}

export function deviceAreaRecordId(item: DeviceAreaItem, used: Set<number>): number {
  // 优先复用已绑定间隔的 id，以便文件记录与本地台账稳定对应；冲突时再逐级降级。
  const boundId = item.bay?.id;
  if (boundId && boundId > 0 && !used.has(boundId)) return boundId;
  const itemId = positiveInt(item.id);
  if (itemId && !used.has(itemId)) return itemId;
  return nextAvailableId(used);
}

function parsePose(pose: unknown): VecTuple[] | null {
  // pose 必须恰好包含 4 个有效三维点。格式不完整时整条几何作废，避免猜测缺失顶点。
  if (typeof pose !== "string") return null;
  const points = pose.split(";")
    .map((part) => part.split(",").map((value) => Number(value.trim())))
    .map((values) => (values.length >= 3 && values.every(Number.isFinite) ? [values[0], values[1], values[2]] as VecTuple : null));
  return points.length === 4 && points.every(Boolean) ? points as VecTuple[] : null;
}

function parseAreaPose(record: RobotAreaRecord): VecTuple[] | null {
  return parsePose(record.pose_3d) ?? parsePose(record.pose);
}

function poseString(points: VecTuple[]): string {
  // 坐标格式由 formatCoord 统一，避免重复保存产生纯格式差异。
  return points.map((point) => point.map(formatCoord).join(",")).join(";");
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

function scale(a: VecTuple, factor: number): VecTuple {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function length(a: VecTuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: VecTuple): VecTuple | null {
  const len = length(a);
  return len > 1e-4 ? scale(a, 1 / len) : null;
}

function cross(a: VecTuple, b: VecTuple): VecTuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function vertsToPose(verts: number[][], indices: number[]): string | null {
  // 不自动补全坏点：只有约定索引全部有效时才生成可被机器人消费的 pose。
  const points = indices.map((index) => toTuple(verts[index])).filter(Boolean) as VecTuple[];
  return points.length === indices.length ? poseString(points) : null;
}

function cabinetPoseToVerts(points: VecTuple[]): number[][] {
  // 屏柜协议只在文件层改为 [0, 1, 2, 4]：第四点是后左下。
  // 读取后仍还原成编辑器内部 8 顶点，因此不改变屏柜绘制交互。
  const [p0, p1, p2, p4] = points;
  const width = sub(p1, p0);
  const widthDir = normalize(width);
  const rawUp = sub(p2, p1);
  const up = widthDir
    ? sub(rawUp, scale(widthDir, dot(rawUp, widthDir)))
    : rawUp;
  const upDir = normalize(up);
  const rawDepth = sub(p4, p0);
  let depth = rawDepth;
  if (widthDir && upDir) {
    let depthDir = normalize(cross(widthDir, upDir));
    if (depthDir) {
      if (dot(depthDir, rawDepth) < 0) depthDir = scale(depthDir, -1);
      const depthLength = Math.abs(dot(rawDepth, depthDir));
      if (depthLength > 1e-4) depth = scale(depthDir, depthLength);
    }
  }
  const p3 = add(p0, up);
  const p5 = add(p1, depth);
  const p6 = add(p2, depth);
  const p7 = add(p3, depth);
  return [p0, p1, p2, p3, p4, p5, p6, p7].map((point) => [...point]);
}

function boxPoseToVerts(points: VecTuple[]): number[][] {
  // 充电区/设备区协议也使用新 A/B/C/D：A/B 为前底边，C 是 B 点正上方，D 是后左下。
  const [p0, p1, p5, p3] = points;
  const up = sub(p5, p1);
  const depth = sub(p3, p0);
  const p2 = add(p1, depth);
  const p4 = add(p0, up);
  const p6 = add(p2, up);
  const p7 = add(p4, depth);
  return [p0, p1, p2, p3, p4, p5, p6, p7].map((point) => [...point]);
}

function boxHeightFromPose(points: VecTuple[]): number {
  const up = sub(points[2], points[1]);
  return Math.abs(up[1]) || Math.hypot(up[0], up[1], up[2]) || 1;
}

function cabinetPoseFromVerts(verts: number[][]): string | null {
  // 仅保存生成 description_file.json 时使用新协议：第四点输出后左下，不改变编辑器内部 8 顶点。
  return vertsToPose(verts, [0, 1, 2, 4]);
}

export function boxPoseFromVerts(verts: number[][]): string | null {
  return vertsToPose(verts, [0, 1, 5, 3]);
}

function sortedSplitBounds(splits: number[]): number[] {
  // splits 只存内部边界。这里过滤越界/无效值、排序并按容差去重，再补上整体两端 0 和 1。
  const middle = splits
    .filter((value) => Number.isFinite(value) && value > 0 && value < 1)
    .sort((a, b) => a - b);
  const deduped = middle.filter((value, index) => index === 0 || Math.abs(value - middle[index - 1]) > 1e-6);
  return [0, ...deduped, 1];
}

function cabinetSegmentVerts(verts: number[][], leftT: number, rightT: number): number[][] | null {
  // 在柜排的四条横向对应边上使用相同插值区间，生成一个保持原高度和深度的子屏柜。
  // 任一根顶点无效时不输出该子记录，避免保存扭曲或带 NaN 的几何。
  const values = verts.map(toTuple);
  if (values.some((point) => !point)) return null;
  const points = values as VecTuple[];
  return [
    lerp(points[0], points[1], leftT),
    lerp(points[0], points[1], rightT),
    lerp(points[3], points[2], rightT),
    lerp(points[3], points[2], leftT),
    lerp(points[4], points[5], leftT),
    lerp(points[4], points[5], rightT),
    lerp(points[7], points[6], rightT),
    lerp(points[7], points[6], leftT),
  ].map((point) => [...point]);
}

function frontBottomParam(rowVerts: number[][], point: number[]): number | null {
  // 将子屏柜前侧底边端点投影到柜排 0→1 轴，得到归一化位置，用于恢复左右顺序和 splits。
  // 使用投影而不是某个世界坐标分量，因此旋转后的柜排仍能正确解析。
  const start = toTuple(rowVerts[0]);
  const end = toTuple(rowVerts[1]);
  const target = toTuple(point);
  if (!start || !end || !target) return null;
  const width = sub(end, start);
  const lengthSquared = dot(width, width);
  if (lengthSquared < 1e-9) return null;
  return clamp01(dot(sub(target, start), width) / lengthSquared);
}

export function normalizeAreaData(data: unknown): RobotAreaRecord[] {
  // 当前协议是 flat 数组；早期版本使用 { items: DrawingItem[] }，读取时即时转换以兼容旧项目。
  // 对当前协议记录做浅拷贝，后续替换记录时不会意外修改 JSON.parse 返回的原对象。
  if (Array.isArray(data)) {
    return data.filter(isRecord).map((item) => ({ ...item } as RobotAreaRecord));
  }
  if (isRecord(data) && Array.isArray(data.items)) {
    return legacyItemsToRobotAreas(data.items as DrawingItem[]);
  }
  return [];
}

function nextAvailableId(used: Set<number>, start = 1, max = Number.MAX_SAFE_INTEGER): number {
  // 从期望起点寻找第一个空闲正整数；上限耗尽时退化到当前最大值之后，仍保证本次写入不冲突。
  for (let id = start; id <= max; id++) {
    if (!used.has(id)) return id;
  }
  return Math.max(start, ...Array.from(used)) + 1;
}

export function isCabinetRecord(record: RobotAreaRecord): boolean {
  const type = areaType(record);
  return type === AREA_TYPE_CABINET_ROW || type === AREA_TYPE_CABINET;
}

function hasCabinetRow(item: CabinetItem): boolean {
  // 只要存在柜排元数据、多个屏柜或有效分割线，就必须写成“根柜排 + 子屏柜”，不能降级为独立屏柜。
  const validSplits = (item.geometry.splits || []).filter((value) => Number.isFinite(value) && value > 0 && value < 1);
  return validSplits.length > 0 || item.cabinets.length > 1 || !!item.cabinetRow;
}

export function findCabinetRootForItem(records: RobotAreaRecord[], item: CabinetItem): RobotAreaRecord | null {
  // 子屏柜可能与根记录使用不同 id；更新时只匹配柜排根或没有 parent_id 的独立屏柜。
  const itemId = positiveInt(item.id);
  if (!itemId) return null;
  return records.find((record) =>
    isCabinetRecord(record)
    && positiveInt(record.id) === itemId
    && (areaType(record) === AREA_TYPE_CABINET_ROW || !valueText(record.parent_id))
  ) ?? null;
}

export function chooseCabinetRootId(records: RobotAreaRecord[], item: CabinetItem, existingRoot: RobotAreaRecord | null): number {
  // 更新时保持原根 id；新增时在所有柜排/屏柜记录中分配空闲 id，避免破坏 parent_id 关系。
  const existingId = positiveInt(existingRoot?.id);
  if (existingId) return existingId;
  const used = new Set<number>();
  for (const record of records) {
    if (!isCabinetRecord(record)) continue;
    const id = positiveInt(record.id);
    if (id) used.add(id);
  }
  return nextAvailableId(used);
}

export function makeCabinetRobotAreas(item: CabinetItem, rootId: number, usedIds: Set<number>): RobotAreaRecord[] {
  // 输入顶点已由调用方转换为 LAS 绝对坐标，本函数仅负责协议形状和层级展开。
  const rowPose = cabinetPoseFromVerts(item.geometry.verts);
  if (!rowPose) return [];
  const rootIdText = String(rootId);
  usedIds.add(rootId);

  if (!hasCabinetRow(item)) {
    // 单个且没有柜排语义的对象直接保存为 type=2，不创建无意义的 type=1 父记录。
    const cabinet = item.cabinets[0];
    return [{
      id: rootIdText,
      name: cabinet?.name || `屏柜${rootIdText}`,
      pose: rowPose,
      pose_3d: rowPose,
      type: AREA_TYPE_CABINET,
      code: valueText(cabinet?.code),
      ...bayRecordFields(cabinet?.bay ?? item.bay),
    }];
  }

  const rowBay = item.cabinetRow?.bay ?? item.bay;
  const records: RobotAreaRecord[] = [{
    id: rootIdText,
    name: item.cabinetRow?.name || `柜排${rootIdText}`,
    pose: rowPose,
    pose_3d: rowPose,
    type: AREA_TYPE_CABINET_ROW,
    ...aggregateBayRecordFields([rowBay, ...item.cabinets.map((cabinet) => cabinet.bay ?? item.bay)]),
  }];
  const bounds = sortedSplitBounds(item.geometry.splits || []);
  // cabinets 和 splits 可能来自旧数据且数量不完全一致，取能表达信息最多的数量并用等分位置兜底。
  const count = Math.max(1, item.cabinets.length, bounds.length - 1);
  for (let index = 0; index < count; index++) {
    const left = bounds[index] ?? (index / count);
    const right = bounds[index + 1] ?? ((index + 1) / count);
    const segmentVerts = cabinetSegmentVerts(item.geometry.verts, left, right);
    const pose = segmentVerts ? cabinetPoseFromVerts(segmentVerts) : null;
    if (!pose) continue;
    const cabinet = item.cabinets[index];
    // 优先使用 rootId*100+序号，便于人工识别父子关系；usedIds 负责避开已有记录和本轮兄弟记录。
    const childId = nextAvailableId(usedIds, rootId * 100 + index + 1);
    usedIds.add(childId);
    records.push({
      id: String(childId),
      name: cabinet?.name || `屏柜${index + 1}`,
      pose,
      pose_3d: pose,
      type: AREA_TYPE_CABINET,
      parent_id: rootIdText,
      code: valueText(cabinet?.code),
      ...bayRecordFields(cabinet?.bay ?? item.bay),
    });
  }
  return records;
}

export function cabinetItemToLas(item: CabinetItem, coordinate: LasCoordinateTransform): CabinetItem {
  return {
    ...item,
    geometry: { ...item.geometry, verts: sceneVertsToLas(item.geometry.verts, coordinate) },
  };
}

function cabinetItemToScene(item: CabinetItem, coordinate: LasCoordinateTransform): CabinetItem {
  return {
    ...item,
    geometry: { ...item.geometry, verts: lasVertsToScene(item.geometry.verts, coordinate) },
  };
}

export function chargingItemToLas(item: ChargingAreaItem, coordinate: LasCoordinateTransform): ChargingAreaItem {
  return { ...item, geometry: { verts: sceneVertsToLas(item.geometry.verts, coordinate) } };
}

function chargingItemToScene(item: ChargingAreaItem, coordinate: LasCoordinateTransform): ChargingAreaItem {
  return { ...item, geometry: { verts: lasVertsToScene(item.geometry.verts, coordinate) } };
}

export function deviceAreaItemToLas(item: DeviceAreaItem, coordinate: LasCoordinateTransform): DeviceAreaItem {
  return { ...item, geometry: { verts: sceneVertsToLas(item.geometry.verts, coordinate) } };
}

function deviceAreaItemToScene(item: DeviceAreaItem, coordinate: LasCoordinateTransform): DeviceAreaItem {
  const verts = lasVertsToScene(item.geometry.verts, coordinate);
  const height = verts.length >= 6
    ? Math.abs((verts[5]?.[1] ?? 0) - (verts[1]?.[1] ?? 0)) || item.height
    : item.height;
  return { ...item, geometry: { verts }, height };
}

function legacyItemsToRobotAreas(items: DrawingItem[]): RobotAreaRecord[] {
  // 旧格式只在读取时转换；后续统一按当前 flat 协议保存，使项目数据自然完成一次性升级。
  const records: RobotAreaRecord[] = [];
  const usedCabinetIds = new Set<number>();
  const usedDeviceIds = new Set<number>();
  for (const item of items || []) {
    if (item?.type === "cabinet") {
      const rootId = nextAvailableId(usedCabinetIds);
      records.push(...makeCabinetRobotAreas(item, rootId, usedCabinetIds));
    } else if (item?.type === "charging-area") {
      const pose = boxPoseFromVerts(item.geometry?.verts || []);
      if (pose) records.push({
        id: "1",
        type: AREA_TYPE_CHARGING,
        name: valueText(item.name) || "充电区域",
        pose,
        pose_3d: pose,
      });
    } else if (item?.type === "device-area") {
      const pose = boxPoseFromVerts(item.geometry?.verts || []);
      if (!pose) continue;
      const id = deviceAreaRecordId(item, usedDeviceIds);
      usedDeviceIds.add(id);
      records.push({
        id: String(id),
        type: AREA_TYPE_DEVICE,
        name: valueText(item.name) || item.bay?.name || defaultDeviceAreaName(id),
        pose,
        pose_3d: pose,
      });
    }
  }
  return records;
}

function buildCabinetItem(row: RobotAreaRecord, children: RobotAreaRecord[]): CabinetItem | null {
  // flat 协议本身不保证子记录数组顺序，因此不能直接用文件顺序恢复“从左到右”的屏柜列表。
  const rowPose = parseAreaPose(row);
  if (!rowPose) return null;
  const rowVerts = cabinetPoseToVerts(rowPose);
  const rowId = positiveInt(row.id) ?? 0;
  const rowName = valueText(row.name) || `柜排${valueText(row.id) || rowId}`;
  const childInfos = children
    .map((child, index) => {
      const pose = parseAreaPose(child);
      const verts = pose ? cabinetPoseToVerts(pose) : null;
      return {
        child,
        index,
        start: verts ? frontBottomParam(rowVerts, verts[0]) : null,
        end: verts ? frontBottomParam(rowVerts, verts[1]) : null,
      };
    })
    .sort((a, b) => {
      // 优先按子屏柜在柜排前底边上的投影位置排序；无有效几何时才回退到原顺序/id。
      const aStart = a.start ?? (a.index / Math.max(1, children.length));
      const bStart = b.start ?? (b.index / Math.max(1, children.length));
      if (Math.abs(aStart - bStart) > 1e-6) return aStart - bStart;
      return (positiveInt(a.child.id) ?? a.index) - (positiveInt(b.child.id) ?? b.index);
    });
  const cabinets = childInfos.length > 0
    ? childInfos.map(({ child }, index) => ({ code: cabinetMainDeviceCode(child), name: valueText(child.name) || `屏柜${index + 1}`, bay: bayFromRecord(child, bayFromRecord(row)) }))
    : [{ code: cabinetMainDeviceCode(row), name: rowName, bay: bayFromRecord(row) }];
  const splits = childInfos.length > 1
    // 每个非末尾子屏柜的右边界就是一条分割线；无法投影时使用等分值保持可编辑性。
    ? childInfos.slice(0, -1).map((info, index) => info.end == null ? (index + 1) / childInfos.length : clamp01(info.end))
    : [];
  const bay = bayFromRecord(row, cabinets[0]?.bay ?? { id: 0, name: "", code: "" });
  return {
    id: valueText(row.id) || String(rowId),
    type: "cabinet",
    area: { id: 0, name: "", code: "" },
    bay,
    cabinetRow: childInfos.length > 0 ? { code: cabinetMainDeviceCode(row), name: rowName, bay } : null,
    geometry: { verts: rowVerts, splits },
    cabinets,
    updatedAt: valueText(row.time),
  };
}

function buildStandaloneCabinetItem(record: RobotAreaRecord): CabinetItem | null {
  // 没有 parent_id 的 type=2 是独立屏柜，在编辑器中不生成 cabinetRow 和 splits。
  const pose = parseAreaPose(record);
  if (!pose) return null;
  const recordId = valueText(record.id);
  const name = valueText(record.name) || `屏柜${recordId || "1"}`;
  return {
    id: recordId || String(positiveInt(record.id) ?? 0),
    type: "cabinet",
    area: { id: 0, name: "", code: "" },
    bay: bayFromRecord(record),
    cabinetRow: null,
    geometry: { verts: cabinetPoseToVerts(pose), splits: [] },
    cabinets: [{ code: cabinetMainDeviceCode(record), name, bay: bayFromRecord(record) }],
    updatedAt: valueText(record.time),
  };
}

function robotAreasToDrawingItems(records: RobotAreaRecord[]): DrawingItem[] {
  const items: DrawingItem[] = [];
  const childrenByParent = new Map<string, RobotAreaRecord[]>();
  // 第一遍先按 parent_id 建索引；第二遍只从根记录构建对象，避免子屏柜被重复显示为独立屏柜。
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
    } else if (type === AREA_TYPE_CABINET && !valueText(record.parent_id)) {
      const item = buildStandaloneCabinetItem(record);
      if (item) items.push(item);
    } else if (type === AREA_TYPE_CHARGING) {
      const pose = parseAreaPose(record);
      if (pose) items.push({
        id: valueText(record.id) || "1",
        type: "charging-area",
        name: valueText(record.name) || "充电区域",
        geometry: { verts: boxPoseToVerts(pose) },
        updatedAt: valueText(record.time),
      });
    } else if (type === AREA_TYPE_DEVICE) {
      const pose = parseAreaPose(record);
      if (pose) items.push({
        id: valueText(record.id) || String(items.length + 1),
        type: "device-area",
        name: valueText(record.name) || defaultDeviceAreaName(record.id ?? items.length + 1),
        geometry: { verts: boxPoseToVerts(pose) },
        height: boxHeightFromPose(pose),
        bay: deviceAreaBayFromRecord(record),
        updatedAt: valueText(record.time),
      });
    }
  }
  return items;
}

/** 将机器人区域协议解码为 LAS 绝对坐标，供 Potree 等原生 LAS 坐标场景使用。 */
export function robotAreasToLasDrawingItems(records: RobotAreaRecord[]): DrawingItem[] {
  return robotAreasToDrawingItems(records);
}

export function robotAreasToSceneDrawingItems(records: RobotAreaRecord[], coordinate: LasCoordinateTransform): DrawingItem[] {
  // description_file.json 保存 LAS 绝对坐标；进入绘制器前统一转换成当前模型的相对场景坐标。
  return robotAreasToDrawingItems(records).map((item) => {
    if (item.type === "cabinet") return cabinetItemToScene(item, coordinate);
    if (item.type === "charging-area") return chargingItemToScene(item, coordinate);
    return deviceAreaItemToScene(item, coordinate);
  });
}
