import * as pc from "playcanvas";
export {
  viewProjectionMatrix,
  projectToScreen,
  worldToScreen,
  screenToRay,
  pointToSegmentDistSq,
  extractBoxObb,
  rayObbHit,
  hitTestBoxVolume,
  isNearProjectedBounds,
} from "../../../../components/three-d-engine/selection-utils";

// ============ 绘制工具函数（屏柜/设备区/路径通用） ============

/**
 * 屏幕空间拾取 LAS 点：优先返回点击位置 5px 半径内、深度最近的点；
 * 若半径内无点，则回退到整屏距离最近的点。
 *
 * 这是编辑态吸附的核心：绘制类拿到鼠标位置后不直接落在射线平面上，
 * 而是在已加载点云 vertexBuffer 中找屏幕投影最接近的点。
 * 注意：该函数会遍历当前可见点云顶点，超大点云下应避免在 mousemove 中高频调用。
 */
export function screenPickLas(
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
    // lock 只是读取当前 CPU/GPU buffer 的顶点数据；调用完成后必须 unlock。
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
      // 点击半径内优先选择深度最近的点，避免框到被遮挡的后方点云。
      if (d2 <= RADIUS_SQ && clipW < bestDepth) {
        bestDepth = clipW;
        ent.getWorldTransform().transformPoint(new pc.Vec3(lx, ly, lz), worldPt);
        nearResult = { point: worldPt.clone(), entity: ent };
      }
      // 半径内没有命中时，回退到全屏最近点，让稀疏点云也能放置。
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

export function claimSpaceEditClick(owner: string) {
  const w = window as any;
  w.__spaceEditClickClaim = owner;
  window.setTimeout(() => {
    if (w.__spaceEditClickClaim === owner) w.__spaceEditClickClaim = null;
  }, 0);
}

export function isSpaceEditClickClaimedByOther(owner: string): boolean {
  const claim = (window as any).__spaceEditClickClaim;
  return !!claim && claim !== owner;
}

export function hasSpaceEditClickClaim(): boolean {
  return !!(window as any).__spaceEditClickClaim;
}

/** 设置球体（顶点标记）颜色 */
export function setSphereColor(sphere: pc.Entity, color: pc.Color) {
  const sm = sphere.render!.material as pc.StandardMaterial;
  sm.diffuse = color;
  sm.emissive = color;
  sm.update();
}

/** 设置连线实体颜色 */
export function setLineColor(line: pc.Entity, color: pc.Color) {
  const sm = line.render!.material as pc.StandardMaterial;
  sm.diffuse = color;
  sm.emissive = color;
  sm.update();
}

/** 更新连线实体：用拉伸的 box 在两点之间呈现一条线段 */
export function updateLineEntity(line: pc.Entity, from: pc.Vec3, to: pc.Vec3, thickness = 0.05) {
  const mid = new pc.Vec3().add2(from, to).mulScalar(0.5);
  const len = from.clone().sub(to).length();
  const fwd = new pc.Vec3().sub2(to, from).normalize();
  const target = mid.clone().add(fwd);
  line.setLocalPosition(mid);
  line.setLocalScale(thickness, thickness, len);
  // 线方向接近竖直时 forward 与默认 up=(0,1,0) 共线，lookAt 退化选择不稳定
  // 此时换用 (1,0,0) 做 up，其余情况保持默认 (0,1,0)
  if (Math.abs(fwd.y) > 0.999) {
    line.lookAt(target.x, target.y, target.z, 1, 0, 0);
  } else {
    line.lookAt(target.x, target.y, target.z, 0, 1, 0);
  }
}

/** 创建一个不受光照影响的纯色材质（每个实体独立，避免共享默认材质被相互覆盖） */
function createSolidMaterial(color: pc.Color): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = color;
  m.emissive = color;
  m.useLighting = false;
  m.update();
  return m;
}

/** 创建球体（顶点标记） */
export function createSphere(app: pc.Application, pos: pc.Vec3, color: pc.Color, scale = 0.15): pc.Entity {
  const sphere = new pc.Entity("draw-pt");
  sphere.addComponent("render", { type: "sphere", material: createSolidMaterial(color) });
  sphere.setLocalScale(scale, scale, scale);
  sphere.setLocalPosition(pos);
  app.root.addChild(sphere);
  return sphere;
}

/** 创建连线 */
export function createLine(app: pc.Application, from: pc.Vec3, to: pc.Vec3, color: pc.Color, thickness = 0.05): pc.Entity {
  const line = new pc.Entity("draw-line");
  line.addComponent("render", { type: "box", material: createSolidMaterial(color) });
  updateLineEntity(line, from, to, thickness);
  app.root.addChild(line);
  return line;
}
