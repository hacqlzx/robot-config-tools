# robotConfigTools Agent 快速接手指南

更新时间：2026-09-24

这份文档给后续 agent 快速理解当前项目现状。内容来自现有源码结构，不等同于早期规划稿。

## 项目概览

这是一个 pnpm workspace，主体是 Electron + React + Vite 的机器人配置工具。核心能力包括项目目录管理、本地点表数据库、LAS/LAZ 点云加载、空间模型编辑、勘察图像标定、后台配置、导入导出。

- `packages/app`：React 18、Ant Design 6、PlayCanvas、Electron 应用。
- `packages/database`：sql.js 本地数据库层，提供迁移、Repository、类型和点表导入服务。

常用命令：`pnpm dev`、`pnpm dev:electron`、`pnpm build`、`pnpm build:electron`、`pnpm package`。

`pnpm package` 会交互选择版本号（默认末位加 1），无交互打包用 `--auto` 或 `--version 1.1.0`。代理日常校验使用 `pnpm build`、`pnpm build:electron` 或 `pnpm package:check`，这些入口不修改版本号；仅用户明确要求生成正式安装包时执行 `pnpm package`。完整说明见 `PACKAGING.md`。

很多文件、项目、数据库能力依赖 `window.electronAPI`，只在 Electron 模式完整可用。浏览器模式更适合看纯 UI 和前端逻辑。

## 目录速查

- `packages/app/src/router/index.tsx`：HashRouter 路由，默认进入 `space-edit`。
- `packages/app/src/App.tsx`：全局 Ant Design 外壳、顶部栏、页面 Outlet。
- `packages/app/src/pages/app-header`：顶部菜单、项目选择、机器人选择、设置入口、窗口控制。
- `packages/app/src/pages/settings-modal`：统一设置弹窗，左侧设置菜单、右侧功能内容；目前仅接入后台连接。
- `packages/app/src/pages/backend-modal`：可嵌入设置弹窗的后台 IP 保存和 ping 连接面板。
- `packages/app/src/api/config.js`：后台接口封装。
- `packages/app/src/services/http.ts`：axios 实例，动态读取当前后台 IP，baseURL 为 `https://{ip}`。
- `packages/app/src/stores/appContextStore.ts`：统一管理并持久化当前项目、机器人、后台 IP 和连接状态，React 侧通过 `useSyncExternalStore` 订阅。
- `packages/app/electron`：主进程、preload、数据库 IPC、项目清单、空间模型及勘察数据归档。
- `packages/app/src/views`：业务页面。
- `packages/app/src/playcanvas-core`：底层点云、相机、渲染、LAS/LAZ 读取能力。
- `packages/app/src/components/three-d-engine`：抽离后的通用 3D 查看器。
- `packages/database/src`：数据库核心、迁移、Repository、导入服务。
- `project`：运行时项目目录，开发环境未配置数据根时默认使用这里；当前未写入 `.gitignore`，不要误提交现场项目数据。
- `data`：运行时数据库目录，开发时默认保存 `robot-config.db`。
- `CHANGELOG.md`：每次 Git 提交必须同步更新的优化/修改日志，新记录写在最上方。
- `docs`、`doc`：联调样例、Java 参考实现和数据协议资料；两者均在 `.gitignore` 中，但已有部分历史文件被 Git 跟踪。
- `scripts`、`output`：临时数据转换脚本和产物。
- `demo`：点云 demo 资源。

`data`、`doc`、`docs` 已在 `.gitignore` 中；`project` 当前未忽略。改这些目录前先确认任务确实需要，已跟踪的 `doc` 历史文件仍会显示修改，不要把联调资料误当成运行时产物删除。

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
- `app/*` 管理应用生命周期、窗口和 GPU 参数，`ipc/*` 按系统、文件、项目、归档拆分 IPC，`project-core/*` 管理项目根、目录安全、清单和文件服务。
- IPC 管理项目目录：列表、新增、重命名、删除、LAS/LAZ 或空间模型 ZIP 导入、目录树、写文件、删除/重命名路径、打开目录、导出文件。项目重命名和删除会同步处理数据库中的项目关联数据。
- IPC 提供大文件读取：`read-file-chunk`、`read-large-file`，供点云加载用。
- 初始化数据库 IPC。
- 导出空间模型 ZIP，外层包含可选点表和 `地图/*.zip` 单地图包；导入时仅接受单地图空间模型包。
- 导入/导出勘察数据和图像标识 ZIP，并在客户端标定格式与机器人 `calib_device` 格式间转换。
- 维护项目数据根路径；开发环境默认使用仓库 `project/`，打包后可由用户选择并持久化到 `userData/data-path.json`。

渲染进程不要直接访问 Node/Electron API，应通过 `window.electronAPI`。主进程文件边界已有项目根校验，但当前仍存在待处理的安全项：`ping` 使用拼接 shell 命令、窗口启用 `webSecurity: false`，证书错误也会无条件放行。

## 本地数据库

数据库包在 `packages/database`。

- `core/connection.ts`：sql.js 初始化、`DbWrapper`、延迟自动保存。
- `core/migration.ts`：迁移执行和 `schema_version`。
- `migrations/*.ts`：当前迁移到 005。
- `repositories/*.repo.ts`：电压区、间隔、主设备、部件、点位、项目厂站绑定的 CRUD/upsert。
- `services/import.service.ts`：Excel 点表行导入，生成/复用各层级编码，并写入设备树和点位。
- `services/project-lifecycle.service.ts`：统计、重命名和删除六张表中的项目关联数据。
- `types/index.ts`：数据库实体和 DTO 类型。

主要表：`device_voltage`、`device_bay`、`device_main`、`device_component`、`device_point`、`project_station`、`schema_version`。

开发环境数据库默认在 `data/robot-config.db`。Repository 返回字段会从 snake_case 转为 camelCase。新增字段时同步检查迁移、类型、Repository、IPC 暴露和 `vite-env.d.ts`。

## 数据流

应用上下文：`appContextStore.ts` 兼容读取原有 localStorage key，统一暴露项目、机器人、后台 IP、连接状态及 setter/hooks。项目切换时 `App.tsx` 通过 Outlet key 重建业务页，清理旧项目的地图、绘制和列表状态；切换后台会原子更新 IP/状态并清空旧机器人选择。

后台 HTTP：顶部设置连接后台 IP，`http.ts` 每次请求从 `appContextStore` 读取当前 IP 并注入 `https://{ip}`，`api/config.js` 调具体接口。

点表导入：`space-edit` 选择 Excel，`utils/excel-parser.ts` 解析中文表头、层级空行和枚举，原始 Excel 保存到 `project/{项目}/点表/{厂站}.xlsx`，再通过 `electronAPI.importPoints` 进入主进程，最终由 `@robot/database/services/import.service.ts` upsert 设备树和点位。首次导入会绑定项目和厂站，后续导入会校验厂站一致；点位编码和同部件下点位名称会做重复校验。

空间模型导出：`ExportModal` 选择点表/地图项和目标目录，主进程查询各设备层级，调用 `exportSpaceZip`；点表先生成包含 Excel 与 `extend.json` 的独立 ZIP，每张地图也生成单独 ZIP，再一并写入外层导出包。`extend.json` 固定输出点位编码、标定 ID、巡检 ID、主设备编码和区域 ID，并补齐未关联点位的柜排/屏柜记录；点表是项目级全量数据，区域映射始终扫描项目下全部地图，不受本次地图勾选状态影响。

项目清单：每个项目根目录维护 `project.manifest.json`，记录布局以及地图、点表、勘察任务资产。项目创建、列举、重命名和项目文件写入会维护清单；目前勘察任务尚未写入 `surveyTasks`，旧项目缺少清单时也只会创建空清单，不会完整扫描回填资产。

## 空间编辑

入口：`packages/app/src/views/space-edit/index.tsx`。这是当前核心页面。

- `usePlayCanvas`：空间编辑专用 PlayCanvas 初始化。
- `useLasLoader`：复用通用 `PointCloudLoader` 加载 LAS/LAZ，支持超大点云降采样、RGB 位深检测、floating origin 和地面 Y 推算。PLY 只保留在历史/demo 加载代码中，不属于当前客户端导入链路。
- `useFileOperations`：导入 LAS/LAZ 或单地图空间模型 ZIP、从项目树加载模型、点表导入、可见性切换、裁切入口。
- `useClipSave`：裁切保存 LAS 时会保持原模型 floating-origin 对应的 header bbox 中心，仅扩展范围到包含裁切点；不要改成裁切结果自身的紧包围盒，否则重新加载后模型会被居中偏移，无法和原模型重合。
- `useSaveHandlers`：保存屏柜、充电区域、设备区、可行路径，提供手动保存状态和 30 秒自动保存。
- `useCabinetDrawing`、`useChargingAreaDrawing`、`useDeviceAreaDrawing`、`usePathDrawing`：空间绘制交互。
- `hooks/drawing/drawing-schema.ts`：空间绘制、路径和机器人区域协议的纯类型/常量；`drawing-coordinate-transform.ts` 负责 LAS/scene 纯坐标转换，`area-codec.ts` 负责区域协议和几何双向转换，`path-codec.ts` 负责参考路径、机器人路径和停靠点的纯编解码与拓扑校验。
- `hooks/drawing/drawing-storage.ts`：现有绘制持久化兼容入口，目前保留文件 IO、坐标转换编排和屏柜数据库同步，后续继续拆分 repository 和屏柜设备同步。
- `useDrawingHistory`：统一撤销/恢复入口，工具栏和 `Ctrl+Z`、`Ctrl+Shift+Z`/`Ctrl+Y` 已接入。
- `SidePanel`：地图树、设备台账树、屏柜树、设备区树。
- `Toolbar`、`ViewCube`、`ClipController`、各类浮动编辑面板。

空间绘制持久化在 `hooks/drawing/drawing-storage.ts`，保存时会在 PlayCanvas 场景坐标和 LAS 全局坐标之间转换：

- `description_file.json`：机器人区域协议的 flat 数组，`type=1/2/4/8` 分别表示柜排、屏柜、充电区域、设备区域，几何使用四点 `pose` 字符串；可兼容读取旧版内部 `items` 格式。
- `reference_path.txt`：当前编辑器保存的单条连续示意路径，起点必须位于充电区域内。
- `path.json` + `stop_points.json`/`stop_point.json`：机器人路径协议，只读兼容并转换为场景路径回显。
- `map_info.json`：地图元信息；导入的模型在项目内规范为 `map.las`，即使源文件是 LAZ 也依靠 LAS header 压缩位识别。

典型文件结构：`project/{项目}/地图/{地图名}/map.las`，同目录下保存 `map_info.json`、`description_file.json` 和 `reference_path.txt`。

空间编辑的绘制模式互斥，改动时要小心状态、保存和 `requestRender()`。

## 勘察图像

入口：`packages/app/src/views/image-edit/index.tsx`。

- 左侧设备区地图使用 `components/three-d-engine/useThreeDViewer` 加载 LAS/LAZ 和绘制 JSON。
- 中间画布是 `components/image-canvas/ImageCanvas.tsx`。
- 任务加载在 `views/image-edit/hooks/useTaskLoader.ts`，读取任务目录 JSON/JPG，并组装左右云台图像。
- 右侧点表按间隔筛点位，显示标定状态。
- `SurveyImageLoad` 按地图导入勘察 ZIP 到 `勘察数据/{地图名}`，同地图导入采用全量覆盖，但保留项目级 `勘察数据/勘察数据.json` 标定结果。
- `SurveyImageExport` 导出所选地图勘察数据；`ImageLabelTransfer` 导入/导出机器人图像标识 ZIP，优先按 `point_code` 回绑点表。
- `CalibrationView` 使用串行保存队列和保存状态，避免连续编辑覆盖；点位绑定通过数据库序列分配全局递增且不复用的 `calibration_id`，解绑或删除标定框时清空；机器人图像标识导出的 `cp_id` 直接使用该值。`ImageCanvas` 按视口加载并缓存缩略图，双击时再读取全图。

这个区域仍在开发中。任务配置会一次性建立全部图像索引；缩略图使用最多 180 项的内存 LRU 和 3 路加载队列，对象 URL 会在解码后释放。超大任务的配置索引耗时、取消和磁盘缓存仍需继续验证。

## 通用 3D 引擎

目录：`packages/app/src/components/three-d-engine`。

- `ThreeDEngine.ts`：PlayCanvas Application、相机、光照、按需渲染、ResizeObserver 生命周期。
- `PointCloudLoader.ts`：客户端主链路的 LAS/LAZ 加载器，LAS 分块读取、LAZ 通过 WASM 整文件解压，并上传 GPU buffer；另保留未接当前导入 UI 的 PLY demo 方法。
- `DrawingRenderer.ts`：只读回显绘制 JSON，支持屏柜、设备区、充电区、路径，带点击高亮和标签。
- `useThreeDViewer.ts`：React Hook，组合 engine、loader、drawing。

`space-edit` 已复用 `ThreeDEngine` 和 `PointCloudLoader`，但仍由 `usePlayCanvas`、各绘制类和保存 hooks 组装编辑态；`image-edit` 使用 `useThreeDViewer` 作为只读/轻交互组合层。早期的 `docs/plan-3d-viewer-refactor.md` 已删除，不要继续引用。

## 配置和导入导出

`views/config`：`station` 厂站，`robot` 机器人，`map` 地图，`platform` 后台/分析/上级主机，`network` 网络。它们主要走 `api/config.js`，并通过 `subscribeBackendContext()` 在后台连接/IP 切换后刷新。

`views/import-export` 中点表导入、通信导入、空间模型导出、勘察图像导出、图像标识导入、设备验证图导出及点表/通信模板下载已接后台；空间模型导入、屏柜验证图、工程备份和日志等卡片仍是占位。`screen-verify` 目录未接路由，`device-verify` 路由仍是占位。

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
- 项目重命名会同步目录、`project.manifest.json` 和六张表的 `project_name`，任一步失败会尝试补偿回滚；项目删除默认同时删除目录、设备树、点位/标定关联和厂站绑定，UI 会在二次确认弹窗中展示关联记录数。确认删除后直接递归删除原项目目录，不创建临时隔离目录；遇到 Windows 只读文件会清除只读属性后立即重试。
- 不要在业务页面直接读写 `selectedProject`、`selectedRobot`、`backend_current_ip`；统一使用 `appContextStore` getter/setter 或 hooks。IP 历史和机器人列表缓存仍可使用各自独立的 localStorage key。
- 当前没有专门的 lint/test 脚本。提交前至少跑 `pnpm build` 或与改动相关的构建命令。
- 开发服务器默认端口是 `50050`。
- `project` 和 `data` 是运行时目录，可能很大，也可能被忽略；不要把样例数据当成必须提交的源码改动。

## 提交日志

根目录 `CHANGELOG.md` 是强制维护的提交日志，不是可选文档。

- 用户明确要求提交时，必须先在 `CHANGELOG.md` 最上方追加本条提交记录，再执行 `git commit`。
- 按功能模块分批提交，不要把工作区里所有改动一次提交完。先用 `git status` 和 `git diff` 按模块拆开，同一模块的代码、样式和对应日志进同一次提交；互不相关的功能、修复、样式调整各自单独提交。
- 用户说「提交」但工作区里有多个模块时，先按模块列出拆分方案再逐个提交，不要默认 `git add` 全部文件。
- 日志要写详细：改了什么、为什么改、优化点、影响范围、关键文件、用户可见变化、怎么验证。不要只写一句标题。
- 同时写「修改」和「优化」两节；纯修复也要写清修前现象和修后行为。
- Git 提交信息同样要详细：中文、带类型前缀，正文用条目列出关键改动，禁止只有 `feat: xxx` 这种笼统一句。
- 提交成功后立刻把 commit hash 回填到对应日志条目；未提交时写「待提交」。
- 不要把多次互不相关的改动混成一条日志；一次提交对应一条记录。
- `AGENTS.md` 只保留相对稳定的项目约定，单次改动细节只写进 `CHANGELOG.md`。

## 当前技术债入口

根目录 `TODO.md` 已按 2026-07-13 的实现复核，使用 `✅`、`🟡`、`⬜` 标记完成度。当前优先项是 Electron 网络/证书边界、点云后台任务与 LOD、基础 typecheck/lint/回归脚本。

每次接手仍先运行 `git status --short`，本说明不再记录容易失效的单次本地改动快照。
