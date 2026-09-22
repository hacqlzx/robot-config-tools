import type {
  PotreeNamespace,
  PotreeThreeDisposable,
  PotreeThreeNamespace,
  PotreeThreeObject3D,
  PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { InspectionPointItem } from "../../hooks/drawing/drawing-schema";
import { INSPECTION_POINT_LENGTH } from "../../hooks/drawing/drawing-schema";
import type { SpaceInspectionPointCallbacks } from "./types";
import type { SpaceInteractionCoordinator } from "./SpaceInteractionCoordinator";

type Vec3 = [number, number, number];
interface Snapshot {
  items: InspectionPointItem[];
  selectedId: string | null;
  pendingNewId: string | null;
}
interface SurfacePick { position: Vec3; direction: Vec3; length: number }
interface InspectionHandle { id: string; kind: "position" | "direction" }
interface PointerStart {
  x: number;
  y: number;
  point: { x: number; y: number };
  hitId: string | null;
  dragHandle: InspectionHandle | null;
}

interface DirectionDragStart {
  origin: Vec3;
  direction: Vec3;
  length: number;
}

const CLICK_THRESHOLD = 4;
const HIT_DISTANCE_SQ = 12 * 12;
const DIRECTION_HIT_DISTANCE_SQ = 14 * 14;
const DIRECTION_LINE_HIT_DISTANCE_SQ = 8 * 8;
const POINT_COLOR = 0x52c41a;
const SELECTED_COLOR = 0xd4ff3f;
const NORMAL_COLOR = 0x52c41a;
const POINT_SCALE = 0.032;
const SELECTED_POINT_SCALE = 0.036;
const SELECTED_HALO_SCALE = 0.049;
const NORMAL_LINE_THICKNESS = 0.0055;
const ARROW_HEAD_LENGTH = 0.056;
const ARROW_HEAD_RADIUS = 0.027;
const SELECTED_PULSE_DURATION_MS = 1_600;
const DEFAULT_NORMAL_LENGTH = INSPECTION_POINT_LENGTH.default;
const MIN_NORMAL_LENGTH = INSPECTION_POINT_LENGTH.min;
const MAX_NORMAL_LENGTH = INSPECTION_POINT_LENGTH.max;

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function normalize(value: Vec3): Vec3 | null {
  const length = Math.hypot(...value);
  return length > 1e-8 ? scale(value, 1 / length) : null;
}

function dot(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
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
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-8) return (px - ax) ** 2 + (py - ay) ** 2;
  const amount = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const closestX = ax + dx * amount;
  const closestY = ay + dy * amount;
  return (px - closestX) ** 2 + (py - closestY) ** 2;
}

function cloneItem(item: InspectionPointItem): InspectionPointItem {
  return {
    ...item,
    position: [...item.position] as Vec3,
    direction: [...item.direction] as Vec3,
  };
}
function cloneItems(items: InspectionPointItem[]): InspectionPointItem[] { return items.map(cloneItem); }
function createId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `inspection:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
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

/** 单击拾取点云的巡检点编辑器；再次操作选中点可移动位置或调整方向。 */
export class PotreeInspectionPointEditor {
  private readonly scene: PotreeThreeObject3D;
  private readonly labelContainer: HTMLDivElement;
  private visualGroup: PotreeThreeObject3D | null = null;
  private selectedPointMesh: PotreeThreeObject3D | null = null;
  private labels: Array<{ position: Vec3; element: HTMLDivElement }> = [];
  private callbacks: SpaceInspectionPointCallbacks | null = null;
  private items: InspectionPointItem[] = [];
  private visibleIds = new Set<string>();
  private namesVisible = true;
  private selectedId: string | null = null;
  private pendingNewId: string | null = null;
  private defaultComponentType: string | undefined;
  private enabled = false;
  private pageActive = true;
  private mouseDown: PointerStart | null = null;
  private draggingHandle: InspectionHandle | null = null;
  private dragBefore: Snapshot | null = null;
  private directionDragStart: DirectionDragStart | null = null;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private readonly unsubscribeInteractions: () => void;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
    private readonly interactions: SpaceInteractionCoordinator,
    private readonly pickSurfaceNormal: (mouse: { x: number; y: number }) => SurfacePick | null,
  ) {
    this.scene = new three.Scene();
    this.scene.add(new three.AmbientLight(0xffffff, 0.78));
    const keyLight = new three.DirectionalLight(0xffffff, 0.92);
    keyLight.position.set(1.5, 2.2, 3);
    this.scene.add(keyLight);
    this.labelContainer = document.createElement("div");
    Object.assign(this.labelContainer.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "18" });
    host.appendChild(this.labelContainer);
    host.addEventListener("mousedown", this.handleMouseDown, true);
    window.addEventListener("mousemove", this.handleMouseMove, true);
    window.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
    viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.unsubscribeInteractions = interactions.subscribe(() => {
      if (!this.canHandle()) this.resetPointerInteraction(true);
    });
  }

  setCallbacks(callbacks: SpaceInspectionPointCallbacks | null): void { this.callbacks = callbacks; this.emitChange(); }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.resetPointerInteraction(true); this.rebuildVisuals(); this.emitChange(); }
  setActive(active: boolean): void { this.pageActive = active; if (!active) this.resetPointerInteraction(true); this.rebuildVisuals(); }
  setData(items: InspectionPointItem[]): void {
    this.items = cloneItems(items);
    this.pendingNewId = null;
    const itemIds = new Set(this.items.map((item) => item.id));
    this.visibleIds = new Set([...this.visibleIds].filter((id) => itemIds.has(id)));
    this.selectedId = this.items.some((item) => item.id === this.selectedId) ? this.selectedId : null;
    this.undoStack.length = 0; this.redoStack.length = 0; this.rebuildVisuals(); this.emitChange();
  }
  setDefaultComponentType(componentType: string | undefined): void {
    this.defaultComponentType = componentType?.trim() || undefined;
  }
  setVisibleIds(ids: Iterable<string>): void {
    const itemIds = new Set(this.items.map((item) => item.id));
    this.visibleIds = new Set([...ids].filter((id) => itemIds.has(id)));
    this.rebuildVisuals();
  }
  setNamesVisible(visible: boolean): void {
    if (this.namesVisible === visible) return;
    this.namesVisible = visible;
    this.rebuildVisuals();
  }
  getData(): InspectionPointItem[] { return cloneItems(this.items); }
  select(id: string | null): void {
    this.selectedId = id && this.items.some((item) => item.id === id) ? id : null;
    this.rebuildVisuals(); this.emitChange();
  }
  rename(id: string, name: string): void {
    const item = this.items.find((candidate) => candidate.id === id); const next = name.trim();
    if (!item || !next || item.name?.trim() === next) return;
    const before = this.snapshot(); item.name = next; this.selectedId = id; this.commit(before, "修改巡检点名称");
  }
  setComponentType(id: string, componentType: string | undefined): void {
    const item = this.items.find((candidate) => candidate.id === id);
    const next = componentType?.trim() || undefined;
    if (!item || item.componentType === next) return;
    const before = this.snapshot();
    item.componentType = next;
    item.updatedAt = new Date().toISOString();
    this.selectedId = id;
    this.commit(before, "修改巡检点部件类型");
  }
  setLength(id: string, value: number): void {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || !Number.isFinite(value) || value <= 0) return;
    const length = this.clampLength(value);
    if (item.length === length) return;
    const before = this.snapshot();
    item.length = length;
    item.updatedAt = new Date().toISOString();
    this.selectedId = id;
    this.commit(before, "修改巡检点长度");
  }
  bindPoint(id: string, point: { pointCode: string; pointName?: string; bayCode?: string; bayName?: string }): void {
    const item = this.items.find((candidate) => candidate.id === id); const code = point.pointCode.trim();
    if (!item || !code) return;
    const before = this.snapshot();
    const pointName = point.pointName?.trim();
    item.pointCode = code;
    item.pointName = pointName || undefined;
    item.bayCode = point.bayCode?.trim() || undefined;
    item.bayName = point.bayName?.trim() || undefined;
    if (pointName) item.name = pointName;
    this.selectedId = id;
    this.commit(before, "绑定巡检点位");
  }
  unbindPoint(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id); if (!item?.pointCode) return;
    const before = this.snapshot(); delete item.pointCode; delete item.pointName; delete item.bayCode; delete item.bayName; this.selectedId = id; this.commit(before, "解绑巡检点位");
  }
  delete(id: string): void {
    const index = this.items.findIndex((item) => item.id === id); if (index < 0) return;
    const before = this.snapshot(); this.items.splice(index, 1);
    if (this.pendingNewId === id) this.pendingNewId = null;
    if (this.selectedId === id) this.selectedId = null;
    this.commit(before, "删除巡检点");
  }
  /** 保存成功后，当前点不再被视为“待保存新增点”，允许继续新增下一个点。 */
  markSaved(): void {
    this.pendingNewId = null;
    this.emitChange();
  }
  hasDraft(): boolean { return this.items.length > 0; }
  clear(): void { this.items = []; this.visibleIds.clear(); this.selectedId = null; this.pendingNewId = null; this.undoStack.length = 0; this.redoStack.length = 0; this.rebuildVisuals(); this.emitChange(); }
  restoreSnapshot(value: unknown): void {
    const snapshot = value as Partial<Snapshot>; if (!Array.isArray(snapshot.items)) return;
    this.items = cloneItems(snapshot.items as InspectionPointItem[]);
    this.selectedId = typeof snapshot.selectedId === "string" ? snapshot.selectedId : null;
    this.pendingNewId = typeof snapshot.pendingNewId === "string"
      && this.items.some((item) => item.id === snapshot.pendingNewId)
      ? snapshot.pendingNewId
      : null;
    this.rebuildVisuals(); this.emitChange();
  }
  undo(): void { const previous = this.undoStack.pop(); if (!previous) return; this.redoStack.push(this.snapshot()); this.restoreSnapshot(previous); }
  redo(): void { const next = this.redoStack.pop(); if (!next) return; this.undoStack.push(this.snapshot()); this.restoreSnapshot(next); }
  dispose(): void {
    this.unsubscribeInteractions();
    this.resetPointerInteraction(); this.host.removeEventListener("mousedown", this.handleMouseDown, true); window.removeEventListener("mousemove", this.handleMouseMove, true); window.removeEventListener("mouseup", this.handleMouseUp, true); document.removeEventListener("keydown", this.handleKeyDown, true); this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay); this.clearVisuals(); this.labelContainer.remove(); this.callbacks = null;
  }
  private snapshot(): Snapshot { return { items: cloneItems(this.items), selectedId: this.selectedId, pendingNewId: this.pendingNewId }; }
  private commit(before: Snapshot, label: string): void { this.undoStack.push(before); this.redoStack.length = 0; this.callbacks?.onHistory?.(before, this.snapshot(), label); this.rebuildVisuals(); this.emitChange(); }
  private commitIfChanged(before: Snapshot, label: string): boolean {
    if (JSON.stringify(before.items) === JSON.stringify(this.items)) return false;
    this.commit(before, label);
    return true;
  }
  private emitChange(): void { this.callbacks?.onChange({ count: this.items.length, selectedId: this.selectedId, active: this.enabled }); }
  private canPlace(): boolean { return this.enabled && this.interactions.isMode("inspection-point"); }
  private canHandle(): boolean { return this.pageActive && (this.canPlace() || this.interactions.isMode("idle")) && !this.host.closest("[data-space-edit-busy='true']"); }
  private isVisible(item: InspectionPointItem): boolean { return this.visibleIds.has(item.id) || (this.enabled && item.id === this.selectedId); }
  private isOverlay(event: Event): boolean { return event.target instanceof Element && !!event.target.closest("[data-space-edit-overlay]"); }
  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || this.isOverlay(event) || !this.canHandle()) return;
    const point = this.mousePosition(event);
    const handle = this.hitTestHandle(point);
    if (!handle && !this.canPlace()) return;
    const alreadySelected = !!handle && handle.id === this.selectedId;
    this.mouseDown = {
      x: event.clientX,
      y: event.clientY,
      point,
      hitId: handle?.id ?? null,
      dragHandle: alreadySelected ? handle : null,
    };
    if (handle) {
      if (!alreadySelected) this.select(handle.id);
      this.consumePointer(event);
    }
  };
  private readonly handleMouseMove = (event: MouseEvent): void => {
    const start = this.mouseDown;
    if (!start || !start.dragHandle) return;
    if (!this.canHandle()) {
      this.resetPointerInteraction(true);
      return;
    }
    if (!this.draggingHandle) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= CLICK_THRESHOLD) return;
      this.draggingHandle = start.dragHandle;
      this.dragBefore = this.snapshot();
      if (this.draggingHandle.kind === "direction") {
        const item = this.items.find((candidate) => candidate.id === this.draggingHandle?.id);
        if (item) {
          this.directionDragStart = {
            origin: [...item.position] as Vec3,
            direction: normalize(item.direction) ?? [0, 0, 1],
            length: this.clampLength(item.length),
          };
        }
      }
      this.interactions.setClaim("drawing-drag", true);
    }
    this.updateDraggedHandle(this.mousePosition(event), event.shiftKey);
    this.consumePointer(event);
  };
  private readonly handleMouseUp = (event: MouseEvent): void => {
    const start = this.mouseDown;
    if (event.button !== 0 || !start) return;
    if (!this.canHandle()) {
      this.resetPointerInteraction(true);
      return;
    }
    if (this.draggingHandle && this.dragBefore) {
      this.updateDraggedHandle(this.mousePosition(event), event.shiftKey);
      const before = this.dragBefore;
      const label = this.draggingHandle.kind === "position"
        ? "移动巡检点"
        : event.shiftKey ? "调整巡检点长度" : "调整巡检点方向";
      this.resetPointerInteraction();
      if (!this.commitIfChanged(before, label)) { this.rebuildVisuals(); this.emitChange(); }
      this.consumePointer(event);
      return;
    }
    this.mouseDown = null;
    if (start.hitId) { this.select(start.hitId); this.consumePointer(event); return; }
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_THRESHOLD) return;
    if (!this.canPlace()) return;
    if (this.pendingNewId && this.items.some((item) => item.id === this.pendingNewId)) {
      this.select(this.pendingNewId);
      this.callbacks?.onAddBlocked?.();
      this.consumePointer(event);
      return;
    }
    this.pendingNewId = null;
    const mouse = this.mousePosition(event);
    const surface = this.pickSurface(mouse); if (!surface) return;
    const before = this.snapshot();
    const item: InspectionPointItem = {
      id: createId(),
      name: `巡检点 ${this.items.length + 1}`,
      componentType: this.defaultComponentType,
      position: surface.position,
      direction: surface.direction,
      length: surface.length,
      updatedAt: new Date().toISOString(),
    };
    this.items.push(item); this.selectedId = item.id; this.pendingNewId = item.id; this.commit(before, "新增巡检点"); this.consumePointer(event);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.canHandle() || (event.key !== "Delete" && event.key !== "Backspace") || !this.selectedId || (event.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable='true']")) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); this.delete(this.selectedId);
  };
  private resetPointerInteraction(cancel = false): void {
    const before = cancel ? this.dragBefore : null;
    this.mouseDown = null;
    this.draggingHandle = null;
    this.dragBefore = null;
    this.directionDragStart = null;
    this.interactions.setClaim("drawing-drag", false);
    if (before) this.restoreSnapshot(before);
  }
  private updateDraggedHandle(mouse: { x: number; y: number }, lengthMode = false): void {
    const handle = this.draggingHandle;
    const item = handle ? this.items.find((candidate) => candidate.id === handle.id) : null;
    if (!handle || !item) return;
    if (handle.kind === "position") {
      const surface = this.pickSurface(mouse);
      if (!surface) return;
      item.position = [...surface.position] as Vec3;
    } else {
      const dragged = this.dragDirection(mouse, item, lengthMode);
      if (!dragged) return;
      item.direction = dragged.direction;
      item.length = dragged.length;
    }
    item.updatedAt = new Date().toISOString();
    this.selectedId = item.id;
    this.rebuildVisuals();
    this.emitChange();
  }
  private consumePointer(event: MouseEvent): void { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); this.viewer.controls?.stop?.(); }
  private mousePosition(event: MouseEvent): { x: number; y: number } { const rect = this.viewer.renderer.domElement.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private mouseRay(mouse: { x: number; y: number }): { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const mouseToRay = this.potree.Utils?.mouseToRay;
    if (!camera || !mouseToRay) return null;
    const element = this.viewer.renderer.domElement;
    try {
      return mouseToRay(mouse, camera, element.clientWidth, element.clientHeight);
    } catch {
      return null;
    }
  }
  private pickSurface(mouse: { x: number; y: number }): SurfacePick | null {
    const fitted = this.pickSurfaceNormal(mouse);
    if (fitted) {
      const direction = normalize(fitted.direction);
      if (direction) {
        return {
          position: [...fitted.position] as Vec3,
          direction,
          length: DEFAULT_NORMAL_LENGTH,
        };
      }
    }
    return null;
  }
  private clampLength(value: number): number {
    return Number.isFinite(value) && value > 0
      ? Math.max(MIN_NORMAL_LENGTH, Math.min(MAX_NORMAL_LENGTH, value))
      : DEFAULT_NORMAL_LENGTH;
  }
  private dragDirection(
    mouse: { x: number; y: number },
    item: InspectionPointItem,
    lengthMode: boolean,
  ): { direction: Vec3; length: number } | null {
    const ray = this.mouseRay(mouse);
    if (!ray) return null;
    const rayOrigin: Vec3 = [ray.origin.x, ray.origin.y, ray.origin.z];
    const rayDirection = normalize([ray.direction.x, ray.direction.y, ray.direction.z]);
    if (!rayDirection) return null;

    const dragStart = this.directionDragStart;
    const baseDirection = dragStart?.direction ?? normalize(item.direction) ?? [0, 0, 1];
    const baseLength = dragStart?.length ?? this.clampLength(item.length);

    // Holding Shift turns the same handle into a length handle. The nearest
    // point between the mouse ray and the direction axis gives a stable scalar
    // length without allowing the camera's view plane to skew the direction.
    if (lengthMode) {
      const origin = dragStart?.origin ?? item.position;
      const offset = subtract(origin, rayOrigin);
      const axisDotRay = dot(baseDirection, rayDirection);
      const denominator = 1 - axisDotRay * axisDotRay;
      let amount: number;
      if (denominator > 1e-6) {
        amount = (axisDotRay * dot(rayDirection, offset) - dot(baseDirection, offset)) / denominator;
      } else {
        amount = dot(baseDirection, offset);
      }
      if (!Number.isFinite(amount)) return null;
      return { direction: baseDirection, length: this.clampLength(amount) };
    }

    // Direction dragging is constrained to a virtual sphere centred on the
    // inspection point. This keeps the line length fixed while the cursor
    // moves around the point in any 3D camera orientation.
    const center = dragStart?.origin ?? item.position;
    const radius = baseLength;
    const toRay = subtract(rayOrigin, center);
    const b = dot(toRay, rayDirection);
    const c = dot(toRay, toRay) - radius * radius;
    const discriminant = b * b - c;
    const candidates: Array<{ direction: Vec3; amount: number }> = [];
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      for (const amount of [-b - root, -b + root]) {
        if (amount <= 0 || !Number.isFinite(amount)) continue;
        const point = add(rayOrigin, scale(rayDirection, amount));
        const direction = normalize(subtract(point, center));
        if (direction) candidates.push({ direction, amount });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((left, right) => {
        const directionScore = dot(right.direction, baseDirection) - dot(left.direction, baseDirection);
        return Math.abs(directionScore) > 1e-6 ? directionScore : left.amount - right.amount;
      });
      return { direction: candidates[0].direction, length: radius };
    }

    // Outside the projected sphere, fall back to the closest point on the
    // mouse ray and retain the previous hemisphere so the handle remains
    // responsive instead of abruptly flipping through the sphere centre.
    const amount = Math.max(0, dot(subtract(center, rayOrigin), rayDirection));
    const closest = add(rayOrigin, scale(rayDirection, amount));
    const fallback = normalize(subtract(closest, center));
    if (!fallback) return { direction: baseDirection, length: radius };
    return {
      direction: dot(fallback, baseDirection) >= 0 ? fallback : scale(fallback, -1),
      length: radius,
    };
  }
  private endpoint(item: InspectionPointItem): Vec3 {
    const direction = normalize(item.direction) ?? [0, 0, 1];
    const length = Number.isFinite(item.length) && item.length > 0
      ? this.clampLength(item.length)
      : DEFAULT_NORMAL_LENGTH;
    return add(item.position, scale(direction, length));
  }
  private project(point: Vec3): { x: number; y: number; z: number } | null {
    const camera = this.viewer.scene.getActiveCamera?.(); if (!camera) return null;
    const projected = new this.three.Vector3(point[0], point[1], point[2]).project(camera); const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    return [projected.x, projected.y, projected.z].every(Number.isFinite) ? { x: (projected.x + 1) * 0.5 * rect.width, y: (1 - projected.y) * 0.5 * rect.height, z: projected.z } : null;
  }
  private hitTestHandle(mouse: { x: number; y: number }): InspectionHandle | null {
    const selected = this.items.find((item) => item.id === this.selectedId && this.isVisible(item));
    if (selected) {
      const origin = this.project(selected.position);
      const end = this.project(this.endpoint(selected));
      if (origin && end && origin.z >= -1 && origin.z <= 1 && end.z >= -1 && end.z <= 1) {
        const originDistance = (origin.x - mouse.x) ** 2 + (origin.y - mouse.y) ** 2;
        const endDistance = (end.x - mouse.x) ** 2 + (end.y - mouse.y) ** 2;
        const lineDistance = distanceSquaredToSegment(mouse.x, mouse.y, origin.x, origin.y, end.x, end.y);
        if (endDistance <= DIRECTION_HIT_DISTANCE_SQ
          || (originDistance > HIT_DISTANCE_SQ && lineDistance <= DIRECTION_LINE_HIT_DISTANCE_SQ)) {
          return { id: selected.id, kind: "direction" };
        }
      }
    }
    let best: { handle: InspectionHandle; distance: number } | null = null;
    this.items.forEach((item) => {
      if (!this.isVisible(item)) return;
      const projected = this.project(item.position);
      if (!projected || projected.z < -1 || projected.z > 1) return;
      const distance = (projected.x - mouse.x) ** 2 + (projected.y - mouse.y) ** 2;
      if (distance <= HIT_DISTANCE_SQ && (!best || distance < best.distance)) {
        best = { handle: { id: item.id, kind: "position" }, distance };
      }
    });
    return best?.handle ?? null;
  }
  private rebuildVisuals(): void {
    this.clearVisuals();
    if (!this.pageActive || this.items.length === 0) return;
    const visibleItems = this.items.filter((item) => this.isVisible(item));
    if (visibleItems.length === 0) return;
    const origin = visibleItems[0].position;
    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);
    visibleItems.forEach((item) => {
      const itemIndex = this.items.findIndex((candidate) => candidate.id === item.id);
      const selected = item.id === this.selectedId;
      const geometry = new this.three.SphereGeometry(1, 16, 12);
      const material = new this.three.MeshPhongMaterial({
        color: selected ? SELECTED_COLOR : POINT_COLOR,
        emissive: selected ? 0x344d00 : 0x102e0a,
        specular: 0xeaffdf,
        shininess: 88,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: selected ? 1 : 0.96,
      });
      const mesh = new this.three.Mesh(geometry, material);
      const local = subtract(item.position, origin);
      mesh.position.set(local[0], local[1], local[2]);
      const pointScale = selected ? SELECTED_POINT_SCALE : POINT_SCALE;
      mesh.scale.set(pointScale, pointScale, pointScale);
      group.add(mesh);

      if (selected) {
        const haloMaterial = new this.three.MeshBasicMaterial({
          color: SELECTED_COLOR,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.2,
        });
        const halo = new this.three.Mesh(geometry, haloMaterial);
        halo.position.set(local[0], local[1], local[2]);
        halo.scale.set(SELECTED_HALO_SCALE, SELECTED_HALO_SCALE, SELECTED_HALO_SCALE);
        this.selectedPointMesh = halo;
        group.add(halo);
      }

      const end = this.endpoint(item);
      const guideColor = selected ? SELECTED_COLOR : NORMAL_COLOR;
      const lineWidth = NORMAL_LINE_THICKNESS * (selected ? 1.12 : 1);
      const lineOpacity = selected ? 0.98 : 0.88;
      const direction = normalize(subtract(end, item.position));
      const lineStart = direction
        ? add(item.position, scale(direction, pointScale * 0.72))
        : item.position;
      const lineEnd = direction
        ? subtract(end, scale(direction, ARROW_HEAD_LENGTH))
        : end;
      this.addLine(group, lineStart, lineEnd, origin, guideColor, lineWidth, lineOpacity);
      this.addArrowHead(group, item.position, end, origin, guideColor, lineOpacity);

      if (this.namesVisible) {
        const label = document.createElement("div");
        label.textContent = item.name?.trim() || `巡检点 ${itemIndex + 1}`;
        Object.assign(label.style, {
          position: "absolute",
          color: "#ffffff",
          background: "rgba(15, 23, 42, 0.86)",
          border: `1px solid ${selected ? "#d4ff3f" : "rgba(82, 196, 26, 0.72)"}`,
          borderRadius: "4px",
          padding: "2px 6px",
          fontSize: "12px",
          fontWeight: "600",
          lineHeight: "17px",
          boxShadow: selected
            ? "0 0 0 2px rgba(212, 255, 63, 0.26), 0 2px 5px rgba(0, 0, 0, 0.42)"
            : "0 1px 3px rgba(0, 0, 0, 0.45)",
          transform: "translate(-50%, -125%)",
          whiteSpace: "nowrap",
        });
        this.labelContainer.appendChild(label);
        this.labels.push({ position: item.position, element: label });
      }
    });
    this.visualGroup = group;
    this.scene.add(group);
  }
  private addLine(group: PotreeThreeObject3D, from: Vec3, to: Vec3, origin: Vec3, color: number, thickness: number, opacity: number): void {
    const localFrom = subtract(from, origin);
    const localTo = subtract(to, origin);
    const length = Math.hypot(...subtract(localTo, localFrom));
    if (!Number.isFinite(length) || length <= 1e-8) return;
    const geometry = new this.three.CylinderGeometry(1, 1, 1, 12, 1, false);
    geometry.rotateX(Math.PI / 2);
    const material = new this.three.MeshPhongMaterial({
      color,
      emissive: 0x102e0a,
      specular: 0x8fd66b,
      shininess: 34,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity,
    });
    const mesh = new this.three.Mesh(geometry, material);
    mesh.position.set(
      (localFrom[0] + localTo[0]) / 2,
      (localFrom[1] + localTo[1]) / 2,
      (localFrom[2] + localTo[2]) / 2,
    );
    mesh.scale.set(thickness, thickness, length);
    if (Math.abs((localTo[1] - localFrom[1]) / length) > 0.999) mesh.up.set(1, 0, 0);
    mesh.lookAt(localTo[0], localTo[1], localTo[2]);
    group.add(mesh);
  }
  private addArrowHead(group: PotreeThreeObject3D, from: Vec3, to: Vec3, origin: Vec3, color: number, opacity: number): void {
    const direction = normalize(subtract(to, from));
    if (!direction) return;
    const base = subtract(to, scale(direction, ARROW_HEAD_LENGTH));
    const geometry = new this.three.ConeGeometry(ARROW_HEAD_RADIUS, ARROW_HEAD_LENGTH, 12, 1, false);
    geometry.rotateX(Math.PI / 2);
    const material = new this.three.MeshPhongMaterial({
      color,
      emissive: 0x102e0a,
      specular: 0xb7eb8f,
      shininess: 42,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity,
    });
    const mesh = new this.three.Mesh(geometry, material);
    const localBase = subtract(base, origin);
    const localTip = subtract(to, origin);
    mesh.position.set(
      (localBase[0] + localTip[0]) / 2,
      (localBase[1] + localTip[1]) / 2,
      (localBase[2] + localTip[2]) / 2,
    );
    mesh.lookAt(localTip[0], localTip[1], localTip[2]);
    group.add(mesh);
  }
  private clearVisuals(): void { this.labels.forEach(({ element }) => element.remove()); this.labels = []; this.selectedPointMesh = null; if (this.visualGroup) { this.scene.remove(this.visualGroup); disposeObject(this.visualGroup); this.visualGroup = null; } }
  private readonly renderOverlay = (): void => {
    if (!this.pageActive || !this.visualGroup) return;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return;
    if (this.selectedPointMesh) {
      const phase = (performance.now() % SELECTED_PULSE_DURATION_MS) / SELECTED_PULSE_DURATION_MS * Math.PI * 2;
      const pulseScale = SELECTED_HALO_SCALE * (1.04 + Math.sin(phase) * 0.12);
      this.selectedPointMesh.scale.set(pulseScale, pulseScale, pulseScale);
    }
    this.viewer.renderer.render(this.scene, camera);
    this.labels.forEach(({ position, element }) => {
      const projected = this.project(position);
      if (!projected || projected.z < -1 || projected.z > 1) {
        element.style.display = "none";
        return;
      }
      element.style.display = "block";
      element.style.left = `${projected.x}px`;
      element.style.top = `${projected.y}px`;
    });
  };
}
