import {
  loadPotreeRuntime,
  loadPotreeThreeRuntime,
  type PotreeNamespace,
  type PotreeGeometryNode,
  type PotreeNodeCache,
  type PotreePointCloud,
  type PotreeTransformObject,
  type PotreeThreeNamespace,
  type PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { ViewDirection } from "../../types";
import type { PathData } from "../../hooks/drawing/drawing-schema";
import { PotreeDepthZoomController } from "./PotreeDepthZoomController";
import { PotreeChargingAreaEditor } from "./PotreeChargingAreaEditor";
import { PotreeCabinetEditor } from "./PotreeCabinetEditor";
import { PotreeDeviceAreaEditor } from "./PotreeDeviceAreaEditor";
import { PotreeDrawingRenderer } from "./PotreeDrawingRenderer";
import { PotreeFlyKeyboardController } from "./PotreeFlyKeyboardController";
import { PotreePathEditor } from "./PotreePathEditor";
import { PotreeNormalAnnotationEditor } from "./PotreeNormalAnnotationEditor";
import { PotreeInspectionPointEditor } from "./PotreeInspectionPointEditor";
import { PotreeRotationPivotIndicator } from "./PotreeRotationPivotIndicator";
import { SpaceInteractionCoordinator, type SpaceInteractionMode } from "./SpaceInteractionCoordinator";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  normalizeSpaceRenderSettings,
  SPACE_POINT_BUDGET_ALL,
  SPACE_POINT_BUDGET_MAX,
  type SpaceRenderDetailLevel,
  type SpaceRenderSettings,
  type SpaceClipBounds,
  type SpaceClipBox,
  type SpaceChargingAreaCallbacks,
  type SpaceCabinetCallbacks,
  type SpaceDeviceAreaBox,
  type SpaceDeviceAreaCallbacks,
  type SpaceDrawingLayer,
  type SpaceDrawingHistoryScope,
  type SpaceDrawingHistorySnapshot,
  type SpaceDrawingInteractionCallbacks,
  type SpacePathCallbacks,
  type SpaceNormalAnnotation,
  type SpaceNormalAnnotationCallbacks,
  type SpaceInspectionPoint,
  type SpaceInspectionPointCallbacks,
  type SpaceSceneAdapter,
  type SpaceSceneModel,
  type SpaceViewLock,
} from "./types";

const MODEL_LOAD_TIMEOUT_MS = 60_000;
const FIT_PADDING = 1.05;
const MIN_FIT_DISTANCE = 0.01;
const DIRECTION_LOCATE_TARGET_FACTOR = 0.35;
const DIRECTION_LOCATE_CAMERA_FACTOR = 1.15;
const DIRECTION_LOCATE_SIDE_FACTOR = 0.65;
const INTERACTION_LOD_MULTIPLIER = 2;
const FOCUS_INTERACTION_LOD_SETTLE_MS = 650;
const NAVIGATION_INTERACTION_LOD_SETTLE_MS = 180;
const INTERACTION_POINT_BUDGET = 250_000;
const CLIP_HANDLE_BODY_OPACITY = 1;
const CLIP_HANDLE_IDLE_TARGET_OPACITY = 0.4;
const CLIP_HANDLE_BODY_RENDER_ORDER = 1_002;
const CLIP_HANDLE_OUTLINE_RENDER_ORDER = 1_001;
const CLIP_TRANSLATION_THICKNESS_SCALE = 1.25;
const CLIP_TRANSLATION_LENGTH_SCALE = 0.25;
const CLIP_TRANSLATION_OUTLINE_THICKNESS_SCALE = 0.48;
const CLIP_ROTATION_SIZE_SCALE = 0.72;
const CLIP_TRANSLATION_ARROW_COLOR = 0xffe600;
const CLIP_TRANSLATION_ARROW_EMISSIVE = 0x302900;
const CLIP_TRANSLATION_ARROW_SHAFT_RADIUS = 0.42;
const CLIP_TRANSLATION_ARROW_SHAFT_LENGTH = 7.2;
const CLIP_TRANSLATION_ARROW_HEAD_RADIUS = 1.5;
const CLIP_TRANSLATION_ARROW_HEAD_LENGTH = 2.5;
const CLIP_TRANSLATION_ARROW_CENTER_RADIUS = 1.2;
const CLIP_TRANSLATION_PICK_CENTER = (CLIP_TRANSLATION_ARROW_SHAFT_LENGTH + CLIP_TRANSLATION_ARROW_HEAD_LENGTH) / 2;
const CLIP_TRANSLATION_HANDLE_CORNER = -0.5;
const CLIP_SCALE_ARROW_SHAFT_RADIUS = 0.68;
const CLIP_SCALE_ARROW_SHAFT_BACK_LENGTH = 2.1;
const CLIP_SCALE_ARROW_SHAFT_FRONT_LENGTH = 4.2;
const CLIP_SCALE_ARROW_SHAFT_LENGTH = CLIP_SCALE_ARROW_SHAFT_BACK_LENGTH + CLIP_SCALE_ARROW_SHAFT_FRONT_LENGTH;
const CLIP_SCALE_ARROW_HEAD_RADIUS = 2.35;
const CLIP_SCALE_ARROW_HEAD_LENGTH = 3.4;
const CLIP_SCALE_ARROW_RING_RADIUS = 2.1;
const CLIP_SCALE_ARROW_RING_TUBE = 0.58;
const CLIP_SCALE_PICK_RADIAL_SCALE = 2.1;
const CLIP_SCALE_PICK_AXIS_SCALE = 4;
const CLIP_SCALE_PICK_AXIS_OFFSET = 2;
const CLIP_HANDLE_AXIS_COLORS = {
  x: 0xff0000,
  y: 0x00ff00,
  z: 0x0000ff,
} as const;
const CLIP_HANDLE_AXIS_EMISSIVE = {
  x: 0x200000,
  y: 0x002000,
  z: 0x000020,
} as const;
const CLIP_HANDLE_RING_COLOR = 0xd0ccff;
const CLIP_HANDLE_RING_EMISSIVE = 0x28244d;
const CLIP_HANDLE_AMBIENT_LIGHT_INTENSITY = 0.48;
const CLIP_HANDLE_KEY_LIGHT_INTENSITY = 0.68;
const CLIP_HANDLE_FILL_LIGHT_INTENSITY = 0.2;
const CLIP_HANDLE_SHININESS = 52;
const CLIP_HANDLE_RING_SHININESS = 92;
const MIN_NODE_SIZE_BY_DETAIL: Record<SpaceRenderDetailLevel, number> = {
  1: 80,
  2: 30,
  3: 15,
  4: 8,
};

function formatHoverCoordinate(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const fixed = value.toFixed(3);
  return fixed === "-0.000" ? "0.000" : fixed;
}

const POTREE_VIEW_ANGLES: Record<ViewDirection, { yaw: number; pitch: number }> = {
  前: { yaw: 0, pitch: 0 },
  后: { yaw: Math.PI, pitch: 0 },
  左: { yaw: -Math.PI / 2, pitch: 0 },
  右: { yaw: Math.PI / 2, pitch: 0 },
  上: { yaw: 0, pitch: -Math.PI / 2 },
  下: { yaw: -Math.PI, pitch: Math.PI / 2 },
};

function getPointCloudPointCount(pointcloud: PotreePointCloud): number | null {
  const pointCount = pointcloud.pcoGeometry?.loader?.metadata?.points
    ?? pointcloud.pcoGeometry?.numPoints;
  if (typeof pointCount !== "number" || !Number.isFinite(pointCount) || pointCount <= 0) return null;
  return Math.floor(pointCount);
}

function disposeGeometryTree(root?: PotreeGeometryNode, cache?: PotreeNodeCache): void {
  if (!root) return;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    const children = node.children
      ? (Array.isArray(node.children) ? node.children : Object.values(node.children))
      : [];
    pending.push(...children);
    // Potree's LRU is module-global. Removing nodes during model teardown is
    // required so it cannot retain GPU buffers from an unloaded map.
    cache?.remove(node);
    node.dispose?.();
  }
}

export class PotreeSpaceSceneAdapter implements SpaceSceneAdapter {
  private readonly interactions = new SpaceInteractionCoordinator();
  private host: HTMLElement | null = null;
  private viewer: PotreeViewerInstance | null = null;
  private potree: PotreeNamespace | null = null;
  private three: PotreeThreeNamespace | null = null;
  private pointcloud: PotreePointCloud | null = null;
  private keyboardController: PotreeFlyKeyboardController | null = null;
  private depthZoomController: PotreeDepthZoomController | null = null;
  private rotationPivotIndicator: PotreeRotationPivotIndicator | null = null;
  private drawingRenderer: PotreeDrawingRenderer | null = null;
  private chargingAreaEditor: PotreeChargingAreaEditor | null = null;
  private cabinetEditor: PotreeCabinetEditor | null = null;
  private deviceAreaEditor: PotreeDeviceAreaEditor | null = null;
  private pathEditor: PotreePathEditor | null = null;
  private normalAnnotationEditor: PotreeNormalAnnotationEditor | null = null;
  private inspectionPointEditor: PotreeInspectionPointEditor | null = null;
  private inspectionPointCallbacks: SpaceInspectionPointCallbacks | null = null;
  private inspectionPointDefaultComponentType: string | undefined;
  private inspectionPointNamesVisible = true;
  private mountPromise: Promise<void> | null = null;
  private fitTimer: number | null = null;
  private mountVersion = 0;
  private loadVersion = 0;
  private active = true;
  private loadedPointCount: number | null = null;
  private modelClipBounds: SpaceClipBounds | null = null;
  private renderSettings = { ...DEFAULT_SPACE_RENDER_SETTINGS };
  private clipVolume: NonNullable<PotreeViewerInstance["scene"]["volumes"]>[number] | null = null;
  private clipBoxListener: ((box: SpaceClipBox) => void) | null = null;
  private clipVolumeListener: ((event: unknown) => void) | null = null;
  private clipOverlayRenderer: ((event: unknown) => void) | null = null;
  private readonly styledClipHandleNodes = new WeakSet<object>();
  private readonly styledClipHandleObjects = new WeakSet<object>();
  private readonly litClipHandleObjects = new WeakSet<object>();
  private readonly litClipHandleScenes = new WeakSet<object>();
  private readonly clipScaleArrowNodes = new WeakSet<object>();
  private readonly clipScaleArrowVisuals = new WeakSet<object>();
  private readonly clipScaleOriginalVisuals = new WeakSet<object>();
  private readonly clipTranslationArrowNodes = new WeakSet<object>();
  private readonly clipTranslationArrowVisuals = new WeakSet<object>();
  private readonly clipTranslationOriginalVisuals = new WeakSet<object>();
  private readonly clipHandleKinds = new WeakMap<object, "scale" | "translate" | "rotate">();
  private readonly clipFocusHandleOpacity = new Map<PotreeTransformObject, (opacity: number) => void>();
  private clipRotationVisible = false;
  private clipPreviousTask: number | null = null;
  private clipPreviousMethod: number | null = null;
  private interactionLodTimer: number | null = null;
  private interactionLodActive = false;
  private hoverCoordinateElement: HTMLDivElement | null = null;
  private hoverPointer: { x: number; y: number } | null = null;
  private hoverFrame: number | null = null;
  private hoverEventTarget: HTMLElement | null = null;
  private correctionMarkerElement: HTMLDivElement | null = null;
  private correctionMarkerPoint: [number, number, number] | null = null;
  private viewLock: SpaceViewLock = "none";
  private controlsUpdateWrapped = false;
  private navigationControls: NonNullable<PotreeViewerInstance["controls"]> | null = null;
  private navigationElement: HTMLElement | null = null;
  private navigationMouseButton: number | null = null;

  mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const version = ++this.mountVersion;
    this.mountPromise = this.mountViewer(host, version);
    return this.mountPromise;
  }

  private async mountViewer(host: HTMLElement, version: number): Promise<void> {
    const [potree, three] = await Promise.all([loadPotreeRuntime(), loadPotreeThreeRuntime()]);
    if (this.host !== host || version !== this.mountVersion) return;

    const renderArea = document.createElement("div");
    renderArea.className = "potree_render_area";
    Object.assign(renderArea.style, { position: "absolute", inset: "0", overflow: "hidden" });
    host.replaceChildren(renderArea);

    const viewer = new potree.Viewer(renderArea);
    viewer.setEDLEnabled(false);
    viewer.setFOV(60);
    viewer.setBackground("black");

    this.potree = potree;
    this.three = three;
    this.viewer = viewer;
    this.createHoverCoordinateOverlay(renderArea);
    this.createCoordinateCorrectionMarker(renderArea);
    this.applyRenderSettings();
    this.keyboardController = new PotreeFlyKeyboardController(
      viewer,
      renderArea,
    );
    this.keyboardController.start();
    this.keyboardController.setActive(this.active);
    this.depthZoomController = new PotreeDepthZoomController(
      viewer,
      potree,
      renderArea,
    );
    this.depthZoomController.start();
    this.depthZoomController.setActive(this.active);
    this.drawingRenderer = new PotreeDrawingRenderer(viewer, potree, three, renderArea, this.interactions);
    this.drawingRenderer.setActive(this.active);
    this.chargingAreaEditor = new PotreeChargingAreaEditor(viewer, potree, three, renderArea, this.interactions);
    this.chargingAreaEditor.setActive(this.active);
    this.cabinetEditor = new PotreeCabinetEditor(viewer, potree, three, renderArea, this.interactions);
    this.cabinetEditor.setActive(this.active);
    this.deviceAreaEditor = new PotreeDeviceAreaEditor(viewer, potree, three, renderArea, this.interactions);
    this.deviceAreaEditor.setActive(this.active);
    this.pathEditor = new PotreePathEditor(viewer, potree, three, renderArea, this.interactions);
    this.pathEditor.setPageActive(this.active);
    // Keep path selection available outside placement mode; dragging and
    // destructive edits are gated by path drawing mode.
    this.pathEditor.setEnabled(true);
    this.normalAnnotationEditor = new PotreeNormalAnnotationEditor(viewer, potree, three, renderArea, this.interactions);
    this.normalAnnotationEditor.setActive(this.active);
    this.inspectionPointEditor = new PotreeInspectionPointEditor(
      viewer,
      potree,
      three,
      renderArea,
      this.interactions,
      (mouse) => this.normalAnnotationEditor?.pickSurfaceNormal(mouse) ?? null,
    );
    this.inspectionPointEditor.setDefaultComponentType(this.inspectionPointDefaultComponentType);
    this.inspectionPointEditor.setNamesVisible(this.inspectionPointNamesVisible);
    this.inspectionPointEditor.setCallbacks(this.inspectionPointCallbacks);
    this.inspectionPointEditor.setActive(this.active);
    this.rotationPivotIndicator = new PotreeRotationPivotIndicator(viewer, potree, three, renderArea, this.interactions);
    this.rotationPivotIndicator.start();
    this.rotationPivotIndicator.setActive(this.active);
    this.wrapControlsForViewLock();
    this.bindNavigationPerformanceControls();
    this.applyViewLockControllers();
    if (this.viewLock === "top") this.snapViewToTop();
    this.resize();
    this.syncActiveState();
  }

  setActive(active: boolean): void {
    this.active = active;
    // Potree keeps the point budget as module-level state.  Another cached
    // viewer (for example the survey page) can therefore overwrite it while
    // this scene is hidden.  Re-apply the scene's settings whenever it becomes
    // active so returning to the page does not require toggling the settings UI
    // to restore the configured detail/budget.
    if (active) this.applyRenderSettings();
    this.syncActiveState();
  }

  setInteractionMode(mode: SpaceInteractionMode): void {
    this.interactions.setMode(mode);
    if (mode !== "idle") this.resetInteractionLod();
  }

  pickPointAt(clientX: number, clientY: number): [number, number, number] | null {
    const viewer = this.viewer;
    const potree = this.potree;
    if (!this.active || !viewer || !potree || !this.pointcloud) return null;
    const bounds = viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const camera = viewer.scene.getActiveCamera?.();
    const pick = potree.Utils?.getMousePointCloudIntersection;
    if (!camera || !pick || viewer.scene.pointclouds.length === 0) return null;

    try {
      const result = pick(
        {
          x: Math.min(bounds.width, Math.max(0, clientX - bounds.left)),
          y: Math.min(bounds.height, Math.max(0, clientY - bounds.top)),
        },
        camera,
        viewer,
        viewer.scene.pointclouds,
        { pickClipped: true },
      );
      const point = result?.location;
      if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return null;
      return [point.x, point.y, point.z];
    } catch {
      return null;
    }
  }

  setCoordinateCorrectionMarker(point: [number, number, number] | null): void {
    this.correctionMarkerPoint = point ? [...point] as [number, number, number] : null;
    this.renderCoordinateCorrectionMarker();
  }

  getRenderSettings(): SpaceRenderSettings {
    return { ...this.renderSettings };
  }

  setRenderSettings(settings: SpaceRenderSettings): void {
    this.renderSettings = normalizeSpaceRenderSettings(settings);
    this.applyRenderSettings();
  }

  setDrawingLayer(layerId: string, data: SpaceDrawingLayer): void {
    this.drawingRenderer?.setLayer(layerId, data);
  }

  removeDrawingLayer(layerId: string): void {
    this.drawingRenderer?.removeLayer(layerId);
  }

  clearDrawingLayers(): void {
    this.drawingRenderer?.clear();
  }

  setDrawingInteractionCallbacks(callbacks: SpaceDrawingInteractionCallbacks | null): void {
    this.drawingRenderer?.setInteractionCallbacks(callbacks);
  }

  startChargingAreaDrawing(callbacks: SpaceChargingAreaCallbacks): boolean {
    const bounds = this.getModelWorldBounds();
    if (!this.chargingAreaEditor || !this.pointcloud || !bounds) return false;
    this.chargingAreaEditor.start(callbacks, bounds.minZ);
    return true;
  }

  setChargingAreaDrawingEnabled(enabled: boolean): void {
    this.chargingAreaEditor?.setEnabled(enabled);
  }

  setChargingAreaHeight(height: number): void {
    this.chargingAreaEditor?.setHeight(height);
  }

  getChargingAreaVerts(): number[][] | null {
    return this.chargingAreaEditor?.getBoxVerts() ?? null;
  }

  hasChargingAreaDraft(): boolean {
    return this.chargingAreaEditor?.hasBox() ?? false;
  }

  undoChargingArea(): void {
    this.chargingAreaEditor?.undo();
  }

  redoChargingArea(): void {
    this.chargingAreaEditor?.redo();
  }

  clearChargingAreaDrawing(): void {
    this.chargingAreaEditor?.clear();
  }

  startDeviceAreaDrawing(callbacks: SpaceDeviceAreaCallbacks): boolean {
    const bounds = this.getModelWorldBounds();
    if (!this.deviceAreaEditor || !this.pointcloud || !bounds) return false;
    this.deviceAreaEditor.start(callbacks, bounds.minZ);
    return true;
  }

  setDeviceAreaDrawingEnabled(enabled: boolean): void {
    this.deviceAreaEditor?.setEnabled(enabled);
  }

  setDeviceAreaHeight(height: number): void {
    this.deviceAreaEditor?.setHeight(height);
  }

  getDeviceAreaBoxes(): SpaceDeviceAreaBox[] {
    return this.deviceAreaEditor?.getBoxes() ?? [];
  }

  loadDeviceAreaBoxes(boxes: SpaceDeviceAreaBox[]): void {
    this.deviceAreaEditor?.loadBoxes(boxes);
  }

  hasDeviceAreaDraft(): boolean {
    return this.deviceAreaEditor?.hasDraft() ?? false;
  }

  bindSelectedDeviceAreaBay(bay: { id: number; name: string; code: string }): void {
    this.deviceAreaEditor?.bindSelectedBay(bay);
  }

  unbindSelectedDeviceAreaBay(): void {
    this.deviceAreaEditor?.unbindSelectedBay();
  }

  undoDeviceArea(): void {
    this.deviceAreaEditor?.undo();
  }

  redoDeviceArea(): void {
    this.deviceAreaEditor?.redo();
  }

  clearDeviceAreaDrawing(): void {
    this.deviceAreaEditor?.clear();
  }

  startCabinetDrawing(callbacks: SpaceCabinetCallbacks): boolean {
    if (!this.cabinetEditor || !this.pointcloud) return false;
    this.cabinetEditor.start(callbacks);
    return true;
  }

  setCabinetDrawingEnabled(enabled: boolean): void {
    this.cabinetEditor?.setEnabled(enabled);
  }

  setCabinetNames(names: string[]): void {
    this.cabinetEditor?.setCabinetNames(names);
  }

  getCabinetGeometry(): { verts: number[][]; splits: number[] } | null {
    return this.cabinetEditor?.getGeometry() ?? null;
  }

  hasCabinetDraft(): boolean {
    return this.cabinetEditor?.hasDraft() ?? false;
  }

  undoCabinet(): void {
    this.cabinetEditor?.undo();
  }

  redoCabinet(): void {
    this.cabinetEditor?.redo();
  }

  clearCabinetDrawing(): void {
    this.cabinetEditor?.clear();
  }

  startPathDrawing(callbacks: SpacePathCallbacks): boolean {
    if (!this.pathEditor || !this.pointcloud) return false;
    this.pathEditor.start(callbacks);
    this.pathEditor.setEnabled(true);
    this.pathEditor.setActive(true);
    return true;
  }

  setPathDrawingEnabled(enabled: boolean): void {
    this.pathEditor?.setEnabled(enabled);
  }

  setPathDrawingActive(active: boolean): void {
    this.pathEditor?.setActive(active);
  }

  setEditablePathData(data: PathData | null): void {
    this.pathEditor?.setData(data);
  }

  getPathData(): PathData | null {
    return this.pathEditor?.getData() ?? null;
  }

  hasPathDraft(): boolean {
    return this.pathEditor?.hasDraft() ?? false;
  }

  clearPathDrawing(): void {
    this.pathEditor?.setActive(false);
    this.pathEditor?.clear();
  }

  startNormalAnnotationEditing(callbacks: SpaceNormalAnnotationCallbacks): boolean {
    if (!this.normalAnnotationEditor || !this.pointcloud) return false;
    this.normalAnnotationEditor.start(callbacks);
    this.normalAnnotationEditor.setEnabled(true);
    return true;
  }

  setNormalAnnotationEnabled(enabled: boolean): void {
    this.normalAnnotationEditor?.setEnabled(enabled);
  }

  setNormalAnnotations(items: SpaceNormalAnnotation[]): void {
    this.normalAnnotationEditor?.setData(items);
  }

  getNormalAnnotations(): SpaceNormalAnnotation[] {
    return this.normalAnnotationEditor?.getData() ?? [];
  }

  selectNormalAnnotation(id: string | null): void {
    this.normalAnnotationEditor?.select(id);
  }

  renameNormalAnnotation(id: string, name: string): void {
    this.normalAnnotationEditor?.rename(id, name);
  }

  bindNormalAnnotationPoint(id: string, point: { pointCode: string; pointName?: string }): void {
    this.normalAnnotationEditor?.bindPoint(id, point);
  }

  unbindNormalAnnotationPoint(id: string): void {
    this.normalAnnotationEditor?.unbindPoint(id);
  }

  deleteNormalAnnotation(id: string): void {
    this.normalAnnotationEditor?.delete(id);
  }

  hasNormalAnnotationDraft(): boolean {
    return this.normalAnnotationEditor?.hasDraft() ?? false;
  }

  clearNormalAnnotations(): void {
    this.normalAnnotationEditor?.clear();
  }

  undoNormalAnnotation(): void {
    this.normalAnnotationEditor?.undo();
  }

  redoNormalAnnotation(): void {
    this.normalAnnotationEditor?.redo();
  }

  setInspectionPointCallbacks(callbacks: SpaceInspectionPointCallbacks | null): void {
    this.inspectionPointCallbacks = callbacks;
    this.inspectionPointEditor?.setCallbacks(callbacks);
  }

  startInspectionPointEditing(): boolean {
    if (!this.inspectionPointEditor || !this.pointcloud) return false;
    this.inspectionPointEditor.setEnabled(true);
    return true;
  }

  setInspectionPointEnabled(enabled: boolean): void { this.inspectionPointEditor?.setEnabled(enabled); }
  setInspectionPointDefaultComponentType(componentType: string | undefined): void {
    this.inspectionPointDefaultComponentType = componentType?.trim() || undefined;
    this.inspectionPointEditor?.setDefaultComponentType(componentType);
  }
  setInspectionPoints(items: SpaceInspectionPoint[]): void { this.inspectionPointEditor?.setData(items); }
  setVisibleInspectionPointIds(ids: string[]): void { this.inspectionPointEditor?.setVisibleIds(ids); }
  setInspectionPointNamesVisible(visible: boolean): void {
    this.inspectionPointNamesVisible = visible;
    this.inspectionPointEditor?.setNamesVisible(visible);
  }
  getInspectionPoints(): SpaceInspectionPoint[] { return this.inspectionPointEditor?.getData() ?? []; }
  selectInspectionPoint(id: string | null): void { this.inspectionPointEditor?.select(id); }
  renameInspectionPoint(id: string, name: string): void { this.inspectionPointEditor?.rename(id, name); }
  setInspectionPointComponentType(id: string, componentType: string | undefined): void {
    this.inspectionPointEditor?.setComponentType(id, componentType);
  }
  setInspectionPointLength(id: string, length: number): void { this.inspectionPointEditor?.setLength(id, length); }
  bindInspectionPointPoint(id: string, point: { pointCode: string; pointName?: string; bayCode?: string; bayName?: string }): void { this.inspectionPointEditor?.bindPoint(id, point); }
  unbindInspectionPointPoint(id: string): void { this.inspectionPointEditor?.unbindPoint(id); }
  deleteInspectionPoint(id: string): void { this.inspectionPointEditor?.delete(id); }
  markInspectionPointsSaved(): void { this.inspectionPointEditor?.markSaved(); }
  hasInspectionPointDraft(): boolean { return this.inspectionPointEditor?.hasDraft() ?? false; }
  clearInspectionPoints(): void { this.inspectionPointEditor?.clear(); }
  undoInspectionPoint(): void { this.inspectionPointEditor?.undo(); }
  redoInspectionPoint(): void { this.inspectionPointEditor?.redo(); }

  restoreDrawingHistorySnapshot(scope: SpaceDrawingHistoryScope, snapshot: SpaceDrawingHistorySnapshot): void {
    switch (scope) {
      case "cabinet":
        this.cabinetEditor?.restoreSnapshot(snapshot);
        break;
      case "charging":
        this.chargingAreaEditor?.restoreSnapshot(snapshot);
        break;
      case "device-area":
        this.deviceAreaEditor?.restoreSnapshot(snapshot);
        break;
      case "path":
        this.pathEditor?.restoreSnapshot(snapshot);
        break;
      case "normal":
        this.normalAnnotationEditor?.restoreSnapshot(snapshot);
        break;
      case "inspection-point":
        this.inspectionPointEditor?.restoreSnapshot(snapshot);
        break;
    }
  }

  setViewDirection(direction: ViewDirection): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const angles = POTREE_VIEW_ANGLES[this.viewLock === "top" ? "上" : direction];
    viewer.scene.view.yaw = angles.yaw;
    viewer.scene.view.pitch = angles.pitch;
    this.fitModelToScreen();
  }

  setViewLock(lock: SpaceViewLock): void {
    this.viewLock = lock;
    this.wrapControlsForViewLock();
    this.applyViewLockControllers();
    if (lock === "top") {
      this.viewer?.controls?.stop?.();
      this.snapViewToTop();
      this.fitModelToScreen();
    }
  }

  focusAlongDirection(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number): void {
    const viewer = this.viewer;
    if (!viewer) return;
    if (this.viewLock === "top") {
      this.focusTopOn(cx, cy, cz, extent);
      return;
    }
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 1e-6) {
      this.focusTopOn(cx, cy, cz, extent);
      return;
    }

    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const baseDistance = Math.max(0.5, extent);
    // Place the camera beyond the arrow head and look back toward the line's
    // middle. A side offset keeps the line visible instead of viewing it
    // head-on along its own axis.
    const targetDistance = baseDistance * DIRECTION_LOCATE_TARGET_FACTOR;
    const cameraDistance = baseDistance * DIRECTION_LOCATE_CAMERA_FACTOR;
    const sideDistance = baseDistance * DIRECTION_LOCATE_SIDE_FACTOR;
    const referenceX = Math.abs(nz) < 0.9 ? 0 : 1;
    const referenceY = 0;
    const referenceZ = Math.abs(nz) < 0.9 ? 1 : 0;
    const sideX = ny * referenceZ - nz * referenceY;
    const sideY = nz * referenceX - nx * referenceZ;
    const sideZ = nx * referenceY - ny * referenceX;
    const sideLength = Math.hypot(sideX, sideY, sideZ);
    const sx = sideX / sideLength;
    const sy = sideY / sideLength;
    const sz = sideZ / sideLength;

    const lookX = cx + nx * targetDistance;
    const lookY = cy + ny * targetDistance;
    const lookZ = cz + nz * targetDistance;
    const cameraX = cx + nx * cameraDistance + sx * sideDistance;
    const cameraY = cy + ny * cameraDistance + sy * sideDistance;
    const cameraZ = cz + nz * cameraDistance + sz * sideDistance;
    // A direct camera jump exposes a new point-cloud region immediately. Use a
    // temporary coarse LOD until the new nodes have settled, otherwise the
    // full point budget is requested in one frame.
    this.beginInteractionLod();
    this.focusCamera(cameraX, cameraY, cameraZ, lookX, lookY, lookZ);
    this.scheduleInteractionLodRestoreAfter(FOCUS_INTERACTION_LOD_SETTLE_MS);
  }

  private focusTopOn(cx: number, cy: number, cz: number, extent: number): void {
    const distance = Math.max(0.5, extent * 1.5);
    this.focusCamera(cx, cy, cz + distance, cx, cy, cz);
  }

  private focusCamera(cameraX: number, cameraY: number, cameraZ: number, lookX: number, lookY: number, lookZ: number): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const view = viewer.scene.view;
    const offsetX = lookX - cameraX;
    const offsetY = lookY - cameraY;
    const offsetZ = lookZ - cameraZ;
    const distance = Math.max(0.5, Math.hypot(offsetX, offsetY, offsetZ));

    this.setVector(view.position, cameraX, cameraY, cameraZ);
    if (view.lookAt) {
      view.lookAt(lookX, lookY, lookZ);
    } else {
      const horizontal = Math.hypot(offsetX, offsetY);
      view.yaw = horizontal > 1e-6 ? Math.atan2(offsetY, offsetX) - Math.PI / 2 : 0;
      view.pitch = Math.atan2(offsetZ, horizontal);
      view.radius = distance;
    }
    viewer.controls?.stop?.();
  }

  private syncActiveState(): void {
    const active = this.active;
    this.keyboardController?.setActive(active);
    this.depthZoomController?.setActive(active);
    this.rotationPivotIndicator?.setActive(active && !!this.pointcloud);
    this.drawingRenderer?.setActive(active);
    this.chargingAreaEditor?.setActive(active);
    this.cabinetEditor?.setActive(active);
    this.deviceAreaEditor?.setActive(active);
    this.pathEditor?.setPageActive(active);
    this.normalAnnotationEditor?.setActive(active);
    this.inspectionPointEditor?.setActive(active);
    if (!active) {
      this.viewer?.controls?.stop?.();
      this.resetInteractionLod();
      this.clearHoverCoordinate();
    }
  }

  private createHoverCoordinateOverlay(target: HTMLElement): void {
    this.disposeHoverCoordinateOverlay();

    const element = document.createElement("div");
    element.setAttribute("aria-label", "鼠标悬浮点坐标");
    Object.assign(element.style, {
      position: "absolute",
      left: "14px",
      bottom: "14px",
      zIndex: "12",
      display: "none",
      maxWidth: "calc(100% - 28px)",
      padding: "6px 10px",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: "5px",
      background: "rgba(14, 16, 20, 0.82)",
      color: "#f2f4f7",
      fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
      fontSize: "12px",
      lineHeight: "18px",
      whiteSpace: "normal",
      overflowWrap: "anywhere",
      overflow: "hidden",
      pointerEvents: "none",
      userSelect: "none",
    });
    target.appendChild(element);
    target.addEventListener("mousemove", this.handleHoverMove);
    target.addEventListener("mouseleave", this.handleHoverLeave);
    this.hoverCoordinateElement = element;
    this.hoverEventTarget = target;
  }

  private readonly handleHoverMove = (event: MouseEvent): void => {
    if (!this.active || !this.viewer || !this.pointcloud) {
      this.clearHoverCoordinate();
      return;
    }

    // Picking forces a WebGL readback. Suppress it while the camera is being
    // dragged so pointer movement stays responsive, then resume on hover.
    if (event.buttons !== 0) {
      this.clearHoverCoordinate();
      return;
    }

    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      this.clearHoverCoordinate();
      return;
    }
    this.hoverPointer = {
      x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
    };
    // Point picking performs a WebGL readback; cap it at one lookup per frame.
    if (this.hoverFrame === null) this.hoverFrame = window.requestAnimationFrame(this.updateHoverCoordinate);
  };

  private readonly handleHoverLeave = (): void => {
    this.clearHoverCoordinate();
  };

  private readonly updateHoverCoordinate = (): void => {
    this.hoverFrame = null;
    const pointer = this.hoverPointer;
    const viewer = this.viewer;
    const potree = this.potree;
    const element = this.hoverCoordinateElement;
    if (!pointer || !viewer || !potree || !this.active || !this.pointcloud) {
      this.clearHoverCoordinate();
      return;
    }

    const camera = viewer.scene.getActiveCamera?.();
    const pick = potree.Utils?.getMousePointCloudIntersection;
    if (!camera || !pick || viewer.scene.pointclouds.length === 0) {
      this.clearHoverCoordinate();
      return;
    }

    try {
      const result = pick(pointer, camera, viewer, viewer.scene.pointclouds, { pickClipped: true });
      const point = result?.location;
      if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) {
        this.clearHoverCoordinate();
        return;
      }
      if (element) {
        element.textContent = `坐标  X: ${formatHoverCoordinate(point.x)}  Y: ${formatHoverCoordinate(point.y)}  Z: ${formatHoverCoordinate(point.z)}`;
        element.style.display = "block";
      }
    } catch {
      this.clearHoverCoordinate();
    }
  };

  private clearHoverCoordinate(): void {
    this.hoverPointer = null;
    if (this.hoverFrame !== null) {
      window.cancelAnimationFrame(this.hoverFrame);
      this.hoverFrame = null;
    }
    if (this.hoverCoordinateElement) this.hoverCoordinateElement.style.display = "none";
  }

  private disposeHoverCoordinateOverlay(): void {
    this.clearHoverCoordinate();
    if (this.hoverEventTarget) {
      this.hoverEventTarget.removeEventListener("mousemove", this.handleHoverMove);
      this.hoverEventTarget.removeEventListener("mouseleave", this.handleHoverLeave);
    }
    this.hoverCoordinateElement?.remove();
    this.hoverCoordinateElement = null;
    this.hoverEventTarget = null;
  }

  private createCoordinateCorrectionMarker(target: HTMLElement): void {
    this.disposeCoordinateCorrectionMarker();
    const element = document.createElement("div");
    element.setAttribute("aria-label", "坐标纠正原点");
    Object.assign(element.style, {
      position: "absolute",
      left: "0",
      top: "0",
      zIndex: "14",
      display: "none",
      width: "16px",
      height: "16px",
      border: "2px solid #fa8c16",
      borderRadius: "50%",
      background: "rgba(250, 140, 22, 0.22)",
      boxShadow: "0 0 0 2px rgba(0, 0, 0, 0.45)",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none",
    });
    target.appendChild(element);
    this.correctionMarkerElement = element;
    this.viewer?.addEventListener("render.pass.perspective_overlay", this.renderCoordinateCorrectionMarker);
  }

  private readonly renderCoordinateCorrectionMarker = (): void => {
    const element = this.correctionMarkerElement;
    const point = this.correctionMarkerPoint;
    const viewer = this.viewer;
    const three = this.three;
    const camera = viewer?.scene.getActiveCamera?.();
    if (!element || !point || !viewer || !three || !camera) {
      if (element) element.style.display = "none";
      return;
    }
    const projected = new three.Vector3(...point).project(camera);
    const bounds = viewer.renderer.domElement.getBoundingClientRect();
    if (![projected.x, projected.y, projected.z, bounds.width, bounds.height].every(Number.isFinite)
      || projected.z < -1 || projected.z > 1 || bounds.width <= 0 || bounds.height <= 0) {
      element.style.display = "none";
      return;
    }
    element.style.left = `${(projected.x + 1) * 0.5 * bounds.width}px`;
    element.style.top = `${(1 - projected.y) * 0.5 * bounds.height}px`;
    element.style.display = "block";
  };

  private disposeCoordinateCorrectionMarker(): void {
    this.viewer?.removeEventListener("render.pass.perspective_overlay", this.renderCoordinateCorrectionMarker);
    this.correctionMarkerPoint = null;
    this.correctionMarkerElement?.remove();
    this.correctionMarkerElement = null;
  }

  private getModelWorldBounds(): SpaceClipBounds | null {
    if (this.modelClipBounds) return { ...this.modelClipBounds };
    const pointcloud = this.pointcloud;
    const localBounds = pointcloud?.pcoGeometry?.tightBoundingBox
      ?? pointcloud?.pcoGeometry?.boundingBox;
    if (!localBounds) return null;
    const offset = pointcloud.position || { x: 0, y: 0, z: 0 };
    return {
      minX: offset.x + localBounds.min.x,
      maxX: offset.x + localBounds.max.x,
      minY: offset.y + localBounds.min.y,
      maxY: offset.y + localBounds.max.y,
      minZ: offset.z + localBounds.min.z,
      maxZ: offset.z + localBounds.max.z,
    };
  }

  private fitModelToScreen(): void {
    const viewer = this.viewer;
    const bounds = this.getModelWorldBounds();
    if (!viewer || !bounds) {
      viewer?.fitToScreen();
      return;
    }

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const halfX = Math.abs(bounds.maxX - bounds.minX) / 2;
    const halfY = Math.abs(bounds.maxY - bounds.minY) / 2;
    const halfZ = Math.abs(bounds.maxZ - bounds.minZ) / 2;
    const radius = Math.hypot(halfX, halfY, halfZ);
    const view = viewer.scene.view;
    const direction = view.direction;
    const directionLength = Math.hypot(direction.x, direction.y, direction.z);
    if (![centerX, centerY, centerZ, radius, directionLength].every(Number.isFinite)
      || radius <= 0 || directionLength <= 0) {
      viewer.fitToScreen();
      return;
    }

    const camera = viewer.scene.getActiveCamera?.();
    const verticalFov = Math.min(179, Math.max(1, camera?.fov ?? 60)) * Math.PI / 180;
    const aspect = Math.max(0.01, camera?.aspect ?? 1);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = Math.max(
      MIN_FIT_DISTANCE,
      radius * FIT_PADDING / Math.sin(limitingFov / 2),
    );
    const directionX = direction.x / directionLength;
    const directionY = direction.y / directionLength;
    const directionZ = direction.z / directionLength;

    this.setVector(
      view.position,
      centerX - directionX * distance,
      centerY - directionY * distance,
      centerZ - directionZ * distance,
    );
    view.radius = distance;
    viewer.controls?.stop?.();
  }

  private getVolumeBox(): SpaceClipBox | null {
    const volume = this.clipVolume;
    if (!volume) return null;
    return {
      centerX: volume.position.x,
      centerY: volume.position.y,
      centerZ: volume.position.z,
      sizeX: Math.abs(volume.scale.x),
      sizeY: Math.abs(volume.scale.y),
      sizeZ: Math.abs(volume.scale.z),
      rotationX: volume.rotation.x,
      rotationY: volume.rotation.y,
      rotationZ: volume.rotation.z,
    };
  }

  private clipBoxFromBounds(bounds: SpaceClipBounds): SpaceClipBox {
    return {
      centerX: (bounds.minX + bounds.maxX) / 2,
      centerY: (bounds.minY + bounds.maxY) / 2,
      centerZ: (bounds.minZ + bounds.maxZ) / 2,
      sizeX: Math.max(bounds.maxX - bounds.minX, 1e-6),
      sizeY: Math.max(bounds.maxY - bounds.minY, 1e-6),
      sizeZ: Math.max(bounds.maxZ - bounds.minZ, 1e-6),
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };
  }

  private setVector(vector: { x: number; y: number; z: number; set?: (x: number, y: number, z: number) => void }, x: number, y: number, z: number): void {
    if (vector.set) vector.set(x, y, z);
    else {
      vector.x = x;
      vector.y = y;
      vector.z = z;
    }
  }

  startClipping(onBoxChange: (box: SpaceClipBox) => void, initialBox?: SpaceClipBox | null): SpaceClipBox | null {
    const viewer = this.viewer;
    const potree = this.potree;
    const modelBounds = this.getModelWorldBounds();
    if (!viewer || !potree || !modelBounds) return null;

    this.chargingAreaEditor?.setEnabled(false);
    this.cabinetEditor?.setEnabled(false);
    this.deviceAreaEditor?.setEnabled(false);

    const box = initialBox ?? this.getVolumeBox() ?? this.clipBoxFromBounds(modelBounds);
    if (!this.clipVolume) {
      const volume = new potree.BoxVolume();
      volume.clip = true;
      volume.frame?.material?.color?.setHex(0xffff00);
      if (volume.frame?.material) {
        volume.frame.material.depthTest = false;
        volume.frame.material.depthWrite = false;
      }
      this.clipPreviousTask = viewer.clipTask ?? potree.ClipTask.NONE;
      this.clipPreviousMethod = viewer.clipMethod ?? potree.ClipMethod.INSIDE_ANY;
      this.clipVolume = volume;
      this.applyVolumeBox(volume, box);
      viewer.scene.addVolume(volume);
      viewer.setClipMethod(potree.ClipMethod.INSIDE_ALL);
      viewer.setClipTask(potree.ClipTask.SHOW_INSIDE);
    } else {
      this.applyVolumeBox(this.clipVolume, box);
    }

    this.enterClipEditMode(onBoxChange);
    return this.getVolumeBox() ?? box;
  }

  setClipBox(box: SpaceClipBox): void {
    const volume = this.clipVolume;
    if (!volume) return;
    this.applyVolumeBox(volume, box);
    this.clipBoxListener?.(box);
  }

  setClipRotationVisible(visible: boolean): void {
    this.clipRotationVisible = visible;
    this.styleClipTransformationHandles();
    this.keepClipTransformationHandlesVisible();
  }

  commitClipping(): SpaceClipBox | null {
    const box = this.getVolumeBox();
    if (!this.clipVolume || !box) return null;
    this.leaveClipEditMode();
    this.setClipVolumeVisible(false);
    return box;
  }

  stopClipping(): void {
    this.leaveClipEditMode();
    const viewer = this.viewer;
    const volume = this.clipVolume;
    if (viewer && volume) {
      viewer.inputHandler?.deselect(volume);
      viewer.scene.removeVolume(volume);
      viewer.setClipTask(this.clipPreviousTask ?? viewer.clipTask ?? 0);
      viewer.setClipMethod(this.clipPreviousMethod ?? viewer.clipMethod ?? 0);
    }
    this.clipVolume = null;
    this.clipPreviousTask = null;
    this.clipPreviousMethod = null;
  }

  private applyVolumeBox(
    volume: NonNullable<PotreeViewerInstance["scene"]["volumes"]>[number],
    box: SpaceClipBox,
  ): void {
    this.setVector(
      volume.position,
      box.centerX,
      box.centerY,
      box.centerZ,
    );
    this.setVector(
      volume.scale,
      Math.max(box.sizeX, 1e-6),
      Math.max(box.sizeY, 1e-6),
      Math.max(box.sizeZ, 1e-6),
    );
    volume.rotation.set(box.rotationX, box.rotationY, box.rotationZ);
    volume.update?.();
  }

  private setClipVolumeVisible(visible: boolean): void {
    const volume = this.clipVolume;
    if (!volume) return;
    volume.visible = visible;
    if (volume.frame) volume.frame.visible = visible;
  }

  private setClipHandleOpacity(node: PotreeTransformObject, opacity: number): void {
    const kind = this.clipHandleKinds.get(node);
    const visible = opacity > 0 && (kind !== "rotate" || this.clipRotationVisible);
    node.visible = visible;
    node.traverse?.((object) => {
      const name = object.name ?? "";
      const isBody = name.endsWith(".handle");
      const isOutline = name.endsWith(".outline");
      const isPickVolume = name.endsWith(".pick_volume");
      if (this.clipScaleOriginalVisuals.has(object) || this.clipTranslationOriginalVisuals.has(object)) {
        object.visible = visible;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.transparent = true;
          material.opacity = 0;
          material.depthTest = false;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
        return;
      }
      if (isBody || isOutline || isPickVolume) object.visible = visible;
      if (!isBody && !isOutline) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material) continue;
        material.opacity = CLIP_HANDLE_BODY_OPACITY;
      }
    });
  }

  private resizeClipHandlePart(object: PotreeTransformObject): void {
    if (this.styledClipHandleObjects.has(object)) return;
    const name = object.name ?? "";
    const scale = object.scale;
    if (!scale) return;

    const isBody = name.endsWith(".handle");
    const isOutline = name.endsWith(".outline");
    const isPickVolume = name.endsWith(".pick_volume");
    if (name.startsWith("translation.")) {
      if (isBody) {
        if (typeof scale.x === "number") scale.x *= CLIP_TRANSLATION_THICKNESS_SCALE;
        if (typeof scale.y === "number") scale.y *= CLIP_TRANSLATION_THICKNESS_SCALE;
        if (typeof scale.z === "number") scale.z *= CLIP_TRANSLATION_LENGTH_SCALE;
        object.position?.set(
          name.includes(".x") ? -CLIP_TRANSLATION_PICK_CENTER : 0,
          name.includes(".y") ? -CLIP_TRANSLATION_PICK_CENTER : 0,
          name.includes(".z") ? -CLIP_TRANSLATION_PICK_CENTER : 0,
        );
      } else if (isOutline) {
        if (typeof scale.x === "number") scale.x *= CLIP_TRANSLATION_OUTLINE_THICKNESS_SCALE;
        if (typeof scale.y === "number") scale.y *= CLIP_TRANSLATION_OUTLINE_THICKNESS_SCALE;
      }
    } else if (name.startsWith("rotation.") && isBody) {
      scale.multiplyScalar?.(CLIP_ROTATION_SIZE_SCALE);
    } else if (name.startsWith("scale.") && isPickVolume) {
      const axis = this.clipHandleAxis(name);
      const direction = name.includes("-") ? -1 : 1;
      scale.x = axis === "x" ? CLIP_SCALE_PICK_AXIS_SCALE : CLIP_SCALE_PICK_RADIAL_SCALE;
      scale.y = axis === "y" ? CLIP_SCALE_PICK_AXIS_SCALE : CLIP_SCALE_PICK_RADIAL_SCALE;
      scale.z = axis === "z" ? CLIP_SCALE_PICK_AXIS_SCALE : CLIP_SCALE_PICK_RADIAL_SCALE;
      object.position?.set(
        axis === "x" ? direction * CLIP_SCALE_PICK_AXIS_OFFSET : 0,
        axis === "y" ? direction * CLIP_SCALE_PICK_AXIS_OFFSET : 0,
        axis === "z" ? direction * CLIP_SCALE_PICK_AXIS_OFFSET : 0,
      );
    }
    this.styledClipHandleObjects.add(object);
  }

  private clipHandleAxisColor(name: string): number | null {
    if (name.includes(".x")) return CLIP_HANDLE_AXIS_COLORS.x;
    if (name.includes(".y")) return CLIP_HANDLE_AXIS_COLORS.y;
    if (name.includes(".z")) return CLIP_HANDLE_AXIS_COLORS.z;
    return null;
  }

  private clipHandleAxis(name: string): keyof typeof CLIP_HANDLE_AXIS_COLORS | null {
    if (name.includes(".x")) return "x";
    if (name.includes(".y")) return "y";
    if (name.includes(".z")) return "z";
    return null;
  }

  private createClipHandleMaterial(
    axis: keyof typeof CLIP_HANDLE_AXIS_COLORS,
    tone: "axis" | "ring" = "axis",
  ) {
    const three = this.three;
    if (!three) return null;
    return new three.MeshPhongMaterial({
      color: tone === "ring" ? CLIP_HANDLE_RING_COLOR : CLIP_HANDLE_AXIS_COLORS[axis],
      emissive: tone === "ring" ? CLIP_HANDLE_RING_EMISSIVE : CLIP_HANDLE_AXIS_EMISSIVE[axis],
      specular: tone === "ring" ? 0xd8d8ff : 0x202020,
      shininess: tone === "ring" ? CLIP_HANDLE_RING_SHININESS : CLIP_HANDLE_SHININESS,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
  }

  private lightClipTransformationScene(): void {
    const three = this.three;
    const scene = this.viewer?.transformationTool?.scene;
    if (!three || !scene || this.litClipHandleScenes.has(scene)) return;

    const ambientLight = new three.AmbientLight(0xffffff, CLIP_HANDLE_AMBIENT_LIGHT_INTENSITY);
    const keyLight = new three.DirectionalLight(0xffffff, CLIP_HANDLE_KEY_LIGHT_INTENSITY);
    const fillLight = new three.DirectionalLight(0xffffff, CLIP_HANDLE_FILL_LIGHT_INTENSITY);
    keyLight.position.set(-3, 4, 5);
    fillLight.position.set(4, -2, -3);
    scene.add(ambientLight, keyLight, fillLight);
    if (keyLight.target) scene.add(keyLight.target);
    if (fillLight.target) scene.add(fillLight.target);
    this.litClipHandleScenes.add(scene);
  }

  private applyClipHandleMaterial(object: PotreeTransformObject): void {
    if (this.litClipHandleObjects.has(object)) return;
    const axis = this.clipHandleAxis(object.name ?? "");
    const material = axis ? this.createClipHandleMaterial(axis) : null;
    if (!material) return;
    object.material = material;
    this.litClipHandleObjects.add(object);
  }

  private createClipTranslationMaterial() {
    const three = this.three;
    if (!three) return null;
    return new three.MeshPhongMaterial({
      color: CLIP_TRANSLATION_ARROW_COLOR,
      emissive: CLIP_TRANSLATION_ARROW_EMISSIVE,
      specular: 0x282000,
      shininess: 42,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
  }

  private createClipTranslationArrow(handleName: string, node: PotreeTransformObject): void {
    const three = this.three;
    if (!three || !node.add || this.clipTranslationArrowNodes.has(node)) return;
    const axis = handleName.includes(".x") ? "x" : handleName.includes(".y") ? "y" : "z";
    const target = {
      x: axis === "x" ? -1 : 0,
      y: axis === "y" ? -1 : 0,
      z: axis === "z" ? -1 : 0,
    };
    const material = this.createClipTranslationMaterial();
    if (!material) return;
    const group = new three.Group();
    group.name = `${handleName}.clip_translation`;
    if (axis === "y") group.up.set(1, 0, 0);
    group.lookAt(target.x, target.y, target.z);

    const shaftGeometry = new three.CylinderGeometry(
      CLIP_TRANSLATION_ARROW_SHAFT_RADIUS,
      CLIP_TRANSLATION_ARROW_SHAFT_RADIUS,
      CLIP_TRANSLATION_ARROW_SHAFT_LENGTH,
      20,
      1,
      false,
    );
    shaftGeometry.rotateX(Math.PI / 2);
    const shaft = new three.Mesh(shaftGeometry, material);
    shaft.name = `${handleName}.clip_translation_shaft.handle`;
    shaft.position.set(0, 0, CLIP_TRANSLATION_ARROW_SHAFT_LENGTH / 2);
    shaft.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER + 2;

    const headGeometry = new three.ConeGeometry(
      CLIP_TRANSLATION_ARROW_HEAD_RADIUS,
      CLIP_TRANSLATION_ARROW_HEAD_LENGTH,
      24,
      1,
      false,
    );
    headGeometry.rotateX(Math.PI / 2);
    const head = new three.Mesh(headGeometry, material);
    head.name = `${handleName}.clip_translation_head.handle`;
    head.position.set(
      0,
      0,
      CLIP_TRANSLATION_ARROW_SHAFT_LENGTH + CLIP_TRANSLATION_ARROW_HEAD_LENGTH / 2,
    );
    head.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER + 2;

    group.add(shaft, head);
    const visuals = [shaft, head];
    if (axis === "x") {
      const centerGeometry = new three.SphereGeometry(CLIP_TRANSLATION_ARROW_CENTER_RADIUS, 24, 16);
      const center = new three.Mesh(centerGeometry, material);
      center.name = `${handleName}.clip_translation_center.handle`;
      center.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER + 3;
      group.add(center);
      visuals.push(center);
    }
    node.add(group as unknown as PotreeTransformObject);
    for (const visual of visuals) {
      this.clipTranslationArrowVisuals.add(visual as unknown as object);
      this.litClipHandleObjects.add(visual as unknown as object);
    }
    this.clipTranslationArrowNodes.add(node);
  }

  private createClipScaleArrow(handleName: string, node: PotreeTransformObject): void {
    const three = this.three;
    if (!three || !node.add || this.clipScaleArrowNodes.has(node)) return;
    const axis = handleName.includes(".x") ? "x" : handleName.includes(".y") ? "y" : "z";
    const direction = handleName.endsWith("-") ? -1 : 1;
    const target = {
      x: axis === "x" ? direction : 0,
      y: axis === "y" ? direction : 0,
      z: axis === "z" ? direction : 0,
    };
    const material = this.createClipHandleMaterial(axis);
    if (!material) return;
    const group = new three.Group();
    group.name = `${handleName}.clip_arrow`;
    if (axis === "y") group.up.set(1, 0, 0);
    group.lookAt(target.x, target.y, target.z);

    const shaftGeometry = new three.CylinderGeometry(
      CLIP_SCALE_ARROW_SHAFT_RADIUS,
      CLIP_SCALE_ARROW_SHAFT_RADIUS,
      CLIP_SCALE_ARROW_SHAFT_LENGTH,
      24,
      1,
      false,
    );
    shaftGeometry.rotateX(Math.PI / 2);
    const shaft = new three.Mesh(shaftGeometry, material);
    shaft.name = `${handleName}.clip_arrow_shaft.handle`;
    shaft.position.set(
      0,
      0,
      (CLIP_SCALE_ARROW_SHAFT_FRONT_LENGTH - CLIP_SCALE_ARROW_SHAFT_BACK_LENGTH) / 2,
    );
    shaft.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER;

    const headGeometry = new three.ConeGeometry(
      CLIP_SCALE_ARROW_HEAD_RADIUS,
      CLIP_SCALE_ARROW_HEAD_LENGTH,
      32,
      1,
      false,
    );
    headGeometry.rotateX(Math.PI / 2);
    const head = new three.Mesh(headGeometry, this.createClipHandleMaterial(axis) ?? material);
    head.name = `${handleName}.clip_arrow_head.handle`;
    head.position.set(0, 0, CLIP_SCALE_ARROW_SHAFT_FRONT_LENGTH + CLIP_SCALE_ARROW_HEAD_LENGTH / 2);
    head.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER;

    const ringGeometry = new three.TorusGeometry(
      CLIP_SCALE_ARROW_RING_RADIUS,
      CLIP_SCALE_ARROW_RING_TUBE,
      16,
      48,
    );
    const ring = new three.Mesh(ringGeometry, this.createClipHandleMaterial(axis, "ring") ?? material);
    ring.name = `${handleName}.clip_arrow_ring.outline`;
    ring.position.set(0, 0, 0);
    ring.renderOrder = CLIP_HANDLE_BODY_RENDER_ORDER + 1;

    group.add(shaft, head, ring);
    node.add(group as unknown as PotreeTransformObject);
    this.clipScaleArrowVisuals.add(shaft as unknown as object);
    this.clipScaleArrowVisuals.add(head as unknown as object);
    this.clipScaleArrowVisuals.add(ring as unknown as object);
    this.litClipHandleObjects.add(shaft as unknown as object);
    this.litClipHandleObjects.add(head as unknown as object);
    this.litClipHandleObjects.add(ring as unknown as object);
    this.clipScaleArrowNodes.add(node);
  }

  private styleClipTransformationHandles(): void {
    const tool = this.viewer?.transformationTool;
    if (!tool) return;
    this.lightClipTransformationScene();
    Object.values(tool.focusHandles ?? {}).forEach((handle) => {
      const node = handle.node;
      if (!node) return;
      if (node.setOpacity && !this.clipFocusHandleOpacity.has(node)) {
        this.clipFocusHandleOpacity.set(node, node.setOpacity.bind(node));
        node.setOpacity = () => {
          node.visible = false;
          node.traverse?.((object) => { object.visible = false; });
        };
      }
      node.setOpacity?.(0);
      node.visible = false;
      node.traverse?.((object) => { object.visible = false; });
    });
    const handles: Array<{ handle: { node?: PotreeTransformObject }; kind: "scale" | "translate" | "rotate"; name: string }> = [
      ...Object.entries(tool.scaleHandles ?? {}).map(([name, handle]) => ({ handle, kind: "scale" as const, name })),
      ...Object.entries(tool.translationHandles ?? {}).map(([name, handle]) => ({ handle, kind: "translate" as const, name })),
      ...Object.entries(tool.rotationHandles ?? {}).map(([name, handle]) => ({ handle, kind: "rotate" as const, name })),
    ];

    for (const { handle, kind, name: handleName } of handles) {
      const node = handle.node;
      if (!node) continue;
      this.clipHandleKinds.set(node, kind);
      if (kind === "scale") this.createClipScaleArrow(handleName, node);
      if (kind === "translate") {
        this.createClipTranslationArrow(handleName, node);
        node.position?.set(
          CLIP_TRANSLATION_HANDLE_CORNER,
          CLIP_TRANSLATION_HANDLE_CORNER,
          CLIP_TRANSLATION_HANDLE_CORNER,
        );
      }
      node.visible = kind !== "rotate" || this.clipRotationVisible;
      if (node.setOpacity && !this.styledClipHandleNodes.has(node)) {
        node.setOpacity = (opacity) => this.setClipHandleOpacity(node, opacity);
        this.styledClipHandleNodes.add(node);
      }
      node.traverse?.((object: PotreeTransformObject) => {
        const name = object.name ?? "";
        const isBody = name.endsWith(".handle");
        const isOutline = name.endsWith(".outline");
        const isPickVolume = name.endsWith(".pick_volume");
        const isClipArrowRing = name.includes(".clip_arrow_ring.");
        const isClipTranslationVisual = this.clipTranslationArrowVisuals.has(object);
        if (kind === "scale" && isPickVolume) {
          this.resizeClipHandlePart(object);
          return;
        }
        if (!isBody && !isOutline) return;
        if (kind === "scale" && !this.clipScaleArrowVisuals.has(object)) {
          this.clipScaleOriginalVisuals.add(object);
          object.visible = true;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material) continue;
            material.transparent = true;
            material.opacity = 0;
            material.depthTest = false;
            material.depthWrite = false;
            material.needsUpdate = true;
          }
          return;
        }
        if (kind === "translate" && !isClipTranslationVisual && (isBody || isOutline)) {
          this.clipTranslationOriginalVisuals.add(object);
          object.visible = true;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!material) continue;
            material.transparent = true;
            material.opacity = 0;
            material.depthTest = false;
            material.depthWrite = false;
            material.needsUpdate = true;
          }
          this.resizeClipHandlePart(object);
          return;
        }
        object.renderOrder = isBody ? CLIP_HANDLE_BODY_RENDER_ORDER : CLIP_HANDLE_OUTLINE_RENDER_ORDER;
        this.applyClipHandleMaterial(object);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.depthTest = false;
          material.depthWrite = false;
          material.transparent = false;
          material.opacity = CLIP_HANDLE_BODY_OPACITY;
          const color = isClipArrowRing || isClipTranslationVisual ? null : this.clipHandleAxisColor(name);
          if (color !== null) material.color?.setHex(color);
          material.needsUpdate = true;
        }
        if (!isClipTranslationVisual) this.resizeClipHandlePart(object);
      });
      node.setOpacity?.(CLIP_HANDLE_IDLE_TARGET_OPACITY);
    }
  }

  private keepClipTransformationHandlesVisible(): void {
    const tool = this.viewer?.transformationTool;
    if (!tool) return;
    if (tool.scene) tool.scene.visible = true;

    const visibleHandles = [
      ...Object.values(tool.scaleHandles ?? {}),
      ...Object.values(tool.translationHandles ?? {}),
      ...(this.clipRotationVisible ? Object.values(tool.rotationHandles ?? {}) : []),
    ];
    for (const handle of visibleHandles) {
      const node = handle.node;
      if (!node) continue;
      node.setOpacity?.(CLIP_HANDLE_IDLE_TARGET_OPACITY);
    }
    if (!this.clipRotationVisible) {
      for (const handle of Object.values(tool.rotationHandles ?? {})) {
        handle.node?.setOpacity?.(0);
      }
    }
  }

  private enterClipEditMode(onBoxChange: (box: SpaceClipBox) => void): void {
    const viewer = this.viewer;
    const volume = this.clipVolume;
    if (!viewer || !volume) return;
    this.leaveClipEditMode();
    this.setClipVolumeVisible(true);
    volume.clip = true;
    this.clipBoxListener = onBoxChange;
    this.clipVolumeListener = () => {
      const next = this.getVolumeBox();
      if (next) this.clipBoxListener?.(next);
    };
    volume.addEventListener?.("position_changed", this.clipVolumeListener);
    volume.addEventListener?.("scale_changed", this.clipVolumeListener);
    volume.addEventListener?.("orientation_changed", this.clipVolumeListener);
    this.clipOverlayRenderer = () => {
      const tool = viewer.transformationTool;
      if (tool?.selection && !tool.selection.includes(volume)) {
        viewer.inputHandler?.deselectAll();
        viewer.inputHandler?.toggleSelection(volume);
      }
      this.keepClipTransformationHandlesVisible();
      const toolScene = tool?.scene;
      const camera = viewer.scene.getActiveCamera?.();
      if (toolScene && camera) viewer.renderer.render(toolScene, camera);
    };
    viewer.addEventListener("render.pass.perspective_overlay", this.clipOverlayRenderer);
    // Override Potree's tweened opacity handlers before selection changes can
    // schedule a fade back to the original dark 40% materials.
    this.styleClipTransformationHandles();
    viewer.inputHandler?.deselectAll();
    viewer.inputHandler?.toggleSelection(volume);
    this.styleClipTransformationHandles();
  }

  private leaveClipEditMode(): void {
    const viewer = this.viewer;
    const volume = this.clipVolume;
    if (viewer && this.clipOverlayRenderer) {
      viewer.removeEventListener("render.pass.perspective_overlay", this.clipOverlayRenderer);
    }
    if (viewer && volume) viewer.inputHandler?.deselect(volume);
    if (volume && this.clipVolumeListener) {
      volume.removeEventListener?.("position_changed", this.clipVolumeListener);
      volume.removeEventListener?.("scale_changed", this.clipVolumeListener);
      volume.removeEventListener?.("orientation_changed", this.clipVolumeListener);
    }
    for (const [node, setOpacity] of this.clipFocusHandleOpacity) {
      node.setOpacity = setOpacity;
      node.visible = true;
      setOpacity(0.4);
    }
    this.clipFocusHandleOpacity.clear();
    this.clipBoxListener = null;
    this.clipVolumeListener = null;
    this.clipOverlayRenderer = null;
  }

  private applyRenderSettings(): void {
    // Potree stores point budget at module scope, so applying settings from a
    // hidden cached viewer would affect whichever scene is currently visible.
    // Inactive scenes keep their settings in `renderSettings` and re-apply
    // them from setActive(true) when they become visible again.
    if (!this.viewer || !this.active) return;
    if (!this.interactionLodActive) {
      this.viewer.setMinNodeSize(this.baseMinNodeSize());
    }
    this.viewer.setPointBudget(this.configuredPointBudget());
    if (this.pointcloud) {
      const { material } = this.pointcloud;
      material.rgbGamma = this.renderSettings.gamma;
      material.rgbBrightness = this.renderSettings.brightness;
      material.rgbContrast = this.renderSettings.contrast;
      material.intensityGamma = this.renderSettings.gamma;
      material.intensityBrightness = this.renderSettings.brightness;
      material.intensityContrast = this.renderSettings.contrast;
    }
  }

  private configuredPointBudget(): number {
    // Use the model count once metadata is available. Before that, keep the
    // budget finite so Potree never receives an unbounded traversal request.
    return this.renderSettings.pointBudget === SPACE_POINT_BUDGET_ALL
      ? this.loadedPointCount ?? SPACE_POINT_BUDGET_MAX
      : this.renderSettings.pointBudget;
  }

  private baseMinNodeSize(): number {
    return MIN_NODE_SIZE_BY_DETAIL[this.renderSettings.detailLevel];
  }

  private readonly beginInteractionLod = (): void => {
    const viewer = this.viewer;
    if (!viewer) return;
    if (this.interactionLodTimer !== null) {
      window.clearTimeout(this.interactionLodTimer);
      this.interactionLodTimer = null;
    }
    if (!this.interactionLodActive) {
      this.interactionLodActive = true;
      viewer.setMinNodeSize(this.baseMinNodeSize() * INTERACTION_LOD_MULTIPLIER);
    }
    viewer.setPointBudget(Math.min(this.configuredPointBudget(), INTERACTION_POINT_BUDGET));
  };

  private scheduleInteractionLodRestoreAfter(delayMs: number): void {
    if (!this.viewer || !this.interactionLodActive) return;
    if (this.interactionLodTimer !== null) window.clearTimeout(this.interactionLodTimer);
    this.interactionLodTimer = window.setTimeout(() => {
      this.interactionLodTimer = null;
      this.interactionLodActive = false;
      this.applyRenderSettings();
    }, delayMs);
  };

  private resetInteractionLod(applySettings = this.active): void {
    if (this.interactionLodTimer !== null) {
      window.clearTimeout(this.interactionLodTimer);
      this.interactionLodTimer = null;
    }
    this.interactionLodActive = false;
    // Potree's point budget is global to the loaded runtime.  A cached,
    // inactive viewer must not overwrite the settings of the visible scene
    // while it is being deactivated or unloaded.
    if (applySettings) this.applyRenderSettings();
  }

  async loadModel(model: SpaceSceneModel): Promise<void> {
    await this.mountPromise;
    const viewer = this.viewer;
    const potree = this.potree;
    if (!viewer || !potree) throw new Error("三维场景尚未初始化");

    const version = ++this.loadVersion;
    let timeoutId = 0;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error("Potree 模型加载超时")), MODEL_LOAD_TIMEOUT_MS);
    });

    try {
      const loaded = await Promise.race([
        potree.loadPointCloud(model.metadataUrl, model.name),
        timeout,
      ]);
      if (version !== this.loadVersion || !this.viewer) {
        this.disposePointCloud(loaded.pointcloud);
        return;
      }

      this.clearModel();
      const pointcloud = loaded.pointcloud;
      pointcloud.material.size = 1.5;
      // Potree's adaptive mode writes one entry per visible node into a
      // fixed 2048-entry texture. Large models can exceed that limit even
      // when their point budget is valid, so use distance attenuation here.
      pointcloud.material.pointSizeType = potree.PointSizeType.ATTENUATED;
      if (pointcloud.getAttribute?.("rgba")) pointcloud.material.activeAttributeName = "rgba";
      viewer.scene.addPointCloud(pointcloud);
      this.pointcloud = pointcloud;
      this.modelClipBounds = model.clipBounds ? { ...model.clipBounds } : null;
      this.loadedPointCount = getPointCloudPointCount(pointcloud);
      this.applyRenderSettings();
      this.syncActiveState();

      this.fitTimer = window.setTimeout(() => {
        if (this.viewer && this.pointcloud === pointcloud) {
          if (this.viewLock === "top") this.snapViewToTop();
          this.fitModelToScreen();
        }
      }, 250);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  clearModel(): void {
    this.loadVersion += 1;
    this.clearHoverCoordinate();
    this.setCoordinateCorrectionMarker(null);
    this.stopClipping();
    this.modelClipBounds = null;
    this.loadedPointCount = null;
    this.resetInteractionLod();
    this.interactions.reset();
    this.chargingAreaEditor?.clear();
    this.cabinetEditor?.clear();
    this.deviceAreaEditor?.clear();
    this.pathEditor?.clear();
    this.normalAnnotationEditor?.setEnabled(false);
    this.normalAnnotationEditor?.clear();
    this.inspectionPointEditor?.setEnabled(false);
    this.inspectionPointEditor?.clear();
    this.clearDrawingLayers();
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    if (!this.pointcloud) return;
    this.disposePointCloud(this.pointcloud);
    this.pointcloud = null;
    this.syncActiveState();
  }

  private disposePointCloud(pointcloud: PotreePointCloud): void {
    pointcloud.visible = false;
    const scene = this.viewer?.scene;
    if (scene) {
      const index = scene.pointclouds.indexOf(pointcloud);
      if (index >= 0) scene.pointclouds.splice(index, 1);
      scene.scenePointCloud.remove(pointcloud);
    }
    disposeGeometryTree(pointcloud.pcoGeometry?.root, this.potree?.lru);
    pointcloud.material.dispose?.();
  }

  resize(): void {
    if (!this.host || !this.viewer) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.viewer.renderer.setSize(width, height);
    const camera = this.viewer.scene.getActiveCamera?.();
    if (camera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    const host = this.host;
    this.interactions.reset();
    this.mountVersion += 1;
    this.host = null;
    this.keyboardController?.dispose();
    this.keyboardController = null;
    this.depthZoomController?.dispose();
    this.depthZoomController = null;
    this.rotationPivotIndicator?.dispose();
    this.rotationPivotIndicator = null;
    this.drawingRenderer?.dispose();
    this.drawingRenderer = null;
    this.chargingAreaEditor?.dispose();
    this.chargingAreaEditor = null;
    this.cabinetEditor?.dispose();
    this.cabinetEditor = null;
    this.deviceAreaEditor?.dispose();
    this.deviceAreaEditor = null;
    this.pathEditor?.dispose();
    this.pathEditor = null;
    this.normalAnnotationEditor?.dispose();
    this.normalAnnotationEditor = null;
    this.inspectionPointEditor?.dispose();
    this.inspectionPointEditor = null;
    this.unbindNavigationPerformanceControls();
    this.disposeCoordinateCorrectionMarker();
    this.disposeHoverCoordinateOverlay();
    this.clearModel();
    if (this.viewer) {
      this.viewer.renderer.setAnimationLoop(null);
      this.viewer.renderer.dispose();
      this.viewer.renderer.forceContextLoss?.();
    }
    this.viewer = null;
    this.potree = null;
    this.three = null;
    this.mountPromise = null;
    this.controlsUpdateWrapped = false;
    host?.replaceChildren();
  }

  private wrapControlsForViewLock(): void {
    const controls = this.viewer?.controls;
    if (!controls?.update || this.controlsUpdateWrapped) return;
    const originalUpdate = controls.update.bind(controls);
    controls.update = (delta: number) => {
      this.prepareLockedView(controls);
      originalUpdate(delta);
      if (this.viewLock === "top") this.snapViewToTop();
    };
    this.controlsUpdateWrapped = true;
  }

  private readonly handleNavigationStart = (): void => {
    if (!this.active || !this.pointcloud) return;
    // Coarse LOD is only useful for actual camera navigation. Drawing,
    // selection, save/delete busy states and editor drags must retain the
    // configured density, otherwise a click can leave the cloud sparse.
    if (!this.interactions.isMode("idle")
      || this.interactions.hasAnyClaim("drawing-drag", "drawing-selection", "path-selection")) {
      this.resetInteractionLod();
      return;
    }
    // Keep mouse rotation and pan at the configured density. Left-drag can
    // reach Potree's fallback controls when the pointer is over empty space,
    // so it must follow the same LOD policy as point-backed pivot rotation.
    if (this.navigationMouseButton === 0 || this.navigationMouseButton === 2) {
      this.resetInteractionLod();
      return;
    }
    this.beginInteractionLod();
  };

  private readonly handleNavigationEnd = (): void => {
    this.scheduleInteractionLodRestoreAfter(NAVIGATION_INTERACTION_LOD_SETTLE_MS);
    this.navigationMouseButton = null;
  };

  private readonly handleNavigationMouseDown = (event: MouseEvent): void => {
    this.navigationMouseButton = event.button;
  };

  private readonly handleNavigationMouseUp = (event: MouseEvent): void => {
    if (event.button === this.navigationMouseButton) this.navigationMouseButton = null;
  };

  private bindNavigationPerformanceControls(): void {
    const controls = this.viewer?.controls;
    if (!controls || controls === this.navigationControls) return;
    this.unbindNavigationPerformanceControls();
    controls.addEventListener("start", this.handleNavigationStart);
    controls.addEventListener("end", this.handleNavigationEnd);
    const element = this.viewer?.renderer.domElement;
    element?.addEventListener("mousedown", this.handleNavigationMouseDown, true);
    element?.addEventListener("mouseup", this.handleNavigationMouseUp, true);
    this.navigationElement = element ?? null;
    this.navigationControls = controls;
  }

  private unbindNavigationPerformanceControls(): void {
    this.navigationControls?.removeEventListener("start", this.handleNavigationStart);
    this.navigationControls?.removeEventListener("end", this.handleNavigationEnd);
    this.navigationElement?.removeEventListener("mousedown", this.handleNavigationMouseDown, true);
    this.navigationElement?.removeEventListener("mouseup", this.handleNavigationMouseUp, true);
    this.navigationElement = null;
    this.navigationMouseButton = null;
    this.navigationControls = null;
  }

  private prepareLockedView(controls: NonNullable<PotreeViewerInstance["controls"]>): void {
    if (this.viewLock !== "top") return;
    const rotationSpeed = controls.rotationSpeed || 5;
    const panDelta = controls.panDelta;
    if (panDelta) {
      panDelta.x += (controls.yawDelta || 0) / rotationSpeed;
      panDelta.y += (controls.pitchDelta || 0) / rotationSpeed;
    }
    controls.yawDelta = 0;
    controls.pitchDelta = 0;
    this.snapViewToTop();
  }

  private applyViewLockControllers(): void {
    const locked = this.viewLock === "top";
    this.rotationPivotIndicator?.setRotationEnabled(!locked);
    this.keyboardController?.setPlanar(locked);
  }

  private snapViewToTop(): void {
    const view = this.viewer?.scene.view;
    if (!view) return;
    const angles = POTREE_VIEW_ANGLES.上;
    view.yaw = angles.yaw;
    view.pitch = angles.pitch;
  }
}
