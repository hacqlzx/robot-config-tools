import * as pc from "playcanvas";
import {
  screenPickLas,
  worldToScreen,
  setSphereColor,
  setLineColor,
  createSphere,
  createLine,
} from "./drawing-utils";

export interface PathDrawingOptions {
  pointColor?: pc.Color;
  selectedColor?: pc.Color;
  lineColor?: pc.Color;
  cpColor?: pc.Color;
  snap?: boolean;
  sphereScale?: number;
  cpScale?: number;
  onChange?: (data: PathData) => void;
  onSelectChange?: (selected: boolean) => void;
}

export interface PathPoint {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface PathSegment {
  id: string;
  from: string;
  to: string;
  bezier: {
    cp1: [number, number, number];
    cp2: [number, number, number];
  } | null;
}

export interface PathData {
  points: PathPoint[];
  paths: PathSegment[];
}

const DEFAULTS = {
  pointColor: new pc.Color(0.3, 0.9, 0.4),
  selectedColor: new pc.Color(1, 0.85, 0.1),
  lineColor: new pc.Color(0.3, 0.9, 0.4),
  cpColor: new pc.Color(0.5, 0.6, 1.0),
  snap: true,
  sphereScale: 0.12,
  cpScale: 0.08,
};

const CURVE_SEGMENTS = 16;

const CLICK_THRESHOLD = 3;

let _idCounter = 0;
function genId(): string {
  return `${Date.now().toString(36)}_${(_idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isOldPathData(data: any): data is { points: number[][]; connections: [number, number][] } {
  if (!data) return false;
  const pt = data.points?.[0];
  return Array.isArray(pt) && typeof pt[0] === "number";
}

function pointToSegmentDistSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nearX = ax + t * dx;
  const nearY = ay + t * dy;
  return (px - nearX) ** 2 + (py - nearY) ** 2;
}

/**
 * 可行路径绘制（框架无关）
 *
 * - 激活状态：点击生成点，相邻点自动连线；点到已有点时追加连线（不分叉不创建新点）
 * - 非激活状态：可选中点并拖拽移动；无法放置新点
 */
export class PathDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<PathDrawingOptions, "onChange" | "onSelectChange">> & Pick<PathDrawingOptions, "onChange" | "onSelectChange">;

  private points: pc.Vec3[] = [];
  private pointIds: string[] = [];
  private spheres: pc.Entity[] = [];
  private connections: [number, number][] = [];
  private pathIds: string[] = [];
  private bezierParams: ({ cp1: [number, number, number]; cp2: [number, number, number] } | null)[] = [];
  private lines: pc.Entity[] = [];
  private cpSpheres: { cp1: pc.Entity | null; cp2: pc.Entity | null }[] = [];
  private curveSegs: pc.Entity[][] = [];

  private enabled = false;
  private active = false;
  private selectedPointIdx = -1;
  private selectedPathIdx = -1;
  private lastConnectedIdx = -1;
  private isDragging = false;
  private cpDragging: { pathIdx: number; which: 1 | 2 } | null = null;
  private dragStartScreen: { x: number; y: number } | null = null;

  constructor(
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
    options: PathDrawingOptions = {},
  ) {
    this.app = app;
    this.camera = camera;
    this.requestRender = requestRender;
    this.entitiesRef = entitiesRef;
    this.gd = app.graphicsDevice;
    this.canvas = this.gd.canvas as HTMLCanvasElement;
    this.opts = { ...DEFAULTS, ...options };

    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("mouseleave", this.cancelDrag);
    document.addEventListener("mouseleave", this.cancelDrag);
    window.addEventListener("blur", this.cancelDrag);
  }

  // ============ 对外 API ============

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.cancelDrag();
  }

  /** 切换激活/非激活状态 */
  setActive(v: boolean) {
    this.active = v;
    this._unselAll();
    this.lastConnectedIdx = -1;
  }

  /** 是否激活（放置模式） */
  isActive(): boolean {
    return this.active;
  }

  getPointCount(): number {
    return this.points.length;
  }

  getConnectionCount(): number {
    return this.connections.length;
  }

  getData(): PathData {
    return {
      points: this.points.map((p, i) => ({
        id: this.pointIds[i],
        x: p.x,
        y: p.y,
        z: p.z,
      })),
      paths: this.connections.map(([from, to], i) => ({
        id: this.pathIds[i],
        from: this.pointIds[from],
        to: this.pointIds[to],
        bezier: this.bezierParams[i],
      })),
    };
  }

  loadData(data: PathData | { points: number[][]; connections: [number, number][] }) {
    this.clearEntities();
    this.points.length = 0;
    this.pointIds.length = 0;
    this.spheres.length = 0;
    this.connections.length = 0;
    this.pathIds.length = 0;
    this.bezierParams.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
    this.lastConnectedIdx = -1;

    if (isOldPathData(data)) {
      for (const [x, y, z] of data.points) {
        const pos = new pc.Vec3(x, y, z);
        this.points.push(pos);
        this.pointIds.push(genId());
        this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
      }
      for (const [from, to] of data.connections) {
        this.addConnectionInternal(from, to);
      }
    } else {
      const indexMap = new Map<string, number>();
      for (const pt of data.points) {
        const idx = this.points.length;
        const pos = new pc.Vec3(pt.x, pt.y, pt.z);
        this.points.push(pos);
        this.pointIds.push(pt.id);
        this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
        indexMap.set(pt.id, idx);
      }
      for (const seg of data.paths) {
        const fromIdx = indexMap.get(seg.from);
        const toIdx = indexMap.get(seg.to);
        if (fromIdx !== undefined && toIdx !== undefined) {
          this.addConnectionInternal(fromIdx, toIdx, seg.id, seg.bezier);
        }
      }
    }
    this.emitChange();
    this.requestRender();
  }

  clear() {
    this.clearEntities();
    this.points.length = 0;
    this.pointIds.length = 0;
    this.spheres.length = 0;
    this.connections.length = 0;
    this.pathIds.length = 0;
    this.bezierParams.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
    this.selectedPointIdx = -1;
    this.selectedPathIdx = -1;
    this.lastConnectedIdx = -1;
    this.isDragging = false;
    this.cpDragging = null;
    this.emitChange();
    this.requestRender();
  }

  /** 撤销最后放置的点及关联连线 */
  undo() {
    if (this.points.length === 0) return;
    const idx = this.points.length - 1;
    this.removeConnectionsForInner(idx);
    this.spheres[idx].destroy();
    this.points.splice(idx, 1);
    this.pointIds.splice(idx, 1);
    this.spheres.splice(idx, 1);
    this.lastConnectedIdx = Math.min(this.lastConnectedIdx, this.points.length - 1);
    if (this.selectedPointIdx >= this.points.length) { this.selectedPointIdx = -1; this.selectedPathIdx = -1; }
    if (this.selectedPathIdx >= this.connections.length) this.selectedPathIdx = -1;
    this.cpDragging = null;
    this.emitChange();
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("mouseleave", this.cancelDrag);
    document.removeEventListener("mouseleave", this.cancelDrag);
    window.removeEventListener("blur", this.cancelDrag);
    this.clearEntities();
    this.points.length = 0;
    this.pointIds.length = 0;
    this.spheres.length = 0;
    this.connections.length = 0;
    this.pathIds.length = 0;
    this.bezierParams.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
    this.selectedPointIdx = -1;
    this.selectedPathIdx = -1;
    this.lastConnectedIdx = -1;
    this.cpDragging = null;
  }

  // ============ 内部：点与连线管理 ============

  private clearEntities() {
    this.spheres.forEach((e) => e.destroy());
    this.lines.forEach((e) => e.destroy());
    this.cpSpheres.forEach((cs) => { cs.cp1?.destroy(); cs.cp2?.destroy(); });
    this.curveSegs.forEach((segs) => segs.forEach((e) => e.destroy()));
    this.spheres.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
  }

  private emitChange() {
    this.opts.onChange?.(this.getData());
  }

  // ============ 贝塞尔曲线 ============

  private static bezierPoint(t: number, p0: pc.Vec3, cp1: pc.Vec3, cp2: pc.Vec3, p1: pc.Vec3): pc.Vec3 {
    const mt = 1 - t;
    return new pc.Vec3(
      mt * mt * mt * p0.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * p1.x,
      mt * mt * mt * p0.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * p1.y,
      mt * mt * mt * p0.z + 3 * mt * mt * t * cp1.z + 3 * mt * t * t * cp2.z + t * t * t * p1.z,
    );
  }

  private getBezierVectors(pathIdx: number): { cp1: pc.Vec3; cp2: pc.Vec3 } | null {
    const bz = this.bezierParams[pathIdx];
    const [a, b] = this.connections[pathIdx];
    const p0 = this.points[a], p1 = this.points[b];
    if (bz) {
      return {
        cp1: new pc.Vec3(bz.cp1[0], bz.cp1[1], bz.cp1[2]),
        cp2: new pc.Vec3(bz.cp2[0], bz.cp2[1], bz.cp2[2]),
      };
    }
    const v33 = p1.clone().sub(p0).mulScalar(1 / 3);
    const v66 = p1.clone().sub(p0).mulScalar(2 / 3);
    return { cp1: p0.clone().add(v33), cp2: p0.clone().add(v66) };
  }

  private buildCurve(i: number) {
    this.lines[i]?.destroy();
    this.curveSegs[i]?.forEach((e) => e.destroy());
    const [a, b] = this.connections[i];
    const bvs = this.getBezierVectors(i);
    if (!bvs) return;
    const segs: pc.Entity[] = [];
    let prev = this.points[a];
    for (let s = 1; s <= CURVE_SEGMENTS; s++) {
      const t = s / CURVE_SEGMENTS;
      const pt = PathDrawing.bezierPoint(t, this.points[a], bvs.cp1, bvs.cp2, this.points[b]);
      const color = this.selectedPathIdx === i ? this.opts.selectedColor : this.opts.lineColor;
      segs.push(createLine(this.app, prev, pt, color));
      prev = pt;
    }
    this.curveSegs[i] = segs;
    this.lines[i] = segs[0]; // keep for compatibility
  }

  private showCpSpheres(i: number) {
    this.hideCpSpheres(i);
    const bvs = this.getBezierVectors(i);
    if (!bvs) return;
    const cs = this.cpSpheres[i];
    cs.cp1 = createSphere(this.app, bvs.cp1, this.opts.cpColor, this.opts.cpScale);
    cs.cp2 = createSphere(this.app, bvs.cp2, this.opts.cpColor, this.opts.cpScale);
  }

  private hideCpSpheres(i: number) {
    const cs = this.cpSpheres[i];
    cs?.cp1?.destroy();
    cs?.cp2?.destroy();
    if (cs) { cs.cp1 = null; cs.cp2 = null; }
  }

  private worldPosForCp(dragging: { pathIdx: number; which: 1 | 2 }, clientX: number, clientY: number): pc.Vec3 | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const [a, b] = this.connections[dragging.pathIdx];
    const planeY = (this.points[a].y + this.points[b].y) / 2;
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const from = this.camera.getPosition();
    const to = new pc.Vec3();
    camComp.screenToWorld(sx, sy, 0.5, to);
    const dir = new pc.Vec3().sub2(to, from).normalize();
    if (Math.abs(dir.y) < 0.0001) return null;
    const t = (planeY - from.y) / dir.y;
    if (t <= 0) return null;
    return from.clone().add(dir.mulScalar(t));
  }

  private hitTestCp(sx: number, sy: number): { pathIdx: number; which: 1 | 2 } | null {
    if (this.selectedPathIdx < 0) return null;
    const i = this.selectedPathIdx;
    const cs = this.cpSpheres[i];
    const hitTest = (sphere: pc.Entity | null): boolean => {
      if (!sphere) return false;
      const pos = sphere.getLocalPosition();
      const camComp = this.camera.camera;
      if (!camComp) return false;
      const viewMat = this.camera.getWorldTransform().clone().invert();
      const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
      const ss = worldToScreen(pos, vpMat, this.gd.width, this.gd.height);
      if (!ss) return false;
      return (ss.sx - sx) ** 2 + (ss.sy - sy) ** 2 < 100;
    };
    if (hitTest(cs.cp1)) return { pathIdx: i, which: 1 };
    if (hitTest(cs.cp2)) return { pathIdx: i, which: 2 };
    return null;
  }

  private syncBezierParams(i: number) {
    const cs = this.cpSpheres[i];
    if (!cs?.cp1 || !cs?.cp2) return;
    const p1 = cs.cp1.getLocalPosition();
    const p2 = cs.cp2.getLocalPosition();
    this.bezierParams[i] = {
      cp1: [p1.x, p1.y, p1.z],
      cp2: [p2.x, p2.y, p2.z],
    };
  }

  private hitTestSphere(sx: number, sy: number): number {
    const camComp = this.camera.camera;
    if (!camComp || this.points.length === 0) return -1;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    let bestIdx = -1;
    let bestD2 = 100;
    for (let i = 0; i < this.points.length; i++) {
      const ss = worldToScreen(this.points[i], vpMat, this.gd.width, this.gd.height);
      if (!ss) continue;
      const d2 = (ss.sx - sx) ** 2 + (ss.sy - sy) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    return bestIdx;
  }

  private _unselPoint() {
    if (this.selectedPointIdx >= 0 && this.selectedPointIdx < this.spheres.length) {
      setSphereColor(this.spheres[this.selectedPointIdx], this.opts.pointColor);
    }
    this.selectedPointIdx = -1;
    this.isDragging = false;
  }

  private _selPoint(idx: number) {
    this._unselPath();
    this._unselPoint();
    if (idx >= 0 && idx < this.spheres.length) {
      setSphereColor(this.spheres[idx], this.opts.selectedColor);
      this.selectedPointIdx = idx;
    }
    this.opts.onSelectChange?.(this.selectedPointIdx >= 0);
  }

  private _unselPath() {
    if (this.selectedPathIdx >= 0 && this.selectedPathIdx < this.curveSegs.length) {
      this.curveSegs[this.selectedPathIdx]?.forEach((e) => setLineColor(e, this.opts.lineColor));
      this.hideCpSpheres(this.selectedPathIdx);
    }
    this.selectedPathIdx = -1;
  }

  private _selPath(idx: number) {
    this._unselPoint();
    this._unselPath();
    if (idx >= 0 && idx < this.curveSegs.length) {
      this.curveSegs[idx]?.forEach((e) => setLineColor(e, this.opts.selectedColor));
      this.showCpSpheres(idx);
      this.selectedPathIdx = idx;
    }
    this.opts.onSelectChange?.(this.selectedPathIdx >= 0);
  }

  private _unselAll() {
    this._unselPoint();
    this._unselPath();
    this.opts.onSelectChange?.(false);
  }

  /** 取消路径点选中（供外部互斥调用） */
  deselectPoint() {
    this._unselAll();
    this.requestRender();
  }

  /** 设置选中变化回调（用于与其他绘制工具互斥） */
  setSelectChangeCallback(cb: ((selected: boolean) => void) | undefined) {
    this.opts.onSelectChange = cb;
  }

  private hitTestLine(sx: number, sy: number): number {
    const camComp = this.camera.camera;
    if (!camComp || this.connections.length === 0) return -1;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    let bestIdx = -1;
    let bestD2 = 60;
    for (let i = 0; i < this.connections.length; i++) {
      const [a, b] = this.connections[i];
      const bvs = this.getBezierVectors(i);
      if (!bvs) continue;
      const samples: { sx: number; sy: number }[] = [];
      for (let s = 0; s <= CURVE_SEGMENTS; s++) {
        const t = s / CURVE_SEGMENTS;
        const pt = PathDrawing.bezierPoint(t, this.points[a], bvs.cp1, bvs.cp2, this.points[b]);
        const ss = worldToScreen(pt, vpMat, this.gd.width, this.gd.height);
        if (ss) samples.push(ss);
      }
      for (let j = 1; j < samples.length; j++) {
        const d2 = pointToSegmentDistSq(sx, sy, samples[j - 1].sx, samples[j - 1].sy, samples[j].sx, samples[j].sy);
        if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
      }
    }
    return bestIdx;
  }

  /** 删除路径（保留前后停靠点） */
  private deletePath(idx: number) {
    this.lines[idx]?.destroy();
    this.curveSegs[idx]?.forEach((e) => e.destroy());
    this.hideCpSpheres(idx);
    this.connections.splice(idx, 1);
    this.pathIds.splice(idx, 1);
    this.bezierParams.splice(idx, 1);
    this.lines.splice(idx, 1);
    this.cpSpheres.splice(idx, 1);
    this.curveSegs.splice(idx, 1);
    this._unselAll();
    this.emitChange();
    this.requestRender();
  }

  /** 删除停靠点（同时删除前后关联路径） */
  private deletePoint(idx: number) {
    this.removeConnectionsForInner(idx);
    this.spheres[idx].destroy();
    this.points.splice(idx, 1);
    this.pointIds.splice(idx, 1);
    this.spheres.splice(idx, 1);
    for (let i = 0; i < this.connections.length; i++) {
      const [a, b] = this.connections[i];
      if (a > idx) this.connections[i][0]--;
      if (b > idx) this.connections[i][1]--;
    }
    if (this.lastConnectedIdx > idx) this.lastConnectedIdx--;
    else if (this.lastConnectedIdx === idx) this.lastConnectedIdx = -1;
    this._unselAll();
    this.emitChange();
    this.requestRender();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || this.active) return;
    if (e.key === "Delete") {
      if (this.selectedPathIdx >= 0) {
        this.deletePath(this.selectedPathIdx);
      } else if (this.selectedPointIdx >= 0) {
        this.deletePoint(this.selectedPointIdx);
      }
    }
  };

  private hasConnection(from: number, to: number): boolean {
    return this.connections.some(
      ([a, b]) => (a === from && b === to) || (a === to && b === from),
    );
  }

  private addConnectionInternal(
    from: number,
    to: number,
    id?: string,
    bezier?: { cp1: [number, number, number]; cp2: [number, number, number] } | null,
  ) {
    if (from === to) return;
    if (this.hasConnection(from, to)) return;
    const idx = this.connections.length;
    this.connections.push([from, to]);
    this.pathIds.push(id || genId());
    this.bezierParams.push(bezier || null);
    this.lines.push(null as any);
    this.cpSpheres.push({ cp1: null, cp2: null });
    this.curveSegs.push([]);
    this.buildCurve(idx);
    this.emitChange();
  }

  private addConnection(from: number, to: number) {
    this.addConnectionInternal(from, to);
  }

  private removeConnectionsForInner(idx: number) {
    for (let i = this.connections.length - 1; i >= 0; i--) {
      const [a, b] = this.connections[i];
      if (a === idx || b === idx) {
        this.lines[i]?.destroy();
        this.curveSegs[i]?.forEach((e) => e.destroy());
        this.hideCpSpheres(i);
        this.connections.splice(i, 1);
        this.pathIds.splice(i, 1);
        this.bezierParams.splice(i, 1);
        this.lines.splice(i, 1);
        this.cpSpheres.splice(i, 1);
        this.curveSegs.splice(i, 1);
      }
    }
  }

  private updateLinesForPoint(idx: number) {
    for (let i = 0; i < this.connections.length; i++) {
      const [a, b] = this.connections[i];
      if (a === idx || b === idx) {
        this.buildCurve(i);
      }
    }
  }

  private getDragPosition(clientX: number, clientY: number): pc.Vec3 | null {
    if (this.selectedPointIdx < 0) return null;
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const from = this.camera.getPosition();
    const to = new pc.Vec3();
    camComp.screenToWorld(sx, sy, 0.5, to);
    const dir = new pc.Vec3().sub2(to, from).normalize();
    const planeY = this.points[this.selectedPointIdx].y;
    if (Math.abs(dir.y) < 0.0001) return null;
    const t = (planeY - from.y) / dir.y;
    if (t <= 0) return null;
    return new pc.Vec3().add2(from, dir.mulScalar(t));
  }

  private moveSelected(pos: pc.Vec3) {
    if (this.selectedPointIdx < 0) return;
    this.points[this.selectedPointIdx] = pos.clone();
    this.spheres[this.selectedPointIdx].setLocalPosition(pos);
    this.updateLinesForPoint(this.selectedPointIdx);
    this.emitChange();
    this.requestRender();
  }

  private placePoint(pos: pc.Vec3) {
    const idx = this.points.length;
    this.points.push(pos.clone());
    this.pointIds.push(genId());
    this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
    if (this.lastConnectedIdx >= 0) {
      this.addConnectionInternal(this.lastConnectedIdx, idx);
    }
    this.lastConnectedIdx = idx;
  }

  // ============ 事件处理 ============

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button !== 0) return;
    if ((window as any).__clipDragging) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!this.active) {
      const hitCp = this.hitTestCp(sx, sy);
      if (hitCp) {
        this.cpDragging = hitCp;
        (window as any).__drawingDragging = true;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        this.requestRender();
        return;
      }
      const hitPt = this.hitTestSphere(sx, sy);
      const hitLn = this.hitTestLine(sx, sy);
      if (hitPt >= 0) {
        this._selPoint(hitPt);
        this.isDragging = true;
        (window as any).__drawingDragging = true;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        this.requestRender();
        return;
      }
      if (hitLn >= 0) {
        this._selPath(hitLn);
        this.requestRender();
        return;
      }
      this._unselAll();
      this.requestRender();
      return;
    }

    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.cpDragging) {
      const pos = this.worldPosForCp(this.cpDragging, e.clientX, e.clientY);
      if (pos) {
        const cs = this.cpSpheres[this.cpDragging.pathIdx];
        const which = this.cpDragging.which === 1 ? cs.cp1 : cs.cp2;
        which?.setLocalPosition(pos);
        this.syncBezierParams(this.cpDragging.pathIdx);
        this.buildCurve(this.cpDragging.pathIdx);
        this.emitChange();
        this.requestRender();
      }
      return;
    }
    if (!this.isDragging || this.selectedPointIdx < 0) return;
    const pos = this.getDragPosition(e.clientX, e.clientY);
    if (pos) {
      this.moveSelected(pos);
      this.requestRender();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.enabled) { this.isDragging = false; this.cpDragging = null; this.dragStartScreen = null; return; }

    if (this.cpDragging) {
      this.cpDragging = null;
      (window as any).__drawingDragging = false;
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    if (this.isDragging && this.selectedPointIdx >= 0) {
      this.isDragging = false;
      (window as any).__drawingDragging = false;
      if (this.opts.snap) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = Math.round(e.clientX - rect.left);
        const sy = Math.round(e.clientY - rect.top);
        const snap = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
        if (snap) this.moveSelected(snap.point);
      }
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    if (!this.dragStartScreen) return;
    const dx = e.clientX - this.dragStartScreen.x;
    const dy = e.clientY - this.dragStartScreen.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
      this.dragStartScreen = null;
      return;
    }

    if (this.active) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = Math.round(e.clientX - rect.left);
      const sy = Math.round(e.clientY - rect.top);

      const hitIdx = this.hitTestSphere(sx, sy);
      if (hitIdx >= 0 && hitIdx !== this.lastConnectedIdx) {
        if (this.lastConnectedIdx >= 0) {
          this.addConnection(this.lastConnectedIdx, hitIdx);
        }
        this.lastConnectedIdx = hitIdx;
        this._unselAll();
        this.requestRender();
        this.dragStartScreen = null;
        return;
      }

      const hitResult = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
      if (hitResult) {
        this.placePoint(hitResult.point);
        this.requestRender();
      }
    }

    this.dragStartScreen = null;
  };

  private cancelDrag = () => {
    this.isDragging = false;
    this.cpDragging = null;
    (window as any).__drawingDragging = false;
    this.dragStartScreen = null;
  };
}
