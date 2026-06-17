import { useState, useEffect, useRef, useCallback } from "react";
import { Button, App, Spin, Progress } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import * as pc from "playcanvas";
import { performClipSave } from "../hooks/useClipSave";

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
  const entity = (app?.root?.findByName(entityName) as pc.Entity) || null;
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
    await performClipSave({
      entity, app, origFilePath, bounds, entityName,
      originalMeshRef, onProgress, setProgress, setSaving,
      onClose, onComplete, message,
    });
  }, [entity, app, bounds, origFilePath, entityName, onClose, onComplete, onProgress]);


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
