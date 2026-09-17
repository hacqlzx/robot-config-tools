import {
  type PotreeCamera,
  type PotreeNamespace,
  type PotreePointCloud,
  type PotreePointCloudIntersection,
  type PotreeRay,
  type PotreeVisibleNode,
  type PotreeThreeDisposable,
  type PotreeThreeNamespace,
  type PotreeThreeObject3D,
  type PotreeThreeVector3,
  type PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { NormalAnnotationItem } from "../../hooks/drawing/drawing-schema";
import type { SpaceNormalAnnotationCallbacks } from "./types";
import type { SpaceInteractionCoordinator } from "./SpaceInteractionCoordinator";

type Vec3 = [number, number, number];

interface NormalSnapshot {
  items: NormalAnnotationItem[];
  selectedId: string | null;
}

interface PickResult {
  position: Vec3;
  normal: Vec3;
}

interface PointLocation {
  position: Vec3;
  pointcloud: PotreePointCloud;
}

interface SelectionCircle {
  center: { x: number; y: number };
  radius: number;
}

interface CircleSample {
  point: Vec3;
  screenX: number;
  screenY: number;
  screenDistance: number;
}

interface NormalHandle {
  id: string;
  kind: "origin" | "direction" | "circle";
}

const CLICK_THRESHOLD = 3;
const HANDLE_HIT_DISTANCE_SQ = 196;
const LINE_HIT_DISTANCE_SQ = 100;
const NORMAL_COLOR = 0xffd666;
const NORMAL_SELECTED_COLOR = 0xffe14b;
const ORIGIN_COLOR = 0xffd666;
const DIRECTION_HANDLE_COLOR = 0x40c4ff;
const NORMAL_LINE_THICKNESS = 0.008;
const CIRCLE_LINE_THICKNESS = 0.006;
const ORIGIN_SCALE = 0.045;
const END_SCALE = 0.035;
const CIRCLE_HANDLE_SCALE = 0.04;
const SELECTED_SCALE = 1.2;
const DEFAULT_LENGTH = 0.8;
const MAX_NORMAL_LENGTH = 1.6;
const MIN_NORMAL_LENGTH = 0.12;
const MIN_CIRCLE_DIAMETER = 0.02;
const MAX_NORMAL_NEIGHBORS = 64;
const MAX_NORMAL_NODES = 6;
const MIN_NORMAL_NEIGHBORS = 6;
const MIN_CIRCLE_RADIUS = 8;
const MAX_CIRCLE_SAMPLES = 192;
const MAX_CIRCLE_PICK_WINDOW = 257;
const SURFACE_PICK_WINDOW_SIZES = [5, 9, 15] as const;
const SURFACE_NORMAL_PICK_WINDOW = 11;
const NORMAL_VERTICAL_COMPONENT = 0.72;
const MIN_RAISED_ABOVE_SUPPORT = 0.02;

function finitePoint(value: unknown): value is Vec3 {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return false;
  const candidate = value as ArrayLike<unknown>;
  return candidate.length >= 3
    && Number.isFinite(Number(candidate[0]))
    && Number.isFinite(Number(candidate[1]))
    && Number.isFinite(Number(candidate[2]));
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
  return length > 1e-8 ? scale(value, 1 / length) : null;
}

function circleBasis(direction: Vec3): { first: Vec3; second: Vec3 } | null {
  const normal = normalize(direction);
  if (!normal) return null;
  const reference: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const first = normalize(cross(normal, reference));
  if (!first) return null;
  const second = normalize(cross(normal, first));
  return second ? { first, second } : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function lowerQuartile(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * 0.25)];
}

function preferUpwardNormal(normal: Vec3 | null): Vec3 | null {
  const normalized = normalize(normal ?? [0, 0, 0]);
  if (!normalized) return null;
  // A point-cloud plane has two equivalent directions. Keep the upward one
  // for a clearly downward vector so sparse object points cannot produce an
  // arrow into the supporting floor.
  return normalized[2] < -0.2 ? scale(normalized, -1) : normalized;
}

function isRaisedAboveSupport(origin: Vec3, points: Vec3[], localScale: number): boolean {
  if (points.length < 3) return false;
  const supportZ = lowerQuartile(points.map((point) => point[2]));
  return origin[2] - supportZ > Math.max(localScale * 3, MIN_RAISED_ABOVE_SUPPORT);
}

/** 求 3x3 对称协方差矩阵的最小特征向量，即局部点集的平面法线。 */
function smallestEigenvector(matrix: number[][]): Vec3 | null {
  const values = matrix.map((row) => [...row]);
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iteration = 0; iteration < 16; iteration += 1) {
    let p = 0;
    let q = 1;
    let largest = Math.abs(values[p][q]);
    for (let row = 0; row < 3; row += 1) {
      for (let column = row + 1; column < 3; column += 1) {
        if (Math.abs(values[row][column]) > largest) {
          largest = Math.abs(values[row][column]);
          p = row;
          q = column;
        }
      }
    }
    if (largest < 1e-12) break;

    const angle = 0.5 * Math.atan2(2 * values[p][q], values[q][q] - values[p][p]);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < 3; index += 1) {
      const rowP = values[p][index];
      const rowQ = values[q][index];
      values[p][index] = cosine * rowP - sine * rowQ;
      values[q][index] = sine * rowP + cosine * rowQ;
    }
    for (let index = 0; index < 3; index += 1) {
      const columnP = values[index][p];
      const columnQ = values[index][q];
      values[index][p] = cosine * columnP - sine * columnQ;
      values[index][q] = sine * columnP + cosine * columnQ;

      const vectorP = eigenvectors[index][p];
      const vectorQ = eigenvectors[index][q];
      eigenvectors[index][p] = cosine * vectorP - sine * vectorQ;
      eigenvectors[index][q] = sine * vectorP + cosine * vectorQ;
    }
  }

  let smallest = 0;
  if (values[1][1] < values[smallest][smallest]) smallest = 1;
  if (values[2][2] < values[smallest][smallest]) smallest = 2;
  return normalize([
    eigenvectors[0][smallest],
    eigenvectors[1][smallest],
    eigenvectors[2][smallest],
  ]);
}

function cloneItem(item: NormalAnnotationItem): NormalAnnotationItem {
  return {
    ...item,
    origin: [...item.origin] as Vec3,
    direction: [...item.direction] as Vec3,
  };
}

function cloneItems(items: NormalAnnotationItem[]): NormalAnnotationItem[] {
  return items.map(cloneItem);
}

function createId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `normal:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
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
  if (lengthSquared <= 1e-8) return (px - ax) ** 2 + (py - ay) ** 2;
  const amount = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const x = ax + dx * amount;
  const y = ay + dy * amount;
  return (px - x) ** 2 + (py - y) ** 2;
}

function disposeObject(root: PotreeThreeObject3D): void {
  const geometries = new Set<PotreeThreeDisposable>();
  const materials = new Set<PotreeThreeDisposable>();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else if (object.material) materials.add(object.material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function valueAsVec3(value: unknown): Vec3 | null {
  if (finitePoint(value)) return [Number(value[0]), Number(value[1]), Number(value[2])];
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate: Vec3 = [Number(record.x), Number(record.y), Number(record.z)];
  return candidate.every(Number.isFinite) ? candidate : null;
}

function transformPoint(point: Vec3, elements: ArrayLike<number>): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = elements[3] * x + elements[7] * y + elements[11] * z + elements[15];
  const divisor = Number.isFinite(w) && Math.abs(w) > 1e-8 ? w : 1;
  return [
    (elements[0] * x + elements[4] * y + elements[8] * z + elements[12]) / divisor,
    (elements[1] * x + elements[5] * y + elements[9] * z + elements[13]) / divisor,
    (elements[2] * x + elements[6] * y + elements[10] * z + elements[14]) / divisor,
  ];
}

function boundsCorners(bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): Vec3[] {
  const { min, max } = bounds;
  return [
    [min.x, min.y, min.z],
    [min.x, min.y, max.z],
    [min.x, max.y, min.z],
    [min.x, max.y, max.z],
    [max.x, min.y, min.z],
    [max.x, min.y, max.z],
    [max.x, max.y, min.z],
    [max.x, max.y, max.z],
  ];
}

function covarianceNormal(points: Vec3[]): Vec3 | null {
  if (points.length < 3) return null;
  const center = points.reduce<Vec3>(
    (sum, point) => add(sum, point),
    [0, 0, 0],
  );
  const centroid = scale(center, 1 / points.length);
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  points.forEach((point) => {
    const offset = subtract(point, centroid);
    covariance[0][0] += offset[0] * offset[0];
    covariance[0][1] += offset[0] * offset[1];
    covariance[0][2] += offset[0] * offset[2];
    covariance[1][1] += offset[1] * offset[1];
    covariance[1][2] += offset[1] * offset[2];
    covariance[2][2] += offset[2] * offset[2];
  });
  covariance[1][0] = covariance[0][1];
  covariance[2][0] = covariance[0][2];
  covariance[2][1] = covariance[1][2];
  return smallestEigenvector(covariance);
}

/**
 * Potree 版法线标注编辑器。
 *
 * LAS 点云通常没有法线属性，因此拾取时优先使用点云返回的 normal，
 * 否则从当前可见节点的邻近点估计局部平面法线，并统一朝向相机。
 */
export class PotreeNormalAnnotationEditor {
  private readonly scene: PotreeThreeObject3D;
  private readonly labelContainer: HTMLDivElement;
  private visualGroup: PotreeThreeObject3D | null = null;
  private labels: { position: Vec3; element: HTMLDivElement }[] = [];
  private callbacks: SpaceNormalAnnotationCallbacks | null = null;
  private items: NormalAnnotationItem[] = [];
  private enabled = false;
  private pageActive = true;
  private selectedId: string | null = null;
  private mouseDown: { x: number; y: number; point: { x: number; y: number } } | null = null;
  private selectionCircle: SelectionCircle | null = null;
  private drawingCircle = false;
  private readonly selectionCircleElement: HTMLDivElement;
  private pendingHandle: NormalHandle | null = null;
  private draggingHandle: NormalHandle | null = null;
  private dragBefore: NormalSnapshot | null = null;
  private readonly undoStack: NormalSnapshot[] = [];
  private readonly redoStack: NormalSnapshot[] = [];

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
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("blur", this.cancelDrag);
    this.selectionCircleElement = this.createSelectionCircle(this.labelContainer);
    viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
  }

  start(callbacks: SpaceNormalAnnotationCallbacks): void {
    this.callbacks = callbacks;
    this.emitChange();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelDragState(false);
    this.rebuildVisuals();
    this.emitChange();
  }

  setActive(active: boolean): void {
    this.pageActive = active;
    if (!active) {
      this.cancelDragState(false);
      this.viewer.controls?.stop?.();
    }
    this.rebuildVisuals();
  }

  setData(items: NormalAnnotationItem[]): void {
    // Stored v2 annotations are normalized once for rendering; manual
    // direction dragging remains free to point anywhere afterwards.
    this.items = items.map((item) => ({
      ...cloneItem(item),
      direction: preferUpwardNormal(item.direction) ?? [0, 0, 1],
    }));
    this.selectedId = this.items.some((item) => item.id === this.selectedId) ? this.selectedId : null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.cancelDragState(false);
    this.rebuildVisuals();
    this.emitChange();
  }

  getData(): NormalAnnotationItem[] {
    return cloneItems(this.items);
  }

  /** 复用法线标注的局部平面拟合，但不创建法线标注或展示采样范围。 */
  pickSurfaceNormal(mouse: { x: number; y: number }): { position: Vec3; direction: Vec3; length: number } | null {
    const picked = this.pickPoint(mouse);
    return picked
      ? { position: picked.position, direction: picked.normal, length: this.defaultLength() }
      : null;
  }

  select(id: string | null): void {
    const nextId = id && this.items.some((item) => item.id === id) ? id : null;
    if (nextId === this.selectedId) return;
    this.selectedId = nextId;
    this.rebuildVisuals();
    this.emitChange();
  }

  rename(id: string, name: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const nextName = name.trim();
    if (!nextName || item.name?.trim() === nextName) return;
    const before = this.snapshot();
    item.name = nextName;
    this.selectedId = id;
    this.commit(before, "修改法线名称");
  }

  bindPoint(id: string, point: { pointCode: string; pointName?: string }): void {
    const item = this.items.find((candidate) => candidate.id === id);
    const pointCode = point.pointCode.trim();
    if (!item || !pointCode) return;
    const before = this.snapshot();
    item.pointCode = pointCode;
    item.pointName = point.pointName?.trim() || undefined;
    this.selectedId = id;
    if (JSON.stringify(before.items) === JSON.stringify(this.items)) {
      this.rebuildVisuals();
      this.emitChange();
      return;
    }
    this.commit(before, "绑定法线点位");
  }

  unbindPoint(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || !item.pointCode) return;
    const before = this.snapshot();
    delete item.pointCode;
    delete item.pointName;
    this.selectedId = id;
    this.commit(before, "解绑法线点位");
  }

  delete(id: string): void {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const before = this.snapshot();
    this.items.splice(index, 1);
    if (this.selectedId === id) {
      this.selectedId = this.items[Math.min(index, this.items.length - 1)]?.id ?? null;
    }
    this.commit(before, "删除法线标注");
  }

  hasDraft(): boolean {
    return this.items.length > 0;
  }

  restoreSnapshot(snapshot: unknown): void {
    const value = snapshot as Partial<NormalSnapshot>;
    if (!Array.isArray(value.items)) return;
    this.items = cloneItems(value.items as NormalAnnotationItem[]);
    this.selectedId = typeof value.selectedId === "string" ? value.selectedId : null;
    this.rebuildVisuals();
    this.emitChange();
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(next);
  }

  clear(): void {
    this.items = [];
    this.selectedId = null;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.cancelDragState(false);
    this.rebuildVisuals();
    this.emitChange();
  }

  dispose(): void {
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("mouseup", this.handleMouseUp, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("blur", this.cancelDrag);
    this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.clearVisualGroup();
    this.labelContainer.remove();
    this.callbacks = null;
  }

  private snapshot(): NormalSnapshot {
    return { items: cloneItems(this.items), selectedId: this.selectedId };
  }

  private commit(before: NormalSnapshot, label: string): void {
    this.undoStack.push(before);
    this.redoStack.length = 0;
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.callbacks?.onHistory?.(before, this.snapshot(), label);
    this.rebuildVisuals();
    this.emitChange();
  }

  private commitIfChanged(before: NormalSnapshot, label: string): boolean {
    if (JSON.stringify(before.items) === JSON.stringify(this.items)) return false;
    this.commit(before, label);
    return true;
  }

  private emitChange(): void {
    this.callbacks?.onChange({ count: this.items.length, selectedId: this.selectedId, active: this.enabled });
  }

  private canHandlePointer(): boolean {
    if (!this.pageActive || !this.enabled) return false;
    return this.interactions.isMode("normal")
      && !this.interactions.hasAnyClaim("drawing-drag", "path-selection")
      && !this.host.closest("[data-space-edit-busy='true']");
  }

  private isOverlayEvent(event: Event): boolean {
    return event.target instanceof Element
      && !!event.target.closest("[data-space-edit-overlay]");
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    // Only creating a new circle requires Alt. Existing handles remain
    // directly draggable with the ordinary left button.
    if (event.button !== 0 || this.isOverlayEvent(event) || !this.canHandlePointer()) return;
    const mouse = this.mousePosition(event);
    const handle = this.hitTestHandle(mouse);
    if (!event.altKey && !handle) return;
    this.mouseDown = { x: event.clientX, y: event.clientY, point: mouse };
    this.pendingHandle = handle;
    if (this.pendingHandle) this.selectedId = this.pendingHandle.id;
    else this.selectedId = null;
    this.rebuildVisuals();
    this.emitChange();
    // Claim the gesture before Potree controls see the mousedown. Plain left
    // drag on empty space is left untouched for camera rotation.
    this.consumePointer(event);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.pageActive || !this.mouseDown) return;
    if (!this.draggingHandle && this.pendingHandle
      && Math.hypot(event.clientX - this.mouseDown.x, event.clientY - this.mouseDown.y) > CLICK_THRESHOLD) {
      this.draggingHandle = this.pendingHandle;
      this.pendingHandle = null;
      this.dragBefore = this.snapshot();
      this.interactions.setClaim("drawing-drag", true);
    }
    if (this.draggingHandle) {
      const item = this.items.find((candidate) => candidate.id === this.draggingHandle?.id);
      if (!item) return;
      const mouse = this.mousePosition(event);
      if (this.draggingHandle.kind === "origin") {
        const picked = this.pickPoint(mouse);
        if (picked) item.origin = picked.position;
      } else if (this.draggingHandle.kind === "direction") {
        const dragged = this.dragDirection(mouse, item);
        if (dragged) {
          item.direction = dragged.direction;
          item.length = dragged.length;
        }
      } else {
        const diameter = this.dragCircleDiameter(mouse, item);
        if (diameter) item.diameter = diameter;
      }
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }

    if (!this.pendingHandle && !this.drawingCircle) {
      const radius = Math.hypot(event.clientX - this.mouseDown.x, event.clientY - this.mouseDown.y);
      if (radius > CLICK_THRESHOLD) {
        this.drawingCircle = true;
        this.interactions.setClaim("drawing-drag", true);
      }
    }

    if (this.drawingCircle) {
      const radius = Math.hypot(event.clientX - this.mouseDown.x, event.clientY - this.mouseDown.y);
      this.selectionCircle = { center: this.mouseDown.point, radius };
      this.updateSelectionCircle();
      this.consumePointer(event);
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.pageActive) return;
    if (this.draggingHandle && this.dragBefore) {
      const item = this.items.find((candidate) => candidate.id === this.draggingHandle?.id);
      if (item) {
        const mouse = this.mousePosition(event);
        if (this.draggingHandle.kind === "origin") {
          const picked = this.pickPoint(mouse);
          if (picked) item.origin = picked.position;
        } else if (this.draggingHandle.kind === "direction") {
          const dragged = this.dragDirection(mouse, item);
          if (dragged) {
            item.direction = dragged.direction;
            item.length = dragged.length;
          }
        } else {
          const diameter = this.dragCircleDiameter(mouse, item);
          if (diameter) item.diameter = diameter;
        }
      }
      const before = this.dragBefore;
      const label = this.draggingHandle.kind === "origin"
        ? "移动法线标注点"
        : this.draggingHandle.kind === "direction" ? "调整法线方向和长度" : "调整法线采样范围";
      this.draggingHandle = null;
      this.dragBefore = null;
      this.mouseDown = null;
      this.interactions.setClaim("drawing-drag", false);
      if (!this.commitIfChanged(before, label)) {
        this.rebuildVisuals();
        this.emitChange();
      }
      this.consumePointer(event);
      return;
    }

    const start = this.mouseDown;
    const pendingHandle = this.pendingHandle;
    const pointerDistance = start
      ? Math.hypot(event.clientX - start.x, event.clientY - start.y)
      : 0;
    const circle = this.drawingCircle
      ? (this.selectionCircle ?? { center: start?.point ?? this.mousePosition(event), radius: pointerDistance })
      : null;
    this.mouseDown = null;
    this.pendingHandle = null;
    this.selectionCircle = null;
    this.drawingCircle = false;
    this.hideSelectionCircle();
    this.interactions.setClaim("drawing-drag", false);
    if (!start || !this.canHandlePointer()) {
      return;
    }
    if (pendingHandle) {
      this.selectedId = pendingHandle.id;
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }

    if (circle && circle.radius >= MIN_CIRCLE_RADIUS) {
      this.interactions.setClaim("drawing-drag", false);
      this.createNormalFromCircle(circle);
      this.consumePointer(event);
      return;
    }
    this.interactions.setClaim("drawing-drag", false);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.pageActive || !this.enabled || (event.key !== "Delete" && event.key !== "Backspace")) return;
    if ((event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
    if (!this.selectedId || !this.canHandlePointer()) return;
    const before = this.snapshot();
    this.items = this.items.filter((item) => item.id !== this.selectedId);
    this.selectedId = null;
    event.preventDefault();
    event.stopPropagation();
    this.commit(before, "删除法线标注");
  };

  private readonly cancelDrag = (): void => {
    if (this.dragBefore) {
      const before = this.dragBefore;
      const label = this.draggingHandle?.kind === "origin"
        ? "移动法线标注点"
        : this.draggingHandle?.kind === "direction" ? "调整法线方向和长度" : "调整法线采样范围";
      this.draggingHandle = null;
      this.dragBefore = null;
      this.commitIfChanged(before, label);
    }
    this.cancelDragState(false);
  };

  private cancelDragState(recordHistory: boolean): void {
    if (recordHistory && this.dragBefore) {
      this.commitIfChanged(this.dragBefore, "编辑法线标注");
    }
    this.mouseDown = null;
    this.pendingHandle = null;
    this.draggingHandle = null;
    this.dragBefore = null;
    this.selectionCircle = null;
    this.drawingCircle = false;
    this.hideSelectionCircle();
    this.interactions.setClaim("drawing-drag", false);
  }

  private consumePointer(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.viewer.controls?.stop?.();
  }

  private mousePosition(event: MouseEvent): { x: number; y: number } {
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
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

  private pickIntersection(mouse: { x: number; y: number }): PotreePointCloudIntersection | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const ray = camera ? this.mouseRay(camera, mouse) : null;
    if (!camera || !ray || this.viewer.scene.pointclouds.length === 0) return null;

    const rayDirection = normalize([ray.direction.x, ray.direction.y, ray.direction.z]);
    if (!rayDirection) return null;
    const element = this.viewer.renderer.domElement;

    // Potree normally chooses the hit closest to the cursor inside a fairly
    // large pixel window. On a sparse foreground surface that can select a
    // background point visible through a sampling gap. Start with a small
    // window, prefer its front-most depth, and only expand when it is empty.
    for (const pickWindowSize of SURFACE_PICK_WINDOW_SIZES) {
      let closest: PotreePointCloudIntersection | null = null;
      let closestDepth = Number.POSITIVE_INFINITY;

      for (const pointcloud of this.viewer.scene.pointclouds) {
        if (!pointcloud.visible || !pointcloud.pick) continue;
        let picked: unknown;
        try {
          picked = pointcloud.pick(this.viewer, camera, ray, {
            pickClipped: true,
            x: mouse.x,
            y: element.clientHeight - mouse.y,
            pickWindowSize,
            all: true,
          });
        } catch {
          continue;
        }

        const candidates = Array.isArray(picked) ? picked : picked ? [picked] : [];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== "object") continue;
          const point = candidate as Record<string, unknown>;
          const position = valueAsVec3(point.position);
          if (!position) continue;
          const fromCamera = subtract(position, [ray.origin.x, ray.origin.y, ray.origin.z]);
          const depth = dot(fromCamera, rayDirection);
          if (!Number.isFinite(depth) || depth <= 0 || depth >= closestDepth) continue;
          const distance = Math.hypot(fromCamera[0], fromCamera[1], fromCamera[2]);
          closestDepth = depth;
          closest = {
            location: { x: position[0], y: position[1], z: position[2] },
            distance,
            pointcloud,
            point,
          };
        }
      }

      if (closest) return closest;
    }
    return null;
  }

  private pickLocation(mouse: { x: number; y: number }): PointLocation | null {
    const result = this.pickIntersection(mouse);
    if (!result) return null;
    const position: Vec3 = [result.location.x, result.location.y, result.location.z];
    return finitePoint(position) ? { position, pointcloud: result.pointcloud } : null;
  }

  private pickPoint(mouse: { x: number; y: number }): PickResult | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const result = this.pickIntersection(mouse);
    if (!camera || !result) return null;
    const position: Vec3 = [result.location.x, result.location.y, result.location.z];
    if (!finitePoint(position)) return null;
    const cameraNormal = this.cameraFacingNormal(mouse, camera);
    const normal = this.orientTowardCamera(
      this.pickNormal(result)
      ?? this.estimateScreenNormal(result.pointcloud, mouse, camera, position, cameraNormal)
      ?? this.estimateNormal(result, position, cameraNormal)
      ?? cameraNormal,
      position,
    );
    return normal ? { position, normal } : null;
  }

  private pickCircleSamples(
    circle: SelectionCircle,
    pointcloud: PotreePointCloud,
    camera: PotreeCamera,
  ): CircleSample[] {
    const ray = this.mouseRay(camera, circle.center);
    if (!pointcloud.pick || !ray) return [];

    const element = this.viewer.renderer.domElement;
    const pickWindowSize = Math.min(
      MAX_CIRCLE_PICK_WINDOW,
      Math.max(3, Math.floor(circle.radius * 2 + 1) | 1),
    );
    let picked: unknown;
    try {
      picked = pointcloud.pick(this.viewer, camera, ray, {
        pickClipped: true,
        x: circle.center.x,
        y: element.clientHeight - circle.center.y,
        pickWindowSize,
        all: true,
      });
    } catch {
      return [];
    }
    if (!Array.isArray(picked)) return [];

    const samples = picked.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const point = valueAsVec3((value as Record<string, unknown>).position);
      if (!point) return [];
      const projected = this.projectPoint(point, camera);
      if (!projected || projected.z < -1 || projected.z > 1) return [];
      const screenX = projected.x;
      const screenY = projected.y;
      const screenDistance = Math.hypot(screenX - circle.center.x, screenY - circle.center.y);
      if (screenDistance > circle.radius + 1) return [];
      return [{ point, screenX, screenY, screenDistance }];
    });
    if (samples.length <= MAX_CIRCLE_SAMPLES) return samples;

    // Potree may return one point for nearly every pixel in the window. Keep
    // a deterministic, screen-spread subset so fitting remains responsive.
    const limited: CircleSample[] = [];
    const step = samples.length / MAX_CIRCLE_SAMPLES;
    for (let index = 0; index < MAX_CIRCLE_SAMPLES; index += 1) {
      limited.push(samples[Math.min(samples.length - 1, Math.floor(index * step))]);
    }
    return limited;
  }

  private estimatePointSpacing(points: Vec3[]): number {
    const nearestDistances: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let other = 0; other < points.length; other += 1) {
        if (index === other) continue;
        const distance = Math.hypot(
          points[index][0] - points[other][0],
          points[index][1] - points[other][1],
          points[index][2] - points[other][2],
        );
        if (distance > 1e-6 && distance < nearest) nearest = distance;
      }
      if (Number.isFinite(nearest)) nearestDistances.push(nearest);
    }
    return median(nearestDistances);
  }

  private estimateCircleNormal(
    origin: Vec3,
    samples: CircleSample[],
    cameraNormal: Vec3 | null,
    worldDiameter: number,
  ): Vec3 | null {
    if (samples.length < 2) return null;
    const points = samples.map((sample) => sample.point);
    const localScale = Math.max(this.estimatePointSpacing([origin, ...points]), 1e-4);
    const tolerance = Math.max(localScale * 2.5, worldDiameter * 0.012, 1e-4);
    const raisedPick = isRaisedAboveSupport(origin, [origin, ...points], localScale);
    const verticalSpread = Math.sqrt(median(points.map((point) => (point[2] - origin[2]) ** 2)));
    const horizontalSpread = Math.sqrt(median(points.map((point) => (
      (point[0] - origin[0]) ** 2 + (point[1] - origin[1]) ** 2
    ))));
    const likelyVerticalSurface = verticalSpread > Math.max(localScale * 1.5, horizontalSpread * 0.25);

    let bestNormal: Vec3 | null = null;
    let bestScore = 0;
    let bestLateralNormal: Vec3 | null = null;
    let bestLateralScore = 0;
    for (let first = 0; first < points.length - 1; first += 1) {
      const firstVector = subtract(points[first], origin);
      for (let second = first + 1; second < points.length; second += 1) {
        const candidate = normalize(cross(firstVector, subtract(points[second], origin)));
        if (!candidate) continue;
        let inlierCount = 0;
        let residualScore = 0;
        points.forEach((point) => {
          const residual = Math.abs(dot(subtract(point, origin), candidate));
          if (residual > tolerance) return;
          inlierCount += 1;
          residualScore += 1 - residual / tolerance;
        });
        if (inlierCount < 3) continue;

        // Plane coverage is the primary criterion. The residual tie-breaker
        // keeps the result stable without letting the nearest samples win.
        const coverageScore = inlierCount * 10 + residualScore;
        const verticalSurfaceWeight = (likelyVerticalSurface || raisedPick)
          ? 0.05 + 0.95 * (1 - Math.min(1, Math.abs(candidate[2])))
          : 1;
        const weightedScore = coverageScore * verticalSurfaceWeight;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          bestNormal = candidate;
        }
        if ((likelyVerticalSurface || raisedPick)
          && Math.abs(candidate[2]) <= NORMAL_VERTICAL_COMPONENT
          && coverageScore > bestLateralScore) {
          bestLateralScore = coverageScore;
          bestLateralNormal = candidate;
        }
      }
    }

    if (!bestNormal) {
      const fallback = covarianceNormal([origin, ...points]);
      if (likelyVerticalSurface || raisedPick) {
        return this.lateralNormal(fallback, cameraNormal) ?? (raisedPick ? [0, 0, 1] : fallback);
      }
      return fallback;
    }
    if ((likelyVerticalSurface || raisedPick) && Math.abs(bestNormal[2]) > NORMAL_VERTICAL_COMPONENT) {
      bestNormal = bestLateralNormal
        ?? (likelyVerticalSurface ? this.lateralNormal(bestNormal, cameraNormal) : null)
        ?? (raisedPick ? [0, 0, 1] : bestNormal);
    }

    const inliers = points.filter((point) => (
      Math.abs(dot(subtract(point, origin), bestNormal as Vec3)) <= tolerance * 1.5
    ));
    const refined = covarianceNormal([origin, ...inliers]);
    if (!refined) return bestNormal;
    const alignedRefined = dot(refined, bestNormal) < 0 ? scale(refined, -1) : refined;
    return Math.abs(dot(alignedRefined, bestNormal)) >= 0.72 ? alignedRefined : bestNormal;
  }

  private circleWorldDiameter(circle: SelectionCircle, origin: Vec3): number {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return circle.radius * 2;
    const viewPosition = this.viewer.scene.view.position;
    const planeNormal = normalize([
      viewPosition.x - origin[0],
      viewPosition.y - origin[1],
      viewPosition.z - origin[2],
    ]);
    const edgeRay = this.mouseRay(camera, {
      x: circle.center.x + circle.radius,
      y: circle.center.y,
    });
    if (!planeNormal || !edgeRay) return circle.radius * 2;
    const denominator = dot([
      edgeRay.direction.x,
      edgeRay.direction.y,
      edgeRay.direction.z,
    ], planeNormal);
    if (Math.abs(denominator) < 1e-8) return circle.radius * 2;
    const amount = dot(subtract(origin, [
      edgeRay.origin.x,
      edgeRay.origin.y,
      edgeRay.origin.z,
    ]), planeNormal) / denominator;
    if (!Number.isFinite(amount) || amount <= 0) return circle.radius * 2;
    const edgePoint: Vec3 = [
      edgeRay.origin.x + edgeRay.direction.x * amount,
      edgeRay.origin.y + edgeRay.direction.y * amount,
      edgeRay.origin.z + edgeRay.direction.z * amount,
    ];
    const radius = Math.hypot(
      edgePoint[0] - origin[0],
      edgePoint[1] - origin[1],
      edgePoint[2] - origin[2],
    );
    return Number.isFinite(radius) && radius > 1e-5 ? radius * 2 : circle.radius * 2;
  }

  private createNormalFromCircle(circle: SelectionCircle): void {
    const camera = this.viewer.scene.getActiveCamera?.();
    const location = this.pickLocation(circle.center);
    if (!camera || !location) return;
    const worldDiameter = this.circleWorldDiameter(circle, location.position);
    const cameraNormal = this.cameraFacingNormal(circle.center, camera);
    const samples = this.pickCircleSamples(circle, location.pointcloud, camera);
    const normal = this.orientTowardCamera(
      this.estimateCircleNormal(location.position, samples, cameraNormal, worldDiameter)
      ?? this.estimateNormal({
        location: { x: location.position[0], y: location.position[1], z: location.position[2] },
        distance: 0,
        pointcloud: location.pointcloud,
      }, location.position, cameraNormal)
      ?? cameraNormal,
      location.position,
    );
    if (!normal) return;

    const before = this.snapshot();
    const item: NormalAnnotationItem = {
      id: createId(),
      name: `法线 ${this.items.length + 1}`,
      origin: location.position,
      direction: normal,
      length: this.defaultLength(),
      diameter: worldDiameter,
      updatedAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.selectedId = item.id;
    this.commit(before, "新增法线标注");
  }

  private pickNormal(result: PotreePointCloudIntersection): Vec3 | null {
    const point = result.point;
    if (!point) return null;
    for (const [key, value] of Object.entries(point)) {
      if (!key.toLowerCase().includes("normal")) continue;
      const normal = valueAsVec3(value);
      if (normal) return normalize(normal);
    }
    return null;
  }

  private estimateScreenNormal(
    pointcloud: PotreePointCloud,
    mouse: { x: number; y: number },
    camera: PotreeCamera,
    origin: Vec3,
    cameraNormal: Vec3 | null,
  ): Vec3 | null {
    const ray = this.mouseRay(camera, mouse);
    if (!pointcloud.pick || !ray) return null;

    const element = this.viewer.renderer.domElement;
    let picked: unknown;
    try {
      picked = pointcloud.pick(this.viewer, camera, ray, {
        pickClipped: true,
        x: mouse.x,
        y: element.clientHeight - mouse.y,
        pickWindowSize: SURFACE_NORMAL_PICK_WINDOW,
        all: true,
      });
    } catch {
      return null;
    }
    if (!Array.isArray(picked)) return null;

    const depthTolerance = this.surfaceDepthTolerance(
      origin,
      camera,
      (SURFACE_NORMAL_PICK_WINDOW - 1) / 2,
    );
    const samples = picked.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const point = valueAsVec3((value as Record<string, unknown>).position);
      if (!point || Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]) < 1e-5) return [];
      if (cameraNormal && Math.abs(dot(subtract(point, origin), cameraNormal)) > depthTolerance) return [];
      return [{
        point,
        distance: Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]),
      }];
    }).sort((left, right) => left.distance - right.distance);
    if (samples.length < 3) return null;

    const localScale = Math.max(median(samples.slice(0, 12).map(({ distance }) => distance)), 1e-4);
    const nearSamples = cameraNormal
      ? samples.filter(({ point }) => (
        Math.abs(dot(subtract(point, origin), cameraNormal)) <= localScale * 5
      ))
      : samples;
    const fittingSamples = nearSamples.length >= 3 ? nearSamples : samples;
    const tolerance = Math.max(localScale * 0.35, 1e-4);
    let bestNormal: Vec3 | null = null;
    let bestScore = 0;
    let bestLateralNormal: Vec3 | null = null;
    let bestLateralScore = 0;
    const raisedPick = isRaisedAboveSupport(
      origin,
      samples.map(({ point }) => point),
      localScale,
    );
    for (let first = 0; first < fittingSamples.length - 1; first += 1) {
      const firstVector = subtract(fittingSamples[first].point, origin);
      for (let second = first + 1; second < fittingSamples.length; second += 1) {
        const candidate = normalize(cross(firstVector, subtract(fittingSamples[second].point, origin)));
        if (!candidate) continue;
        let inlierCount = 0;
        const score = fittingSamples.reduce((total, sample) => {
          const offset = subtract(sample.point, origin);
          const residual = Math.abs(dot(offset, candidate));
          if (residual > tolerance) return total;
          inlierCount += 1;
          const depthDistance = cameraNormal ? Math.abs(dot(offset, cameraNormal)) : 0;
          const depthWeight = cameraNormal
            ? 1 / (1 + depthDistance / (localScale * 2.5))
            : 1;
          return total + depthWeight / (1 + sample.distance / localScale);
        }, 0);
        // Do not let a plane formed by only the closest two points beat a
        // plane supported by the rest of the visible surface.
        const coverageScore = inlierCount * 2 + score;
        const verticalSurfaceWeight = raisedPick
          ? 0.05 + 0.95 * (1 - Math.min(1, Math.abs(candidate[2])))
          : 1;
        const weightedScore = coverageScore * verticalSurfaceWeight;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          bestNormal = candidate;
        }
        if (raisedPick && Math.abs(candidate[2]) <= NORMAL_VERTICAL_COMPONENT && coverageScore > bestLateralScore) {
          bestLateralScore = coverageScore;
          bestLateralNormal = candidate;
        }
      }
    }
    if (!bestNormal) return raisedPick ? [0, 0, 1] : null;

    // If the click is above the local support surface, a near-vertical plane
    // is usually the floor seen together with a sparse small object. Prefer
    // the object's lateral plane; when it has too few points, use the
    // conventional upward direction instead of drawing into the floor.
    if (raisedPick && Math.abs(bestNormal[2]) > NORMAL_VERTICAL_COMPONENT) {
      bestNormal = bestLateralNormal ?? [0, 0, 1];
    }

    const inliers = fittingSamples.filter(({ point }) => (
      Math.abs(dot(subtract(point, origin), bestNormal as Vec3)) <= tolerance * 1.5
    ));
    const refined = covarianceNormal([origin, ...inliers.map(({ point }) => point)]);
    if (!refined) return preferUpwardNormal(bestNormal);
    const alignedRefined = dot(refined, bestNormal) < 0 ? scale(refined, -1) : refined;
    return preferUpwardNormal(
      Math.abs(dot(alignedRefined, bestNormal)) >= 0.72 ? alignedRefined : bestNormal,
    );
  }

  private estimateNormal(result: PotreePointCloudIntersection, origin: Vec3, cameraNormal: Vec3 | null): Vec3 | null {
    const pointcloud = result.pointcloud;
    const visibleNodes = pointcloud.visibleNodes ?? [];
    if (visibleNodes.length === 0) return null;
    const pointcloudPosition = pointcloud.position ?? { x: 0, y: 0, z: 0 };
    const candidates = visibleNodes
      .map((node) => {
        const geometryNode = node.geometryNode;
        const bounds = geometryNode?.boundingBox;
        if (!bounds) return { node, score: Number.POSITIVE_INFINITY };
        const corners = boundsCorners(bounds).map((corner) => this.nodePointToWorld(node, corner, pointcloudPosition));
        const min: Vec3 = [
          Math.min(...corners.map((corner) => corner[0])),
          Math.min(...corners.map((corner) => corner[1])),
          Math.min(...corners.map((corner) => corner[2])),
        ];
        const max: Vec3 = [
          Math.max(...corners.map((corner) => corner[0])),
          Math.max(...corners.map((corner) => corner[1])),
          Math.max(...corners.map((corner) => corner[2])),
        ];
        const dx = Math.max(min[0] - origin[0], 0, origin[0] - max[0]);
        const dy = Math.max(min[1] - origin[1], 0, origin[1] - max[1]);
        const dz = Math.max(min[2] - origin[2], 0, origin[2] - max[2]);
        return { node, score: dx * dx + dy * dy + dz * dz };
      })
      .sort((left, right) => left.score - right.score)
      .slice(0, MAX_NORMAL_NODES);

    const samples = candidates.map(({ node }) => {
      const positionAttribute = node.geometryNode?.geometry?.attributes?.position;
      const array = positionAttribute?.array;
      const itemSize = positionAttribute?.itemSize ?? 3;
      if (!array || itemSize < 3) return { node, neighbors: [] as { point: Vec3; distance: number }[], spacing: 0 };
      const neighbors: { point: Vec3; distance: number }[] = [];
      const count = Math.floor(array.length / itemSize);
      for (let index = 0; index < count; index += 1) {
        const localPoint: Vec3 = [
          Number(array[index * itemSize]),
          Number(array[index * itemSize + 1]),
          Number(array[index * itemSize + 2]),
        ];
        const point = this.nodePointToWorld(node, localPoint, pointcloudPosition);
        if (!finitePoint(point)) continue;
        const distance = Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
        if (distance < 1e-5) continue;
        const entry = { point, distance };
        let insertAt = neighbors.findIndex((candidate) => candidate.distance > distance);
        if (insertAt < 0) insertAt = neighbors.length;
        neighbors.splice(insertAt, 0, entry);
        if (neighbors.length > MAX_NORMAL_NEIGHBORS) neighbors.pop();
      }
      return {
        node,
        neighbors,
        spacing: Number(node.geometryNode?.spacing) > 0 ? Number(node.geometryNode?.spacing) : 0,
      };
    });
    const usableSamples = samples.filter((sample) => sample.neighbors.length > 0);
    if (usableSamples.length === 0) return null;

    // The node that contains the picked point has a zero-distance neighbor.
    // Prefer it so an adjacent floor or wall node cannot dominate the fit.
    usableSamples.sort((left, right) => left.neighbors[0].distance - right.neighbors[0].distance);
    const primary = usableSamples[0];
    const typicalDistance = median(primary.neighbors.slice(0, 12).map(({ distance }) => distance));
    const radius = Math.max(
      typicalDistance * 3.5,
      primary.spacing * 8,
      1e-3,
    );
    let nearest = primary.neighbors.filter(({ distance }) => distance <= radius);
    if (nearest.length < MIN_NORMAL_NEIGHBORS) {
      nearest = usableSamples
        .flatMap((sample) => sample.neighbors.filter(({ distance }) => distance <= radius))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, MAX_NORMAL_NEIGHBORS);
    }
    if (nearest.length < 3) return null;

    const camera = this.viewer.scene.getActiveCamera?.();
    if (cameraNormal && camera) {
      const depthTolerance = Math.max(
        this.surfaceDepthTolerance(origin, camera, (SURFACE_NORMAL_PICK_WINDOW - 1) / 2),
        primary.spacing * 3,
        radius * 0.5,
      );
      const sameSurface = nearest.filter(({ point }) => (
        Math.abs(dot(subtract(point, origin), cameraNormal)) <= depthTolerance
      ));
      if (sameSurface.length < 3) return null;
      nearest = sameSurface;
    }

    const distances = nearest.map(({ distance }) => distance);
    const localScale = Math.max(median(distances.slice(0, 12)), 1e-4);
    const tolerance = Math.max(primary.spacing * 1.5, localScale * 0.22, 1e-4);
    const localCenter = nearest.reduce<Vec3>(
      (sum, neighbor) => add(sum, neighbor.point),
      origin,
    );
    const localCentroid = scale(localCenter, 1 / (nearest.length + 1));
    const verticalSpread = Math.sqrt(nearest.reduce(
      (total, neighbor) => total + (neighbor.point[2] - localCentroid[2]) ** 2,
      (origin[2] - localCentroid[2]) ** 2,
    ) / (nearest.length + 1));
    const horizontalSpread = Math.sqrt(nearest.reduce(
      (total, neighbor) => total
        + (neighbor.point[0] - localCentroid[0]) ** 2
        + (neighbor.point[1] - localCentroid[1]) ** 2,
      (origin[0] - localCentroid[0]) ** 2 + (origin[1] - localCentroid[1]) ** 2,
    ) / (nearest.length + 1));
    // A raised local cluster usually means the pick is on a wall or a small
    // object, rather than on the supporting floor. Require enough vertical
    // extent to avoid classifying floor noise as a vertical surface.
    const likelyVerticalSurface = verticalSpread > Math.max(
      localScale * 1.5,
      horizontalSpread * 0.25,
    );
    const raisedPick = isRaisedAboveSupport(
      origin,
      [origin, ...nearest.map(({ point }) => point)],
      localScale,
    );
    let bestNormal: Vec3 | null = null;
    let bestScore = 0;
    let bestLateralNormal: Vec3 | null = null;
    let bestLateralScore = 0;
    for (let first = 0; first < nearest.length - 1; first += 1) {
      const firstVector = subtract(nearest[first].point, origin);
      for (let second = first + 1; second < nearest.length; second += 1) {
        const candidate = normalize(cross(firstVector, subtract(nearest[second].point, origin)));
        if (!candidate) continue;
        let inlierCount = 0;
        const score = nearest.reduce((total, neighbor) => {
          const residual = Math.abs(dot(subtract(neighbor.point, origin), candidate));
          if (residual > tolerance) return total;
          inlierCount += 1;
          const depthDistance = cameraNormal
            ? Math.abs(dot(subtract(neighbor.point, origin), cameraNormal))
            : 0;
          const depthWeight = cameraNormal
            ? 1 / (1 + depthDistance / (localScale * 2.5))
            : 1;
          return total + depthWeight / (1 + neighbor.distance / localScale);
        }, 0);
        const coverageScore = inlierCount * 2 + score;
        const verticalSurfaceWeight = (likelyVerticalSurface || raisedPick)
          ? 0.05 + 0.95 * (1 - Math.min(1, Math.abs(candidate[2])))
          : 1;
        const weightedScore = coverageScore * verticalSurfaceWeight;
        if (weightedScore > bestScore) {
          bestScore = weightedScore;
          bestNormal = candidate;
        }
        if ((likelyVerticalSurface || raisedPick)
          && Math.abs(candidate[2]) <= NORMAL_VERTICAL_COMPONENT
          && coverageScore > bestLateralScore) {
          bestLateralScore = coverageScore;
          bestLateralNormal = candidate;
        }
      }
    }
    if (!bestNormal) {
      const fallback = covarianceNormal([origin, ...nearest.map(({ point }) => point)]);
      if (likelyVerticalSurface || raisedPick) {
        return preferUpwardNormal(this.lateralNormal(fallback, cameraNormal) ?? fallback)
          ?? (raisedPick ? [0, 0, 1] : null);
      }
      return preferUpwardNormal(fallback);
    }

    if ((likelyVerticalSurface || raisedPick) && Math.abs(bestNormal[2]) > NORMAL_VERTICAL_COMPONENT) {
      bestNormal = bestLateralNormal
        ?? (likelyVerticalSurface ? this.lateralNormal(bestNormal, cameraNormal) : null)
        ?? (raisedPick ? [0, 0, 1] : bestNormal);
    }

    const inliers = nearest.filter(({ point }) => (
      Math.abs(dot(subtract(point, origin), bestNormal as Vec3)) <= tolerance * 1.5
    ));
    const refined = covarianceNormal([origin, ...inliers.map(({ point }) => point)]);
    if (!refined) return preferUpwardNormal(bestNormal);

    // PCA can fall back to a different dominant plane when a small object is
    // close to the floor. Accept refinement only when it still represents the
    // candidate plane selected above; otherwise keep the selected direction.
    const alignedRefined = dot(refined, bestNormal) < 0 ? scale(refined, -1) : refined;
    return preferUpwardNormal(
      Math.abs(dot(alignedRefined, bestNormal)) >= 0.72 ? alignedRefined : bestNormal,
    );
  }

  private nodePointToWorld(node: PotreeVisibleNode, point: Vec3, pointcloudPosition: { x: number; y: number; z: number }): Vec3 {
    const elements = node.sceneNode?.matrixWorld?.elements;
    if (elements?.length === 16) return transformPoint(point, elements);
    return add(point, [
      (node.sceneNode?.position?.x ?? 0) + pointcloudPosition.x,
      (node.sceneNode?.position?.y ?? 0) + pointcloudPosition.y,
      (node.sceneNode?.position?.z ?? 0) + pointcloudPosition.z,
    ]);
  }

  private cameraFacingNormal(mouse: { x: number; y: number }, camera: PotreeCamera): Vec3 | null {
    const ray = this.mouseRay(camera, mouse);
    return ray ? normalize([-ray.direction.x, -ray.direction.y, -ray.direction.z]) : null;
  }

  private surfaceDepthTolerance(origin: Vec3, camera: PotreeCamera, pixelRadius: number): number {
    const viewPosition = this.viewer.scene.view.position;
    const cameraDistance = Math.hypot(
      origin[0] - viewPosition.x,
      origin[1] - viewPosition.y,
      origin[2] - viewPosition.z,
    );
    const viewportHeight = Math.max(1, this.viewer.renderer.domElement.clientHeight);
    const fieldOfView = Math.min(170, Math.max(1, Number(camera.fov) || 60));
    const worldPerPixel = 2 * cameraDistance * Math.tan((fieldOfView * Math.PI) / 360) / viewportHeight;
    return Math.max(worldPerPixel * Math.max(3, pixelRadius), cameraDistance * 1e-4, 1e-4);
  }

  private orientTowardCamera(normal: Vec3 | null, origin: Vec3): Vec3 | null {
    if (!normal) return null;
    const camera = this.viewer.scene.view.position;
    const toCamera = normalize([camera.x - origin[0], camera.y - origin[1], camera.z - origin[2]]);
    const oriented = toCamera && dot(normal, toCamera) < 0 ? scale(normal, -1) : normal;
    return preferUpwardNormal(oriented);
  }

  private lateralNormal(normal: Vec3 | null, cameraNormal: Vec3 | null): Vec3 | null {
    return normalize(normal ? [normal[0], normal[1], 0] : [0, 0, 0])
      ?? normalize(cameraNormal ? [cameraNormal[0], cameraNormal[1], 0] : [0, 0, 0]);
  }

  private defaultLength(): number {
    const bounds = this.viewer.scene.pointclouds[0]?.pcoGeometry?.boundingBox;
    if (!bounds) return DEFAULT_LENGTH;
    const diagonal = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
    return Number.isFinite(diagonal) && diagonal > 0
      ? Math.max(MIN_NORMAL_LENGTH, Math.min(MAX_NORMAL_LENGTH, diagonal * 0.01))
      : DEFAULT_LENGTH;
  }

  private dragDirection(mouse: { x: number; y: number }, item: NormalAnnotationItem): { direction: Vec3; length: number } | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    const ray = this.mouseRay(camera, mouse);
    if (!ray) return null;
    const viewPosition = this.viewer.scene.view.position;
    const planeNormal = normalize([
      viewPosition.x - item.origin[0],
      viewPosition.y - item.origin[1],
      viewPosition.z - item.origin[2],
    ]) ?? normalize([
      this.viewer.scene.view.direction.x,
      this.viewer.scene.view.direction.y,
      this.viewer.scene.view.direction.z,
    ]);
    if (!planeNormal) return null;
    const denominator = dot([ray.direction.x, ray.direction.y, ray.direction.z], planeNormal);
    if (Math.abs(denominator) < 1e-8) return null;
    const amount = dot(subtract(item.origin, [ray.origin.x, ray.origin.y, ray.origin.z]), planeNormal) / denominator;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const point: Vec3 = [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      ray.origin.z + ray.direction.z * amount,
    ];
    const offset = subtract(point, item.origin);
    const direction = normalize(offset);
    if (!direction) return null;
    return {
      direction,
      length: Math.max(MIN_NORMAL_LENGTH, Math.min(MAX_NORMAL_LENGTH, Math.hypot(...offset))),
    };
  }

  private dragCircleDiameter(mouse: { x: number; y: number }, item: NormalAnnotationItem): number | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    const ray = this.mouseRay(camera, mouse);
    const planeNormal = normalize(item.direction);
    if (!ray || !planeNormal) return null;
    const denominator = dot([
      ray.direction.x,
      ray.direction.y,
      ray.direction.z,
    ], planeNormal);
    if (Math.abs(denominator) < 1e-8) return null;
    const amount = dot(subtract(item.origin, [
      ray.origin.x,
      ray.origin.y,
      ray.origin.z,
    ]), planeNormal) / denominator;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const point: Vec3 = [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      ray.origin.z + ray.direction.z * amount,
    ];
    const diameter = 2 * Math.hypot(
      point[0] - item.origin[0],
      point[1] - item.origin[1],
      point[2] - item.origin[2],
    );
    return Number.isFinite(diameter) && diameter >= MIN_CIRCLE_DIAMETER
      ? diameter
      : null;
  }

  private endpoint(item: NormalAnnotationItem): Vec3 {
    const direction = normalize(item.direction) ?? [0, 0, 1];
    // Keep old manually adjusted values from making the marker dominate the
    // point cloud while preserving the saved direction and length.
    const length = Number.isFinite(item.length) && item.length > 0
      ? Math.min(item.length, MAX_NORMAL_LENGTH)
      : DEFAULT_LENGTH;
    return add(item.origin, scale(direction, length));
  }

  private circlePoints(item: NormalAnnotationItem, segments = 64): Vec3[] {
    const basis = circleBasis(item.direction);
    if (!basis) return [];
    const radius = Math.max(MIN_CIRCLE_DIAMETER / 2, Number(item.diameter) / 2);
    if (!Number.isFinite(radius)) return [];
    return Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return add(
        item.origin,
        add(
          scale(basis.first, Math.cos(angle) * radius),
          scale(basis.second, Math.sin(angle) * radius),
        ),
      );
    });
  }

  private circleHandlePoint(item: NormalAnnotationItem): Vec3 | null {
    const basis = circleBasis(item.direction);
    if (!basis) return null;
    const radius = Math.max(MIN_CIRCLE_DIAMETER / 2, Number(item.diameter) / 2);
    return Number.isFinite(radius) ? add(item.origin, scale(basis.first, radius)) : null;
  }

  private projectPoint(point: Vec3, camera: PotreeCamera): { x: number; y: number; z: number } | null {
    const projected = new this.three.Vector3(...point).project(camera) as PotreeThreeVector3;
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)) return null;
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: (projected.x + 1) * 0.5 * bounds.width,
      y: (1 - projected.y) * 0.5 * bounds.height,
      z: projected.z,
    };
  }

  private hitTestHandle(mouse: { x: number; y: number }): NormalHandle | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    let closest: { handle: NormalHandle; distance: number } | null = null;
    this.items.forEach((item) => {
      const origin = this.projectPoint(item.origin, camera);
      const end = this.projectPoint(this.endpoint(item), camera);
      if (!origin || !end) return;
      const originDistance = (origin.x - mouse.x) ** 2 + (origin.y - mouse.y) ** 2;
      const endDistance = (end.x - mouse.x) ** 2 + (end.y - mouse.y) ** 2;
      const candidates: { kind: NormalHandle["kind"]; distance: number }[] = [
        { kind: "origin", distance: originDistance },
        { kind: "direction", distance: endDistance },
      ];
      const circleHandle = this.circleHandlePoint(item);
      const projectedCircleHandle = circleHandle ? this.projectPoint(circleHandle, camera) : null;
      if (projectedCircleHandle) {
        candidates.push({
          kind: "circle",
          distance: (projectedCircleHandle.x - mouse.x) ** 2 + (projectedCircleHandle.y - mouse.y) ** 2,
        });
      }
      candidates.forEach(({ kind, distance }) => {
        if (distance > HANDLE_HIT_DISTANCE_SQ || (closest && distance >= closest.distance)) return;
        closest = { handle: { id: item.id, kind }, distance };
      });
      const lineDistance = distanceSquaredToSegment(mouse.x, mouse.y, origin.x, origin.y, end.x, end.y);
      if (lineDistance <= LINE_HIT_DISTANCE_SQ && (!closest || lineDistance < closest.distance)) {
        closest = { handle: { id: item.id, kind: "direction" }, distance: lineDistance };
      }
      const circlePoints = this.circlePoints(item);
      let circleDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < circlePoints.length; index += 1) {
        const from = this.projectPoint(circlePoints[index], camera);
        const to = this.projectPoint(circlePoints[(index + 1) % circlePoints.length], camera);
        if (!from || !to) continue;
        circleDistance = Math.min(
          circleDistance,
          distanceSquaredToSegment(mouse.x, mouse.y, from.x, from.y, to.x, to.y),
        );
      }
      if (circleDistance <= LINE_HIT_DISTANCE_SQ && (!closest || circleDistance < closest.distance)) {
        closest = { handle: { id: item.id, kind: "circle" }, distance: circleDistance };
      }
    });
    return closest?.handle ?? null;
  }

  private rebuildVisuals(): void {
    this.clearVisualGroup();
    // Normal annotations are an editing overlay. Do not keep an extra WebGL
    // pass alive while the normal tool is closed.
    if (!this.enabled || !this.pageActive || this.items.length === 0) return;
    const origin = this.items[0].origin;
    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    this.items.forEach((item, index) => {
      const end = this.endpoint(item);
      const selected = item.id === this.selectedId;
      const color = selected ? NORMAL_SELECTED_COLOR : NORMAL_COLOR;
      this.addLine(group, item.origin, end, origin, color, NORMAL_LINE_THICKNESS * (selected ? 1.35 : 1));
      this.addArrowHead(group, item.origin, end, origin, color, NORMAL_LINE_THICKNESS * (selected ? 1.35 : 1));
      this.addCircle(group, item, origin, color, CIRCLE_LINE_THICKNESS * (selected ? 1.35 : 1));
      this.addPoint(group, item.origin, origin, selected ? NORMAL_SELECTED_COLOR : ORIGIN_COLOR, ORIGIN_SCALE * (selected ? SELECTED_SCALE : 1));
      this.addPoint(group, end, origin, selected ? NORMAL_SELECTED_COLOR : DIRECTION_HANDLE_COLOR, END_SCALE * (selected ? SELECTED_SCALE : 1));
      const circleHandle = this.circleHandlePoint(item);
      if (circleHandle) {
        this.addPoint(group, circleHandle, origin, selected ? NORMAL_SELECTED_COLOR : DIRECTION_HANDLE_COLOR, CIRCLE_HANDLE_SCALE * (selected ? SELECTED_SCALE : 1));
      }
      this.labels.push({
        position: item.origin,
        element: this.createLabel(item.name?.trim() || `法线 ${index + 1}`),
      });
    });
    this.visualGroup = group;
    this.scene.add(group);
  }

  private addCircle(
    group: PotreeThreeObject3D,
    item: NormalAnnotationItem,
    origin: Vec3,
    color: number,
    thickness: number,
  ): void {
    const points = this.circlePoints(item);
    if (points.length < 3) return;
    const positions: number[] = [];
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      const localPoint = subtract(point, origin);
      const localNext = subtract(next, origin);
      positions.push(
        localPoint[0], localPoint[1], localPoint[2],
        localNext[0], localNext[1], localNext[2],
      );
    });
    const geometry = new this.three.BufferGeometry();
    geometry.setAttribute("position", new this.three.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    const material = new this.three.LineBasicMaterial({
      color,
      linewidth: thickness,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
    group.add(new this.three.LineSegments(geometry, material));
  }

  private addLine(group: PotreeThreeObject3D, from: Vec3, to: Vec3, origin: Vec3, color: number, thickness: number): void {
    const localFrom = subtract(from, origin);
    const localTo = subtract(to, origin);
    const length = Math.hypot(localTo[0] - localFrom[0], localTo[1] - localFrom[1], localTo[2] - localFrom[2]);
    if (!Number.isFinite(length) || length <= 1e-8) return;
    const geometry = new this.three.BoxGeometry(1, 1, 1);
    const material = new this.three.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    const mesh = new this.three.Mesh(geometry, material);
    mesh.position.set((localFrom[0] + localTo[0]) / 2, (localFrom[1] + localTo[1]) / 2, (localFrom[2] + localTo[2]) / 2);
    mesh.scale.set(thickness, thickness, length);
    if (Math.abs((localTo[1] - localFrom[1]) / length) > 0.999) mesh.up.set(1, 0, 0);
    mesh.lookAt(localTo[0], localTo[1], localTo[2]);
    group.add(mesh);
  }

  private addArrowHead(group: PotreeThreeObject3D, from: Vec3, to: Vec3, origin: Vec3, color: number, thickness: number): void {
    const direction = normalize(subtract(to, from));
    if (!direction) return;
    const arrowLength = Math.max(0.08, Math.min(0.24, Math.hypot(...subtract(to, from)) * 0.3));
    const reference: Vec3 = Math.abs(direction[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const side = normalize(cross(direction, reference));
    if (!side) return;
    const back = subtract(to, scale(direction, arrowLength));
    const wingOffset = scale(side, arrowLength * 0.55);
    this.addLine(group, add(back, wingOffset), to, origin, color, thickness * 1.15);
    this.addLine(group, add(back, scale(wingOffset, -1)), to, origin, color, thickness * 1.15);
  }

  private addPoint(group: PotreeThreeObject3D, point: Vec3, origin: Vec3, color: number, size: number): void {
    const geometry = new this.three.SphereGeometry(1, 14, 10);
    const material = new this.three.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    const mesh = new this.three.Mesh(geometry, material);
    const local = subtract(point, origin);
    mesh.position.set(local[0], local[1], local[2]);
    mesh.scale.set(size, size, size);
    group.add(mesh);
  }

  private clearVisualGroup(): void {
    this.clearLabels();
    if (!this.visualGroup) return;
    this.scene.remove(this.visualGroup);
    disposeObject(this.visualGroup);
    this.visualGroup = null;
  }

  private createLabelContainer(host: HTMLElement): HTMLDivElement {
    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: "17",
    });
    host.appendChild(container);
    return container;
  }

  private createSelectionCircle(host: HTMLElement): HTMLDivElement {
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      display: "none",
      border: "1px dashed #40c4ff",
      borderRadius: "50%",
      background: "rgba(64, 196, 255, 0.08)",
      boxSizing: "border-box",
      pointerEvents: "none",
    });
    host.appendChild(element);
    return element;
  }

  private updateSelectionCircle(): void {
    const circle = this.selectionCircle;
    if (!circle || circle.radius <= 0) {
      this.hideSelectionCircle();
      return;
    }
    Object.assign(this.selectionCircleElement.style, {
      left: `${circle.center.x - circle.radius}px`,
      top: `${circle.center.y - circle.radius}px`,
      width: `${circle.radius * 2}px`,
      height: `${circle.radius * 2}px`,
      display: "block",
    });
  }

  private hideSelectionCircle(): void {
    this.selectionCircleElement.style.display = "none";
  }

  private createLabel(text: string): HTMLDivElement {
    const element = document.createElement("div");
    element.textContent = text;
    Object.assign(element.style, {
      position: "absolute",
      display: "none",
      color: "#ffd666",
      fontSize: "12px",
      fontWeight: "700",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      textShadow: "0 0 3px #000, 0 0 3px #000",
      transform: "translate(-50%, -140%)",
    });
    this.labelContainer.appendChild(element);
    return element;
  }

  private clearLabels(): void {
    this.labels.forEach((label) => label.element.remove());
    this.labels = [];
  }

  private updateLabels(camera: PotreeCamera): void {
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.labels.forEach((label) => {
      const projected = this.projectPoint(label.position, camera);
      const visible = !!projected
        && projected.z >= -1
        && projected.z <= 1
        && projected.x >= 0
        && projected.x <= bounds.width
        && projected.y >= 0
        && projected.y <= bounds.height;
      if (!visible || !projected) {
        label.element.style.display = "none";
        return;
      }
      label.element.style.left = `${projected.x}px`;
      label.element.style.top = `${projected.y}px`;
      label.element.style.display = "block";
    });
  }

  private readonly renderOverlay = (): void => {
    if (!this.pageActive || !this.enabled || !this.visualGroup) return;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return;
    this.viewer.renderer.render(this.scene, camera);
    this.updateLabels(camera);
  };
}
