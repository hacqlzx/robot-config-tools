import fs from "node:fs";
import path from "node:path";
import {
  assertInside,
  assertSafePathSegment,
  resolveProjectDir,
  resolveProjectPath,
  resolveProjectRootPath,
} from "../project-core/project-paths";
import { ensureProjectManifest, updateManifestForWrittenFile } from "../project-core/project-manifest";

export interface LasClipBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type LasClipPhase = "scanning" | "complete";

export interface LasClipProgress {
  projectName: string;
  modelPath: string;
  phase: LasClipPhase;
  percent: number;
  message: string;
}

export interface LasClipResult {
  mapName: string;
  modelPath: string;
  pointCount: number;
}

interface LasHeader {
  source: Buffer;
  headerSize: number;
  pointDataOffset: number;
  pointFormatRaw: number;
  pointFormat: number;
  pointRecordLength: number;
  pointCount: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  globalEncoding: number;
  creationDay: number;
  creationYear: number;
}

const OUTPUT_HEADER_SIZE = 227;
const OUTPUT_POINT_LENGTH = 26;
const INPUT_CHUNK_POINTS = 100_000;
const UINT32_MAX = 0xffffffff;

function readHeader(source: Buffer): LasHeader {
  if (source.length < OUTPUT_HEADER_SIZE || source.toString("ascii", 0, 4) !== "LASF") {
    throw new Error("无效的 LAS 文件");
  }

  const versionMinor = source.readUInt8(25);
  const headerSize = source.readUInt16LE(94);
  const pointFormatRaw = source.readUInt8(104);
  const pointCountLegacy = source.readUInt32LE(107);
  const pointCountExtended = versionMinor >= 4 && headerSize >= 375 && source.length >= 255
    ? Number(source.readBigUInt64LE(247))
    : 0;
  const pointCount = pointCountExtended > 0 ? pointCountExtended : pointCountLegacy;
  if (!Number.isSafeInteger(pointCount) || pointCount < 0) throw new Error("LAS 点数超出当前程序支持范围");

  return {
    source,
    headerSize,
    pointDataOffset: source.readUInt32LE(96),
    pointFormatRaw,
    pointFormat: pointFormatRaw & 0x3f,
    pointRecordLength: source.readUInt16LE(105),
    pointCount,
    scaleX: source.readDoubleLE(131),
    scaleY: source.readDoubleLE(139),
    scaleZ: source.readDoubleLE(147),
    offsetX: source.readDoubleLE(155),
    offsetY: source.readDoubleLE(163),
    offsetZ: source.readDoubleLE(171),
    maxX: source.readDoubleLE(179),
    minX: source.readDoubleLE(187),
    maxY: source.readDoubleLE(195),
    minY: source.readDoubleLE(203),
    maxZ: source.readDoubleLE(211),
    minZ: source.readDoubleLE(219),
    globalEncoding: source.readUInt16LE(6),
    creationDay: source.readUInt16LE(90),
    creationYear: source.readUInt16LE(92),
  };
}

function validateBounds(bounds: LasClipBounds): LasClipBounds {
  const values = Object.values(bounds);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("裁切范围包含无效坐标");
  }
  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY || bounds.minZ >= bounds.maxZ) {
    throw new Error("裁切范围必须大于零");
  }
  return bounds;
}

export async function readLasModelBounds(modelPath: string): Promise<LasClipBounds> {
  const mapInfoPath = path.join(path.dirname(modelPath), "map_info.json");
  try {
    const mapInfo = JSON.parse(await fs.promises.readFile(mapInfoPath, "utf8"));
    if (mapInfo?.point_bounds) return validateBounds(mapInfo.point_bounds as LasClipBounds);
  } catch {
    // Older maps do not contain point_bounds; their LAS header is the fallback.
  }

  const stat = await fs.promises.stat(modelPath);
  const file = await fs.promises.open(modelPath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(4096, stat.size));
    const bytesRead = await readExact(file, buffer, buffer.length, 0);
    const header = readHeader(buffer.subarray(0, bytesRead));
    return validateBounds({
      minX: header.minX,
      maxX: header.maxX,
      minY: header.minY,
      maxY: header.maxY,
      minZ: header.minZ,
      maxZ: header.maxZ,
    });
  } finally {
    await file.close();
  }
}

function rgbOffset(format: number, pointLength: number): number | null {
  if (![2, 3, 5, 7, 8, 10].includes(format)) return null;
  const offset = format >= 6 ? 30 : (format === 3 || format === 5 ? 28 : 20);
  return offset + 6 <= pointLength ? offset : null;
}

function writeAscii(target: Buffer, offset: number, length: number, value: string): void {
  target.fill(0, offset, offset + length);
  Buffer.from(value, "ascii").subarray(0, length).copy(target, offset);
}

function createOutputHeader(
  header: LasHeader,
  pointCount: number,
  returns: number[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): Buffer {
  const output = Buffer.alloc(OUTPUT_HEADER_SIZE);
  header.source.subarray(0, 94).copy(output, 0);
  output.write("LASF", 0, "ascii");
  output.writeUInt16LE(header.globalEncoding & 1, 6);
  output.writeUInt8(1, 24);
  output.writeUInt8(2, 25);
  writeAscii(output, 58, 32, "robotConfigTools");
  output.writeUInt16LE(header.creationDay || new Date().getDate(), 90);
  output.writeUInt16LE(header.creationYear || new Date().getFullYear(), 92);
  output.writeUInt16LE(OUTPUT_HEADER_SIZE, 94);
  output.writeUInt32LE(OUTPUT_HEADER_SIZE, 96);
  output.writeUInt32LE(0, 100);
  output.writeUInt8(2, 104);
  output.writeUInt16LE(OUTPUT_POINT_LENGTH, 105);
  output.writeUInt32LE(pointCount, 107);
  for (let index = 0; index < 5; index += 1) output.writeUInt32LE(returns[index] || 0, 111 + index * 4);
  output.writeDoubleLE(header.scaleX, 131);
  output.writeDoubleLE(header.scaleY, 139);
  output.writeDoubleLE(header.scaleZ, 147);
  output.writeDoubleLE(header.offsetX, 155);
  output.writeDoubleLE(header.offsetY, 163);
  output.writeDoubleLE(header.offsetZ, 171);
  output.writeDoubleLE(bounds.maxX, 179);
  output.writeDoubleLE(bounds.minX, 187);
  output.writeDoubleLE(bounds.maxY, 195);
  output.writeDoubleLE(bounds.minY, 203);
  output.writeDoubleLE(bounds.maxZ, 211);
  output.writeDoubleLE(bounds.minZ, 219);
  return output;
}

function preserveOriginalBoundsCenter(
  header: LasHeader,
  clipped: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const centerX = (header.minX + header.maxX) / 2;
  const centerY = (header.minY + header.maxY) / 2;
  const centerZ = (header.minZ + header.maxZ) / 2;
  if (![centerX, centerY, centerZ].every(Number.isFinite)) return clipped;
  const halfX = Math.max(header.scaleX, Math.abs(clipped.minX - centerX), Math.abs(clipped.maxX - centerX));
  const halfY = Math.max(header.scaleY, Math.abs(clipped.minY - centerY), Math.abs(clipped.maxY - centerY));
  const halfZ = Math.max(header.scaleZ, Math.abs(clipped.minZ - centerZ), Math.abs(clipped.maxZ - centerZ));
  return {
    minX: centerX - halfX,
    maxX: centerX + halfX,
    minY: centerY - halfY,
    maxY: centerY + halfY,
    minZ: centerZ - halfZ,
    maxZ: centerZ + halfZ,
  };
}

function writeOutputPoint(
  target: Buffer,
  targetOffset: number,
  source: Buffer,
  sourceOffset: number,
  header: LasHeader,
  colorOffset: number | null,
): number {
  source.copy(target, targetOffset, sourceOffset, sourceOffset + 12);
  source.copy(target, targetOffset + 12, sourceOffset + 12, sourceOffset + 14);

  if (header.pointFormat < 6) {
    source.copy(target, targetOffset + 14, sourceOffset + 14, sourceOffset + 20);
  } else {
    const returns = source[sourceOffset + 14];
    const flags = source[sourceOffset + 15];
    target[targetOffset + 14] = Math.min(7, returns & 0x0f) | ((returns >> 4) & 0x0f ? Math.min(7, returns >> 4) << 3 : 0)
      | (flags & 0xc0);
    target[targetOffset + 15] = Math.min(31, source[sourceOffset + 16]) | ((flags & 0x07) << 5);
    target[targetOffset + 16] = 0;
    target[targetOffset + 17] = source[sourceOffset + 17];
    source.copy(target, targetOffset + 18, sourceOffset + 20, sourceOffset + 22);
  }

  if (colorOffset === null) {
    target.writeUInt16LE(32768, targetOffset + 20);
    target.writeUInt16LE(32768, targetOffset + 22);
    target.writeUInt16LE(32768, targetOffset + 24);
  } else {
    source.copy(target, targetOffset + 20, sourceOffset + colorOffset, sourceOffset + colorOffset + 6);
  }
  return header.pointFormat >= 6 ? source[sourceOffset + 14] & 0x0f : source[sourceOffset + 14] & 0x07;
}

async function writeAll(file: fs.promises.FileHandle, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const result = await file.write(data, offset, data.length - offset);
    if (result.bytesWritten <= 0) throw new Error("写入裁切文件失败");
    offset += result.bytesWritten;
  }
}

async function readExact(
  file: fs.promises.FileHandle,
  buffer: Buffer,
  length: number,
  position: number,
): Promise<number> {
  let offset = 0;
  while (offset < length) {
    const result = await file.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead <= 0) break;
    offset += result.bytesRead;
  }
  return offset;
}

function formatPointCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatMapInfoTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function clipLasModel(
  projectName: string,
  modelPath: string,
  boundsInput: LasClipBounds,
  notify: (progress: LasClipProgress) => void,
): Promise<LasClipResult> {
  const projectDir = resolveProjectDir(projectName);
  const sourcePath = assertInside(
    projectDir,
    resolveProjectRootPath(modelPath, "裁切模型"),
    "裁切模型",
  );
  const bounds = validateBounds(boundsInput);
  const sourceStat = await fs.promises.stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error("模型文件不存在");

  const sourceFile = await fs.promises.open(sourcePath, "r");
  let outputFile: fs.promises.FileHandle | null = null;
  let outputDir = "";
  let tempPath = "";
  try {
    const headerBuffer = Buffer.alloc(Math.min(4096, sourceStat.size));
    const headerBytesRead = await readExact(sourceFile, headerBuffer, headerBuffer.length, 0);
    const header = readHeader(headerBuffer.subarray(0, headerBytesRead));
    if ((header.pointFormatRaw & 0xc0) !== 0) {
      throw new Error("当前 Potree 裁切导出暂不支持压缩 LAZ，请先转换为未压缩 LAS");
    }
    if (header.pointRecordLength < 20 || header.pointDataOffset < header.headerSize) {
      throw new Error("LAS 点记录结构无效");
    }
    const pointBytes = header.pointCount * header.pointRecordLength;
    if (!Number.isSafeInteger(pointBytes) || header.pointDataOffset + pointBytes > sourceStat.size) {
      throw new Error("LAS 点数据超出文件范围");
    }

    const manifest = ensureProjectManifest(projectName);
    const mapRoot = resolveProjectPath(projectName, manifest.layout.dirs.maps);
    const sourceMapName = assertSafePathSegment(path.basename(path.dirname(sourcePath)), "地图名称");
    const existing = new Set(
      (await fs.promises.readdir(mapRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
    let index = 1;
    let mapName = `${sourceMapName}_${index}`;
    while (existing.has(mapName)) {
      index += 1;
      mapName = `${sourceMapName}_${index}`;
    }
    outputDir = resolveProjectPath(projectName, manifest.layout.dirs.maps, mapName);
    await fs.promises.mkdir(outputDir, { recursive: true });
    tempPath = path.join(outputDir, `map.las.tmp-${process.pid}-${Date.now()}`);
    outputFile = await fs.promises.open(tempPath, "w+");
    await writeAll(outputFile, Buffer.alloc(OUTPUT_HEADER_SIZE));

    const colorOffset = rgbOffset(header.pointFormat, header.pointRecordLength);
    const inputChunkBytes = INPUT_CHUNK_POINTS * header.pointRecordLength;
    const inputChunk = Buffer.alloc(inputChunkBytes);
    const outputChunk = Buffer.alloc(INPUT_CHUNK_POINTS * OUTPUT_POINT_LENGTH);
    let processed = 0;
    let pointCount = 0;
    const returns = [0, 0, 0, 0, 0];
    const outputBounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    let lastReportedPercent = -1;
    let lastReportedAt = 0;
    const report = (percent: number, message: string) => {
      const now = Date.now();
      if (percent === 100 || percent > lastReportedPercent || now - lastReportedAt >= 250) {
        lastReportedPercent = Math.max(lastReportedPercent, percent);
        lastReportedAt = now;
        notify({ projectName, modelPath, phase: percent >= 100 ? "complete" : "scanning", percent, message });
      }
    };

    while (processed < header.pointCount) {
      const pointsInChunk = Math.min(INPUT_CHUNK_POINTS, header.pointCount - processed);
      const bytesInChunk = pointsInChunk * header.pointRecordLength;
      const chunkBytesRead = await readExact(
        sourceFile,
        inputChunk,
        bytesInChunk,
        header.pointDataOffset + processed * header.pointRecordLength,
      );
      if (chunkBytesRead !== bytesInChunk) throw new Error("读取 LAS 点数据失败");
      let outputBytes = 0;

      for (let indexInChunk = 0; indexInChunk < pointsInChunk; indexInChunk += 1) {
        const sourceOffset = indexInChunk * header.pointRecordLength;
        const ix = inputChunk.readInt32LE(sourceOffset);
        const iy = inputChunk.readInt32LE(sourceOffset + 4);
        const iz = inputChunk.readInt32LE(sourceOffset + 8);
        const x = ix * header.scaleX + header.offsetX;
        const y = iy * header.scaleY + header.offsetY;
        const z = iz * header.scaleZ + header.offsetZ;
        if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY || z < bounds.minZ || z > bounds.maxZ) continue;
        if (pointCount >= UINT32_MAX) throw new Error("裁切结果超过 LAS 1.2 的点数上限");

        const returnNumber = writeOutputPoint(outputChunk, outputBytes, inputChunk, sourceOffset, header, colorOffset);
        if (returnNumber >= 1 && returnNumber <= 5) returns[returnNumber - 1] += 1;
        outputBytes += OUTPUT_POINT_LENGTH;
        pointCount += 1;
        outputBounds.minX = Math.min(outputBounds.minX, x);
        outputBounds.maxX = Math.max(outputBounds.maxX, x);
        outputBounds.minY = Math.min(outputBounds.minY, y);
        outputBounds.maxY = Math.max(outputBounds.maxY, y);
        outputBounds.minZ = Math.min(outputBounds.minZ, z);
        outputBounds.maxZ = Math.max(outputBounds.maxZ, z);
      }

      if (outputBytes > 0) await writeAll(outputFile, outputChunk.subarray(0, outputBytes));
      processed += pointsInChunk;
      report(Math.min(94, Math.round(processed / Math.max(header.pointCount, 1) * 94)), `正在裁切点云 ${formatPointCount(processed)} / ${formatPointCount(header.pointCount)}`);
    }

    if (pointCount === 0) throw new Error("裁切范围内没有点");
    const headerBounds = preserveOriginalBoundsCenter(header, outputBounds);
    await outputFile.write(createOutputHeader(header, pointCount, returns, headerBounds), 0, OUTPUT_HEADER_SIZE, 0);
    await outputFile.sync();
    await outputFile.close();
    outputFile = null;
    const targetPath = path.join(outputDir, "map.las");
    await fs.promises.rename(tempPath, targetPath);
    tempPath = "";

    const mapInfoText = `${JSON.stringify({
      map_name: mapName,
      time: formatMapInfoTime(),
      point_bounds: outputBounds,
    }, null, 2)}\n`;
    const mapInfoPath = path.join(outputDir, "map_info.json");
    await fs.promises.writeFile(mapInfoPath, mapInfoText, "utf8");
    updateManifestForWrittenFile(projectName, targetPath, (await fs.promises.stat(targetPath)).size);
    updateManifestForWrittenFile(projectName, mapInfoPath, Buffer.byteLength(mapInfoText));
    notify({ projectName, modelPath, phase: "complete", percent: 100, message: `裁切完成，共 ${formatPointCount(pointCount)} 个点` });
    return { mapName, modelPath: targetPath, pointCount };
  } catch (error) {
    if (outputFile) await outputFile.close().catch((): undefined => undefined);
    if (tempPath) await fs.promises.rm(tempPath, { force: true }).catch((): undefined => undefined);
    if (outputDir) await fs.promises.rm(outputDir, { recursive: true, force: true }).catch((): undefined => undefined);
    throw error;
  } finally {
    await sourceFile.close();
  }
}
