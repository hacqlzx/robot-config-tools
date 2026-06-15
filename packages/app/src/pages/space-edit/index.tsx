import { useRef, useEffect, useState, useCallback } from "react";
import * as pc from "playcanvas";
import { message } from "antd";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";
import { BlobReadFileSystem } from "../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../playcanvas-core/io";
import { pointcloudVert, pointcloudFrag } from "../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, LasHeader } from "../../playcanvas-core/io/read/las-reader";
import Toolbar from "./components/Toolbar";
import ViewCube from "./components/ViewCube";
import SidePanel from "./components/SidePanel";
import ClipController from "./components/ClipController";

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

export default function SpaceEdit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<SimpleOrbitCamera | null>(null);
  const appRef = useRef<pc.Application | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState<Set<string>>(new Set());
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set());
  const [treeKey, setTreeKey] = useState(0);
  const [clipMode, setClipMode] = useState(false);
  const [clipEntityName, setClipEntityName] = useState("");
  const entitiesRef = useRef<Map<string, pc.Entity>>(new Map());
  const lasHeadersRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      componentSystems: [
        pc.AnimComponentSystem,
        pc.RenderComponentSystem,
        pc.CameraComponentSystem,
        pc.LightComponentSystem,
        pc.GSplatComponentSystem,
      ],
      resourceHandlers: [
        pc.RenderHandler,
        pc.AnimClipHandler,
        pc.TextureHandler,
        pc.CubemapHandler,
        pc.ContainerHandler,
        pc.GSplatHandler,
      ],
      graphicsDeviceOptions: {
        preferWebGl2: true,
        powerPreference: "high-performance",
      },
    });

    let rafId: number;
    const doResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const cvs = canvasRef.current;
        const ct = containerRef.current;
        if (!cvs || !ct || !app.graphicsDevice) return;
        const rect = ct.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (w > 0 && h > 0 && (cvs.width !== w || cvs.height !== h)) {
          cvs.width = w;
          cvs.height = h;
          app.resizeCanvas(w, h);
        }
      });
    };
    const observer = new ResizeObserver(doResize);
    observer.observe(container);
    window.addEventListener("resize", doResize);
    doResize();

    app.scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);
    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", color: pc.Color.WHITE, intensity: 1 });
    light.setEulerAngles(45, 45, 0);
    app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", { fov: 60, clearColor: new pc.Color(0.12, 0.12, 0.12) });
    app.root.addChild(camera);

    const orbit = new SimpleOrbitCamera(app, camera);
    orbitRef.current = orbit;
    app.start();
    appRef.current = app;

    return () => {
      window.removeEventListener("resize", doResize);
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      orbit.destroy();
      app.destroy();
    };
  }, []);

  const handleViewChange = useCallback((direction: "前" | "后" | "左" | "右" | "上" | "下") => {
    orbitRef.current?.setViewDirection(direction);
  }, []);

  /** 将相机焦点移到指定位置 */
  const focusOnModel = useCallback((centerX: number, centerY: number, centerZ: number, extent: number) => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    orbit.lookAt.set(centerX, centerY, centerZ);
    orbit.distance = extent * 1.5;
    orbit.updateCamera();
  }, []);

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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = extent / Math.cbrt(count) * 0.8;

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
    const vb = new pc.VertexBuffer(gd, format, count, { usage: pc.BUFFER_STATIC });
    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    const FILE_CHUNK_POINTS = 500000;
    const GPU_CHUNK = 200000;
    let globalIdx = 0;

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
          const ptOff = j * pointRecordLength;
          const [ix, iy, iz] = readPointXYZ(view, ptOff);
          const [r, g, b] = readPointRGB(view, ptOff, formatId, hasRgb);

          const base = (globalIdx + j) * 4;
          f32[base] = ix * scaleX + offsetX - cx;
          f32[base + 1] = iz * scaleZ + offsetZ - cz;
          f32[base + 2] = iy * scaleY + offsetY - cy;

          const byteOff = base * 4 + 12;
          u8[byteOff] = r;
          u8[byteOff + 1] = g;
          u8[byteOff + 2] = b;
          u8[byteOff + 3] = 255;
        }
      }
      globalIdx += pointsInChunk;
      await new Promise((r) => setTimeout(r, 0));
    }

    vb.unlock();
    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(cx, cz, cy);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
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

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const pointSize = extent / Math.cbrt(count) * 0.8;

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
    const vb = new pc.VertexBuffer(gd, format, count, { usage: pc.BUFFER_STATIC });
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

    const CHUNK = 200000;
    for (let i = 0; i < count; i += CHUNK) {
      const end = Math.min(i + CHUNK, count);
      for (let j = i; j < end; j++) {
        laszip.getPoint(pointPtr);
        const wasmOff = pointPtr;
        const ix = LazPerf.HEAP32[wasmOff / 4];
        const iy = LazPerf.HEAP32[wasmOff / 4 + 1];
        const iz = LazPerf.HEAP32[wasmOff / 4 + 2];

        const base = j * 4;
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
      }
      if (end < count) await new Promise((r) => setTimeout(r, 0));
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
    vb.unlock();

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;
    const entity = new pc.Entity(file.name);
    entity.addComponent("render", { meshInstances: [mi] });
    entity.setLocalPosition(cx, cz, cy);
    app.root.addChild(entity);
    entitiesRef.current.set(file.name, entity);
    focusOnModel(cx, cz, cy, extent);
  };

  const loadLas = async (file: File) => {
    setLoading(true);
    try {
      const filePath = window.electronAPI?.getFilePath(file);
      const headerBuf = await readFileChunk(file, 0, 4096, filePath);
      const header = parseLasHeader(headerBuf);

      // 保存原始 header 用于导出
      lasHeadersRef.current.set(file.name, header);

      if (isLasCompressed(header.pointFormatId)) {
        await loadLazWasm(file, filePath, header);
      } else {
        await loadLasStreaming(file, filePath, header);
      }
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message);
    }
    setLoading(false);
  };

  const loadPly = async (file: File) => {
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

      // 聚焦模型
      const aabb = new pc.BoundingBox();
      gsplatData.calcAabb(aabb);
      const center = aabb.getCenter();
      const extent = Math.max(aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z) * 2;
      focusOnModel(center.x, center.y, center.z, extent);
    } catch (e: any) {
      console.error("加载失败:", e.message);
    }
    setLoading(false);
  };

  const loadLasFromPath = async (filePath: string) => {
    setLoading(true);
    try {
      const fileName = filePath.split(/[\\/]/).pop() || "unknown.las";
      const headerBuf = await window.electronAPI!.readFileChunk(filePath, 0, 4096);
      const header = parseLasHeader(headerBuf);

      const file = new File([], fileName);
      lasHeadersRef.current.set(fileName, header);

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
  };

  const handleFileSelect = async (file: File) => {
    // 导入文件到项目目录
    if (window.electronAPI) {
      const sourcePath = window.electronAPI.getFilePath(file);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const selectedProject = localStorage.getItem("selectedProject");
      if (sourcePath && selectedProject) {
        try {
          await window.electronAPI.project.importFile(selectedProject, sourcePath, baseName);
        } catch (err: any) {
          console.error("文件导入失败:", err.message);
        }
      }
    }

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "las" || ext === "laz") {
      loadLas(file);
    } else {
      loadPly(file);
    }
    setLoadedFiles((prev) => new Set([...prev, file.name]));
    setTreeKey((k) => k + 1);
  };

  const handleToggleVisible = useCallback((filePath: string) => {
    const entityName = filePath.split(/[\\/]/).pop() || filePath;
    const entity = entitiesRef.current.get(entityName);
    if (!entity) return;

    const isHidden = hiddenFiles.has(filePath);
    if (isHidden) {
      entity.enabled = true;
      setHiddenFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    } else {
      entity.enabled = false;
      setHiddenFiles((prev) => new Set([...prev, filePath]));
    }
  }, [hiddenFiles]);

  const handleClipModel = useCallback(() => {
    const entities = Array.from(entitiesRef.current.entries());
    if (entities.length === 0) {
      message.warning("请先加载模型");
      return;
    }
    setClipEntityName(entities[0][0]);
    setClipMode(true);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Toolbar onFileSelect={handleFileSelect} onClipModel={handleClipModel} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ViewCube onViewChange={handleViewChange} />
        <SidePanel
          key={treeKey}
          onLoadLas={loadLasFromPath}
          onToggleVisible={handleToggleVisible}
          loadedFiles={loadedFiles}
          hiddenFiles={hiddenFiles}
        />
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", position: "absolute", top: 0, left: 0 }} />
          {clipMode && appRef.current && (
            <ClipController
              app={appRef.current}
              entityName={clipEntityName}
              lasHeader={lasHeadersRef.current.get(clipEntityName) || null}
              onClose={() => setClipMode(false)}
              onComplete={() => setTreeKey((k) => k + 1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
