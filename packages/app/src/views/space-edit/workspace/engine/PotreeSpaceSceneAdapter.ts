import {
  loadPotreeRuntime,
  type PotreeNamespace,
  type PotreeGeometryNode,
  type PotreePointCloud,
  type PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import { PotreeDepthZoomController } from "./PotreeDepthZoomController";
import { PotreeFlyKeyboardController } from "./PotreeFlyKeyboardController";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  normalizeSpaceRenderSettings,
  SPACE_POINT_BUDGET_ALL,
  SPACE_POINT_BUDGET_MAX,
  type SpaceRenderDetailLevel,
  type SpaceRenderSettings,
  type SpaceSceneAdapter,
  type SpaceSceneModel,
} from "./types";

const MODEL_LOAD_TIMEOUT_MS = 60_000;
const MIN_NODE_SIZE_BY_DETAIL: Record<SpaceRenderDetailLevel, number> = {
  1: 80,
  2: 30,
  3: 15,
  4: 8,
};

function getPointCloudPointCount(pointcloud: PotreePointCloud): number | null {
  const pointCount = pointcloud.pcoGeometry?.loader?.metadata?.points
    ?? pointcloud.pcoGeometry?.numPoints;
  if (typeof pointCount !== "number" || !Number.isFinite(pointCount) || pointCount <= 0) return null;
  return Math.floor(pointCount);
}

function disposeGeometryTree(root?: PotreeGeometryNode): void {
  if (!root) return;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    const children = node.children
      ? (Array.isArray(node.children) ? node.children : Object.values(node.children))
      : [];
    pending.push(...children);
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
  private mountPromise: Promise<void> | null = null;
  private fitTimer: number | null = null;
  private mountVersion = 0;
  private loadVersion = 0;
  private loadedPointCount: number | null = null;
  private renderSettings = { ...DEFAULT_SPACE_RENDER_SETTINGS };

  mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const version = ++this.mountVersion;
    this.mountPromise = this.mountViewer(host, version);
    return this.mountPromise;
  }

  private async mountViewer(host: HTMLElement, version: number): Promise<void> {
    const potree = await loadPotreeRuntime();
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
    this.keyboardController = new PotreeFlyKeyboardController(viewer, renderArea);
    this.keyboardController.start();
    this.depthZoomController = new PotreeDepthZoomController(viewer, potree, renderArea);
    this.depthZoomController.start();
    this.resize();
  }

  getRenderSettings(): SpaceRenderSettings {
    return { ...this.renderSettings };
  }

  setRenderSettings(settings: SpaceRenderSettings): void {
    this.renderSettings = normalizeSpaceRenderSettings(settings);
    this.applyRenderSettings();
  }

  private applyRenderSettings(): void {
    if (!this.viewer) return;
    this.viewer.setMinNodeSize(MIN_NODE_SIZE_BY_DETAIL[this.renderSettings.detailLevel]);
    // Use the model count once metadata is available. Before that, keep the
    // budget finite so Potree never receives an unbounded traversal request.
    const pointBudget = this.renderSettings.pointBudget === SPACE_POINT_BUDGET_ALL
      ? this.loadedPointCount ?? SPACE_POINT_BUDGET_MAX
      : this.renderSettings.pointBudget;
    this.viewer.setPointBudget(pointBudget);
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
      this.loadedPointCount = getPointCloudPointCount(pointcloud);
      this.applyRenderSettings();

      this.fitTimer = window.setTimeout(() => {
        if (this.viewer && this.pointcloud === pointcloud) this.viewer.fitToScreen();
      }, 250);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  clearModel(): void {
    this.loadVersion += 1;
    this.loadedPointCount = null;
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
    disposeGeometryTree(pointcloud.pcoGeometry?.root);
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
    this.keyboardController?.dispose();
    this.keyboardController = null;
    this.depthZoomController?.dispose();
    this.depthZoomController = null;
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
