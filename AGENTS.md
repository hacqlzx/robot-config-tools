# robotConfigTools Agent 快速接手指南

生成时间：2026-07-06

这份文档给后续 agent 快速理解当前项目现状。内容来自现有源码结构，不等同于早期规划稿。

## 项目概览

这是一个 pnpm workspace，主体是 Electron + React + Vite 的机器人配置工具。核心能力包括项目目录管理、本地点表数据库、LAS/LAZ/PLY 点云加载、空间模型编辑、勘察图像联动、后台配置、导入导出。

- `packages/app`：React 18、Ant Design 6、PlayCanvas、Electron 应用。
- `packages/database`：sql.js 本地数据库层，提供迁移、Repository、类型和点表导入服务。

常用命令：`pnpm dev`、`pnpm dev:electron`、`pnpm build`、`pnpm build:electron`、`pnpm package`。

很多文件、项目、数据库能力依赖 `window.electronAPI`，只在 Electron 模式完整可用。浏览器模式更适合看纯 UI 和前端逻辑。

## 目录速查

- `packages/app/src/router/index.tsx`：HashRouter 路由，默认进入 `space-edit`。
- `packages/app/src/App.tsx`：全局 Ant Design 外壳、顶部栏、页面 Outlet。
- `packages/app/src/pages/app-header`：顶部菜单、项目选择、机器人选择、后台连接、窗口控制。
- `packages/app/src/pages/backend-modal`：后台 IP 保存和 ping 连接。
- `packages/app/src/api/config.js`：后台接口封装。
- `packages/app/src/services/http.ts`：axios 实例，动态读取当前后台 IP，baseURL 为 `https://{ip}`。
- `packages/app/electron`：主进程、preload、数据库 IPC、空间模型导出。
- `packages/app/src/views`：业务页面。
- `packages/app/src/playcanvas-core`：底层点云、相机、渲染、LAS/LAZ 读取能力。
- `packages/app/src/components/three-d-engine`：抽离后的通用 3D 查看器。
- `packages/database/src`：数据库核心、迁移、Repository、导入服务。
- `project`：运行时项目目录，开发时 Electron 使用这里。
- `data`：运行时数据库目录，开发时默认保存 `robot-config.db`。
- `docs`、`doc`：已有设计/计划/联调资料，部分是早期规划，和当前实现可能不完全一致。
- `scripts`、`output`：临时数据转换脚本和产物。
- `demo`：点云 demo 资源。

`project`、`data`、`doc` 已在 `.gitignore` 中，改这些目录前先确认任务确实需要。

## 当前页面

路由入口在 `packages/app/src/router/index.tsx`：

- `/space-edit`：核心空间编辑页。
- `/image-edit`：勘察图片标注页。
- `/device-verify`：设备验证图，目前是占位。
- `/import-export`：导入导出页，部分能力已接后台。
- `/config`：运维配置页，包含厂站、机器人、地图、平台、网络。

顶部菜单配置在 `packages/app/src/config/menu.ts`。用 PowerShell 读中文文件时请加 `-Encoding UTF8`，否则可能显示乱码。

## Electron 边界

主进程入口是 `packages/app/electron/main.ts`，preload 是 `packages/app/electron/preload.cjs`。

主进程职责：

- 创建无边框窗口，注册 GPU 启动参数。
- 开发环境加载 Vite dev server，生产加载 `dist/index.html`。
- IPC 管理项目目录：列表、新增、重命名、删除、导入模型、目录树、写文件、删除路径、重命名路径、打开目录、导出文件。
- IPC 提供大文件读取：`read-file-chunk`、`read-large-file`，供点云加载用。
- 初始化数据库 IPC。
- 导出空间模型 zip，包含地图目录和可选点表。
- 解压 zip 到指定目录。

渲染进程不要直接访问 Node/Electron API，应通过 `window.electronAPI`。开发环境项目根是 `project/`；打包后项目根是 exe 同级目录下的 `project/`。

## 本地数据库

数据库包在 `packages/database`。

- `core/connection.ts`：sql.js 初始化、`DbWrapper`、延迟自动保存。
- `core/migration.ts`：迁移执行和 `schema_version`。
- `migrations/*.ts`：当前迁移到 004。
- `repositories/*.repo.ts`：电压区、间隔、主设备、部件、点位、项目厂站绑定的 CRUD/upsert。
- `services/import.service.ts`：Excel 点表行导入，生成/复用各层级编码，并写入设备树和点位。
- `types/index.ts`：数据库实体和 DTO 类型。

主要表：`device_voltage`、`device_bay`、`device_main`、`device_component`、`device_point`、`project_station`、`schema_version`。

开发环境数据库默认在 `data/robot-config.db`。Repository 返回字段会从 snake_case 转为 camelCase。新增字段时同步检查迁移、类型、Repository、IPC 暴露和 `vite-env.d.ts`。

## 数据流

后台 HTTP：顶部设置连接后台 IP，`backendStore.ts` 存入 localStorage，`http.ts` 每次请求注入 `https://{ip}`，`api/config.js` 调具体接口。

点表导入：`space-edit` 选择 Excel，`utils/excel-parser.ts` 解析中文表头和枚举，原始 Excel 保存到 `project/{项目}/点表/{厂站}.xlsx`，再通过 `electronAPI.importPoints` 进入主进程，最终由 `@robot/database/services/import.service.ts` upsert 设备树和点位。首次导入会绑定项目和厂站，后续导入会校验厂站一致。

空间模型导出：`ExportModal` 选择点表/地图项和目标目录，主进程查询 `device_point`，调用 `exportSpaceZip`，zip 直接流式读取地图目录，点表在内存中生成 Excel。

## 空间编辑

入口：`packages/app/src/views/space-edit/index.tsx`。这是当前核心页面。

- `usePlayCanvas`：空间编辑专用 PlayCanvas 初始化。
- `useLasLoader`：LAS/LAZ/PLY 加载，支持超大点云降采样、RGB 位深检测、地面 Y 推算。
- `useFileOperations`：导入模型、从项目树加载模型、点表导入、可见性切换、裁切入口。
- `useClipSave`：裁切保存 LAS 时会保持原模型 floating-origin 对应的 header bbox 中心，仅扩展范围到包含裁切点；不要改成裁切结果自身的紧包围盒，否则重新加载后模型会被居中偏移，无法和原模型重合。
- `useSaveHandlers`：保存屏柜、充电区域、设备区、可行路径。
- `useCabinetDrawing`、`useChargingAreaDrawing`、`useDeviceAreaDrawing`、`usePathDrawing`：空间绘制交互。
- `SidePanel`：地图树、设备台账树、屏柜树、设备区树。
- `Toolbar`、`ViewCube`、`ClipController`、各类浮动编辑面板。

空间绘制持久化在 `hooks/drawing/drawing-storage.ts`：

- `充电区域、设备区、屏柜.json`：统一保存 `cabinet`、`charging-area`、`device-area`。
- `可行驶路径.json`：保存路径点和路径段。

典型文件结构：`project/{项目}/地图/{地图名}/{地图名}.las`，同目录下保存 `充电区域、设备区、屏柜.json` 和 `可行驶路径.json`。

空间编辑的绘制模式互斥，改动时要小心状态、保存和 `requestRender()`。

## 勘察图像

入口：`packages/app/src/views/image-edit/index.tsx`。

- 左侧设备区地图使用 `components/three-d-engine/useThreeDViewer` 加载 LAS/LAZ 和绘制 JSON。
- 中间画布是 `components/image-canvas/ImageCanvas.tsx`。
- 任务加载在 `views/image-edit/hooks/useTaskLoader.ts`，读取任务目录 JSON/JPG，并组装左右云台图像。
- 右侧点表按间隔筛点位，显示标定状态。
- `SurveyImageLoad` 负责选择地图或任务数据。

这个区域仍在开发中。开始改之前先看 git 状态，当前已有本地改动可能在 `ImageCanvas.tsx` 和 `useTaskLoader.ts`。

## 通用 3D 引擎

目录：`packages/app/src/components/three-d-engine`。

- `ThreeDEngine.ts`：PlayCanvas Application、相机、光照、按需渲染、ResizeObserver 生命周期。
- `PointCloudLoader.ts`：LAS/LAZ/PLY 加载器，含 LAZ WASM 解压和 GPU buffer 上传。
- `DrawingRenderer.ts`：只读回显绘制 JSON，支持屏柜、设备区、充电区、路径，带点击高亮和标签。
- `useThreeDViewer.ts`：React Hook，组合 engine、loader、drawing。

`space-edit` 目前仍保留自己更完整的编辑型 `usePlayCanvas` 和 `useLasLoader`。通用引擎主要服务 `image-edit` 等只读/轻编辑场景。`docs/plan-3d-viewer-refactor.md` 记录了统一抽离计划。

## 配置和导入导出

`views/config`：`station` 厂站，`robot` 机器人，`map` 地图，`platform` 后台/分析/上级主机，`network` 网络。它们主要走 `api/config.js`，并通过 `backendStore.subscribe()` 在 IP 切换后刷新。

`views/import-export` 中点表导入、通信导入、空间模型导出、模板下载已有接线，其他卡片多为占位提示。`screen-verify` 和 `device-verify` 当前只是占位。

## 静态资源和 WASM

- `packages/app/public/static/lib/laz-perf`：LAZ 解压 WASM。
- `packages/app/public/static/lib/webp`、`lodepng`：图像相关 WASM。
- `packages/app/public/supersplate`：预构建的 supersplat 资源和模型。

`vite.config.ts` 会把 `playcanvas` 指向 debug/release 版源码，并把 `laz-perf` 指到 web 版本。Electron 构建时 `base` 为 `./`，浏览器模式为 `/`。

## 修改注意事项

- 不要随手重构 `space-edit`，它的状态、绘制模式、保存、点云加载高度耦合。
- 涉及项目文件读写时走 `window.electronAPI.project.*`，并注意主进程已有项目根越界保护。
- 涉及数据库时同步更新迁移、类型、Repository、IPC 暴露和 `vite-env.d.ts`。
- 点表字段和枚举有两套方向：导入在 `excel-parser.ts`，导出在 `export-points.ts` 和 `electron/export-points.ts`。
- 当前没有专门的 lint/test 脚本。提交前至少跑 `pnpm build` 或与改动相关的构建命令。
- 开发服务器默认端口是 `50050`。
- `project` 和 `data` 是运行时目录，可能很大，也可能被忽略；不要把样例数据当成必须提交的源码改动。

## 当前本地状态提醒

截至 2026-07-06，本说明更新时仅发现 `packages/app/src/views/space-edit/hooks/useClipSave.ts` 存在待提交代码改动，内容是修正裁切 LAS 重新加载后的空间对齐问题。提交或继续改动前仍应先看 `git status --short`，不要无意覆盖用户本地改动。
