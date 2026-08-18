import {
  drawingDataLasToScene,
  type RayRenderData,
  type RayRenderItem,
} from "@/space-model/drawing-data";
import { loadLasCoordinateTransform } from "@/space-model/coordinate-transform";
import type { FileSource } from "@/space-model/file-source";
import type { TaskImageConfig, TaskManifest, TaskSPConfig, TaskSPPose } from "../types/task";

const DEFAULT_SURVEY_RAY_LENGTH = 4;

interface LoadSurveyRayDrawingDataOptions {
  /** 文件读取源；当前页面传 Electron 文件源。 */
  fileSource: FileSource;
  /** 设备图任务目录，内部包含 json_list.json 和各停靠点子目录。 */
  deviceDir: string;
  /** 当前地图主点云路径，用于读取 LAS 坐标转换并把机器人坐标转成场景坐标。 */
  modelPath: string;
  /** 可选 stop_points.json 路径；存在时优先用机器人停靠点位姿生成射线。 */
  stopPointFilePath?: string;
  /** 射线显示长度，单位沿用场景坐标。 */
  rayLength?: number;
  /** 输出坐标系；Potree 直接使用 LAS 绝对坐标，旧 PlayCanvas 查看器继续使用 scene 坐标。 */
  outputCoordinates?: "scene" | "las";
}

interface StopPointPose {
  /** 机器人/LAS 坐标系 X。 */
  x: number;
  /** 机器人/LAS 坐标系 Y。 */
  y: number;
  /** 机器人/LAS 坐标系 Z，高度缺失时按 0。 */
  z: number;
  /** 停靠点朝向，兼容弧度和角度输入。 */
  yaw: number;
}

function pathJoin(base: string, child: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${child}`;
}

async function readJson<T>(fileSource: FileSource, filePath: string): Promise<T> {
  const buf = await fileSource.readAll(filePath);
  return JSON.parse(new TextDecoder("utf-8").decode(buf)) as T;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function parseLooseJsonText(text: string): unknown {
  // 现场机器人 JSON 偶尔带尾逗号，先做轻量容错再交给 JSON.parse。
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function yawToRadians(value: number): number {
  return Math.abs(value) > Math.PI * 2 ? degreesToRadians(value) : value;
}

function stopPointIdFromFileName(fileName: string, fallback?: unknown): number | null {
  const parts = fileName.split("_");
  const fromFile = Math.abs(Number.parseInt(parts[1] || "", 10));
  if (Number.isFinite(fromFile) && fromFile > 0) return fromFile;
  const fromFallback = Math.abs(Number(fallback));
  return Number.isFinite(fromFallback) && fromFallback > 0 ? fromFallback : null;
}

function normalizeDirection(direction: [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(len) || len < 1e-9) return null;
  return [direction[0] / len, direction[1] / len, direction[2] / len];
}

function normalizePose(pose: TaskSPPose | StopPointPose | undefined): StopPointPose | null {
  if (!pose) return null;
  const x = asFiniteNumber(pose.x);
  const y = asFiniteNumber(pose.y);
  const z = asFiniteNumber(pose.z) ?? 0;
  const yaw = asFiniteNumber(pose.yaw);
  if (x == null || y == null || yaw == null) return null;
  return { x, y, z, yaw };
}

function parseStopPointPose(record: Record<string, unknown>): { id: string; pose: StopPointPose } | null {
  const id = valueText(record.id);
  const x = asFiniteNumber(record.pose_x);
  const y = asFiniteNumber(record.pose_y);
  const z = asFiniteNumber(record.pose_z) ?? 0;
  const yaw = asFiniteNumber(record.pose_yaw) ?? 0;
  if (!id || x == null || y == null) return null;
  return { id, pose: { x, y, z, yaw } };
}

async function loadStopPointPoseMap(fileSource: FileSource, stopPointFilePath?: string): Promise<Map<string, StopPointPose>> {
  const result = new Map<string, StopPointPose>();
  if (!stopPointFilePath) return result;
  const buf = await fileSource.readAll(stopPointFilePath);
  const data = parseLooseJsonText(new TextDecoder("utf-8").decode(buf));
  const records = normalizeRecordArray(data, ["stop_points", "stopPoints", "items", "data"]);
  for (const record of records) {
    const parsed = parseStopPointPose(record);
    if (parsed) result.set(parsed.id, parsed.pose);
  }
  return result;
}

function buildRay(
  spId: number,
  pose: TaskSPPose | StopPointPose | undefined,
  imageKey: string,
  image: TaskImageConfig,
  options: { length: number; name?: string },
): RayRenderItem | null {
  const normalizedPose = normalizePose(pose);
  if (!normalizedPose) return null;
  const { x, y, z, yaw } = normalizedPose;

  const height = asFiniteNumber(image.height) ?? 0;
  const pan = asFiniteNumber(image.pan) ?? 0;
  const tilt = asFiniteNumber(image.tilt) ?? 0;
  // 机器人云台 pan 以顺时针为正；数学坐标中的 yaw 以逆时针为正。
  // 因此组合水平角时需要用 yaw - pan，否则左右云台的射线会反向。
  const heading = yawToRadians(yaw) - degreesToRadians(pan);
  const pitch = degreesToRadians(tilt);
  const horizontal = Math.cos(pitch);
  const direction = normalizeDirection([
    horizontal * Math.cos(heading),
    horizontal * Math.sin(heading),
    Math.sin(pitch),
  ]);
  if (!direction) return null;

  return {
    id: `${spId}:${image.vis_name || imageKey}`,
    name: options.name,
    origin: [x, y, z + height],
    direction,
    length: options.length,
  };
}

function sideLabel(value: unknown): string {
  return value === "right" ? "右云台" : "左云台";
}

export async function loadSurveyRayDrawingData({
  fileSource,
  deviceDir,
  modelPath,
  stopPointFilePath,
  rayLength = DEFAULT_SURVEY_RAY_LENGTH,
  outputCoordinates = "scene",
}: LoadSurveyRayDrawingDataOptions): Promise<RayRenderData | null> {
  // 优先使用 stop_points.json 的精确停靠点位姿；缺失时回退到每个 SP 配置中的 sp_pose。
  const [manifest, stopPointPoses] = await Promise.all([
    readJson<TaskManifest>(fileSource, pathJoin(deviceDir, "json_list.json")),
    loadStopPointPoseMap(fileSource, stopPointFilePath).catch((e) => {
      console.warn("[SurveyRayData] 停靠点坐标读取失败，回退使用任务 sp_pose:", e);
      return new Map<string, StopPointPose>();
    }),
  ]);
  const fileNames = Array.isArray(manifest.file_names)
    ? manifest.file_names.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  if (fileNames.length === 0) return null;

  const rays: RayRenderItem[] = [];

  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i];
    const stopPointId = stopPointIdFromFileName(fileName, manifest.ordered_sp?.[i]);
    if (!stopPointId) continue;

    try {
      const spConfig = await readJson<TaskSPConfig>(fileSource, pathJoin(pathJoin(deviceDir, String(stopPointId)), fileName));
      const spId = finiteNumber(spConfig.sp_id) ? spConfig.sp_id : stopPointId;
      const cpId = Math.abs(Number(spConfig.cp_id));
      const stopPointPose = stopPointPoses.get(String(spId))
        ?? stopPointPoses.get(String(stopPointId))
        ?? (Number.isFinite(cpId) && cpId > 0 ? stopPointPoses.get(String(cpId)) : undefined);
      // sp_pose 是本次勘察采集时的实际位姿；stop_points.json 是规划停靠点，只在任务位姿缺失时兜底。
      const basePose = normalizePose(spConfig.sp_pose) ?? stopPointPose;
      const images = Object.entries(spConfig.images || {}).sort(([keyA, a], [keyB, b]) => {
        const locA = Array.isArray(a.pic_loc) ? a.pic_loc : [0, 0];
        const locB = Array.isArray(b.pic_loc) ? b.pic_loc : [0, 0];
        return locA[1] - locB[1] || locA[0] - locB[0] || keyA.localeCompare(keyB);
      });

      for (const [imageKey, image] of images) {
        const name = `SP${spId} ${sideLabel(image.pic_loc_flag)}`;
        const ray = buildRay(spId, basePose, imageKey, image, { length: rayLength, name });
        if (ray) rays.push(ray);
      }
    } catch (e) {
      console.warn("[SurveyRayData] 停靠点射线解析失败:", { fileName, stopPointId, error: e });
    }
  }

  if (rays.length === 0) return null;
  if (outputCoordinates === "las") return { rays };
  const coordinate = await loadLasCoordinateTransform(fileSource, modelPath);
  return drawingDataLasToScene({ rays }, coordinate) as RayRenderData;
}
