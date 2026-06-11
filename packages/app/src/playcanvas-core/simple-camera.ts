import * as pc from "playcanvas";

/**
 * 简易轨道相机 — 鼠标旋转/缩放/平移
 */
export class SimpleOrbitCamera {
  app: pc.Application;
  camera: pc.Entity;
  pivot: pc.Entity;
  distance = 5;
  azimuth = 0;
  elevation = 30;
  lookAt = new pc.Vec3(0, 0, 0);
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private button = -1;
  private _canvas: HTMLCanvasElement | null = null;
  private touchDist = 0;

  constructor(app: pc.Application, camera: pc.Entity) {
    this.app = app;
    this.camera = camera;
    this.pivot = new pc.Entity("camera-pivot");
    this.pivot.setLocalPosition(this.lookAt);
    this.pivot.addChild(camera);
    app.root.addChild(this.pivot);

    const canvas = app.graphicsDevice.canvas;
    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("touchstart", this.onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    canvas.addEventListener("touchend", this.onTouchEnd);
    this._canvas = canvas;

    this.updateCamera();
  }

  private updateCamera() {
    const e = this.elevation * pc.math.DEG_TO_RAD;
    const a = this.azimuth * pc.math.DEG_TO_RAD;
    const x = this.lookAt.x + this.distance * Math.cos(e) * Math.sin(a);
    const y = this.lookAt.y + this.distance * Math.sin(e);
    const z = this.lookAt.z + this.distance * Math.cos(e) * Math.cos(a);
    this.pivot.setLocalPosition(this.lookAt);
    this.camera.setLocalPosition(x - this.lookAt.x, y - this.lookAt.y, z - this.lookAt.z);
    this.camera.lookAt(this.lookAt);
  }

  private getMousePos(e: MouseEvent | Touch) {
    const gd = this.app?.graphicsDevice;
    if (!gd) return { x: 0, y: 0 };
    const canvas = gd.canvas;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true;
    this.button = e.button;
    const pos = this.getMousePos(e);
    this.lastX = pos.x;
    this.lastY = pos.y;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const pos = this.getMousePos(e);
    const dx = pos.x - this.lastX;
    const dy = pos.y - this.lastY;
    this.lastX = pos.x;
    this.lastY = pos.y;

    if (this.button === 0) {
      this.azimuth -= dx * 0.3;
      this.elevation = Math.max(-89, Math.min(89, this.elevation + dy * 0.3));
    } else if (this.button === 1 || this.button === 2) {
      // 平移
      const right = new pc.Vec3();
      const up = new pc.Vec3();
      this.camera.getWorldTransform().getX(right).normalize();
      this.camera.getWorldTransform().getY(up).normalize();
      const speed = this.distance * 0.001;
      this.lookAt.sub(right.mulScalar(dx * speed));
      this.lookAt.add(up.mulScalar(dy * speed));
    }
    this.updateCamera();
  };

  private onMouseUp = () => {
    this.dragging = false;
    this.button = -1;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = Math.max(0.1, Math.min(200, this.distance * (1 + e.deltaY * 0.001)));
    this.updateCamera();
  };

  // 触摸
  private touchDist = 0;
  private onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const pos = this.getMousePos(e.touches[0]);
      this.lastX = pos.x;
      this.lastY = pos.y;
      this.dragging = true;
      this.button = 0;
    } else if (e.touches.length === 2) {
      const a = this.getMousePos(e.touches[0]);
      const b = this.getMousePos(e.touches[1]);
      this.touchDist = Math.hypot(b.x - a.x, b.y - a.y);
    }
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && this.dragging) {
      const pos = this.getMousePos(e.touches[0]);
      const dx = pos.x - this.lastX;
      const dy = pos.y - this.lastY;
      this.lastX = pos.x;
      this.lastY = pos.y;
      this.azimuth -= dx * 0.3;
      this.elevation = Math.max(-89, Math.min(89, this.elevation + dy * 0.3));
      this.updateCamera();
    } else if (e.touches.length === 2) {
      const a = this.getMousePos(e.touches[0]);
      const b = this.getMousePos(e.touches[1]);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      this.distance = Math.max(0.1, Math.min(200, this.distance * (this.touchDist / d)));
      this.touchDist = d;
      this.updateCamera();
    }
  };
  private onTouchEnd = () => { this.dragging = false; this.button = -1; };

  destroy() {
    const canvas = this._canvas;
    if (canvas) {
      canvas.removeEventListener("mousedown", this.onMouseDown);
      canvas.removeEventListener("mousemove", this.onMouseMove);
      canvas.removeEventListener("mouseup", this.onMouseUp);
      canvas.removeEventListener("wheel", this.onWheel);
      canvas.removeEventListener("touchstart", this.onTouchStart);
      canvas.removeEventListener("touchmove", this.onTouchMove);
      canvas.removeEventListener("touchend", this.onTouchEnd);
    }
    this.pivot?.destroy();
  }
}
