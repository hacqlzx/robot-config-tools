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
import type { SpaceCabinetCallbacks, SpaceCabinetState } from "./types";

type Vec3 = [number, number, number];

const CABINET_RED = 0xff1a1a;
const CABINET_GREEN = 0x33ff4d;
const CABINET_SELECTED = 0x33ccff;
const LINE_THICKNESS = 0.01;
const POINT_SCALE = 0.06;
const CLICK_THRESHOLD = 3;
const VERTEX_HIT_DISTANCE_SQ = 100;
const EDGE_HIT_DISTANCE_SQ = 100;
const RED_VERTICES = new Set([0, 1, 2, 6]);
const RED_EDGES: [number, number][] = [[0, 1], [1, 2], [2, 6]];
const GREEN_EDGES: [number, number][] = [
  [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [3, 7],
];

interface CabinetSnapshot {
  points: Vec3[];
  verts: Vec3[] | null;
  splits: number[];
}

function clonePoint(point: Vec3): Vec3 {
  return [point[0], point[1], point[2]];
}

function finitePoint(value: Vec3 | undefined): value is Vec3 {
  return !!value && value.every(Number.isFinite);
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scale(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-4 ? scale(value, 1 / length) : null;
}

function lerp(left: Vec3, right: Vec3, amount: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ];
}

function distanceSquaredToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    : 0;
  const closestX = ax + amount * dx;
  const closestY = ay + amount * dy;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
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

function buildOrthogonalCabinetVerts(first: Vec3, second: Vec3, third: Vec3, fourth: Vec3): Vec3[] | null {
  const width = subtract(second, first);
  const widthDirection = normalize(width);
  if (!widthDirection) return null;

  const rawHeight = subtract(third, second);
  const height = subtract(rawHeight, scale(widthDirection, dot(rawHeight, widthDirection)));
  const heightDirection = normalize(height);
  if (!heightDirection) return null;

  let frontDirection = normalize(cross(widthDirection, heightDirection));
  if (!frontDirection) return null;
  const dc = subtract(third, fourth);
  if (dot(frontDirection, dc) < 0) frontDirection = scale(frontDirection, -1);

  const rawDepth = subtract(fourth, third);
  const depthLength = Math.abs(dot(rawDepth, frontDirection));
  if (depthLength < 1e-4) return null;
  const depth = scale(frontDirection, -depthLength);

  const p0 = clonePoint(first);
  const p1 = clonePoint(second);
  const p2 = add(p1, height);
  const p3 = add(p0, height);
  const p4 = add(p0, depth);
  const p5 = add(p1, depth);
  const p6 = add(p2, depth);
  const p7 = add(p3, depth);
  return [p0, p1, p2, p3, p4, p5, p6, p7];
}

export class PotreeCabinetEditor {
  private readonly scene: PotreeThreeObject3D;
  private readonly labelContainer: HTMLDivElement;
  private visualGroup: PotreeThreeObject3D | null = null;
  private labels: HTMLDivElement[] = [];
  private callbacks: SpaceCabinetCallbacks | null = null;
  private points: Vec3[] = [];
  private verts: Vec3[] | null = null;
  private splits: number[] = [];
  private cabinetNames: string[] = [];
  private enabled = false;
  private selectedVertex = -1;
  private mouseDown: { x: number; y: number } | null = null;
  private dragBefore: CabinetSnapshot | null = null;
  private undoStack: CabinetSnapshot[] = [];
  private redoStack: CabinetSnapshot[] = [];

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
  ) {
    this.scene = new three.Scene();
    this.labelContainer = this.createLabelContainer();
    this.host.addEventListener("mousedown", this.handleMouseDown, true);
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("mouseup", this.handleMouseUp, true);
    this.viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
  }

  start(callbacks: SpaceCabinetCallbacks): void {
    this.callbacks = callbacks;
    this.enabled = true;
    this.rebuildVisuals();
    this.emitChange();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mouseDown = null;
    this.dragBefore = null;
    this.selectedVertex = -1;
    (window as Window & { __drawingDragging?: boolean }).__drawingDragging = false;
    this.rebuildVisuals();
    this.emitChange();
  }

  setCabinetNames(names: string[]): void {
    this.cabinetNames = names.map((name) => String(name || ""));
    this.syncLabels();
  }

  getGeometry(): { verts: number[][]; splits: number[] } | null {
    if (!this.verts) return null;
    return {
      verts: this.verts.map(clonePoint),
      splits: [...this.splits],
    };
  }

  hasDraft(): boolean {
    return this.points.length > 0 || !!this.verts;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  restoreSnapshot(snapshot: unknown): void {
    this.restore(snapshot as CabinetSnapshot);
  }

  clear(): void {
    this.points = [];
    this.verts = null;
    this.splits = [];
    this.selectedVertex = -1;
    this.undoStack = [];
    this.redoStack = [];
    this.rebuildVisuals();
    this.emitChange();
  }

  dispose(): void {
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("mouseup", this.handleMouseUp, true);
    this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.clearVisualGroup();
    this.labels.forEach((label) => label.remove());
    this.labels = [];
    this.labelContainer.remove();
    this.callbacks = null;
  }

  private snapshot(): CabinetSnapshot {
    return {
      points: this.points.map(clonePoint),
      verts: this.verts?.map(clonePoint) ?? null,
      splits: [...this.splits],
    };
  }

  private restore(snapshot: CabinetSnapshot): void {
    this.points = snapshot.points.map(clonePoint);
    this.verts = snapshot.verts?.map(clonePoint) ?? null;
    this.splits = [...snapshot.splits];
    this.selectedVertex = -1;
    this.rebuildVisuals();
    this.emitChange();
  }

  private commit(before: CabinetSnapshot, label = "屏柜编辑"): void {
    this.undoStack.push(before);
    this.redoStack = [];
    this.callbacks?.onHistory?.(before, this.snapshot(), label);
    this.rebuildVisuals();
    this.emitChange();
  }

  private state(): SpaceCabinetState {
    return {
      cornerCount: this.verts ? 4 : this.points.length,
      cabinetCount: this.verts ? this.splits.length + 1 : 0,
      hasDraft: this.hasDraft(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  private emitChange(): void {
    this.callbacks?.onChange(this.state());
  }

  private placePoint(point: Vec3): void {
    if (this.points.length >= 4 || this.verts) return;
    const before = this.snapshot();
    this.points.push(clonePoint(point));
    if (this.points.length === 4) {
      const verts = buildOrthogonalCabinetVerts(this.points[0], this.points[1], this.points[2], this.points[3]);
      if (!verts) {
        this.points.pop();
        return;
      }
      this.points = [];
      this.verts = verts;
    }
    this.commit(before, this.verts ? "生成屏柜" : "绘制屏柜点");
  }

  private moveVertex(index: number, position: Vec3): void {
    if (!this.verts || !RED_VERTICES.has(index)) return;
    this.verts[index] = clonePoint(position);
    const corrected = buildOrthogonalCabinetVerts(this.verts[0], this.verts[1], this.verts[2], this.verts[6]);
    if (corrected) this.verts = corrected;
    this.rebuildVisuals();
  }

  private addSplit(amount: number): void {
    if (!this.verts) return;
    const before = this.snapshot();
    this.splits.push(amount);
    this.commit(before, "添加屏柜分隔");
  }

  private splitCorners(amount: number): Vec3[] {
    if (!this.verts) return [];
    return [
      lerp(this.verts[0], this.verts[1], amount),
      lerp(this.verts[3], this.verts[2], amount),
      lerp(this.verts[4], this.verts[5], amount),
      lerp(this.verts[7], this.verts[6], amount),
    ];
  }

  private canHandlePointer(): boolean {
    return this.enabled && !this.host.closest("[data-space-edit-busy='true']");
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.canHandlePointer()) return;
    const flags = window as Window & { __clipDragging?: boolean; __drawingDragging?: boolean };
    if (flags.__clipDragging || flags.__drawingDragging) return;
    this.mouseDown = { x: event.clientX, y: event.clientY };
    if (!this.verts) return;

    const vertex = this.hitTestVertex(this.mousePosition(event));
    if (vertex < 0) return;
    this.selectedVertex = vertex;
    this.dragBefore = this.snapshot();
    flags.__drawingDragging = true;
    this.consumePointer(event);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.selectedVertex < 0 || !this.dragBefore) return;
    const position = this.dragPosition(this.mousePosition(event));
    if (!position) return;
    this.moveVertex(this.selectedVertex, position);
    this.consumePointer(event);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    const start = this.mouseDown;
    this.mouseDown = null;
    if (event.button !== 0) return;
    const flags = window as Window & { __drawingDragging?: boolean };

    if (this.selectedVertex >= 0 && this.dragBefore) {
      const before = this.dragBefore;
      const mouse = this.mousePosition(event);
      const snap = this.pickPoint(mouse);
      if (snap) this.moveVertex(this.selectedVertex, snap);
      this.selectedVertex = -1;
      this.dragBefore = null;
      flags.__drawingDragging = false;
      const after = this.snapshot();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        this.undoStack.push(before);
        this.redoStack = [];
        this.callbacks?.onHistory?.(before, after, "移动屏柜顶点");
      }
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }
    flags.__drawingDragging = false;
    if (!start || !this.canHandlePointer()) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_THRESHOLD) return;

    const mouse = this.mousePosition(event);
    if (this.verts) {
      const amount = this.hitTestFrontBottomEdge(mouse);
      if (amount != null) {
        this.addSplit(amount);
        this.consumePointer(event);
      }
      return;
    }

    const point = this.pickPoint(mouse);
    if (!point) return;
    this.placePoint(point);
    this.consumePointer(event);
  };

  private consumePointer(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.viewer.controls?.stop?.();
  }

  private mousePosition(event: MouseEvent): { x: number; y: number } {
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
  }

  private pickPoint(mouse: { x: number; y: number }): Vec3 | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const pick = this.potree.Utils?.getMousePointCloudIntersection;
    if (!camera || !pick || this.viewer.scene.pointclouds.length === 0) return null;
    try {
      const result = pick(mouse, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
      if (!result) return null;
      const point: Vec3 = [result.location.x, result.location.y, result.location.z];
      return finitePoint(point) ? point : null;
    } catch {
      return null;
    }
  }

  private mouseRay(camera: PotreeCamera, mouse: { x: number; y: number }): PotreeRay | null {
    const mouseToRay = this.potree.Utils?.mouseToRay;
    if (!mouseToRay) return null;
    const element = this.viewer.renderer.domElement;
    try {
      return mouseToRay(mouse, camera, element.clientWidth, element.clientHeight);
    } catch {
      return null;
    }
  }

  private dragPosition(mouse: { x: number; y: number }): Vec3 | null {
    if (!this.verts || this.selectedVertex < 0) return null;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    const ray = this.mouseRay(camera, mouse);
    if (!ray || Math.abs(ray.direction.z) < 1e-8) return null;
    const planeZ = this.verts[this.selectedVertex][2];
    const amount = (planeZ - ray.origin.z) / ray.direction.z;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      planeZ,
    ];
  }

  private hitTestVertex(mouse: { x: number; y: number }): number {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera || !this.verts) return -1;
    let result = -1;
    let bestDistance = VERTEX_HIT_DISTANCE_SQ;
    this.verts.forEach((point, index) => {
      if (!RED_VERTICES.has(index)) return;
      const projected = this.projectPoint(point, camera);
      if (!projected) return;
      const distance = (projected.x - mouse.x) ** 2 + (projected.y - mouse.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        result = index;
      }
    });
    return result;
  }

  private hitTestFrontBottomEdge(mouse: { x: number; y: number }): number | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera || !this.verts) return null;
    const first = this.projectPoint(this.verts[0], camera);
    const second = this.projectPoint(this.verts[1], camera);
    if (!first || !second) return null;
    if (distanceSquaredToSegment(mouse.x, mouse.y, first.x, first.y, second.x, second.y) > EDGE_HIT_DISTANCE_SQ) return null;

    const screenDx = second.x - first.x;
    const screenDy = second.y - first.y;
    const screenLength = screenDx * screenDx + screenDy * screenDy;
    const screenAmount = screenLength > 0
      ? Math.max(0, Math.min(1, ((mouse.x - first.x) * screenDx + (mouse.y - first.y) * screenDy) / screenLength))
      : 0.5;
    const ray = this.mouseRay(camera, mouse);
    const rayAmount = ray ? this.rayEdgeParam(ray, this.verts[0], this.verts[1]) : null;
    return Math.max(0.05, Math.min(0.95, rayAmount ?? screenAmount));
  }

  private rayEdgeParam(ray: PotreeRay, first: Vec3, second: Vec3): number | null {
    const rayDirection: Vec3 = [ray.direction.x, ray.direction.y, ray.direction.z];
    const edge = subtract(second, first);
    const offset: Vec3 = [ray.origin.x - first[0], ray.origin.y - first[1], ray.origin.z - first[2]];
    const a = dot(rayDirection, rayDirection);
    const b = dot(rayDirection, edge);
    const c = dot(edge, edge);
    const d = dot(rayDirection, offset);
    const e = dot(edge, offset);
    const denominator = a * c - b * b;
    return Math.abs(denominator) > 1e-9 ? (a * e - b * d) / denominator : null;
  }

  private projectPoint(point: Vec3, camera: PotreeCamera): { x: number; y: number } | null {
    const projected = new this.three.Vector3(...point).project(camera) as PotreeThreeVector3;
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)
      || projected.z < -1 || projected.z > 1) return null;
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: (projected.x + 1) * 0.5 * bounds.width,
      y: (1 - projected.y) * 0.5 * bounds.height,
    };
  }

  private rebuildVisuals(): void {
    this.clearVisualGroup();
    const origin = this.verts?.[0] ?? this.points[0];
    if (!origin) {
      this.syncLabels();
      return;
    }

    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    if (this.verts) {
      this.addLines(group, RED_EDGES.flatMap(([from, to]) => [this.verts![from], this.verts![to]]), origin, CABINET_RED);
      const greenLines: Vec3[] = GREEN_EDGES.flatMap(([from, to]) => [this.verts![from], this.verts![to]]);
      const splitRedPoints: Vec3[] = [];
      const splitGreenPoints: Vec3[] = [];
      this.splits.forEach((amount) => {
        const corners = this.splitCorners(amount);
        if (corners.length !== 4) return;
        greenLines.push(corners[0], corners[1], corners[2], corners[3], corners[0], corners[2], corners[1], corners[3]);
        splitRedPoints.push(corners[0]);
        splitGreenPoints.push(corners[1], corners[2], corners[3]);
      });
      this.addLines(group, greenLines, origin, CABINET_GREEN);
      this.addPoints(group, this.verts.filter((_point, index) => RED_VERTICES.has(index)), origin, CABINET_RED);
      this.addPoints(group, this.verts.filter((_point, index) => !RED_VERTICES.has(index)), origin, CABINET_GREEN);
      this.addPoints(group, splitRedPoints, origin, CABINET_RED);
      this.addPoints(group, splitGreenPoints, origin, CABINET_GREEN);
      if (this.selectedVertex >= 0) this.addPoints(group, [this.verts[this.selectedVertex]], origin, CABINET_SELECTED, POINT_SCALE * 1.25);
    } else {
      const lines: Vec3[] = [];
      for (let index = 1; index < this.points.length; index += 1) lines.push(this.points[index - 1], this.points[index]);
      this.addLines(group, lines, origin, CABINET_RED);
      this.addPoints(group, this.points, origin, CABINET_RED);
    }
    this.visualGroup = group;
    this.scene.add(group);
    this.syncLabels();
  }

  private clearVisualGroup(): void {
    if (!this.visualGroup) return;
    this.scene.remove(this.visualGroup);
    disposeObject(this.visualGroup);
    this.visualGroup = null;
  }

  private addLines(group: PotreeThreeObject3D, points: Vec3[], origin: Vec3, color: number): void {
    if (points.length < 2) return;
    const geometry = new this.three.BoxGeometry(1, 1, 1);
    const material = new this.three.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
    let count = 0;
    for (let index = 0; index + 1 < points.length; index += 2) {
      const from = subtract(points[index], origin);
      const to = subtract(points[index + 1], origin);
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dz = to[2] - from[2];
      const length = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(length) || length <= 1e-8) continue;
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
      mesh.scale.set(LINE_THICKNESS, LINE_THICKNESS, length);
      if (Math.abs(dy / length) > 0.999) mesh.up.set(1, 0, 0);
      mesh.lookAt(to[0], to[1], to[2]);
      group.add(mesh);
      count += 1;
    }
    if (count === 0) {
      geometry.dispose();
      material.dispose();
    }
  }

  private addPoints(group: PotreeThreeObject3D, points: Vec3[], origin: Vec3, color: number, size = POINT_SCALE): void {
    if (points.length === 0) return;
    const geometry = new this.three.SphereGeometry(1, 12, 8);
    const material = new this.three.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
    points.forEach((point) => {
      const local = subtract(point, origin);
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set(local[0], local[1], local[2]);
      mesh.scale.set(size, size, size);
      group.add(mesh);
    });
  }

  private createLabelContainer(): HTMLDivElement {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "16",
    });
    this.host.appendChild(container);
    return container;
  }

  private createLabel(): HTMLDivElement {
    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      display: "none",
      color: "#ff2a1a",
      fontSize: "18px",
      fontWeight: "700",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      textShadow: "0 0 3px #000, 0 0 3px #000",
      transform: "translate(-50%, -105%)",
    });
    this.labelContainer.appendChild(label);
    return label;
  }

  private syncLabels(): void {
    while (this.labels.length < this.cabinetNames.length) this.labels.push(this.createLabel());
    while (this.labels.length > this.cabinetNames.length) this.labels.pop()?.remove();
  }

  private topCenters(): Vec3[] {
    if (!this.verts) return [];
    const bounds = [0, ...this.splits.filter((value) => Number.isFinite(value) && value > 0 && value < 1)
      .sort((left, right) => left - right), 1];
    const upOffset = scale(subtract(this.verts[3], this.verts[0]), 0.04);
    return bounds.slice(0, -1).map((start, index) => {
      const amount = (start + bounds[index + 1]) / 2;
      const front = lerp(this.verts![3], this.verts![2], amount);
      const back = lerp(this.verts![7], this.verts![6], amount);
      return add(scale(add(front, back), 0.5), upOffset);
    });
  }

  private updateLabels(camera: PotreeCamera): void {
    if (!this.enabled || !this.verts) {
      this.labels.forEach((label) => { label.style.display = "none"; });
      return;
    }
    const centers = this.topCenters();
    this.labels.forEach((label, index) => {
      const name = this.cabinetNames[index]?.trim();
      const center = centers[index];
      const projected = center ? this.projectPoint(center, camera) : null;
      if (!name || !projected) {
        label.style.display = "none";
        return;
      }
      label.textContent = name;
      label.style.left = `${projected.x}px`;
      label.style.top = `${projected.y}px`;
      label.style.display = "block";
    });
  }

  private readonly renderOverlay = (): void => {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return;
    if (this.visualGroup) this.viewer.renderer.render(this.scene, camera);
    this.updateLabels(camera);
  };
}
