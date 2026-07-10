import * as pc from "playcanvas";
import {
  screenPickLas,
  createSphere,
  createLine,
  updateLineEntity,
  hitTestBoxVolume,
  pointToSegmentDistSq,
  claimSpaceEditClick,
  isSpaceEditClickClaimedByOther,
} from "./drawing-utils";

export interface DeviceAreaDrawingOptions {
  color?: pc.Color;
  snap?: boolean;
  sphereScale?: number;
  lineThickness?: number;
  height?: number;
  moveStep?: number;
  onChange?: (boxCount: number) => void;
  onSelectChange?: (boxId: string | null) => void;
  /** 框被删除时回调 */
  onDelete?: () => void | Promise<void>;
  /** 几何和绑定变更历史记录回调 */
  onHistory?: (before: DeviceAreaDrawingSnapshot, after: DeviceAreaDrawingSnapshot, label: string) => void;
  /** 选中框高度变化回调 */
  onHeightChange?: (height: number) => void;
}

const DEFAULTS = {
  color: new pc.Color(0.2, 0.6, 1),
  snap: true,
  sphereScale: 0.06,
  lineThickness: 0.01,
  height: 2,
  moveStep: 0.1,
};

const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const HIGHLIGHT_THICKNESS = 0.025;
const CLICK_THRESHOLD = 3;
const EDGE_HIT_DISTANCE_SQ = 144;
const BOX_HIT_TOLERANCE = 1.03;
const LABEL_COLOR = "#3399ff";
const CLICK_CLAIM_OWNER = "device-area";

interface BoxInfo {
  id: string;
  verts: pc.Vec3[];
  lines: pc.Entity[];
  selected: boolean;
  height: number;
  /** 绑定的间隔信息 */
  bay: { id: number; name: string; code: string } | null;
  labelEl: HTMLDivElement | null;
}

export interface DeviceAreaBoxSnapshot {
  id: string;
  verts: number[][];
  selected: boolean;
  height: number;
  bay: { id: number; name: string; code: string } | null;
}

export interface DeviceAreaDrawingSnapshot {
  points: number[][];
  boxes: DeviceAreaBoxSnapshot[];
}

/**
 * 设备区绘制（框架无关）
 *
 * - 支持多个立体矩形，每个矩形可绑定一个间隔 bay；
 * - 三点确定底面矩形，再按 height 拉伸出顶部；
 * - 选中后可调高度、绑定/解绑间隔、Delete 删除；
 * - DOM 标签显示绑定间隔名称，未绑定时提示“未绑定”。
 *
 * 该类只管理编辑态几何和标签，重复绑定校验、保存、树刷新由上层 hook 处理。
 */
export class DeviceAreaDrawing {
  private app: pc.Application;
  private camera: pc.Entity;
  private requestRender: () => void;
  private entitiesRef: { current: Map<string, pc.Entity> };
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private opts: Required<Omit<DeviceAreaDrawingOptions, "onChange" | "onSelectChange" | "onDelete" | "onHistory" | "onHeightChange">> & Pick<DeviceAreaDrawingOptions, "onChange" | "onSelectChange" | "onDelete" | "onHistory" | "onHeightChange">;

  // points/clickLines 是当前正在放置的临时 3 点；boxes 是已经成体的设备区集合。
  private points: pc.Vec3[] = [];
  private pointSpheres: pc.Entity[] = [];
  private clickLines: pc.Entity[] = [];
  private boxes: BoxInfo[] = [];

  private enabled = false;
  private dragStartScreen: { x: number; y: number } | null = null;
  private labelContainer: HTMLDivElement | null = null;
  private labelRafId = 0;
  private groundY = -Infinity;

  constructor(
    app: pc.Application,
    camera: pc.Entity,
    requestRender: () => void,
    entitiesRef: { current: Map<string, pc.Entity> },
    options: DeviceAreaDrawingOptions = {},
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

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) { this.dragStartScreen = null; this.deselectAll(); }
    this.updateAllLabelVisibility();
  }

  setGroundY(y: number) { this.groundY = y; }

  setHistoryCallback(fn: DeviceAreaDrawingOptions["onHistory"]) {
    this.opts.onHistory = fn;
  }

  getSnapshot(): DeviceAreaDrawingSnapshot {
    return {
      points: this.points.map((v) => [v.x, v.y, v.z]),
      boxes: this.boxes.map((b) => ({
        id: b.id,
        verts: b.verts.map((v) => [v.x, v.y, v.z]),
        selected: b.selected,
        height: b.height,
        bay: b.bay ? { ...b.bay } : null,
      })),
    };
  }

  restoreSnapshot(snapshot: DeviceAreaDrawingSnapshot) {
    this.destroyBoxes();
    this.clearPlacement();
    this.points = snapshot.points.map((v) => new pc.Vec3(v[0], v[1], v[2]));
    this.rebuildPlacement();

    let selectedBox: BoxInfo | null = null;
    for (const item of snapshot.boxes) {
      if (item.verts.length !== 8) continue;
      const box = this.createBoxFromData({
        id: item.id,
        verts: item.verts,
        height: item.height,
        bay: item.bay,
      });
      if (box) {
        this.boxes.push(box);
        if (item.selected) selectedBox = box;
      }
    }
    if (selectedBox) this.selectBox(selectedBox);
    else this.opts.onSelectChange?.(null);
    if (selectedBox) this.opts.onHeightChange?.(selectedBox.height);
    this.emitChange();
    this.requestRender();
  }

  /** 动态修改选中框的高度 */
  setHeight(h: number) {
    if (h <= 0) return;
    const box = this.boxes.find((b) => b.selected);
    if (!box) return;
    const before = this.getSnapshot();
    box.height = h;
    const v = box.verts;
    const baseY = (v[0].y + v[1].y + v[2].y + v[3].y) / 4;
    // 高度变化只影响顶部点，避免改变底面吸附到点云后的占地范围。
    for (let i = 4; i < 8; i++) v[i].y = baseY + h;
    const thickness = box.selected ? HIGHLIGHT_THICKNESS : this.opts.lineThickness;
    box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, v[a], v[b], thickness);
    });
    this.requestRender();
    this.opts.onHeightChange?.(h);
    this.recordHistory("调整设备区高度", before);
  }

  /** 获取选中框的高度 */
  getSelectedBoxHeight(): number | null {
    const box = this.boxes.find((b) => b.selected);
    return box ? box.height : null;
  }

  setOnSelectChange(fn: (boxId: string | null) => void) {
    const prev = this.opts.onSelectChange;
    this.opts.onSelectChange = prev
      ? (boxId: string | null) => { prev(boxId); fn(boxId); }
      : fn;
  }

  getBoxCount(): number { return this.boxes.length; }

  hasAnyData(): boolean {
    return this.points.length > 0 || this.boxes.length > 0;
  }

  getSelectedBoxId(): string | null {
    return this.boxes.find((b) => b.selected)?.id ?? null;
  }

  getSelectedBoxBay(): { id: number; name: string; code: string } | null {
    return this.boxes.find((b) => b.selected)?.bay ?? null;
  }

  /** 绑定间隔到选中的框 */
  bindBayToSelected(bay: { id: number; name: string; code: string }) {
    const box = this.boxes.find((b) => b.selected);
    if (!box) return;
    const before = this.getSnapshot();
    box.bay = bay;
    this.updateBoxLabel(box);
    this.opts.onSelectChange?.(box.id);
    this.recordHistory("绑定设备区间隔", before);
  }

  /** 解绑选中框的间隔 */
  unbindSelected() {
    const box = this.boxes.find((b) => b.selected);
    if (!box) return;
    const before = this.getSnapshot();
    box.bay = null;
    this.updateBoxLabel(box);
    this.opts.onSelectChange?.(box.id);
    this.recordHistory("解绑设备区间隔", before);
  }

  /** 获取所有已绑定的间隔 ID（用于校验重复） */
  getBoundBayIds(): number[] {
    return this.boxes.filter((b) => b.bay).map((b) => b.bay!.id);
  }

  /** 获取所有框数据（供保存） */
  getBoxDatas(): { id: string; verts: number[][]; height: number; bay: { id: number; name: string; code: string } | null }[] {
    return this.boxes.map((b) => ({
      id: b.id,
      verts: b.verts.map((v) => [v.x, v.y, v.z]),
      height: b.height,
      bay: b.bay ? { ...b.bay } : null,
    }));
  }

  /** 从已保存数据恢复框 */
  loadBoxes(datas: { id: string; verts: number[][]; height?: number; bay: { id: number; name: string; code: string } | null }[]) {
    // 回显时整体重建 boxes，避免旧实体残留；保存的 8 顶点是权威几何。
    this.clearAll();
    for (const d of datas) {
      const box = this.createBoxFromData(d);
      if (box) this.boxes.push(box);
    }
    this.emitChange();
    this.requestRender();
  }

  undo() {
    if (this.points.length > 0) {
      this.pointSpheres.pop()?.destroy();
      this.points.pop();
      if (this.clickLines.length > Math.max(0, this.points.length - 1)) {
        this.clickLines.pop()?.destroy();
      }
    } else if (this.boxes.length > 0) {
      const box = this.boxes.pop()!;
      box.lines.forEach((e) => e.destroy());
      box.labelEl?.remove();
    }
    this.emitChange();
    this.requestRender();
  }

  clearAll() {
    this.destroyBoxes();
    this.clearPlacement();
    this.emitChange();
    this.requestRender();
  }

  destroy() {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("keydown", this.onKeyDown);
    this.clearAll();
    this.destroyLabels();
  }

  private emitChange() { this.opts.onChange?.(this.boxes.length); }

  private recordHistory(label: string, before: DeviceAreaDrawingSnapshot | null) {
    if (!before) return;
    this.opts.onHistory?.(before, this.getSnapshot(), label);
  }

  private clearPlacement() {
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.length = 0;
    this.pointSpheres.length = 0;
    this.points.length = 0;
  }

  private rebuildPlacement() {
    this.pointSpheres.forEach((e) => e.destroy());
    this.clickLines.forEach((e) => e.destroy());
    this.pointSpheres = this.points.map((p) => createSphere(this.app, p, this.opts.color, this.opts.sphereScale));
    this.clickLines = [];
    for (let i = 1; i < this.points.length; i++) {
      this.clickLines.push(createLine(this.app, this.points[i - 1], this.points[i], this.opts.color, this.opts.lineThickness));
    }
  }

  private destroyBoxes() {
    for (const box of this.boxes) {
      box.lines.forEach((e) => e.destroy());
      box.labelEl?.remove();
    }
    this.boxes.length = 0;
    this.opts.onSelectChange?.(null);
  }

  private removeBoxAt(idx: number) {
    const box = this.boxes[idx];
    if (!box) return;
    box.lines.forEach((e) => e.destroy());
    box.labelEl?.remove();
    this.boxes.splice(idx, 1);
  }

  private createBoxFromData(data: { id?: string; verts: number[][]; height?: number; bay: { id: number; name: string; code: string } | null }): BoxInfo | null {
    if (data.verts.length !== 8) return null;
    const vs = data.verts.map((v) => new pc.Vec3(v[0], v[1], v[2]));
    const id = data.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const h = data.height || this.opts.height;
    const lines = BOX_EDGES.map(([a, b]) =>
      createLine(this.app, vs[a], vs[b], this.opts.color, this.opts.lineThickness),
    );
    lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, vs[a], vs[b], this.opts.lineThickness);
    });
    const labelEl = this.createLabelEl();
    const box: BoxInfo = { id, verts: vs, lines, selected: false, height: h, bay: data.bay, labelEl };
    this.updateBoxLabel(box);
    return box;
  }

  private placePoint(pos: pc.Vec3) {
    if (this.points.length >= 3) return;
    const before = this.getSnapshot();
    this.pointSpheres.push(createSphere(this.app, pos, this.opts.color, this.opts.sphereScale));
    if (this.points.length >= 1) {
      const prev = this.points[this.points.length - 1];
      this.clickLines.push(createLine(this.app, prev, pos, this.opts.color, this.opts.lineThickness));
    }
    this.points.push(pos.clone());
    if (this.points.length === 3) {
      // 三点完成后立即成盒，并清掉临时点/线，后续操作都围绕 boxes 集合。
      this.buildBox();
      this.clearPlacement();
    }
    this.emitChange();
    this.recordHistory("绘制设备区点", before);
  }

  private buildBox() {
    // 底面高度优先使用点云估算地面 Y，保证设备区贴地；没有地面估算时回退到三点最低值。
    const baseY = this.groundY !== -Infinity
      ? this.groundY
      : Math.min(this.points[0].y, this.points[1].y, this.points[2].y);
    const p1 = new pc.Vec3(this.points[0].x, baseY, this.points[0].z);
    const p2 = new pc.Vec3(this.points[1].x, baseY, this.points[1].z);
    const p3 = new pc.Vec3(this.points[2].x, baseY, this.points[2].z);

    const edge1 = new pc.Vec3().sub2(p2, p1);
    if (edge1.length() < 1e-4) return;
    const edge2 = new pc.Vec3().sub2(p3, p2);
    if (edge2.length() < 1e-4) return;

    // 设备区保留 p1->p2 和 p2->p3 两条边方向，适合用户按设备区边界连续点三点。
    const c0 = p1.clone();
    const c1 = p2.clone();
    const c2 = p3.clone();
    const c3 = new pc.Vec3().add2(p1, edge2);

    const up = new pc.Vec3(0, this.opts.height, 0);
    const verts = [
      c0, c1, c2, c3,
      new pc.Vec3().add2(c0, up),
      new pc.Vec3().add2(c1, up),
      new pc.Vec3().add2(c2, up),
      new pc.Vec3().add2(c3, up),
    ];

    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const lines = BOX_EDGES.map(([a, b]) =>
      createLine(this.app, verts[a], verts[b], this.opts.color, this.opts.lineThickness),
    );
    lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, verts[a], verts[b], this.opts.lineThickness);
    });

    const labelEl = this.createLabelEl();
    const box: BoxInfo = { id, verts: [...verts], lines, selected: false, height: this.opts.height, bay: null, labelEl };
    this.updateBoxLabel(box);
    this.boxes.push(box);
    this.selectBox(box);
    this.requestRender();
  }

  /** 删除选中的框 */
  private deleteSelected() {
    const idx = this.boxes.findIndex((b) => b.selected);
    if (idx < 0) return;
    const before = this.getSnapshot();
    this.removeBoxAt(idx);
    this.opts.onSelectChange?.(null);
    this.opts.onDelete?.();
    this.emitChange();
    this.requestRender();
    this.recordHistory("删除设备区", before);
  }

  // ========== 选中 ==========

  private selectBox(box: BoxInfo) {
    if (box.selected) return;
    this.deselectAll();
    box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      // 线段是 box 实体缩放出来的，选中态通过重新计算线段厚度实现高亮。
      updateLineEntity(line, box.verts[a], box.verts[b], HIGHLIGHT_THICKNESS);
    });
    box.selected = true;
    this.opts.onSelectChange?.(box.id);
    this.requestRender();
  }

  deselectAll() {
    for (const box of this.boxes) {
      if (!box.selected) continue;
      box.lines.forEach((line, i) => {
        const [a, b] = BOX_EDGES[i];
        updateLineEntity(line, box.verts[a], box.verts[b], this.opts.lineThickness);
      });
      box.selected = false;
    }
  }

  // ========== 移动 ==========

  private moveSelected(dx: number, dy: number, dz: number) {
    const box = this.boxes.find((b) => b.selected);
    if (!box) return;
    const before = this.getSnapshot();
    const d = new pc.Vec3(dx, dy, dz);
    // 方向键移动是整体平移 8 个顶点，不重新吸附点云，避免误改变用户框出的区域。
    box.verts.forEach((v) => v.add(d));
    const thickness = box.selected ? HIGHLIGHT_THICKNESS : this.opts.lineThickness;
    box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      updateLineEntity(line, box.verts[a], box.verts[b], thickness);
    });
    this.requestRender();
    this.recordHistory("移动设备区", before);
  }

  private getBoxTopCenter(box: BoxInfo): pc.Vec3 {
    const v = box.verts;
    return new pc.Vec3(
      (v[4].x + v[5].x + v[6].x + v[7].x) / 4,
      (v[4].y + v[5].y + v[6].y + v[7].y) / 4,
      (v[4].z + v[5].z + v[6].z + v[7].z) / 4,
    );
  }

  // ========== 标签 ==========

  private createLabelEl(): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;transform:translate(-50%,-105%);" +
      `color:${LABEL_COLOR};font-size:16px;font-weight:700;white-space:nowrap;` +
      "text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;display:none;";
    this.labelContainer?.appendChild(el);
    return el;
  }

  private updateBoxLabel(box: BoxInfo) {
    if (!box.labelEl) return;
    box.labelEl.textContent = box.bay ? box.bay.name : "未绑定";
    const visible = this.labelContainer && box.labelEl.parentElement;
    if (visible) box.labelEl.style.display = "block";
  }

  private updateAllLabelVisibility() {
    for (const box of this.boxes) {
      if (box.labelEl) box.labelEl.style.display = (this.labelContainer && box.labelEl.parentElement) ? "block" : "none";
    }
  }

  private initLabels() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const c = document.createElement("div");
    c.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:15;";
    parent.appendChild(c);
    this.labelContainer = c;
    const loop = () => {
      this.updateAllLabels();
      this.labelRafId = requestAnimationFrame(loop);
    };
    this.labelRafId = requestAnimationFrame(loop);
  }

  private updateAllLabels() {
    if (!this.labelContainer) return;
    const camComp = this.camera.camera;
    if (!camComp) return;
    const viewMat = this.camera.getWorldTransform().clone().invert();
    const vp = new pc.Mat4().mul2(camComp.projectionMatrix, viewMat);
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.gd.width > 0 ? rect.width / this.gd.width : 1;
    const scaleY = this.gd.height > 0 ? rect.height / this.gd.height : 1;

    for (const box of this.boxes) {
      if (!box.labelEl || !box.labelEl.parentElement) continue;
      const tc = this.getBoxTopCenter(box);
      const sp = this.project(tc, vp);
      if (!sp) { box.labelEl.style.display = "none"; continue; }
      box.labelEl.style.left = `${sp.x * scaleX}px`;
      box.labelEl.style.top = `${sp.y * scaleY}px`;
    }
  }

  private destroyLabels() {
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    this.labelContainer?.remove();
    this.labelContainer = null;
  }

  // ========== 投影/命中 ==========

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

  private hitTestBox(box: BoxInfo, sx: number, sy: number): number | null {
    const volumeHit = hitTestBoxVolume(this.camera, this.canvas, box.verts, sx, sy, BOX_HIT_TOLERANCE);
    if (volumeHit !== null) return volumeHit;
    const vp = this.vpMatrix();
    if (!vp) return null;
    const screenVerts = box.verts.map((v) => this.project(v, vp));
    if (screenVerts.some((p) => !p)) return null;
    for (const [a, b] of BOX_EDGES) {
      const pa = screenVerts[a]!;
      const pb = screenVerts[b]!;
      if (pointToSegmentDistSq(sx, sy, pa.x, pa.y, pb.x, pb.y) <= EDGE_HIT_DISTANCE_SQ) return Infinity;
    }
    return null;
  }

  private hitTestAny(sx: number, sy: number): BoxInfo | null {
    let bestBox: BoxInfo | null = null;
    let bestT = Infinity;
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const t = this.hitTestBox(this.boxes[i], sx, sy);
      if (t !== null && t <= bestT) {
        bestBox = this.boxes[i];
        bestT = t;
      }
    }
    return bestBox;
  }

  // ========== 事件 ==========

  private canHandlePointer(): boolean {
    if (this.enabled) return true;
    const mode = (window as any).__spaceEditInteractionMode;
    return !mode || mode === "idle";
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.canHandlePointer()) return;
    if (e.button !== 0) return;
    if ((window as any).__clipDragging || (window as any).__drawingDragging) return;
    if (!this.enabled && this.boxes.length === 0) return;
    this.dragStartScreen = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !this.dragStartScreen) { this.dragStartScreen = null; return; }
    if ((window as any).__clipDragging || (window as any).__drawingDragging || isSpaceEditClickClaimedByOther(CLICK_CLAIM_OWNER)) {
      this.dragStartScreen = null;
      return;
    }
    const moved = Math.hypot(e.clientX - this.dragStartScreen.x, e.clientY - this.dragStartScreen.y);
    this.dragStartScreen = null;
    if (moved > CLICK_THRESHOLD) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = Math.round(e.clientX - rect.left);
    const sy = Math.round(e.clientY - rect.top);

    const hit = this.hitTestAny(sx, sy);
    if (hit) {
      this.selectBox(hit);
      claimSpaceEditClick(CLICK_CLAIM_OWNER);
      return;
    }

    if (!this.enabled) return;
    const picked = screenPickLas(this.gd, this.camera, sx, sy, this.entitiesRef.current);
    if (picked) {
      this.placePoint(picked.point);
      this.requestRender();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const selectedBox = this.boxes.find((b) => b.selected);
    if (!selectedBox) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    const s = this.opts.moveStep;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); this.moveSelected(0, 0, -s); break;
      case "ArrowDown": e.preventDefault(); this.moveSelected(0, 0, s); break;
      case "ArrowLeft": e.preventDefault(); this.moveSelected(-s, 0, 0); break;
      case "ArrowRight": e.preventDefault(); this.moveSelected(s, 0, 0); break;
    }
  };
}
