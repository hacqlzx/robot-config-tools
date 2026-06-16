import { useState, useEffect, useRef, useCallback } from "react";
import { Button, App, Spin, Progress } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import * as pc from "playcanvas";
import { parseLasHeader, loadLazPerf, getWasmUrl } from "../../../playcanvas-core/io/read/las-reader";
import { pointcloudVert, pointcloudFrag } from "../../../playcanvas-core/shaders/pointcloud-shader";

interface LasHeaderInfo { pointFormatId: number; versionMinor: number; scaleX: number; scaleY: number; scaleZ: number; offsetX: number; offsetY: number; offsetZ: number; }

interface Props {
  app: pc.Application | null;
  entityName: string;
  lasHeader: LasHeaderInfo | null;
  origFilePath: string;
  onClose: () => void;
  onComplete?: (clipName: string) => void;
  onProgress?: (pct: number) => void;
}

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number; }

type FaceIndex = 0 | 1 | 2 | 3 | 4 | 5;
const FACE_NORMALS = [
  new pc.Vec3(-1, 0, 0), new pc.Vec3(1, 0, 0),
  new pc.Vec3(0, -1, 0), new pc.Vec3(0, 1, 0),
  new pc.Vec3(0, 0, -1), new pc.Vec3(0, 0, 1),
];

export default function ClipController({ app, entityName, lasHeader, origFilePath, onClose, onComplete, onProgress }: Props) {
  const { message } = App.useApp();
  const entity = app?.root?.findByName(entityName) || null;
  const [bounds, setBounds] = useState<Bounds>({ minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 });
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const boxRootRef = useRef<pc.Entity | null>(null);
  const originCenterRef = useRef<{ cx: number; cy: number; cz: number }>({ cx: 0, cy: 0, cz: 0 });
  const dragRef = useRef<{ face: FaceIndex; startBounds: Bounds; sx: number; sy: number } | null>(null);
  const hoverRef = useRef<FaceIndex | null>(null);
  const originalMeshRef = useRef<{ mi: pc.MeshInstance; vb: pc.VertexBuffer } | null>(null);
  const clipMatRef = useRef<pc.ShaderMaterial | null>(null);
  const getWorldPos = () => entity?.getPosition() || new pc.Vec3();

  // Init: save original mesh + create GPU clip material
  useEffect(() => {
    if (!entity || !app) return;
    const render = entity.render;
    const mi = render?.meshInstances?.[0];
    const mesh = mi?.mesh;
    if (!mesh) return;
    const vb = mesh.vertexBuffer;
    if (!vb) return;

    if (!originalMeshRef.current) {
      originalMeshRef.current = { mi, vb };
    }

    const data = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(data);
    const count = vb.getNumVertices();
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const base = i * 4;
      const x = f32[base], y = f32[base + 1], z = f32[base + 2];
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (y < mnY) mnY = y; if (y > mxY) mxY = y;
      if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
    }
    vb.unlock();
    if (!isFinite(mnX)) return;

    setBounds({ minX: mnX, maxX: mxX, minY: mnY, maxY: mxY, minZ: mnZ, maxZ: mxZ });
    originCenterRef.current = { cx: (mnX + mxX) / 2, cy: (mnY + mxY) / 2, cz: (mnZ + mxZ) / 2 };

    const extent = Math.max(mxX - mnX, mxY - mnY, mxZ - mnZ);
    const pSize = extent > 0 ? extent / Math.cbrt(count) * 0.8 : 1;

    const clipVert = `
      attribute vec3 vertex_position;
      attribute vec4 vertex_texCoord0;
      uniform mat4 matrix_model;
      uniform mat4 matrix_viewProjection;
      uniform float uPointSize;
      uniform vec3 uClipMin;
      uniform vec3 uClipMax;
      varying vec4 vColor;
      void main(void) {
        vec3 pos = vertex_position;
        bool inside = all(greaterThanEqual(pos, uClipMin)) && all(lessThanEqual(pos, uClipMax));
        if (!inside) { pos = vec3(0.0, -999999.0, 0.0); }
        gl_Position = matrix_viewProjection * matrix_model * vec4(pos, 1.0);
        gl_PointSize = inside ? uPointSize : 0.0;
        vColor = inside ? vertex_texCoord0 : vec4(0.0);
      }`;
    const clipFrag = `
      precision mediump float;
      varying vec4 vColor;
      void main(void) {
        vec2 c = gl_PointCoord - vec2(0.5);
        if (length(c) > 0.5) discard;
        gl_FragColor = vColor;
      }`;

    const mat = new pc.ShaderMaterial({ uniqueName: `clip-${Date.now()}`, vertexGLSL: clipVert, fragmentGLSL: clipFrag });
    mat.blendType = pc.BLEND_NORMAL; mat.depthWrite = true; mat.depthTest = true; mat.cull = pc.CULLFACE_NONE;
    mat.setParameter("uPointSize", pSize);
    mat.setParameter("uClipMin", [mnX, mnY, mnZ]);
    mat.setParameter("uClipMax", [mxX, mxY, mxZ]);
    mat.update();

    const newMi = new pc.MeshInstance(mesh, mat, null);
    newMi.cull = false;
    if (render) render.meshInstances = [newMi];
    clipMatRef.current = mat;
  }, [entity, app]);

  // bounds changed → update clip uniforms
  useEffect(() => {
    const mat = clipMatRef.current;
    if (!mat) return;
    mat.setParameter("uClipMin", [bounds.minX, bounds.minY, bounds.minZ]);
    mat.setParameter("uClipMax", [bounds.maxX, bounds.maxY, bounds.maxZ]);
    mat.update();
  }, [bounds]);

  // rebuild bounding box
  useEffect(() => {
    if (!app) return;
    rebuildBox();
    app.render();
    return () => { boxRootRef.current?.destroy(); boxRootRef.current = null; };
  }, [bounds, app]);

  // mouse events (capture phase for priority)
  useEffect(() => {
    if (!app) return;
    const canvas = app.graphicsDevice.canvas;
    const md = (e: MouseEvent) => onMouseDown(e);
    const mm = (e: MouseEvent) => onMouseMove(e);
    const mu = () => onMouseUp();
    canvas.addEventListener("mousedown", md, true);
    window.addEventListener("mousemove", mm, true);
    window.addEventListener("mouseup", mu, true);
    return () => {
      canvas.removeEventListener("mousedown", md, true);
      window.removeEventListener("mousemove", mm, true);
      window.removeEventListener("mouseup", mu, true);
      boxRootRef.current?.destroy(); boxRootRef.current = null;
      (window as any).__clipDragging = false;
    };
  }, [app, bounds]);

  const rebuildBox = () => {
    if (!app) return;
    if (boxRootRef.current) { boxRootRef.current.destroy(); boxRootRef.current = null; }
    const root = new pc.Entity("clip-box-root");
    boxRootRef.current = root;
    const wp = getWorldPos();
    const oc = originCenterRef.current;
    root.setPosition(wp.x + oc.cx, wp.y + oc.cy, wp.z + oc.cz);
    app.root.addChild(root);

    const b = bounds;
    const sx = b.maxX - b.minX, sy = b.maxY - b.minY, sz = b.maxZ - b.minZ;
    const ncx = (b.minX + b.maxX) / 2, ncy = (b.minY + b.maxY) / 2, ncz = (b.minZ + b.maxZ) / 2;

    // Green wireframe: 12 edges
    const cx2 = (b.minX + b.maxX) / 2, cy2 = (b.minY + b.maxY) / 2, cz2 = (b.minZ + b.maxZ) / 2;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const corners = [
      new pc.Vec3(cx2 - oc.cx - hx, cy2 - oc.cy - hy, cz2 - oc.cz - hz),
      new pc.Vec3(cx2 - oc.cx + hx, cy2 - oc.cy - hy, cz2 - oc.cz - hz),
      new pc.Vec3(cx2 - oc.cx + hx, cy2 - oc.cy + hy, cz2 - oc.cz - hz),
      new pc.Vec3(cx2 - oc.cx - hx, cy2 - oc.cy + hy, cz2 - oc.cz - hz),
      new pc.Vec3(cx2 - oc.cx - hx, cy2 - oc.cy - hy, cz2 - oc.cz + hz),
      new pc.Vec3(cx2 - oc.cx + hx, cy2 - oc.cy - hy, cz2 - oc.cz + hz),
      new pc.Vec3(cx2 - oc.cx + hx, cy2 - oc.cy + hy, cz2 - oc.cz + hz),
      new pc.Vec3(cx2 - oc.cx - hx, cy2 - oc.cy + hy, cz2 - oc.cz + hz),
    ];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const edgeColor = new pc.Color(0.2, 1, 0.2);
    edges.forEach(([a, b]) => {
      const ca = corners[a], cb = corners[b];
      const mid = new pc.Vec3().add2(ca, cb).mulScalar(0.5);
      const len = ca.clone().sub(cb).length();
      const dir = ca.clone().sub(cb).normalize();
      const e = new pc.Entity("edge");
      e.addComponent("render", { type: "box" });
      const m = e.render!.material as pc.StandardMaterial;
      m.diffuse = edgeColor; m.emissive = edgeColor; m.useLighting = false; m.update();
      e.setLocalPosition(mid);
      e.setLocalScale(0.015, len, 0.015);
      if (Math.abs(dir.x) > 0.9) { e.setEulerAngles(0, 0, dir.x > 0 ? -90 : 90); }
      else if (Math.abs(dir.z) > 0.9) { e.setEulerAngles(dir.z > 0 ? 90 : -90, 0, 0); }
      root.addChild(e);
    });

    // 6 arrow handles (red X, green Y, blue Z)
    const hLen = Math.max(sx, sy, sz) * 0.15;
    const arrowColors = { x: new pc.Color(1, 0.2, 0.2), y: new pc.Color(0.2, 1, 0.2), z: new pc.Color(0.2, 0.5, 1) };
    const faces: { pos: pc.Vec3; dir: pc.Vec3; color: pc.Color }[] = [
      { pos: new pc.Vec3(b.minX - oc.cx, ncy - oc.cy, ncz - oc.cz), dir: FACE_NORMALS[0], color: arrowColors.x },
      { pos: new pc.Vec3(b.maxX - oc.cx, ncy - oc.cy, ncz - oc.cz), dir: FACE_NORMALS[1], color: arrowColors.x },
      { pos: new pc.Vec3(ncx - oc.cx, b.minY - oc.cy, ncz - oc.cz), dir: FACE_NORMALS[2], color: arrowColors.y },
      { pos: new pc.Vec3(ncx - oc.cx, b.maxY - oc.cy, ncz - oc.cz), dir: FACE_NORMALS[3], color: arrowColors.y },
      { pos: new pc.Vec3(ncx - oc.cx, ncy - oc.cy, b.minZ - oc.cz), dir: FACE_NORMALS[4], color: arrowColors.z },
      { pos: new pc.Vec3(ncx - oc.cx, ncy - oc.cy, b.maxZ - oc.cz), dir: FACE_NORMALS[5], color: arrowColors.z },
    ];
    faces.forEach((fc) => {
      const h = new pc.Entity("arrow");
      const mk = () => { const m = new pc.StandardMaterial(); m.diffuse = fc.color; m.emissive = fc.color; m.useLighting = false; m.update(); return m; };
      const shaft = new pc.Entity("shaft");
      shaft.addComponent("render", { type: "cylinder", material: mk() });
      shaft.setLocalScale(0.18, hLen, 0.18); shaft.setLocalPosition(0, hLen / 2, 0); h.addChild(shaft);
      const cone = new pc.Entity("cone");
      cone.addComponent("render", { type: "cone", material: mk() });
      cone.setLocalScale(0.35, 0.6, 0.35); cone.setLocalPosition(0, hLen, 0); h.addChild(cone);
      const d = fc.dir;
      if (d.x === 1) h.setEulerAngles(0, 0, -90);
      else if (d.x === -1) h.setEulerAngles(0, 0, 90);
      else if (d.y === -1) h.setEulerAngles(0, 0, 180);
      else if (d.z === 1) h.setEulerAngles(90, 0, 0);
      else if (d.z === -1) h.setEulerAngles(-90, 0, 0);
      h.setLocalPosition(fc.pos); root.addChild(h);
    });
  };

  const getScreenRay = (sx: number, sy: number): pc.Ray | null => {
    if (!app) return null;
    const cams = app.root.findComponents("camera");
    const camComp = cams[0] as pc.CameraComponent;
    if (!camComp) return null;
    const rect = app.graphicsDevice.canvas.getBoundingClientRect();
    const camPos = camComp.entity.getPosition();
    const wp = new pc.Vec3();
    camComp.screenToWorld(sx - rect.left, sy - rect.top, 0.5, wp);
    const ray = new pc.Ray();
    ray.origin.copy(wp); ray.direction.copy(wp).sub(camPos).normalize();
    return ray;
  };

  const raycastHandle = (sx: number, sy: number): FaceIndex | null => {
    const ray = getScreenRay(sx, sy);
    if (!ray) return null;
    const b = bounds, wp = getWorldPos();
    const cx = wp.x + (b.minX + b.maxX) / 2, cy = wp.y + (b.minY + b.maxY) / 2, cz = wp.z + (b.minZ + b.maxZ) / 2;
    const hLen = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * 0.15;
    const r = hLen * 0.5;
    const tips = [
      { face: 0 as FaceIndex, pos: new pc.Vec3(wp.x + b.minX, cy, cz).add(FACE_NORMALS[0].clone().mulScalar(hLen * 0.8)) },
      { face: 1 as FaceIndex, pos: new pc.Vec3(wp.x + b.maxX, cy, cz).add(FACE_NORMALS[1].clone().mulScalar(hLen * 0.8)) },
      { face: 2 as FaceIndex, pos: new pc.Vec3(cx, wp.y + b.minY, cz).add(FACE_NORMALS[2].clone().mulScalar(hLen * 0.8)) },
      { face: 3 as FaceIndex, pos: new pc.Vec3(cx, wp.y + b.maxY, cz).add(FACE_NORMALS[3].clone().mulScalar(hLen * 0.8)) },
      { face: 4 as FaceIndex, pos: new pc.Vec3(cx, cy, wp.z + b.minZ).add(FACE_NORMALS[4].clone().mulScalar(hLen * 0.8)) },
      { face: 5 as FaceIndex, pos: new pc.Vec3(cx, cy, wp.z + b.maxZ).add(FACE_NORMALS[5].clone().mulScalar(hLen * 0.8)) },
    ];
    for (const t of tips) {
      const tr = t.pos.clone().sub(ray.origin);
      const proj = tr.dot(ray.direction);
      if (proj <= 0) continue;
      const closest = ray.origin.clone().add(ray.direction.clone().mulScalar(proj));
      if (closest.clone().sub(t.pos).length() < r) return t.face;
    }
    return null;
  };

  const onMouseDown = (e: MouseEvent) => {
    const face = raycastHandle(e.clientX, e.clientY);
    if (face !== null) {
      e.stopImmediatePropagation(); e.preventDefault();
      dragRef.current = { face, startBounds: { ...bounds }, sx: e.clientX, sy: e.clientY };
      (window as any).__clipDragging = true;
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragRef.current) {
      const hf = raycastHandle(e.clientX, e.clientY);
      if (hf !== hoverRef.current) { hoverRef.current = hf; document.body.style.cursor = hf !== null ? "grab" : ""; }
      return;
    }
    if (!app) return;
    const dr = dragRef.current;
    const cams = app.root.findComponents("camera");
    const camComp = cams[0] as pc.CameraComponent;
    if (!camComp) return;
    const cam = camComp.entity;
    const camR = cam.right.clone(), camU = cam.up.clone();
    const normal = FACE_NORMALS[dr.face];
    const ndr = normal.dot(camR), ndu = normal.dot(camU);
    const sign = dr.face % 2 === 1 ? 1 : -1;
    const delta = sign * ((e.clientX - dr.sx) * ndr + (dr.sy - e.clientY) * ndu) * 0.01;
    const sb = dr.startBounds;
    const nb = { ...sb };
    switch (dr.face) {
      case 0: nb.minX = Math.min(sb.minX + delta, sb.maxX - 0.01); break;
      case 1: nb.maxX = Math.max(sb.maxX + delta, sb.minX + 0.01); break;
      case 2: nb.minY = Math.min(sb.minY + delta, sb.maxY - 0.01); break;
      case 3: nb.maxY = Math.max(sb.maxY + delta, sb.minY + 0.01); break;
      case 4: nb.minZ = Math.min(sb.minZ + delta, sb.maxZ - 0.01); break;
      case 5: nb.maxZ = Math.max(sb.maxZ + delta, sb.minZ + 0.01); break;
    }
    setBounds(nb);
    document.body.style.cursor = "grabbing";
  };

  const onMouseUp = () => { dragRef.current = null; (window as any).__clipDragging = false; document.body.style.cursor = ""; };

  const handleConfirm = useCallback(async () => {
    if (!entity || !app || !origFilePath) {
      message.error("缺少文件路径，无法裁切");
      return;
    }
    const clipBounds = bounds;
    const wp = entity.getLocalPosition();
    const gd = app.graphicsDevice;

    setSaving(true);
    setProgress(0);

    try {
      // ── 1. 解析原始 LAS 文件头 ──
      const headerBuf = await window.electronAPI!.readFileChunk(origFilePath, 0, 4096);
      const hdr = parseLasHeader(headerBuf);
      const isComp = (hdr.pointFormatId & 0x80) !== 0;
      const fmtId = hdr.pointFormatId & 0x7F;
      const totalCount = hdr.pointCount;
      const { scaleX, scaleY, scaleZ, offsetX, offsetY, offsetZ, pointRecordLength, pointDataOffset } = hdr;
      const hasRgb = [2, 3, 5, 7, 8, 10].includes(fmtId);
      const rgbOff = hasRgb ? (fmtId >= 6 ? 30 : (fmtId === 3 || fmtId === 5 ? 28 : 20)) : 0;

      console.log("[裁切] ========== 开始 ==========");
      console.log("[裁切] 文件:", origFilePath);
      console.log("[裁切] 压缩:", isComp ? "LAZ" : "LAS");
      console.log("[裁切] 原始总点数:", totalCount.toLocaleString());
      console.log("[裁切] 裁切框 X:", clipBounds.minX.toFixed(1), "~", clipBounds.maxX.toFixed(1));
      console.log("[裁切] 裁切框 Y:", clipBounds.minY.toFixed(1), "~", clipBounds.maxY.toFixed(1));
      console.log("[裁切] 裁切框 Z:", clipBounds.minZ.toFixed(1), "~", clipBounds.maxZ.toFixed(1));

      const lasToLocal = (ix: number, iy: number, iz: number): [number, number, number] => [
        ix * scaleX + offsetX - wp.x,
        iz * scaleZ + offsetZ - wp.y,
        iy * scaleY + offsetY - wp.z,
      ];
      const isInside = (wx: number, wy: number, wz: number) =>
        wx >= clipBounds.minX && wx <= clipBounds.maxX &&
        wy >= clipBounds.minY && wy <= clipBounds.maxY &&
        wz >= clipBounds.minZ && wz <= clipBounds.maxZ;

      // ── 2. 第一遍：计数 ──
      let clippedCount = 0;
      const CHUNK = 200000;

      if (isComp) {
        const createLazPerf = await loadLazPerf();
        const LazPerf = await createLazPerf({ locateFile: () => getWasmUrl() });
        const arrayBuffer = await window.electronAPI!.readLargeFile(origFilePath);
        const filePtr = LazPerf._malloc(arrayBuffer.byteLength);
        LazPerf.HEAPU8.set(new Uint8Array(arrayBuffer), filePtr);
        const laszip = new LazPerf.LASZip();
        laszip.open(filePtr, arrayBuffer.byteLength);
        const pointPtr = LazPerf._malloc(laszip.getPointLength());

        for (let i = 0; i < totalCount; i++) {
          laszip.getPoint(pointPtr);
          const ix = LazPerf.HEAP32[pointPtr / 4];
          const iy = LazPerf.HEAP32[pointPtr / 4 + 1];
          const iz = LazPerf.HEAP32[pointPtr / 4 + 2];
          const [wx, wy, wz] = lasToLocal(ix, iy, iz);
          if (isInside(wx, wy, wz)) clippedCount++;
          if (i % CHUNK === 0) {
            setProgress(Math.round(i / totalCount * 30));
            onProgress?.(Math.round(i / totalCount * 30));
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        LazPerf._free(pointPtr);
        LazPerf._free(filePtr);
        laszip.delete();
      } else {
        const totalBytes = totalCount * pointRecordLength;
        const fileChunkBytes = CHUNK * pointRecordLength;

        for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
          const globalIdx = Math.floor((fileOff - pointDataOffset) / pointRecordLength);
          const remaining = totalCount - globalIdx;
          const ptsInChunk = Math.min(CHUNK, remaining);
          const readSize = ptsInChunk * pointRecordLength;
          const chunkBuf = await window.electronAPI!.readFileChunk(origFilePath, fileOff, readSize);
          const view = new DataView(chunkBuf);

          for (let i = 0; i < ptsInChunk; i++) {
            const ptOff = i * pointRecordLength;
            const [wx, wy, wz] = lasToLocal(
              view.getInt32(ptOff, true),
              view.getInt32(ptOff + 4, true),
              view.getInt32(ptOff + 8, true),
            );
            if (isInside(wx, wy, wz)) clippedCount++;
          }
          setProgress(Math.round((globalIdx + ptsInChunk) / totalCount * 30));
          onProgress?.(Math.round((globalIdx + ptsInChunk) / totalCount * 30));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      console.log("[裁切] 裁切后点数:", clippedCount.toLocaleString());
      console.log("[裁切] 保留比例:", (clippedCount / totalCount * 100).toFixed(2) + "%");

      if (clippedCount === 0) {
        setSaving(false);
        message.warning("裁切范围内没有点");
        return;
      }

      // ── 3. 构建输出 ──
      const outPointLen = 26;
      const headerLen = 227;
      const totalOutSize = headerLen + clippedCount * outPointLen;
      const out = new Uint8Array(totalOutSize);

      const hv = new DataView(out.buffer, 0, headerLen);
      const enc = new TextEncoder();
      const wStr = (off: number, str: string, len: number) => {
        const b = enc.encode(str);
        for (let i = 0; i < len; i++) hv.setUint8(off + i, i < b.length ? b[i] : 0);
      };
      wStr(0, "LASF", 4);
      hv.setUint16(6, 0, true);
      hv.setUint8(24, 1); hv.setUint8(25, 2);
      wStr(26, "", 32); wStr(58, "robotConfig", 32);
      hv.setUint16(90, 0, true); hv.setUint16(92, 2025, true);
      hv.setUint16(94, headerLen, true); hv.setUint32(96, headerLen, true);
      hv.setUint32(100, 0, true);
      hv.setUint8(104, 2); hv.setUint16(105, outPointLen, true);
      hv.setUint32(107, clippedCount, true);
      hv.setFloat64(131, scaleX, true); hv.setFloat64(139, scaleY, true); hv.setFloat64(147, scaleZ, true);
      hv.setFloat64(155, offsetX, true); hv.setFloat64(163, offsetY, true); hv.setFloat64(171, offsetZ, true);

      // ── 4. 第二遍：写入 ──
      const vf = new pc.VertexFormat(gd, [
        { semantic: pc.SEMANTIC_POSITION, components: 3, type: pc.TYPE_FLOAT32 },
        { semantic: pc.SEMANTIC_TEXCOORD0, components: 4, type: pc.TYPE_UINT8, normalize: true },
      ]);
      const newVb = new pc.VertexBuffer(gd, vf, clippedCount, { usage: pc.BUFFER_STATIC });
      const nd = newVb.lock() as ArrayBuffer;
      const nf = new Float32Array(nd);
      const nu = new Uint8Array(nd);
      let outIdx = headerLen;
      let gpuIdx = 0;
      let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
      const i32 = new Int32Array(new ArrayBuffer(4));
      const u8v = new Uint8Array(i32.buffer);

      if (isComp) {
        const createLazPerf2 = await loadLazPerf();
        const LazPerf2 = await createLazPerf2({ locateFile: () => getWasmUrl() });
        const ab2 = await window.electronAPI!.readLargeFile(origFilePath);
        const fp2 = LazPerf2._malloc(ab2.byteLength);
        LazPerf2.HEAPU8.set(new Uint8Array(ab2), fp2);
        const laszip2 = new LazPerf2.LASZip();
        laszip2.open(fp2, ab2.byteLength);
        const pp2 = LazPerf2._malloc(laszip2.getPointLength());

        for (let i = 0; i < totalCount; i++) {
          laszip2.getPoint(pp2);
          const ix = LazPerf2.HEAP32[pp2 / 4];
          const iy = LazPerf2.HEAP32[pp2 / 4 + 1];
          const iz = LazPerf2.HEAP32[pp2 / 4 + 2];
          const [wx, wy, wz] = lasToLocal(ix, iy, iz);
          if (!isInside(wx, wy, wz)) continue;

          nf[gpuIdx * 4] = wx;
          nf[gpuIdx * 4 + 1] = wy;
          nf[gpuIdx * 4 + 2] = wz;

          if (hasRgb) {
            nu[gpuIdx * 16 + 12] = LazPerf2.HEAPU8[pp2 + rgbOff + 1];
            nu[gpuIdx * 16 + 13] = LazPerf2.HEAPU8[pp2 + rgbOff + 3];
            nu[gpuIdx * 16 + 14] = LazPerf2.HEAPU8[pp2 + rgbOff + 5];
          } else {
            nu[gpuIdx * 16 + 12] = 128; nu[gpuIdx * 16 + 13] = 128; nu[gpuIdx * 16 + 14] = 128;
          }
          nu[gpuIdx * 16 + 15] = 255;

          i32[0] = Math.round((wx + wp.x - offsetX) / scaleX); out.set(u8v, outIdx); outIdx += 4;
          i32[0] = Math.round((wz + wp.z - offsetY) / scaleY); out.set(u8v, outIdx); outIdx += 4;
          i32[0] = Math.round((wy + wp.y - offsetZ) / scaleZ); out.set(u8v, outIdx); outIdx += 4;
          out[outIdx++] = 128; out[outIdx++] = 0;
          out[outIdx++] = (1 & 0x07) | ((1 & 0x07) << 3);
          out[outIdx++] = 0; out[outIdx++] = 0; out[outIdx++] = 0;
          out[outIdx++] = 0; out[outIdx++] = 0;
          if (hasRgb) {
            out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 1]; out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 1];
            out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 3]; out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 3];
            out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 5]; out[outIdx++] = LazPerf2.HEAPU8[pp2 + rgbOff + 5];
          } else {
            for (let k = 0; k < 6; k++) out[outIdx++] = 128;
          }

          if (wx + wp.x < mnX) mnX = wx + wp.x; if (wx + wp.x > mxX) mxX = wx + wp.x;
          if (wy + wp.y < mnY) mnY = wy + wp.y; if (wy + wp.y > mxY) mxY = wy + wp.y;
          if (wz + wp.z < mnZ) mnZ = wz + wp.z; if (wz + wp.z > mxZ) mxZ = wz + wp.z;

          gpuIdx++;
          if (i % CHUNK === 0) {
            const pct = 30 + Math.round(i / totalCount * 60);
            setProgress(pct); onProgress?.(pct);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        LazPerf2._free(pp2); LazPerf2._free(fp2); laszip2.delete();
      } else {
        const totalBytes = totalCount * pointRecordLength;
        const fileChunkBytes = CHUNK * pointRecordLength;

        for (let fileOff = pointDataOffset; fileOff < pointDataOffset + totalBytes; fileOff += fileChunkBytes) {
          const globalIdx = Math.floor((fileOff - pointDataOffset) / pointRecordLength);
          const remaining = totalCount - globalIdx;
          const ptsInChunk = Math.min(CHUNK, remaining);
          const readSize = ptsInChunk * pointRecordLength;
          const chunkBuf = await window.electronAPI!.readFileChunk(origFilePath, fileOff, readSize);
          const view = new DataView(chunkBuf);

          for (let i = 0; i < ptsInChunk; i++) {
            const ptOff = i * pointRecordLength;
            const ix = view.getInt32(ptOff, true);
            const iy = view.getInt32(ptOff + 4, true);
            const iz = view.getInt32(ptOff + 8, true);
            const [wx, wy, wz] = lasToLocal(ix, iy, iz);
            if (!isInside(wx, wy, wz)) continue;

            nf[gpuIdx * 4] = wx;
            nf[gpuIdx * 4 + 1] = wy;
            nf[gpuIdx * 4 + 2] = wz;

            if (hasRgb) {
              nu[gpuIdx * 16 + 12] = view.getUint8(ptOff + rgbOff + 1);
              nu[gpuIdx * 16 + 13] = view.getUint8(ptOff + rgbOff + 3);
              nu[gpuIdx * 16 + 14] = view.getUint8(ptOff + rgbOff + 5);
            } else {
              nu[gpuIdx * 16 + 12] = 128; nu[gpuIdx * 16 + 13] = 128; nu[gpuIdx * 16 + 14] = 128;
            }
            nu[gpuIdx * 16 + 15] = 255;

            i32[0] = Math.round((wx + wp.x - offsetX) / scaleX); out.set(u8v, outIdx); outIdx += 4;
            i32[0] = Math.round((wz + wp.z - offsetY) / scaleY); out.set(u8v, outIdx); outIdx += 4;
            i32[0] = Math.round((wy + wp.y - offsetZ) / scaleZ); out.set(u8v, outIdx); outIdx += 4;
            out[outIdx++] = 128; out[outIdx++] = 0;
            out[outIdx++] = (1 & 0x07) | ((1 & 0x07) << 3);
            out[outIdx++] = 0; out[outIdx++] = 0; out[outIdx++] = 0;
            out[outIdx++] = 0; out[outIdx++] = 0;
            if (hasRgb) {
              out[outIdx++] = view.getUint8(ptOff + rgbOff + 1); out[outIdx++] = view.getUint8(ptOff + rgbOff + 1);
              out[outIdx++] = view.getUint8(ptOff + rgbOff + 3); out[outIdx++] = view.getUint8(ptOff + rgbOff + 3);
              out[outIdx++] = view.getUint8(ptOff + rgbOff + 5); out[outIdx++] = view.getUint8(ptOff + rgbOff + 5);
            } else {
              for (let k = 0; k < 6; k++) out[outIdx++] = 128;
            }

            if (wx + wp.x < mnX) mnX = wx + wp.x; if (wx + wp.x > mxX) mxX = wx + wp.x;
            if (wy + wp.y < mnY) mnY = wy + wp.y; if (wy + wp.y > mxY) mxY = wy + wp.y;
            if (wz + wp.z < mnZ) mnZ = wz + wp.z; if (wz + wp.z > mxZ) mxZ = wz + wp.z;

            gpuIdx++;
          }
          const pct = 30 + Math.round((globalIdx + ptsInChunk) / totalCount * 60);
          setProgress(pct); onProgress?.(pct);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      console.log("[裁切] 实际输出点数:", gpuIdx.toLocaleString());
      console.log("[裁切] 与预期一致:", gpuIdx === clippedCount);

      hv.setFloat64(179, mxX, true); hv.setFloat64(187, mnX, true);
      hv.setFloat64(195, mxY, true); hv.setFloat64(203, mnY, true);
      hv.setFloat64(211, mxZ, true); hv.setFloat64(219, mnZ, true);

      newVb.unlock();

      // 更新 GPU 显示
      const newMesh = new pc.Mesh(gd); newMesh.vertexBuffer = newVb;
      newMesh.primitive[0] = { baseVertex: 0, type: pc.PRIMITIVE_POINTS, base: 0, count: clippedCount };
      const newMat = new pc.ShaderMaterial({ uniqueName: "clipped-" + Date.now(), vertexGLSL: pointcloudVert, fragmentGLSL: pointcloudFrag });
      newMat.blendType = pc.BLEND_NORMAL; newMat.depthWrite = true; newMat.depthTest = true; newMat.cull = pc.CULLFACE_NONE; newMat.update();
      const newMi = new pc.MeshInstance(newMesh, newMat, null); newMi.cull = false;
      if (entity.render) entity.render.meshInstances = [newMi];
      if (originalMeshRef.current) originalMeshRef.current = null;

      // 保存到磁盘
      const baseName = entityName.replace(/\.(las|laz)$/i, "");
      let clipName = "";
      setProgress(95); onProgress?.(95);
      if (window.electronAPI) {
        const selectedProject = localStorage.getItem("selectedProject");
        if (selectedProject) {
          const dirFiles = await window.electronAPI.project.listTree(selectedProject, "地图");
          const existing = dirFiles.filter((f: any) => f.isDir && new RegExp("^" + baseName + "_\\d+$").test(f.name));
          let idx = 1;
          while (existing.some((f: any) => f.name === baseName + "_" + idx)) idx++;
          clipName = baseName + "_" + idx;
          await window.electronAPI.project.writeFile(selectedProject, "地图/" + clipName + "/" + clipName + ".las", out.buffer.slice(0, outIdx));
          console.log("[裁切] 已保存:", "地图/" + clipName + "/" + clipName + ".las");
          console.log("[裁切] 输出大小:", (outIdx / 1024 / 1024).toFixed(1), "MB");
        }
      }

      console.log("[裁切] ========== 完成 ==========");
      onProgress?.(100);
      await new Promise((r) => setTimeout(r, 100));
      setSaving(false);
      onClose();
      onComplete?.(clipName);
      message.success("裁切完成，保留 " + clippedCount.toLocaleString() + " 个点（全量无降采样）");
    } catch (e: any) {
      console.error("[裁切] 失败:", e);
      message.error("裁切失败: " + e.message);
      setSaving(false);
    }
  }, [entity, app, bounds, onClose, onComplete, entityName]);


  const handleCancel = useCallback(() => {
    if (originalMeshRef.current && entity?.render) {
      entity.render.meshInstances = [originalMeshRef.current.mi];
    }
    originalMeshRef.current = null;
    onClose();
  }, [entity, onClose]);

  const b = bounds;
  return (
    <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, background: "#fff", borderRadius: 8, padding: "8px 16px", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", zIndex: 20, fontSize: 12 }}>
      <span style={{ color: "#666" }}>X: {b.minX.toFixed(1)}~{b.maxX.toFixed(1)} Y: {b.minY.toFixed(1)}~{b.maxY.toFixed(1)} Z: {b.minZ.toFixed(1)}~{b.maxZ.toFixed(1)}</span>
      {saving ? <Spin size="small" /> : (
        <>
          <Button size="small" icon={<CheckOutlined />} type="primary" onClick={handleConfirm}>确认</Button>
          <Button size="small" icon={<CloseOutlined />} onClick={handleCancel}>取消</Button>
        </>
      )}
    </div>
  );
}
