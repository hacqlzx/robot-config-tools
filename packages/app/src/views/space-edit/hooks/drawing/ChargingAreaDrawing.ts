import * as pc from "playcanvas";
import { screenPickLas, createSphere, createLine, updateLineEntity } from "./drawing-utils";

/** 充电区域绘制配置项 */
export interface ChargingAreaDrawingOptions {
  /** 点击点 / 连线 / 框线颜色 */
  color?: pc.Color;
  /** 方向键平移步长（米），默认 0.1 */
  moveStep?: number;
  /** 放点是否吸附点云，默认 true */
  snap?: boolean;
  /** 标记球缩放，默认 0.06 */
  sphereScale?: number;
  /** 线粗，默认 0.01 */
  lineThickness?: number;
  /** 默认高度（米），默认 1 */
  height?: number;
  /** 点数量变化回调（0~3） */
  onChange?: (pointCount: number) => void;
  /** 选中状态变化回调 */
  onSelectChange?: (selected: boolean) => void;
  /** 框被删除时回调 */
  onDelete?: () => void;
}

const DEFAULTS = {
  color: new pc.Color(1, 0.55, 0.1),         // 橙：充电区域
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
 *
 * 与设备区不同，充电区域是单例；保存时会替换 JSON 中旧的 charging-area 记录。
 */
export class ChargingAreaDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<ChargingAreaDrawingOptions, "onChange" | "onSelectChange" | "onDelete">> & Pick<ChargingAreaDrawingOptions, "onChange" | "onSelectChange" | "onDelete">;

  /** 1 点无法确定水平面时使用模型地平面 Y，未设置则回退三点最低 Y */
  private groundY = -Infinity;

  private points: pc.Vec3[] = [];
  private pointSpheres: pc.Entity[] = [];
  private clickLines: pc.Entity[] = [];
  private box: BoxState | null = null;

  private enabled = false;
  private selected = false;
  private dragStartScreen: { x: number; y: number } | null = null;
  private labelContainer: HTMLDivElement | null = null;
  private labelEl: HTMLDivElement | null = null;
  private labelRafId = 0;

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
    this.canvas.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("keydown", this.onKeyDown);
    this.initLabels();
  }

  // ============ 对外 API ============

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) { this.dragStartScreen = null; this.deselect(); }
    if (this.labelEl) this.labelEl.style.display = this.box ? "block" : "none";
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

  hasBox(): boolean {
    return this.box !== null;
  }

  /** 获取当前矩形 8 顶点世界坐标（供保存） */
  getBoxVerts(): number[][] | null {
    if (!this.box) return null;
    return this.box.verts.map((v) => [v.x, v.y, v.z]);
  }

  /** 从已保存的顶点数据恢复矩形（供回显） */
  loadBox(verts: number[][]) {
    // 回显时直接使用保存的 8 顶点，不重新按 3 点推导，保证人工调整后的形状不漂移。
    if (verts.length !== 8) return;
    this.destroyBox();
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;
    this.points.length = 0;

    const vs = verts.map((v) => new pc.Vec3(v[0], v[1], v[2]));
    const lines = BOX_EDGES.map(([a, b]) =>
      createLine(this.app, vs[a], vs[b], this.opts.color, this.opts.lineThickness),
    );
    lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, vs[a], vs[b], this.opts.lineThickness);
    });
    this.box = { verts: vs, lines };
    if (this.labelEl) this.labelEl.style.display = "block";
    this.emitChange();
    this.requestRender();
  }

  /** 取消选中（供外部同步调用） */
  deselectBox() {
    this.deselect();
  }

  /** 设置模型地平面 Y（绘制时以此为底面基准） */
  setGroundY(y: number) {
    this.groundY = y;
  }

  /** 设置选择状态变化的回调 */
  setOnSelectChange(fn: (selected: boolean) => void) {
    this.opts.onSelectChange = fn;
  }

  /** 动态修改高度（已有框时直接调整顶部顶点） */
  setHeight(h: number) {
    if (!this.box || h <= 0) return;
    this.opts.height = h;
    const v = this.box.verts;
    const baseY = (v[0].y + v[1].y + v[2].y + v[3].y) / 4;
    // 只移动顶部 4 点，底面保持在原地；这样高度调整不会改变用户画出的占地区域。
    for (let i = 4; i < 8; i++) v[i].y = baseY + h;
    const thickness = this.selected ? HIGHLIGHT_THICKNESS : this.opts.lineThickness;
    this.box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, v[a], v[b], thickness);
    });
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
    this.destroyBox();
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;
    this.points.length = 0;
    this.destroyLabels();
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
    // 三点足够确定一个水平矩形：p1/p2 给出一条边，p3 决定另一侧宽度。
    if (this.points.length === 3) this.buildBox();
    this.emitChange();
  }

  /** 3 点 → 平面矩形（忽略高度）→ 拉伸成立体矩形 */
  private buildBox() {
    // 底面高度优先使用点云估算地面 Y，保证充电区贴地；没有地面估算时回退到三点最低值。
    const baseY = this.groundY !== -Infinity
      ? this.groundY
      : Math.min(this.points[0].y, this.points[1].y, this.points[2].y);
    const p1 = new pc.Vec3(this.points[0].x, baseY, this.points[0].z);
    const p2 = new pc.Vec3(this.points[1].x, baseY, this.points[1].z);
    const p3 = new pc.Vec3(this.points[2].x, baseY, this.points[2].z);

    const dir1 = new pc.Vec3().sub2(p2, p1);
    if (dir1.length() < 1e-4) return;
    dir1.normalize();
    // 通过第一条边的水平法线，把第三点投影成矩形宽度，避免用户第三点略歪导致平行四边形。
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
    if (this.labelEl) this.labelEl.style.display = "none";
  }

  // ============ 标签 overlay ============

  private getBoxTopCenter(): pc.Vec3 | null {
    if (!this.box) return null;
    const v = this.box.verts;
    const cx = (v[4].x + v[5].x + v[6].x + v[7].x) / 4;
    const cy = (v[4].y + v[5].y + v[6].y + v[7].y) / 4;
    const cz = (v[4].z + v[5].z + v[6].z + v[7].z) / 4;
    return new pc.Vec3(cx, cy, cz);
  }

  private initLabels() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const c = document.createElement("div");
    c.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:15;";
    parent.appendChild(c);
    this.labelContainer = c;

    const el = document.createElement("div");
    el.style.cssText = "position:absolute;transform:translate(-50%,-105%);" +
      "color:#ff8c00;font-size:18px;font-weight:700;white-space:nowrap;" +
      "text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;display:none;";
    el.textContent = "充电区域";
    c.appendChild(el);
    this.labelEl = el;

    const loop = () => {
      this.updateLabel();
      this.labelRafId = requestAnimationFrame(loop);
    };
    this.labelRafId = requestAnimationFrame(loop);
  }

  private updateLabel() {
    if (!this.labelEl || !this.box) return;
    const topCenter = this.getBoxTopCenter();
    if (!topCenter) { this.labelEl.style.display = "none"; return; }

    const camComp = this.camera.camera;
    if (!camComp) { this.labelEl.style.display = "none"; return; }
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vp = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    const sp = this.project(topCenter, vp);
    if (!sp) { this.labelEl.style.display = "none"; return; }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.gd.width > 0 ? rect.width / this.gd.width : 1;
    const scaleY = this.gd.height > 0 ? rect.height / this.gd.height : 1;
    this.labelEl.style.left = `${sp.x * scaleX}px`;
    this.labelEl.style.top = `${sp.y * scaleY}px`;
  }

  private destroyLabels() {
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    this.labelContainer?.remove();
    this.labelContainer = null;
    this.labelEl = null;
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
    this.box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, this.box!.verts[a], this.box!.verts[b], HIGHLIGHT_THICKNESS);
    });
    this.selected = true;
    this.opts.onSelectChange?.(true);
    this.requestRender();
  }

  private deselect() {
    if (!this.box) return;
    this.box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, this.box!.verts[a], this.box!.verts[b], this.opts.lineThickness);
    });
    this.selected = false;
  }

  /** 平移立体矩形 */
  private moveBox(dx: number, dy: number, dz: number) {
    if (!this.box) return;
    const d = new pc.Vec3(dx, dy, dz);
    this.box.verts.forEach((v) => v.add(d));
    const thickness = this.selected ? HIGHLIGHT_THICKNESS : this.opts.lineThickness;
    this.box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, this.box!.verts[a], this.box!.verts[b], thickness);
    });
    this.requestRender();
  }

  // ============ 事件 ============

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if ((window as any).__clipDragging || (window as any).__drawingDragging) return;
    if (!this.enabled && !this.box) return;
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !this.dragStartScreen) { this.dragStartScreen = null; return; }
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

    if (!this.enabled || this.points.length >= 3) return;
    const hit = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
    if (hit) {
      this.placePoint(hit.point);
      this.requestRender();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.selected || !this.box) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.destroyBox();
      this.opts.onDelete?.();
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
