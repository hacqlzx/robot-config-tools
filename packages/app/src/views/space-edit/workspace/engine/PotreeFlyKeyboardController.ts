import type { PotreeViewerInstance } from "@/potree-core/potree-runtime";

const BASE_FLY_SPEED = 5;
const MAX_FRAME_DELTA_SECONDS = 0.1;
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
  private animationFrame: number | null = null;
  private previousFrameTime = 0;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly host: HTMLElement,
  ) {}

  start(): void {
    if (this.animationFrame !== null) return;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.clearKeys);
    this.previousFrameTime = performance.now();
    this.animationFrame = window.requestAnimationFrame(this.update);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.clearKeys();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!CONTROL_KEYS.has(event.code) || isEditableTarget(event.target)) return;
    const target = event.target;
    if (
      target !== document.body
      && target !== document.documentElement
      && !(target instanceof HTMLCanvasElement)
      && !(target instanceof Node && this.host.contains(target))
    ) return;

    this.pressedKeys.add(event.code);
    event.preventDefault();
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (!CONTROL_KEYS.has(event.code)) return;
    this.pressedKeys.delete(event.code);
  };

  private readonly clearKeys = (): void => {
    this.pressedKeys.clear();
  };

  private readonly update = (time: number): void => {
    const deltaSeconds = Math.min(
      MAX_FRAME_DELTA_SECONDS,
      Math.max(0, (time - this.previousFrameTime) / 1000),
    );
    this.previousFrameTime = time;
    this.applyMovement(deltaSeconds);
    this.animationFrame = window.requestAnimationFrame(this.update);
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
    const forwardX = horizontalLength > 0 ? direction.x / horizontalLength : 0;
    const forwardY = horizontalLength > 0 ? direction.y / horizontalLength : 0;
    const rightX = forwardY;
    const rightY = -forwardX;
    const forwardAmount = Number(this.pressedKeys.has("KeyW")) - Number(this.pressedKeys.has("KeyS"));
    const rightAmount = Number(this.pressedKeys.has("KeyD")) - Number(this.pressedKeys.has("KeyA"));
    const verticalAmount = Number(this.pressedKeys.has("KeyE")) - Number(this.pressedKeys.has("KeyQ"));

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
