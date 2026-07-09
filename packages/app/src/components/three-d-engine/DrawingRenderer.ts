import * as pc from "playcanvas";
import {
  isBoxRenderItem,
  isCabinetRenderItem,
  isDrawingItemsData,
  isPathPointObject,
  isPathRenderData,
  isRobotAreaList,
  drawingDataLasToScene,
  pointToTuple,
  robotAreasToDrawingItemsData,
  robotAreasToSceneDrawingItemsData,
  type BoxRenderItem,
  type CabinetRenderItem,
  type DrawingRenderData,
  type PathPointValue,
  type PathRenderData,
  type PathSegmentValue,
} from "./drawing-data";
import { electronFileSource, type FileSource } from "./file-source";
import { loadLasCoordinateTransform } from "./coordinate-transform";
import { createLine, createSphere, updateLineEntity } from "./render-primitives";

const RED = new pc.Color(1, 0.1, 0.1);
const GREEN = new pc.Color(0.2, 1, 0.3);
const PATH_COLOR = new pc.Color(0.3, 0.9, 0.4);
const CHARGING_COLOR = new pc.Color(1, 0.55, 0.1);
const DEVICE_COLOR = new pc.Color(0.2, 0.6, 1);
const DEVICE_LABEL_COLOR = "#3399ff";
const THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;
const CLICK_THRESHOLD = 8;
const PATH_THICKNESS = 0.05;
const PATH_SPHERE_SCALE = 0.12;

const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [3, 7],
];
const BOX_EDGES: [number, number][] = [...RED_EDGES, ...GREEN_EDGES];

function v3(arr: [number, number, number] | number[]): pc.Vec3 {
  return new pc.Vec3(arr[0], arr[1], arr[2]);
}

function cabinetTopCenters(verts: pc.Vec3[], splits: number[]): pc.Vec3[] {
  const ts = [0, ...[...splits].sort((a, b) => a - b), 1];
  const offset = new pc.Vec3().sub2(verts[3], verts[0]).mulScalar(0.04);
  return ts.slice(0, -1).map((_, i) => {
    const mt = (ts[i] + ts[i + 1]) / 2;
    const ft = new pc.Vec3().lerp(verts[3], verts[2], mt);
    const bt = new pc.Vec3().lerp(verts[7], verts[6], mt);
    return new pc.Vec3().add2(ft, bt).mulScalar(0.5).add(offset);
  });
}

function splitCorners(verts: pc.Vec3[], t: number): pc.Vec3[] {
  return [
    new pc.Vec3().lerp(verts[0], verts[1], t),
    new pc.Vec3().lerp(verts[3], verts[2], t),
    new pc.Vec3().lerp(verts[4], verts[5], t),
    new pc.Vec3().lerp(verts[7], verts[6], t),
  ];
}

interface LabelInfo {
  center: pc.Vec3;
  name: string;
  el: HTMLDivElement;
}

interface BoxItem {
  type: "device-area" | "charging-area";
  verts: pc.Vec3[];
  lines: pc.Entity[];
  label: LabelInfo;
  selected: boolean;
  bayId: number;
}

interface CabItem {
  bayId: number;
  verts: pc.Vec3[];
  lines: pc.Entity[];
  labelInfos: LabelInfo[];
  selected: boolean;
}

/**
 * 通用绘制渲染器 — 从 JSON 加载并只读展示屏柜 / 充电区域 / 设备区域 / 路径
 *
 * 支持点击选中 / 高亮，HTML 标签 overlay，不包含编辑交互能力。
 *
 * 注意：这里渲染的是已经保存好的几何数据，不参与 space-edit 的编辑状态机。
 * 如果后续要支持编辑，应放在 space-edit 专用 Drawing 类里，避免只读组件反向依赖业务页。
 */
export class DrawingRenderer {
  app: pc.Application;
  camera: pc.Entity;
  private requestRender: () => void;
  entities: pc.Entity[] = [];
  private boxes: BoxItem[] = [];
  private cabinets: CabItem[] = [];
  private pathEntities: pc.Entity[] = [];
  private labelContainer: HTMLDivElement | null = null;
  private labelRafId = 0;
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private downPos: { x: number; y: number } | null = null;
  private allLabels: LabelInfo[] = [];
  private fileSource: FileSource;
  onSelect?: (info: { type: "cabinet" | "device-area" | "charging-area"; bayId: number }) => void;

  constructor(app: pc.Application, camera: pc.Entity, requestRender: () => void, fileSource: FileSource = electronFileSource) {
    this.app = app;
    this.camera = camera;
    this.requestRender = requestRender;
    this.fileSource = fileSource;
    this.gd = app.graphicsDevice;
    this.canvas = this.gd.canvas as HTMLCanvasElement;
    this.initLabels();
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    this.canvas.addEventListener("mouseup", this.onMouseUp);
  }

  async loadJson(filePath: string) {
    // 文件读取走 FileSource，便于业务层替换读取方式；解析后的结构再交给 loadData 统一分发。
    const buf = await this.fileSource.readAll(filePath);
    const text = new TextDecoder("utf-8").decode(buf);
    const data = JSON.parse(text) as unknown;
    if (isRobotAreaList(data)) {
      const coordinate = await loadLasCoordinateTransform(this.fileSource, filePath);
      this.loadData(robotAreasToSceneDrawingItemsData(data, coordinate));
      return;
    }
    if (isPathRenderData(data) || isDrawingItemsData(data)) {
      const coordinate = await loadLasCoordinateTransform(this.fileSource, filePath);
      this.loadData(drawingDataLasToScene(data, coordinate));
      return;
    }
    this.loadData(data);
  }

  loadData(data: DrawingRenderData | unknown) {
    // 同一个地图目录下可能同时存在区域 JSON 和路径 JSON；按数据形状判断具体渲染入口。
    if (isPathRenderData(data)) {
      this.renderPaths(data);
    }
    if (isRobotAreaList(data)) {
      const converted = robotAreasToDrawingItemsData(data);
      for (const item of converted.items) {
        if (isCabinetRenderItem(item)) this.renderCabinet(item);
        else if (isBoxRenderItem(item)) this.renderBoxItem(item);
      }
      return;
    }
    if (isDrawingItemsData(data)) {
      for (const item of data.items) {
        if (isCabinetRenderItem(item)) this.renderCabinet(item);
        else if (isBoxRenderItem(item)) this.renderBoxItem(item);
      }
    }
  }

  clear() {
    this.deselectAll();
    for (const e of this.entities) this.app.root.removeChild(e);
    for (const l of this.allLabels) l.el.remove();
    this.entities = [];
    this.boxes = [];
    this.cabinets = [];
    this.pathEntities = [];
    this.allLabels = [];
  }

  destroy() {
    if (this.labelRafId) cancelAnimationFrame(this.labelRafId);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.clear();
    this.labelContainer?.remove();
    this.labelContainer = null;
  }

  // ====== 渲染 ======

  private renderCabinet(item: CabinetRenderItem) {
    const verts = item.geometry?.verts;
    if (!verts || verts.length < 8) return;
    const vs = verts.map(v3);
    // splits 是沿屏柜宽度方向的 0~1 分隔比例，用于把一个大柜体显示成多个屏柜标签。
    const splits: number[] = item.geometry?.splits || [];
    const cabinets = item.cabinets || [];
    const lines: pc.Entity[] = [];

    for (const [a, b] of RED_EDGES) {
      lines.push(createLine(this.app, vs[a], vs[b], RED, THICKNESS));
    }
    for (const [a, b] of GREEN_EDGES) {
      lines.push(createLine(this.app, vs[a], vs[b], GREEN, THICKNESS));
    }
    for (const t of splits) {
      const c = splitCorners(vs, t);
      for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]] as [number, number][]) {
        lines.push(createLine(this.app, c[a], c[b], GREEN, THICKNESS));
      }
    }

    // 标签放在每个分隔段顶部中心，稍微向前偏移，避免文字贴到柜体边线上。
    const centers = cabinetTopCenters(vs, splits);
    const labelInfos: LabelInfo[] = [];
    for (let i = 0; i < centers.length && i < cabinets.length; i++) {
      const el = this.createLabelEl();
      const li = { center: centers[i], name: cabinets[i].name, el };
      labelInfos.push(li);
      this.allLabels.push(li);
    }

    this.entities.push(...lines);
    this.cabinets.push({ bayId: item.bay?.id ?? 0, verts: vs, lines, labelInfos, selected: false });
  }

  private renderBoxItem(item: BoxRenderItem) {
    const verts = item.geometry?.verts;
    if (!verts || verts.length < 8) return;
    const vs = verts.map(v3);
    const isDevice = item.type === "device-area";
    const color = isDevice ? DEVICE_COLOR : CHARGING_COLOR;
    const lines: pc.Entity[] = [];
    for (const [a, b] of BOX_EDGES) {
      lines.push(createLine(this.app, vs[a], vs[b], color, THICKNESS));
    }

    // 设备区/充电区标签放在上表面中心。约定 4~7 是上表面四点，来自空间编辑保存格式。
    const cx = (vs[4].x + vs[5].x + vs[6].x + vs[7].x) / 4;
    const cy = (vs[4].y + vs[5].y + vs[6].y + vs[7].y) / 4;
    const cz = (vs[4].z + vs[5].z + vs[6].z + vs[7].z) / 4;
    const el = this.createLabelEl();
    el.style.color = isDevice ? DEVICE_LABEL_COLOR : "#ff8c00";
    const name = isDevice ? (item.name || item.bay?.name || "未绑定") : (item.name || "充电区域");
    const li = { center: new pc.Vec3(cx, cy, cz), name, el };
    this.allLabels.push(li);

    this.entities.push(...lines);
    this.boxes.push({ type: item.type, verts: vs, lines, label: li, selected: false, bayId: item.bay?.id ?? 0 });
  }

  private renderPaths(data: PathRenderData) {
    // 路径文件历史上有两种格式：数组下标连线、id 连线。这里统一转成 Vec3 + 可选 id。
    const points = data.points
      .map((pt) => this.toPathVertex(pt))
      .filter((pt): pt is { pos: pc.Vec3; id?: string | number } => !!pt);
    const pointById = new Map<string | number, pc.Vec3>();

    for (const pt of points) {
      if (pt.id !== undefined) pointById.set(pt.id, pt.pos);
      const p = pt.pos;
      const sphere = createSphere(this.app, p, PATH_COLOR, PATH_SPHERE_SCALE);
      this.entities.push(sphere);
      this.pathEntities.push(sphere);
    }
    for (const seg of data.paths) {
      const p1 = this.resolvePathPoint(seg, "start", "from", points, pointById);
      const p2 = this.resolvePathPoint(seg, "end", "to", points, pointById);
      if (!p1 || !p2) continue;
      const line = createLine(this.app, p1, p2, PATH_COLOR, PATH_THICKNESS);
      this.entities.push(line);
      this.pathEntities.push(line);
    }
  }

  private toPathVertex(point: PathPointValue): { pos: pc.Vec3; id?: string | number } | null {
    const tuple = pointToTuple(point);
    if (!tuple) return null;
    return {
      pos: v3(tuple),
      id: isPathPointObject(point) ? point.id : undefined,
    };
  }

  private resolvePathPoint(
    segment: PathSegmentValue,
    indexKey: "start" | "end",
    idKey: "from" | "to",
    points: { pos: pc.Vec3; id?: string | number }[],
    pointById: Map<string | number, pc.Vec3>,
  ): pc.Vec3 | null {
    // 优先兼容旧格式 start/end 下标，再兼容新格式 from/to id。
    const index = segment[indexKey];
    if (typeof index === "number" && points[index]) return points[index].pos;

    const id = segment[idKey];
    if (id !== undefined) return pointById.get(id) ?? null;

    return null;
  }

  // ====== 选中 ======

  private selectBox(box: BoxItem) {
    if (box.selected) return;
    this.deselectAll();
    box.lines.forEach((line, i) => {
      const [a, b] = BOX_EDGES[i];
      // box 选中时需要重建线段尺寸，因为线段是缩放后的 box，不是材质线宽。
      updateLineEntity(line, box.verts[a], box.verts[b], HIGHLIGHT_THICKNESS);
    });
    box.selected = true;
    this.requestRender();
  }

  private selectCabinet(cab: CabItem) {
    if (cab.selected) return;
    this.deselectAll();
    cab.lines.forEach((line) => {
      const s = line.getLocalScale();
      // 屏柜线段方向不变，只放大横截面厚度，保留原来的 z 轴长度。
      line.setLocalScale(HIGHLIGHT_THICKNESS, HIGHLIGHT_THICKNESS, s.z);
    });
    cab.selected = true;
    this.requestRender();
  }

  private deselectAll() {
    for (const box of this.boxes) {
      if (!box.selected) continue;
      box.lines.forEach((line, i) => {
        const [a, b] = BOX_EDGES[i];
        updateLineEntity(line, box.verts[a], box.verts[b], THICKNESS);
      });
      box.selected = false;
    }
    for (const cab of this.cabinets) {
      if (!cab.selected) continue;
      cab.lines.forEach((line) => {
        const s = line.getLocalScale();
        line.setLocalScale(THICKNESS, THICKNESS, s.z);
      });
      cab.selected = false;
    }
    this.requestRender();
  }

  // ====== 投影工具（标签定位用） ======

  private vpMatrix(): pc.Mat4 | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    return new pc.Mat4().mul2(camComp.projectionMatrix, this.camera.getWorldTransform().clone().invert());
  }

  private project(p: pc.Vec3, vp: pc.Mat4, cssW: number, cssH: number): { x: number; y: number } | null {
    const m = vp.data;
    const clipW = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (clipW <= 0) return null;
    const inv = 1 / clipW;
    return {
      x: (((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) * inv) * 0.5 + 0.5) * cssW,
      y: (0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) * inv) * 0.5) * cssH,
    };
  }

  // ====== 命中测试（射线 + OBB 求交） ======

  /** 点击位置 → 世界空间射线（手动逆 VP 反投影，不依赖 screenToWorld 版本差异） */
  private screenToRay(sx: number, sy: number): { origin: pc.Vec3; dir: pc.Vec3 } | null {
    const camComp = this.camera.camera;
    if (!camComp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (cssW <= 0 || cssH <= 0) return null;

    const ndcX = (sx / cssW) * 2 - 1;
    const ndcY = 1 - (sy / cssH) * 2;

    const viewInv = this.camera.getWorldTransform();
    const proj = camComp.projectionMatrix;
    const vp = new pc.Mat4().mul2(proj, viewInv.clone().invert());
    const vpInv = vp.clone().invert();

    const near4 = new pc.Vec4(ndcX, ndcY, -1, 1);
    const far4 = new pc.Vec4(ndcX, ndcY, 1, 1);
    vpInv.transformVec4(near4, near4);
    vpInv.transformVec4(far4, far4);
    if (Math.abs(near4.w) < 1e-8 || Math.abs(far4.w) < 1e-8) return null;

    const near = new pc.Vec3(near4.x / near4.w, near4.y / near4.w, near4.z / near4.w);
    const far = new pc.Vec3(far4.x / far4.w, far4.y / far4.w, far4.z / far4.w);
    const dir = new pc.Vec3().sub2(far, near).normalize();
    return { origin: near, dir };
  }

  /** 从 8 个顶点提取定向包围盒（正交化 + 投影重算延展） */
  private extractOBB(verts: pc.Vec3[]): { center: pc.Vec3; axes: pc.Vec3[]; extents: number[] } | null {
    if (verts.length < 8) return null;
    const center = new pc.Vec3();
    for (const v of verts) center.add(v);
    center.mulScalar(1 / verts.length);

    const e0 = new pc.Vec3().sub2(verts[1], verts[0]);
    const e1 = new pc.Vec3().sub2(verts[3], verts[0]);
    const e2 = new pc.Vec3().sub2(verts[4], verts[0]);

    const ax = e0.clone().normalize();
    const ay = e1.clone();
    ay.sub(ax.clone().mulScalar(ax.dot(ay)));
    const ayLen = ay.length();
    if (ayLen < 0.001) return null;
    ay.mulScalar(1 / ayLen);
    const az = new pc.Vec3().cross(ax, ay);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const v of verts) {
      const d = new pc.Vec3().sub2(v, center);
      const px = ax.dot(d); if (px < minX) minX = px; if (px > maxX) maxX = px;
      const py = ay.dot(d); if (py < minY) minY = py; if (py > maxY) maxY = py;
      const pz = az.dot(d); if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
    const ex = Math.max(Math.abs(minX), Math.abs(maxX), 0.01);
    const ey = Math.max(Math.abs(minY), Math.abs(maxY), 0.01);
    const ez = Math.max(Math.abs(minZ), Math.abs(maxZ), 0.01);
    return { center, axes: [ax, ay, az], extents: [ex, ey, ez] };
  }

  /** 射线与定向包围盒求交，返回命中距离 t，未命中返回 null */
  private rayOBBHit(
    origin: pc.Vec3, dir: pc.Vec3,
    center: pc.Vec3, axes: pc.Vec3[], extents: number[],
  ): number | null {
    const d = new pc.Vec3().sub2(origin, center);
    let tMin = -Infinity;
    let tMax = Infinity;
    for (let i = 0; i < 3; i++) {
      const e = axes[i].dot(d);
      const f = axes[i].dot(dir);
      if (Math.abs(f) > 1e-8) {
        let t1 = (-e - extents[i]) / f;
        let t2 = (-e + extents[i]) / f;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) return null;
      } else if (Math.abs(e) > extents[i]) {
        return null;
      }
    }
    return tMin > 0 ? tMin : (tMax > 0 ? tMax : null);
  }

  private isNearProjection(verts: pc.Vec3[], sx: number, sy: number, margin = 12): boolean {
    const vp = this.vpMatrix();
    if (!vp) return true;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of verts) {
      const sp = this.project(v, vp, cssW, cssH);
      if (!sp) return true;
      if (sp.x < minX) minX = sp.x;
      if (sp.x > maxX) maxX = sp.x;
      if (sp.y < minY) minY = sp.y;
      if (sp.y > maxY) maxY = sp.y;
    }
    return sx >= minX - margin && sx <= maxX + margin && sy >= minY - margin && sy <= maxY + margin;
  }

  private hitTest(sx: number, sy: number): { type: "cabinet"; item: CabItem } | { type: "box"; item: BoxItem } | null {
    const ray = this.screenToRay(sx, sy);
    if (!ray) return null;

    const HIT_TOLERANCE = 1.2;
    let bestResult: { type: "cabinet"; item: CabItem } | { type: "box"; item: BoxItem } | null = null;
    let bestT = Infinity;

    for (const box of this.boxes) {
      if (!this.isNearProjection(box.verts, sx, sy)) continue;
      const obb = this.extractOBB(box.verts);
      if (!obb) continue;
      const te = obb.extents;
      const t = this.rayOBBHit(ray.origin, ray.dir, obb.center, obb.axes,
        [te[0] * HIT_TOLERANCE, te[1] * HIT_TOLERANCE, te[2] * HIT_TOLERANCE]);
      if (t !== null && t < bestT) {
        bestT = t;
        bestResult = { type: "box", item: box };
      }
    }
    for (const cab of this.cabinets) {
      if (!this.isNearProjection(cab.verts, sx, sy)) continue;
      const obb = this.extractOBB(cab.verts);
      if (!obb) continue;
      const te = obb.extents;
      const t = this.rayOBBHit(ray.origin, ray.dir, obb.center, obb.axes,
        [te[0] * HIT_TOLERANCE, te[1] * HIT_TOLERANCE, te[2] * HIT_TOLERANCE]);
      if (t !== null && t < bestT) {
        bestT = t;
        bestResult = { type: "cabinet", item: cab };
      }
    }
    return bestResult;
  }

  // ====== 事件 ======

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !this.downPos) { this.downPos = null; return; }
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > CLICK_THRESHOLD) return;

    const rect = this.canvas.getBoundingClientRect();
    const sx = Math.round(e.clientX - rect.left);
    const sy = Math.round(e.clientY - rect.top);
    const hit = this.hitTest(sx, sy);

    if (hit) {
      if (hit.type === "box") {
        this.selectBox(hit.item);
        this.onSelect?.({ type: hit.item.type, bayId: hit.item.bayId });
      } else {
        this.selectCabinet(hit.item);
        this.onSelect?.({ type: "cabinet", bayId: hit.item.bayId });
      }
    } else {
      this.deselectAll();
    }
  };

  // ====== 标签 ======

  private initLabels() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const c = document.createElement("div");
    // 标签层跟 canvas 同级绝对定位，不参与 PlayCanvas 渲染；只负责把 3D 点投影成 DOM 位置。
    c.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:15;";
    parent.appendChild(c);
    this.labelContainer = c;
    const loop = () => { this.updateLabels(); this.labelRafId = requestAnimationFrame(loop); };
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
    if (!this.labelContainer || this.allLabels.length === 0) return;
    const vp = this.vpMatrix();
    if (!vp) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    for (const lb of this.allLabels) {
      const sp = this.project(lb.center, vp, cssW, cssH);
      if (!sp) { lb.el.style.display = "none"; continue; }
      lb.el.textContent = lb.name;
      lb.el.style.left = `${sp.x}px`;
      lb.el.style.top = `${sp.y}px`;
      lb.el.style.display = "block";
    }
  }
}
