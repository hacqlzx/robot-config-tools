import * as pc from "playcanvas";
import {
  screenPickLas,
  worldToScreen,
  setSphereColor,
  updateLineEntity,
  createSphere,
  createLine,
} from "./drawing-utils";

/** 折线绘制配置项 */
export interface PolylineDrawingOptions {
  /** 普通顶点颜色 */
  pointColor?: pc.Color;
  /** 选中顶点颜色 */
  selectedColor?: pc.Color;
  /** 连线颜色 */
  lineColor?: pc.Color;
  /** 是否闭合（首尾相连，设备区/区域类用），默认 false */
  closed?: boolean;
  /** 放点/拖拽结束后是否吸附到点云最近点，默认 true */
  snap?: boolean;
  /** 顶点球体缩放，默认 0.15 */
  sphereScale?: number;
  /** 顶点数据变化时回调（放点/移动/清空） */
  onChange?: (points: pc.Vec3[]) => void;
}

/** 默认配置 */
const DEFAULTS = {
  pointColor: new pc.Color(1, 0.4, 0.2),     // 橙
  selectedColor: new pc.Color(0.2, 0.8, 1),  // 青
  lineColor: new pc.Color(1, 0.8, 0.1),      // 黄
  closed: false,
  snap: true,
  sphereScale: 0.15,
};

const CLICK_THRESHOLD = 3;

/**
 * 折线点编辑器（框架无关）
 *
 * 通用的「放点 / 连线 / 选中拖拽 / 吸附点云」交互内核，
 * 供绘制屏柜、绘制设备区、可行路径等功能复用，差异通过 options 配置。
 *
 * - 点击点云：放置一个顶点，相邻顶点自动连线
 * - 点击已有顶点：选中（变色），可拖拽移动；松手吸附到最近点云点
 * - closed=true 时首尾相连成闭合区域
 */
export class PolylineDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<PolylineDrawingOptions, "onChange">> & Pick<PolylineDrawingOptions, "onChange">;

  /** 顶点世界坐标 */
  private points: pc.Vec3[] = [];
  /** 顶点对应球体 */
  private spheres: pc.Entity[] = [];
  /** 连线：lines[i] 连接 points[i] -> points[i+1]（开放段） */
  private lines: pc.Entity[] = [];
  /** 闭合线：连接 points[last] -> points[0]（仅 closed 且点数>=3 时存在） */
  private closingLine: pc.Entity | null = null;

  private enabled = false;
  private selectedIdx = -1;
  private isDragging = false;
  private dragStartScreen: { x: number; y: number } | null = null;

  constructor(
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
    options: PolylineDrawingOptions = {},
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

  /** 启用/禁用绘制交互 */
  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) this.cancelDrag();
  }

  /** 获取当前顶点（拷贝） */
  getPoints(): pc.Vec3[] {
    return this.points.map((p) => p.clone());
  }

  /** 清空所有顶点与连线 */
  clear() {
    this.spheres.forEach((e) => e.destroy());
    this.lines.forEach((e) => e.destroy());
    this.closingLine?.destroy();
    this.spheres.length = 0;
    this.lines.length = 0;
    this.points.length = 0;
    this.closingLine = null;
    this.selectedIdx = -1;
    this.isDragging = false;
    this.emitChange();
    this.requestRender();
  }

  /** 销毁：解绑事件并清理实体 */
  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mouseleave", this.cancelDrag);
    document.removeEventListener("mouseleave", this.cancelDrag);
    window.removeEventListener("blur", this.cancelDrag);
    this.spheres.forEach((e) => e.destroy());
    this.lines.forEach((e) => e.destroy());
    this.closingLine?.destroy();
    this.spheres.length = 0;
    this.lines.length = 0;
    this.points.length = 0;
    this.closingLine = null;
  }

  // ============ 内部逻辑 ============

  private emitChange() {
    this.opts.onChange?.(this.getPoints());
  }

  /** 命中测试：返回点击位置 10px 半径内最近的顶点索引，无则 -1 */
  private hitTestSphere(sx: number, sy: number): number {
    const camComp = this.camera.camera;
    if (!camComp || this.points.length === 0) return -1;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vpMat = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    let bestIdx = -1;
    let bestD2 = 100; // 10px 半径
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
  }

  /** 拖拽落点：射线与当前顶点所在水平面(Y)求交 */
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

  /** 更新某顶点参与的所有连线（含闭合线） */
  private updateAdjacentLines(idx: number) {
    const n = this.points.length;
    if (idx > 0) updateLineEntity(this.lines[idx - 1], this.points[idx - 1], this.points[idx]);
    if (idx < this.lines.length) updateLineEntity(this.lines[idx], this.points[idx], this.points[idx + 1]);
    if (this.closingLine && (idx === 0 || idx === n - 1)) {
      updateLineEntity(this.closingLine, this.points[n - 1], this.points[0]);
    }
  }

  /** 移动选中顶点（拖拽中，不吸附） */
  private moveSelected(pos: pc.Vec3) {
    if (this.selectedIdx < 0) return;
    this.points[this.selectedIdx] = pos.clone();
    this.spheres[this.selectedIdx].setLocalPosition(pos);
    this.updateAdjacentLines(this.selectedIdx);
    this.emitChange();
  }

  /** 放置新顶点 */
  private placePoint(pos: pc.Vec3) {
    const sphere = createSphere(this.app, pos, this.opts.pointColor, this.opts.sphereScale);
    this.spheres.push(sphere);
    if (this.points.length > 0) {
      const prev = this.points[this.points.length - 1];
      this.lines.push(createLine(this.app, prev, pos, this.opts.lineColor));
    }
    this.points.push(pos.clone());
    this.updateClosingLine();
    this.emitChange();
  }

  /** 维护闭合线（仅 closed 且点数>=3 时存在） */
  private updateClosingLine() {
    if (!this.opts.closed) return;
    const n = this.points.length;
    if (n >= 3) {
      if (!this.closingLine) {
        this.closingLine = createLine(this.app, this.points[n - 1], this.points[0], this.opts.lineColor);
      } else {
        updateLineEntity(this.closingLine, this.points[n - 1], this.points[0]);
      }
    } else if (this.closingLine) {
      this.closingLine.destroy();
      this.closingLine = null;
    }
  }

  // ============ 事件处理 ============

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if ((window as any).__clipDragging) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // 先检测是否命中已有顶点
    const hitIdx = this.hitTestSphere(sx, sy);
    if (hitIdx >= 0) {
      this.select(hitIdx);
      this.isDragging = true;
      (window as any).__drawingDragging = true;
      this.dragStartScreen = { x: e.clientX, y: e.clientY };
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
      // 拖拽结束，吸附到最近 LAS 点
      this.isDragging = false;
      (window as any).__drawingDragging = false;
      if (this.opts.snap) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = Math.round(e.clientX - rect.left);
        const sy = Math.round(e.clientY - rect.top);
        const snap = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
        if (snap) this.moveSelected(snap.point);
      }
      // 保持选中状态，允许再次拖拽
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    // 点击（非拖拽）
    if (this.dragStartScreen) {
      const dx = e.clientX - this.dragStartScreen.x;
      const dy = e.clientY - this.dragStartScreen.y;
      if (Math.sqrt(dx * dx + dy * dy) <= CLICK_THRESHOLD) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = Math.round(e.clientX - rect.left);
        const sy = Math.round(e.clientY - rect.top);
        const hitResult = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
        if (hitResult) this.placePoint(hitResult.point);
        // 点击空白取消选中
        if (this.selectedIdx >= 0) this.deselect();
        this.requestRender();
      }
    }

    this.dragStartScreen = null;
  };

  /** 鼠标离开窗口或失焦时取消拖拽 */
  private cancelDrag = () => {
    this.isDragging = false;
    (window as any).__drawingDragging = false;
    this.dragStartScreen = null;
  };
}
