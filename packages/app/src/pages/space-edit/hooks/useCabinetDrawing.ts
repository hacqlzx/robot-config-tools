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

// ============ 工具函数 ============

/** 屏幕空间拾取 LAS 点：5px内深度仲裁，否则回退最近 */
function screenPickLas(
  gd: pc.GraphicsDevice,
  camera: pc.Entity,
  clickSx: number, clickSy: number,
  entities: Map<string, pc.Entity>,
): { point: pc.Vec3; entity: pc.Entity } | null {
  const camComp = camera.camera;
  if (!camComp) return null;
  const viewMat = camera.getWorldTransform().clone().invert();
  const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
  const screenW = gd.width, screenH = gd.height;
  const RADIUS_SQ = 25;

  let bestDepth = Infinity;
  let nearResult: { point: pc.Vec3; entity: pc.Entity } | null = null;
  let bestDistSq = Infinity;
  let farResult: { point: pc.Vec3; entity: pc.Entity } | null = null;
  const worldVP = new pc.Mat4();
  const worldPt = new pc.Vec3();

  entities.forEach((ent) => {
    if (!ent.enabled) return;
    const vb = ent.render?.meshInstances?.[0]?.mesh?.vertexBuffer;
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
      if (d2 <= RADIUS_SQ && clipW < bestDepth) {
        bestDepth = clipW;
        ent.getWorldTransform().transformPoint(new pc.Vec3(lx, ly, lz), worldPt);
        nearResult = { point: worldPt.clone(), entity: ent };
      }
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        ent.getWorldTransform().transformPoint(new pc.Vec3(lx, ly, lz), worldPt);
        farResult = { point: worldPt.clone(), entity: ent };
      }
    }
    vb.unlock();
  });
  return nearResult || farResult;
}

/** 投影世界坐标到屏幕 */
function worldToScreen(wp: pc.Vec3, vpMat: pc.Mat4, screenW: number, screenH: number): { sx: number; sy: number } | null {
  const m = vpMat.data;
  const clipW = m[3] * wp.x + m[7] * wp.y + m[11] * wp.z + m[15];
  if (clipW <= 0) return null;
  const clipX = m[0] * wp.x + m[4] * wp.y + m[8] * wp.z + m[12];
  const clipY = m[1] * wp.x + m[5] * wp.y + m[9] * wp.z + m[13];
  const invW = 1 / clipW;
  return {
    sx: (clipX * invW * 0.5 + 0.5) * screenW,
    sy: (0.5 - clipY * invW * 0.5) * screenH,
  };
}

/** 设置球体颜色 */
function setSphereColor(sphere: pc.Entity, color: pc.Color) {
  const sm = sphere.render!.material as pc.StandardMaterial;
  sm.diffuse = color;
  sm.emissive = color;
  sm.update();
}

/** 更新连线实体 */
function updateLineEntity(line: pc.Entity, from: pc.Vec3, to: pc.Vec3) {
  const mid = new pc.Vec3().add2(from, to).mulScalar(0.5);
  const len = from.clone().sub(to).length();
  const fwd = new pc.Vec3().sub2(to, from).normalize();
  line.setLocalPosition(mid);
  line.setLocalScale(0.05, 0.05, len);
  line.lookAt(mid.clone().add(fwd));
}

/** 创建球体 */
function createSphere(app: pc.Application, pos: pc.Vec3, color: pc.Color): pc.Entity {
  const sphere = new pc.Entity("cabinet-pt");
  sphere.addComponent("render", { type: "sphere" });
  setSphereColor(sphere, color);
  sphere.setLocalScale(0.15, 0.15, 0.15);
  sphere.setLocalPosition(pos);
  app.root.addChild(sphere);
  return sphere;
}

/** 创建连线 */
function createLine(app: pc.Application, from: pc.Vec3, to: pc.Vec3): pc.Entity {
  const line = new pc.Entity("cabinet-line");
  line.addComponent("render", { type: "box" });
  const lm = line.render!.material as pc.StandardMaterial;
  lm.diffuse = new pc.Color(1, 0.8, 0.1);
  lm.emissive = new pc.Color(1, 0.8, 0.1);
  lm.update();
  updateLineEntity(line, from, to);
  app.root.addChild(line);
  return line;
}

// ============ Hook ============

export function useCabinetDrawing(): CabinetDrawingAPI {
  const [cabinetMode, setCabinetMode] = useState(false);
  const cabinetModeRef = useRef(false);

  const setupCabinetDrawing = useCallback((
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
  ) => {
    const gd = app.graphicsDevice;
    const canvas = gd.canvas;

    // 屏柜数据
    const pointsRef: pc.Vec3[] = [];
    const spheresRef: pc.Entity[] = [];
    const linesRef: pc.Entity[] = []; // lines[i] 连接 points[i] -> points[i+1]

    // 选中与拖拽状态
    const ORANGE = new pc.Color(1, 0.4, 0.2);
    const CYAN = new pc.Color(0.2, 0.8, 1);
    let selectedIdx = -1;
    let isDragging = false;
    let dragStartScreen: { x: number; y: number } | null = null;
    const CLICK_THRESHOLD = 3;

    /** 检查点击位置是否命中已有球体 */
    function hitTestSphere(sx: number, sy: number): number {
      const camComp = camera.camera;
      if (!camComp || pointsRef.length === 0) return -1;
      const viewMat = camera.getWorldTransform().clone().invert();
      const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
      let bestIdx = -1;
      let bestD2 = 100; // 10px 半径
      for (let i = 0; i < pointsRef.length; i++) {
        const ss = worldToScreen(pointsRef[i], vpMat, gd.width, gd.height);
        if (!ss) continue;
        const d2 = (ss.sx - sx) ** 2 + (ss.sy - sy) ** 2;
        if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
      }
      return bestIdx;
    }

    /** 反选当前选中 */
    function deselect() {
      if (selectedIdx >= 0 && selectedIdx < spheresRef.length) {
        setSphereColor(spheresRef[selectedIdx], ORANGE);
      }
      selectedIdx = -1;
      isDragging = false;
    }

    /** 选中某个点 */
    function select(idx: number) {
      deselect();
      if (idx >= 0 && idx < spheresRef.length) {
        setSphereColor(spheresRef[idx], CYAN);
        selectedIdx = idx;
      }
    }

    /** 拖拽移动：射线 + 当前点Y平面 */
    function getDragPosition(clientX: number, clientY: number): pc.Vec3 | null {
      if (selectedIdx < 0) return null;
      const camComp = camera.camera;
      if (!camComp) return null;
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const from = camera.getPosition();
      const to = new pc.Vec3();
      camComp.screenToWorld(sx, sy, 0.5, to);
      const dir = new pc.Vec3().sub2(to, from).normalize();
      const planeY = pointsRef[selectedIdx].y;
      if (Math.abs(dir.y) < 0.0001) return null;
      const t = (planeY - from.y) / dir.y;
      if (t <= 0) return null;
      return new pc.Vec3().add2(from, dir.mulScalar(t));
    }

    /** 移动选中的点（拖拽中，不snap） */
    function moveSelected(pos: pc.Vec3) {
      if (selectedIdx < 0) return;
      pointsRef[selectedIdx] = pos.clone();
      spheresRef[selectedIdx].setLocalPosition(pos);
      // 更新相邻连线
      if (selectedIdx > 0) updateLineEntity(linesRef[selectedIdx - 1], pointsRef[selectedIdx - 1], pos);
      if (selectedIdx < linesRef.length) updateLineEntity(linesRef[selectedIdx], pos, pointsRef[selectedIdx + 1]);
    }

    /** 放置新点 */
    function placePoint(pos: pc.Vec3) {
      const sphere = createSphere(app, pos, ORANGE);
      spheresRef.push(sphere);
      if (pointsRef.length > 0) {
        const prev = pointsRef[pointsRef.length - 1];
        linesRef.push(createLine(app, prev, pos));
      }
      pointsRef.push(pos.clone());
    }

    // ---- 事件 ----

    const onMouseDown = (e: MouseEvent) => {
      if (!cabinetModeRef.current) return;
      if ((window as any).__clipDragging) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      // 先检测是否命中已有球体
      const hitIdx = hitTestSphere(sx, sy);
      if (hitIdx >= 0) {
        select(hitIdx);
        isDragging = true;
        (window as any).__cabinetDragging = true;
        dragStartScreen = { x: e.clientX, y: e.clientY };
        return;
      }

      dragStartScreen = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || selectedIdx < 0) return;
      const pos = getDragPosition(e.clientX, e.clientY);
      if (pos) {
        moveSelected(pos);
        requestRender();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!cabinetModeRef.current) { isDragging = false; dragStartScreen = null; return; }

      if (isDragging && selectedIdx >= 0) {
        // 拖拽结束，snap 到最近 LAS 点
        isDragging = false;
        (window as any).__cabinetDragging = false;
        const rect = canvas.getBoundingClientRect();
        const sx = Math.round(e.clientX - rect.left);
        const sy = Math.round(e.clientY - rect.top);
        const snap = screenPickLas(gd, camera, sx, sy, entitiesRef.current);
        if (snap) {
          moveSelected(snap.point);
        }
        console.log("[屏柜] 拖拽完成 idx:", selectedIdx, "pos:", pointsRef[selectedIdx].x.toFixed(3), pointsRef[selectedIdx].y.toFixed(3), pointsRef[selectedIdx].z.toFixed(3));
        // 保持选中状态，允许再次拖拽
        dragStartScreen = null;
        requestRender();
        return;
      }

      // 点击（非拖拽）
      if (dragStartScreen) {
        const dx = e.clientX - dragStartScreen.x;
        const dy = e.clientY - dragStartScreen.y;
        if (Math.sqrt(dx * dx + dy * dy) <= CLICK_THRESHOLD) {
          const rect = canvas.getBoundingClientRect();
          const sx = Math.round(e.clientX - rect.left);
          const sy = Math.round(e.clientY - rect.top);
          console.log("[屏柜] 点击:", sx, ",", sy);
          const hitResult = screenPickLas(gd, camera, sx, sy, entitiesRef.current);
          if (hitResult) {
            placePoint(hitResult.point);
            console.log("[屏柜] 放置:", hitResult.point.x.toFixed(3), hitResult.point.y.toFixed(3), hitResult.point.z.toFixed(3));
          } else {
            console.log("[屏柜] 未命中 LAS");
          }
          // 点击空白取消选中
          if (selectedIdx >= 0) { deselect(); }
          requestRender();
        }
      }

      dragStartScreen = null;
    };



    // 鼠标离开窗口或失焦时取消拖拽
    const cancelDrag = () => {
      isDragging = false;
      (window as any).__cabinetDragging = false;
      dragStartScreen = null;
    };
    canvas.addEventListener("mouseleave", cancelDrag);
    document.addEventListener("mouseleave", cancelDrag);
    window.addEventListener("blur", cancelDrag);

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      canvas.removeEventListener("mouseleave", cancelDrag);
      document.removeEventListener("mouseleave", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // 清理所有屏柜实体
      spheresRef.forEach((e) => e.destroy());
      linesRef.forEach((e) => e.destroy());
      spheresRef.length = 0;
      linesRef.length = 0;
      pointsRef.length = 0;
    };
  }, []);

  useEffect(() => {
    cabinetModeRef.current = cabinetMode;
  }, [cabinetMode]);

  const handleToggleCabinet = useCallback(() => {
    setCabinetMode((prev) => {
      if (prev) {
        // 清理在 setupCabinetDrawing 的 cleanup 中处理
      }
      return !prev;
    });
  }, []);

  return { cabinetMode, handleToggleCabinet, setupCabinetDrawing };
}