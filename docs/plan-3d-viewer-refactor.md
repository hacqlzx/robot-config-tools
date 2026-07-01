# 3D 渲染统一抽离方案

## 现状对比

| 维度 | 空间编辑 (`space-edit`) | 勘察图片 (`image-edit`) |
|------|------------------------|------------------------|
| **引擎入口** | `usePlayCanvas.ts` (React hook) | `ViewerEngine.ts` (纯类) → `usePointCloudViewer.ts` (hook) |
| **PlayCanvas App 配置** | `new pc.Application(canvas, { mouse/touch/keyboard, componentSystems, resourceHandlers, preserveDrawingBuffer })` | **完全相同** |
| **相机** | `SimpleOrbitCamera` + `pc.Entity("camera")`, fov=60 | `SimpleOrbitCamera` + `pc.Entity("camera")`, fov=50 |
| **光照** | 环境光 `(0.3,0.3,0.3)` + 方向光 `intensity=1` | 环境光 `(0.3,0.3,0.3)` + 方向光 `intensity=0.8` |
| **渲染循环** | rAF loop → `orbit.updateFly(dt)` → dirty check → `app.render()` | rAF loop → `orbit.updateFly(dt)` → dirty check → `app.render()` |
| **尺寸适配** | ResizeObserver on container | ResizeObserver on container (`observeResize`) |
| **点云加载** | `useLasLoader.ts` (hook, 495行) | `PointCloudLoader.ts` (类, 314行) |
| **LAS 流式** | 按 File 或 filePath 读取，分块解压到 GPU | 按 filePath 读取，逻辑 ~95% 相同 |
| **LAZ WASM** | laz-perf WASM 解压 | laz-perf WASM 解压，**完全相同** |
| **地面检测** | Y 直方图推算地面 | **无** |
| **PLY 支持** | `loadPly()` via GSplat | **无** |
| **绘制渲染** | CabinetDrawing / ChargingAreaDrawing / DeviceAreaDrawing / PathDrawing (各自 hook + class) | `DrawingRenderer.ts` (统一类，只读) |
| **绘制交互** | 编辑模式：拖拽点、增删屏柜、绑定屏位等 | 只读：点击高亮选中 |
| **标签渲染** | 屏柜/充电区 HTML label overlay | 屏柜/充电区 HTML label overlay，**相似** |
| **ViewCube** | 有 | 无 |
| **侧边栏/树** | SidePanel + TreeView | 无 |
| **裁剪** | ClipController | 无 |
| **导出** | ExportModal | 无 |

## 结论

两个模块的 **3D 核心渲染层高度重合**（>90%），主要差异在于：
- 空间编辑多了**交互编辑能力**（drawing hooks 内部有大量编辑逻辑）
- 空间编辑多了**地面检测**、**PLY 支持**等增强功能
- 空间编辑的参数更精细（fov=60, intensity=1)

**以空间编辑为基准进行抽离是正确的方向。**

---

## 改造方案（5 步）

### Step 1: 抽离 `ThreeDEngine` 核心类

将 `usePlayCanvas.ts` 中的 PlayCanvas 初始化逻辑提取为纯类 `ThreeDEngine`，放到 `packages/app/src/components/three-d-engine/ThreeDEngine.ts`。

```
packages/app/src/components/three-d-engine/
├── ThreeDEngine.ts      # PlayCanvas 应用生命周期管理
├── index.ts             # 导出
```

**职责**：
- `new pc.Application(canvas, ...)` 配置
- 相机 / 光照创建
- `SimpleOrbitCamera` 绑定
- 按需渲染循环 (`autoRender=false`, rAF dirty check)
- ResizeObserver 尺寸适配
- `focusOn(center, extent)` 聚焦方法
- `requestRender()` / `destroy()` 生命周期

**输入参数**：
```ts
interface ThreeDEngineOptions {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  fov?: number;           // 默认 60
  clearColor?: pc.Color;  // 默认 (0.12,0.12,0.12)
  ambientColor?: pc.Color;
  lightIntensity?: number;
}
```

---

### Step 2: 抽离 `PointCloudLoader` 通用加载器

将 `useLasLoader.ts` 中的加载逻辑提取为纯类 `PointCloudLoader`，增强后放到 `packages/app/src/components/three-d-engine/PointCloudLoader.ts`。

**增强项**（融合两边的优点）：
- 保留空间编辑的**地面 Y 检测**（直方图法）
- 保留空间编辑的**局部坐标范围实测**（校验 header bbox）
- 保留空间编辑的 **PLY/GSplat 支持**
- 保留空间编辑的**实体内存管理**（entitiesRef Map）
- 提供进度回调、单文件/多文件加载、路径加载

**输入类型**：
```ts
interface LoadOptions {
  onProgress?: (pct: number) => void;
  filePath?: string;
}
// loadLas(file: File, options?): Promise<LoadedModel>
// loadLasFromPath(filePath: string): Promise<LoadedModel>
// loadPly(file: File): Promise<LoadedModel>
```

---

### Step 3: 抽离 `DrawingRenderer` 通用绘制器

将空间编辑的 drawing hooks 中**只读展示部分**提取为通用 `DrawingRenderer`，增强后替换现有的 `pointcloud-viewer/DrawingRenderer.ts`。

放到 `packages/app/src/components/three-d-engine/DrawingRenderer.ts`。

**职责**：
- 从 JSON 加载并渲染屏柜 / 充电区域 / 设备区域 / 路径
- 点击选中 / 高亮
- HTML 标签 overlay
- 不包含编辑交互（编辑能力由各 drawing hook 在空间编辑中自行附加）

---

### Step 4: 创建统一 React Hook `useThreeDViewer`

```ts
// packages/app/src/components/three-d-engine/useThreeDViewer.ts
export function useThreeDViewer(canvasRef, containerRef) {
  // 内部创建 ThreeDEngine + PointCloudLoader + DrawingRenderer
  // 返回 { loadLas, loadPly, loadDrawing, requestRender, focusOn, ... }
}
```

---

### Step 5: 改造两个使用方

#### 5a. 改造空间编辑 (`space-edit`)

```diff
- import { usePlayCanvas } from "./hooks/usePlayCanvas";
- import { useLasLoader } from "./hooks/useLasLoader";
+ import { useThreeDViewer } from "@/components/three-d-engine/useThreeDViewer";

  // useThreeDViewer 返回 appRef, orbitRef, entitiesRef, requestRender, loadLas, loadPly, loadLasFromPath
  // drawing hooks 仍然绑定到这些 ref 上继续工作
  // 保留空间编辑独有的 CabinetDrawing / ChargingAreaDrawing / DeviceAreaDrawing / PathDrawing
```

#### 5b. 改造勘察图片 (`image-edit`)

```diff
- import { usePointCloudViewer } from "@/components/pointcloud-viewer";
+ import { useThreeDViewer } from "@/components/three-d-engine/useThreeDViewer";

  // useThreeDViewer 提供完整的 3D 渲染 + 绘制回显
  // 删除旧的 pointcloud-viewer 目录
```

---

## 文件变更清单

| 操作 | 文件 |
|------|------|
| **新建** | `packages/app/src/components/three-d-engine/ThreeDEngine.ts` |
| **新建** | `packages/app/src/components/three-d-engine/PointCloudLoader.ts` |
| **新建** | `packages/app/src/components/three-d-engine/DrawingRenderer.ts` |
| **新建** | `packages/app/src/components/three-d-engine/useThreeDViewer.ts` |
| **新建** | `packages/app/src/components/three-d-engine/index.ts` |
| **修改** | `packages/app/src/views/space-edit/index.tsx` — 用 `useThreeDViewer` 替换 `usePlayCanvas` + `useLasLoader` |
| **修改** | `packages/app/src/views/space-edit/hooks/usePlayCanvas.ts` — 重构为基于 `ThreeDEngine` 的薄包装(或直接删除) |
| **修改** | `packages/app/src/views/space-edit/hooks/useLasLoader.ts` — 重构为基于 `PointCloudLoader` 的薄包装(或直接删除) |
| **修改** | `packages/app/src/views/image-edit/index.tsx` — 用 `useThreeDViewer` 替换 `usePointCloudViewer` |
| **删除** | `packages/app/src/components/pointcloud-viewer/` 整个目录(5个文件) |

---

## 风险与注意

1. **空间编辑的 drawing hooks 高度耦合**：`usePlayCanvas` 传入了 `setupCabinetDrawing` 等回调进行初始化，`useLasLoader` 传入了大量 setState 用于 loading UI。抽离时需保持接口兼容。

2. **地面检测**：空间编辑通过 Y 直方图推算地面，存入 `modelGroundYRef`。勘察图片此前无此能力，统一后会受益。

3. **blendType 差异**：空间编辑 LAS 用 `BLEND_NONE`，image-edit 用 `BLEND_NORMAL`。统一到 `BLEND_NONE`（空间编辑的做法，更合理）。

4. **uniqueName 差异**：空间编辑用 `"pointcloud"`，image-edit 用 `"pc"`。统一到 `"pointcloud"`。

5. **标签颜色**：空间编辑屏柜标签颜色在 drawing hooks 中定义，抽取 DrawingRenderer 时需保持可配置。
