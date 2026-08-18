import type { PotreeControls, PotreeViewerInstance } from "@/potree-core/potree-runtime";

export class PotreeRotationPivotIndicator {
  private controls: PotreeControls | null = null;
  private indicator: HTMLDivElement | null = null;
  private leftButtonDown = false;
  private started = false;

  constructor(
    private readonly viewer: PotreeViewerInstance,
    private readonly host: HTMLElement,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.controls = this.viewer.controls ?? null;
    this.indicator = this.createIndicator();
    this.host.appendChild(this.indicator);
    this.host.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("blur", this.handleWindowBlur);
    this.controls?.addEventListener("start", this.handleControlsStart);
    this.controls?.addEventListener("end", this.handleControlsEnd);
  }

  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.host.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("blur", this.handleWindowBlur);
    this.controls?.removeEventListener("start", this.handleControlsStart);
    this.controls?.removeEventListener("end", this.handleControlsEnd);
    this.controls = null;
    this.indicator?.remove();
    this.indicator = null;
    this.leftButtonDown = false;
  }

  private createIndicator(): HTMLDivElement {
    const indicator = document.createElement("div");
    indicator.setAttribute("aria-hidden", "true");
    Object.assign(indicator.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
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

  private show(): void {
    if (this.indicator) this.indicator.style.display = "block";
  }

  private hide(): void {
    if (this.indicator) this.indicator.style.display = "none";
  }

  private readonly handleMouseDown = (event: MouseEvent): void => {
    this.leftButtonDown = event.button === 0;
  };

  private readonly handleMouseUp = (): void => {
    this.leftButtonDown = false;
    this.hide();
  };

  private readonly handleWindowBlur = (): void => {
    this.leftButtonDown = false;
    this.hide();
  };

  private readonly handleControlsStart = (): void => {
    if (this.leftButtonDown) this.show();
  };

  private readonly handleControlsEnd = (): void => {
    this.hide();
  };
}
