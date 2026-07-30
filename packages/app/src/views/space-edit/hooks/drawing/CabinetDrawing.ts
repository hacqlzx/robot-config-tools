import * as pc from "playcanvas";
import {
  screenPickLas,
  createSphere,
  createLine,
  updateLineEntity,
  setSphereColor,
  buildOrthogonalCabinetVertsFromPosePoints,
} from "./drawing-utils";

/** 屏柜绘制配置项 */
export interface CabinetDrawingOptions {
  /** 用户点击的角点 / 点击连线颜色（红） */
  clickColor?: pc.Color;
  /** 自动补全的顶点 / 棱线颜色（绿） */
  edgeColor?: pc.Color;
  /** 选中顶点高亮颜色（青） */
  selectedColor?: pc.Color;
  /** 放点是否吸附到点云最近点，默认 true */
  snap?: boolean;
  /** 顶点标记球缩放，默认 0.06 */
  sphereScale?: number;
  /** 连线粗细，默认 0.01 */
  lineThickness?: number;
  /** 角点数量变化时回调（0~4） */
  onChange?: (cornerCount: number) => void;
  /** 屏柜数量变化时回调（成体后 = 分隔数 + 1，未成体为 0） */
  onCabinetCountChange?: (count: number) => void;
  /** 几何变更历史记录回调 */
  onHistory?: (before: CabinetDrawingSnapshot, after: CabinetDrawingSnapshot, label: string) => void;
}

const DEFAULTS = {
  clickColor: new pc.Color(1, 0.1, 0.1),     // 红：用户点击
  edgeColor: new pc.Color(0.2, 1, 0.3),      // 绿：自动补全
  selectedColor: new pc.Color(0.2, 0.8, 1),  // 青：选中高亮
  snap: true,
  sphereScale: 0.06,
  lineThickness: 0.01,
};

/**
 * 立方体顶点索引约定（由 4 个点击角点推导）：
 *   0 前左下(P1) 1 前右下(P2) 2 前右上(P3) 3 前左上
 *   4 后左下     5 后右下     6 后右上(P4) 7 后左上
 */
const RED_VERTS = new Set([0, 1, 2, 6]);
const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [3, 7],
];

interface CubeEdge { a: number; b: number; entity: pc.Entity; }
interface CubeState {
  verts: pc.Vec3[];
  spheres: pc.Entity[];
  edges: CubeEdge[];
}
/** 一个分隔面：沿前底边参数 t，含 1 红 + 3 绿顶点球与 4 条绿棱 */
interface Split {
  t: number;
  spheres: pc.Entity[]; // [前底(红), 前顶, 后底, 后顶]
  edges: pc.Entity[];   // [前竖, 后竖, 底深, 顶深]
}

export interface CabinetDrawingSnapshot {
  corners: number[][];
  cube: { verts: number[][]; splits: number[] } | null;
}

/**
 * 屏柜绘制（框架无关）
 *
 * - 放点阶段：依次点击 前左下→前右下→前右上→后右上，相邻红点连红线。
 * - 集齐 4 点：推导 8 顶点（4 红 + 4 绿）框出立方体（3 红边 + 9 绿边），即 1 个屏柜。
 * - 成体后：拖拽 4 个红色协议顶点调整（绿色补点自动跟随）；点击最下方红线在该处插入分隔，
 *   屏柜左右一分为二（红分隔点 + 绿分隔面），每点一次屏柜数 +1。
 *
 * 这个类只管理几何交互和临时实体，不直接读写 JSON，也不关心点表/间隔业务。
 * 保存时由 useSaveHandlers 调 getGeometry() 取 8 顶点和 splits，再组装 CabinetItem。
 */
export class CabinetDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<CabinetDrawingOptions, "onChange" | "onCabinetCountChange" | "onHistory">> &
    Pick<CabinetDrawingOptions, "onChange" | "onCabinetCountChange" | "onHistory">;

  // 放点阶段（0~3 点）：还没形成完整立方体，只显示用户点击点和红色连线。
  private corners: pc.Vec3[] = [];
  private cornerSpheres: pc.Entity[] = [];
  private clickLines: pc.Entity[] = [];

  // 立方体阶段：cube 保存 8 顶点与 12 条棱，splits 保存内部屏柜分隔面。
  private cube: CubeState | null = null;
  private splits: Split[] = [];

  private enabled = false;
  private dragStartScreen: { x: number; y: number } | null = null;
  private selectedVert = -1;
  private isDragging = false;
  private dragBeforeSnapshot: CabinetDrawingSnapshot | null = null;
  private static readonly CLICK_THRESHOLD = 3;
  private static readonly EDGE_HIT_PX2 = 100; // 命中红线阈值 10px

  // 屏柜名称标签（HTML overlay，红色文字，随视角投影实时更新）
  private labelContainer: HTMLDivElement | null = null;
  private labelEls: HTMLDivElement[] = [];
  private cabinetNames: string[] = [];
  private labelRafId = 0;

  constructor(
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
    options: CabinetDrawingOptions = {},
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
    this.initLabels();
  }

  // ============ 对外 API ============

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) { this.dragStartScreen = null; this.isDragging = false; this.dragBeforeSnapshot = null; }
  }

  setHistoryCallback(fn: CabinetDrawingOptions["onHistory"]) {
    this.opts.onHistory = fn;
  }

  /** 设置各屏柜名称（用于框上方红色标签） */
  setCabinetNames(names: string[]) {
    this.cabinetNames = names || [];
    this.syncLabelEls();
  }

  getCornerCount(): number {
    return this.cube ? 4 : this.corners.length;
  }

  /** 获取立方体几何（8 顶点世界坐标 + 分隔参数），未成体返回 null */
  getGeometry(): { verts: number[][]; splits: number[] } | null {
    if (!this.cube) return null;
    return {
      verts: this.cube.verts.map((v) => [v.x, v.y, v.z]),
      splits: this.splits.map((s) => s.t),
    };
  }

  getSnapshot(): CabinetDrawingSnapshot {
    return {
      corners: this.corners.map((v) => [v.x, v.y, v.z]),
      cube: this.cube
        ? {
            verts: this.cube.verts.map((v) => [v.x, v.y, v.z]),
            splits: this.splits.map((s) => s.t),
          }
        : null,
    };
  }

  restoreSnapshot(snapshot: CabinetDrawingSnapshot) {
    this.destroySplits();
    this.destroyCube();
    this.clickLines.forEach((e) => e.destroy());
    this.cornerSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.cornerSpheres.length = 0;
    this.corners = snapshot.corners.map((v) => new pc.Vec3(v[0], v[1], v[2]));
    this.rebuildPlacement();
    if (snapshot.cube?.verts.length === 8) {
      this.buildCubeFromVerts(snapshot.cube.verts.map((v) => new pc.Vec3(v[0], v[1], v[2])));
      snapshot.cube.splits.forEach((t) => this.addSplitInternal(t));
    }
    this.emitChange();
    this.emitCabinetCount();
    this.requestRender();
  }

  /** 撤销：优先撤分隔 → 撤立方体 → 撤角点 */
  undo() {
    // 撤销顺序按用户最近创建的内容逆序执行：分隔面比立方体晚创建，优先撤分隔。
    if (this.splits.length > 0) {
      const s = this.splits.pop()!;
      s.spheres.forEach((e) => e.destroy());
      s.edges.forEach((e) => e.destroy());
      this.emitCabinetCount();
      this.requestRender();
      return;
    }
    if (this.cube) {
      // 从完整立方体退回 3 点态，方便用户重新选择第 4 点修正深度方向。
      const p1 = this.cube.verts[0].clone();
      const p2 = this.cube.verts[1].clone();
      const p3 = this.cube.verts[2].clone();
      this.destroyCube();
      this.corners = [p1, p2, p3];
      this.cornerSpheres = [
        createSphere(this.app, p1, this.opts.clickColor, this.opts.sphereScale),
        createSphere(this.app, p2, this.opts.clickColor, this.opts.sphereScale),
        createSphere(this.app, p3, this.opts.clickColor, this.opts.sphereScale),
      ];
      this.clickLines = [
        createLine(this.app, p1, p2, this.opts.clickColor, this.opts.lineThickness),
        createLine(this.app, p2, p3, this.opts.clickColor, this.opts.lineThickness),
      ];
    } else {
      this.cornerSpheres.pop()?.destroy();
      this.corners.pop();
      if (this.clickLines.length > Math.max(0, this.corners.length - 1)) {
        this.clickLines.pop()?.destroy();
      }
    }
    this.emitChange();
    this.emitCabinetCount();
    this.requestRender();
  }

  clear() {
    this.destroySplits();
    this.destroyCube();
    this.clickLines.forEach((e) => e.destroy());
    this.cornerSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.cornerSpheres.length = 0;
    this.corners.length = 0;
    this.emitChange();
    this.emitCabinetCount();
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    this.labelEls.forEach((el) => el.remove());
    this.labelEls.length = 0;
    this.labelContainer?.remove();
    this.labelContainer = null;
    this.destroySplits();
    this.destroyCube();
    this.clickLines.forEach((e) => e.destroy());
    this.cornerSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.cornerSpheres.length = 0;
    this.corners.length = 0;
  }

  // ============ 内部：通用 ============

  private emitChange() {
    this.opts.onChange?.(this.getCornerCount());
  }

  private emitCabinetCount() {
    this.opts.onCabinetCountChange?.(this.cube ? this.splits.length + 1 : 0);
  }

  private recordHistory(label: string, before: CabinetDrawingSnapshot | null) {
    if (!before) return;
    this.opts.onHistory?.(before, this.getSnapshot(), label);
  }

  private rebuildPlacement() {
    this.pointLikePlacementDestroy();
    this.cornerSpheres = this.corners.map((p) => createSphere(this.app, p, this.opts.clickColor, this.opts.sphereScale));
    this.clickLines = [];
    for (let i = 1; i < this.corners.length; i++) {
      this.clickLines.push(createLine(this.app, this.corners[i - 1], this.corners[i], this.opts.clickColor, this.opts.lineThickness));
    }
  }

  private pointLikePlacementDestroy() {
    this.clickLines.forEach((e) => e.destroy());
    this.cornerSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.cornerSpheres.length = 0;
  }

  private getVPMatrix(): pc.Mat4 | null {
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

  // ============ 内部：放点阶段 ============

  private placeCorner(pos: pc.Vec3) {
    if (this.corners.length >= 4) return;
    const before = this.getSnapshot();
    this.cornerSpheres.push(createSphere(this.app, pos, this.opts.clickColor, this.opts.sphereScale));
    if (this.corners.length >= 1) {
      const prev = this.corners[this.corners.length - 1];
      this.clickLines.push(createLine(this.app, prev, pos, this.opts.clickColor, this.opts.lineThickness));
    }
    this.corners.push(pos.clone());
    if (this.corners.length === 4 && !this.buildCube()) {
      this.cornerSpheres.pop()?.destroy();
      this.corners.pop();
      this.clickLines.pop()?.destroy();
    }
    this.emitChange();
    this.recordHistory("绘制屏柜角点", before);
  }

  // ============ 内部：立方体阶段 ============

  private buildCube(): boolean {
    const [p1, p2, p3, p4] = this.corners;
    const verts = buildOrthogonalCabinetVertsFromPosePoints(p1, p2, p3, p4);
    if (!verts) return false;
    this.corners = [verts[0].clone(), verts[1].clone(), verts[2].clone(), verts[6].clone()];

    this.buildCubeFromVerts(verts);
    return true;
  }

  private buildCubeFromVerts(vertsInput: pc.Vec3[]) {
    this.pointLikePlacementDestroy();
    this.corners.length = 0;
    const verts = vertsInput.map((v) => v.clone());
    const spheres = verts.map((v, i) =>
      createSphere(this.app, v, this.vertColor(i), this.opts.sphereScale),
    );
    const edges: CubeEdge[] = [];
    for (const [a, b] of RED_EDGES) {
      edges.push({ a, b, entity: createLine(this.app, verts[a], verts[b], this.opts.clickColor, this.opts.lineThickness) });
    }
    for (const [a, b] of GREEN_EDGES) {
      edges.push({ a, b, entity: createLine(this.app, verts[a], verts[b], this.opts.edgeColor, this.opts.lineThickness) });
    }

    this.cube = { verts, spheres, edges };
    this.selectedVert = -1;
    this.emitCabinetCount();
    this.requestRender();
  }

  private vertColor(i: number): pc.Color {
    return RED_VERTS.has(i) ? this.opts.clickColor : this.opts.edgeColor;
  }

  private destroyCube() {
    if (!this.cube) return;
    this.cube.spheres.forEach((e) => e.destroy());
    this.cube.edges.forEach((e) => e.entity.destroy());
    this.cube = null;
    this.selectedVert = -1;
    this.isDragging = false;
  }

  private hitTestVertex(sx: number, sy: number): number {
    if (!this.cube) return -1;
    const vp = this.getVPMatrix();
    if (!vp) return -1;
    let bestIdx = -1, bestD2 = 100;
    this.cube.verts.forEach((p, i) => {
      if (!RED_VERTS.has(i)) return;
      const s = this.projectScreen(p, vp);
      if (!s) return;
      const d2 = (s.x - sx) ** 2 + (s.y - sy) ** 2;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    });
    return bestIdx;
  }

  /** 命中"前底红线"返回沿边参数 t∈[0.05,0.95]，否则 null */
  private hitTestFrontBottomEdge(sx: number, sy: number): number | null {
    if (!this.cube) return null;
    const vp = this.getVPMatrix();
    if (!vp) return null;
    const s0 = this.projectScreen(this.cube.verts[0], vp);
    const s1 = this.projectScreen(this.cube.verts[1], vp);
    if (!s0 || !s1) return null;
    const dx = s1.x - s0.x, dy = s1.y - s0.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    // 屏幕距离判定是否命中红线
    const ts = Math.max(0, Math.min(1, ((sx - s0.x) * dx + (sy - s0.y) * dy) / len2));
    const px = s0.x + dx * ts, py = s0.y + dy * ts;
    if ((px - sx) ** 2 + (py - sy) ** 2 > CabinetDrawing.EDGE_HIT_PX2) return null;
    // 用点击射线与前底边线段求最近点，得到透视正确的世界参数 t
    const tw = this.rayEdgeParam(sx, sy, this.cube.verts[0], this.cube.verts[1]);
    const t = tw != null ? tw : ts;
    return Math.max(0.05, Math.min(0.95, t));
  }

  /**
   * 求点击射线与线段 A→B 的最近点在线段上的参数 t。
   * 透视无关：直接在世界空间求解，避免屏幕插值偏移。
   */
  private rayEdgeParam(sx: number, sy: number, A: pc.Vec3, B: pc.Vec3): number | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const o = this.camera.getPosition();
    const far = new pc.Vec3();
    camComp.screenToWorld(sx, sy, 0.5, far);
    const dRay = new pc.Vec3().sub2(far, o); // 射线方向（无需归一化）
    const v = new pc.Vec3().sub2(B, A);      // 线段方向
    const w0 = new pc.Vec3().sub2(o, A);
    const a = dRay.dot(dRay), b = dRay.dot(v), c = v.dot(v);
    const d = dRay.dot(w0), e = v.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-9) return null;
    return (a * e - b * d) / denom;
  }

  private selectVert(i: number) {
    this.deselectVert();
    if (this.cube && i >= 0) {
      setSphereColor(this.cube.spheres[i], this.opts.selectedColor);
      this.selectedVert = i;
    }
  }

  private deselectVert() {
    if (this.cube && this.selectedVert >= 0) {
      setSphereColor(this.cube.spheres[this.selectedVert], this.vertColor(this.selectedVert));
    }
    this.selectedVert = -1;
  }

  private getDragPosition(clientX: number, clientY: number): pc.Vec3 | null {
    if (!this.cube || this.selectedVert < 0) return null;
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const from = this.camera.getPosition();
    const to = new pc.Vec3();
    camComp.screenToWorld(clientX - rect.left, clientY - rect.top, 0.5, to);
    const dir = new pc.Vec3().sub2(to, from).normalize();
    const planeY = this.cube.verts[this.selectedVert].y;
    if (Math.abs(dir.y) < 0.0001) return null;
    const t = (planeY - from.y) / dir.y;
    if (t <= 0) return null;
    return new pc.Vec3().add2(from, dir.mulScalar(t));
  }

  private moveVertex(i: number, pos: pc.Vec3) {
    if (!this.cube) return;
    if (!RED_VERTS.has(i)) return;
    this.cube.verts[i] = pos.clone();
    this.rebuildDerivedVerts();
    this.cube.verts.forEach((p, idx) => this.cube!.spheres[idx].setLocalPosition(p));
    for (const e of this.cube.edges) {
      updateLineEntity(e.entity, this.cube.verts[e.a], this.cube.verts[e.b], this.opts.lineThickness);
    }
    this.refreshSplits();
  }

  private rebuildDerivedVerts() {
    if (!this.cube) return;
    const v = this.cube.verts;
    const corrected = buildOrthogonalCabinetVertsFromPosePoints(v[0], v[1], v[2], v[6]);
    if (!corrected) return;
    corrected.forEach((point, index) => { v[index] = point; });
  }

  // ============ 内部：分隔 ============

  /** 计算参数 t 处分隔面 4 个角（前底/前顶/后底/后顶） */
  private splitCorners(t: number): pc.Vec3[] {
    const v = this.cube!.verts;
    return [
      new pc.Vec3().lerp(v[0], v[1], t), // 前底（红）
      new pc.Vec3().lerp(v[3], v[2], t), // 前顶（绿）
      new pc.Vec3().lerp(v[4], v[5], t), // 后底（绿）
      new pc.Vec3().lerp(v[7], v[6], t), // 后顶（绿）
    ];
  }

  private addSplit(t: number) {
    const before = this.getSnapshot();
    this.addSplitInternal(t);
    this.recordHistory("新增屏柜分隔", before);
  }

  private addSplitInternal(t: number) {
    if (!this.cube) return;
    const c = this.splitCorners(t);
    const th = this.opts.lineThickness;
    const spheres = [
      createSphere(this.app, c[0], this.opts.clickColor, this.opts.sphereScale), // 前底红
      createSphere(this.app, c[1], this.opts.edgeColor, this.opts.sphereScale),
      createSphere(this.app, c[2], this.opts.edgeColor, this.opts.sphereScale),
      createSphere(this.app, c[3], this.opts.edgeColor, this.opts.sphereScale),
    ];
    const edges = [
      createLine(this.app, c[0], c[1], this.opts.edgeColor, th), // 前竖
      createLine(this.app, c[2], c[3], this.opts.edgeColor, th), // 后竖
      createLine(this.app, c[0], c[2], this.opts.edgeColor, th), // 底深
      createLine(this.app, c[1], c[3], this.opts.edgeColor, th), // 顶深
    ];
    this.splits.push({ t, spheres, edges });
    this.emitCabinetCount();
    this.requestRender();
  }

  /** 顶点移动后，按各分隔参数 t 重算分隔面位置 */
  private refreshSplits() {
    if (!this.cube) return;
    for (const s of this.splits) {
      const c = this.splitCorners(s.t);
      s.spheres.forEach((sph, i) => sph.setLocalPosition(c[i]));
      updateLineEntity(s.edges[0], c[0], c[1], this.opts.lineThickness);
      updateLineEntity(s.edges[1], c[2], c[3], this.opts.lineThickness);
      updateLineEntity(s.edges[2], c[0], c[2], this.opts.lineThickness);
      updateLineEntity(s.edges[3], c[1], c[3], this.opts.lineThickness);
    }
  }

  private destroySplits() {
    for (const s of this.splits) {
      s.spheres.forEach((e) => e.destroy());
      s.edges.forEach((e) => e.destroy());
    }
    this.splits.length = 0;
  }

  // ============ 内部：名称标签 ============

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

  /** 同步标签 DOM 元素数量到名称数量 */
  private syncLabelEls() {
    if (!this.labelContainer) return;
    const n = this.cabinetNames.length;
    while (this.labelEls.length < n) {
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;transform:translate(-50%,-105%);" +
        "color:#ff2a1a;font-size:18px;font-weight:700;white-space:nowrap;" +
        "text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;display:none;";
      this.labelContainer.appendChild(el);
      this.labelEls.push(el);
    }
    while (this.labelEls.length > n) {
      this.labelEls.pop()?.remove();
    }
  }

  /** 各屏柜顶部中心（按宽度方向分区，略向上偏移到框顶上方） */
  private getCabinetTopCenters(): pc.Vec3[] {
    if (!this.cube) return [];
    const v = this.cube.verts;
    const ts = [0, ...this.splits.map((s) => s.t).sort((a, b) => a - b), 1];
    const offset = new pc.Vec3().sub2(v[3], v[0]).mulScalar(0.04); // 沿高度方向略上抬
    const centers: pc.Vec3[] = [];
    for (let i = 0; i < ts.length - 1; i++) {
      const mt = (ts[i] + ts[i + 1]) / 2;
      const ft = new pc.Vec3().lerp(v[3], v[2], mt); // 前顶
      const bt = new pc.Vec3().lerp(v[7], v[6], mt); // 后顶
      centers.push(new pc.Vec3().add2(ft, bt).mulScalar(0.5).add(offset));
    }
    return centers;
  }

  /** 投影屏柜顶部中心到屏幕，更新标签位置与文本（每帧） */
  private updateLabels() {
    if (!this.labelContainer) return;
    if (!this.enabled || !this.cube) {
      this.labelEls.forEach((el) => (el.style.display = "none"));
      return;
    }
    const vp = this.getVPMatrix();
    const centers = this.getCabinetTopCenters();
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.gd.width > 0 ? rect.width / this.gd.width : 1;
    const scaleY = this.gd.height > 0 ? rect.height / this.gd.height : 1;
    this.labelEls.forEach((el, i) => {
      const name = this.cabinetNames[i];
      const center = centers[i];
      if (!vp || !center || name == null) { el.style.display = "none"; return; }
      const s = this.projectScreen(center, vp);
      if (!s) { el.style.display = "none"; return; }
      el.textContent = name;
      el.style.left = `${s.x * scaleX}px`;
      el.style.top = `${s.y * scaleY}px`;
      el.style.display = "block";
    });
  }

  // ============ 事件处理 ============

  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if ((window as any).__clipDragging || (window as any).__drawingDragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this.cube) {
      const hit = this.hitTestVertex(sx, sy);
      if (hit >= 0) {
        this.selectVert(hit);
        this.isDragging = true;
        this.dragBeforeSnapshot = this.getSnapshot();
        (window as any).__drawingDragging = true;
        this.dragStartScreen = { x: e.clientX, y: e.clientY };
        this.requestRender();
        return;
      }
    }
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.isDragging || this.selectedVert < 0) return;
    const pos = this.getDragPosition(e.clientX, e.clientY);
    if (pos) {
      this.moveVertex(this.selectedVert, pos);
      this.requestRender();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (!this.enabled) { this.isDragging = false; this.dragStartScreen = null; return; }

    // 拖拽顶点结束 → 吸附点云
    if (this.isDragging && this.selectedVert >= 0) {
      this.isDragging = false;
      (window as any).__drawingDragging = false;
      if (this.opts.snap) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = Math.round(e.clientX - rect.left);
        const sy = Math.round(e.clientY - rect.top);
        const snap = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
        if (snap) this.moveVertex(this.selectedVert, snap.point);
      }
      this.recordHistory("调整屏柜顶点", this.dragBeforeSnapshot);
      this.dragBeforeSnapshot = null;
      this.dragStartScreen = null;
      this.requestRender();
      return;
    }

    if (!this.dragStartScreen) return;
    const dx = e.clientX - this.dragStartScreen.x;
    const dy = e.clientY - this.dragStartScreen.y;
    this.dragStartScreen = null;
    if (Math.sqrt(dx * dx + dy * dy) > CabinetDrawing.CLICK_THRESHOLD) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = Math.round(e.clientX - rect.left);
    const sy = Math.round(e.clientY - rect.top);

    if (this.cube) {
      // 点击最下方红线 → 新增分隔；否则取消选中
      const t = this.hitTestFrontBottomEdge(sx, sy);
      if (t != null) this.addSplit(t);
      else this.deselectVert();
      this.requestRender();
      return;
    }

    // 放点态：点击点云放新角点
    if (this.corners.length >= 4) return;
    const hit = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
    if (hit) {
      this.placeCorner(hit.point);
      this.requestRender();
    }
  };
}
