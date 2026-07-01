import * as pc from "playcanvas";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";

export interface ThreeDEngineOptions {
  fov?: number;
  clearColor?: pc.Color;
  ambientColor?: pc.Color;
  lightIntensity?: number;
}

/**
 * 3D 引擎核心类 — PlayCanvas Application 生命周期管理
 */
export class ThreeDEngine {
  canvas: HTMLCanvasElement;
  app: pc.Application;
  orbit: SimpleOrbitCamera;
  cameraEntity: pc.Entity;

  private renderDirty = true;
  private renderRafId = 0;
  private lastTime = 0;
  private ro: ResizeObserver | null = null;
  private resizeRafId = 0;
  private resizeHandler: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options?: ThreeDEngineOptions) {
    this.canvas = canvas;
    const { fov = 60, clearColor, ambientColor, lightIntensity = 1 } = options || {};

    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      componentSystems: [
        pc.AnimComponentSystem,
        pc.RenderComponentSystem,
        pc.CameraComponentSystem,
        pc.LightComponentSystem,
        pc.GSplatComponentSystem,
      ],
      resourceHandlers: [
        pc.RenderHandler,
        pc.AnimClipHandler,
        pc.TextureHandler,
        pc.CubemapHandler,
        pc.ContainerHandler,
        pc.GSplatHandler,
      ],
      graphicsDeviceOptions: {
        preferWebGl2: true,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      },
    } as any);

    this.app.scene.ambientLight = ambientColor || new pc.Color(0.3, 0.3, 0.3);

    const light = new pc.Entity("light");
    light.addComponent("light", {
      type: "directional",
      color: pc.Color.WHITE,
      intensity: lightIntensity,
    });
    light.setEulerAngles(45, 45, 0);
    this.app.root.addChild(light);

    this.cameraEntity = new pc.Entity("camera");
    this.cameraEntity.addComponent("camera", {
      fov,
      clearColor: clearColor || new pc.Color(0.12, 0.12, 0.12),
    });
    this.app.root.addChild(this.cameraEntity);

    this.orbit = new SimpleOrbitCamera(this.app, this.cameraEntity, () => {
      this.renderDirty = true;
    });

    this.app.graphicsDevice.maxPixelRatio = 1;
    this.app.autoRender = false;
    this.app.start();

    this.lastTime = performance.now();
    this.renderRafId = requestAnimationFrame(this.renderLoop);
  }

  private renderLoop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.orbit.updateFly(dt);
    if (this.renderDirty) {
      this.app.render();
      this.renderDirty = false;
    }
    this.renderRafId = requestAnimationFrame(this.renderLoop);
  };

  requestRender = () => {
    this.renderDirty = true;
  };

  focusOn(cx: number, cy: number, cz: number, extent: number) {
    this.orbit.lookAt.set(cx, cy, cz);
    this.orbit.sceneRadius = Math.max(this.orbit.sceneRadius, extent);
    this.orbit.sceneCenter.set(cx, cy, cz);
    this.orbit.maxDistance = Math.max(this.orbit.maxDistance, extent * 5);
    this.orbit.distance = extent * 1.5;
    this.orbit.updateCamera();
    this.renderDirty = true;
  }

  observeResize(container: HTMLElement) {
    this.ro?.disconnect();

    this.resizeHandler = () => {
      if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = requestAnimationFrame(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.app.resizeCanvas(w, h);
        this.renderDirty = true;
      });
    };

    const handler = this.resizeHandler;
    handler();
    this.ro = new ResizeObserver(handler);
    this.ro.observe(container);
    window.addEventListener("resize", handler);
  }

  destroy() {
    cancelAnimationFrame(this.renderRafId);
    cancelAnimationFrame(this.resizeRafId);
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
    }
    this.ro?.disconnect();
    this.ro = null;
    this.resizeHandler = null;
    this.orbit.destroy();
    this.app.destroy();
  }
}
