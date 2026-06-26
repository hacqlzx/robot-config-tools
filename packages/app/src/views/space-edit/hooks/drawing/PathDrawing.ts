import * as pc from "playcanvas";
import {
  screenPickLas,
  worldToScreen,
  setSphereColor,
  updateLineEntity,
  createSphere,
  createLine,
} from "./drawing-utils";

export interface PathDrawingOptions {
  pointColor?: pc.Color;
  selectedColor?: pc.Color;
  lineColor?: pc.Color;
  snap?: boolean;
  sphereScale?: number;
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
  snap: true,
  sphereScale: 0.12,
};

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

  private enabled = false;
  private active = false;
  private selectedIdx = -1;
  private lastConnectedIdx = -1;
  private isDragging = false;
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
    this.deselect();
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
    this.selectedIdx = -1;
    this.lastConnectedIdx = -1;
    this.isDragging = false;
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
    if (this.selectedIdx >= this.points.length) this.selectedIdx = -1;
    this.emitChange();
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
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
    this.selectedIdx = -1;
    this.lastConnectedIdx = -1;
  }

  // ============ 内部：点与连线管理 ============

  private clearEntities() {
    this.spheres.forEach((e) => e.destroy());
    this.lines.forEach((e) => e.destroy());
    this.spheres.length = 0;
    this.lines.length = 0;
  }

  private emitChange() {
    this.opts.onChange?.(this.getData());
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

  private deselect() {
    if (this.selectedIdx >= 0 && this.selectedIdx < this.spheres.length) {
      setSphereColor(this.spheres[this.selectedIdx], this.opts.pointColor);
    }
    this.selectedIdx = -1;
    this.isDragging = false;
  }

  private select(idx: number) {
    this.deselect();
    if (idx >= 0 && idx < this.spheres.length) {
      setSphereColor(this.spheres[idx], this.opts.selectedColor);
      this.selectedIdx = idx;
    }
    this.opts.onSelectChange?.(this.selectedIdx >= 0);
  }

  /** 取消路径点选中（供外部互斥调用） */
  deselectPoint() {
    this.deselect();
    this.opts.onSelectChange?.(false);
    this.requestRender();
  }

  /** 设置选中变化回调（用于与其他绘制工具互斥） */
  setSelectChangeCallback(cb: ((selected: boolean) => void) | undefined) {
    this.opts.onSelectChange = cb;
  }

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
    this.connections.push([from, to]);
    this.pathIds.push(id || genId());
    this.bezierParams.push(bezier || null);
    this.lines.push(createLine(this.app, this.points[from], this.points[to], this.opts.lineColor));
    this.emitChange();
  }

  private addConnection(from: number, to: number) {
    this.addConnectionInternal(from, to);
  }

  private removeConnectionsForInner(idx: number) {
    for (let i = this.connections.length - 1; i >= 0; i--) {
      const [a, b] = this.connections[i];
      if (a === idx || b === idx) {
        this.lines[i].destroy();
        this.connections.splice(i, 1);
        this.pathIds.splice(i, 1);
        this.bezierParams.splice(i, 1);
        this.lines.splice(i, 1);
      }
    }
  }

  private updateLinesForPoint(idx: number) {
    for (let i = 0; i < this.connections.length; i++) {
      const [a, b] = this.connections[i];
      if (a === idx || b === idx) {
        updateLineEntity(this.lines[i], this.points[a], this.points[b]);
      }
    }
  }

  private getDragPosition(clientX: number, clientY: number): pc.Vec3 | null {
    if (this.selectedIdx < 0) return null;
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const from = this.camera.getPosition();
    const to = new pc.Vec3();
    camComp.screenToWorld(sx, sy, 0.5, to);
    const dir = new pc.Vec3().sub2(to, from).normalize();
    const planeY = this.points[this.selectedIdx].y;
    if (Math.abs(dir.y) < 0.0001) return null;
    const t = (planeY - from.y) / dir.y;
    if (t <= 0) return null;
    return new pc.Vec3().add2(from, dir.mulScalar(t));
  }

  private moveSelected(pos: pc.Vec3) {
    if (this.selectedIdx < 0) return;
    this.points[this.selectedIdx] = pos.clone();
    this.spheres[this.selectedIdx].setLocalPosition(pos);
    this.updateLinesForPoint(this.selectedIdx);
    this.emitChange();
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
      const hitIdx = this.hitTestSphere(sx, sy);
      if (hitIdx >= 0) {
        this.select(hitIdx);
        this.isDragging = true;
        (window as any).__drawingDragging = true;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        this.requestRender();
        return;
      }
      this.deselect();
      this.requestRender();
      return;
    }

    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging || this.selectedIdx < 0) return;
    const pos = this.getDragPosition(e.clientX, e.clientY);
    if (pos) {
      this.moveSelected(pos);
      this.requestRender();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.enabled) { this.isDragging = false; this.dragStartScreen = null; return; }

    if (this.isDragging && this.selectedIdx >= 0) {
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
        this.deselect();
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
    (window as any).__drawingDragging = false;
    this.dragStartScreen = null;
  };
}
