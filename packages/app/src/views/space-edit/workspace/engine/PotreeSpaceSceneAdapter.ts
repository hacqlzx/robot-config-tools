import {
  loadPotreeRuntime,
  loadPotreeThreeRuntime,
  type PotreeNamespace,
  type PotreeGeometryNode,
  type PotreeNodeCache,
  type PotreePointCloud,
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
import { PotreeRotationPivotIndicator } from "./PotreeRotationPivotIndicator";
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
  type SpaceDrawingInteractionCallbacks,
  type SpacePathCallbacks,
  type SpaceSceneAdapter,
  type SpaceSceneModel,
} from "./types";

const MODEL_LOAD_TIMEOUT_MS = 60_000;
const FIT_PADDING = 1.05;
const MIN_FIT_DISTANCE = 0.01;
const INTERACTION_LOD_MULTIPLIER = 2;
const INTERACTION_LOD_SETTLE_MS = 180;
const MIN_NODE_SIZE_BY_DETAIL: Record<SpaceRenderDetailLevel, number> = {
  1: 80,
  2: 30,
  3: 15,
  4: 8,
};

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
  private host: HTMLElement | null = null;
  private viewer: PotreeViewerInstance | null = null;
  private potree: PotreeNamespace | null = null;
  private pointcloud: PotreePointCloud | null = null;
  private keyboardController: PotreeFlyKeyboardController | null = null;
  private depthZoomController: PotreeDepthZoomController | null = null;
  private rotationPivotIndicator: PotreeRotationPivotIndicator | null = null;
  private drawingRenderer: PotreeDrawingRenderer | null = null;
  private chargingAreaEditor: PotreeChargingAreaEditor | null = null;
  private cabinetEditor: PotreeCabinetEditor | null = null;
  private deviceAreaEditor: PotreeDeviceAreaEditor | null = null;
  private pathEditor: PotreePathEditor | null = null;
  private mountPromise: Promise<void> | null = null;
  private fitTimer: number | null = null;
  private mountVersion = 0;
  private loadVersion = 0;
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
    this.viewer = viewer;
    this.applyRenderSettings();
    this.keyboardController = new PotreeFlyKeyboardController(
      viewer,
      renderArea,
      this.beginInteractionLod,
      this.scheduleInteractionLodRestore,
    );
    this.keyboardController.start();
    this.depthZoomController = new PotreeDepthZoomController(
      viewer,
      potree,
      renderArea,
      this.beginInteractionLod,
    );
    this.depthZoomController.start();
    viewer.controls?.addEventListener("start", this.beginInteractionLod);
    viewer.controls?.addEventListener("end", this.scheduleInteractionLodRestore);
    this.rotationPivotIndicator = new PotreeRotationPivotIndicator(viewer, renderArea);
    this.rotationPivotIndicator.start();
    this.drawingRenderer = new PotreeDrawingRenderer(viewer, three, renderArea);
    this.chargingAreaEditor = new PotreeChargingAreaEditor(viewer, potree, three, renderArea);
    this.cabinetEditor = new PotreeCabinetEditor(viewer, potree, three, renderArea);
    this.deviceAreaEditor = new PotreeDeviceAreaEditor(viewer, potree, three, renderArea);
    this.pathEditor = new PotreePathEditor(viewer, potree, three, renderArea);
    this.resize();
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

  undoPath(): void {
    this.pathEditor?.undo();
  }

  redoPath(): void {
    this.pathEditor?.redo();
  }

  clearPathDrawing(): void {
    this.pathEditor?.setActive(false);
    this.pathEditor?.clear();
  }

  setViewDirection(direction: ViewDirection): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const angles = POTREE_VIEW_ANGLES[direction];
    viewer.scene.view.yaw = angles.yaw;
    viewer.scene.view.pitch = angles.pitch;
    this.fitModelToScreen();
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
    // Use the model count once metadata is available. Before that, keep the
    // budget finite so Potree never receives an unbounded traversal request.
    const pointBudget = this.renderSettings.pointBudget === SPACE_POINT_BUDGET_ALL
      ? this.loadedPointCount ?? SPACE_POINT_BUDGET_MAX
      : this.renderSettings.pointBudget;
    this.viewer.setPointBudget(pointBudget);
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

  private readonly scheduleInteractionLodRestore = (): void => {
    if (!this.viewer || !this.interactionLodActive) return;
    if (this.interactionLodTimer !== null) window.clearTimeout(this.interactionLodTimer);
    this.interactionLodTimer = window.setTimeout(() => {
      this.interactionLodTimer = null;
      this.interactionLodActive = false;
      this.applyRenderSettings();
    }, INTERACTION_LOD_SETTLE_MS);
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

      this.fitTimer = window.setTimeout(() => {
        if (this.viewer && this.pointcloud === pointcloud) this.fitModelToScreen();
      }, 250);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  clearModel(): void {
    this.loadVersion += 1;
    this.stopClipping();
    this.modelClipBounds = null;
    this.loadedPointCount = null;
    this.resetInteractionLod();
    this.chargingAreaEditor?.clear();
    this.cabinetEditor?.clear();
    this.deviceAreaEditor?.clear();
    this.pathEditor?.clear();
    this.clearDrawingLayers();
    if (this.fitTimer !== null) {
      window.clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    if (!this.pointcloud) return;
    this.disposePointCloud(this.pointcloud);
    this.pointcloud = null;
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
    this.mountVersion += 1;
    this.host = null;
    this.viewer?.controls?.removeEventListener("start", this.beginInteractionLod);
    this.viewer?.controls?.removeEventListener("end", this.scheduleInteractionLodRestore);
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
    this.clearModel();
    if (this.viewer) {
      this.viewer.renderer.setAnimationLoop(null);
      this.viewer.renderer.dispose();
      this.viewer.renderer.forceContextLoss?.();
    }
    this.viewer = null;
    this.potree = null;
    this.mountPromise = null;
    host?.replaceChildren();
  }
}
