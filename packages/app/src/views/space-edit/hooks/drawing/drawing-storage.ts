// 空间绘制数据持久化：充电区域、设备区、屏柜 等统一存于模型目录下同一 JSON
// 文件名固定，按 type 标识区分各类绘制，支持二次编辑（按 type 局部更新，互不影响）

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

/** 后续可扩充 device-area 等记录类型 */
export type DrawingItem = CabinetItem | ChargingAreaItem | DeviceAreaItem;

/** 绘制数据文件结构 */
export interface DrawingFile {
  version: number;
  items: DrawingItem[];
}

/** 绘制数据文件名（充电区域、设备区、屏柜共用一个文件） */
export const DRAWING_FILE_NAME = "充电区域、设备区、屏柜.json";

/** 可行路径单独存储文件名 */
export const PATH_FILE_NAME = "可行驶路径.json";

type ElectronAPI = NonNullable<Window["electronAPI"]>;

/** 由模型绝对路径推导同目录下 JSON 的绝对路径（读用） */
function jsonAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, DRAWING_FILE_NAME);
}

/** 由模型绝对路径推导项目相对子路径（写用，writeFile 需要项目相对路径） */
function jsonSubPath(modelPath: string): string {
  return mapSiblingSubPath(modelPath, DRAWING_FILE_NAME);
}

/** 路径文件绝对路径（读用） */
function pathAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, PATH_FILE_NAME);
}

/** 路径文件项目相对子路径（写用） */
function pathSubPath(modelPath: string): string {
  return mapSiblingSubPath(modelPath, PATH_FILE_NAME);
}

/** 读取现有绘制文件（不存在则返回空结构） */
async function readDrawingFile(api: ElectronAPI, modelPath: string): Promise<DrawingFile> {
  try {
    const buf = await api.readLargeFile(jsonAbsPath(modelPath));
    const text = new TextDecoder("utf-8").decode(buf);
    const data = JSON.parse(text) as DrawingFile;
    if (!Array.isArray(data.items)) data.items = [];
    if (typeof data.version !== "number") data.version = 1;
    return data;
  } catch {
    return { version: 1, items: [] };
  }
}

/** 写入绘制文件（覆盖） */
async function writeDrawingFile(api: ElectronAPI, projectName: string, modelPath: string, data: DrawingFile): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, jsonSubPath(modelPath), buffer);
}

/**
 * 保存屏柜绘制：读现有文件 → 替换同一间隔(bay.id)的 cabinet 记录为当前绘制 → 写回。
 * 其他间隔的屏柜及其他 type（充电区域/设备区）保持不变。第一次没有文件则创建。
 */
export async function saveCabinetDrawing(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: CabinetItem;
}): Promise<void> {
  const { api, projectName, modelPath, item } = params;
  const file = await readDrawingFile(api, modelPath);
  file.items = file.items.filter((it) => !(it.type === "cabinet" && it.bay.id === item.bay.id));
  file.items.push(item);
  await writeDrawingFile(api, projectName, modelPath, file);
}

/** 读取该模型已保存的全部屏柜记录（用于回显） */
export async function loadCabinetItems(api: ElectronAPI, modelPath: string): Promise<CabinetItem[]> {
  const file = await readDrawingFile(api, modelPath);
  return file.items.filter((it): it is CabinetItem => it.type === "cabinet");
}

/** 保存充电区域：读现有文件 → 移除旧充电区域记录 → 写入新记录 */
export async function saveChargingArea(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: ChargingAreaItem | null;
}): Promise<void> {
  const { api, projectName, modelPath, item } = params;
  const file = await readDrawingFile(api, modelPath);
  file.items = file.items.filter((it) => it.type !== "charging-area");
  if (item) file.items.push(item);
  await writeDrawingFile(api, projectName, modelPath, file);
}

/** 读取该模型已保存的充电区域记录（用于回显） */
export async function loadChargingArea(api: ElectronAPI, modelPath: string): Promise<ChargingAreaItem | null> {
  const file = await readDrawingFile(api, modelPath);
  return file.items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
}

/** 保存设备区域列表：读现有文件 → 移除旧设备区记录 → 写入新记录列表 */
export async function saveDeviceAreas(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  items: DeviceAreaItem[];
}): Promise<void> {
  const { api, projectName, modelPath, items } = params;
  const file = await readDrawingFile(api, modelPath);
  file.items = file.items.filter((it) => it.type !== "device-area");
  for (const item of items) file.items.push(item);
  await writeDrawingFile(api, projectName, modelPath, file);
}

/** 读取该模型已保存的全部设备区记录（用于回显） */
export async function loadDeviceAreas(api: ElectronAPI, modelPath: string): Promise<DeviceAreaItem[]> {
  const file = await readDrawingFile(api, modelPath);
  return file.items.filter((it): it is DeviceAreaItem => it.type === "device-area");
}

/** 递归收集目录下所有 JSON 文件中已绑定的间隔 ID（跨模型去重） */
async function collectBoundBayIds(api: ElectronAPI, nodes: SpaceTreeNode[], ids: Set<number>) {
  for (const node of nodes) {
    if (node.isDir && node.children) {
      await collectBoundBayIds(api, node.children, ids);
    } else if (node.name === DRAWING_FILE_NAME) {
      try {
        const buf = await api.readLargeFile(node.path);
        const data = JSON.parse(new TextDecoder("utf-8").decode(buf)) as DrawingFile;
        for (const it of data.items || []) {
          if (it.type === "device-area" && (it as DeviceAreaItem).bay) {
            ids.add((it as DeviceAreaItem).bay!.id);
          }
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
    const buf = await api.readLargeFile(jsonPath);
    const data = JSON.parse(new TextDecoder("utf-8").decode(buf)) as DrawingFile;
    if (!Array.isArray(data.items)) return [];
    return data.items.filter((it): it is CabinetItem => it.type === "cabinet");
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取全部记录（地图树勾选 json 时用） */
export async function loadAllItemsFromJson(api: ElectronAPI, jsonPath: string): Promise<DrawingItem[]> {
  try {
    const buf = await api.readLargeFile(jsonPath);
    const data = JSON.parse(new TextDecoder("utf-8").decode(buf)) as DrawingFile;
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取充电区域记录（地图树勾选 json 时用） */
export async function loadChargingAreaFromJson(api: ElectronAPI, jsonPath: string): Promise<ChargingAreaItem | null> {
  try {
    const buf = await api.readLargeFile(jsonPath);
    const data = JSON.parse(new TextDecoder("utf-8").decode(buf)) as DrawingFile;
    if (!Array.isArray(data.items)) return null;
    return data.items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
  } catch {
    return null;
  }
}

/** 由绘制 JSON 绝对路径推导项目相对子路径（写回用） */
function subPathFromJson(jsonPath: string): string {
  return projectSubPathFromDir(jsonPath, MAP_DIR_NAME, DRAWING_FILE_NAME);
}

/** 删除某间隔的屏柜记录并写回 JSON */
export async function deleteCabinetItem(api: ElectronAPI, projectName: string, jsonPath: string, bayId: number): Promise<void> {
  let data: DrawingFile = { version: 1, items: [] };
  try {
    const buf = await api.readLargeFile(jsonPath);
    const parsed = JSON.parse(new TextDecoder("utf-8").decode(buf)) as DrawingFile;
    if (Array.isArray(parsed.items)) data = parsed;
  } catch {
    return;
  }
  data.items = data.items.filter((it) => !(it.type === "cabinet" && it.bay.id === bayId));
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, subPathFromJson(jsonPath), buffer);
}

/** 保存可行路径：写入独立的 可行驶路径.json */
export async function savePathDrawing(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  data: PathData | null;
}): Promise<void> {
  const { api, projectName, modelPath, data } = params;
  if (!data || data.points.length === 0) {
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
  try {
    const buf = await api.readLargeFile(pathAbsPath(modelPath));
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
  return null;
}
