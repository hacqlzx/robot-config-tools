import {
  drawingDataLasToScene,
  loadLasCoordinateTransform,
  type FileSource,
  type RayRenderData,
  type RayRenderItem,
} from "@/components/three-d-engine";
import type { TaskImageConfig, TaskManifest, TaskSPConfig, TaskSPPose } from "../types/task";

const DEFAULT_SURVEY_RAY_LENGTH = 4;

interface LoadSurveyRayDrawingDataOptions {
  fileSource: FileSource;
  deviceDir: string;
  modelPath: string;
  rayLength?: number;
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

function buildRay(
  spId: number,
  pose: TaskSPPose | undefined,
  imageKey: string,
  image: TaskImageConfig,
  options: { length: number; name?: string },
): RayRenderItem | null {
  if (!pose) return null;
  const { x, y, z, yaw } = pose;
  if (!finiteNumber(x) || !finiteNumber(y) || !finiteNumber(z) || !finiteNumber(yaw)) return null;

  const height = finiteNumber(image.height) ? image.height : 0;
  const pan = finiteNumber(image.pan) ? image.pan : 0;
  const tilt = finiteNumber(image.tilt) ? image.tilt : 0;
  const heading = yawToRadians(yaw) + degreesToRadians(pan);
  const pitch = degreesToRadians(tilt);
  const horizontal = Math.cos(pitch);
  const direction = normalizeDirection([
    horizontal * Math.cos(heading),
    horizontal * Math.sin(heading),
    Math.sin(pitch),
  ]);
  if (!direction) return null;

  return {
    id: `${spId}:${imageKey}`,
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
  rayLength = DEFAULT_SURVEY_RAY_LENGTH,
}: LoadSurveyRayDrawingDataOptions): Promise<RayRenderData | null> {
  const manifest = await readJson<TaskManifest>(fileSource, pathJoin(deviceDir, "json_list.json"));
  const fileNames = Array.isArray(manifest.file_names)
    ? manifest.file_names.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    : [];
  if (fileNames.length === 0) return null;

  const rays: RayRenderItem[] = [];
  const labeledStopPoints = new Set<string>();

  for (let i = 0; i < fileNames.length; i++) {
    const fileName = fileNames[i];
    const stopPointId = stopPointIdFromFileName(fileName, manifest.ordered_sp?.[i]);
    if (!stopPointId) continue;

    try {
      const spConfig = await readJson<TaskSPConfig>(fileSource, pathJoin(pathJoin(deviceDir, String(stopPointId)), fileName));
      const spId = finiteNumber(spConfig.sp_id) ? spConfig.sp_id : stopPointId;
      const images = Object.entries(spConfig.images || {}).sort(([keyA, a], [keyB, b]) => {
        const locA = Array.isArray(a.pic_loc) ? a.pic_loc : [0, 0];
        const locB = Array.isArray(b.pic_loc) ? b.pic_loc : [0, 0];
        return locA[1] - locB[1] || locA[0] - locB[0] || keyA.localeCompare(keyB);
      });

      for (const [imageKey, image] of images) {
        const labelKey = `${spId}:${image.pic_loc_flag}`;
        const name = labeledStopPoints.has(labelKey) ? undefined : `SP${spId} ${sideLabel(image.pic_loc_flag)}`;
        labeledStopPoints.add(labelKey);
        const ray = buildRay(spId, spConfig.sp_pose, imageKey, image, { length: rayLength, name });
        if (ray) rays.push(ray);
      }
    } catch (e) {
      console.warn("[SurveyRayData] 停靠点射线解析失败:", { fileName, stopPointId, error: e });
    }
  }

  if (rays.length === 0) return null;
  const coordinate = await loadLasCoordinateTransform(fileSource, modelPath);
  return drawingDataLasToScene({ rays }, coordinate) as RayRenderData;
}
