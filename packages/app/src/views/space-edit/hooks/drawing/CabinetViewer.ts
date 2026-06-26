import * as pc from "playcanvas";
import { createLine } from "./drawing-utils";
import type { CabinetItem } from "./drawing-storage";

const RED = new pc.Color(1, 0.1, 0.1);
const GREEN = new pc.Color(0.2, 1, 0.3);
const THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;

/** 用户点击的 3 条红边（顶点索引） */
const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
/** 自动补全的 9 条绿边 */
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

/**
 * 屏柜只读展示渲染器
 *
 * 由已保存的 CabinetItem 重建屏柜框线/分隔/红色名称标签，按间隔 id（bayId）显隐。
 * 非绘制模式下支持整体选中（点击高亮）、右键菜单删除、Del 键删除。
 */
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

  setOnRequestDelete(fn: (jsonPath: string, bayId: number) => void) {
    this.onRequestDelete = fn;
  }

  setOnSelectChange(fn: (selected: boolean) => void) {
    this.onSelectChange = fn;
  }

  /** 启用/禁用选中交互（绘制模式下应禁用） */
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

  /** 显示一条屏柜记录（按 bay.id 去重） */
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
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
    this.deselect();
    this.clear();
    this.labelContainer?.remove();
    this.labelContainer = null;
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

  /** 取消选中（供外部调用） */
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

  /** 命中测试：返回包含点击点的、屏幕包围框最小的屏柜 bayId */
  private hitTest(cssX: number, cssY: number): number | null {
    const vp = this.vpMatrix();
    if (!vp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.gd.width > 0 ? rect.width / this.gd.width : 1;
    const scaleY = this.gd.height > 0 ? rect.height / this.gd.height : 1;
    let bestId: number | null = null;
    let bestArea = Infinity;
    this.shown.forEach((s, id) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let ok = false;
      for (const v of s.verts) {
        const sp = this.projectScreen(v, vp);
        if (!sp) { ok = false; break; }
        ok = true;
        const x = sp.x * scaleX, y = sp.y * scaleY;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (!ok) return;
      if (cssX >= minX && cssX <= maxX && cssY >= minY && cssY <= maxY) {
        const area = (maxX - minX) * (maxY - minY);
        if (area < bestArea) { bestArea = area; bestId = id; }
      }
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
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.interactive || e.button !== 0 || !this.downPos) { this.downPos = null; return; }
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
