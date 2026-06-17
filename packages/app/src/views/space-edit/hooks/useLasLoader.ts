import { useCallback } from "react";
import * as pc from "playcanvas";
import { pointcloudVert, pointcloudFrag } from "../../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, LasHeader } from "../../../playcanvas-core/io/read/las-reader";
import { BlobReadFileSystem } from "../../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../../playcanvas-core/io";

/** GPU 点预算上限，超出时步长降采样 */
const MAX_POINTS = 20_000_000;

/** 检查 LAS 是否 LAZ 压缩 */
function isLasCompressed(formatId: number): boolean {
  return formatId >= 128;
}

/** 从点记录字节中读取 int32 小端坐标 */
function readPointXYZ(view: DataView, offset: number): [number, number, number] {
  return [view.getInt32(offset, true), view.getInt32(offset + 4, true), view.getInt32(offset + 8, true)];
}

/** 根据点格式获取 RGB 在点记录中的字节偏移 */
function getRgbOffset(formatId: number): number {
  if (formatId >= 6) return 30;
  if (formatId === 3 || formatId === 5) return 28;
  return 20;
}

/** 从点记录原始字节中读取 RGB */
function readPointRGB(view: DataView, offset: number, formatId: number, hasRgb: boolean): [number, number, number] {
  if (!hasRgb) return [128, 128, 128];
  const rgbOff = getRgbOffset(formatId);
  return [view.getUint8(offset + rgbOff + 1), view.getUint8(offset + rgbOff + 3), view.getUint8(offset + rgbOff + 5)];
}

interface UseLasLoaderParams {
  appRef: React.MutableRefObject<pc.Application | null>;
  entitiesRef: React.MutableRefObject<Map<string, pc.Entity>>;
  lasHeadersRef: React.MutableRefObject<Map<string, any>>;
  filePathRef: React.MutableRefObject<Map<string, string>>;
  pointStatsRef: React.MutableRefObject<Map<string, { total: number; loaded: number }>>;
  requestRender: () => void;
  focusOnModel: (cx: number, cy: number, cz: number, extent: number) => void;
  setLoading: (v: boolean) => void;
  setLoadingFile: (v: string) => void;
  setLoadingText: (v: string) => void;
  setLoadingProgress: (v: number) => void;
  setLoadedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setTreeKey: React.Dispatch<React.SetStateAction<number>>;
}

export function useLasLoader({
  appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef,
  requestRender, focusOnModel,
  setLoading, setLoadingFile, setLoadingText, setLoadingProgress,
  setLoadedFiles, setTreeKey,
}: UseLasLoaderParams) {

  const readFileChunk = async (file: File, offset: number, length: number, filePath: string | undefined): Promise<ArrayBuffer> => {
    if (filePath && window.electronAPI?.readFileChunk) {
      return window.electronAPI.readFileChunk(filePath, offset, length);
    }
    return file.slice(offset, offset + length).arrayBuffer();
  };

  const loadLasStreaming = async (file: File, filePath: string | undefined, header: LasHeader) => {
    const app = appRef.current!;
    const gd = app.graphicsDevice;
    const count = header.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ, pointFormatId, pointRecordLength, pointDataOffset } = header;
    const formatId = pointFormatId & 0x7F;
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(formatId);

    const stride = count > MAX_POINTS ? Math.ceil(count / MAX_POINTS) : 1;
    const loadCount = Math.ceil(count / stride);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = extent / Math.cbrt(loadCount) * 0.8;

    const mat = new pc.ShaderMaterial({
      uniqueName: "pointcloud",
      vertexGLSL: pointcloudVert,
      fragmentGLSL: pointcloudFrag,
    });
    mat.blendType = pc.BLEND_NORMAL;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.cull = pc.CULLFACE_NONE;
    mat.setParameter("uPointSize", pointSize);
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

    const totalBytes = count * pointRecordLength;
    const fileChunkBytes = FILE_CHUNK_POINTS * pointRecordLength;

    for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
      const remaining = count - globalIdx;
      const pointsInChunk = Math.min(FILE_CHUNK_POINTS, remaining);
      const readSize = pointsInChunk * pointRecordLength;
      const chunkBuf = await readFileChunk(file, fileOff, readSize, filePath);
      const view = new DataView(chunkBuf);

      for (let i = 0; i < pointsInChunk; i += GPU_CHUNK) {
        const gpuEnd = Math.min(i + GPU_CHUNK, pointsInChunk);
        for (let j = i; j < gpuEnd; j++) {
          const srcIdx = globalIdx + j;
          if (stride > 1 && srcIdx % stride !== 0) continue;

          const ptOff = j * pointRecordLength;
          const [ix, iy, iz] = readPointXYZ(view, ptOff);
          const [r, g, b] = readPointRGB(view, ptOff, formatId, hasRgb);

          const base = outputIdx * 4;
          f32[base] = ix * scaleX + offsetX - cx;
          f32[base + 1] = iz * scaleZ + offsetZ - cz;
          f32[base + 2] = iy * scaleY + offsetY - cy;

          const byteOff = base * 4 + 12;
          u8[byteOff] = r;
          u8[byteOff + 1] = g;
          u8[byteOff + 2] = b;
          u8[byteOff + 3] = 255;

          outputIdx++;
        }
      }
      globalIdx += pointsInChunk;
      setLoadingProgress(Math.round(globalIdx / count * 100));
      requestRender();
      await new Promise((r) => setTimeout(r, 0));
    }

    vb.unlock();
    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(cx, cz, cy);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
    pointStatsRef.current.set(file.name, { total: count, loaded: loadCount });
    focusOnModel(cx, cz, cy, extent);
  };

  const loadLazWasm = async (file: File, filePath: string | undefined, header: LasHeader) => {
    const MAX_LAZ_SIZE = 1.5 * 1024 * 1024 * 1024;
    if (file.size > MAX_LAZ_SIZE) {
      throw new Error(`LAZ 压缩文件过大`);
    }

    const app = appRef.current!;
    const gd = app.graphicsDevice;
    const count = header.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ } = header;

    const stride = count > MAX_POINTS ? Math.ceil(count / MAX_POINTS) : 1;
    const loadCount = Math.ceil(count / stride);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = extent / Math.cbrt(loadCount) * 0.8;

    const mat = new pc.ShaderMaterial({
      uniqueName: "pointcloud",
      vertexGLSL: pointcloudVert,
      fragmentGLSL: pointcloudFrag,
    });
    mat.blendType = pc.BLEND_NORMAL;
    mat.depthWrite = true;
    mat.depthTest = true;
    mat.cull = pc.CULLFACE_NONE;
    mat.setParameter("uPointSize", pointSize);
    mat.update();

    const format = new pc.VertexFormat(gd, [
      { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
      { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
    ]);
    const vb = new pc.VertexBuffer(gd, format, loadCount, { usage: pc.BUFFER_STATIC });
    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    let arrayBuffer: ArrayBuffer;
    if (filePath && window.electronAPI?.readLargeFile) {
      arrayBuffer = await window.electronAPI.readLargeFile(filePath);
    } else {
      arrayBuffer = await file.arrayBuffer();
    }

    const createLazPerf = await loadLazPerf();
    const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });
    const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const pointLength = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();
    const pointPtr = LazPerf._malloc(pointLength);
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(actualFormat);
    const rgbOff = hasRgb ? (actualFormat >= 6 ? 30 : 20) : 0;

    const CHUNK = 50000;
    let outputIdx = 0;
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
        f32[base] = ix * scaleX + offsetX - cx;
        f32[base + 1] = iz * scaleZ + offsetZ - cz;
        f32[base + 2] = iy * scaleY + offsetY - cy;

        const byteOff = base * 4 + 12;
        if (hasRgb) {
          u8[byteOff] = LazPerf.HEAPU8[wasmOff + rgbOff + 1];
          u8[byteOff + 1] = LazPerf.HEAPU8[wasmOff + rgbOff + 3];
          u8[byteOff + 2] = LazPerf.HEAPU8[wasmOff + rgbOff + 5];
        } else {
          u8[byteOff] = 128; u8[byteOff + 1] = 128; u8[byteOff + 2] = 128;
        }
        u8[byteOff + 3] = 255;
        outputIdx++;
      }
      setLoadingProgress(Math.round(end / count * 100));
      requestRender();
      if (end < count) await new Promise((r) => setTimeout(r, 0));
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
    vb.unlock();

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(cx, cz, cy);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
    pointStatsRef.current.set(file.name, { total: count, loaded: loadCount });
    focusOnModel(cx, cz, cy, extent);
  };

  const loadLas = useCallback(async (file: File) => {
    setLoading(true);
    setLoadingFile(file.name);
    setLoadingText("正在加载模型...");
    try {
      const filePath = window.electronAPI?.getFilePath(file);
      const headerBuf = await readFileChunk(file, 0, 4096, filePath);
      const header = parseLasHeader(headerBuf);

      lasHeadersRef.current.set(file.name, header);
      filePathRef.current.set(file.name, filePath || "");

      if (isLasCompressed(header.pointFormatId)) {
        await loadLazWasm(file, filePath, header);
      } else {
        await loadLasStreaming(file, filePath, header);
      }
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message);
    }
    setLoading(false);
    setLoadingFile("");
    setLoadingText("");
    setLoadingProgress(0);
  }, [appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, requestRender, focusOnModel, setLoading, setLoadingFile, setLoadingText, setLoadingProgress]);

  const loadPly = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const fs = new BlobReadFileSystem();
      fs.set(file.name, file);
      const { gsplatData } = await loadGSplatData(file.name, fs);

      const app = appRef.current!;
      const asset = new pc.Asset(file.name, "gsplat", { url: `local-${Date.now()}`, filename: file.name });
      app.assets.add(asset);
      asset.resource = new pc.GSplatResource(app.graphicsDevice, gsplatData);

      const entity = new pc.Entity(file.name);
      entity.addComponent("gsplat", { asset: asset });
      app.root.addChild(entity);
      entitiesRef.current.set(file.name, entity);
      pointStatsRef.current.set(file.name, { total: gsplatData.numSplats, loaded: gsplatData.numSplats });

      const aabb = new pc.BoundingBox();
      gsplatData.calcAabb(aabb);
      const center = aabb.center;
      const extent = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z) * 2;
      focusOnModel(center.x, center.y, center.z, extent);
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message);
    }
    setLoading(false);
    setLoadingFile("");
  }, [appRef, entitiesRef, pointStatsRef, focusOnModel, setLoading, setLoadingFile]);

  const loadLasFromPath = useCallback(async (filePath: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || "unknown.las";
    setLoading(true);
    setLoadingFile(fileName);
    setLoadingText("正在加载模型...");
    try {
      const headerBuf = await window.electronAPI!.readFileChunk(filePath, 0, 4096);
      const header = parseLasHeader(headerBuf);

      const file = new File([], fileName);
      lasHeadersRef.current.set(fileName, header);
      filePathRef.current.set(fileName, filePath);

      if (isLasCompressed(header.pointFormatId)) {
        await loadLazWasm(file, filePath, header);
      } else {
        await loadLasStreaming(file, filePath, header);
      }
      setLoadedFiles((prev) => new Set([...prev, fileName]));
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message);
    }
    setLoading(false);
    setLoadingFile("");
    setLoadingText("");
    setLoadingProgress(0);
  }, [appRef, entitiesRef, lasHeadersRef, filePathRef, pointStatsRef, requestRender, focusOnModel, setLoading, setLoadingFile, setLoadingText, setLoadingProgress, setLoadedFiles]);

  return { loadLas, loadPly, loadLasFromPath };
}
