import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInside,
  assertSafePathSegment,
  resolveProjectDir,
  resolveProjectPath,
  resolveProjectRootPath,
} from "../project-core/project-paths";
import {
  ensureProjectManifest,
  removeManifestAssetsUnderPath,
  updateManifestForWrittenFile,
} from "../project-core/project-manifest";
import { readLasHeader } from "./las-clip";
import type { LasClipBounds, LasHeader } from "./las-clip";
import { ensurePotreeModel } from "./potree-converter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_SUFFIX = "_纠正";
const MAP_MODEL_FILE_NAME = "map.las";
const MAP_INFO_FILE_NAME = "map_info.json";
const DESCRIPTION_FILE_NAME = "description_file.json";
const NORMAL_ANNOTATIONS_FILE_NAME = "normal_annotations.json";
const REFERENCE_PATH_FILE_NAME = "reference_path.txt";
const ROBOT_PATH_FILE_NAME = "path.json";
const ROBOT_STOP_POINT_FILE_NAMES = new Set(["stop_points.json", "stop_point.json"]);
const SKIPPED_DIRECTORY_NAMES = new Set([".potree"]);
const LAS_INT32_LIMIT = 2_147_483_647;
const LAS_INT32_MARGIN = 1024;
const DEFAULT_LAS_SCALE = 0.001;
const activeCorrections = new Map<string, Promise<MapCoordinateCorrectionResult>>();

export type MapCoordinateCorrectionPhase =
  | "preparing"
  | "transforming"
  | "annotations"
  | "potree"
  | "complete";

export interface MapCoordinateCorrectionProgress {
  projectName: string;
  modelPath: string;
  phase: MapCoordinateCorrectionPhase;
  percent: number;
  message: string;
}

export interface MapCoordinateCorrectionResult {
  mapName: string;
  modelPath: string;
  origin: [number, number, number];
}

type ProgressListener = (progress: MapCoordinateCorrectionProgress) => void;
type Vec3 = [number, number, number];

function validateOrigin(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error("新原点坐标无效");
  const origin: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])];
  if (!origin.every(Number.isFinite)) throw new Error("新原点坐标无效");
  return origin;
}

function resolvePdalExecutable(): { executable: string; runtimeDir: string } {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "pdal-runtime")]
    : [
        path.resolve(__dirname, "../src/pdal-runtime"),
        path.resolve(process.cwd(), "src/pdal-runtime"),
        path.resolve(process.cwd(), "packages/app/src/pdal-runtime"),
      ];
  const runtimeDir = candidates.find((candidate) => fs.existsSync(path.join(candidate, "pdal.exe")));
  if (!runtimeDir) throw new Error("未找到 PDAL 运行环境，请检查应用资源是否完整");
  return { executable: path.join(runtimeDir, "pdal.exe"), runtimeDir };
}

function runPdalPipeline(pipelinePath: string): Promise<void> {
  const { executable, runtimeDir } = resolvePdalExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["pipeline", pipelinePath], {
      cwd: runtimeDir,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${runtimeDir}${path.delimiter}${process.env.PATH || ""}`,
      },
    });
    let logTail = "";
    const appendLog = (chunk: Buffer | string) => {
      logTail = `${logTail}${String(chunk)}`.slice(-8_000);
    };
    child.stdout.on("data", appendLog);
    child.stderr.on("data", appendLog);
    child.on("error", (error) => reject(new Error(`无法启动 PDAL: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = logTail.trim().split(/\r?\n/).slice(-8).join("\n");
      reject(new Error(`PDAL 坐标转换失败（退出码 ${code ?? "未知"}）${detail ? `\n${detail}` : ""}`));
    });
  });
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return normalized.toFixed(12).replace(/\.?0+$/, "");
}

function shiftScalar(value: unknown, delta: number): unknown {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(number)) return value;
  const shifted = number - delta;
  return typeof value === "string" ? formatCoordinate(shifted) : shifted;
}

function shiftTuple(value: unknown, origin: Vec3): unknown {
  if (!Array.isArray(value) || value.length < 3) return value;
  const next = [...value];
  next[0] = shiftScalar(next[0], origin[0]);
  next[1] = shiftScalar(next[1], origin[1]);
  next[2] = shiftScalar(next[2], origin[2]);
  return next;
}

function shiftDelimitedPoint(value: string, origin: Vec3): string {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length < 2) return value;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return value;
  const shifted = [formatCoordinate(x - origin[0]), formatCoordinate(y - origin[1])];
  if (parts.length >= 3) {
    const z = Number(parts[2]);
    if (!Number.isFinite(z)) return value;
    shifted.push(formatCoordinate(z - origin[2]), ...parts.slice(3));
  }
  return shifted.join(",");
}

function shiftPoseString(value: unknown, origin: Vec3): unknown {
  if (typeof value !== "string") return value;
  return value.split(";").map((point) => shiftDelimitedPoint(point, origin)).join(";");
}

function walkRecords(value: unknown, visitor: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkRecords(item, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visitor(record);
  Object.values(record).forEach((item) => walkRecords(item, visitor));
}

function shiftDescriptionFile(data: unknown, origin: Vec3): unknown {
  walkRecords(data, (record) => {
    if ("pose" in record) record.pose = shiftPoseString(record.pose, origin);
    if ("pose_3d" in record) record.pose_3d = shiftPoseString(record.pose_3d, origin);
  });
  return data;
}

function shiftNormalAnnotations(data: unknown, origin: Vec3): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const items = (data as Record<string, unknown>).items;
  if (!Array.isArray(items)) return data;
  items.forEach((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      if ("origin" in record) record.origin = shiftTuple(record.origin, origin);
    }
  });
  return data;
}

function shiftWaypointValue(value: unknown, origin: Vec3): unknown {
  if (typeof value === "string") {
    return value.split(";").map((point) => shiftDelimitedPoint(point, origin)).join(";");
  }
  if (Array.isArray(value)) {
    return value.map((point) => {
      if (Array.isArray(point)) return shiftTuple(point, origin);
      if (point && typeof point === "object") {
        const record = point as Record<string, unknown>;
        if ("x" in record) record.x = shiftScalar(record.x, origin[0]);
        if ("y" in record) record.y = shiftScalar(record.y, origin[1]);
        if ("z" in record) record.z = shiftScalar(record.z, origin[2]);
      }
      return point;
    });
  }
  return value;
}

function shiftRobotPathFile(data: unknown, origin: Vec3): unknown {
  walkRecords(data, (record) => {
    if ("pose_x" in record) record.pose_x = shiftScalar(record.pose_x, origin[0]);
    if ("pose_y" in record) record.pose_y = shiftScalar(record.pose_y, origin[1]);
    if ("pose_z" in record) record.pose_z = shiftScalar(record.pose_z, origin[2]);
    if ("waypoints" in record) record.waypoints = shiftWaypointValue(record.waypoints, origin);
    if ("control_point_a" in record && typeof record.control_point_a === "string") {
      record.control_point_a = shiftDelimitedPoint(record.control_point_a.replace(/_/g, ","), origin);
    }
    if ("control_point_b" in record && typeof record.control_point_b === "string") {
      record.control_point_b = shiftDelimitedPoint(record.control_point_b.replace(/_/g, ","), origin);
    }
  });
  return data;
}

async function transformJsonFile(filePath: string, transform: (data: unknown) => unknown): Promise<void> {
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  await fs.promises.writeFile(filePath, `${JSON.stringify(transform(data), null, 2)}\n`, "utf8");
}

async function shiftReferencePath(filePath: string, origin: Vec3): Promise<void> {
  if (!fs.existsSync(filePath)) return;
  const source = await fs.promises.readFile(filePath, "utf8");
  const next = source.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    const parts = trimmed.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 4) return line;
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    if (![x, y, z].every(Number.isFinite)) return line;
    return [
      parts[0],
      formatCoordinate(x - origin[0]),
      formatCoordinate(y - origin[1]),
      formatCoordinate(z - origin[2]),
      ...parts.slice(4),
    ].join(" ");
  }).join("\n");
  await fs.promises.writeFile(filePath, source.endsWith("\n") ? `${next.replace(/\n*$/, "")}\n` : next, "utf8");
}

function shiftedBounds(bounds: LasClipBounds, origin: Vec3): LasClipBounds {
  return {
    minX: bounds.minX - origin[0],
    maxX: bounds.maxX - origin[0],
    minY: bounds.minY - origin[1],
    maxY: bounds.maxY - origin[1],
    minZ: bounds.minZ - origin[2],
    maxZ: bounds.maxZ - origin[2],
  };
}

function boundsFromLasHeader(header: LasHeader): LasClipBounds {
  const bounds = {
    minX: header.minX,
    maxX: header.maxX,
    minY: header.minY,
    maxY: header.maxY,
    minZ: header.minZ,
    maxZ: header.maxZ,
  };
  if (Object.values(bounds).some((value) => !Number.isFinite(value))) {
    throw new Error("LAS 文件的坐标范围无效，无法执行坐标纠正");
  }
  if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY || bounds.minZ > bounds.maxZ) {
    throw new Error("LAS 文件的坐标范围无效，无法执行坐标纠正");
  }
  return bounds;
}

function assertOriginNearBounds(
  origin: Vec3,
  bounds: LasClipBounds,
): void {
  const diagonal = Math.hypot(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  const tolerance = Math.max(0.01, Math.min(10, diagonal * 0.01));
  const outside = [
    origin[0] < bounds.minX - tolerance || origin[0] > bounds.maxX + tolerance,
    origin[1] < bounds.minY - tolerance || origin[1] > bounds.maxY + tolerance,
    origin[2] < bounds.minZ - tolerance || origin[2] > bounds.maxZ + tolerance,
  ];
  if (outside.some(Boolean)) {
    throw new Error("所选纠正点不在当前点云范围内，请在当前地图点云上重新选择");
  }
}

interface LasAxisEncoding {
  scale: number;
  offset: number;
}

/** Pick a stable LAS encoding for translated coordinates while retaining source precision. */
function chooseAxisEncoding(
  min: number,
  max: number,
  preferredScale: number,
): LasAxisEncoding {
  const span = Math.max(0, max - min);
  const sourceScale = Number.isFinite(preferredScale) && preferredScale > 0
    ? preferredScale
    : DEFAULT_LAS_SCALE;
  const usableInt32Range = LAS_INT32_LIMIT - LAS_INT32_MARGIN;
  const minimumScale = span > 0 ? span / (2 * usableInt32Range) : 0;
  const scale = Math.max(sourceScale, minimumScale);
  const offset = (min + max) / 2;
  return { scale, offset: Number.isFinite(offset) ? offset : 0 };
}

function outputLasEncoding(
  bounds: LasClipBounds,
  sourceHeader: LasHeader,
): Record<string, number> {
  const x = chooseAxisEncoding(bounds.minX, bounds.maxX, sourceHeader.scaleX);
  const y = chooseAxisEncoding(bounds.minY, bounds.maxY, sourceHeader.scaleY);
  const z = chooseAxisEncoding(bounds.minZ, bounds.maxZ, sourceHeader.scaleZ);
  return {
    scale_x: x.scale,
    scale_y: y.scale,
    scale_z: z.scale,
    offset_x: x.offset,
    offset_y: y.offset,
    offset_z: z.offset,
  };
}

function formatPdalError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Unable to convert scaled value/i.test(message) && /int32/i.test(message)) {
    return new Error(
      "坐标纠正后的点云超出 LAS 坐标编码范围，请确认选中的点是当前地图中的点，并检查地图坐标系",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function formatMapInfoTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function updateMapInfo(filePath: string, mapName: string, bounds: ReturnType<typeof shiftedBounds>): Promise<void> {
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  data.map_name = mapName;
  data.time = formatMapInfoTime();
  data.point_bounds = bounds;
  await fs.promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function copyCompanionFiles(sourceDir: string, targetDir: string, sourceModelPath: string): Promise<void> {
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
    const sourcePath = path.join(sourceDir, entry.name);
    if (entry.isFile() && (/\.(las|laz)$/i.test(entry.name) || sourcePath.toLowerCase() === sourceModelPath.toLowerCase())) continue;
    await fs.promises.cp(sourcePath, path.join(targetDir, entry.name), { recursive: true, errorOnExist: true });
  }
}

async function transformCompanionFiles(targetDir: string, mapName: string, origin: Vec3, bounds: ReturnType<typeof shiftedBounds>): Promise<void> {
  await transformJsonFile(path.join(targetDir, DESCRIPTION_FILE_NAME), (data) => shiftDescriptionFile(data, origin));
  await transformJsonFile(path.join(targetDir, NORMAL_ANNOTATIONS_FILE_NAME), (data) => shiftNormalAnnotations(data, origin));
  await transformJsonFile(path.join(targetDir, ROBOT_PATH_FILE_NAME), (data) => shiftRobotPathFile(data, origin));
  for (const fileName of ROBOT_STOP_POINT_FILE_NAMES) {
    await transformJsonFile(path.join(targetDir, fileName), (data) => shiftRobotPathFile(data, origin));
  }
  await shiftReferencePath(path.join(targetDir, REFERENCE_PATH_FILE_NAME), origin);
  await updateMapInfo(path.join(targetDir, MAP_INFO_FILE_NAME), mapName, bounds);
}

async function correctMapInternal(
  projectName: string,
  modelPath: string,
  originInput: unknown,
  notify: ProgressListener,
): Promise<MapCoordinateCorrectionResult> {
  const projectDir = resolveProjectDir(projectName);
  const sourcePath = assertInside(
    projectDir,
    resolveProjectRootPath(modelPath, "纠正地图坐标"),
    "纠正地图坐标",
  );
  if (!/\.(las|laz)$/i.test(sourcePath)) throw new Error("坐标纠正仅支持 LAS/LAZ 模型");
  const sourceStat = await fs.promises.stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("模型文件不存在");

  const origin = validateOrigin(originInput);
  const manifest = ensureProjectManifest(projectName);
  const mapsDir = resolveProjectPath(projectName, manifest.layout.dirs.maps);
  const sourceDir = path.dirname(sourcePath);
  if (path.dirname(sourceDir).toLowerCase() !== mapsDir.toLowerCase()) {
    throw new Error("只能纠正项目地图目录中的模型");
  }
  const sourceMapName = assertSafePathSegment(path.basename(sourceDir), "地图名称");
  const mapName = assertSafePathSegment(`${sourceMapName}${TARGET_SUFFIX}`, "纠正地图名称");
  const outputDir = resolveProjectPath(projectName, manifest.layout.dirs.maps, mapName);
  if (fs.existsSync(outputDir)) throw new Error(`纠正地图“${mapName}”已存在，请先删除后重试`);

  const tempDir = resolveProjectPath(
    projectName,
    manifest.layout.dirs.maps,
    `.${mapName}.tmp-${process.pid}-${Date.now()}`,
  );
  let committed = false;
  try {
    notify({ projectName, modelPath, phase: "preparing", percent: 3, message: "正在准备纠正地图" });
    await fs.promises.mkdir(tempDir, { recursive: true });
    const sourceHeader = await readLasHeader(sourcePath);
    // The LAS header is the source of truth here. map_info.json can be stale after
    // an interrupted import or an older conversion and must not affect validation.
    const sourceBounds = boundsFromLasHeader(sourceHeader);
    assertOriginNearBounds(origin, sourceBounds);
    const outputBounds = shiftedBounds(sourceBounds, origin);
    const outputEncoding = outputLasEncoding(outputBounds, sourceHeader);
    await copyCompanionFiles(sourceDir, tempDir, sourcePath);

    const outputModelPath = path.join(tempDir, MAP_MODEL_FILE_NAME);
    const pipelinePath = path.join(tempDir, ".coordinate-correction-pipeline.json");
    const pipeline = {
      pipeline: [
        { type: "readers.las", filename: sourcePath },
        {
          type: "filters.transformation",
          matrix: `1 0 0 ${formatCoordinate(-origin[0])} 0 1 0 ${formatCoordinate(-origin[1])} 0 0 1 ${formatCoordinate(-origin[2])} 0 0 0 1`,
        },
        {
          type: "writers.las",
          filename: outputModelPath,
          forward: "all",
          ...outputEncoding,
        },
      ],
    };
    await fs.promises.writeFile(pipelinePath, JSON.stringify(pipeline, null, 2), "utf8");
    notify({ projectName, modelPath, phase: "transforming", percent: 10, message: "正在平移 LAS 点坐标" });
    await runPdalPipeline(pipelinePath);
    await fs.promises.rm(pipelinePath, { force: true });
    const outputStat = await fs.promises.stat(outputModelPath);
    if (!outputStat.isFile() || outputStat.size <= 0) throw new Error("PDAL 未生成有效的 LAS 文件");

    notify({ projectName, modelPath, phase: "annotations", percent: 62, message: "正在同步平移地图标注" });
    await transformCompanionFiles(tempDir, mapName, origin, outputBounds);
    await fs.promises.rename(tempDir, outputDir);
    committed = true;

    const finalModelPath = path.join(outputDir, MAP_MODEL_FILE_NAME);
    const mapInfoPath = path.join(outputDir, MAP_INFO_FILE_NAME);
    updateManifestForWrittenFile(projectName, finalModelPath, (await fs.promises.stat(finalModelPath)).size);
    updateManifestForWrittenFile(projectName, mapInfoPath, (await fs.promises.stat(mapInfoPath)).size);

    notify({ projectName, modelPath, phase: "potree", percent: 68, message: "正在生成新地图点云缓存" });
    await ensurePotreeModel(projectName, finalModelPath, (progress) => {
      notify({
        projectName,
        modelPath,
        phase: "potree",
        percent: Math.min(99, 68 + Math.round(progress.percent * 0.31)),
        message: progress.message,
      });
    });
    notify({ projectName, modelPath, phase: "complete", percent: 100, message: "坐标纠正完成" });
    return { mapName, modelPath: finalModelPath, origin };
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((): undefined => undefined);
    if (committed) {
      await fs.promises.rm(outputDir, { recursive: true, force: true }).catch((): undefined => undefined);
      try {
        removeManifestAssetsUnderPath(projectName, outputDir);
      } catch (cleanupError) {
        console.warn("[map-coordinate-correction] failed to clean manifest", cleanupError);
      }
    }
    throw formatPdalError(error);
  }
}

export async function correctMapCoordinates(
  projectName: string,
  modelPath: string,
  origin: unknown,
  onProgress: ProgressListener,
): Promise<MapCoordinateCorrectionResult> {
  const key = `${projectName}\0${path.resolve(modelPath).toLowerCase()}`;
  const existing = activeCorrections.get(key);
  if (existing) return existing;
  const promise = correctMapInternal(projectName, modelPath, origin, onProgress);
  activeCorrections.set(key, promise);
  try {
    return await promise;
  } finally {
    activeCorrections.delete(key);
  }
}
