/**
 * 空间绘制数据的兼容门面与持久化编排层。
 *
 * 该文件保留原有公开导出，现有页面和 Hook 无需随着内部拆分一次性迁移；具体职责已拆为：
 * - drawing-schema：纯类型和机器人协议常量；
 * - drawing-coordinate-transform：LAS 绝对坐标与场景相对坐标转换；
 * - area-codec：区域 pose、8 顶点、柜排层级的双向编解码；
 * - path-codec：机器人路径、停靠点和参考路径文本的纯编解码与拓扑校验；
 * - drawing-codec-utils：外部字段校验和稳定文本格式化。
 *
 * 本层只负责 Electron 文件 IO、数据库同步以及多个步骤的执行顺序。description_file.json
 * 对外仍是按 type 区分区域的 flat 数组；更新某类绘制时必须保留其他类型及未知扩展字段。
 */

import type { SpaceTreeNode } from "../../types";
import { fileNameFromPath, MAP_DIR_NAME, mapSiblingFilePath, mapSiblingSubPath, projectSubPathFromDir } from "../../utils/space-paths";
import { loadLasCoordinateTransform } from "../../utils/las-coordinate-transform";
import {
  AREA_TYPE_CABINET,
  AREA_TYPE_CABINET_ROW,
  AREA_TYPE_CHARGING,
  AREA_TYPE_DEVICE,
  DRAWING_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  ROBOT_STOP_POINTS_FILE_NAMES,
  type CabinetItem,
  type ChargingAreaItem,
  type DeviceAreaItem,
  type DrawingItem,
  type PathData,
  type PathPoint,
  type RobotAreaRecord,
} from "./drawing-schema";
import {
  lasPathDataToScene,
  scenePathDataToLas,
} from "./drawing-coordinate-transform";
import {
  areaType,
  boxPoseFromVerts,
  cabinetItemToLas,
  cabinetMainDeviceCode,
  chargingItemToLas,
  chooseCabinetRootId,
  defaultDeviceAreaName,
  deviceAreaItemToLas,
  deviceAreaRecordId,
  findCabinetRootForItem,
  isCabinetRecord,
  makeCabinetRobotAreas,
  normalizeAreaData,
  robotAreasToSceneDrawingItems,
} from "./area-codec";
import {
  formatTime,
  positiveInt,
  valueText,
} from "./drawing-codec-utils";
import {
  isPathStartInChargingArea,
  orderedPathPoints,
  PATH_START_CHARGING_AREA_MESSAGE,
  parseReferencePathText,
  parseRobotRoutePathData,
  parseRobotStopPoints,
  pathTextFromLasPoints,
} from "./path-codec";

export {
  DRAWING_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  ROBOT_STOP_POINTS_FILE_NAMES,
} from "./drawing-schema";

// 继续从历史入口重新导出类型，避免调用方与内部文件布局耦合；后续可按模块逐步迁移而不影响功能。
export type {
  CabinetItem,
  ChargingAreaItem,
  DeviceAreaItem,
  DrawingItem,
  DrawingType,
  PathData,
  PathItem,
  PathPoint,
  PathSegment,
  RobotAreaRecord,
} from "./drawing-schema";

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

export function isDrawingDataFileName(name: string): boolean {
  return name === DRAWING_FILE_NAME;
}

export function isReferencePathFileName(name: string): boolean {
  return name === PATH_FILE_NAME || name === ROBOT_PATH_FILE_NAME;
}

async function readAreaRecordsFromPath(api: ElectronAPI, filePath: string): Promise<RobotAreaRecord[]> {
  const buf = await api.readLargeFile(filePath);
  const text = new TextDecoder("utf-8").decode(buf);
  return normalizeAreaData(JSON.parse(text));
}

async function readJsonFile(api: ElectronAPI, filePath: string): Promise<unknown> {
  const buf = await api.readLargeFile(filePath);
  const text = new TextDecoder("utf-8").decode(buf);
  return JSON.parse(text);
}

async function readTextFile(api: ElectronAPI, filePath: string): Promise<string> {
  const buf = await api.readLargeFile(filePath);
  return new TextDecoder("utf-8").decode(buf);
}

async function readAreaRecords(api: ElectronAPI, modelPath: string): Promise<RobotAreaRecord[]> {
  try {
    return await readAreaRecordsFromPath(api, jsonAbsPath(modelPath));
  } catch {}
  // 首次绘制时文件尚不存在，按空记录集处理；具体保存流程会创建 description_file.json。
  return [];
}

async function writeAreaRecords(api: ElectronAPI, projectName: string, modelPath: string, records: RobotAreaRecord[]): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(records, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, jsonSubPath(modelPath), buffer);
}

/**
 * 保存屏柜绘制。
 *
 * 流程为：读取旧记录 → 定位本次更新的根记录及子屏柜 → 预生成新协议记录 →
 * 删除已失效的本地主设备 → 仅替换目标柜排/屏柜 → 写回完整 flat 数组。
 * 预生成步骤用于在真正写文件前计算新旧设备差异；其他区域类型和未知字段始终原样保留。
 */
export async function saveCabinetDrawing(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: CabinetItem;
}): Promise<CabinetItem> {
  const { api, projectName, modelPath, item } = params;
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  const robotItem = cabinetItemToLas(item, coordinate);
  const records = await readAreaRecords(api, modelPath);
  const existingRoot = findCabinetRootForItem(records, robotItem);
  const rootId = chooseCabinetRootId(records, robotItem, existingRoot);
  const rootIdText = String(rootId);
  const rootIdsToRemove = new Set<string>([rootIdText]);
  if (existingRoot?.id != null) rootIdsToRemove.add(valueText(existingRoot.id));

  const replacedRecords = records.filter((record) => {
    if (isCabinetRecord(record) && rootIdsToRemove.has(valueText(record.id))) return true;
    return areaType(record) === AREA_TYPE_CABINET && rootIdsToRemove.has(valueText(record.parent_id));
  });
  // 先用排除旧记录后的 id 集合生成预览，既可得到最终设备编码，也可提前验证子屏柜 id 不冲突。
  const nextRecordsPreview = makeCabinetRobotAreas(robotItem, rootId, new Set(
    records
      .filter((record) => !replacedRecords.includes(record))
      .map((record) => positiveInt(record.id))
      .filter((id): id is number => id != null),
  ));
  const nextCodes = new Set(nextRecordsPreview.map((record) => cabinetMainDeviceCode(record)).filter(Boolean));
  const nextNames = new Set(nextRecordsPreview.map((record) => valueText(record.name)).filter(Boolean));
  const staleRecords = replacedRecords.filter((record) => {
    const code = cabinetMainDeviceCode(record);
    if (code) return !nextCodes.has(code);
    const name = valueText(record.name);
    return name && !nextNames.has(name);
  });
  if (staleRecords.length > 0) {
    // 先清理数据库中的失效主设备，再落盘新的区域文件，避免文件已经更新但设备树仍残留旧屏柜。
    await deleteCabinetMainDevices(api, projectName, staleRecords);
  }

  // 只移除当前根及其直接子记录；充电区、设备区和协议中的未知类型均保留原顺序与内容。
  const next = records.filter((record) => {
    const type = areaType(record);
    if (isCabinetRecord(record) && rootIdsToRemove.has(valueText(record.id))) return false;
    if (type === AREA_TYPE_CABINET && rootIdsToRemove.has(valueText(record.parent_id))) return false;
    return true;
  });
  const time = formatTime();
  const usedIds = new Set(next.map((record) => positiveInt(record.id)).filter((id): id is number => id != null));
  const cabinetRecords = makeCabinetRobotAreas(robotItem, rootId, usedIds);
  next.push(...cabinetRecords);
  await writeAreaRecords(api, projectName, modelPath, next);

  return {
    ...item,
    id: rootIdText,
    updatedAt: time,
  };
}

/** 读取该模型已保存的全部屏柜记录（用于回显） */
export async function loadCabinetItems(api: ElectronAPI, modelPath: string): Promise<CabinetItem[]> {
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  return robotAreasToSceneDrawingItems(await readAreaRecords(api, modelPath), coordinate)
    .filter((it): it is CabinetItem => it.type === "cabinet");
}

export async function loadCabinetNameSequence(api: ElectronAPI, modelPath: string): Promise<{ cabinetRowStart: number; cabinetStart: number }> {
  const records = await readAreaRecords(api, modelPath);
  let cabinetRowCount = 0;
  let cabinetCount = 0;
  for (const record of records) {
    const type = areaType(record);
    if (type === AREA_TYPE_CABINET_ROW) cabinetRowCount += 1;
    if (type === AREA_TYPE_CABINET) cabinetCount += 1;
  }
  return {
    cabinetRowStart: cabinetRowCount + 1,
    cabinetStart: cabinetCount + 1,
  };
}

/**
 * 保存充电区域：读取旧记录后只替换 type=4。
 * 传入 null 表示删除充电区；重新绘制时沿用旧 id/name，减少外部系统看到的无意义变更。
 */
export async function saveChargingArea(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  item: ChargingAreaItem | null;
}): Promise<void> {
  const { api, projectName, modelPath, item } = params;
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  const records = await readAreaRecords(api, modelPath);
  const oldCharging = records.find((record) => areaType(record) === AREA_TYPE_CHARGING);
  const next = records.filter((record) => areaType(record) !== AREA_TYPE_CHARGING);
  if (item) {
    const robotItem = chargingItemToLas(item, coordinate);
    const pose = boxPoseFromVerts(robotItem.geometry.verts);
    if (pose) {
      next.push({
        id: valueText(oldCharging?.id) || "1",
        type: AREA_TYPE_CHARGING,
        name: valueText(oldCharging?.name) || "充电区域",
        pose,
        pose_3d: pose,
      });
    }
  }
  await writeAreaRecords(api, projectName, modelPath, next);
}

/** 读取该模型已保存的充电区域记录（用于回显） */
export async function loadChargingArea(api: ElectronAPI, modelPath: string): Promise<ChargingAreaItem | null> {
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  const items = robotAreasToSceneDrawingItems(await readAreaRecords(api, modelPath), coordinate);
  return items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
}

/**
 * 保存设备区域列表：一次性替换全部 type=8 记录，其他类型保持不变。
 * 每条记录优先使用绑定间隔 id，重复或无绑定时由 codec 分配空闲 id，确保同文件内不冲突。
 */
export async function saveDeviceAreas(params: {
  api: ElectronAPI;
  projectName: string;
  modelPath: string;
  items: DeviceAreaItem[];
}): Promise<void> {
  const { api, projectName, modelPath, items } = params;
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  const records = await readAreaRecords(api, modelPath);
  const next = records.filter((record) => areaType(record) !== AREA_TYPE_DEVICE);
  const used = new Set<number>();

  for (const item of items) {
    const robotItem = deviceAreaItemToLas(item, coordinate);
    const id = deviceAreaRecordId(item, used);
    used.add(id);
    const pose = boxPoseFromVerts(robotItem.geometry.verts);
    if (!pose) continue;
    next.push({
      id: String(id),
      type: AREA_TYPE_DEVICE,
      name: item.bay?.name || defaultDeviceAreaName(id),
      pose,
      pose_3d: pose,
    });
  }
  await writeAreaRecords(api, projectName, modelPath, next);
}

/** 读取该模型已保存的全部设备区记录（用于回显） */
export async function loadDeviceAreas(api: ElectronAPI, modelPath: string): Promise<DeviceAreaItem[]> {
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  return robotAreasToSceneDrawingItems(await readAreaRecords(api, modelPath), coordinate)
    .filter((it): it is DeviceAreaItem => it.type === "device-area");
}

/** 递归收集目录下所有 JSON 文件中已绑定的间隔 ID（跨模型去重） */
async function collectBoundBayIds(api: ElectronAPI, nodes: SpaceTreeNode[], ids: Set<number>) {
  for (const node of nodes) {
    if (node.isDir && node.children) {
      await collectBoundBayIds(api, node.children, ids);
    } else if (isDrawingDataFileName(node.name)) {
      try {
        const coordinate = await loadLasCoordinateTransform(api, node.path);
        const records = await readAreaRecordsFromPath(api, node.path);
        for (const it of robotAreasToSceneDrawingItems(records, coordinate)) {
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
    const coordinate = await loadLasCoordinateTransform(api, jsonPath);
    return robotAreasToSceneDrawingItems(await readAreaRecordsFromPath(api, jsonPath), coordinate)
      .filter((it): it is CabinetItem => it.type === "cabinet");
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取全部记录（地图树勾选 json 时用） */
export async function loadAllItemsFromJson(api: ElectronAPI, jsonPath: string): Promise<DrawingItem[]> {
  try {
    const coordinate = await loadLasCoordinateTransform(api, jsonPath);
    return robotAreasToSceneDrawingItems(await readAreaRecordsFromPath(api, jsonPath), coordinate);
  } catch {
    return [];
  }
}

/** 直接按绘制 JSON 的绝对路径读取充电区域记录（地图树勾选 json 时用） */
export async function loadChargingAreaFromJson(api: ElectronAPI, jsonPath: string): Promise<ChargingAreaItem | null> {
  try {
    const coordinate = await loadLasCoordinateTransform(api, jsonPath);
    const items = robotAreasToSceneDrawingItems(await readAreaRecordsFromPath(api, jsonPath), coordinate);
    return items.find((it): it is ChargingAreaItem => it.type === "charging-area") ?? null;
  } catch {
    return null;
  }
}

/** 由绘制 JSON 绝对路径推导项目相对子路径（写回用） */
function subPathFromJson(jsonPath: string): string {
  return projectSubPathFromDir(jsonPath, MAP_DIR_NAME, DRAWING_FILE_NAME);
}

async function deleteCabinetMainDevices(
  api: ElectronAPI,
  projectName: string,
  records: RobotAreaRecord[],
): Promise<void> {
  const devices = records
    .filter(isCabinetRecord)
    .map((record) => ({
      code: cabinetMainDeviceCode(record),
      name: valueText(record.name),
    }))
    .filter((device) => device.code || device.name);
  const payload = {
    devices,
  };
  console.log("[屏柜删除] 提交删除主设备", {
    projectName,
    devices: payload.devices,
  });
  const result = await api.deleteCabinetMainDevices(projectName, payload);
  console.log("[屏柜删除] 主设备删除结果", result);
  if (result.unmatched.length > 0) {
    console.warn("[屏柜删除] 存在未按 code/name 精确匹配的屏柜，详见主进程兜底删除日志", result.unmatched);
  }
}

/** 删除某个 description_file.json 中全部屏柜对应的主设备数据 */
export async function deleteCabinetDevicesFromJson(api: ElectronAPI, projectName: string, jsonPath: string): Promise<void> {
  let records: RobotAreaRecord[] = [];
  try {
    records = await readAreaRecordsFromPath(api, jsonPath);
  } catch {
    return;
  }
  await deleteCabinetMainDevices(api, projectName, records.filter(isCabinetRecord));
}

/** 删除某屏柜/柜排记录及其柜子并写回 JSON */
export async function deleteCabinetItem(api: ElectronAPI, projectName: string, jsonPath: string, cabinetId: number): Promise<void> {
  let records: RobotAreaRecord[] = [];
  try {
    records = await readAreaRecordsFromPath(api, jsonPath);
  } catch {
    return;
  }
  const rootId = String(cabinetId);
  const removedRoot = records.find((record) =>
    isCabinetRecord(record)
    && valueText(record.id) === rootId
    && (areaType(record) === AREA_TYPE_CABINET_ROW || !valueText(record.parent_id))
  );
  if (!removedRoot) {
    console.warn("[屏柜删除] 未找到三维屏柜对应的 JSON 记录", { jsonPath, cabinetId, rootId });
    throw new Error(`未找到屏柜记录：${rootId}`);
  }
  const removedRootId = valueText(removedRoot.id);
  const removedChildren = records.filter((record) =>
    areaType(record) === AREA_TYPE_CABINET
    && valueText(record.parent_id) === removedRootId
  );
  const removedRecords = [removedRoot, ...removedChildren];
  console.log("[屏柜删除] 三维删除请求", {
    projectName,
    jsonPath,
    selectedId: cabinetId,
    rootId: removedRootId,
    rootCode: valueText(removedRoot.code),
    childCount: removedChildren.length,
    devices: removedRecords.map((record) => ({ code: cabinetMainDeviceCode(record), name: valueText(record.name) })),
  });
  await deleteCabinetMainDevices(api, projectName, removedRecords);

  const next = records.filter((record) => {
    const type = areaType(record);
    if (isCabinetRecord(record) && valueText(record.id) === removedRootId) return false;
    if (type === AREA_TYPE_CABINET && valueText(record.parent_id) === removedRootId) return false;
    return true;
  });
  const bytes = new TextEncoder().encode(JSON.stringify(next, null, 2));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, subPathFromJson(jsonPath), buffer);
}

function isRobotPathFileName(name: string): boolean {
  return name.toLowerCase() === ROBOT_PATH_FILE_NAME;
}

function robotPathAbsPath(modelPath: string): string {
  return mapSiblingFilePath(modelPath, ROBOT_PATH_FILE_NAME);
}

async function readRobotStopPoints(api: ElectronAPI, pathJsonPath: string): Promise<Map<string, PathPoint>> {
  for (const fileName of ROBOT_STOP_POINTS_FILE_NAMES) {
    try {
      const data = await readJsonFile(api, mapSiblingFilePath(pathJsonPath, fileName));
      const result = parseRobotStopPoints(data);
      if (result.size > 0) return result;
    } catch {}
  }
  return new Map();
}

async function loadRobotRouteDrawing(api: ElectronAPI, pathJsonPath: string): Promise<PathData | null> {
  const [routeData, stopPoints, coordinate] = await Promise.all([
    readJsonFile(api, pathJsonPath),
    readRobotStopPoints(api, pathJsonPath),
    loadLasCoordinateTransform(api, pathJsonPath),
  ]);
  const data = parseRobotRoutePathData(routeData, stopPoints);
  return data ? lasPathDataToScene(data, coordinate) : null;
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
    const bytes = new TextEncoder().encode("");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await api.project.writeFile(projectName, pathSubPath(modelPath), buffer);
    return;
  }
  const coordinate = await loadLasCoordinateTransform(api, modelPath);
  const orderedScenePoints = orderedPathPoints(data);
  const chargingArea = await loadChargingArea(api, modelPath);
  if (!isPathStartInChargingArea(orderedScenePoints[0], chargingArea)) {
    throw new Error(PATH_START_CHARGING_AREA_MESSAGE);
  }
  const robotPoints = scenePathDataToLas({
    points: orderedScenePoints,
    paths: [],
  }, coordinate).points;
  const bytes = new TextEncoder().encode(pathTextFromLasPoints(robotPoints));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await api.project.writeFile(projectName, pathSubPath(modelPath), buffer);
}

/** 读取该模型已保存的可行路径记录 */
export async function loadPathDrawing(api: ElectronAPI, modelPath: string): Promise<PathData | null> {
  const fileName = fileNameFromPath(modelPath);
  const directPathFile = isReferencePathFileName(fileName);
  const candidates = directPathFile
    ? [modelPath]
    : [pathAbsPath(modelPath), robotPathAbsPath(modelPath)];

  for (const candidate of candidates) {
    try {
      if (isRobotPathFileName(fileNameFromPath(candidate))) {
        return await loadRobotRouteDrawing(api, candidate);
      }

      const coordinate = await loadLasCoordinateTransform(api, candidate);
      const text = await readTextFile(api, candidate);
      const textPathData = parseReferencePathText(text);
      if (textPathData) return lasPathDataToScene(textPathData, coordinate);
    } catch {}
  }
  return null;
}
