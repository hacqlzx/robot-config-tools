import * as pc from "playcanvas";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenPointLegacy {
  sx: number;
  sy: number;
}

export interface ScreenRay {
  origin: pc.Vec3;
  dir: pc.Vec3;
}

export interface BoxObb {
  center: pc.Vec3;
  axes: pc.Vec3[];
  extents: number[];
}

export function viewProjectionMatrix(camera: pc.Entity): pc.Mat4 | null {
  const camComp = camera.camera;
  if (!camComp) return null;
  return new pc.Mat4().mul2(camComp.projectionMatrix, camera.getWorldTransform().clone().invert());
}

export function projectToScreen(p: pc.Vec3, vp: pc.Mat4, screenW: number, screenH: number): ScreenPoint | null {
  const m = vp.data;
  const clipW = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (clipW <= 0) return null;
  const inv = 1 / clipW;
  return {
    x: (((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) * inv) * 0.5 + 0.5) * screenW,
    y: (0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) * inv) * 0.5) * screenH,
  };
}

export function worldToScreen(p: pc.Vec3, vp: pc.Mat4, screenW: number, screenH: number): ScreenPointLegacy | null {
  const projected = projectToScreen(p, vp, screenW, screenH);
  return projected ? { sx: projected.x, sy: projected.y } : null;
}

export function screenToRay(
  camera: pc.Entity,
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
): ScreenRay | null {
  const camComp = camera.camera;
  if (!camComp) return null;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;
  if (cssW <= 0 || cssH <= 0) return null;

  const ndcX = (sx / cssW) * 2 - 1;
  const ndcY = 1 - (sy / cssH) * 2;
  const vp = viewProjectionMatrix(camera);
  if (!vp) return null;
  const vpInv = vp.clone().invert();
  const near4 = new pc.Vec4(ndcX, ndcY, -1, 1);
  const far4 = new pc.Vec4(ndcX, ndcY, 1, 1);
  vpInv.transformVec4(near4, near4);
  vpInv.transformVec4(far4, far4);
  if (Math.abs(near4.w) < 1e-8 || Math.abs(far4.w) < 1e-8) return null;

  const near = new pc.Vec3(near4.x / near4.w, near4.y / near4.w, near4.z / near4.w);
  const far = new pc.Vec3(far4.x / far4.w, far4.y / far4.w, far4.z / far4.w);
  return { origin: near, dir: new pc.Vec3().sub2(far, near).normalize() };
}

export function pointToSegmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const nearX = ax + t * dx;
  const nearY = ay + t * dy;
  return (px - nearX) ** 2 + (py - nearY) ** 2;
}

export function extractBoxObb(verts: pc.Vec3[]): BoxObb | null {
  if (verts.length < 8) return null;
  const center = new pc.Vec3();
  for (const v of verts) center.add(v);
  center.mulScalar(1 / verts.length);

  const e0 = new pc.Vec3().sub2(verts[1], verts[0]);
  const e1 = new pc.Vec3().sub2(verts[3], verts[0]);
  const e2 = new pc.Vec3().sub2(verts[4], verts[0]);
  if (e0.length() < 1e-6 || e1.length() < 1e-6 || e2.length() < 1e-6) return null;

  const ax = e0.clone().normalize();
  const ay = e1.clone();
  ay.sub(ax.clone().mulScalar(ax.dot(ay)));
  const ayLen = ay.length();
  if (ayLen < 1e-6) return null;
  ay.mulScalar(1 / ayLen);
  const az = new pc.Vec3().cross(ax, ay);
  if (az.length() < 1e-6) return null;
  az.normalize();

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    const d = new pc.Vec3().sub2(v, center);
    const px = ax.dot(d); if (px < minX) minX = px; if (px > maxX) maxX = px;
    const py = ay.dot(d); if (py < minY) minY = py; if (py > maxY) maxY = py;
    const pz = az.dot(d); if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
  }

  return {
    center,
    axes: [ax, ay, az],
    extents: [
      Math.max(Math.abs(minX), Math.abs(maxX), 0.01),
      Math.max(Math.abs(minY), Math.abs(maxY), 0.01),
      Math.max(Math.abs(minZ), Math.abs(maxZ), 0.01),
    ],
  };
}

export function rayObbHit(
  origin: pc.Vec3,
  dir: pc.Vec3,
  center: pc.Vec3,
  axes: pc.Vec3[],
  extents: number[],
): number | null {
  const d = new pc.Vec3().sub2(origin, center);
  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    const e = axes[i].dot(d);
    const f = axes[i].dot(dir);
    if (Math.abs(f) > 1e-8) {
      let t1 = (-e - extents[i]) / f;
      let t2 = (-e + extents[i]) / f;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    } else if (Math.abs(e) > extents[i]) {
      return null;
    }
  }
  return tMin > 0 ? tMin : (tMax > 0 ? tMax : null);
}

export function hitTestBoxVolume(
  camera: pc.Entity,
  canvas: HTMLCanvasElement,
  verts: pc.Vec3[],
  sx: number,
  sy: number,
  tolerance = 1,
): number | null {
  const ray = screenToRay(camera, canvas, sx, sy);
  const obb = extractBoxObb(verts);
  if (!ray || !obb) return null;
  return rayObbHit(
    ray.origin,
    ray.dir,
    obb.center,
    obb.axes,
    obb.extents.map((v) => v * tolerance),
  );
}

export function isNearProjectedBounds(
  verts: pc.Vec3[],
  sx: number,
  sy: number,
  vp: pc.Mat4,
  screenW: number,
  screenH: number,
  margin = 12,
): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of verts) {
    const sp = projectToScreen(v, vp, screenW, screenH);
    if (!sp) return true;
    if (sp.x < minX) minX = sp.x;
    if (sp.x > maxX) maxX = sp.x;
    if (sp.y < minY) minY = sp.y;
    if (sp.y > maxY) maxY = sp.y;
  }
  return sx >= minX - margin && sx <= maxX + margin && sy >= minY - margin && sy <= maxY + margin;
}
