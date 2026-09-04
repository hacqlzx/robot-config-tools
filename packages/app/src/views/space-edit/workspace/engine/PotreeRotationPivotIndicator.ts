import type {
  PotreeControls,
  PotreeNamespace,
  PotreeThreeNamespace,
  PotreeViewerInstance,
} from "@/potree-core/potree-runtime";
import type { SpaceInteractionCoordinator, SpaceInteractionMode } from "./SpaceInteractionCoordinator";

const DRAG_THRESHOLD_PX = 3;
const ROTATION_SPEED = 5;

type Point3 = { x: number; y: number; z: number };

function isFinitePoint(point: Point3 | null | undefined): point is Point3 {
  return !!point && [point.x, point.y, point.z].every(Number.isFinite);
}

function rotateAroundAxis(vector: Point3, axis: Point3, angle: number): Point3 {
  const axisLength = Math.hypot(axis.x, axis.y, axis.z);
  if (!Number.isFinite(axisLength) || axisLength < 1e-8 || !Number.isFinite(angle)) return vector;

  const nx = axis.x / axisLength;
  const ny = axis.y / axisLength;
  const nz = axis.z / axisLength;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const parallel = nx * vector.x + ny * vector.y + nz * vector.z;
  const perpendicular = {
    x: vector.x - parallel * nx,
    y: vector.y - parallel * ny,
    z: vector.z - parallel * nz,
  };
  const tangent = {
    x: ny * vector.z - nz * vector.y,
    y: nz * vector.x - nx * vector.z,
    z: nx * vector.y - ny * vector.x,
  };

  return {
    x: parallel * nx + perpendicular.x * cos + tangent.x * sin,
    y: parallel * ny + perpendicular.y * cos + tangent.y * sin,
    z: parallel * nz + perpendicular.z * cos + tangent.z * sin,
  };
}

export class PotreeRotationPivotIndicator {
  private controls: PotreeControls | null = null;
  private indicator: HTMLDivElement | null = null;
  private pendingPivot: Point3 | null = null;
  private pivot: Point3 | null = null;
  private lastCameraPosition: Point3 | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private activeDrag = false;
  private started = false;
  private active = true;
  private interactionMode: SpaceInteractionMode = "idle";
  private unsubscribeInteractions: (() => void) | null = null;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly potree: PotreeNamespace,
    private readonly three: PotreeThreeNamespace,
    private readonly host: HTMLElement,
    private readonly interactions: SpaceInteractionCoordinator,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.controls = this.viewer.controls ?? null;
    this.interactionMode = this.interactions.getMode();
    this.indicator = this.createIndicator();
    this.host.appendChild(this.indicator);
    // Keep the initial mousedown available to drawing editors. The gesture is
    // claimed only after it passes the drag threshold and no editor owns it.
    this.host.addEventListener("mousedown", this.handleMouseDown, true);
    this.host.addEventListener("mousemove", this.handleMouseMove, true);
    window.addEventListener("mousemove", this.handleWindowMouseMove, true);
    window.addEventListener("mouseup", this.handleMouseUp, true);
    window.addEventListener("blur", this.handleWindowBlur);
    this.unsubscribeInteractions = this.interactions.subscribe(() => {
      const mode = this.interactions.getMode();
      if (mode !== this.interactionMode) {
        this.interactionMode = mode;
        this.cancel();
        return;
      }
      if (!this.canNavigate() || this.isOwnedByEditor()) this.cancel();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.cancel();
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.host.removeEventListener("mousedown", this.handleMouseDown, true);
    this.host.removeEventListener("mousemove", this.handleMouseMove, true);
    window.removeEventListener("mousemove", this.handleWindowMouseMove, true);
    window.removeEventListener("mouseup", this.handleMouseUp, true);
    window.removeEventListener("blur", this.handleWindowBlur);
    this.unsubscribeInteractions?.();
    this.unsubscribeInteractions = null;
    this.controls = null;
    this.cancel();
    this.indicator?.remove();
    this.indicator = null;
  }

  private createIndicator(): HTMLDivElement {
    const indicator = document.createElement("div");
    indicator.setAttribute("aria-hidden", "true");
    Object.assign(indicator.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: "10px",
      height: "10px",
      display: "none",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      zIndex: "20",
      background: "#39d98a",
      border: "1px solid rgba(255, 255, 255, 0.9)",
      borderRadius: "50%",
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.85)",
    });
    return indicator;
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.canStart(event)) return;
    const point = this.pickPoint(event.clientX, event.clientY);
    this.pendingPivot = point;
    this.pivot = null;
    const position = this.viewer.scene.view.position;
    this.lastCameraPosition = point && isFinitePoint(position) ? { ...position } : null;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.activeDrag = false;
    if (point) {
      this.controls?.stop?.();
    }
    this.hide();
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.pendingPivot || this.activeDrag) return;
    if (this.isOwnedByEditor()) {
      this.cancel();
      return;
    }
    const last = this.lastPointer;
    if (!last) return;
    const moved = Math.hypot(event.clientX - last.x, event.clientY - last.y);
    if (moved <= DRAG_THRESHOLD_PX) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    this.beginDrag();
    if (this.activeDrag) {
      this.rotate(event);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  private readonly handleWindowMouseMove = (event: MouseEvent): void => {
    if (!this.activeDrag) return;
    if ((event.buttons & 1) === 0) {
      this.cancel();
      return;
    }
    this.rotate(event);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.cancel();
  };

  private readonly handleWindowBlur = (): void => {
    this.cancel();
  };

  private canStart(event: MouseEvent): boolean {
    if (!this.active || event.button !== 0 || event.target instanceof Element && event.target.closest("[data-space-edit-overlay]")) {
      return false;
    }
    return this.canNavigate()
      && !this.host.closest("[data-space-edit-busy='true']")
      && !this.isOwnedByEditor();
  }

  private canNavigate(): boolean {
    return this.interactions.isMode("idle", "cabinet", "charging", "device-area", "path", "normal");
  }

  private isOwnedByEditor(): boolean {
    return this.interactions.hasAnyClaim("drawing-drag", "drawing-selection", "path-selection");
  }

  private beginDrag(): void {
    const point = this.pendingPivot;
    const position = this.viewer.scene.view.position;
    if (!point || !isFinitePoint(position)) {
      this.cancel();
      return;
    }
    const previousPosition = this.lastCameraPosition;
    this.pivot = {
      x: point.x + (previousPosition ? position.x - previousPosition.x : 0),
      y: point.y + (previousPosition ? position.y - previousPosition.y : 0),
      z: point.z + (previousPosition ? position.z - previousPosition.z : 0),
    };
    this.lastCameraPosition = { ...position };
    this.activeDrag = true;
    this.controls?.stop?.();
    this.show(this.pivot);
  }

  private rotate(event: MouseEvent): void {
    const pivot = this.pivot;
    const last = this.lastPointer;
    const view = this.viewer.scene.view;
    const element = this.viewer.renderer.domElement;
    if (!pivot || !last || !element || !isFinitePoint(view.position)) return;
    // Move the pivot by the same amount as WASD moved the camera. This keeps
    // their relative position stable while the mouse button remains held.
    const previousPosition = this.lastCameraPosition;
    if (previousPosition) {
      pivot.x += view.position.x - previousPosition.x;
      pivot.y += view.position.y - previousPosition.y;
      pivot.z += view.position.z - previousPosition.z;
    }
    const offset = {
      x: view.position.x - pivot.x,
      y: view.position.y - pivot.y,
      z: view.position.z - pivot.z,
    };

    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    const yawDelta = -((event.clientX - last.x) / width) * ROTATION_SPEED;
    const pitchDelta = -((event.clientY - last.y) / height) * ROTATION_SPEED;
    if (!Number.isFinite(yawDelta) || !Number.isFinite(pitchDelta)) return;

    // Match Potree's view convention: yaw is around world Z and pitch is
    // around the camera's horizontal side axis.
    const side = { x: Math.cos(view.yaw), y: Math.sin(view.yaw), z: 0 };
    const previousPitch = view.pitch;
    view.pitch = previousPitch + pitchDelta;
    const appliedPitch = view.pitch - previousPitch;
    let rotated = rotateAroundAxis(offset, side, appliedPitch);
    rotated = rotateAroundAxis(rotated, { x: 0, y: 0, z: 1 }, yawDelta);
    if (!isFinitePoint(rotated)) return;

    view.yaw += yawDelta;
    view.position.x = pivot.x + rotated.x;
    view.position.y = pivot.y + rotated.y;
    view.position.z = pivot.z + rotated.z;
    this.lastCameraPosition = { ...view.position };
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.show(pivot);
  }

  private pickPoint(clientX: number, clientY: number): Point3 | null {
    const camera = this.viewer.scene.getActiveCamera?.();
    const pick = this.potree.Utils?.getMousePointCloudIntersection;
    const pointclouds = this.viewer.scene.pointclouds;
    if (!camera || !pick || pointclouds.length === 0) return null;
    const bounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    try {
      const result = pick(
        {
          x: Math.min(bounds.width, Math.max(0, clientX - bounds.left)),
          y: Math.min(bounds.height, Math.max(0, clientY - bounds.top)),
        },
        camera,
        this.viewer,
        pointclouds,
        { pickClipped: true },
      );
      const location = result?.location;
      return isFinitePoint(location) ? { x: location.x, y: location.y, z: location.z } : null;
    } catch {
      return null;
    }
  }

  private show(point: Point3): void {
    const indicator = this.indicator;
    const camera = this.viewer.scene.getActiveCamera?.();
    if (!indicator || !camera || !isFinitePoint(point)) return;
    const bounds = this.host.getBoundingClientRect();
    const elementBounds = this.viewer.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || elementBounds.width <= 0 || elementBounds.height <= 0) return;

    const projected = new this.three.Vector3(point.x, point.y, point.z).project(camera);
    if (!isFinitePoint(projected)) {
      this.hide();
      return;
    }
    const x = elementBounds.left - bounds.left + ((projected.x + 1) * 0.5) * elementBounds.width;
    const y = elementBounds.top - bounds.top + ((1 - projected.y) * 0.5) * elementBounds.height;
    const visible = projected.z >= -1 && projected.z <= 1;
    indicator.style.left = `${x}px`;
    indicator.style.top = `${y}px`;
    indicator.style.display = visible ? "block" : "none";
  }

  private hide(): void {
    if (this.indicator) this.indicator.style.display = "none";
  }

  private cancel(): void {
    this.pendingPivot = null;
    this.pivot = null;
    this.lastCameraPosition = null;
    this.lastPointer = null;
    this.activeDrag = false;
    this.hide();
  }
}
