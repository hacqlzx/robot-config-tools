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
import type { SpaceChargingAreaCallbacks, SpaceChargingAreaState } from "./types";

type Vec3 = [number, number, number];

const CHARGING_ORANGE = 0xff8c1a;
const LINE_THICKNESS = 0.01;
const HIGHLIGHT_THICKNESS = 0.025;
const POINT_SCALE = 0.06;
const MOVE_STEP = 0.1;
const CLICK_THRESHOLD = 3;
const EDGE_HIT_DISTANCE_SQ = 144;
const BOX_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

interface ChargingSnapshot {
  points: Vec3[];
  box: Vec3[] | null;
  height: number;
  selected: boolean;
}

function clonePoint(point: Vec3): Vec3 {
  return [point[0], point[1], point[2]];
}

function finitePoint(point: Vec3 | undefined): point is Vec3 {
  return !!point && point.every(Number.isFinite);
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

function orthogonalBoxFromThreePoints(
  first: Vec3,
  second: Vec3,
  third: Vec3,
  baseZ: number,
  height: number,
): Vec3[] | null {
  const edgeX = second[0] - first[0];
  const edgeY = second[1] - first[1];
  const edgeLength = Math.hypot(edgeX, edgeY);
  if (edgeLength < 1e-4 || height <= 0) return null;

  const normalX = -edgeY / edgeLength;
  const normalY = edgeX / edgeLength;
  const width = (third[0] - first[0]) * normalX + (third[1] - first[1]) * normalY;
  if (Math.abs(width) < 1e-4) return null;

  const offsetX = normalX * width;
  const offsetY = normalY * width;
  const c0: Vec3 = [first[0], first[1], baseZ];
  const c1: Vec3 = [second[0], second[1], baseZ];
  const c2: Vec3 = [second[0] + offsetX, second[1] + offsetY, baseZ];
  const c3: Vec3 = [first[0] + offsetX, first[1] + offsetY, baseZ];
  return [
    c0, c1, c2, c3,
    [c0[0], c0[1], baseZ + height],
    [c1[0], c1[1], baseZ + height],
    [c2[0], c2[1], baseZ + height],
    [c3[0], c3[1], baseZ + height],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(value: Vec3): { axis: Vec3; length: number } | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-8
    ? { axis: [value[0] / length, value[1] / length, value[2] / length], length }
    : null;
}

export class PotreeChargingAreaEditor {
  private readonly scene: PotreeThreeObject3D;
  private readonly labelContainer: HTMLDivElement;
  private readonly labelElement: HTMLDivElement;
  private visualGroup: PotreeThreeObject3D | null = null;
  private callbacks: SpaceChargingAreaCallbacks | null = null;
  private points: Vec3[] = [];
  private box: Vec3[] | null = null;
  private height = 1;
  private groundZ = Number.NaN;
  private enabled = false;
  private active = true;
  private selected = false;
  private mouseDown: { x: number; y: number } | null = null;
  private undoStack: ChargingSnapshot[] = [];
  private redoStack: ChargingSnapshot[] = [];

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
  ) {
    this.scene = new three.Scene();
    this.labelContainer = this.createLabelContainer();
    this.labelElement = this.createLabel();
    this.host.addEventListener("mousedown", this.handleMouseDown, true);
    this.host.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("keydown", this.handleKeyDown);
    this.viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
  }

  start(callbacks: SpaceChargingAreaCallbacks, groundZ: number): void {
    this.callbacks = callbacks;
    this.groundZ = groundZ;
    this.enabled = true;
    this.resetDraft();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.mouseDown = null;
    if (!enabled && this.selected) {
      this.selected = false;
      this.rebuildVisuals();
    }
    this.emitChange();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.mouseDown = null;
    if (!active) this.viewer.controls?.stop?.();
  }

  setHeight(height: number): void {
    if (!Number.isFinite(height) || height <= 0) return;
    if (!this.box) {
      this.height = height;
      this.emitChange();
      return;
    }
    const before = this.snapshot();
    this.height = height;
    const baseZ = this.box.slice(0, 4).reduce((sum, point) => sum + point[2], 0) / 4;
    for (let index = 4; index < 8; index += 1) this.box[index][2] = baseZ + height;
    this.commit(before, "调整充电区域高度");
  }

  getBoxVerts(): number[][] | null {
    return this.box?.map(clonePoint) ?? null;
  }

  hasBox(): boolean {
    return this.box !== null;
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
    this.restore(snapshot as ChargingSnapshot);
  }

  clear(): void {
    this.resetDraft();
  }

  dispose(): void {
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    this.host.removeEventListener("mouseup", this.handleMouseUp, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.clearVisualGroup();
    this.labelContainer.remove();
    this.callbacks = null;
  }

  private resetDraft(): void {
    this.points = [];
    this.box = null;
    this.selected = false;
    this.undoStack = [];
    this.redoStack = [];
    this.rebuildVisuals();
    this.emitChange();
  }

  private snapshot(): ChargingSnapshot {
    return {
      points: this.points.map(clonePoint),
      box: this.box?.map(clonePoint) ?? null,
      height: this.height,
      selected: this.selected,
    };
  }

  private restore(snapshot: ChargingSnapshot): void {
    this.points = snapshot.points.map(clonePoint);
    this.box = snapshot.box?.map(clonePoint) ?? null;
    this.height = snapshot.height;
    this.selected = snapshot.selected && !!this.box;
    this.rebuildVisuals();
    this.emitChange();
  }

  private commit(before: ChargingSnapshot, label = "充电区域编辑"): void {
    this.undoStack.push(before);
    this.redoStack = [];
    this.callbacks?.onHistory?.(before, this.snapshot(), label);
    this.rebuildVisuals();
    this.emitChange();
  }

  private state(): SpaceChargingAreaState {
    return {
      pointCount: this.box ? 3 : this.points.length,
      height: this.height,
      hasBox: !!this.box,
      selected: this.selected,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  private emitChange(): void {
    this.callbacks?.onChange(this.state());
  }

  private placePoint(point: Vec3): void {
    if (this.points.length >= 3) return;
    const before = this.snapshot();
    this.points.push(clonePoint(point));
    if (this.points.length === 3) {
      const baseZ = Number.isFinite(this.groundZ)
        ? this.groundZ
        : Math.min(...this.points.map((value) => value[2]));
      const box = orthogonalBoxFromThreePoints(
        this.points[0],
        this.points[1],
        this.points[2],
        baseZ,
        this.height,
      );
      if (!box) {
        this.points.pop();
        return;
      }
      this.points[2] = clonePoint(box[2]);
      this.box = box;
    }
    this.commit(before, this.box ? "生成充电区域" : "绘制充电区域点");
  }

  private moveBox(dx: number, dy: number): void {
    if (!this.box) return;
    const before = this.snapshot();
    this.box.forEach((point) => {
      point[0] += dx;
      point[1] += dy;
    });
    this.commit(before, "移动充电区域");
  }

  private deleteBox(): void {
    if (!this.box) return;
    const before = this.snapshot();
    this.points = [];
    this.box = null;
    this.selected = false;
    this.commit(before, "删除充电区域");
    this.callbacks?.onDelete();
  }

  private canHandlePointer(): boolean {
    if (!this.active) return false;
    if (this.enabled) return true;
    const mode = (window as Window & { __spaceEditInteractionMode?: string }).__spaceEditInteractionMode;
    return !!this.box && (!mode || mode === "idle");
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.canHandlePointer()) return;
    const flags = window as Window & { __clipDragging?: boolean; __drawingDragging?: boolean };
    if (flags.__clipDragging || flags.__drawingDragging) return;
    this.mouseDown = { x: event.clientX, y: event.clientY };
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (!this.active) return;
    const start = this.mouseDown;
    this.mouseDown = null;
    if (event.button !== 0 || !start || !this.canHandlePointer()) return;
    const flags = window as Window & { __clipDragging?: boolean; __drawingDragging?: boolean };
    if (flags.__clipDragging || flags.__drawingDragging) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_THRESHOLD) return;

    const mouse = this.mousePosition(event);
    if (this.box) {
      const selected = this.hitTestBox(mouse);
      if (selected !== this.selected) {
        this.selected = selected;
        this.rebuildVisuals();
        this.emitChange();
      }
      if (selected) this.consumePointer(event);
      return;
    }

    if (!this.enabled) return;
    const point = this.pickPoint(mouse);
    if (!point) return;
    this.placePoint(point);
    this.consumePointer(event);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (!this.selected || !this.box) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteBox();
      return;
    }
    switch (event.key) {
      case "ArrowUp": event.preventDefault(); this.moveBox(0, MOVE_STEP); break;
      case "ArrowDown": event.preventDefault(); this.moveBox(0, -MOVE_STEP); break;
      case "ArrowLeft": event.preventDefault(); this.moveBox(-MOVE_STEP, 0); break;
      case "ArrowRight": event.preventDefault(); this.moveBox(MOVE_STEP, 0); break;
    }
  };

  private consumePointer(event: MouseEvent): void {
    event.preventDefault();
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
    if (!camera) return null;
    const pick = this.potree.Utils?.getMousePointCloudIntersection;
    if (pick && this.viewer.scene.pointclouds.length > 0) {
      try {
        const result = pick(mouse, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
        if (result) {
          const point: Vec3 = [result.location.x, result.location.y, result.location.z];
          if (finitePoint(point)) return point;
        }
      } catch {
        // Fall through to the ground plane for sparse or not-yet-loaded nodes.
      }
    }
    return this.intersectGround(camera, mouse);
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

  private intersectGround(camera: PotreeCamera, mouse: { x: number; y: number }): Vec3 | null {
    if (!Number.isFinite(this.groundZ)) return null;
    const ray = this.mouseRay(camera, mouse);
    if (!ray || Math.abs(ray.direction.z) < 1e-8) return null;
    const amount = (this.groundZ - ray.origin.z) / ray.direction.z;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      this.groundZ,
    ];
  }

  private hitTestBox(mouse: { x: number; y: number }): boolean {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera || !this.box) return false;
    const ray = this.mouseRay(camera, mouse);
    if (ray && this.rayHitsBox(ray, this.box)) return true;

    const projected = this.box.map((point) => this.projectPoint(point, camera));
    if (projected.some((point) => !point)) return false;
    return BOX_EDGES.some(([from, to]) => {
      const a = projected[from]!;
      const b = projected[to]!;
      return distanceSquaredToSegment(mouse.x, mouse.y, a.x, a.y, b.x, b.y) <= EDGE_HIT_DISTANCE_SQ;
    });
  }

  private rayHitsBox(ray: PotreeRay, box: Vec3[]): boolean {
    const origin: Vec3 = [ray.origin.x, ray.origin.y, ray.origin.z];
    const direction: Vec3 = [ray.direction.x, ray.direction.y, ray.direction.z];
    const basis = [subtract(box[1], box[0]), subtract(box[3], box[0]), subtract(box[4], box[0])]
      .map(normalize);
    if (basis.some((value) => !value)) return false;

    const relativeOrigin = subtract(origin, box[0]);
    let near = 0;
    let far = Number.POSITIVE_INFINITY;
    for (const value of basis) {
      if (!value) return false;
      const originAmount = dot(relativeOrigin, value.axis);
      const directionAmount = dot(direction, value.axis);
      const tolerance = Math.max(value.length * 0.015, 0.005);
      const min = -tolerance;
      const max = value.length + tolerance;
      if (Math.abs(directionAmount) < 1e-9) {
        if (originAmount < min || originAmount > max) return false;
        continue;
      }
      let first = (min - originAmount) / directionAmount;
      let second = (max - originAmount) / directionAmount;
      if (first > second) [first, second] = [second, first];
      near = Math.max(near, first);
      far = Math.min(far, second);
      if (near > far) return false;
    }
    return far >= 0;
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
    const source = this.box ?? this.points;
    const origin = source[0];
    if (!origin) {
      this.labelElement.style.display = "none";
      return;
    }

    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    if (this.box) {
      const segments = BOX_EDGES.flatMap(([from, to]) => [this.box![from], this.box![to]]);
      this.addLines(group, segments, origin, this.selected ? HIGHLIGHT_THICKNESS : LINE_THICKNESS);
    } else {
      const segments: Vec3[] = [];
      for (let index = 1; index < this.points.length; index += 1) {
        segments.push(this.points[index - 1], this.points[index]);
      }
      this.addLines(group, segments, origin, LINE_THICKNESS);
      this.addPoints(group, this.points, origin);
    }
    this.visualGroup = group;
    this.scene.add(group);
  }

  private clearVisualGroup(): void {
    if (!this.visualGroup) return;
    this.scene.remove(this.visualGroup);
    disposeObject(this.visualGroup);
    this.visualGroup = null;
  }

  private localPoint(point: Vec3, origin: Vec3): Vec3 {
    return [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  }

  private addLines(group: PotreeThreeObject3D, points: Vec3[], origin: Vec3, thickness: number): void {
    if (points.length === 0) return;
    const geometry = new this.three.BoxGeometry(1, 1, 1);
    const material = new this.three.MeshBasicMaterial({ color: CHARGING_ORANGE, depthTest: true, depthWrite: true });
    let count = 0;
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
      group.add(mesh);
      count += 1;
    }
    if (count === 0) {
      geometry.dispose();
      material.dispose();
    }
  }

  private addPoints(group: PotreeThreeObject3D, points: Vec3[], origin: Vec3): void {
    if (points.length === 0) return;
    const geometry = new this.three.SphereGeometry(1, 12, 8);
    const material = new this.three.MeshBasicMaterial({ color: CHARGING_ORANGE, depthTest: true, depthWrite: true });
    points.forEach((point) => {
      const local = this.localPoint(point, origin);
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set(local[0], local[1], local[2]);
      mesh.scale.set(POINT_SCALE, POINT_SCALE, POINT_SCALE);
      group.add(mesh);
    });
  }

  private createLabelContainer(): HTMLDivElement {
    const container = document.createElement("div");
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
    const element = document.createElement("div");
    element.textContent = "充电区域";
    Object.assign(element.style, {
      position: "absolute",
      display: "none",
      color: "#ff8c00",
      fontSize: "18px",
      fontWeight: "700",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      textShadow: "0 0 3px #000, 0 0 3px #000",
      transform: "translate(-50%, -105%)",
    });
    this.labelContainer.appendChild(element);
    return element;
  }

  private topCenter(): Vec3 | null {
    if (!this.box) return null;
    const top = this.box.slice(4, 8);
    return [
      top.reduce((sum, point) => sum + point[0], 0) / 4,
      top.reduce((sum, point) => sum + point[1], 0) / 4,
      top.reduce((sum, point) => sum + point[2], 0) / 4,
    ];
  }

  private updateLabel(camera: PotreeCamera): void {
    const center = this.topCenter();
    const projected = center ? this.projectPoint(center, camera) : null;
    if (!projected) {
      this.labelElement.style.display = "none";
      return;
    }
    this.labelElement.style.left = `${projected.x}px`;
    this.labelElement.style.top = `${projected.y}px`;
    this.labelElement.style.display = "block";
  }

  private readonly renderOverlay = (): void => {
    if (!this.active) return;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return;
    if (this.visualGroup) this.viewer.renderer.render(this.scene, camera);
    this.updateLabel(camera);
  };
}
