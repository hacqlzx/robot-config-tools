import {
  loadPotreeRuntime,
  loadPotreeThreeRuntime,
  type PotreeNamespace,
  type PotreeGeometryNode,
  type PotreeNodeCache,
  type PotreePointCloud,
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
  type SpaceSceneAdapter,
  type SpaceSceneModel,
} from "./types";

const MODEL_LOAD_TIMEOUT_MS = 60_000;
const FIT_PADDING = 1.05;
const MIN_FIT_DISTANCE = 0.01;
const DIRECTION_LOCATE_TARGET_FACTOR = 0.35;
const DIRECTION_LOCATE_CAMERA_FACTOR = 1.15;
const DIRECTION_LOCATE_SIDE_FACTOR = 0.65;
const INTERACTION_LOD_MULTIPLIER = 2;
const FOCUS_INTERACTION_LOD_SETTLE_MS = 650;
const INTERACTION_POINT_BUDGET = 250_000;
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
  private mountPromise: Promise<void> | null = null;
  private fitTimer: number | null = null;
  private mountVersion = 0;
  private loadVersion = 0;
  private active = true;
  private loadedPointCount: number | null = null;
  private modelClipBounds: SpaceClipBounds | null = null;
  private renderSettings = { ...DEFAULT_SPACE_RENDER_SETTINGS };
  private clipVolume: NonNullable<PotreeViewerInstance["scene"]["volumes"]>[number] | null = null;
  private clipBoundsListener: ((bounds: SpaceClipBounds) => void) | null = null;
  private clipVolumeListener: ((event: unknown) => void) | null = null;
  private clipOverlayRenderer: ((event: unknown) => void) | null = null;
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
    this.rotationPivotIndicator = new PotreeRotationPivotIndicator(viewer, potree, three, renderArea, this.interactions);
    this.rotationPivotIndicator.start();
    this.rotationPivotIndicator.setActive(this.active);
    this.resize();
    this.syncActiveState();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.syncActiveState();
  }

  setInteractionMode(mode: SpaceInteractionMode): void {
    this.interactions.setMode(mode);
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
    this.stopClipping();
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
    this.stopClipping();
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
    this.stopClipping();
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
    this.stopClipping();
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
    this.stopClipping();
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
    }
  }

  setViewDirection(direction: ViewDirection): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const angles = POTREE_VIEW_ANGLES[direction];
    viewer.scene.view.yaw = angles.yaw;
    viewer.scene.view.pitch = angles.pitch;
    this.fitModelToScreen();
  }

  focusAlongDirection(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number): void {
    const viewer = this.viewer;
    if (!viewer) return;
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
    this.viewer.setPointBudget(Math.min(this.configuredPointBudget(), INTERACTION_POINT_BUDGET));
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

  private getVolumeBounds(): SpaceClipBounds | null {
    const volume = this.clipVolume;
    if (!volume) return null;
    return {
      minX: volume.position.x - Math.abs(volume.scale.x) / 2,
      maxX: volume.position.x + Math.abs(volume.scale.x) / 2,
      minY: volume.position.y - Math.abs(volume.scale.y) / 2,
      maxY: volume.position.y + Math.abs(volume.scale.y) / 2,
      minZ: volume.position.z - Math.abs(volume.scale.z) / 2,
      maxZ: volume.position.z + Math.abs(volume.scale.z) / 2,
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

  startClipping(onBoundsChange: (bounds: SpaceClipBounds) => void): SpaceClipBounds | null {
    const viewer = this.viewer;
    const potree = this.potree;
    const modelBounds = this.getModelWorldBounds();
    if (!viewer || !potree || !modelBounds) return null;

    this.stopClipping();
    this.chargingAreaEditor?.setEnabled(false);
    this.cabinetEditor?.setEnabled(false);
    this.deviceAreaEditor?.setEnabled(false);
    const volume = new potree.BoxVolume();
    const centerX = (modelBounds.minX + modelBounds.maxX) / 2;
    const centerY = (modelBounds.minY + modelBounds.maxY) / 2;
    const centerZ = (modelBounds.minZ + modelBounds.maxZ) / 2;
    this.setVector(volume.position, centerX, centerY, centerZ);
    this.setVector(
      volume.scale,
      Math.max(modelBounds.maxX - modelBounds.minX, 1e-6),
      Math.max(modelBounds.maxY - modelBounds.minY, 1e-6),
      Math.max(modelBounds.maxZ - modelBounds.minZ, 1e-6),
    );
    volume.rotation.set(0, 0, 0);
    volume.clip = true;
    volume.visible = true;
    volume.frame?.material?.color?.setHex(0x39d98a);
    if (volume.frame?.material) {
      volume.frame.material.depthTest = false;
      volume.frame.material.depthWrite = false;
    }

    this.clipPreviousTask = viewer.clipTask ?? potree.ClipTask.NONE;
    this.clipPreviousMethod = viewer.clipMethod ?? potree.ClipMethod.INSIDE_ANY;
    this.clipVolume = volume;
    this.clipBoundsListener = onBoundsChange;
    this.clipVolumeListener = () => {
      const bounds = this.getVolumeBounds();
      if (bounds) this.clipBoundsListener?.(bounds);
    };
    volume.addEventListener?.("position_changed", this.clipVolumeListener);
    volume.addEventListener?.("scale_changed", this.clipVolumeListener);
    volume.addEventListener?.("orientation_changed", () => volume.rotation.set(0, 0, 0));
    viewer.scene.addVolume(volume);
    viewer.setClipMethod(potree.ClipMethod.INSIDE_ALL);
    viewer.setClipTask(potree.ClipTask.SHOW_INSIDE);
    this.clipOverlayRenderer = () => {
      const toolScene = viewer.transformationTool?.scene;
      const camera = viewer.scene.getActiveCamera?.();
      if (toolScene && camera) viewer.renderer.render(toolScene, camera);
    };
    viewer.addEventListener("render.pass.perspective_overlay", this.clipOverlayRenderer);

    // Potree's scale handles provide the six-face editing behavior. Rotation
    // would produce an oriented box that cannot be represented by LAS bounds.
    const rotationHandles = viewer.transformationTool?.rotationHandles;
    if (rotationHandles) {
      Object.values(rotationHandles).forEach((handle) => {
        if (handle.node) handle.node.visible = false;
      });
    }
    viewer.inputHandler?.deselectAll();
    viewer.inputHandler?.toggleSelection(volume);
    return modelBounds;
  }

  setClipBounds(bounds: SpaceClipBounds): void {
    const volume = this.clipVolume;
    if (!volume) return;
    this.setVector(volume.position,
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minY + bounds.maxY) / 2,
      (bounds.minZ + bounds.maxZ) / 2);
    this.setVector(volume.scale,
      Math.max(bounds.maxX - bounds.minX, 1e-6),
      Math.max(bounds.maxY - bounds.minY, 1e-6),
      Math.max(bounds.maxZ - bounds.minZ, 1e-6));
    volume.rotation.set(0, 0, 0);
    volume.update?.();
    this.clipBoundsListener?.(bounds);
  }

  stopClipping(): void {
    const viewer = this.viewer;
    const volume = this.clipVolume;
    if (viewer && volume) {
      if (this.clipOverlayRenderer) {
        viewer.removeEventListener("render.pass.perspective_overlay", this.clipOverlayRenderer);
      }
      viewer.inputHandler?.deselect(volume);
      viewer.scene.removeVolume(volume);
      viewer.setClipTask(this.clipPreviousTask ?? viewer.clipTask ?? 0);
      viewer.setClipMethod(this.clipPreviousMethod ?? viewer.clipMethod ?? 0);
      const rotationHandles = viewer.transformationTool?.rotationHandles;
      if (rotationHandles) {
        Object.values(rotationHandles).forEach((handle) => {
          if (handle.node) handle.node.visible = true;
        });
      }
    }
    if (volume && this.clipVolumeListener) {
      volume.removeEventListener?.("position_changed", this.clipVolumeListener);
      volume.removeEventListener?.("scale_changed", this.clipVolumeListener);
    }
    this.clipVolume = null;
    this.clipBoundsListener = null;
    this.clipVolumeListener = null;
    this.clipOverlayRenderer = null;
    this.clipPreviousTask = null;
    this.clipPreviousMethod = null;
  }

  private applyRenderSettings(): void {
    if (!this.viewer) return;
    if (!this.interactionLodActive) {
      this.viewer.setMinNodeSize(this.baseMinNodeSize());
    }
    this.viewer.setPointBudget(this.configuredPointBudget());
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

  private resetInteractionLod(): void {
    if (this.interactionLodTimer !== null) {
      window.clearTimeout(this.interactionLodTimer);
      this.interactionLodTimer = null;
    }
    this.interactionLodActive = false;
    this.applyRenderSettings();
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
        if (this.viewer && this.pointcloud === pointcloud) this.fitModelToScreen();
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
    host?.replaceChildren();
  }
}
