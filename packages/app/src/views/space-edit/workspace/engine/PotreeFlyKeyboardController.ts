import type { PotreeViewerInstance } from "@/potree-core/potree-runtime";

const BASE_FLY_SPEED = 5;
const MAX_FRAME_DELTA_SECONDS = 1 / 30;
const FIRST_MOVEMENT_DELTA_SECONDS = 1 / 120;
const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);
const CONTROL_KEYS = new Set([
  ...MOVEMENT_KEYS,
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

export class PotreeFlyKeyboardController {
  private readonly pressedKeys = new Set<string>();
  private started = false;
  private active = true;
  private planar = false;
  private animationFrame: number | null = null;
  private previousFrameTime = 0;
  private firstMovementFrame = false;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly host: HTMLElement,
    private readonly onMovementStart?: () => void,
    private readonly onMovementEnd?: () => void,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearKeys);
    this.previousFrameTime = performance.now();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active && this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (!active) this.clearKeys();
  }

  setPlanar(planar: boolean): void {
    this.planar = planar;
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.clearKeys();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (!CONTROL_KEYS.has(event.code) || isEditableTarget(event.target)) return;
    const target = event.target;
    if (
      target !== document.body
      && target !== document.documentElement
      && !(target instanceof HTMLCanvasElement)
      && !(target instanceof Node && this.host.contains(target))
    ) return;

    const wasMoving = this.hasMovementKey();
    this.pressedKeys.add(event.code);
    if (!wasMoving && this.hasMovementKey()) {
      this.firstMovementFrame = true;
      this.onMovementStart?.();
    }
    if (MOVEMENT_KEYS.has(event.code)) this.scheduleUpdate();
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (!CONTROL_KEYS.has(event.code)) return;
    const wasMoving = this.hasMovementKey();
    this.pressedKeys.delete(event.code);
    if (wasMoving && !this.hasMovementKey()) {
      this.firstMovementFrame = false;
      this.onMovementEnd?.();
    }
  };

  private readonly clearKeys = (): void => {
    const wasMoving = this.hasMovementKey();
    this.pressedKeys.clear();
    if (wasMoving) this.onMovementEnd?.();
    this.firstMovementFrame = false;
  };

  private scheduleUpdate(): void {
    if (!this.started || !this.active || this.animationFrame !== null) return;
    this.previousFrameTime = performance.now();
    this.animationFrame = window.requestAnimationFrame(this.update);
  }

  private hasMovementKey(): boolean {
    for (const key of MOVEMENT_KEYS) {
      if (this.pressedKeys.has(key)) return true;
    }
    return false;
  }

  private readonly update = (time: number): void => {
    this.animationFrame = null;
    if (!this.started || !this.active || !this.hasMovementKey()) return;
    const elapsedSeconds = Math.max(0, (time - this.previousFrameTime) / 1000);
    const deltaSeconds = this.firstMovementFrame
      ? Math.min(elapsedSeconds, FIRST_MOVEMENT_DELTA_SECONDS)
      : Math.min(
      MAX_FRAME_DELTA_SECONDS,
      elapsedSeconds,
    );
    this.firstMovementFrame = false;
    this.previousFrameTime = time;
    this.applyMovement(deltaSeconds);
    if (this.hasMovementKey()) this.animationFrame = window.requestAnimationFrame(this.update);
  };

  private applyMovement(deltaSeconds: number): void {
    if (
      !this.pressedKeys.has("KeyW")
      && !this.pressedKeys.has("KeyA")
      && !this.pressedKeys.has("KeyS")
      && !this.pressedKeys.has("KeyD")
      && !this.pressedKeys.has("KeyQ")
      && !this.pressedKeys.has("KeyE")
    ) return;

    const view = this.viewer.scene.view;
    const direction = view.direction;
    const horizontalLength = Math.hypot(direction.x, direction.y);
    const yawBased = this.planar || horizontalLength <= 0;
    const forwardX = yawBased ? -Math.sin(view.yaw) : direction.x / horizontalLength;
    const forwardY = yawBased ? Math.cos(view.yaw) : direction.y / horizontalLength;
    const rightX = forwardY;
    const rightY = -forwardX;
    const forwardAmount = Number(this.pressedKeys.has("KeyW")) - Number(this.pressedKeys.has("KeyS"));
    const rightAmount = Number(this.pressedKeys.has("KeyD")) - Number(this.pressedKeys.has("KeyA"));
    const verticalAmount = this.planar ? 0 : Number(this.pressedKeys.has("KeyE")) - Number(this.pressedKeys.has("KeyQ"));

    let speed = BASE_FLY_SPEED;
    if (this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight")) speed *= 10;
    if (this.pressedKeys.has("AltLeft") || this.pressedKeys.has("AltRight")) speed *= 0.1;
    const distance = speed * deltaSeconds;

    view.translateWorld(
      (forwardX * forwardAmount + rightX * rightAmount) * distance,
      (forwardY * forwardAmount + rightY * rightAmount) * distance,
      verticalAmount * distance,
    );
  }
}
