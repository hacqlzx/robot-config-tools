import * as pc from "playcanvas";
import {
  screenPickLas,
  worldToScreen,
  pointToSegmentDistSq,
  setSphereColor,
  setLineColor,
  createSphere,
  createLine,
  claimSpaceEditClick,
  hasSpaceEditClickClaim,
} from "./drawing-utils";
import type { PathData, PathPoint, PathSegment } from "./drawing-schema";

// 路径数据类型已集中到纯协议模块；这里继续重新导出，兼容历史上从 PathDrawing 引用类型的调用方。
export type { PathData, PathPoint, PathSegment } from "./drawing-schema";

export interface PathDrawingOptions {
  pointColor?: pc.Color;
  selectedColor?: pc.Color;
  lineColor?: pc.Color;
  cpColor?: pc.Color;
  lineThickness?: number;
  snap?: boolean;
  sphereScale?: number;
  cpScale?: number;
  onChange?: (data: PathData) => void;
  onSelectChange?: (selected: boolean) => void;
  onHistory?: (before: PathDrawingSnapshot, after: PathDrawingSnapshot, label: string) => void;
}

export interface PathDrawingSnapshot {
  data: PathData;
  selectedPointId: string | null;
  selectedPathId: string | null;
  lastConnectedPointId: string | null;
}

const DEFAULTS = {
  pointColor: new pc.Color(0.62, 0.9, 0.58),
  selectedColor: new pc.Color(1, 0.85, 0.1),
  lineColor: new pc.Color(0.62, 0.9, 0.58),
  cpColor: new pc.Color(0.5, 0.6, 1.0),
  lineThickness: 0.025,
  snap: true,
  sphereScale: 0.08,
  cpScale: 0.08,
};

const CURVE_SEGMENTS = 16;

const CLICK_THRESHOLD = 3;
const CLICK_CLAIM_OWNER = "path";
const POINT_LABEL_COLOR = "#9be58f";
const ROBOT_PATH_COLOR = new pc.Color(0.08, 0.72, 0.32);
const ROBOT_CURVE_PATH_COLOR = new pc.Color(0.95, 0.66, 0.12);
const ROBOT_POINT_COLOR = new pc.Color(0.18, 0.78, 0.38);
const ROBOT_LABEL_COLOR = "#34c76b";
const ROBOT_PATH_THICKNESS = 0.07;
const ROBOT_POINT_SCALE = 0.11;
const ROBOT_TOPO_POINT_COLOR = new pc.Color(0.76, 0.78, 0.82);
const ROBOT_TOPO_POINT_SCALE = 0.065;

interface ReadonlyPathRender {
  points: pc.Vec3[];
  spheres: pc.Entity[];
  lines: pc.Entity[];
  labels: (HTMLDivElement | null)[];
}

interface RobotPointStyle {
  color: pc.Color;
  scale: number;
  labelColor: string;
}

function robotPointStyle(point: PathPoint, defaultStyle: RobotPointStyle): RobotPointStyle | null {
  if (point.role === "waypoint") return null;
  switch (point.robotType) {
    case "4":
      return { color: ROBOT_TOPO_POINT_COLOR, scale: ROBOT_TOPO_POINT_SCALE, labelColor: "#c7ccd4" };
    case "5":
      return { color: defaultStyle.color, scale: defaultStyle.scale * 1.2, labelColor: defaultStyle.labelColor };
    default:
      return defaultStyle;
  }
}

function robotSegmentColor(segment: PathSegment, defaultColor: pc.Color): pc.Color {
  return segment.bezier ? ROBOT_CURVE_PATH_COLOR : defaultColor;
}

let _idCounter = 0;
function genId(): string {
  return `${Date.now().toString(36)}_${(_idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function isOldPathData(data: any): data is { points: number[][]; connections: [number, number][] } {
  // 早期路径格式只有点数组和 connections 下标；新格式改为稳定 id，便于编辑和重排。
  if (!data) return false;
  const pt = data.points?.[0];
  return Array.isArray(pt) && typeof pt[0] === "number";
}

/**
 * 可行路径绘制（框架无关）
 *
 * - 激活状态：点击生成点，相邻点自动连线；点到已有点时追加连线（不分叉不创建新点）
 * - 非激活状态：可选中点并拖拽移动；无法放置新点
 * - 选中路径后可通过控制点编辑贝塞尔曲线；保存时保留 cp1/cp2。
 *
 * 路径点仍吸附到当前点云，移动点时也可重新吸附，保证路径落在模型表面附近。
 */
export class PathDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<PathDrawingOptions, "onChange" | "onSelectChange" | "onHistory">> & Pick<PathDrawingOptions, "onChange" | "onSelectChange" | "onHistory">;

  private points: pc.Vec3[] = [];
  private pointIds: string[] = [];
  private pointNames: (string | undefined)[] = [];
  private spheres: pc.Entity[] = [];
  private pointLabels: (HTMLDivElement | null)[] = [];
  // connections 保存点数组下标；pointIds/pathIds 是持久化用的稳定 id。
  private connections: [number, number][] = [];
  private pathIds: string[] = [];
  // null 表示直线；有 cp1/cp2 时按三次贝塞尔曲线渲染。
  private bezierParams: ({ cp1: [number, number, number]; cp2: [number, number, number] } | null)[] = [];
  private lines: pc.Entity[] = [];
  private cpSpheres: { cp1: pc.Entity | null; cp2: pc.Entity | null }[] = [];
  private curveSegs: pc.Entity[][] = [];
  private robotPathRenders = new Map<string, ReadonlyPathRender>();

  private enabled = false;
  private active = false;
  private selectedPointIdx = -1;
  private selectedPathIdx = -1;
  private lastConnectedIdx = -1;
  private isDragging = false;
  private pendingPathSelectIdx = -1;
  private cpDragging: { pathIdx: number; which: 1 | 2 } | null = null;
  private dragStartScreen: { x: number; y: number } | null = null;
  private pointDragBeforeSnapshot: PathDrawingSnapshot | null = null;
  private cpDragBeforeSnapshot: PathDrawingSnapshot | null = null;
  private labelContainer: HTMLDivElement | null = null;
  private labelRafId = 0;

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
    window.addEventListener("mouseup", this.onMouseUp, true);
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("mouseleave", this.cancelDrag);
    document.addEventListener("mouseleave", this.cancelDrag);
    window.addEventListener("blur", this.cancelDrag);
    this.initLabels();
  }

  // ============ 对外 API ============

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.cancelDrag();
  }

  setHistoryCallback(fn: PathDrawingOptions["onHistory"]) {
    this.opts.onHistory = fn;
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
        ...(this.pointNames[i] ? { name: this.pointNames[i] } : {}),
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

  getSnapshot(): PathDrawingSnapshot {
    return {
      data: this.getData(),
      selectedPointId: this.selectedPointIdx >= 0 ? this.pointIds[this.selectedPointIdx] : null,
      selectedPathId: this.selectedPathIdx >= 0 ? this.pathIds[this.selectedPathIdx] : null,
      lastConnectedPointId: this.lastConnectedIdx >= 0 ? this.pointIds[this.lastConnectedIdx] : null,
    };
  }

  restoreSnapshot(snapshot: PathDrawingSnapshot) {
    this.loadData(snapshot.data);
    this.lastConnectedIdx = snapshot.lastConnectedPointId ? this.pointIds.indexOf(snapshot.lastConnectedPointId) : -1;
    const pointIdx = snapshot.selectedPointId ? this.pointIds.indexOf(snapshot.selectedPointId) : -1;
    const pathIdx = snapshot.selectedPathId ? this.pathIds.indexOf(snapshot.selectedPathId) : -1;
    if (pointIdx >= 0) this._selPoint(pointIdx);
    else if (pathIdx >= 0) this._selPath(pathIdx);
    else this._unselAll();
    this.requestRender();
  }

  loadData(data: PathData | { points: number[][]; connections: [number, number][] }) {
    // 加载保存数据时先清空实体和索引，再按格式重建点、线和控制点。
    this.clearEntities();
    this.points.length = 0;
    this.pointIds.length = 0;
    this.pointNames.length = 0;
    this.spheres.length = 0;
    this.pointLabels.length = 0;
    this.connections.length = 0;
    this.pathIds.length = 0;
    this.bezierParams.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
    this.lastConnectedIdx = -1;
    this.selectedPointIdx = -1;
    this.selectedPathIdx = -1;
    this.isDragging = false;
    this.cpDragging = null;
    this.pointDragBeforeSnapshot = null;
    this.cpDragBeforeSnapshot = null;

    if (isOldPathData(data)) {
      // 旧格式没有稳定 id，加载时临时生成，保存后会转成新格式。
      for (const [x, y, z] of data.points) {
        const pos = new pc.Vec3(x, y, z);
        this.points.push(pos);
        this.pointIds.push(genId());
        this.pointNames.push(undefined);
        this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
        this.pointLabels.push(null);
      }
      for (const [from, to] of data.connections) {
        this.addConnectionInternal(from, to);
      }
    } else {
      // 新格式按 id 建立索引映射，避免点顺序变化后路径连错。
      const indexMap = new Map<string, number>();
      for (const pt of data.points) {
        const idx = this.points.length;
        const pos = new pc.Vec3(pt.x, pt.y, pt.z);
        this.points.push(pos);
        this.pointIds.push(pt.id);
        this.pointNames.push(pt.name);
        this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
        this.pointLabels.push(pt.name ? this.createPointLabel(pt.name) : null);
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

  loadRobotPathData(key: string, data: PathData) {
    this.clearRobotPathData(key);
    const render = this.createReadonlyPathRender(data, {
      lineColor: ROBOT_PATH_COLOR,
      pointColor: ROBOT_POINT_COLOR,
      labelColor: ROBOT_LABEL_COLOR,
      lineThickness: ROBOT_PATH_THICKNESS,
      pointScale: ROBOT_POINT_SCALE,
    });
    this.robotPathRenders.set(key, render);
    this.requestRender();
  }

  clearRobotPathData(key: string) {
    const render = this.robotPathRenders.get(key);
    if (!render) return;
    this.destroyReadonlyPathRender(render);
    this.robotPathRenders.delete(key);
    this.requestRender();
  }

  clearRobotPathDataAll() {
    for (const render of this.robotPathRenders.values()) {
      this.destroyReadonlyPathRender(render);
    }
    this.robotPathRenders.clear();
    this.requestRender();
  }

  clearAllPathData() {
    this.clear();
    this.clearRobotPathDataAll();
  }

  clear() {
    this.clearEntities();
    this.points.length = 0;
    this.pointIds.length = 0;
    this.pointNames.length = 0;
    this.spheres.length = 0;
    this.pointLabels.length = 0;
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
    this.pointLabels[idx]?.remove();
    this.points.splice(idx, 1);
    this.pointIds.splice(idx, 1);
    this.pointNames.splice(idx, 1);
    this.spheres.splice(idx, 1);
    this.pointLabels.splice(idx, 1);
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
    window.removeEventListener("mouseup", this.onMouseUp, true);
    window.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("mouseleave", this.cancelDrag);
    document.removeEventListener("mouseleave", this.cancelDrag);
    window.removeEventListener("blur", this.cancelDrag);
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    this.clearEntities();
    this.clearRobotPathDataAll();
    this.labelContainer?.remove();
    this.labelContainer = null;
    this.points.length = 0;
    this.pointIds.length = 0;
    this.pointNames.length = 0;
    this.spheres.length = 0;
    this.pointLabels.length = 0;
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
    this.pointLabels.forEach((el) => el?.remove());
    this.lines.forEach((e) => e.destroy());
    this.cpSpheres.forEach((cs) => { cs.cp1?.destroy(); cs.cp2?.destroy(); });
    this.curveSegs.forEach((segs) => segs.forEach((e) => e.destroy()));
    this.spheres.length = 0;
    this.pointLabels.length = 0;
    this.lines.length = 0;
    this.cpSpheres.length = 0;
    this.curveSegs.length = 0;
  }

  private createReadonlyPathRender(
    data: PathData,
    style: {
      lineColor: pc.Color;
      pointColor: pc.Color;
      labelColor: string;
      lineThickness: number;
      pointScale: number;
    },
  ): ReadonlyPathRender {
    const points: pc.Vec3[] = [];
    const spheres: pc.Entity[] = [];
    const lines: pc.Entity[] = [];
    const labels: (HTMLDivElement | null)[] = [];
    const indexMap = new Map<string, number>();
    const defaultPointStyle = {
      color: style.pointColor,
      scale: style.pointScale,
      labelColor: style.labelColor,
    };

    for (const point of data.points) {
      const pos = new pc.Vec3(point.x, point.y, point.z);
      indexMap.set(point.id, points.length);
      points.push(pos);
      const pointStyle = robotPointStyle(point, defaultPointStyle);
      if (pointStyle) {
        spheres.push(createSphere(this.app, pos, pointStyle.color, pointStyle.scale));
      }
      labels.push(pointStyle && point.name ? this.createPointLabel(point.name, pointStyle.labelColor) : null);
    }

    for (const segment of data.paths) {
      const fromIndex = indexMap.get(segment.from);
      const toIndex = indexMap.get(segment.to);
      if (fromIndex === undefined || toIndex === undefined) continue;
      const from = points[fromIndex];
      const to = points[toIndex];
      const lineColor = robotSegmentColor(segment, style.lineColor);
      if (segment.bezier) {
        let prev = from;
        const cp1 = new pc.Vec3(segment.bezier.cp1[0], segment.bezier.cp1[1], segment.bezier.cp1[2]);
        const cp2 = new pc.Vec3(segment.bezier.cp2[0], segment.bezier.cp2[1], segment.bezier.cp2[2]);
        for (let step = 1; step <= CURVE_SEGMENTS; step++) {
          const point = PathDrawing.bezierPoint(step / CURVE_SEGMENTS, from, cp1, cp2, to);
          lines.push(createLine(this.app, prev, point, lineColor, style.lineThickness));
          prev = point;
        }
      } else {
        lines.push(createLine(this.app, from, to, lineColor, style.lineThickness));
      }
    }

    return { points, spheres, lines, labels };
  }

  private destroyReadonlyPathRender(render: ReadonlyPathRender) {
    render.spheres.forEach((entity) => entity.destroy());
    render.lines.forEach((entity) => entity.destroy());
    render.labels.forEach((label) => label?.remove());
    render.points.length = 0;
    render.spheres.length = 0;
    render.lines.length = 0;
    render.labels.length = 0;
  }

  private initLabels() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const style = window.getComputedStyle(parent);
    if (style.position === "static") parent.style.position = "relative";
    const container = document.createElement("div");
    container.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:16;";
    parent.appendChild(container);
    this.labelContainer = container;
    const loop = () => {
      this.updateLabels();
      this.labelRafId = requestAnimationFrame(loop);
    };
    this.labelRafId = requestAnimationFrame(loop);
  }

  private createPointLabel(name: string, color = POINT_LABEL_COLOR): HTMLDivElement | null {
    if (!this.labelContainer) return null;
    const el = document.createElement("div");
    el.textContent = name;
    el.style.cssText = "position:absolute;transform:translate(-50%,-145%);" +
      `color:${color};font-size:16px;font-weight:700;white-space:nowrap;` +
      "text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;display:none;";
    this.labelContainer.appendChild(el);
    return el;
  }

  private updateLabels() {
    if (!this.labelContainer) return;
    const camComp = this.camera.camera;
    if (!camComp) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    const updateLabel = (label: HTMLDivElement | null, point: pc.Vec3 | undefined) => {
      if (!label || !point) return;
      const sp = worldToScreen(point, vpMat, rect.width, rect.height);
      if (!sp) {
        label.style.display = "none";
        return;
      }
      label.style.left = `${sp.sx}px`;
      label.style.top = `${sp.sy}px`;
      label.style.display = "block";
    };

    for (let index = 0; index < this.pointLabels.length; index++) {
      updateLabel(this.pointLabels[index], this.points[index]);
    }
    for (const render of this.robotPathRenders.values()) {
      for (let index = 0; index < render.labels.length; index++) {
        updateLabel(render.labels[index], render.points[index]);
      }
    }
  }

  private emitChange() {
    this.opts.onChange?.(this.getData());
  }

  private recordHistory(label: string, before: PathDrawingSnapshot | null) {
    if (!before) return;
    this.opts.onHistory?.(before, this.getSnapshot(), label);
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
    // 路径以多个短线段近似贝塞尔曲线。控制点变化或端点移动时，整条曲线重建最简单可靠。
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
      segs.push(createLine(this.app, prev, pt, color, this.opts.lineThickness));
      prev = pt;
    }
    this.curveSegs[i] = segs;
    // 旧代码部分地方仍按 lines[i] 找“路径实体”，这里保留第一个曲线段做兼容索引。
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
    // 控制点拖拽落在路径两端点中间高度的水平面上，避免控制点被拖到相机射线任意深度。
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
      // 命中测试在屏幕空间进行：先采样曲线，再算点击点到每段屏幕线段的距离。
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
    const before = this.getSnapshot();
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
    this.recordHistory("删除路径段", before);
  }

  /** 删除停靠点（同时删除前后关联路径） */
  private deletePoint(idx: number) {
    const before = this.getSnapshot();
    this.removeConnectionsForInner(idx);
    this.spheres[idx].destroy();
    this.pointLabels[idx]?.remove();
    this.points.splice(idx, 1);
    this.pointIds.splice(idx, 1);
    this.pointNames.splice(idx, 1);
    this.spheres.splice(idx, 1);
    this.pointLabels.splice(idx, 1);
    // 点数组删除后，所有大于 idx 的连接下标都要前移一位。
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
    this.recordHistory("删除路径点", before);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || this.active || !this.canHandlePointer()) return;
    if (e.key === "Delete") {
      if (this.selectedPathIdx >= 0) {
        this.deletePath(this.selectedPathIdx);
      } else if (this.selectedPointIdx >= 0) {
        this.deletePoint(this.selectedPointIdx);
      }
    }
  };

  private addConnectionInternal(
    from: number,
    to: number,
    id?: string,
    bezier?: { cp1: [number, number, number]; cp2: [number, number, number] } | null,
  ) {
    if (from === to) return;
    // 示意路径允许往复重叠；是否能保存为单条无分支序列由持久化层校验。
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
    // 拖动路径点时保持原高度平面，鼠标抬起后再按需吸附到点云最近点。
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
    this.pointNames.push(undefined);
    this.spheres.push(createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale));
    this.pointLabels.push(null);
    if (this.lastConnectedIdx >= 0) {
      // 放置模式下，新点会自动和上一个放置/连接的点连线，形成连续路径。
      this.addConnectionInternal(this.lastConnectedIdx, idx);
    }
    this.lastConnectedIdx = idx;
  }

  // ============ 事件处理 ============

  private canHandlePointer(): boolean {
    const mode = (window as any).__spaceEditInteractionMode;
    return !mode || mode === "idle" || mode === "path";
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (!this.canHandlePointer()) return;
    if (e.button !== 0) return;
    if ((window as any).__clipDragging || hasSpaceEditClickClaim()) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!this.active) {
      const hitCp = this.hitTestCp(sx, sy);
      if (hitCp) {
        this.cpDragging = hitCp;
        this.cpDragBeforeSnapshot = this.getSnapshot();
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
        this.pendingPathSelectIdx = -1;
        this.pointDragBeforeSnapshot = this.getSnapshot();
        (window as any).__drawingDragging = true;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        this.requestRender();
        return;
      }
      if (hitLn >= 0) {
        this.pendingPathSelectIdx = hitLn;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        return;
      }
      this._unselAll();
      this.pendingPathSelectIdx = -1;
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
      this.recordHistory("调整路径曲线", this.cpDragBeforeSnapshot);
      this.cpDragBeforeSnapshot = null;
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
      this.recordHistory("移动路径点", this.pointDragBeforeSnapshot);
      this.pointDragBeforeSnapshot = null;
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    if (!this.dragStartScreen) return;
    const dx = e.clientX - this.dragStartScreen.x;
    const dy = e.clientY - this.dragStartScreen.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
      this.pendingPathSelectIdx = -1;
      this.dragStartScreen = null;
      (window as any).__drawingDragging = false;
      return;
    }

    if (!this.active && this.pendingPathSelectIdx >= 0) {
      this._selPath(this.pendingPathSelectIdx);
      claimSpaceEditClick(CLICK_CLAIM_OWNER);
      this.pendingPathSelectIdx = -1;
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    if (this.active) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = Math.round(e.clientX - rect.left);
      const sy = Math.round(e.clientY - rect.top);

      const hitIdx = this.hitTestSphere(sx, sy);
      if (hitIdx >= 0 && hitIdx !== this.lastConnectedIdx) {
        const before = this.getSnapshot();
        if (this.lastConnectedIdx >= 0) {
          this.addConnection(this.lastConnectedIdx, hitIdx);
        }
        this.lastConnectedIdx = hitIdx;
        this._unselAll();
        claimSpaceEditClick(CLICK_CLAIM_OWNER);
        this.requestRender();
        this.recordHistory("连接路径点", before);
        this.dragStartScreen = null;
        return;
      }

      const hitResult = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
      if (hitResult) {
        const before = this.getSnapshot();
        this.placePoint(hitResult.point);
        this.requestRender();
        this.recordHistory("绘制路径点", before);
      }
    }

    this.dragStartScreen = null;
    (window as any).__drawingDragging = false;
  };

  private cancelDrag = () => {
    this.recordHistory("移动路径点", this.pointDragBeforeSnapshot);
    this.recordHistory("调整路径曲线", this.cpDragBeforeSnapshot);
    this.isDragging = false;
    this.pendingPathSelectIdx = -1;
    this.cpDragging = null;
    this.pointDragBeforeSnapshot = null;
    this.cpDragBeforeSnapshot = null;
    (window as any).__drawingDragging = false;
    this.dragStartScreen = null;
  };
}
