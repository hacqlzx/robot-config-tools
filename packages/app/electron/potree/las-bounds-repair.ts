import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLasHeader, type LasClipBounds, type LasHeader } from "./las-clip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAS_BOUNDS_OFFSET = 179;
const LAS_BOUNDS_LENGTH = 48;
const PDAL_OUTPUT_LIMIT = 2 * 1024 * 1024;
const MAX_INVALID_HEADER_SPAN = 1_000_000;
const MAX_AUTO_EXPANSION_METERS = 100;
const MAX_AUTO_EXPANSION_RATIO = 2;

type Axis = "X" | "Y" | "Z";
type ProgressListener = (percent: number, message: string) => void;

interface AxisStats {
  minimum: number;
  maximum: number;
  count: number;
}

export interface LasBoundsPreparationResult {
  bounds: LasClipBounds;
  actualBounds: LasClipBounds;
  repaired: boolean;
  mapInfoPath: string;
  mapInfoUpdated: boolean;
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
  if (!runtimeDir) throw new Error("未找到 PDAL 运行环境，无法检查 LAS 实际坐标范围");
  return { executable: path.join(runtimeDir, "pdal.exe"), runtimeDir };
}

function boundsFromHeader(header: LasHeader): LasClipBounds {
  return {
    minX: header.minX,
    maxX: header.maxX,
    minY: header.minY,
    maxY: header.maxY,
    minZ: header.minZ,
    maxZ: header.maxZ,
  };
}

function hasOrderedAxis(bounds: LasClipBounds, axis: Axis): boolean {
  const min = bounds[`min${axis}`];
  const max = bounds[`max${axis}`];
  return Number.isFinite(min) && Number.isFinite(max) && min <= max;
}

function validateHeaderStructure(header: LasHeader, fileSize: number): void {
  if (![header.scaleX, header.scaleY, header.scaleZ].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("LAS 头部坐标缩放值无效，无法自动检查边界");
  }
  if (![header.offsetX, header.offsetY, header.offsetZ].every(Number.isFinite)) {
    throw new Error("LAS 头部坐标偏移值无效，无法自动检查边界");
  }
  if (header.headerSize < 227 || header.pointDataOffset < header.headerSize || header.pointRecordLength < 12) {
    throw new Error("LAS 点记录结构无效，无法自动检查边界");
  }
  if (!Number.isSafeInteger(header.pointCount) || header.pointCount <= 0) {
    throw new Error("LAS 点数无效，无法自动检查边界");
  }

  const compressed = (header.pointFormatRaw & 0xc0) !== 0;
  const pointBytes = header.pointCount * header.pointRecordLength;
  if (!compressed && (!Number.isSafeInteger(pointBytes) || header.pointDataOffset + pointBytes > fileSize)) {
    throw new Error("LAS 点数据超出文件范围，文件可能不完整");
  }
}

function parsePdalBounds(stdout: string, expectedPointCount: number): LasClipBounds {
  const jsonStart = stdout.indexOf("{");
  const jsonEnd = stdout.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error("PDAL 未返回有效的 LAS 统计结果");

  let parsed: any;
  try {
    parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  } catch {
    throw new Error("PDAL 返回的 LAS 统计结果无法解析");
  }

  const statistics = parsed?.stats?.statistic;
  if (!Array.isArray(statistics)) throw new Error("PDAL 返回的 LAS 坐标统计不完整");
  const axis = (name: Axis): AxisStats => {
    const item = statistics.find((candidate: any) => String(candidate?.name).toUpperCase() === name);
    const result = {
      minimum: Number(item?.minimum),
      maximum: Number(item?.maximum),
      count: Number(item?.count),
    };
    if (![result.minimum, result.maximum, result.count].every(Number.isFinite)
      || result.minimum > result.maximum
      || !Number.isSafeInteger(result.count)
      || result.count <= 0) {
      throw new Error(`PDAL 返回的 ${name} 轴坐标统计无效`);
    }
    return result;
  };

  const x = axis("X");
  const y = axis("Y");
  const z = axis("Z");
  if (x.count !== expectedPointCount || y.count !== expectedPointCount || z.count !== expectedPointCount) {
    throw new Error(
      `LAS 实际读取点数与头部不一致（头部 ${expectedPointCount.toLocaleString("en-US")}，实际 ${x.count.toLocaleString("en-US")}），不自动修复边界`,
    );
  }

  return {
    minX: x.minimum,
    maxX: x.maximum,
    minY: y.minimum,
    maxY: y.maximum,
    minZ: z.minimum,
    maxZ: z.maximum,
  };
}

function scanActualBounds(modelPath: string, expectedPointCount: number): Promise<LasClipBounds> {
  const { executable, runtimeDir } = resolvePdalExecutable();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [
      "info",
      "--stats",
      "--dimensions", "X,Y,Z",
      "--readers.las.nosrs=true",
      "--input", modelPath,
    ], {
      cwd: runtimeDir,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${runtimeDir}${path.delimiter}${process.env.PATH || ""}`,
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
      if (stdout.length > PDAL_OUTPUT_LIMIT) {
        child.kill();
        fail(new Error("PDAL 返回的 LAS 统计结果过大"));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = `${stderr}${String(chunk)}`.slice(-8_000);
    });
    child.once("error", (error) => fail(new Error(`无法启动 PDAL 边界检查：${error.message}`)));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
        fail(new Error(`LAS 实际边界检查失败（退出码 ${code ?? "未知"}）${detail ? `\n${detail}` : ""}`));
        return;
      }
      try {
        const bounds = parsePdalBounds(stdout, expectedPointCount);
        settled = true;
        resolve(bounds);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function axisTolerance(scale: number, min: number, max: number): number {
  const magnitudeTolerance = Math.max(Math.abs(min), Math.abs(max), 1) * Number.EPSILON * 16;
  return Math.max(scale * 0.25, magnitudeTolerance, 1e-9);
}

function needsRepair(header: LasHeader, headerBounds: LasClipBounds, actual: LasClipBounds): boolean {
  return (["X", "Y", "Z"] as const).some((axis) => {
    if (!hasOrderedAxis(headerBounds, axis)) return true;
    const min = headerBounds[`min${axis}`];
    const max = headerBounds[`max${axis}`];
    if (min === max) return true;
    const actualMin = actual[`min${axis}`];
    const actualMax = actual[`max${axis}`];
    const tolerance = axisTolerance(header[`scale${axis}`], actualMin, actualMax);
    return actualMin < min - tolerance || actualMax > max + tolerance;
  });
}

function assertSafeAutoExpansion(headerBounds: LasClipBounds, actual: LasClipBounds): void {
  const excessiveAxis = (["X", "Y", "Z"] as const).find((axis) => {
    const actualSpan = actual[`max${axis}`] - actual[`min${axis}`];
    if (!hasOrderedAxis(headerBounds, axis)) return actualSpan > MAX_INVALID_HEADER_SPAN;
    const headerMin = headerBounds[`min${axis}`];
    const headerMax = headerBounds[`max${axis}`];
    const headerSpan = headerMax - headerMin;
    if (headerSpan === 0) return actualSpan > MAX_AUTO_EXPANSION_METERS;
    const mergedSpan = Math.max(headerMax, actual[`max${axis}`]) - Math.min(headerMin, actual[`min${axis}`]);
    const allowedSpan = Math.min(
      headerSpan * MAX_AUTO_EXPANSION_RATIO,
      headerSpan + MAX_AUTO_EXPANSION_METERS,
    );
    return mergedSpan > allowedSpan;
  });
  if (excessiveAxis) {
    throw new Error(
      `LAS 的 ${excessiveAxis} 轴真实范围异常或远超头部范围，可能存在异常点；为避免放大错误，本次不自动修复`,
    );
  }
}

function repairedBounds(header: LasHeader, headerBounds: LasClipBounds, actual: LasClipBounds): LasClipBounds {
  const next = { ...headerBounds };
  for (const axis of ["X", "Y", "Z"] as const) {
    const scale = header[`scale${axis}`];
    if (!hasOrderedAxis(headerBounds, axis)) {
      next[`min${axis}`] = actual[`min${axis}`] - scale;
      next[`max${axis}`] = actual[`max${axis}`] + scale;
      continue;
    }
    if (headerBounds[`min${axis}`] === headerBounds[`max${axis}`]) {
      next[`min${axis}`] = Math.min(headerBounds[`min${axis}`], actual[`min${axis}`]) - scale;
      next[`max${axis}`] = Math.max(headerBounds[`max${axis}`], actual[`max${axis}`]) + scale;
      continue;
    }
    const tolerance = axisTolerance(scale, actual[`min${axis}`], actual[`max${axis}`]);
    if (actual[`min${axis}`] < headerBounds[`min${axis}`] - tolerance) {
      next[`min${axis}`] = actual[`min${axis}`] - scale;
    }
    if (actual[`max${axis}`] > headerBounds[`max${axis}`] + tolerance) {
      next[`max${axis}`] = actual[`max${axis}`] + scale;
    }
  }
  return next;
}

async function readFully(file: fs.promises.FileHandle, target: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < target.length) {
    const { bytesRead } = await file.read(target, offset, target.length - offset, position + offset);
    if (bytesRead <= 0) throw new Error("LAS 头部边界字段读取不完整");
    offset += bytesRead;
  }
}

async function writeFully(file: fs.promises.FileHandle, source: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < source.length) {
    const { bytesWritten } = await file.write(source, offset, source.length - offset, position + offset);
    if (bytesWritten <= 0) throw new Error("LAS 头部边界字段写入失败");
    offset += bytesWritten;
  }
}

async function writeHeaderBounds(modelPath: string, bounds: LasClipBounds): Promise<void> {
  const file = await fs.promises.open(modelPath, "r+");
  const original = Buffer.alloc(LAS_BOUNDS_LENGTH);
  let originalRead = false;
  try {
    await readFully(file, original, LAS_BOUNDS_OFFSET);
    originalRead = true;
    const next = Buffer.from(original);
    next.writeDoubleLE(bounds.maxX, 0);
    next.writeDoubleLE(bounds.minX, 8);
    next.writeDoubleLE(bounds.maxY, 16);
    next.writeDoubleLE(bounds.minY, 24);
    next.writeDoubleLE(bounds.maxZ, 32);
    next.writeDoubleLE(bounds.minZ, 40);
    await writeFully(file, next, LAS_BOUNDS_OFFSET);
    await file.sync();
  } catch (error) {
    if (originalRead) {
      await writeFully(file, original, LAS_BOUNDS_OFFSET).then(() => file.sync()).catch((): undefined => undefined);
    }
    throw error;
  } finally {
    await file.close();
  }
}

function sameBounds(value: unknown, bounds: LasClipBounds): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (["minX", "maxX", "minY", "maxY", "minZ", "maxZ"] as const)
    .every((key) => Number(record[key]) === bounds[key]);
}

async function syncMapInfoBounds(modelPath: string, bounds: LasClipBounds): Promise<{ path: string; updated: boolean }> {
  const mapInfoPath = path.join(path.dirname(modelPath), "map_info.json");
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(mapInfoPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  if (sameBounds(data.point_bounds, bounds)) return { path: mapInfoPath, updated: false };

  data.point_bounds = bounds;
  if (typeof data.map_name !== "string" || !data.map_name.trim()) {
    data.map_name = path.basename(path.dirname(modelPath));
  }
  await fs.promises.writeFile(mapInfoPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return { path: mapInfoPath, updated: true };
}

export async function prepareLasBoundsForPotree(
  modelPath: string,
  notify: ProgressListener,
): Promise<LasBoundsPreparationResult> {
  const stat = await fs.promises.stat(modelPath);
  const header = await readLasHeader(modelPath);
  validateHeaderStructure(header, stat.size);
  const headerBounds = boundsFromHeader(header);

  notify(3, "正在扫描 LAS 实际坐标范围");
  const actualBounds = await scanActualBounds(modelPath, header.pointCount);
  notify(12, "正在校验 LAS 头部边界");

  const repair = needsRepair(header, headerBounds, actualBounds);
  let bounds = headerBounds;
  if (repair) {
    assertSafeAutoExpansion(headerBounds, actualBounds);
    bounds = repairedBounds(header, headerBounds, actualBounds);
    notify(13, "检测到 LAS 头部边界不完整，正在自动修复");
    await writeHeaderBounds(modelPath, bounds);
    const verified = boundsFromHeader(await readLasHeader(modelPath));
    if (!sameBounds(verified, bounds)) throw new Error("LAS 头部边界修复后校验失败");
  }

  const mapInfo = await syncMapInfoBounds(modelPath, bounds);
  notify(14, repair ? "LAS 头部边界已修复" : "LAS 头部边界检查完成");
  return {
    bounds,
    actualBounds,
    repaired: repair,
    mapInfoPath: mapInfo.path,
    mapInfoUpdated: mapInfo.updated,
  };
}
