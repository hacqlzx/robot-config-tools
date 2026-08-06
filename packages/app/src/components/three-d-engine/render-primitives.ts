import * as pc from "playcanvas";

/**
 * 用一个细长 box 表示线段。
 *
 * PlayCanvas 基础几何里没有“有厚度的世界空间线段”，这里通过 box 的 z 轴长度
 * 连接 from/to。编辑态和只读回显都复用这个函数，所以保持它无业务含义。
 */
export function updateLineEntity(line: pc.Entity, from: pc.Vec3, to: pc.Vec3, thickness = 0.05) {
  const mid = new pc.Vec3().add2(from, to).mulScalar(0.5);
  const len = from.clone().sub(to).length();
  const fwd = new pc.Vec3().sub2(to, from).normalize();
  const target = mid.clone().add(fwd);

  line.setLocalPosition(mid);
  line.setLocalScale(thickness, thickness, len);
  // 当线段方向几乎竖直时，默认 up=(0,1,0) 与 forward 共线，lookAt 会出现旋转抖动。
  // 切换到 x 轴作为 up，可以让竖直线段的姿态稳定。
  if (Math.abs(fwd.y) > 0.999) {
    line.lookAt(target.x, target.y, target.z, 1, 0, 0);
  } else {
    line.lookAt(target.x, target.y, target.z, 0, 1, 0);
  }
}

export interface PrimitiveRenderOptions {
  /** 勘察射线等辅助标记需要穿透点云/模型显示，避免被深度缓冲遮挡。 */
  alwaysOnTop?: boolean;
}

const ALWAYS_ON_TOP_DRAW_ORDER = 100000;

function createSolidMaterial(color: pc.Color, options: PrimitiveRenderOptions = {}): pc.StandardMaterial {
  const material = new pc.StandardMaterial();
  material.diffuse = color;
  material.emissive = color;
  material.useLighting = false;
  if (options.alwaysOnTop) {
    material.opacity = color.a;
    material.blendType = pc.BLEND_NORMAL;
    material.depthTest = false;
    material.depthWrite = false;
  }
  material.update();
  return material;
}

function applyPrimitiveRenderOptions(entity: pc.Entity, options: PrimitiveRenderOptions = {}) {
  if (!options.alwaysOnTop) return;
  for (const meshInstance of entity.render?.meshInstances || []) {
    meshInstance.drawOrder = ALWAYS_ON_TOP_DRAW_ORDER;
  }
}

/** 创建顶点/路径点标记。材质不受光照影响，保证在深色点云上仍可见。 */
export function createSphere(
  app: pc.Application,
  pos: pc.Vec3,
  color: pc.Color,
  scale = 0.15,
  options: PrimitiveRenderOptions = {},
): pc.Entity {
  const sphere = new pc.Entity("draw-pt");
  sphere.addComponent("render", { type: "sphere", material: createSolidMaterial(color, options) });
  applyPrimitiveRenderOptions(sphere, options);
  sphere.setLocalScale(scale, scale, scale);
  sphere.setLocalPosition(pos);
  app.root.addChild(sphere);
  return sphere;
}

/** 创建世界空间线段，并立即加入 app.root；调用方负责在 clear/destroy 时销毁实体。 */
export function createLine(
  app: pc.Application,
  from: pc.Vec3,
  to: pc.Vec3,
  color: pc.Color,
  thickness = 0.05,
  options: PrimitiveRenderOptions = {},
): pc.Entity {
  const line = new pc.Entity("draw-line");
  line.addComponent("render", { type: "box", material: createSolidMaterial(color, options) });
  applyPrimitiveRenderOptions(line, options);
  updateLineEntity(line, from, to, thickness);
  app.root.addChild(line);
  return line;
}
