import * as pc from "playcanvas";
import {
  claimSpaceEditClick,
  hasSpaceEditClickClaim,
  createLine,
  viewProjectionMatrix,
  projectToScreen,
  screenToRay,
  extractBoxObb,
  rayObbHit,
  isNearProjectedBounds,
} from "./drawing-utils";
import type { CabinetItem } from "./drawing-storage";

const RED = new pc.Color(1, 0.1, 0.1);
const GREEN = new pc.Color(0.2, 1, 0.3);
const THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;
const CLICK_CLAIM_OWNER = "cabinet-viewer";

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
    return viewProjectionMatrix(this.camera);
  }

  private projectScreen(p: pc.Vec3, vp: pc.Mat4): { x: number; y: number } | null {
    return projectToScreen(p, vp, this.gd.width, this.gd.height);
  }

  // ====== 射线-OBB 命中测试 ======

  private isNearProjection(verts: pc.Vec3[], sx: number, sy: number, margin = 12): boolean {
    const vp = this.vpMatrix();
    if (!vp) return true;
    const rect = this.canvas.getBoundingClientRect();
    return isNearProjectedBounds(verts, sx, sy, vp, rect.width, rect.height, margin);
  }

  private hitTest(cssX: number, cssY: number): number | null {
    const ray = screenToRay(this.camera, this.canvas, cssX, cssY);
    if (!ray) return null;
    const HIT_TOLERANCE = 1.2;
    let bestId: number | null = null;
    let bestT = Infinity;
    this.shown.forEach((s, id) => {
      if (!this.isNearProjection(s.verts, cssX, cssY)) return;
      const obb = extractBoxObb(s.verts);
      if (!obb) return;
      const te = obb.extents;
      const t = rayObbHit(ray.origin, ray.dir, obb.center, obb.axes,
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
    if ((window as any).__clipDragging || (window as any).__drawingDragging || hasSpaceEditClickClaim()) return;
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.interactive || e.button !== 0 || !this.downPos) { this.downPos = null; return; }
    if ((window as any).__clipDragging || (window as any).__drawingDragging || hasSpaceEditClickClaim()) { this.downPos = null; return; }
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > 4) return;
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit != null) {
      this.select(hit);
      claimSpaceEditClick(CLICK_CLAIM_OWNER);
    }
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
