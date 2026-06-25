import * as pc from "playcanvas";
import { screenPickLas, createSphere, createLine, updateLineEntity } from "./drawing-utils";

/** 充电区域绘制配置项 */
export interface ChargingAreaDrawingOptions {
  /** 点击点 / 连线 / 框线颜色 */
  color?: pc.Color;
  /** 选中高亮颜色 */
  selectedColor?: pc.Color;
  /** 放点是否吸附点云，默认 true */
  snap?: boolean;
  /** 标记球缩放，默认 0.06 */
  sphereScale?: number;
  /** 线粗，默认 0.01 */
  lineThickness?: number;
  /** 默认高度（米），默认 1 */
  height?: number;
  /** 方向键平移步长（米），默认 0.1 */
  moveStep?: number;
  /** 点数量变化回调（0~3） */
  onChange?: (pointCount: number) => void;
}

const DEFAULTS = {
  color: new pc.Color(0.2, 0.6, 1),         // 蓝：充电区域
  selectedColor: new pc.Color(1, 0.9, 0.1), // 黄：选中
  snap: true,
  sphereScale: 0.06,
  lineThickness: 0.01,
  height: 1,
  moveStep: 0.1,
};

/** 立体矩形 12 条棱（底 0~3 / 顶 4~7） */
const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const HIGHLIGHT_THICKNESS = 0.025;
const CLICK_THRESHOLD = 3;

interface BoxState {
  verts: pc.Vec3[];   // 8 顶点
  lines: pc.Entity[]; // 12 棱，与 BOX_EDGES 一一对应
}

/**
 * 充电区域绘制（框架无关）
 *
 * - 依次点击 3 个点 p1/p2/p3 确定一个平面矩形（忽略高度，底面取 p1 的 Y），
 *   再向上拉伸默认 1m 生成立体矩形。
 * - 仅一个：再次进入绘制会先清空。
 * - 生成后点击选中（高亮），Delete 删除，方向键前后左右平移。
 */
export class ChargingAreaDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<ChargingAreaDrawingOptions, "onChange">> & Pick<ChargingAreaDrawingOptions, "onChange">;

  private points: pc.Vec3[] = [];
  private pointSpheres: pc.Entity[] = [];
  private clickLines: pc.Entity[] = [];
  private box: BoxState | null = null;

  private enabled = false;
  private selected = false;
  private highlightLines: pc.Entity[] = [];
  private dragStartScreen: { x: number; y: number } | null = null;

  constructor(
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
    options: ChargingAreaDrawingOptions = {},
  ) {
    this.app = app;
    this.camera = camera;
    this.requestRender = requestRender;
    this.entitiesRef = entitiesRef;
    this.gd = app.graphicsDevice;
    this.canvas = this.gd.canvas as HTMLCanvasElement;
    this.opts = { ...DEFAULTS, ...options };

    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("keydown", this.onKeyDown);
  }

  // ============ 对外 API ============

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) { this.dragStartScreen = null; this.deselect(); }
  }

  getPointCount(): number {
    return this.box ? 3 : this.points.length;
  }

  /** 撤销：有立体矩形则退回 2 点态，否则删最后一个点 */
  undo() {
    if (this.box) {
      this.destroyBox();
      // 退回到 2 点态（保留 p1/p2 及其连线）
      this.points = this.points.slice(0, 2);
      // 第 3 点球与第 2 条线在 buildBox 时已清，需按当前 points 重建
      this.rebuildPlacement();
    } else {
      this.pointSpheres.pop()?.destroy();
      this.points.pop();
      if (this.clickLines.length > Math.max(0, this.points.length - 1)) {
        this.clickLines.pop()?.destroy();
      }
    }
    this.emitChange();
    this.requestRender();
  }

  clear() {
    this.destroyBox();
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;
    this.points.length = 0;
    this.emitChange();
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
    this.destroyBox();
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;
    this.points.length = 0;
  }

  // ============ 内部 ============

  private emitChange() {
    this.opts.onChange?.(this.getPointCount());
  }

  /** 按当前 points 重建放点态的球与连线 */
  private rebuildPlacement() {
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres = this.points.map((p) => createSphere(this.app, p, this.opts.color, this.opts.sphereScale));
    this.clickLines = [];
    for (let i = 1; i < this.points.length; i++) {
      this.clickLines.push(createLine(this.app, this.points[i - 1], this.points[i], this.opts.color, this.opts.lineThickness));
    }
  }

  private placePoint(pos: pc.Vec3) {
    if (this.points.length >= 3) return;
    this.pointSpheres.push(createSphere(this.app, pos, this.opts.color, this.opts.sphereScale));
    if (this.points.length >= 1) {
      const prev = this.points[this.points.length - 1];
      this.clickLines.push(createLine(this.app, prev, pos, this.opts.color, this.opts.lineThickness));
    }
    this.points.push(pos.clone());
    if (this.points.length === 3) this.buildBox();
    this.emitChange();
  }

  /** 3 点 → 平面矩形（忽略高度）→ 拉伸成立体矩形 */
  private buildBox() {
    const baseY = Math.min(this.points[0].y, this.points[1].y, this.points[2].y);
    const p1 = new pc.Vec3(this.points[0].x, baseY, this.points[0].z);
    const p2 = new pc.Vec3(this.points[1].x, baseY, this.points[1].z);
    const p3 = new pc.Vec3(this.points[2].x, baseY, this.points[2].z);

    const dir1 = new pc.Vec3().sub2(p2, p1);
    if (dir1.length() < 1e-4) return;
    dir1.normalize();
    const normal = new pc.Vec3().cross(new pc.Vec3(0, 1, 0), dir1).normalize();
    const w = new pc.Vec3().sub2(p3, p1).dot(normal);
    const off = normal.clone().mulScalar(w);

    const c0 = p1.clone();
    const c1 = p2.clone();
    const c2 = new pc.Vec3().add2(p2, off);
    const c3 = new pc.Vec3().add2(p1, off);
    const up = new pc.Vec3(0, this.opts.height, 0);
    const verts = [
      c0, c1, c2, c3,
      new pc.Vec3().add2(c0, up),
      new pc.Vec3().add2(c1, up),
      new pc.Vec3().add2(c2, up),
      new pc.Vec3().add2(c3, up),
    ];

    // 清放点态实体，转为立体矩形
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;

    const lines = BOX_EDGES.map(([a, b]) =>
      createLine(this.app, verts[a], verts[b], this.opts.color, this.opts.lineThickness),
    );
    // 二次校准：entity add to root 后重设方向，避免首次渲染方向偏差（与移动时一致）
    lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, verts[a], verts[b], this.opts.lineThickness);
    });
    this.box = { verts, lines };
    this.requestRender();
  }

  private destroyBox() {
    if (this.box) {
      this.box.lines.forEach((e) => e.destroy());
      this.box = null;
    }
    this.deselect();
  }

  // ============ 选中 / 移动 ============

  private vpMatrix(): pc.Mat4 | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    return new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
  }

  private project(p: pc.Vec3, vp: pc.Mat4): { x: number; y: number } | null {
    const m = vp.data;
    const clipW = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (clipW <= 0) return null;
    const inv = 1 / clipW;
    return {
      x: (((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) * inv) * 0.5 + 0.5) * this.gd.width,
      y: (0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) * inv) * 0.5) * this.gd.height,
    };
  }

  /** 点击是否命中立体矩形（屏幕包围框） */
  private hitTestBox(sx: number, sy: number): boolean {
    if (!this.box) return false;
    const vp = this.vpMatrix();
    if (!vp) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of this.box.verts) {
      const sp = this.project(v, vp);
      if (!sp) return false;
      if (sp.x < minX) minX = sp.x; if (sp.x > maxX) maxX = sp.x;
      if (sp.y < minY) minY = sp.y; if (sp.y > maxY) maxY = sp.y;
    }
    return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
  }

  private select() {
    if (!this.box || this.selected) return;
    this.highlightLines = BOX_EDGES.map(([a, b]) =>
      createLine(this.app, this.box!.verts[a], this.box!.verts[b], this.opts.selectedColor, HIGHLIGHT_THICKNESS),
    );
    this.selected = true;
    this.requestRender();
  }

  private deselect() {
    this.highlightLines.forEach((e) => e.destroy());
    this.highlightLines.length = 0;
    this.selected = false;
  }

  /** 平移立体矩形 */
  private moveBox(dx: number, dy: number, dz: number) {
    if (!this.box) return;
    const d = new pc.Vec3(dx, dy, dz);
    this.box.verts.forEach((v) => v.add(d));
    this.box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, this.box!.verts[a], this.box!.verts[b], this.opts.lineThickness);
    });
    this.highlightLines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, this.box!.verts[a], this.box!.verts[b], HIGHLIGHT_THICKNESS);
    });
    this.requestRender();
  }

  // ============ 事件 ============

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled || e.button !== 0) return;
    if ((window as any).__clipDragging || (window as any).__drawingDragging) return;
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.enabled || e.button !== 0 || !this.dragStartScreen) { this.dragStartScreen = null; return; }
    const moved = Math.hypot(e.clientX - this.dragStartScreen.x, e.clientY - this.dragStartScreen.y);
    this.dragStartScreen = null;
    if (moved > CLICK_THRESHOLD) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = Math.round(e.clientX - rect.left);
    const sy = Math.round(e.clientY - rect.top);

    if (this.box) {
      if (this.hitTestBox(sx, sy)) this.select();
      else this.deselect();
      this.requestRender();
      return;
    }

    if (this.points.length >= 3) return;
    const hit = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
    if (hit) {
      this.placePoint(hit.point);
      this.requestRender();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || !this.selected || !this.box) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.destroyBox();
      this.emitChange();
      this.requestRender();
      return;
    }
    const s = this.opts.moveStep;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); this.moveBox(0, 0, -s); break;
      case "ArrowDown": e.preventDefault(); this.moveBox(0, 0, s); break;
      case "ArrowLeft": e.preventDefault(); this.moveBox(-s, 0, 0); break;
      case "ArrowRight": e.preventDefault(); this.moveBox(s, 0, 0); break;
    }
  };
}
