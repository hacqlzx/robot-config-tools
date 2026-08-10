import * as pc from "playcanvas";
import { SimpleOrbitCamera } from "../../playcanvas-core/simple-camera";

const DIRECTION_LOCATE_FORWARD_FACTOR = 0.65;
const DIRECTION_LOCATE_BACK_FACTOR = 0.55;
const DIRECTION_LOCATE_LIFT_FACTOR = 0.35;
const DIRECTION_LOCATE_MIN_TOP_FACTOR = 0.25;

export interface ThreeDEngineOptions {
  /** 相机垂直视场角，单位为度。默认 60。 */
  fov?: number;
  /** 相机清屏颜色，未传时使用深灰背景。 */
  clearColor?: pc.Color;
  /** 场景环境光颜色，影响无材质区域/辅助线的基础亮度。 */
  ambientColor?: pc.Color;
  /** 方向光强度，默认 1。 */
  lightIntensity?: number;
}

/**
 * 3D 引擎核心类 — PlayCanvas Application 生命周期管理
 *
 * 职责边界：
 * - 负责 canvas、PlayCanvas Application、相机、灯光、resize、按需渲染；
 * - 不负责业务文件读取、模型树、点表、空间绘制保存；
 * - space-edit 如果需要编辑能力，应在这个引擎外组合自己的 Drawing 类。
 */
export class ThreeDEngine {
  canvas: HTMLCanvasElement;
  app: pc.Application;
  orbit: SimpleOrbitCamera;
  cameraEntity: pc.Entity;

  // 项目里大量交互都是静态查看/编辑，不需要 PlayCanvas 每帧自动渲染。
  // renderDirty 表示“下一帧需要重绘”，相机移动、加载模型、绘制变化时手动置 true。
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
        // 截图、导出和部分调试场景需要保留上一帧缓冲；代价是显存压力略高。
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

    // 限制像素比，避免高 DPI 屏幕把大点云场景的 fill-rate 压力放大数倍。
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
    // 飞行/阻尼相机需要每帧更新，但只有 renderDirty 为 true 时才真正渲染。
    this.orbit.updateFly(dt);
    if (this.renderDirty) {
      this.app.render();
      this.renderDirty = false;
    }
    this.renderRafId = requestAnimationFrame(this.renderLoop);
  };

  /** 标记下一帧需要渲染；加载模型、相机变化或绘制回显更新后调用。 */
  requestRender = () => {
    this.renderDirty = true;
  };

  /** 将相机聚焦到模型局部坐标中心。extent 是模型最大边长，用于自动计算距离。 */
  focusOn(cx: number, cy: number, cz: number, extent: number) {
    // extent 同时影响相机距离、最大缩放距离和 orbit 的场景半径。
    // 这里使用“扩张式”设置，避免连续加载多个模型后后加载的小模型缩小可视范围。
    this.orbit.lookAt.set(cx, cy, cz);
    this.orbit.sceneRadius = Math.max(this.orbit.sceneRadius, extent);
    this.orbit.sceneCenter.set(cx, cy, cz);
    this.orbit.maxDistance = Math.max(this.orbit.maxDistance, extent * 5);
    this.orbit.distance = extent * 1.5;
    this.orbit.updateCamera();
    this.renderDirty = true;
  }

  /** 俯视定位到指定场景点，供勘察图片缩略图快速跳转到对应停靠点。 */
  focusTopOn(cx: number, cy: number, cz: number, extent: number) {
    this.focusOn(cx, cy, cz, extent);
    this.orbit.controlMode = "orbit";
    this.orbit.setViewDirection("上");
    this.renderDirty = true;
  }

  /** 沿指定方向定位；按勘察图片射线方向为主，同时后退并抬高一点，避免相机贴到拍照点。 */
  focusAlongDirection(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number) {
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 1e-6) {
      this.focusTopOn(cx, cy, cz, extent);
      return;
    }

    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    const baseDistance = Math.max(0.5, extent);
    const horizontalLen = Math.hypot(nx, nz);
    const hx = horizontalLen > 1e-6 ? nx / horizontalLen : 0;
    const hz = horizontalLen > 1e-6 ? nz / horizontalLen : 1;
    const forwardDistance = baseDistance * DIRECTION_LOCATE_FORWARD_FACTOR;
    const backDistance = baseDistance * DIRECTION_LOCATE_BACK_FACTOR;
    const liftHeight = baseDistance * DIRECTION_LOCATE_LIFT_FACTOR;
    const minTopHeight = baseDistance * DIRECTION_LOCATE_MIN_TOP_FACTOR;

    const lookX = cx + nx * forwardDistance;
    const lookY = cy + ny * forwardDistance;
    const lookZ = cz + nz * forwardDistance;
    const cameraX = cx - hx * backDistance;
    const cameraY = Math.max(cy + liftHeight, lookY + minTopHeight);
    const cameraZ = cz - hz * backDistance;
    const offsetX = cameraX - lookX;
    const offsetY = cameraY - lookY;
    const offsetZ = cameraZ - lookZ;
    const cameraDistance = Math.max(0.5, Math.hypot(offsetX, offsetY, offsetZ));

    this.orbit.controlMode = "orbit";
    this.orbit.lookAt.set(lookX, lookY, lookZ);
    this.orbit.sceneRadius = Math.max(this.orbit.sceneRadius, cameraDistance);
    this.orbit.sceneCenter.set(lookX, lookY, lookZ);
    this.orbit.maxDistance = Math.max(this.orbit.maxDistance, cameraDistance * 5);
    this.orbit.distance = cameraDistance;

    const horizontal = Math.hypot(offsetX, offsetZ);
    this.orbit.azimuth = Math.atan2(offsetX, offsetZ) * pc.math.RAD_TO_DEG;
    this.orbit.elevation = Math.max(-89, Math.min(89, Math.atan2(offsetY, horizontal) * pc.math.RAD_TO_DEG));
    this.orbit.updateCamera();
    this.renderDirty = true;
  }

  /** 监听容器尺寸并同步 canvas 像素尺寸，避免 CSS 缩放导致选中/投影偏移。 */
  observeResize(container: HTMLElement) {
    this.ro?.disconnect();

    this.resizeHandler = () => {
      if (this.resizeRafId) cancelAnimationFrame(this.resizeRafId);
      this.resizeRafId = requestAnimationFrame(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        // canvas 实际像素和 CSS 尺寸保持一致，由上面的 maxPixelRatio 控制高 DPI 放大。
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

  /** 释放 RAF、ResizeObserver、相机事件和 PlayCanvas Application。 */
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
