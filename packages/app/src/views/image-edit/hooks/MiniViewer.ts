/**
 * Mini 3D 预览引擎
 * 参考 useLasLoader 的实现，封装 PlayCanvas + LAS/LAZ 点云加载 + 轨道相机
 */
import * as pc from "playcanvas";
import { SimpleOrbitCamera } from "../../../playcanvas-core/simple-camera";
import { pointcloudVert, pointcloudFrag } from "../../../playcanvas-core/shaders/pointcloud-shader";
import { parseLasHeader, loadLazPerf, getWasmUrl, LasHeader } from "../../../playcanvas-core/io/read/las-reader";

function isLasCompressed(formatId: number): boolean {
  return formatId >= 128;
}

function getRgbOffset(formatId: number): number {
  if (formatId >= 6) return 30;
  if (formatId === 3 || formatId === 5) return 28;
  return 20;
}

/** 世界坐标 LAS → PlayCanvas 局部坐标（减中心 + Z→Y 翻转） */
function toLocal3D(lx: number, ly: number, lz: number, cx: number, cy: number, cz: number): [number, number, number] {
  return [lx - cx, lz - cz, -(ly - cy)];
}

export class MiniViewer {
  canvas: HTMLCanvasElement;
  app: pc.Application;
  orbit: SimpleOrbitCamera | null = null;
  cameraEntity: pc.Entity;
  private renderDirty = true;
  private rafId = 0;
  private lastTime = 0;
  private ro: ResizeObserver | null = null;
  private entities: pc.Entity[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.app = new pc.Application(canvas, {
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
        preserveDrawingBuffer: true,
      },
    } as any);

    this.app.scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);

    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", color: pc.Color.WHITE, intensity: 0.8 });
    light.setEulerAngles(45, 45, 0);
    this.app.root.addChild(light);

    this.cameraEntity = new pc.Entity("camera");
    this.cameraEntity.addComponent("camera", { fov: 50, clearColor: new pc.Color(0.12, 0.12, 0.12) });
    this.app.root.addChild(this.cameraEntity);

    this.orbit = new SimpleOrbitCamera(this.app, this.cameraEntity, () => {
      this.renderDirty = true;
    });

    this.app.autoRender = false;
    this.app.start();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.orbit?.updateFly(dt);
    if (this.renderDirty) {
      this.app.render();
      this.renderDirty = false;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  observeResize(container: HTMLElement) {
    this.ro?.disconnect();
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      this.canvas.width = w;
      this.canvas.height = h;
      this.app.resizeCanvas(w, h);
      this.renderDirty = true;
    };
    resize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);
  }

  clear() {
    for (const e of this.entities) {
      this.app.root.removeChild(e);
    }
    this.entities = [];
    this.renderDirty = true;
  }

  /** 自动对焦到模型包围盒 */
  private focusOnModel(cx: number, cy: number, cz: number, radius: number) {
    if (!this.orbit) return;
    this.orbit.lookAt.set(cx, cy, cz);
    this.orbit.sceneCenter.set(cx, cy, cz);
    this.orbit.sceneRadius = radius;
    this.orbit.distance = radius * 2.0;
    this.orbit.elevation = 30;
    this.orbit.azimuth = 45;
    this.orbit.updateCamera();
  }

  /** 加载 LAS/LAZ 文件 */
  async loadLasFile(filePath: string): Promise<void> {
    const app = this.app;
    const gd = app.graphicsDevice;
    const fileName = filePath.split(/[\\/]/).pop() || "unknown.las";

    const headerBuf = await window.electronAPI!.readFileChunk(filePath, 0, 4096);
    const header = parseLasHeader(headerBuf);

    const count = header.pointCount;
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, minX, maxX, minY, maxY, minZ, maxZ } = header;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    const radius = extent / 2;
    const pointSize = Math.max(2, extent / Math.cbrt(count) * 0.8);

    // 着色器材质
    const mat = new pc.ShaderMaterial({
      uniqueName: `pc-${fileName}`,
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
    const vb = new pc.VertexBuffer(gd, format, count, { usage: pc.BUFFER_STATIC });

    if (isLasCompressed(header.pointFormatId)) {
      await this.loadLazToGpu(filePath, header, vb, count, cx, cy, cz);
    } else {
      await this.loadLasToGpu(filePath, header, vb, count, cx, cy, cz);
    }

    vb.unlock();

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count };

    const mi = new pc.MeshInstance(mesh, mat, null);
    mi.cull = false;

    const entity = new pc.Entity(fileName);
    entity.addComponent("render", { meshInstances: [mi] });
    app.root.addChild(entity);
    this.entities.push(entity);

    // Y-up 坐标系下模型中心：las Z→PlayCanvas Y, las Y→PlayCanvas -Z
    this.focusOnModel(cx, cz, -cy, radius * 1.5);

    this.renderDirty = true;
  }

  /** 加载 JSON 绘制数据（设备区、屏柜、充电区域、路径）并渲染为 3D 线条 */
  async loadJsonFile(filePath: string, cx: number, cy: number, cz: number): Promise<void> {
    const buf = await window.electronAPI!.readLargeFile!(filePath);
    const text = new TextDecoder("utf-8").decode(buf);
    const data = JSON.parse(text);
    const app = this.app;

    // 可行路径
    if (data.paths && data.points) {
      await this.renderPaths(data, cx, cy, cz);
    }

    // 设备区/屏柜/充电区域
    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        this.renderDrawingItem(item, cx, cy, cz);
      }
    }

    this.renderDirty = true;
  }

  /** 渲染路径线条 */
  private renderPaths(data: { paths: any[]; points: any[] }, cx: number, cy: number, cz: number) {
    if (!data.paths || data.paths.length === 0) return;

    const gd = this.app.graphicsDevice;
    const mat = new pc.BasicMaterial();
    mat.color = new pc.Color(0, 0.8, 1);

    for (const seg of data.paths) {
      const startIdx = seg.start;
      const endIdx = seg.end;
      if (startIdx >= data.points.length || endIdx >= data.points.length) continue;

      const p1 = data.points[startIdx];
      const p2 = data.points[endIdx];
      const [x1, y1, z1] = toLocal3D(p1.x, p1.y, p1.z, cx, cy, cz);
      const [x2, y2, z2] = toLocal3D(p2.x, p2.y, p2.z, cx, cy, cz);

      const verts = [x1, y1, z1, x2, y2, z2];
      const vb = new pc.VertexBuffer(gd, pc.VertexFormat.DEFAULT, 2);
      vb.setData(new Float32Array(verts));

      const mesh = new pc.Mesh(gd);
      mesh.vertexBuffer = vb;
      mesh.primitive[0] = { type: pc.PRIMITIVE_LINES, base: 0, count: 2 };

      const mi = new pc.MeshInstance(mesh, mat, null);
      const entity = new pc.Entity("path_seg");
      entity.addComponent("render", { meshInstances: [mi] });
      this.app.root.addChild(entity);
      this.entities.push(entity);
    }
  }

  /** 渲染单个绘制项（设备区/屏柜/充电区域） */
  private renderDrawingItem(item: any, cx: number, cy: number, cz: number) {
    const verts: number[] | undefined = item.geometry?.verts;
    if (!verts || verts.length === 0) return;

    // 8 顶点 → 12 条边
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    const gd = this.app.graphicsDevice;
    const meshVerts: number[] = [];
    for (const [a, b] of edges) {
      if (a >= verts.length || b >= verts.length) continue;
      const v1 = verts[a];
      const v2 = verts[b];
      const [x1, y1, z1] = toLocal3D(v1[0], v1[1], v1[2], cx, cy, cz);
      const [x2, y2, z2] = toLocal3D(v2[0], v2[1], v2[2], cx, cy, cz);
      meshVerts.push(x1, y1, z1, x2, y2, z2);
    }
    if (meshVerts.length === 0) return;

    // 不同颜色
    const colorMap: Record<string, pc.Color> = {
      "cabinet": new pc.Color(0, 1, 0),
      "device-area": new pc.Color(1, 0.6, 0),
      "charging-area": new pc.Color(0.8, 0.2, 1),
    };
    const mat = new pc.BasicMaterial();
    mat.color = colorMap[item.type] || new pc.Color(0.5, 0.5, 0.5);

    const vb = new pc.VertexBuffer(gd, pc.VertexFormat.DEFAULT, meshVerts.length / 3);
    vb.setData(new Float32Array(meshVerts));

    const mesh = new pc.Mesh(gd);
    mesh.vertexBuffer = vb;
    mesh.primitive[0] = { type: pc.PRIMITIVE_LINES, base: 0, count: meshVerts.length / 3 };

    const mi = new pc.MeshInstance(mesh, mat, null);
    const entity = new pc.Entity(`draw_${item.type}`);
    entity.addComponent("render", { meshInstances: [mi] });
    this.app.root.addChild(entity);
    this.entities.push(entity);
  }

  /** 非压缩 LAS → GPU 缓冲区 */
  private async loadLasToGpu(
    filePath: string,
    header: LasHeader,
    vb: pc.VertexBuffer,
    count: number,
    cx: number, cy: number, cz: number,
  ) {
    const dataOffset = header.pointDataOffset;
    const pointLen = header.pointRecordLength;
    const formatId = header.pointFormatId & 0x7F;
    const totalBytes = count * pointLen;
    const buf = await this.readLargeChunk(filePath, dataOffset, totalBytes);
    const dv = new DataView(buf);
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ } = header;

    const hasRgb = [2, 3, 5, 7, 8, 10].includes(formatId);
    const rgbOff = getRgbOffset(formatId);

    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    let rgbShift = 8;
    if (hasRgb) {
      let maxRgb = 0;
      const sN = Math.min(2000, count);
      for (let k = 0; k < sN; k++) {
        const o = k * pointLen + rgbOff;
        maxRgb = Math.max(maxRgb, dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true));
      }
      rgbShift = maxRgb > 255 ? 8 : 0;
    }

    const CHUNK = 200000;
    for (let i = 0; i < count; i += CHUNK) {
      const end = Math.min(i + CHUNK, count);
      for (let j = i; j < end; j++) {
        const poff = j * pointLen;
        const ix = dv.getInt32(poff, true);
        const iy = dv.getInt32(poff + 4, true);
        const iz = dv.getInt32(poff + 8, true);

        const base = j * 4;
        // LAS Z-up → PlayCanvas Y-up: X=X, Y=Z, Z=-Y，并减去中心
        f32[base] = ix * scaleX + offsetX - cx;
        f32[base + 1] = iz * scaleZ + offsetZ - cz;
        f32[base + 2] = -(iy * scaleY + offsetY - cy);

        const byteOff = base * 4 + 12;
        if (hasRgb) {
          const ro = poff + rgbOff;
          u8[byteOff] = (dv.getUint16(ro, true) >> rgbShift) & 0xff;
          u8[byteOff + 1] = (dv.getUint16(ro + 2, true) >> rgbShift) & 0xff;
          u8[byteOff + 2] = (dv.getUint16(ro + 4, true) >> rgbShift) & 0xff;
        } else {
          u8[byteOff] = 128;
          u8[byteOff + 1] = 128;
          u8[byteOff + 2] = 128;
        }
        u8[byteOff + 3] = 255;
      }
      if (end < count) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  /** LAZ 压缩 → GPU 缓冲区 */
  private async loadLazToGpu(
    filePath: string,
    header: LasHeader,
    vb: pc.VertexBuffer,
    count: number,
    cx: number, cy: number, cz: number,
  ) {
    const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ } = header;

    const arrayBuffer = await window.electronAPI!.readLargeFile!(filePath);

    const createLazPerf = await loadLazPerf();
    const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });

    // WASM 堆内存分配（处理大文件）
    let filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    if (!filePtr) {
      const need = arrayBuffer.byteLength;
      const cur = LazPerf.HEAPU8.byteLength;
      const pages = Math.ceil((need - cur) / 65536) + 256;
      try { LazPerf._emscripten_resize_heap(cur + pages * 65536); } catch (e) { /* ignore */ }
      filePtr = LazPerf._malloc(arrayBuffer.byteLength);
    }
    if (!filePtr) throw new Error("WASM 堆内存不足：" + (arrayBuffer.byteLength / 1024 / 1024).toFixed(0) + "MB");

    LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);

    const laszip = new LazPerf.LASZip();
    laszip.open(filePtr, arrayBuffer.byteLength);

    const pointLen = laszip.getPointLength();
    const actualFormat = laszip.getPointFormat();
    const pointPtr = LazPerf._malloc(pointLen);

    const hasRgb = [2, 3, 5, 7, 8, 10].includes(actualFormat);
    const rgbOff = getRgbOffset(actualFormat);

    const vbLock = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(vbLock);
    const u8 = new Uint8Array(vbLock);

    // RGB 位深采样
    let rgbShift = 8;
    if (hasRgb) {
      const sLaszip = new LazPerf.LASZip();
      sLaszip.open(filePtr, arrayBuffer.byteLength);
      const sPtr = LazPerf._malloc(pointLen);
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
    for (let i = 0; i < count; i += CHUNK) {
      const end = Math.min(i + CHUNK, count);
      for (let j = i; j < end; j++) {
        laszip.getPoint(pointPtr);
        const wasmOff = pointPtr;
        const ix = LazPerf.HEAP32[wasmOff / 4];
        const iy = LazPerf.HEAP32[wasmOff / 4 + 1];
        const iz = LazPerf.HEAP32[wasmOff / 4 + 2];

        const base = j * 4;
        // LAS Z-up → PlayCanvas Y-up: X=X, Y=Z, Z=-Y，并减去中心
        f32[base] = ix * scaleX + offsetX - cx;
        f32[base + 1] = iz * scaleZ + offsetZ - cz;
        f32[base + 2] = -(iy * scaleY + offsetY - cy);

        const byteOff = base * 4 + 12;
        if (hasRgb) {
          const o = wasmOff + rgbOff;
          u8[byteOff] = ((LazPerf.HEAPU8[o] | (LazPerf.HEAPU8[o + 1] << 8)) >> rgbShift) & 0xff;
          u8[byteOff + 1] = ((LazPerf.HEAPU8[o + 2] | (LazPerf.HEAPU8[o + 3] << 8)) >> rgbShift) & 0xff;
          u8[byteOff + 2] = ((LazPerf.HEAPU8[o + 4] | (LazPerf.HEAPU8[o + 5] << 8)) >> rgbShift) & 0xff;
        } else {
          u8[byteOff] = 128;
          u8[byteOff + 1] = 128;
          u8[byteOff + 2] = 128;
        }
        u8[byteOff + 3] = 255;
      }
      if (end < count) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    LazPerf._free(pointPtr);
    LazPerf._free(filePtr);
    laszip.delete();
  }

  private async readLargeChunk(filePath: string, offset: number, length: number): Promise<ArrayBuffer> {
    if (window.electronAPI?.readLargeFile) {
      const full = await window.electronAPI.readLargeFile(filePath);
      return full.slice(offset, offset + length);
    }
    return window.electronAPI!.readFileChunk(filePath, offset, length);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.ro?.disconnect();
    this.orbit = null;
    this.entities = [];
    this.app.destroy();
  }
}
