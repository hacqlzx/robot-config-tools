import type {
  PotreeCamera,
  PotreeNamespace,
  PotreePointCloudIntersection,
  PotreeRay,
  PotreeViewerInstance,
} from "@/potree-core/potree-runtime";

const ZOOM_DISTANCE_RATIO = 0.28;
const MINIMUM_WORLD_DISTANCE = 0.01;

type LegacyWheelEvent = Event & {
  detail?: number;
  wheelDelta?: number;
};

function getWheelDirection(event: LegacyWheelEvent): number {
  const delta = event.wheelDelta ?? (event.detail === undefined ? 0 : -event.detail);
  return Math.sign(delta);
}

function minimumDistance(camera: PotreeCamera): number {
  return Math.max(MINIMUM_WORLD_DISTANCE, camera.near * 0.1);
}

function distanceBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class PotreeDepthZoomController {
  private started = false;
  private active = true;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly host: HTMLElement,
    private readonly onZoom?: () => void,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.host.addEventListener("mousewheel", this.handleWheel, { capture: true, passive: false });
    this.host.addEventListener("DOMMouseScroll", this.handleWheel, { capture: true, passive: false });
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.host.removeEventListener("mousewheel", this.handleWheel, true);
    this.host.removeEventListener("DOMMouseScroll", this.handleWheel, true);
  }

  private readonly handleWheel = (event: Event): void => {
    if (!this.active) return;
    const direction = getWheelDirection(event as LegacyWheelEvent);
    const camera = this.viewer.scene.getActiveCamera?.();
    if (direction === 0 || !camera) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    this.onZoom?.();

    const mouse = this.getMousePosition(event);
    const hit = this.pickPointCloud(camera, mouse);
    if (hit) {
      this.zoomToHit(camera, hit, direction, mouse);
    } else {
      this.zoomAroundViewPivot(camera, direction);
    }
  };

  private getMousePosition(event: Event): { x: number; y: number } {
    const pointerEvent = event as MouseEvent;
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    return {
      x: Math.min(bounds.width, Math.max(0, pointerEvent.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, pointerEvent.clientY - bounds.top)),
    };
  }

  private pickPointCloud(camera: PotreeCamera, mouse: { x: number; y: number }): PotreePointCloudIntersection | null {
    const pick = this.potree.Utils?.getMousePointCloudIntersection;
    if (!pick || this.viewer.scene.pointclouds.length === 0) return null;

    try {
      return pick(mouse, camera, this.viewer, this.viewer.scene.pointclouds, { pickClipped: true });
    } catch {
      return null;
    }
  }

  private zoomToHit(
    camera: PotreeCamera,
    hit: PotreePointCloudIntersection,
    wheelDirection: number,
    mouse: { x: number; y: number },
  ): void {
    const view = this.viewer.scene.view;
    const distance = distanceBetween(hit.location, view.position);
    if (!Number.isFinite(distance) || distance <= 0) {
      this.zoomAroundViewPivot(camera, wheelDirection);
      return;
    }

    const ray = this.getMouseRay(camera, mouse);
    if (!ray) {
      this.zoomAroundViewPivot(camera, wheelDirection);
      return;
    }

    const minDistance = minimumDistance(camera);
    const step = Math.max(distance * ZOOM_DISTANCE_RATIO, minDistance);
    view.position.x += ray.direction.x * wheelDirection * step;
    view.position.y += ray.direction.y * wheelDirection * step;
    view.position.z += ray.direction.z * wheelDirection * step;

    // Keep the cursor hit at the same depth for OrbitControls without
    // changing the camera heading, which would look like a rotation.
    const depth = (hit.location.x - view.position.x) * view.direction.x
      + (hit.location.y - view.position.y) * view.direction.y
      + (hit.location.z - view.position.z) * view.direction.z;
    view.radius = Math.max(minDistance, depth);
  }

  private getMouseRay(camera: PotreeCamera, mouse: { x: number; y: number }): PotreeRay | null {
    const mouseToRay = this.potree.Utils?.mouseToRay;
    if (!mouseToRay) return null;
    const element = this.viewer.renderer.domElement;
    try {
      return mouseToRay(mouse, camera, element.clientWidth, element.clientHeight);
    } catch {
      return null;
    }
  }

  private zoomAroundViewPivot(camera: PotreeCamera, wheelDirection: number): void {
    const view = this.viewer.scene.view;
    const minDistance = minimumDistance(camera);
    const radius = Math.max(minDistance, view.radius);
    const step = Math.max(radius * ZOOM_DISTANCE_RATIO, minDistance);
    const heading = view.direction;
    const pivot = {
      x: view.position.x + heading.x * radius,
      y: view.position.y + heading.y * radius,
      z: view.position.z + heading.z * radius,
    };
    const nextRadius = wheelDirection > 0
      ? Math.max(minDistance, radius - step)
      : radius + step;
    if (wheelDirection > 0 && radius <= minDistance) {
      pivot.x += heading.x * step;
      pivot.y += heading.y * step;
      pivot.z += heading.z * step;
    }
    view.position.x = pivot.x - heading.x * nextRadius;
    view.position.y = pivot.y - heading.y * nextRadius;
    view.position.z = pivot.z - heading.z * nextRadius;
    view.radius = nextRadius;
  }
}
