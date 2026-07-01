import * as pc from "playcanvas";
import { createLine } from "./drawing-utils";
import type { CabinetItem } from "./drawing-storage";

const RED = new pc.Color(1, 0.1, 0.1);
const GREEN = new pc.Color(0.2, 1, 0.3);
const THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;

const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [3, 7],
];

function v3(a: number[]): pc.Vec3 {
  return new pc.Vec3(a[0], a[1], a[2]);
}

function splitCorners(verts: pc.Vec3[], t: number): pc.Vec3[] {
  return [
    new pc.Vec3().lerp(verts[0], verts[1], t),
    new pc.Vec3().lerp(verts[3], verts[2], t),
    new pc.Vec3().lerp(verts[4], verts[5], t),
    new pc.Vec3().lerp(verts[7], verts[6], t),
  ];
}

function cabinetTopCenters(verts: pc.Vec3[], splits: number[]): pc.Vec3[] {
  const ts = [0, ...[...splits].sort((a, b) => a - b), 1];
  const offset = new pc.Vec3().sub2(verts[3], verts[0]).mulScalar(0.04);
  const out: pc.Vec3[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const mt = (ts[i] + ts[i + 1]) / 2;
    const ft = new pc.Vec3().lerp(verts[3], verts[2], mt);
    const bt = new pc.Vec3().lerp(verts[7], verts[6], mt);
    out.push(new pc.Vec3().add2(ft, bt).mulScalar(0.5).add(offset));
  }
  return out;
}

interface Shown {
  verts: pc.Vec3[];
  jsonPath: string;
  lines: pc.Entity[];
  centers: pc.Vec3[];
  names: string[];
  labelEls: HTMLDivElement[];
}

export class CabinetViewer {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private shown = new Map<number, Shown>();
  private labelContainer: HTMLDivElement | null = null;
  private labelRafId = 0;

  private interactive = true;
  private selected: number | null = null;
  private downPos: { x: number; y: number } | null = null;
  private onRequestDelete?: (jsonPath: string, bayId: number) => void;
  private onSelectChange?: (selected: boolean) => void;

  constructor(app: pc.Application, camera: pc.Entity, requestRender: () => void) {
    this.app = app;
    this.camera = camera;
    this.requestRender = requestRender;
    this.gd = app.graphicsDevice;
    this.canvas = this.gd.canvas as HTMLCanvasElement;
    this.initLabels();
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("keydown", this.onKeyDown);
  }

  // ============ 选中 / 高亮 ============

  private select(bayId: number) {
    this.deselect_all();
    const s = this.shown.get(bayId);
    if (!s) return;
    s.lines.forEach((line) => line.setLocalScale(HIGHLIGHT_THICKNESS, HIGHLIGHT_THICKNESS, line.getLocalScale().z));
    this.selected = bayId;
    this.onSelectChange?.(true);
    this.requestRender();
  }

  deselect() {
    this.deselect_all();
  }

  private deselect_all() {
    if (this.selected != null) {
      const s = this.shown.get(this.selected);
      if (s) {
        s.lines.forEach((line) => line.setLocalScale(THICKNESS, THICKNESS, line.getLocalScale().z));
      }
    }
    this.selected = null;
    this.onSelectChange?.(false);
    this.requestRender();
  }

  setOnRequestDelete(fn: (jsonPath: string, bayId: number) => void) {
    this.onRequestDelete = fn;
  }

  setOnSelectChange(fn: (selected: boolean) => void) {
    this.onSelectChange = fn;
  }

  setInteractive(v: boolean) {
    this.interactive = v;
    if (!v) { this.deselect(); }
  }

  has(bayId: number): boolean {
    return this.shown.has(bayId);
  }

  getShownIds(): number[] {
    return Array.from(this.shown.keys());
  }

  show(item: CabinetItem, jsonPath: string) {
    this.hide(item.bay.id);
    const verts = item.geometry.verts.map(v3);
    if (verts.length < 8) return;
    const splits = item.geometry.splits || [];
    const lines: pc.Entity[] = [];
    for (const [a, b] of RED_EDGES) lines.push(createLine(this.app, verts[a], verts[b], RED, THICKNESS));
    for (const [a, b] of GREEN_EDGES) lines.push(createLine(this.app, verts[a], verts[b], GREEN, THICKNESS));
    for (const t of splits) {
      const c = splitCorners(verts, t);
      lines.push(createLine(this.app, c[0], c[1], GREEN, THICKNESS));
      lines.push(createLine(this.app, c[2], c[3], GREEN, THICKNESS));
      lines.push(createLine(this.app, c[0], c[2], GREEN, THICKNESS));
      lines.push(createLine(this.app, c[1], c[3], GREEN, THICKNESS));
    }
    const centers = cabinetTopCenters(verts, splits);
    const names = item.cabinets.map((c) => c.name);
    const labelEls = centers.map(() => this.createLabelEl());
    this.shown.set(item.bay.id, { verts, jsonPath, lines, centers, names, labelEls });
    this.requestRender();
  }

  hide(bayId: number) {
    const s = this.shown.get(bayId);
    if (!s) return;
    s.lines.forEach((e) => e.destroy());
    s.labelEls.forEach((el) => el.remove());
    this.shown.delete(bayId);
    if (this.selected === bayId) this.deselect();
    this.requestRender();
  }

  clear() {
    for (const id of Array.from(this.shown.keys())) this.hide(id);
  }

  destroy() {
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    if (this.canvas) {
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
      this.canvas.removeEventListener("mouseup", this.onMouseUp);
    }
    document.removeEventListener("keydown", this.onKeyDown);
    this.deselect();
    this.clear();
    this.labelContainer?.remove();
    this.labelContainer = null;
  }

  // ====== 投影工具（标签定位） ======

  private vpMatrix(): pc.Mat4 | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    return new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
  }

  private projectScreen(p: pc.Vec3, vp: pc.Mat4): { x: number; y: number } | null {
    const m = vp.data;
    const clipW = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (clipW <= 0) return null;
    const inv = 1 / clipW;
    return {
      x: (((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) * inv) * 0.5 + 0.5) * this.gd.width,
      y: (0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) * inv) * 0.5) * this.gd.height,
    };
  }

  // ====== 射线-OBB 命中测试 ======

  private projectCSS(p: pc.Vec3, vp: pc.Mat4, cssW: number, cssH: number): { x: number; y: number } | null {
    const m = vp.data;
    const clipW = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (clipW <= 0) return null;
    const inv = 1 / clipW;
    return {
      x: (((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) * inv) * 0.5 + 0.5) * cssW,
      y: (0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) * inv) * 0.5) * cssH,
    };
  }

  private screenToRay(sx: number, sy: number): { origin: pc.Vec3; dir: pc.Vec3 } | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (cssW <= 0 || cssH <= 0) return null;
    const ndcX = (sx / cssW) * 2 - 1;
    const ndcY = 1 - (sy / cssH) * 2;
    const viewInv = this.camera.getWorldTransform();
    const proj = camComp.projectionMatrix;
    const vp = new pc.Mat4().mul2(proj, viewInv.clone().invert());
    const vpInv = vp.clone().invert();
    const near4 = new pc.Vec4(ndcX, ndcY, -1, 1);
    const far4 = new pc.Vec4(ndcX, ndcY, 1, 1);
    vpInv.transformVec4(near4, near4);
    vpInv.transformVec4(far4, far4);
    if (Math.abs(near4.w) < 1e-8 || Math.abs(far4.w) < 1e-8) return null;
    const near = new pc.Vec3(near4.x / near4.w, near4.y / near4.w, near4.z / near4.w);
    const far = new pc.Vec3(far4.x / far4.w, far4.y / far4.w, far4.z / far4.w);
    const dir = new pc.Vec3().sub2(far, near).normalize();
    return { origin: near, dir };
  }

  private extractOBB(verts: pc.Vec3[]): { center: pc.Vec3; axes: pc.Vec3[]; extents: number[] } | null {
    if (verts.length < 8) return null;
    const center = new pc.Vec3();
    for (const v of verts) center.add(v);
    center.mulScalar(1 / verts.length);

    const e0 = new pc.Vec3().sub2(verts[1], verts[0]);
    const e1 = new pc.Vec3().sub2(verts[3], verts[0]);
    const e2 = new pc.Vec3().sub2(verts[4], verts[0]);

    const ax = e0.clone().normalize();
    const ay = e1.clone();
    ay.sub(ax.clone().mulScalar(ax.dot(ay)));
    const ayLen = ay.length();
    if (ayLen < 0.001) return null;
    ay.mulScalar(1 / ayLen);
    const az = new pc.Vec3().cross(ax, ay);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
      const d = new pc.Vec3().sub2(v, center);
      const px = ax.dot(d); if (px < minX) minX = px; if (px > maxX) maxX = px;
      const py = ay.dot(d); if (py < minY) minY = py; if (py > maxY) maxY = py;
      const pz = az.dot(d); if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    const ex = Math.max(Math.abs(minX), Math.abs(maxX), 0.01);
    const ey = Math.max(Math.abs(minY), Math.abs(maxY), 0.01);
    const ez = Math.max(Math.abs(minZ), Math.abs(maxZ), 0.01);
    return { center, axes: [ax, ay, az], extents: [ex, ey, ez] };
  }

  private rayOBBHit(
    origin: pc.Vec3, dir: pc.Vec3,
    center: pc.Vec3, axes: pc.Vec3[], extents: number[],
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

  private isNearProjection(verts: pc.Vec3[], sx: number, sy: number, margin = 12): boolean {
    const vp = this.vpMatrix();
    if (!vp) return true;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of verts) {
      const sp = this.projectCSS(v, vp, cssW, cssH);
      if (!sp) return true;
      if (sp.x < minX) minX = sp.x;
      if (sp.x > maxX) maxX = sp.x;
      if (sp.y < minY) minY = sp.y;
      if (sp.y > maxY) maxY = sp.y;
    }
    return sx >= minX - margin && sx <= maxX + margin && sy >= minY - margin && sy <= maxY + margin;
  }

  private hitTest(cssX: number, cssY: number): number | null {
    const ray = this.screenToRay(cssX, cssY);
    if (!ray) return null;
    const HIT_TOLERANCE = 1.2;
    let bestId: number | null = null;
    let bestT = Infinity;
    this.shown.forEach((s, id) => {
      if (!this.isNearProjection(s.verts, cssX, cssY)) return;
      const obb = this.extractOBB(s.verts);
      if (!obb) return;
      const te = obb.extents;
      const t = this.rayOBBHit(ray.origin, ray.dir, obb.center, obb.axes,
        [te[0] * HIT_TOLERANCE, te[1] * HIT_TOLERANCE, te[2] * HIT_TOLERANCE]);
      if (t !== null && t < bestT) { bestT = t; bestId = id; }
    });
    return bestId;
  }

  // ============ 删除 ============

  private deleteSelected() {
    if (this.selected == null) return;
    const s = this.shown.get(this.selected);
    if (s) this.onRequestDelete?.(s.jsonPath, this.selected);
  }

  // ============ 事件 ============

  private onMouseDown = (e: MouseEvent) => {
    if (!this.interactive || e.button !== 0) return;
    if ((window as any).__clipDragging || (window as any).__drawingDragging) return;
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.interactive || e.button !== 0 || !this.downPos) { this.downPos = null; return; }
    if ((window as any).__clipDragging || (window as any).__drawingDragging) { this.downPos = null; return; }
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > 4) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit != null) this.select(hit);
    else this.deselect();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.interactive || this.selected == null) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.deleteSelected();
    }
  };

  // ============ 标签 ============

  private initLabels() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const c = document.createElement("div");
    c.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:15;";
    parent.appendChild(c);
    this.labelContainer = c;
    const loop = () => {
      this.updateLabels();
      this.labelRafId = requestAnimationFrame(loop);
    };
    this.labelRafId = requestAnimationFrame(loop);
  }

  private createLabelEl(): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;transform:translate(-50%,-105%);" +
      "color:#ff2a1a;font-size:18px;font-weight:700;white-space:nowrap;" +
      "text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;display:none;";
    this.labelContainer?.appendChild(el);
    return el;
  }

  private updateLabels() {
    if (!this.labelContainer || this.shown.size === 0) return;
    const vp = this.vpMatrix();
    if (!vp) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.gd.width > 0 ? rect.width / this.gd.width : 1;
    const scaleY = this.gd.height > 0 ? rect.height / this.gd.height : 1;
    this.shown.forEach((s) => {
      s.labelEls.forEach((el, i) => {
        const center = s.centers[i];
        const name = s.names[i];
        if (!center || name == null) { el.style.display = "none"; return; }
        const sp = this.projectScreen(center, vp);
        if (!sp) { el.style.display = "none"; return; }
        el.textContent = name;
        el.style.left = `${sp.x * scaleX}px`;
        el.style.top = `${sp.y * scaleY}px`;
        el.style.display = "block";
      });
    });
  }
}
