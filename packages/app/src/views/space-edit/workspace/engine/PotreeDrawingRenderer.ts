import type {
  PotreeCamera,
  PotreeNamespace,
  PotreeRay,
  PotreeThreeDisposable,
  PotreeThreeNamespace,
  PotreeThreeObject3D,
  PotreeThreeVector3,
  PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { DrawingItem, PathData, PathPoint } from "../../hooks/drawing/drawing-schema";
import type { SpaceDrawingInteractionCallbacks, SpaceDrawingLayer, SpaceDrawingSelection } from "./types";
import type { SpaceInteractionCoordinator } from "./SpaceInteractionCoordinator";

type Vec3 = [number, number, number];

const CABINET_RED = 0xff1a1a;
const CABINET_GREEN = 0x33ff4d;
const CHARGING_ORANGE = 0xff8c1a;
const DEVICE_BLUE = 0x3399ff;
const PATH_GREEN = 0x4de666;
const PATH_CURVE = 0xf2a81f;
const RAY_YELLOW = 0xffd666;
const AREA_LINE_THICKNESS = 0.01;
const PATH_LINE_THICKNESS = 0.05;
const PATH_POINT_SCALE = 0.07;
const PATH_COLLECTION_POINT_SCALE = 0.085;
const PATH_TOPO_POINT_SCALE = 0.055;
const RAY_LINE_THICKNESS = 0.025;
const RAY_ORIGIN_SCALE = 0.09;
const RAY_END_SCALE = 0.05;
const RAY_DEFAULT_LENGTH = 4;

const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [3, 7],
];
const BOX_EDGES: [number, number][] = [...RED_EDGES, ...GREEN_EDGES];

interface LineBuckets {
  cabinetRed: Vec3[];
  cabinetGreen: Vec3[];
  charging: Vec3[];
  device: Vec3[];
  path: Vec3[];
  pathCurve: Vec3[];
  ray: Vec3[];
  selected: Vec3[];
}

interface LabelSpec {
  position: Vec3;
  text: string;
  color: string;
  fontSize: number;
  transform: string;
}

interface DrawingLabel extends LabelSpec {
  element: HTMLDivElement;
}

interface DrawingLayer {
  group: PotreeThreeObject3D;
  labels: DrawingLabel[];
  hitItems: DrawingHitItem[];
  path: SpaceDrawingLayer["path"];
}

interface DrawingHitItem {
  item: DrawingItem;
  points: Vec3[];
}

function drawingItemKey(item: DrawingItem): string {
  return `${item.type}:${item.id}`;
}

function finitePoint(value: number[] | Vec3 | undefined): value is Vec3 {
  return !!value
    && value.length >= 3
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Number.isFinite(value[2]);
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function scale(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function normalize(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-8 ? scale(value, 1 / length) : null;
}

interface DrawingObb {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  extents: [number, number, number];
}

function extractDrawingObb(points: Vec3[]): DrawingObb | null {
  if (points.length < 8) return null;
  const edgeVectors = [
    subtract(points[1], points[0]),
    subtract(points[3], points[0]),
    subtract(points[4], points[0]),
  ];
  const axes = edgeVectors.map(normalize);
  if (axes.some((axis) => !axis)) return null;

  const center = points.slice(0, 8).reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]] as Vec3,
    [0, 0, 0] as Vec3,
  );
  center[0] /= 8;
  center[1] /= 8;
  center[2] /= 8;

  return {
    center,
    axes: axes as [Vec3, Vec3, Vec3],
    extents: [
      Math.hypot(edgeVectors[0][0], edgeVectors[0][1], edgeVectors[0][2]) / 2,
      Math.hypot(edgeVectors[1][0], edgeVectors[1][1], edgeVectors[1][2]) / 2,
      Math.hypot(edgeVectors[2][0], edgeVectors[2][1], edgeVectors[2][2]) / 2,
    ],
  };
}

function rayDrawingObbHit(
  ray: PotreeRay,
  obb: DrawingObb,
  tolerance = 1.2,
): number | null {
  const origin: Vec3 = [ray.origin.x, ray.origin.y, ray.origin.z];
  const direction: Vec3 = [ray.direction.x, ray.direction.y, ray.direction.z];
  const relativeOrigin = subtract(origin, obb.center);
  let near = 0;
  let far = Number.POSITIVE_INFINITY;

  for (let index = 0; index < obb.axes.length; index += 1) {
    const axis = obb.axes[index];
    const extent = obb.extents[index] * tolerance;
    const originAmount = dot(relativeOrigin, axis);
    const directionAmount = dot(direction, axis);
    if (Math.abs(directionAmount) < 1e-9) {
      if (originAmount < -extent || originAmount > extent) return null;
      continue;
    }

    let first = (-extent - originAmount) / directionAmount;
    let second = (extent - originAmount) / directionAmount;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }

  return far >= 0 ? Math.max(0, near) : null;
}

function addEdge(target: Vec3[], points: number[][], edge: [number, number]): void {
  const from = points[edge[0]];
  const to = points[edge[1]];
  if (finitePoint(from) && finitePoint(to)) target.push(from, to);
}

function lerp(a: Vec3, b: Vec3, amount: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function bezierPoint(amount: number, from: Vec3, cp1: Vec3, cp2: Vec3, to: Vec3): Vec3 {
  const inverse = 1 - amount;
  return [
    inverse ** 3 * from[0] + 3 * inverse ** 2 * amount * cp1[0] + 3 * inverse * amount ** 2 * cp2[0] + amount ** 3 * to[0],
    inverse ** 3 * from[1] + 3 * inverse ** 2 * amount * cp1[1] + 3 * inverse * amount ** 2 * cp2[1] + amount ** 3 * to[1],
    inverse ** 3 * from[2] + 3 * inverse ** 2 * amount * cp1[2] + 3 * inverse * amount ** 2 * cp2[2] + amount ** 3 * to[2],
  ];
}

function pathPointTuple(point: PathPoint): Vec3 | null {
  const value: Vec3 = [point.x, point.y, point.z];
  return finitePoint(value) ? value : null;
}

function rayEnd(origin: Vec3, direction: Vec3, length: number): Vec3 {
  return [
    origin[0] + direction[0] * length,
    origin[1] + direction[1] * length,
    origin[2] + direction[2] * length,
  ];
}

function topCenter(points: number[][]): Vec3 | null {
  const top = [points[4], points[5], points[6], points[7]];
  if (!top.every(finitePoint)) return null;
  return [
    (top[0][0] + top[1][0] + top[2][0] + top[3][0]) / 4,
    (top[0][1] + top[1][1] + top[2][1] + top[3][1]) / 4,
    (top[0][2] + top[1][2] + top[2][2] + top[3][2]) / 4,
  ];
}

function cabinetTopCenters(points: number[][], splits: number[]): Vec3[] {
  const source = [points[0], points[1], points[2], points[3], points[6], points[7]];
  if (!source.every(finitePoint)) return [];
  const [frontLeft, frontRight, topRight, topLeft, backRight, backLeft] = source as Vec3[];
  const splitPositions = [0, ...[...splits].filter((value) => Number.isFinite(value) && value > 0 && value < 1)
    .sort((left, right) => left - right), 1];
  const offset = [
    (topLeft[0] - frontLeft[0]) * 0.04,
    (topLeft[1] - frontLeft[1]) * 0.04,
    (topLeft[2] - frontLeft[2]) * 0.04,
  ] as Vec3;
  return splitPositions.slice(0, -1).map((start, index) => {
    const amount = (start + splitPositions[index + 1]) / 2;
    const front = lerp(topLeft, topRight, amount);
    const back = lerp(backLeft, backRight, amount);
    return [
      (front[0] + back[0]) / 2 + offset[0],
      (front[1] + back[1]) / 2 + offset[1],
      (front[2] + back[2]) / 2 + offset[2],
    ];
  });
}

function addAreaLines(item: DrawingItem, buckets: LineBuckets, labels: LabelSpec[], selected = false): void {
  const points = item.geometry.verts;
  if (points.length < 8) return;
  if (item.type === "cabinet") {
    RED_EDGES.forEach((edge) => addEdge(selected ? buckets.selected : buckets.cabinetRed, points, edge));
    GREEN_EDGES.forEach((edge) => addEdge(selected ? buckets.selected : buckets.cabinetGreen, points, edge));
    const splitSource = [points[0], points[1], points[3], points[2], points[4], points[5], points[7], points[6]];
    if (!splitSource.every(finitePoint)) return;
    const splitPoints = splitSource as Vec3[];
    item.geometry.splits.forEach((amount) => {
      if (!Number.isFinite(amount) || amount <= 0 || amount >= 1) return;
      const corners = [
        lerp(splitPoints[0], splitPoints[1], amount),
        lerp(splitPoints[2], splitPoints[3], amount),
        lerp(splitPoints[4], splitPoints[5], amount),
        lerp(splitPoints[6], splitPoints[7], amount),
      ];
      ([[0, 1], [2, 3], [0, 2], [1, 3]] as [number, number][])
        .forEach((edge) => addEdge(selected ? buckets.selected : buckets.cabinetGreen, corners, edge));
    });
    if (selected) return;
    cabinetTopCenters(points, item.geometry.splits).forEach((position, index) => {
      const name = item.cabinets[index]?.name?.trim();
      if (name) labels.push({ position, text: name, color: "#ff2a1a", fontSize: 18, transform: "translate(-50%, -105%)" });
    });
    return;
  }

  const target = selected
    ? buckets.selected
    : item.type === "charging-area" ? buckets.charging : buckets.device;
  BOX_EDGES.forEach((edge) => addEdge(target, points, edge));
  if (selected) return;
  const position = topCenter(points);
  if (!position) return;
  if (item.type === "charging-area") {
    labels.push({
      position,
      text: item.name?.trim() || "充电区域",
      color: "#ff8c00",
      fontSize: 18,
      transform: "translate(-50%, -105%)",
    });
  } else {
    labels.push({
      position,
      text: item.name?.trim() || item.bay?.name || "未绑定",
      color: "#3399ff",
      fontSize: 18,
      transform: "translate(-50%, -105%)",
    });
  }
}

function addPathLines(data: PathData, buckets: LineBuckets, labels: LabelSpec[]): {
  regular: Vec3[];
  collection: Vec3[];
  topo: Vec3[];
} {
  const pointById = new Map<string, Vec3>();
  const regular: Vec3[] = [];
  const collection: Vec3[] = [];
  const topo: Vec3[] = [];
  data.points.forEach((point) => {
    const tuple = pathPointTuple(point);
    if (!tuple) return;
    pointById.set(String(point.id), tuple);
    if (point.role === "waypoint") return;
    const isTopo = point.robotType === "4";
    const isCollection = point.robotType === "5";
    (isTopo ? topo : isCollection ? collection : regular).push(tuple);
    if (point.name?.trim()) {
      labels.push({
        position: tuple,
        text: point.name.trim(),
        color: isTopo ? "#3dde69" : "#44e95f",
        fontSize: 16,
        transform: "translate(-50%, -145%)",
      });
    }
  });

  data.paths.forEach((segment) => {
    const from = pointById.get(String(segment.from));
    const to = pointById.get(String(segment.to));
    if (!from || !to) return;
    const cp1 = segment.bezier?.cp1;
    const cp2 = segment.bezier?.cp2;
    if (finitePoint(cp1) && finitePoint(cp2)) {
      let previous = from;
      for (let step = 1; step <= 24; step += 1) {
        const next = bezierPoint(step / 24, from, cp1, cp2, to);
        buckets.pathCurve.push(previous, next);
        previous = next;
      }
      return;
    }
    buckets.path.push(from, to);
  });
  return { regular, collection, topo };
}

function addRayLines(data: SpaceDrawingLayer, buckets: LineBuckets, labels: LabelSpec[]): {
  origins: Vec3[];
  ends: Vec3[];
} {
  const origins: Vec3[] = [];
  const ends: Vec3[] = [];
  (data.rays ?? []).forEach((ray) => {
    if (!finitePoint(ray.origin) || !finitePoint(ray.direction)) return;
    const direction = normalize(ray.direction);
    if (!direction) return;
    const length = typeof ray.length === "number" && Number.isFinite(ray.length) && ray.length > 0
      ? Math.max(0.1, ray.length)
      : RAY_DEFAULT_LENGTH;
    const origin: Vec3 = [ray.origin[0], ray.origin[1], ray.origin[2]];
    const end = rayEnd(origin, direction, length);
    buckets.ray.push(origin, end);
    origins.push(origin);
    ends.push(end);
    if (ray.name?.trim()) {
      labels.push({
        position: origin,
        text: ray.name.trim(),
        color: "#ffd666",
        fontSize: 12,
        transform: "translate(-50%, -140%)",
      });
    }
  });
  return { origins, ends };
}

function findOrigin(layer: SpaceDrawingLayer): Vec3 {
  for (const item of layer.areas ?? []) {
    const point = item.geometry.verts.find(finitePoint);
    if (point) return [point[0], point[1], point[2]];
  }
  for (const point of layer.path?.points ?? []) {
    const tuple = pathPointTuple(point);
    if (tuple) return tuple;
  }
  for (const ray of layer.rays ?? []) {
    if (finitePoint(ray.origin)) return [ray.origin[0], ray.origin[1], ray.origin[2]];
  }
  return [0, 0, 0];
}

function disposeObject(root: PotreeThreeObject3D): void {
  const geometries = new Set<PotreeThreeDisposable>();
  const materials = new Set<PotreeThreeDisposable>();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => {
      if (material) materials.add(material);
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export class PotreeDrawingRenderer {
  private projectPoint(point: Vec3, camera: PotreeCamera) {
    const projected = new this.three.Vector3(point[0], point[1], point[2]).project(camera);
    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      !Number.isFinite(projected.z)
    ) {
      return null;
    }

    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: (projected.x + 1) * 0.5 * rect.width,
      y: (1 - projected.y) * 0.5 * rect.height,
      z: projected.z,
    };
  }
  private readonly scene: PotreeThreeObject3D;
  private readonly layers = new Map<string, DrawingLayer>();
  private readonly labelContainer: HTMLDivElement;
  private interactionCallbacks: SpaceDrawingInteractionCallbacks | null = null;
  private selectedItems = new Map<string, string>();
  private active = true;
  private mouseDown: { x: number; y: number } | null = null;
  private pendingSelection: SpaceDrawingSelection | null = null;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
    private readonly interactions: SpaceInteractionCoordinator,
  ) {
    this.scene = new three.Scene();
    this.labelContainer = this.createLabelContainer(host);
    host.addEventListener("mousedown", this.handleMouseDown, true);
    window.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("keydown", this.handleKeyDown);
    viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
  }

  setInteractionCallbacks(callbacks: SpaceDrawingInteractionCallbacks | null): void {
    this.interactionCallbacks = callbacks;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.mouseDown = null;
    this.pendingSelection = null;
    this.interactions.setClaim("drawing-selection", false);
    if (!active) this.viewer.controls?.stop?.();
  }

  setLayer(layerId: string, data: SpaceDrawingLayer): void {
    const selectedItemKey = this.selectedItems.get(layerId) ?? null;
    this.removeLayer(layerId);
    if (selectedItemKey) this.selectedItems.set(layerId, selectedItemKey);
    const layer = this.buildLayer(data, selectedItemKey);
    if (!layer) {
      this.selectedItems.delete(layerId);
      return;
    }
    if (!layer.hitItems.some(({ item }) => drawingItemKey(item) === selectedItemKey)) {
      this.selectedItems.delete(layerId);
    }
    this.layers.set(layerId, layer);
    this.scene.add(layer.group);
  }

  removeLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    this.scene.remove(layer.group);
    disposeObject(layer.group);
    layer.labels.forEach((label) => label.element.remove());
    this.layers.delete(layerId);
    this.selectedItems.delete(layerId);
  }

  clear(): void {
    [...this.layers.keys()].forEach((layerId) => this.removeLayer(layerId));
    this.selectedItems.clear();
  }

  dispose(): void {
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    window.removeEventListener("mouseup", this.handleMouseUp, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.clear();
    this.labelContainer.remove();
    this.interactions.setClaim("drawing-selection", false);
    this.interactionCallbacks = null;
  }

  private buildLayer(data: SpaceDrawingLayer, selectedItemKey: string | null): DrawingLayer | null {
    const buckets: LineBuckets = {
      cabinetRed: [],
      cabinetGreen: [],
      charging: [],
      device: [],
      path: [],
      pathCurve: [],
      ray: [],
      selected: [],
    };
    const labelSpecs: LabelSpec[] = [];
    const hitItems: DrawingHitItem[] = [];
    (data.areas ?? []).forEach((item) => {
      addAreaLines(item, buckets, labelSpecs);
      const points = item.geometry.verts.filter(finitePoint);
      if (points.length >= 8) hitItems.push({ item, points });
      if (drawingItemKey(item) === selectedItemKey) addAreaLines(item, buckets, [], true);
    });
    const pathPoints = data.path
      ? addPathLines(data.path, buckets, labelSpecs)
      : { regular: [], collection: [], topo: [] };
    const rayPoints = addRayLines(data, buckets, labelSpecs);
    const hasData = Object.values(buckets).some((points) => points.length > 0)
      || pathPoints.regular.length > 0
      || pathPoints.collection.length > 0
      || pathPoints.topo.length > 0
      || rayPoints.origins.length > 0
      || rayPoints.ends.length > 0;
    if (!hasData) return null;

    const origin = findOrigin(data);
    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    this.addLines(group, buckets.cabinetRed, origin, CABINET_RED, AREA_LINE_THICKNESS);
    this.addLines(group, buckets.cabinetGreen, origin, CABINET_GREEN, AREA_LINE_THICKNESS);
    this.addLines(group, buckets.charging, origin, CHARGING_ORANGE, AREA_LINE_THICKNESS);
    this.addLines(group, buckets.device, origin, DEVICE_BLUE, AREA_LINE_THICKNESS);
    this.addLines(group, buckets.path, origin, PATH_GREEN, PATH_LINE_THICKNESS);
    this.addLines(group, buckets.pathCurve, origin, PATH_CURVE, PATH_LINE_THICKNESS);
    this.addLines(group, buckets.ray, origin, RAY_YELLOW, RAY_LINE_THICKNESS, false);
    this.addLines(group, buckets.selected, origin, 0xffe14b, AREA_LINE_THICKNESS * 2.5);
    this.addPoints(group, pathPoints.regular, origin, PATH_GREEN, PATH_POINT_SCALE);
    this.addPoints(group, pathPoints.collection, origin, PATH_GREEN, PATH_COLLECTION_POINT_SCALE);
    this.addPoints(group, pathPoints.topo, origin, PATH_GREEN, PATH_TOPO_POINT_SCALE);
    this.addPoints(group, rayPoints.origins, origin, RAY_YELLOW, RAY_ORIGIN_SCALE, false);
    this.addPoints(group, rayPoints.ends, origin, RAY_YELLOW, RAY_END_SCALE, false);
    return {
      group,
      labels: labelSpecs.map((spec) => ({ ...spec, element: this.createLabel(spec) })),
      hitItems,
      path: data.path,
    };
  }

  private canHandlePointer(): boolean {
    if (!this.active) return false;
    return this.interactions.isMode("idle")
      && !this.interactions.hasAnyClaim("drawing-drag", "path-selection")
      && !this.host.closest("[data-space-edit-busy='true']");
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.canHandlePointer()) return;
    this.mouseDown = { x: event.clientX, y: event.clientY };
    this.pendingSelection = this.hitTest(this.mousePosition(event));
    this.interactions.setClaim("drawing-selection", !!this.pendingSelection);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const pendingSelection = this.pendingSelection;
    this.pendingSelection = null;
    this.interactions.setClaim("drawing-selection", false);
    const start = this.mouseDown;
    this.mouseDown = null;
    if (event.button !== 0 || !start || !this.canHandlePointer()) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;

    const selection = pendingSelection ?? this.hitTest(this.mousePosition(event));
    const previousSelectedLayers = [...this.selectedItems.keys()];
    this.selectedItems.clear();
    if (selection) {
      this.selectedItems.set(selection.layerId, drawingItemKey(selection.item));
      this.interactionCallbacks?.onSelect(selection);
      new Set([...previousSelectedLayers, selection.layerId]).forEach((layerId) => {
        this.rebuildLayer(layerId);
      });
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      this.viewer.controls?.stop?.();
      return;
    }

    this.interactionCallbacks?.onSelect(null);
    [...this.layers.keys()].forEach((layerId) => this.rebuildLayer(layerId));
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!this.active) return;
    if ((event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
    if (!this.canHandlePointer()) return;
    const selected = this.getSelectedItem();
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedItems.delete(selected.layerId);
    this.interactionCallbacks?.onDelete(selected);
  };

  private getSelectedItem(): SpaceDrawingSelection | null {
    for (const [layerId, itemId] of this.selectedItems) {
      const item = this.layers.get(layerId)?.hitItems.find(({ item: candidate }) => drawingItemKey(candidate) === itemId)?.item;
      if (item) return { layerId, item };
    }
    return null;
  }

  private rebuildLayer(layerId: string): void {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    const selectedItemKey = this.selectedItems.get(layerId) ?? null;
    const data: SpaceDrawingLayer = {
      areas: layer.hitItems.map(({ item }) => item),
      path: layer.path,
    };
    this.removeLayer(layerId);
    if (selectedItemKey) this.selectedItems.set(layerId, selectedItemKey);
    const rebuilt = this.buildLayer(data, selectedItemKey);
    if (!rebuilt) {
      this.selectedItems.delete(layerId);
      return;
    }
    this.layers.set(layerId, rebuilt);
    this.scene.add(rebuilt.group);
  }

  private mousePosition(event: MouseEvent): { x: number; y: number } {
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  }

  private hitTest(mouse: { x: number; y: number }): SpaceDrawingSelection | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    const mouseToRay = this.potree.Utils?.mouseToRay;
    if (!mouseToRay) return null;
    const element = this.viewer.renderer.domElement;
    let ray: PotreeRay;
    try {
      ray = mouseToRay(mouse, camera, element.clientWidth, element.clientHeight);
    } catch {
      return null;
    }

    let best: { selection: SpaceDrawingSelection; distance: number } | null = null;
    for (const [layerId, layer] of this.layers) {
      for (const hitItem of layer.hitItems) {
        const obb = extractDrawingObb(hitItem.points);
        if (!obb) continue;
        const distance = rayDrawingObbHit(ray, obb);
        if (distance !== null && (!best || distance < best.distance)) {
          best = {
            selection: { layerId, item: hitItem.item },
            distance,
          };
        }
      }
    }
    return best?.selection ?? null;
  }

  private localPoint(point: Vec3, origin: Vec3): Vec3 {
    return [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  }

  private addLines(
    group: PotreeThreeObject3D,
    points: Vec3[],
    origin: Vec3,
    color: number,
    thickness: number,
    depthTest = true,
  ): void {
    if (points.length === 0) return;
    const geometry = new this.three.BoxGeometry(1, 1, 1);
    const material = new this.three.MeshBasicMaterial({ color, depthTest, depthWrite: depthTest });
    const meshes: PotreeThreeObject3D[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      const from = this.localPoint(points[index], origin);
      const to = this.localPoint(points[index + 1], origin);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dz = to[2] - from[2];
      const length = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(length) || length <= 1e-8) continue;
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
      mesh.scale.set(thickness, thickness, length);
      if (Math.abs(dy / length) > 0.999) mesh.up.set(1, 0, 0);
      mesh.lookAt(to[0], to[1], to[2]);
      meshes.push(mesh);
    }
    if (meshes.length > 0) meshes.forEach((mesh) => group.add(mesh));
    else {
      geometry.dispose();
      material.dispose();
    }
  }

  private addPoints(
    group: PotreeThreeObject3D,
    points: Vec3[],
    origin: Vec3,
    color: number,
    size: number,
    depthTest = true,
  ): void {
    if (points.length === 0) return;
    const geometry = new this.three.SphereGeometry(1, 12, 8);
    const material = new this.three.MeshBasicMaterial({ color, depthTest, depthWrite: depthTest });
    const meshes = points.map((point) => {
      const local = this.localPoint(point, origin);
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set(local[0], local[1], local[2]);
      mesh.scale.set(size, size, size);
      return mesh;
    });
    meshes.forEach((mesh) => group.add(mesh));
  }

  private createLabelContainer(host: HTMLElement): HTMLDivElement {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "15",
    });
    host.appendChild(container);
    return container;
  }

  private createLabel(spec: LabelSpec): HTMLDivElement {
    const element = document.createElement("div");
    element.textContent = spec.text;
    Object.assign(element.style, {
      position: "absolute",
      display: "none",
      color: spec.color,
      fontSize: `${spec.fontSize}px`,
      fontWeight: "700",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      textShadow: "0 0 3px #000, 0 0 3px #000",
      transform: spec.transform,
    });
    this.labelContainer.appendChild(element);
    return element;
  }

  private updateLabels(camera: unknown): void {
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.layers.forEach((layer) => layer.labels.forEach((label) => {
      const projected = new this.three.Vector3(...label.position).project(camera) as PotreeThreeVector3;
      const visible = Number.isFinite(projected.x)
        && Number.isFinite(projected.y)
        && Number.isFinite(projected.z)
        && projected.z >= -1
        && projected.z <= 1
        && projected.x >= -1
        && projected.x <= 1
        && projected.y >= -1
        && projected.y <= 1;
      if (!visible) {
        label.element.style.display = "none";
        return;
      }
      label.element.style.left = `${(projected.x + 1) * 0.5 * bounds.width}px`;
      label.element.style.top = `${(1 - projected.y) * 0.5 * bounds.height}px`;
      label.element.style.display = "block";
    }));
  }

  private readonly renderOverlay = (): void => {
    if (!this.active) return;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera || this.layers.size === 0) return;
    this.viewer.renderer.render(this.scene, camera);
    this.updateLabels(camera);
  };
}
