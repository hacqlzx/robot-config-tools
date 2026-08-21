import {
  type PotreeCamera,
  type PotreeNamespace,
  type PotreeRay,
  type PotreeThreeDisposable,
  type PotreeThreeNamespace,
  type PotreeThreeObject3D,
  type PotreeThreeVector3,
  type PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { PathData, PathPoint, PathSegment } from "../../hooks/drawing/drawing-schema";
import type { SpacePathCallbacks } from "./types";

type Vec3 = [number, number, number];

interface PathSnapshot {
  data: PathData;
  selectedPointId: string | null;
  selectedPathId: string | null;
  lastConnectedPointId: string | null;
}

interface PathLabel {
  position: Vec3;
  element: HTMLDivElement;
}

interface PointVisualStyle {
  color: number;
  scale: number;
  labelColor: string;
}

const CLICK_THRESHOLD = 3;
const POINT_HIT_DISTANCE_SQ = 100;
const PATH_HIT_DISTANCE_SQ = 64;
const CONTROL_HIT_DISTANCE_SQ = 100;
const CURVE_SEGMENTS = 16;
const PATH_COLOR = 0x9ee694;
const SELECTED_COLOR = 0xffd91a;
const CONTROL_COLOR = 0x8099ff;
const PATH_THICKNESS = 0.025;
const POINT_SCALE = 0.08;
const POINT_COLLECTION_SCALE = 0.095;
const POINT_TOPO_SCALE = 0.055;
const POINT_LABEL_COLOR = "#44e95f";
const POINT_TOPO_LABEL_COLOR = "#c7ccd4";
const CONTROL_SCALE = 0.065;

function clonePoint(point: PathPoint): PathPoint {
  return { ...point };
}

function cloneSegment(segment: PathSegment): PathSegment {
  return {
    ...segment,
    bezier: segment.bezier
      ? { cp1: [...segment.bezier.cp1] as Vec3, cp2: [...segment.bezier.cp2] as Vec3 }
      : null,
  };
}

function cloneData(data: PathData): PathData {
  return {
    points: data.points.map(clonePoint),
    paths: data.paths.map(cloneSegment),
  };
}

function finitePoint(point: Vec3): boolean {
  return point.every(Number.isFinite);
}

function pointVisualStyle(point: PathPoint, selected: boolean): PointVisualStyle | null {
  if (point.role === "waypoint") return null;
  const isTopo = point.robotType === "4";
  const baseScale = isTopo ? POINT_TOPO_SCALE : point.robotType === "5" ? POINT_COLLECTION_SCALE : POINT_SCALE;
  return {
    color: selected ? SELECTED_COLOR : isTopo ? 0xc7ccd4 : PATH_COLOR,
    scale: selected ? baseScale * 1.25 : baseScale,
    labelColor: isTopo ? POINT_TOPO_LABEL_COLOR : POINT_LABEL_COLOR,
  };
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

let idCounter = 0;
function createId(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${(idCounter++).toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
}

/** Potree 版可行驶参考路径编辑器，坐标直接使用 LAS 绝对坐标。 */
export class PotreePathEditor {
  private readonly scene: PotreeThreeObject3D;
  private readonly labelContainer: HTMLDivElement;
  private visualGroup: PotreeThreeObject3D | null = null;
  private labels: PathLabel[] = [];
  private callbacks: SpacePathCallbacks | null = null;
  private data: PathData = { points: [], paths: [] };
  private enabled = false;
  private active = false;
  private pageActive = true;
  private selectedPointId: string | null = null;
  private selectedPathId: string | null = null;
  private lastConnectedPointId: string | null = null;
  private mouseDown: { x: number; y: number } | null = null;
  private pendingPointId: string | null = null;
  private pendingPathId: string | null = null;
  private draggingPointId: string | null = null;
  private dragBefore: PathSnapshot | null = null;
  private pendingControl: { pathId: string; which: 1 | 2 } | null = null;
  private draggingControl: { pathId: string; which: 1 | 2 } | null = null;
  private controlDragBefore: PathSnapshot | null = null;
  private undoStack: PathSnapshot[] = [];
  private redoStack: PathSnapshot[] = [];

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
  ) {
    this.scene = new three.Scene();
    this.labelContainer = this.createLabelContainer(host);
    host.addEventListener("mousedown", this.handleMouseDown, true);
    document.addEventListener("mousemove", this.handleMouseMove, true);
    document.addEventListener("mouseup", this.handleMouseUp, true);
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("mouseleave", this.cancelDrag);
    window.addEventListener("blur", this.cancelDrag);
    viewer.addEventListener("render.pass.perspective_overlay", this.renderOverlay);
  }

  start(callbacks: SpacePathCallbacks): void {
    this.callbacks = callbacks;
    this.enabled = true;
    this.emitChange();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelDrag();
    this.emitChange();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.clearPathSelectionClaim();
    this.selectedPointId = null;
    this.selectedPathId = null;
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    this.lastConnectedPointId = null;
    this.cancelDrag();
    this.rebuildVisuals();
    this.emitChange();
  }

  setPageActive(active: boolean): void {
    this.pageActive = active;
    if (!active) {
      this.cancelDrag();
      this.viewer.controls?.stop?.();
    }
  }

  setData(data: PathData | null): void {
    this.data = data ? cloneData(data) : { points: [], paths: [] };
    this.clearPathSelectionClaim();
    this.selectedPointId = null;
    this.selectedPathId = null;
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    this.lastConnectedPointId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.cancelDrag();
    this.rebuildVisuals();
    this.emitChange();
  }

  getData(): PathData | null {
    return this.data.points.length > 0 ? cloneData(this.data) : null;
  }

  hasDraft(): boolean {
    return this.data.points.length > 0;
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
    this.restore(snapshot as PathSnapshot);
  }

  clear(): void {
    this.data = { points: [], paths: [] };
    this.clearPathSelectionClaim();
    this.selectedPointId = null;
    this.selectedPathId = null;
    this.lastConnectedPointId = null;
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    this.undoStack = [];
    this.redoStack = [];
    this.cancelDrag();
    this.rebuildVisuals();
    this.emitChange();
  }

  dispose(): void {
    this.clearPathSelectionClaim();
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    document.removeEventListener("mouseup", this.handleMouseUp, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("mouseleave", this.cancelDrag);
    window.removeEventListener("blur", this.cancelDrag);
    this.viewer.removeEventListener("render.pass.perspective_overlay", this.renderOverlay);
    this.clearVisualGroup();
    this.labelContainer.remove();
    this.callbacks = null;
  }

  private snapshot(): PathSnapshot {
    return {
      data: cloneData(this.data),
      selectedPointId: this.selectedPointId,
      selectedPathId: this.selectedPathId,
      lastConnectedPointId: this.lastConnectedPointId,
    };
  }

  private restore(snapshot: PathSnapshot): void {
    this.data = cloneData(snapshot.data);
    this.selectedPointId = snapshot.selectedPointId;
    this.selectedPathId = snapshot.selectedPathId;
    this.lastConnectedPointId = snapshot.lastConnectedPointId;
    this.rebuildVisuals();
    this.emitChange();
  }

  private commit(before: PathSnapshot, label = "路径编辑"): void {
    this.undoStack.push(before);
    this.redoStack = [];
    this.callbacks?.onHistory?.(before, this.snapshot(), label);
    this.rebuildVisuals();
    this.emitChange();
  }

  private emitChange(): void {
    this.callbacks?.onChange({
      pointCount: this.data.points.length,
      connectionCount: this.data.paths.length,
      active: this.active,
      selectedPointId: this.selectedPointId,
      selectedPathId: this.selectedPathId,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  private point(id: string | null): PathPoint | null {
    return id ? this.data.points.find((item) => item.id === id) ?? null : null;
  }

  private addPoint(position: Vec3): void {
    const before = this.snapshot();
    const point: PathPoint = { id: createId("point"), x: position[0], y: position[1], z: position[2] };
    this.data.points.push(point);
    if (this.lastConnectedPointId && this.lastConnectedPointId !== point.id) {
      this.data.paths.push({
        id: createId("path"),
        from: this.lastConnectedPointId,
        to: point.id,
        bezier: null,
      });
    }
    this.lastConnectedPointId = point.id;
    this.selectedPointId = null;
    this.selectedPathId = null;
    this.commit(before, "绘制路径点");
  }

  private connectToPoint(pointId: string): void {
    if (pointId === this.lastConnectedPointId) return;
    const before = this.snapshot();
    if (this.lastConnectedPointId) {
      this.data.paths.push({
        id: createId("path"),
        from: this.lastConnectedPointId,
        to: pointId,
        bezier: null,
      });
    }
    this.lastConnectedPointId = pointId;
    this.selectedPointId = null;
    this.selectedPathId = null;
    this.commit(before, "连接路径点");
  }

  private movePoint(pointId: string, position: Vec3): void {
    const point = this.point(pointId);
    if (!point) return;
    point.x = position[0];
    point.y = position[1];
    point.z = position[2];
    this.rebuildVisuals();
    this.emitChange();
  }

  private deleteSelected(): void {
    if (this.selectedPathId) {
      const before = this.snapshot();
      this.data.paths = this.data.paths.filter((path) => path.id !== this.selectedPathId);
      this.selectedPathId = null;
      this.commit(before, "删除路径段");
      return;
    }
    if (!this.selectedPointId) return;
    const before = this.snapshot();
    const deleted = this.selectedPointId;
    this.data.paths = this.data.paths.filter((path) => path.from !== deleted && path.to !== deleted);
    this.data.points = this.data.points.filter((point) => point.id !== deleted);
    if (this.lastConnectedPointId === deleted) this.lastConnectedPointId = null;
    this.selectedPointId = null;
    this.commit(before, "删除路径点");
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.pageActive || !this.enabled || this.active || event.key !== "Delete") return;
    if ((window as Window & { __clipDragging?: boolean }).__clipDragging) return;
    this.deleteSelected();
  };

  private canHandlePointer(): boolean {
    if (!this.pageActive) return false;
    const mode = (window as Window & { __spaceEditInteractionMode?: string }).__spaceEditInteractionMode;
    return !mode || mode === "idle" || mode === "path";
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.enabled || !this.canHandlePointer()) return;
    const flags = window as Window & { __clipDragging?: boolean; __drawingDragging?: boolean };
    if (flags.__clipDragging || flags.__drawingDragging) return;

    const mouse = this.mousePosition(event);
    this.mouseDown = { x: event.clientX, y: event.clientY };
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    this.clearPathSelectionClaim();

    if (!this.active) {
      const control = this.hitTestControlPoint(mouse);
      if (control) {
        this.selectedPointId = null;
        this.selectedPathId = control.pathId;
        this.pendingControl = control;
        this.setPathSelectionClaim();
        this.rebuildVisuals();
        this.emitChange();
        this.consumePointer(event);
        return;
      }
    }

    const point = this.hitTestPoint(mouse);
    if (point) {
      this.selectedPointId = point.id;
      this.selectedPathId = null;
      this.pendingPointId = point.id;
      if (!this.active) this.setPathSelectionClaim();
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }

    if (!this.active) {
      const path = this.hitTestPath(mouse);
      if (path) {
        this.pendingPathId = path.id;
        this.setPathSelectionClaim();
      }
      else {
        this.selectedPointId = null;
        this.selectedPathId = null;
        this.rebuildVisuals();
        this.emitChange();
      }
    }
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.pageActive) return;
    const flags = window as Window & { __drawingDragging?: boolean };
    if (!this.active && !this.draggingControl && this.pendingControl && this.mouseDown) {
      const distance = Math.hypot(event.clientX - this.mouseDown.x, event.clientY - this.mouseDown.y);
      if (distance > CLICK_THRESHOLD) {
        this.draggingControl = this.pendingControl;
        this.controlDragBefore = this.snapshot();
        this.pendingControl = null;
        this.pendingPointId = null;
        this.pendingPathId = null;
        flags.__drawingDragging = true;
      }
    }

    if (this.draggingControl && this.controlDragBefore) {
      const position = this.controlDragPosition(this.mousePosition(event), this.draggingControl.pathId);
      if (position) {
        this.moveControlPoint(this.draggingControl.pathId, this.draggingControl.which, position);
      }
      this.consumePointer(event);
      return;
    }

    if (!this.active && !this.draggingPointId && this.pendingPointId && this.mouseDown) {
      const distance = Math.hypot(event.clientX - this.mouseDown.x, event.clientY - this.mouseDown.y);
      if (distance <= CLICK_THRESHOLD) return;
      this.draggingPointId = this.pendingPointId;
      this.dragBefore = this.snapshot();
      this.pendingPointId = null;
      this.pendingPathId = null;
      flags.__drawingDragging = true;
    }

    if (!this.draggingPointId || !this.dragBefore) return;
    const position = this.dragPosition(this.mousePosition(event), this.draggingPointId);
    if (position) this.movePoint(this.draggingPointId, position);
    this.consumePointer(event);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (!this.pageActive) return;
    if (event.button !== 0) return;
    // The drawing renderer runs on window capture before this document
    // listener, so keep the claim until it has yielded the mouseup.
    this.clearPathSelectionClaim();
    const flags = window as Window & { __drawingDragging?: boolean };

    if (this.draggingControl && this.controlDragBefore) {
      const before = this.controlDragBefore;
      const dragging = this.draggingControl;
      const position = this.controlDragPosition(this.mousePosition(event), dragging.pathId);
      if (position) this.moveControlPoint(dragging.pathId, dragging.which, position);
      this.draggingControl = null;
      this.controlDragBefore = null;
      this.mouseDown = null;
      flags.__drawingDragging = false;
      if (JSON.stringify(before.data) !== JSON.stringify(this.data)) {
        this.undoStack.push(before);
        this.redoStack = [];
        this.callbacks?.onHistory?.(before, this.snapshot(), "调整路径曲线");
      }
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }

    if (this.draggingPointId && this.dragBefore) {
      const before = this.dragBefore;
      const snap = this.pickPoint(this.mousePosition(event));
      if (snap) this.movePoint(this.draggingPointId, snap);
      this.draggingPointId = null;
      this.dragBefore = null;
      flags.__drawingDragging = false;
      if (JSON.stringify(before.data) !== JSON.stringify(this.data)) {
        this.undoStack.push(before);
        this.redoStack = [];
        this.callbacks?.onHistory?.(before, this.snapshot(), "移动路径点");
      }
      this.rebuildVisuals();
      this.emitChange();
      this.consumePointer(event);
      return;
    }

    const start = this.mouseDown;
    this.mouseDown = null;
    if (!start || !this.enabled || !this.canHandlePointer()) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_THRESHOLD) {
      this.pendingPointId = null;
      this.pendingPathId = null;
      this.pendingControl = null;
      flags.__drawingDragging = false;
      return;
    }

    if (!this.active) {
      if (this.pendingControl) {
        this.pendingControl = null;
        this.rebuildVisuals();
        this.emitChange();
        this.consumePointer(event);
        return;
      }
      if (this.pendingPointId) {
        this.pendingPointId = null;
        this.rebuildVisuals();
        this.emitChange();
        this.consumePointer(event);
        return;
      }
      if (this.pendingPathId) {
        this.selectedPointId = null;
        this.selectedPathId = this.pendingPathId;
        this.pendingPathId = null;
        this.rebuildVisuals();
        this.emitChange();
        this.consumePointer(event);
      }
      return;
    }

    const mouse = this.mousePosition(event);
    const point = this.pendingPointId ? this.point(this.pendingPointId) : this.hitTestPoint(mouse);
    if (point) this.connectToPoint(point.id);
    else {
      const picked = this.pickPoint(mouse);
      if (picked) this.addPoint(picked);
    }
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    flags.__drawingDragging = false;
    this.consumePointer(event);
  };

  private cancelDrag = (): void => {
    this.clearPathSelectionClaim();
    this.mouseDown = null;
    this.pendingPointId = null;
    this.pendingPathId = null;
    this.pendingControl = null;
    this.draggingPointId = null;
    this.dragBefore = null;
    this.draggingControl = null;
    this.controlDragBefore = null;
    (window as Window & { __drawingDragging?: boolean }).__drawingDragging = false;
  };

  private setPathSelectionClaim(): void {
    (window as Window & { __spaceEditPathSelectionPending?: boolean }).__spaceEditPathSelectionPending = true;
  }

  private clearPathSelectionClaim(): void {
    (window as Window & { __spaceEditPathSelectionPending?: boolean }).__spaceEditPathSelectionPending = false;
  }

  private consumePointer(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
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

  private dragPosition(mouse: { x: number; y: number }, pointId: string): Vec3 | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const point = this.point(pointId);
    if (!camera || !point) return null;
    const ray = this.mouseRay(camera, mouse);
    if (!ray || Math.abs(ray.direction.z) < 1e-8) return null;
    const amount = (point.z - ray.origin.z) / ray.direction.z;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      point.z,
    ];
  }

  private projectWorldPoint(point: Vec3, camera: PotreeCamera): { x: number; y: number } | null {
    const projected = new this.three.Vector3(point[0], point[1], point[2]).project(camera) as PotreeThreeVector3;
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (![projected.x, projected.y, projected.z].every(Number.isFinite)
      || projected.z < -1 || projected.z > 1) return null;
    return {
      x: (projected.x + 1) * 0.5 * bounds.width,
      y: (1 - projected.y) * 0.5 * bounds.height,
    };
  }

  private projectPoint(point: PathPoint, camera: PotreeCamera): { x: number; y: number } | null {
    return this.projectWorldPoint([point.x, point.y, point.z], camera);
  }

  private hitTestPoint(mouse: { x: number; y: number }): PathPoint | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    let result: PathPoint | null = null;
    let bestDistance = POINT_HIT_DISTANCE_SQ;
    this.data.points.forEach((point) => {
      if (!pointVisualStyle(point, false)) return;
      const projected = this.projectPoint(point, camera);
      if (!projected) return;
      const distance = (projected.x - mouse.x) ** 2 + (projected.y - mouse.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        result = point;
      }
    });
    return result;
  }

  private hitTestPath(mouse: { x: number; y: number }): PathSegment | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    let result: PathSegment | null = null;
    let bestDistance = PATH_HIT_DISTANCE_SQ;
    this.data.paths.forEach((segment) => {
      const from = this.point(segment.from);
      const to = this.point(segment.to);
      if (!from || !to) return;
      const samples = this.segmentPoints(segment, from, to);
      for (let index = 1; index < samples.length; index += 1) {
        const first = this.projectPoint(samples[index - 1], camera);
        const second = this.projectPoint(samples[index], camera);
        if (!first || !second) continue;
        const distance = distanceSquaredToSegment(mouse.x, mouse.y, first.x, first.y, second.x, second.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          result = segment;
        }
      }
    });
    return result;
  }

  private controlPoints(segment: PathSegment, from: PathPoint, to: PathPoint): [Vec3, Vec3] {
    if (segment.bezier) return [segment.bezier.cp1, segment.bezier.cp2];
    return [
      [
        from.x + (to.x - from.x) / 3,
        from.y + (to.y - from.y) / 3,
        from.z + (to.z - from.z) / 3,
      ],
      [
        from.x + (to.x - from.x) * 2 / 3,
        from.y + (to.y - from.y) * 2 / 3,
        from.z + (to.z - from.z) * 2 / 3,
      ],
    ];
  }

  private hitTestControlPoint(mouse: { x: number; y: number }): { pathId: string; which: 1 | 2 } | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera || !this.selectedPathId) return null;
    const segment = this.data.paths.find((item) => item.id === this.selectedPathId);
    if (!segment) return null;
    const from = this.point(segment.from);
    const to = this.point(segment.to);
    if (!from || !to) return null;
    const [cp1, cp2] = this.controlPoints(segment, from, to);
    const candidates: Array<[Vec3, 1 | 2]> = [[cp1, 1], [cp2, 2]];
    for (const [point, which] of candidates) {
      const projected = this.projectWorldPoint(point, camera);
      if (!projected) continue;
      const distance = (projected.x - mouse.x) ** 2 + (projected.y - mouse.y) ** 2;
      if (distance < CONTROL_HIT_DISTANCE_SQ) return { pathId: segment.id, which };
    }
    return null;
  }

  private controlDragPosition(mouse: { x: number; y: number }, pathId: string): Vec3 | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return null;
    const segment = this.data.paths.find((item) => item.id === pathId);
    if (!segment) return null;
    const from = this.point(segment.from);
    const to = this.point(segment.to);
    if (!from || !to) return null;
    const ray = this.mouseRay(camera, mouse);
    if (!ray || Math.abs(ray.direction.z) < 1e-8) return null;
    const planeZ = (from.z + to.z) / 2;
    const amount = (planeZ - ray.origin.z) / ray.direction.z;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return [
      ray.origin.x + ray.direction.x * amount,
      ray.origin.y + ray.direction.y * amount,
      planeZ,
    ];
  }

  private moveControlPoint(pathId: string, which: 1 | 2, position: Vec3): void {
    const segment = this.data.paths.find((item) => item.id === pathId);
    if (!segment) return;
    if (!segment.bezier) {
      const from = this.point(segment.from);
      const to = this.point(segment.to);
      if (!from || !to) return;
      const [cp1, cp2] = this.controlPoints(segment, from, to);
      segment.bezier = { cp1: [...cp1] as Vec3, cp2: [...cp2] as Vec3 };
    }
    if (which === 1) segment.bezier.cp1 = [position[0], position[1], position[2]];
    else segment.bezier.cp2 = [position[0], position[1], position[2]];
    this.rebuildVisuals();
    this.emitChange();
  }

  private segmentPoints(segment: PathSegment, from: PathPoint, to: PathPoint): PathPoint[] {
    if (!segment.bezier) return [from, to];
    const points: PathPoint[] = [];
    for (let index = 0; index <= CURVE_SEGMENTS; index += 1) {
      const t = index / CURVE_SEGMENTS;
      const inverse = 1 - t;
      points.push({
        id: `sample:${index}`,
        x: inverse ** 3 * from.x
          + 3 * inverse ** 2 * t * segment.bezier.cp1[0]
          + 3 * inverse * t ** 2 * segment.bezier.cp2[0]
          + t ** 3 * to.x,
        y: inverse ** 3 * from.y
          + 3 * inverse ** 2 * t * segment.bezier.cp1[1]
          + 3 * inverse * t ** 2 * segment.bezier.cp2[1]
          + t ** 3 * to.y,
        z: inverse ** 3 * from.z
          + 3 * inverse ** 2 * t * segment.bezier.cp1[2]
          + 3 * inverse * t ** 2 * segment.bezier.cp2[2]
          + t ** 3 * to.z,
      });
    }
    return points;
  }

  private rebuildVisuals(): void {
    this.clearVisualGroup();
    if (this.data.points.length === 0) return;
    const origin: Vec3 = [this.data.points[0].x, this.data.points[0].y, this.data.points[0].z];
    const group = new this.three.Group();
    group.position.set(origin[0], origin[1], origin[2]);

    this.data.paths.forEach((segment) => {
      const from = this.point(segment.from);
      const to = this.point(segment.to);
      if (!from || !to) return;
      const points = this.segmentPoints(segment, from, to);
      const color = segment.id === this.selectedPathId ? SELECTED_COLOR : PATH_COLOR;
      for (let index = 1; index < points.length; index += 1) {
        this.addLine(group, points[index - 1], points[index], origin, color, PATH_THICKNESS);
      }
    });

    this.addPoints(group, this.data.points, origin);
    this.visualGroup = group;
    this.scene.add(group);
  }

  private addLine(
    group: PotreeThreeObject3D,
    fromPoint: PathPoint,
    toPoint: PathPoint,
    origin: Vec3,
    color: number,
    thickness: number,
  ): void {
    const from: Vec3 = [fromPoint.x - origin[0], fromPoint.y - origin[1], fromPoint.z - origin[2]];
    const to: Vec3 = [toPoint.x - origin[0], toPoint.y - origin[1], toPoint.z - origin[2]];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const length = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(length) || length <= 1e-8) return;
    const geometry = new this.three.BoxGeometry(1, 1, 1);
    const material = new this.three.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
    const mesh = new this.three.Mesh(geometry, material);
    mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    mesh.scale.set(thickness, thickness, length);
    if (Math.abs(dy / length) > 0.999) mesh.up.set(1, 0, 0);
    mesh.lookAt(to[0], to[1], to[2]);
    group.add(mesh);
  }

  private addPoints(group: PotreeThreeObject3D, points: PathPoint[], origin: Vec3): void {
    const geometry = new this.three.SphereGeometry(1, 12, 8);
    points.forEach((point) => {
      const selected = point.id === this.selectedPointId;
      const style = pointVisualStyle(point, selected);
      if (!style) return;
      const material = new this.three.MeshBasicMaterial({ color: style.color, depthTest: true, depthWrite: true });
      const mesh = new this.three.Mesh(geometry, material);
      mesh.position.set(point.x - origin[0], point.y - origin[1], point.z - origin[2]);
      mesh.scale.set(style.scale, style.scale, style.scale);
      group.add(mesh);
      const name = point.name?.trim();
      if (name) {
        this.labels.push({
          position: [point.x, point.y, point.z],
          element: this.createLabel(name, style.labelColor),
        });
      }
    });
    if (this.selectedPathId) {
      const segment = this.data.paths.find((item) => item.id === this.selectedPathId);
      if (segment) {
        const from = this.point(segment.from);
        const to = this.point(segment.to);
        if (!from || !to) return;
        const points = this.controlPoints(segment, from, to);
        const controlGeometry = new this.three.SphereGeometry(1, 10, 6);
        const controlMaterial = new this.three.MeshBasicMaterial({ color: CONTROL_COLOR, depthTest: true, depthWrite: true });
        points.forEach((point) => {
          const mesh = new this.three.Mesh(controlGeometry, controlMaterial);
          mesh.position.set(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
          mesh.scale.set(CONTROL_SCALE, CONTROL_SCALE, CONTROL_SCALE);
          group.add(mesh);
        });
      }
    }
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
      zIndex: "16",
    });
    host.appendChild(container);
    return container;
  }

  private createLabel(text: string, color: string): HTMLDivElement {
    const element = document.createElement("div");
    element.textContent = text;
    Object.assign(element.style, {
      position: "absolute",
      display: "none",
      color,
      fontSize: "16px",
      fontWeight: "700",
      lineHeight: "1.2",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      textShadow: "0 0 3px #000, 0 0 3px #000",
      transform: "translate(-50%, -145%)",
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
    });
  }

  private readonly renderOverlay = (): void => {
    if (!this.pageActive) return;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!camera) return;
    if (this.visualGroup) this.viewer.renderer.render(this.scene, camera);
    this.updateLabels(camera);
  };
}
