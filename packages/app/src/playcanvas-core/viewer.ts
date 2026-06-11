/**
 * PlayCanvas 3D 查看器 — 封装渲染核心
 * 支持 PLY/SPLAT 模型和 LAS 点云加载
 */
import * as pc from "playcanvas";

export class PlayCanvasViewer {
  canvas: HTMLCanvasElement;
  app: pc.Application;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: {},
    });
  }

  async init() {
    this.app.start();
    // 加载占位场景：灯光、相机
    this.setupDefaultScene();
  }

  setupDefaultScene() {
    const scene = this.app.scene;
    scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);

    const light = new pc.Entity("light");
    light.addComponent("light", { type: "directional", color: pc.Color.WHITE, intensity: 1 });
    light.setEulerAngles(45, 45, 0);
    this.app.root.addChild(light);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", { fov: 60, clearColor: new pc.Color(0.12, 0.12, 0.12) });
    camera.setLocalPosition(5, 3, 5);
    camera.lookAt(0, 0, 0);
    this.app.root.addChild(camera);
  }

  destroy() {
    this.app.destroy();
  }
}
