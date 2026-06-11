import { useRef, useEffect, useState } from "react";
import * as pc from "playcanvas";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";
import { BlobReadFileSystem } from "../../playcanvas-core/io/read/file-systems";
import { loadGSplatData } from "../../playcanvas-core/io";
import { pointcloudVert, pointcloudFrag } from "../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl } from "../../playcanvas-core/io/read/las-reader";

export default function SpaceEdit() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const appRef = useRef<pc.Application | null>(null);

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

    // 自适应分辨率
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

  const loadLas = async (file: File) => {
    setLoading(true);
    const CHUNK = 200000;
    try {
      let arrayBuffer: ArrayBuffer;
      // 大文件（>1.5GB）走 Node.js fs，绕开 JS ArrayBuffer 2GB 上限
      const filePath = window.electronAPI?.getFilePath(file);
      console.log("file.path:", filePath, "size:", (file.size / 1024 / 1024 / 1024).toFixed(2), "GB");
      
      if (file.size > 1.5 * 1024 * 1024 * 1024 && filePath && window.electronAPI?.readLargeFile) {
        console.log("走 IPC 大文件读取:", filePath);
        arrayBuffer = await window.electronAPI.readLargeFile(filePath);
      } else if (file.size > 1.8 * 1024 * 1024 * 1024) {
        throw new Error(`文件超过 2GB，JS ArrayBuffer 不支持，且无可用文件路径`);
      } else {
        arrayBuffer = await file.arrayBuffer();
      }
      const header = parseLasHeader(arrayBuffer);
      console.log(`LAS 点云: ${header.pointCount.toLocaleString()} 个点`);

      const app = appRef.current!;
      const gd = app.graphicsDevice;
      const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ } = header;

      // 中心偏移（supersplat-main calcCenterOffset）
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;

      // 点大小（supersplat-main calcPointSize）
      const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
      const pointSize = extent / Math.cbrt(header.pointCount) * 0.8;

      // 着色器材质
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

      // 交错顶点缓冲
      const format = new pc.VertexFormat(gd, [
        { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
        { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
      ]);
      const count = header.pointCount;
      const vb = new pc.VertexBuffer(gd, format, count, { usage: pc.BUFFER_STATIC });
      const vbLock = vb.lock() as ArrayBuffer;
      const f32 = new Float32Array(vbLock);
      const u8 = new Uint8Array(vbLock);

      // 加载 laz-perf WASM，直接将文件复制到 WASM 堆
      const createLazPerf = await loadLazPerf();
      const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });
      const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
      LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

      const laszip = new LazPerf.LASZip();
      laszip.open(filePtr, arrayBuffer.byteLength);

      const pointLength = laszip.getPointLength();
      const actualFormat = laszip.getPointFormat();
      const pointPtr = LazPerf._malloc(pointLength);

      // RGB 偏移（参考 supersplat-main）
      const hasRgb = [2, 3, 5, 7, 8, 10].includes(actualFormat);
      let rgbOff = 0;
      if (hasRgb) {
        rgbOff = actualFormat >= 6 ? 30 : 20;
      }

      // 分批解码 → 直写 GPU 缓冲（零 JS 中间对象）
      for (let i = 0; i < count; i += CHUNK) {
        const end = Math.min(i + CHUNK, count);
        for (let j = i; j < end; j++) {
          laszip.getPoint(pointPtr);
          const wasmOff = pointPtr;

          // 整数坐标 → 世界坐标
          const ix = LazPerf.HEAP32[wasmOff / 4];
          const iy = LazPerf.HEAP32[wasmOff / 4 + 1];
          const iz = LazPerf.HEAP32[wasmOff / 4 + 2];

          const base = j * 4;
          f32[base] = ix * scaleX + offsetX - cx;
          f32[base + 1] = iz * scaleZ + offsetZ - cz;
          f32[base + 2] = iy * scaleY + offsetY - cy;

          const byteOff = base * 4 + 12;
          if (hasRgb) {
            u8[byteOff] = LazPerf.HEAPU8[wasmOff + rgbOff + 1];     // R
            u8[byteOff + 1] = LazPerf.HEAPU8[wasmOff + rgbOff + 3]; // G
            u8[byteOff + 2] = LazPerf.HEAPU8[wasmOff + rgbOff + 5]; // B
          } else {
            u8[byteOff] = 128;
            u8[byteOff + 1] = 128;
            u8[byteOff + 2] = 128;
          }
          u8[byteOff + 3] = 255;
        }
        console.log(`LAS: ${Math.round(end / count * 100)}%`);
        if (end < count) {
          await new Promise((r) => setTimeout(r, 0));
        }
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
      entity.setLocalPosition(cx * scaleX + offsetX, cz * scaleZ + offsetZ, cy * scaleY + offsetY);
      app.root.addChild(entity);

      console.log(`LAS 渲染就绪`);
    } catch (e: any) {
      console.error("LAS 加载失败:", e.message, e.stack);
    }
    setLoading(false);
  };

  const loadPly = async (file: File) => {
    setLoading(true);
    try {
      const fs = new BlobReadFileSystem();
      fs.set(file.name, file);
      const { gsplatData } = await loadGSplatData(file.name, fs);
      console.log(`加载成功: ${gsplatData.numSplats} 个 splats`);

      const app = appRef.current!;
      const asset = new pc.Asset(file.name, "gsplat", { url: `local-${Date.now()}`, filename: file.name });
      app.assets.add(asset);
      asset.resource = new pc.GSplatResource(app.graphicsDevice, gsplatData);

      const entity = new pc.Entity(file.name);
      entity.addComponent("gsplat", { asset: asset });
      app.root.addChild(entity);
    } catch (e: any) {
      console.error("加载失败:", e.message);
    }
    setLoading(false);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "las" || ext === "laz") {
      loadLas(file);
    } else {
      loadPly(file);
    }
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", position: "absolute", top: 0, left: 0 }} />
      <div style={{ position: "absolute", top: 8, left: 8 }}>
        <input ref={fileInputRef} type="file" accept=".ply,.splat,.las,.laz" onChange={handleFile} style={{ display: "none" }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={loading} style={{ padding: "4px 12px", cursor: "pointer" }}>
          {loading ? "加载中..." : "加载文件"}
        </button>
      </div>
    </div>
  );
}
