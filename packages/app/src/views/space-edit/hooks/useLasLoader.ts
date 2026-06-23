import { useCallback } from "react";
import * as pc from "playcanvas";
import { pointcloudVert, pointcloudFrag } from "../../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, LasHeader } from "../../../playcanvas-core/io/read/las-reader";
import { BlobReadFileSystem } from "../../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../../playcanvas-core/io";


/** 根据点数和硬件决定加载比例 */
/** GPU 点预算上限，超出时步长降采样 */
const MAX_POINTS = 10_000_000;

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

/**
 * 从点记录原始字节中读取 RGB
 * rgbShift: 8 表示 RGB 为真 16 位（取高字节），0 表示 RGB 为 8 位存低字节（直接取值）
 */
function readPointRGB(view: DataView, offset: number, formatId: number, hasRgb: boolean, rgbShift: number): [number, number, number] {
  if (!hasRgb) return [128, 128, 128];
  const rgbOff = getRgbOffset(formatId);
  return [
    (view.getUint16(offset + rgbOff, true) >> rgbShift) & 0xff,
    (view.getUint16(offset + rgbOff + 2, true) >> rgbShift) & 0xff,
    (view.getUint16(offset + rgbOff + 4, true) >> rgbShift) & 0xff,
  ];
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

    // 采样检测 RGB 位深：部分 LAS 文件把 8 位颜色(0-255)存在 uint16 低字节，高字节为 0
    // 若采样到的最大值 > 255 则为真 16 位(取高字节)，否则为 8 位(直接取低字节)
    let rgbShift = 8;
    if (hasRgb) {
      const rgbOff = getRgbOffset(formatId);
      const sampleCount = Math.min(2000, count);
      const sampleBuf = await readFileChunk(file, pointDataOffset, sampleCount * pointRecordLength, filePath);
      const sv = new DataView(sampleBuf);
      let maxRgb = 0;
      for (let k = 0; k < sampleCount; k++) {
        const o = k * pointRecordLength;
        maxRgb = Math.max(maxRgb, sv.getUint16(o + rgbOff, true), sv.getUint16(o + rgbOff + 2, true), sv.getUint16(o + rgbOff + 4, true));
      }
      rgbShift = maxRgb > 255 ? 8 : 0;
      console.log("[LAS RGB] maxSample=" + maxRgb + " rgbShift=" + rgbShift + (rgbShift === 0 ? " (8位存低字节)" : " (16位取高字节)"));
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

    // 实测局部坐标范围（相对 header 中心），用于校验 header bbox 是否准确
    let lminX = Infinity, lmaxX = -Infinity, lminY = Infinity, lmaxY = -Infinity, lminZ = Infinity, lmaxZ = -Infinity;

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
          const [r, g, b] = readPointRGB(view, ptOff, formatId, hasRgb, rgbShift);

          const base = outputIdx * 4;
          const fx = ix * scaleX + offsetX - cx;
          const fy = iz * scaleZ + offsetZ - cz;
          const fz = iy * scaleY + offsetY - cy;
          f32[base] = fx;
          f32[base + 1] = fy;
          f32[base + 2] = fz;
          if (fx < lminX) lminX = fx; if (fx > lmaxX) lmaxX = fx;
          if (fy < lminY) lminY = fy; if (fy > lmaxY) lmaxY = fy;
          if (fz < lminZ) lminZ = fz; if (fz > lmaxZ) lmaxZ = fz;

          const byteOff = base * 4 + 12;
          u8[byteOff] = r;
          u8[byteOff + 1] = g;
          u8[byteOff + 2] = b;
          u8[byteOff + 3] = 255;

          if (outputIdx < 3) {
            console.log("[LAS color sample] point#" + srcIdx + " R=" + r + " G=" + g + " B=" + b);
          }

          outputIdx++;
        }
      }
      globalIdx += pointsInChunk;
      setLoadingProgress(Math.round(globalIdx / count * 100));
      requestRender();
      await new Promise((r) => setTimeout(r, 0));
    }

    vb.unlock();
    // Validate buffer allocation succeeded
    const expectedBytes = loadCount * 16;
    if (vbLock.byteLength < expectedBytes) {
      throw new Error(`GPU buffer allocation failed: got ${vbLock.byteLength} bytes, expected ${expectedBytes}. Try reducing point count.`);
    }
    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    // floating origin：实体放到世界原点，点的局部坐标(已减去中心,量级仅±几十)直接作为世界坐标，
    // 避免 UTM 等大坐标(数百万)在 float32 GPU 管线下精度崩溃导致抖动/深度切面/顿挫
    entity.setLocalPosition(0, 0, 0);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
    pointStatsRef.current.set(file.name, { total: count, loaded: loadCount });

    // 相机用局部小坐标（点已减去 header 中心，局部中心≈0）
    const localCenterX = (lminX + lmaxX) / 2;
    const localCenterY = (lminY + lmaxY) / 2;
    const localCenterZ = (lminZ + lmaxZ) / 2;
    const realExtent = Math.max(lmaxX - lminX, lmaxY - lminY, lmaxZ - lminZ, 1);
    console.log("[LAS bbox] header.extent=" + extent.toFixed(1) +
      " 实测.extent=" + realExtent.toFixed(1) +
      " 局部中心=(" + localCenterX.toFixed(2) + "," + localCenterY.toFixed(2) + "," + localCenterZ.toFixed(2) + ")");
    focusOnModel(localCenterX, localCenterY, localCenterZ, realExtent);
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
    const pointSize = Math.max(2.0, extent / Math.cbrt(loadCount) * 0.8);

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

    let arrayBuffer: ArrayBuffer;
    if (filePath && window.electronAPI?.readLargeFile) {
      arrayBuffer = await window.electronAPI.readLargeFile(filePath);
    } else {
      arrayBuffer = await file.arrayBuffer();
    }

    const createLazPerf = await loadLazPerf();
    const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });
    // Allocate WASM heap for compressed file data; grow memory if allocation fails
    let filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    if (!filePtr) {
      // Grow WASM memory and retry: neededPages = ceil((need - current) / 64KB) + 256 extra
      const needBytes = arrayBuffer.byteLength;
      const currentBytes = LazPerf.HEAPU8.byteLength;
      const neededPages = Math.ceil((needBytes - currentBytes) / 65536) + 256;
      try { LazPerf._emscripten_resize_heap(currentBytes + neededPages * 65536); } catch (e) {}
      filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    }
    if (!filePtr) {
      throw new Error("WASM heap too small: need " + (arrayBuffer.byteLength / 1024 / 1024).toFixed(0) + "MB for compressed LAZ data");
    }
    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const pointLength = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();
    const pointPtr = LazPerf._malloc(pointLength);
    const hasRgb = [2, 3, 5, 7, 8, 10].includes(actualFormat);
    const rgbOff = hasRgb ? getRgbOffset(actualFormat) : 0;

    // 采样检测 RGB 位深：>255 为真 16 位(取高字节)，否则 8 位存低字节(直接取值)
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
      console.log("[LAS RGB] maxSample=" + maxRgb + " rgbShift=" + rgbShift + (rgbShift === 0 ? " (8位存低字节)" : " (16位取高字节)"));
    }

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
      setLoadingProgress(Math.round(end / count * 100));
      requestRender();
      if (end < count) await new Promise((r) => setTimeout(r, 0));
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
    vb.unlock();
    console.log("[LAS load] total=" + count + " loaded=" + loadCount + " stride=" + stride +
      " buffer=" + (vbLock.byteLength / 1024 / 1024).toFixed(1) + "MB" +
      " formatId=" + actualFormat + " hasRgb=" + hasRgb);
    // Validate buffer allocation succeeded
    const expectedBytes = loadCount * 16;
    if (vbLock.byteLength < expectedBytes) {
      throw new Error(`GPU buffer allocation failed: got ${vbLock.byteLength} bytes, expected ${expectedBytes}. Try reducing point count.`);
    }

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: loadCount };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    // floating origin：实体放世界原点，点局部坐标直接作世界坐标，避免大坐标 float32 精度问题
    entity.setLocalPosition(0, 0, 0);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
    pointStatsRef.current.set(file.name, { total: count, loaded: loadCount });
    focusOnModel(0, 0, 0, extent);
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

