import { Texture } from "playcanvas";

/** GPU 拾取器桩 — 选中编辑用，viewer 不需要 */
export class Picker {
  constructor(_scene: any) {}
  setRenderTargets(_color: Texture, _work: Texture) {}
  prepareDepth(_splat: any) {}
  async readDepth(_x: number, _y: number): Promise<number> { return 0; }
  prepareId(_splat: any, _mode: string) {}
  readId(_x: number, _y: number): number { return -1; }
  readIds(_x: number, _y: number, _w: number, _h: number): Int32Array { return new Int32Array(); }
  destroy() {}
}
