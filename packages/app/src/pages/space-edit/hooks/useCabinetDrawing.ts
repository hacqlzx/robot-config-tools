import { useState, useRef, useCallback, useEffect } from "react";
import * as pc from "playcanvas";

interface CabinetDrawingAPI {
  cabinetMode: boolean;
  handleToggleCabinet: () => void;
  setupCabinetDrawing: (
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => () => void;
}

/**
 * 屏幕空间拾取：把所有 LAS 点投影到屏幕
 * 5px 半径内优先取离相机最近的点（模拟深度测试）
 * 否则回退到屏幕距离最近的点
 */
function screenPick(
  gd: pc.GraphicsDevice,
  camera: pc.Entity,
  clickSx: number,
  clickSy: number,
  entities: Map<string, pc.Entity>,
): { point: pc.Vec3; entity: pc.Entity } | null {
  const camComp = camera.camera;
  if (!camComp) return null;

  const viewMat = camera.getWorldTransform().clone().invert();
  const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
  const screenW = gd.width;
  const screenH = gd.height;
  const PICK_RADIUS_SQ = 25; // 5px

  // 候选1：5px半径内离相机最近
  let bestDepth = Infinity;
  let nearResult: { point: pc.Vec3; entity: pc.Entity } | null = null;

  // 候选2：屏幕距离最近（回退）
  let bestDistSq = Infinity;
  let farResult: { point: pc.Vec3; entity: pc.Entity } | null = null;

  const worldVP = new pc.Mat4();
  const worldPt = new pc.Vec3();

  entities.forEach((ent) => {
    if (!ent.enabled) return;
    const mi = ent.render?.meshInstances?.[0];
    const vb = mi?.mesh?.vertexBuffer;
    if (!vb) return;

    worldVP.mul2(vpMat, ent.getWorldTransform());
    const m = worldVP.data;
    const data = vb.lock() as ArrayBuffer;
    const f32 = new Float32Array(data);
    const count = vb.getNumVertices();
    const stride = vb.getFormat().size / 4;

    for (let i = 0; i < count; i++) {
      const base = i * stride;
      const lx = f32[base], ly = f32[base + 1], lz = f32[base + 2];

      const clipW = m[3] * lx + m[7] * ly + m[11] * lz + m[15];
      if (clipW <= 0) continue;

      const clipX = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
      const clipY = m[1] * lx + m[5] * ly + m[9] * lz + m[13];

      const invW = 1 / clipW;
      const sx = (clipX * invW * 0.5 + 0.5) * screenW;
      const sy = (0.5 - clipY * invW * 0.5) * screenH;
      const d2 = (sx - clickSx) ** 2 + (sy - clickSy) ** 2;

      // 5px 半径内：深度仲裁
      if (d2 <= PICK_RADIUS_SQ && clipW < bestDepth) {
        bestDepth = clipW;
        ent.getWorldTransform().transformPoint(new pc.Vec3(lx, ly, lz), worldPt);
        nearResult = { point: worldPt.clone(), entity: ent };
      }

      // 全局最近（回退用）
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        ent.getWorldTransform().transformPoint(new pc.Vec3(lx, ly, lz), worldPt);
        farResult = { point: worldPt.clone(), entity: ent };
      }
    }
    vb.unlock();
  });

  const result = nearResult || farResult;
  if (result) {
    const tag = nearResult ? "(5px+深度)" : "(最近)";
    console.log("[屏柜] 命中" + tag + ":", result.point.x.toFixed(3), result.point.y.toFixed(3), result.point.z.toFixed(3));
  }
  return result;
}

export function useCabinetDrawing(): CabinetDrawingAPI {
  const [cabinetMode, setCabinetMode] = useState(false);
  const cabinetModeRef = useRef(false);
  const cabinetEntitiesRef = useRef<pc.Entity[]>([]);
  const cabinetPointsRef = useRef<pc.Vec3[]>([]);

  const setupCabinetDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const gd = app.graphicsDevice;
    const canvas = gd.canvas;

    let mouseDownPos: { x: number; y: number } | null = null;
    const CLICK_THRESHOLD = 3;

    const onMouseDown = (e: MouseEvent) => {
      if (!cabinetModeRef.current) return;
      mouseDownPos = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!cabinetModeRef.current) { mouseDownPos = null; return; }
      if ((window as any).__clipDragging) { mouseDownPos = null; return; }
      if (!mouseDownPos) return;
      const dx = e.clientX - mouseDownPos.x;
      const dy = e.clientY - mouseDownPos.y;
      mouseDownPos = null;
      if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) return;

      const rect = canvas.getBoundingClientRect();
      const sx = Math.round(e.clientX - rect.left);
      const sy = Math.round(e.clientY - rect.top);

      console.log("[屏柜] 点击:", sx, ",", sy);

      const hitResult = screenPick(gd, camera, sx, sy, entitiesRef.current);
      if (!hitResult) { console.log("[屏柜] 未命中"); return; }
      const hit = hitResult.point;

      // 球体点
      const sphere = new pc.Entity("cabinet-pt");
      sphere.addComponent("render", { type: "sphere" });
      const sm = sphere.render!.material as pc.StandardMaterial;
      sm.diffuse = new pc.Color(1, 0.4, 0.2);
      sm.emissive = new pc.Color(1, 0.4, 0.2);
      sm.update();
      sphere.setLocalScale(0.15, 0.15, 0.15);
      sphere.setLocalPosition(hit);
      app.root.addChild(sphere);
      cabinetEntitiesRef.current.push(sphere);

      // 连线
      const pts = cabinetPointsRef.current;
      if (pts.length > 0) {
        const prev = pts[pts.length - 1];
        const mid = new pc.Vec3().add2(prev, hit).mulScalar(0.5);
        const len = prev.clone().sub(hit).length();
        const fwd = new pc.Vec3().sub2(hit, prev).normalize();
        const line = new pc.Entity("cabinet-line");
        line.addComponent("render", { type: "box" });
        const lm = line.render!.material as pc.StandardMaterial;
        lm.diffuse = new pc.Color(1, 0.8, 0.1);
        lm.emissive = new pc.Color(1, 0.8, 0.1);
        lm.update();
        line.setLocalPosition(mid);
        line.setLocalScale(0.05, 0.05, len);
        line.lookAt(mid.clone().add(fwd));
        app.root.addChild(line);
        cabinetEntitiesRef.current.push(line);
      }

      pts.push(hit.clone());
      requestRender();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    cabinetModeRef.current = cabinetMode;
  }, [cabinetMode]);

  const handleToggleCabinet = useCallback(() => {
    setCabinetMode((prev) => {
      if (prev) {
        cabinetEntitiesRef.current.forEach((e) => e.destroy());
        cabinetEntitiesRef.current = [];
        cabinetPointsRef.current = [];
      }
      return !prev;
    });
  }, []);

  return { cabinetMode, handleToggleCabinet, setupCabinetDrawing };
}