import * as pc from "playcanvas";
import { pointcloudVert, pointcloudFrag } from "../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, type LasHeader } from "../../playcanvas-core/io/read/las-reader";
import { BlobReadFileSystem } from "../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../playcanvas-core/io";

const MAX_POINTS = 30_000_000;

function isLasCompressed(formatId: number): boolean {
  return formatId >= 128;
}

function getRgbOffset(formatId: number): number {
  if (formatId >= 6) return 30;
  if (formatId === 3 || formatId === 5) return 28;
  return 20;
}

/** 从 Y 分布直方图中推算地面 Y（取低区最密集的 Y 值） */
function findGroundYFromHistogram(hist: Map<number, number>, lminY: number, lmaxY: number): number {
  const range = lmaxY - lminY;
  if (range <= 0) return lminY;
  const entries = Array.from(hist.entries()).sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return lminY;
  const lowThreshold = lminY + range * 0.3;
  let bestY = entries[0][0];
  let bestCount = 0;
  for (const [y, count] of entries) {
    if (y > lowThreshold) break;
    if (count > bestCount) { bestCount = count; bestY = y; }
  }
  return bestY;
}

export interface LoadedModel {
  entity: pc.Entity;
  center: [number, number, number];
  extent: number;
  totalPoints: number;
  loadedPoints: number;
  groundY: number;
}

export interface PointCloudLoaderCallbacks {
  onProgress?: (pct: number) => void;
  onFileLoaded?: (name: string, path: string) => void;
}

/**
 * 点云加载器 — LAS / LAZ / PLY 文件 → GPU 渲染实体
 *
 * 基于空间编辑的 useLasLoader 抽取，包含：
 *   - LAS 流式加载（分块读取 + GPU 上传）
 *   - LAZ WASM 解压加载
 *   - PLY GSplat 加载
 *   - RGB 位深自动检测（16bit / 8bit）
 *   - 地面 Y 直方图推算
 *   - 超大数据量自动降采样（stride > 1）
 *   - floating origin（局部小坐标避免 float32 精度问题）
 */
export class PointCloudLoader {
  app: pc.Application;
  entities: Map<string, pc.Entity> = new Map();
  lasHeaders: Map<string, LasHeader> = new Map();
  filePaths: Map<string, string> = new Map();
  pointStats: Map<string, { total: number; loaded: number }> = new Map();
  private callbacks: PointCloudLoaderCallbacks;

  constructor(app: pc.Application, callbacks?: PointCloudLoaderCallbacks) {
    this.app = app;
    this.callbacks = callbacks || {};
  }

  private readFileChunk(filePath: string, offset: number, length: number): Promise<ArrayBuffer> {
    if (window.electronAPI?.readFileChunk) {
      return window.electronAPI.readFileChunk(filePath, offset, length);
    }
    return window.electronAPI!.readLargeFile!(filePath).then((buf) => buf.slice(offset, offset + length));
  }

  /** 从文件路径加载 LAS/LAZ */
  async loadLasFromPath(filePath: string): Promise<LoadedModel> {
    const fileName = filePath.split(/[\\/]/).pop() || "unknown.las";
    const headerBuf = await window.electronAPI!.readFileChunk(filePath, 0, 4096);
    const header = parseLasHeader(headerBuf);

    this.lasHeaders.set(fileName, header);
    this.filePaths.set(fileName, filePath);

    if (isLasCompressed(header.pointFormatId)) {
      return this.loadLazWasm(filePath, fileName, header);
    }
    return this.loadLasStreaming(filePath, fileName, header);
  }

  /** 加载 PLY (GSplat) */
  async loadPly(file: File): Promise<LoadedModel> {
    const fs = new BlobReadFileSystem();
    fs.set(file.name, file);
    const { gsplatData } = await loadGSplatData(file.name, fs);

    const asset = new pc.Asset(file.name, "gsplat", { url: `local-${Date.now()}`, filename: file.name });
    this.app.assets.add(asset);
    asset.resource = new pc.GSplatResource(this.app.graphicsDevice, gsplatData);

    const entity = new pc.Entity(file.name);
    entity.addComponent("gsplat", { asset });
    this.app.root.addChild(entity);
    this.entities.set(file.name, entity);
    this.pointStats.set(file.name, { total: gsplatData.numSplats, loaded: gsplatData.numSplats });

    const aabb = new pc.BoundingBox();
    gsplatData.calcAabb(aabb);
    const center = aabb.center;
    const extent = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z) * 2;

    return {
      entity,
      center: [center.x, center.y, center.z],
      extent,
      totalPoints: gsplatData.numSplats,
      loadedPoints: gsplatData.numSplats,
      groundY: 0,
    };
  }

  // ========== LAS 流式加载 ==========

  private async loadLasStreaming(
    filePath: string,
    fileName: string,
    header: LasHeader,
  ): Promise<LoadedModel> {
    const gd = this.app.graphicsDevice;
    const count = header.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ, pointFormatId, pointRecordLength, pointDataOffset } = header;
    const formatId = pointFormatId & 0x7F;
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(formatId);

    const stride = count > MAX_POINTS ? Math.ceil(count / MAX_POINTS) : 1;
    const loadCount = Math.ceil(count / stride);

    let rgbShift = 8;
    if (hasRgb) {
      const rgbOff = getRgbOffset(formatId);
      const sampleCount = Math.min(2000, count);
      const sampleBuf = await this.readFileChunk(filePath, pointDataOffset, sampleCount * pointRecordLength);
      const sv = new DataView(sampleBuf);
      let maxRgb = 0;
      for (let k = 0; k < sampleCount; k++) {
        const o = k * pointRecordLength;
        maxRgb = Math.max(maxRgb, sv.getUint16(o + rgbOff, true), sv.getUint16(o + rgbOff + 2, true), sv.getUint16(o + rgbOff + 4, true));
      }
      rgbShift = maxRgb > 255 ? 8 : 0;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = Math.max(2.0, extent / Math.cbrt(loadCount) * 0.8);

    const mat = new pc.ShaderMaterial({
      uniqueName: "pointcloud",
      vertexGLSL: pointcloudVert,
      fragmentGLSL: pointcloudFrag,
    });
    mat.blendType = pc.BLEND_NONE;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.cull = pc.CULLFACE_NONE;
    mat.setParameter("uPointSize", pointSize);
    mat.setParameter("uDisplayRatio", 1.0);
    mat.update();

    const format = new pc.VertexFormat(gd, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
    ]);
    const vb = new pc.VertexBuffer(gd, format, loadCount, { usage: pc.BUFFER_STATIC });
    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    const FILE_CHUNK_POINTS = 100000;
    const GPU_CHUNK = 50000;
    let globalIdx = 0;
    let outputIdx = 0;

    let lminX = Infinity, lmaxX = -Infinity, lminY = Infinity, lmaxY = -Infinity, lminZ = Infinity, lmaxZ = -Infinity;
    const yHist = new Map<number, number>();

    const totalBytes = count * pointRecordLength;
    const fileChunkBytes = FILE_CHUNK_POINTS * pointRecordLength;

    for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
      const remaining = count - globalIdx;
      const pointsInChunk = Math.min(FILE_CHUNK_POINTS, remaining);
      const readSize = pointsInChunk * pointRecordLength;
      const chunkBuf = await this.readFileChunk(filePath, fileOff, readSize);
      const view = new DataView(chunkBuf);

      for (let i = 0; i < pointsInChunk; i += GPU_CHUNK) {
        const gpuEnd = Math.min(i + GPU_CHUNK, pointsInChunk);
        for (let j = i; j < gpuEnd; j++) {
          const srcIdx = globalIdx + j;
          if (stride > 1 && srcIdx % stride !== 0) continue;

          const ptOff = j * pointRecordLength;
          const ix = view.getInt32(ptOff, true);
          const iy = view.getInt32(ptOff + 4, true);
          const iz = view.getInt32(ptOff + 8, true);

          const base = outputIdx * 4;
          const fx = ix * scaleX + offsetX - cx;
          const fy = iz * scaleZ + offsetZ - cz;
          const fz = -(iy * scaleY + offsetY - cy);
          f32[base] = fx;
          f32[base + 1] = fy;
          f32[base + 2] = fz;
          if (fx < lminX) lminX = fx; if (fx > lmaxX) lmaxX = fx;
          if (fy < lminY) lminY = fy; if (fy > lmaxY) lmaxY = fy;
          if (fz < lminZ) lminZ = fz; if (fz > lmaxZ) lmaxZ = fz;

          const yBin = Math.round(fy * 5) / 5;
          yHist.set(yBin, (yHist.get(yBin) || 0) + 1);

          const byteOff = base * 4 + 12;
          if (hasRgb) {
            const rgbOffPt = getRgbOffset(formatId);
            const ro = ptOff + rgbOffPt;
            u8[byteOff] = (view.getUint16(ro, true) >> rgbShift) & 0xff;
            u8[byteOff + 1] = (view.getUint16(ro + 2, true) >> rgbShift) & 0xff;
            u8[byteOff + 2] = (view.getUint16(ro + 4, true) >> rgbShift) & 0xff;
          } else {
            u8[byteOff] = 128; u8[byteOff + 1] = 128; u8[byteOff + 2] = 128;
          }
          u8[byteOff + 3] = 255;
          outputIdx++;
        }
      }
      globalIdx += pointsInChunk;
      this.callbacks.onProgress?.(Math.round(globalIdx / count * 100));
      await new Promise((r) => setTimeout(r, 0));
    }

    vb.unlock();
    const expectedBytes = loadCount * 16;
    if (vbLock.byteLength < expectedBytes) {
      throw new Error(`GPU buffer allocation failed: got ${vbLock.byteLength} bytes, expected ${expectedBytes}.`);
    }

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(fileName);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(0, 0, 0);
    this.app.root.addChild(entity);
    this.entities.set(fileName, entity);
    this.pointStats.set(fileName, { total: count, loaded: loadCount });

    const localCenterX = (lminX + lmaxX) / 2;
    const localCenterY = (lminY + lmaxY) / 2;
    const localCenterZ = (lminZ + lmaxZ) / 2;
    const realExtent = Math.max(lmaxX - lminX, lmaxY - lminY, lmaxZ - lminZ, 1);
    const groundY = findGroundYFromHistogram(yHist, lminY, lmaxY);

    this.callbacks.onFileLoaded?.(fileName, filePath);

    return {
      entity,
      center: [localCenterX, localCenterY, localCenterZ],
      extent: realExtent,
      totalPoints: count,
      loadedPoints: loadCount,
      groundY,
    };
  }

  // ========== LAZ WASM 解压加载 ==========

  private async loadLazWasm(
    filePath: string,
    fileName: string,
    header: LasHeader,
  ): Promise<LoadedModel> {
    const gd = this.app.graphicsDevice;
    const count = header.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ } = header;

    const stride = count > MAX_POINTS ? Math.ceil(count / MAX_POINTS) : 1;
    const loadCount = Math.ceil(count / stride);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = Math.max(2.0, extent / Math.cbrt(loadCount) * 0.8);

    const mat = new pc.ShaderMaterial({
      uniqueName: "pointcloud",
      vertexGLSL: pointcloudVert,
      fragmentGLSL: pointcloudFrag,
    });
    mat.blendType = pc.BLEND_NONE;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.cull = pc.CULLFACE_NONE;
    mat.setParameter("uPointSize", pointSize);
    mat.setParameter("uDisplayRatio", 1.0);
    mat.update();

    const format = new pc.VertexFormat(gd, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
    ]);
    const vb = new pc.VertexBuffer(gd, format, loadCount, { usage: pc.BUFFER_STATIC });
    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    const arrayBuffer = await window.electronAPI!.readLargeFile!(filePath);

    const createLazPerf = await loadLazPerf();
    const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });

    let filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    if (!filePtr) {
      const needBytes = arrayBuffer.byteLength;
      const currentBytes = LazPerf.HEAPU8.byteLength;
      const neededPages = Math.ceil((needBytes - currentBytes) / 65536) + 256;
      try { LazPerf._emscripten_resize_heap(currentBytes + neededPages * 65536); } catch (e) { /* ignore */ }
      filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    }
    if (!filePtr) throw new Error("WASM heap too small: need " + (arrayBuffer.byteLength / 1024 / 1024).toFixed(0) + "MB");

    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const pointLength = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();
    const pointPtr = LazPerf._malloc(pointLength);
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(actualFormat);
    const rgbOff = hasRgb ? getRgbOffset(actualFormat) : 0;

    let rgbShift = 8;
    if (hasRgb) {
      const sLaszip = new LazPerf.LASZip();
      sLaszip.open(filePtr, arrayBuffer.byteLength);
      const sPtr = LazPerf._malloc(pointLength);
      const sN = Math.min(2000, count);
      let maxRgb = 0;
      for (let k = 0; k < sN; k++) {
        sLaszip.getPoint(sPtr);
        const o = sPtr + rgbOff;
        maxRgb = Math.max(maxRgb,
          LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8),
          LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8),
          LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8));
      }
      rgbShift = maxRgb > 255 ? 8 : 0;
      LazPerf._free(sPtr);
      sLaszip.delete();
    }

    const CHUNK = 50000;
    let outputIdx = 0;
    let lminY = Infinity, lmaxY = -Infinity;
    const yHist = new Map<number, number>();

    for (let i = 0; i < count; i += CHUNK) {
      const end = Math.min(i + CHUNK, count);
      for (let j = i; j < end; j++) {
        laszip.getPoint(pointPtr);
        if (stride > 1 && j % stride !== 0) continue;

        const wasmOff = pointPtr;
        const ix = LazPerf.HEAP32[wasmOff / 4];
        const iy = LazPerf.HEAP32[wasmOff / 4 + 1];
        const iz = LazPerf.HEAP32[wasmOff / 4 + 2];

        const base = outputIdx * 4;
        const fy = iz * scaleZ + offsetZ - cz;
        f32[base] = ix * scaleX + offsetX - cx;
        f32[base + 1] = fy;
        f32[base + 2] = -(iy * scaleY + offsetY - cy);

        if (fy < lminY) lminY = fy; if (fy > lmaxY) lmaxY = fy;
        const yBin = Math.round(fy * 5) / 5;
        yHist.set(yBin, (yHist.get(yBin) || 0) + 1);

        const byteOff = base * 4 + 12;
        if (hasRgb) {
          const o = wasmOff + rgbOff;
          u8[byteOff] = ((LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8)) >> rgbShift) & 0xff;
          u8[byteOff + 1] = ((LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8)) >> rgbShift) & 0xff;
          u8[byteOff + 2] = ((LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8)) >> rgbShift) & 0xff;
        } else {
          u8[byteOff] = 128; u8[byteOff + 1] = 128; u8[byteOff + 2] = 128;
        }
        u8[byteOff + 3] = 255;
        outputIdx++;
      }
      this.callbacks.onProgress?.(Math.round(end / count * 100));
      if (end < count) await new Promise((r) => setTimeout(r, 0));
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
    vb.unlock();

    const expectedBytes = loadCount * 16;
    if (vbLock.byteLength < expectedBytes) {
      throw new Error(`GPU buffer allocation failed: got ${vbLock.byteLength} bytes, expected ${expectedBytes}.`);
    }

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(fileName);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(0, 0, 0);
    this.app.root.addChild(entity);
    this.entities.set(fileName, entity);
    this.pointStats.set(fileName, { total: count, loaded: loadCount });

    const groundY = findGroundYFromHistogram(yHist, lminY, lmaxY);

    this.callbacks.onFileLoaded?.(fileName, filePath);

    return {
      entity,
      center: [0, 0, 0],
      extent,
      totalPoints: count,
      loadedPoints: loadCount,
      groundY,
    };
  }

  /** 移除一个已加载的实体 */
  removeEntity(name: string) {
    const ent = this.entities.get(name);
    if (ent) {
      ent.destroy();
      this.entities.delete(name);
    }
    this.lasHeaders.delete(name);
    this.filePaths.delete(name);
    this.pointStats.delete(name);
  }

  /** 销毁所有已加载实体 */
  destroy() {
    this.entities.forEach((ent) => ent.destroy());
    this.entities.clear();
    this.lasHeaders.clear();
    this.filePaths.clear();
    this.pointStats.clear();
  }
}
