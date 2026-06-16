import { useRef, useEffect, useState, useCallback } from "react";
import * as pc from "playcanvas";
import { message, Spin } from "antd";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";
import { BlobReadFileSystem } from "../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../playcanvas-core/io";
import { pointcloudVert, pointcloudFrag } from "../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, LasHeader } from "../../playcanvas-core/io/read/las-reader";

/** 根据点数和硬件决定加载比例 */
function getLoadFraction(pointCount: number): number {
  if (pointCount > 20_000_000) return 0.25;
  if (pointCount > 10_000_000) return 0.5;
  return 1;
}

/** GPU 点预算上限，超出时步长降采样 */
const MAX_POINTS = 10_000_000;

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
  const [loadingFile, setLoadingFile] = useState("");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingText, setLoadingText] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<Set<string>>(new Set());
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set());
  const [treeKey, setTreeKey] = useState(0);
  const [clipMode, setClipMode] = useState(false);
  const [clipEntityName, setClipEntityName] = useState("");
  const entitiesRef = useRef<Map<string, pc.Entity>>(new Map());
  const lasHeadersRef = useRef<Map<string, any>>(new Map());
  const filePathRef = useRef<Map<string, string>>(new Map());
  const pointStatsRef = useRef<Map<string, { total: number; loaded: number }>>(new Map());
  const renderDirtyRef = useRef(true);

  /** 按需渲染：标记脏位，rAF 循环检测到后执行一次 app.render() */
  const requestRender = useCallback(() => {
    renderDirtyRef.current = true;
  }, []);

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
    } as any);

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
        renderDirtyRef.current = true;
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

    const orbit = new SimpleOrbitCamera(app, camera, () => { renderDirtyRef.current = true; });
    orbitRef.current = orbit;
    app.graphicsDevice.maxPixelRatio = 1;

    // P0: 关闭持续渲染循环，改用按需渲染
    app.autoRender = false;
    app.start();
    appRef.current = app;

    // 按需渲染循环：仅脏标记为 true 时执行一帧
    let renderRafId = 0;
    const renderLoop = () => {
      if (renderDirtyRef.current) {
        app.render();
        renderDirtyRef.current = false;
      }
      renderRafId = requestAnimationFrame(renderLoop);
    };
    renderRafId = requestAnimationFrame(renderLoop);

    return () => {
      window.removeEventListener("resize", doResize);
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (renderRafId) cancelAnimationFrame(renderRafId);
      orbit.destroy();
      app.destroy();
    };
  }, []);

  // 大模型显示比例：渲染后更新 uDisplayRatio
  useEffect(() => {
    if (loadedFiles.size === 0) return;
    entitiesRef.current.forEach((ent) => {
      const mi = ent.render?.meshInstances?.[0];
      if (mi?.material) {
        const vb = mi.mesh?.vertexBuffer;
        if (vb) {
          (mi.material as any).setParameter?.("uDisplayRatio", getLoadFraction(vb.getNumVertices()));
          mi.material.update?.();
        }
      }
    });
    requestRender();
  }, [loadedFiles]);

  const handleViewChange = useCallback((direction: "前" | "后" | "左" | "右" | "上" | "下") => {
    orbitRef.current?.setViewDirection(direction);
    requestRender();
  }, []);

  /** 将相机焦点移到指定位置 */
  const focusOnModel = useCallback((centerX: number, centerY: number, centerZ: number, extent: number) => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    orbit.lookAt.set(centerX, centerY, centerZ);
    orbit.distance = extent * 1.5;
    orbit.updateCamera();
    requestRender();
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

    // P1: 点数上限 — 步长降采样
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

    // P1: 点数上限 — 步长降采样
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

  const loadLas = async (file: File) => {
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
  };

  const loadLasFromPath = async (filePath: string) => {
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
  };

  const handleFileSelect = async (file: File) => {
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
    requestRender();
  }, [hiddenFiles]);

  const handleClipModel = useCallback(() => {
    const entries = Array.from(entitiesRef.current.entries());
    if (entries.length === 0) {
      message.warning("请先加载模型");
      return;
    }

    entries.forEach(([key, ent]) => {
      if (!ent.enabled) {
        ent.destroy();
        entitiesRef.current.delete(key);
      }
    });

    const visible = Array.from(entitiesRef.current.entries());
    if (visible.length > 1) {
      message.warning("存在多个可见模型，请只保留一个模型后再裁切");
      return;
    }
    if (visible.length === 0) {
      message.warning("没有可见模型");
      return;
    }

    setClipEntityName(visible[0][0]);
    setClipMode(true);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Toolbar onFileSelect={handleFileSelect} onClipModel={handleClipModel} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ViewCube onViewChange={handleViewChange} />
        <SidePanel
          treeKey={treeKey}
          onLoadLas={loadLasFromPath}
          onToggleVisible={handleToggleVisible}
          loadedFiles={loadedFiles}
          hiddenFiles={hiddenFiles}
          loadingFile={loadingFile}
        />
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", position: "absolute", top: 0, left: 0 }} />
          {(loading || loadingProgress > 0) && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "all" }}>
              <Spin size="large" />
              <div style={{ color: "#fff", marginTop: 16, fontSize: 14 }}>{loadingText || "处理中..."}</div>
              {loadingProgress > 0 && (
                <div style={{ width: 200, marginTop: 12 }}>
                  <div style={{ width: "100%", height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${loadingProgress}%`, height: "100%", background: "#fff", borderRadius: 2, transition: "width 0.2s" }} />
                  </div>
                  <div style={{ color: "#fff", fontSize: 12, textAlign: "center", marginTop: 4 }}>{loadingProgress}%</div>
                </div>
              )}
            </div>
          )}
          {/* 点信息 */}
          {loadedFiles.size > 0 && (
            <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.55)", color: "#ccc", padding: "4px 8px", borderRadius: 4, fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, zIndex: 10, pointerEvents: "none", userSelect: "none" }}>
              {Array.from(loadedFiles).map((name) => {
                const stats = pointStatsRef.current.get(name);
                if (!stats) return null;
                const rate = stats.total > 0 ? (stats.loaded / stats.total * 100).toFixed(1) : "100";
                const isDown = stats.loaded < stats.total;
                return (
                  <div key={name}>
                    <div>{name}</div>
                    <div>总计: {stats.total.toLocaleString()} | 加载: {stats.loaded.toLocaleString()} {isDown ? `| 采样: ${rate}%` : ""}</div>
                  </div>
                );
              })}
            </div>
          )}
          {clipMode && appRef.current && (
            <ClipController
              app={appRef.current}
              entityName={clipEntityName}
              lasHeader={lasHeadersRef.current.get(clipEntityName) || null}
              origFilePath={filePathRef.current.get(clipEntityName) || ""}
              onClose={() => setClipMode(false)}
              onProgress={(pct) => { setLoadingProgress(pct); setLoadingText(pct >= 100 ? "" : "正在保存..."); }}
              onComplete={(clipName) => {
                setTreeKey((k) => k + 1);
                setLoadingText("");
                setLoadingProgress(0);
                if (clipName) {
                  const oldEnt = entitiesRef.current.get(clipEntityName);
                  if (oldEnt) { oldEnt.destroy(); entitiesRef.current.delete(clipEntityName); }
                  setLoadedFiles((prev) => { const next = new Set(prev); next.delete(clipEntityName); return next; });

                  setTimeout(async () => {
                    const project = localStorage.getItem("selectedProject");
                    if (project && window.electronAPI) {
                      const files = await window.electronAPI.project.listTree(project, `地图/${clipName}`);
                      const lasFile: any = files.find((f: any) => f.name.endsWith(".las"));
                      if (lasFile) loadLasFromPath(lasFile.path);
                    }
                  }, 500);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
