import * as pc from "playcanvas";
import {
  isBoxRenderItem,
  isCabinetRenderItem,
  isDrawingItemsData,
  isPathPointObject,
  isPathRenderData,
  isRayRenderData,
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
  type RayRenderData,
  type RayRenderItem,
} from "./drawing-data";
import { electronFileSource, type FileSource } from "./file-source";
import { loadLasCoordinateTransform } from "./coordinate-transform";
import { createLine, createSphere, updateLineEntity } from "./render-primitives";
import {
  extractBoxObb,
  isNearProjectedBounds,
  pointToSegmentDistSq,
  projectToScreen,
  rayObbHit,
  screenToRay,
  viewProjectionMatrix,
} from "./selection-utils";

const RED = new pc.Color(1, 0.1, 0.1);
const GREEN = new pc.Color(0.2, 1, 0.3);
const PATH_COLOR = new pc.Color(0.3, 0.9, 0.4);
const PATH_CURVE_COLOR = new pc.Color(0.95, 0.66, 0.12);
const RAY_COLOR = new pc.Color(1, 0.84, 0.12);
const CHARGING_COLOR = new pc.Color(1, 0.55, 0.1);
const DEVICE_COLOR = new pc.Color(0.2, 0.6, 1);
const DEVICE_LABEL_COLOR = "#3399ff";
const PATH_LABEL_COLOR = "#44e95f";
const PATH_TOPO_LABEL_COLOR = "#c7ccd4";
const RAY_LABEL_COLOR = "#ffd666";
const THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;
const CLICK_THRESHOLD = 8;
const PATH_THICKNESS = 0.05;
const PATH_HIGHLIGHT_THICKNESS = 0.08;
const PATH_HIT_DISTANCE_SQ = 100;
const PATH_SPHERE_SCALE = 0.12;
const PATH_SPHERE_HIGHLIGHT_SCALE = 0.18;
const PATH_TOPO_POINT_COLOR = new pc.Color(0.76, 0.78, 0.82);
const PATH_TOPO_POINT_SCALE = 0.065;
const RAY_DEFAULT_LENGTH = 4;
const RAY_THICKNESS = 0.025;
const RAY_ORIGIN_SCALE = 0.09;
const RAY_END_SCALE = 0.05;

const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [3, 7],
];
const BOX_EDGES: [number, number][] = [...RED_EDGES, ...GREEN_EDGES];

function v3(arr: [number, number, number] | number[]): pc.Vec3 {
  return new pc.Vec3(arr[0], arr[1], arr[2]);
}

function finiteVec3(arr: unknown): arr is [number, number, number] {
  return Array.isArray(arr)
    && arr.length >= 3
    && Number.isFinite(arr[0])
    && Number.isFinite(arr[1])
    && Number.isFinite(arr[2]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pathPointStyle(point: PathVertex): PathPointStyle | null {
  if (point.role === "waypoint") return null;
  switch (point.robotType) {
    case "4":
      return { color: PATH_TOPO_POINT_COLOR, scale: PATH_TOPO_POINT_SCALE, labelColor: PATH_TOPO_LABEL_COLOR };
    case "5":
      return { color: PATH_COLOR, scale: PATH_SPHERE_SCALE * 1.2, labelColor: PATH_LABEL_COLOR };
    default:
      return { color: PATH_COLOR, scale: PATH_SPHERE_SCALE, labelColor: PATH_LABEL_COLOR };
  }
}

function pathSegmentColor(segment: PathSegmentValue): pc.Color {
  return segment.bezier ? PATH_CURVE_COLOR : PATH_COLOR;
}

function bezierPoint(t: number, p0: pc.Vec3, cp1: pc.Vec3, cp2: pc.Vec3, p1: pc.Vec3): pc.Vec3 {
  const mt = 1 - t;
  return new pc.Vec3(
    mt * mt * mt * p0.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * p1.x,
    mt * mt * mt * p0.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * p1.y,
    mt * mt * mt * p0.z + 3 * mt * mt * t * cp1.z + 3 * mt * t * t * cp2.z + t * t * t * p1.z,
  );
}

function pathBezierControlPoints(bezier: unknown): { cp1: pc.Vec3; cp2: pc.Vec3 } | null {
  if (!isRecord(bezier) || !finiteVec3(bezier.cp1) || !finiteVec3(bezier.cp2)) return null;
  return { cp1: v3(bezier.cp1), cp2: v3(bezier.cp2) };
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

interface PathPointItem {
  index: number;
  pos: pc.Vec3;
  sphere: pc.Entity;
  selected: boolean;
  color: pc.Color;
  scale: number;
}

interface PathLineItem {
  index: number;
  from: pc.Vec3;
  to: pc.Vec3;
  line: pc.Entity;
  selected: boolean;
  color: pc.Color;
  thickness: number;
}

interface PathVertex {
  pos: pc.Vec3;
  id?: string | number;
  name?: string;
  role?: "stop" | "waypoint";
  robotType?: string;
}

interface PathPointStyle {
  color: pc.Color;
  scale: number;
  labelColor: string;
}

export type DrawingRendererSelectInfo =
  | { type: "cabinet" | "device-area" | "charging-area"; bayId: number }
  | { type: "path"; bayId: 0; index: number; target: "point" | "line" };

type HitResult =
  | { type: "cabinet"; item: CabItem }
  | { type: "box"; item: BoxItem }
  | { type: "path-point"; item: PathPointItem }
  | { type: "path-line"; item: PathLineItem };

function setEntityColor(entity: pc.Entity, color: pc.Color) {
  const material = entity.render?.material as pc.StandardMaterial | undefined;
  if (!material) return;
  material.diffuse = color;
  material.emissive = color;
  material.update();
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
  private rayEntities: pc.Entity[] = [];
  private pathPoints: PathPointItem[] = [];
  private pathLines: PathLineItem[] = [];
  private labelContainer: HTMLDivElement | null = null;
  private labelRafId = 0;
  private gd: pc.GraphicsDevice;
  private canvas: HTMLCanvasElement;
  private downPos: { x: number; y: number } | null = null;
  private allLabels: LabelInfo[] = [];
  private rayLabels: LabelInfo[] = [];
  private fileSource: FileSource;
  onSelect?: (info: DrawingRendererSelectInfo) => void;

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
    if (isRayRenderData(data)) {
      this.renderRays(data);
      return;
    }
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
    this.rayEntities = [];
    this.pathPoints = [];
    this.pathLines = [];
    this.allLabels = [];
    this.rayLabels = [];
  }

  clearRays() {
    if (this.rayEntities.length === 0 && this.rayLabels.length === 0) return;
    const rayEntities = new Set(this.rayEntities);
    const rayLabels = new Set(this.rayLabels);
    for (const e of this.rayEntities) this.app.root.removeChild(e);
    for (const l of this.rayLabels) l.el.remove();
    this.entities = this.entities.filter((e) => !rayEntities.has(e));
    this.allLabels = this.allLabels.filter((l) => !rayLabels.has(l));
    this.rayEntities = [];
    this.rayLabels = [];
    this.requestRender();
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
      .filter((pt): pt is PathVertex => !!pt);
    const pointById = new Map<string | number, pc.Vec3>();

    points.forEach((pt, index) => {
      if (pt.id !== undefined) pointById.set(pt.id, pt.pos);
      const p = pt.pos;
      const style = pathPointStyle(pt);
      if (!style) return;

      const sphere = createSphere(this.app, p, style.color, style.scale);
      if (pt.name) {
        const el = this.createLabelEl();
        el.style.color = style.labelColor;
        el.style.fontSize = "16px";
        el.style.transform = "translate(-50%,-145%)";
        this.allLabels.push({ center: p, name: pt.name, el });
      }
      this.entities.push(sphere);
      this.pathEntities.push(sphere);
      this.pathPoints.push({ index, pos: p, sphere, selected: false, color: style.color, scale: style.scale });
    });
    data.paths.forEach((seg, index) => {
      const p1 = this.resolvePathPoint(seg, "start", "from", points, pointById);
      const p2 = this.resolvePathPoint(seg, "end", "to", points, pointById);
      if (!p1 || !p2) return;
      const color = pathSegmentColor(seg);
      const bezier = pathBezierControlPoints(seg.bezier);
      if (bezier) {
        let prev = p1;
        for (let step = 1; step <= 16; step++) {
          const next = bezierPoint(step / 16, p1, bezier.cp1, bezier.cp2, p2);
          this.addPathLine(index, prev, next, color, PATH_THICKNESS);
          prev = next;
        }
        return;
      }
      this.addPathLine(index, p1, p2, color, PATH_THICKNESS);
    });
  }

  private addPathLine(index: number, from: pc.Vec3, to: pc.Vec3, color: pc.Color, thickness: number) {
    const line = createLine(this.app, from, to, color, thickness);
    this.entities.push(line);
    this.pathEntities.push(line);
    this.pathLines.push({ index, from, to, line, selected: false, color, thickness });
  }

  private renderRays(data: RayRenderData) {
    this.clearRays();
    for (const ray of data.rays || []) {
      const created = this.renderRay(ray);
      if (created.length > 0) {
        this.entities.push(...created);
        this.rayEntities.push(...created);
      }
    }
  }

  private renderRay(ray: RayRenderItem): pc.Entity[] {
    if (!finiteVec3(ray.origin) || !finiteVec3(ray.direction)) return [];
    const origin = v3(ray.origin);
    const dir = v3(ray.direction);
    const mag = dir.length();
    if (!Number.isFinite(mag) || mag < 1e-6) return [];

    dir.mulScalar(1 / mag);
    const length = typeof ray.length === "number" && Number.isFinite(ray.length) && ray.length > 0
      ? Math.max(0.1, ray.length)
      : RAY_DEFAULT_LENGTH;
    const end = origin.clone().add(dir.clone().mulScalar(length));
    const entities = [
      createSphere(this.app, origin, RAY_COLOR, RAY_ORIGIN_SCALE),
      createLine(this.app, origin, end, RAY_COLOR, RAY_THICKNESS),
      createSphere(this.app, end, RAY_COLOR, RAY_END_SCALE),
    ];

    if (ray.name) {
      const el = this.createLabelEl();
      el.style.color = RAY_LABEL_COLOR;
      el.style.fontSize = "12px";
      el.style.transform = "translate(-50%,-140%)";
      const label = { center: origin, name: ray.name, el };
      this.allLabels.push(label);
      this.rayLabels.push(label);
    }

    return entities;
  }

  private toPathVertex(point: PathPointValue): PathVertex | null {
    const tuple = pointToTuple(point);
    if (!tuple) return null;
    const isObject = isPathPointObject(point);
    return {
      pos: v3(tuple),
      id: isObject ? point.id : undefined,
      name: isObject ? point.name : undefined,
      role: isObject ? point.role : undefined,
      robotType: isObject ? point.robotType : undefined,
    };
  }

  private resolvePathPoint(
    segment: PathSegmentValue,
    indexKey: "start" | "end",
    idKey: "from" | "to",
    points: PathVertex[],
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

  private selectPathPoint(point: PathPointItem) {
    if (point.selected) return;
    this.deselectAll();
    setEntityColor(point.sphere, point.color);
    point.sphere.setLocalScale(PATH_SPHERE_HIGHLIGHT_SCALE, PATH_SPHERE_HIGHLIGHT_SCALE, PATH_SPHERE_HIGHLIGHT_SCALE);
    point.selected = true;
    this.requestRender();
  }

  private selectPathLine(path: PathLineItem) {
    if (path.selected) return;
    this.deselectAll();
    setEntityColor(path.line, path.color);
    updateLineEntity(path.line, path.from, path.to, PATH_HIGHLIGHT_THICKNESS);
    path.selected = true;
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
    for (const path of this.pathLines) {
      if (!path.selected) continue;
      setEntityColor(path.line, path.color);
      updateLineEntity(path.line, path.from, path.to, path.thickness);
      path.selected = false;
    }
    for (const point of this.pathPoints) {
      if (!point.selected) continue;
      setEntityColor(point.sphere, point.color);
      point.sphere.setLocalScale(point.scale, point.scale, point.scale);
      point.selected = false;
    }
    this.requestRender();
  }

  // ====== 投影工具（标签定位用） ======

  private vpMatrix(): pc.Mat4 | null {
    return viewProjectionMatrix(this.camera);
  }

  private project(p: pc.Vec3, vp: pc.Mat4, cssW: number, cssH: number): { x: number; y: number } | null {
    return projectToScreen(p, vp, cssW, cssH);
  }

  // ====== 命中测试（射线 + OBB 求交） ======

  private isNearProjection(verts: pc.Vec3[], sx: number, sy: number, margin = 12): boolean {
    const vp = this.vpMatrix();
    if (!vp) return true;
    const rect = this.canvas.getBoundingClientRect();
    return isNearProjectedBounds(verts, sx, sy, vp, rect.width, rect.height, margin);
  }

  private hitTestPath(sx: number, sy: number): HitResult | null {
    const vp = this.vpMatrix();
    if (!vp) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    let bestPoint: PathPointItem | null = null;
    let bestPointD2 = PATH_HIT_DISTANCE_SQ;
    for (const point of this.pathPoints) {
      const sp = this.project(point.pos, vp, cssW, cssH);
      if (!sp) continue;
      const d2 = (sp.x - sx) ** 2 + (sp.y - sy) ** 2;
      if (d2 < bestPointD2) {
        bestPointD2 = d2;
        bestPoint = point;
      }
    }
    if (bestPoint) return { type: "path-point", item: bestPoint };

    let bestLine: PathLineItem | null = null;
    let bestLineD2 = PATH_HIT_DISTANCE_SQ;
    for (const path of this.pathLines) {
      const a = this.project(path.from, vp, cssW, cssH);
      const b = this.project(path.to, vp, cssW, cssH);
      if (!a || !b) continue;
      const d2 = pointToSegmentDistSq(sx, sy, a.x, a.y, b.x, b.y);
      if (d2 < bestLineD2) {
        bestLineD2 = d2;
        bestLine = path;
      }
    }
    return bestLine ? { type: "path-line", item: bestLine } : null;
  }

  private hitTest(sx: number, sy: number): HitResult | null {
    const pathHit = this.hitTestPath(sx, sy);
    if (pathHit) return pathHit;

    const ray = screenToRay(this.camera, this.canvas, sx, sy);
    if (!ray) return null;

    const HIT_TOLERANCE = 1.2;
    let bestResult: HitResult | null = null;
    let bestT = Infinity;

    for (const box of this.boxes) {
      if (!this.isNearProjection(box.verts, sx, sy)) continue;
      const obb = extractBoxObb(box.verts);
      if (!obb) continue;
      const te = obb.extents;
      const t = rayObbHit(ray.origin, ray.dir, obb.center, obb.axes,
        [te[0] * HIT_TOLERANCE, te[1] * HIT_TOLERANCE, te[2] * HIT_TOLERANCE]);
      if (t !== null && t < bestT) {
        bestT = t;
        bestResult = { type: "box", item: box };
      }
    }
    for (const cab of this.cabinets) {
      if (!this.isNearProjection(cab.verts, sx, sy)) continue;
      const obb = extractBoxObb(cab.verts);
      if (!obb) continue;
      const te = obb.extents;
      const t = rayObbHit(ray.origin, ray.dir, obb.center, obb.axes,
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
      } else if (hit.type === "cabinet") {
        this.selectCabinet(hit.item);
        this.onSelect?.({ type: "cabinet", bayId: hit.item.bayId });
      } else if (hit.type === "path-point") {
        this.selectPathPoint(hit.item);
        this.onSelect?.({ type: "path", bayId: 0, index: hit.item.index, target: "point" });
      } else {
        this.selectPathLine(hit.item);
        this.onSelect?.({ type: "path", bayId: 0, index: hit.item.index, target: "line" });
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

