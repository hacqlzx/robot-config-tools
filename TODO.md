# robotConfigTools 客户端优化 TODO

生成时间：2026-07-06

最近复核：2026-07-13

状态说明：`✅` 已完成，`🟡` 部分完成，`⬜` 未完成。状态按当前源码核对，不代表已做完整 Electron 端到端回归。

## 2026-07-13 复核摘要

- ✅ Electron 主进程已拆为 `app/*`、`ipc/*`、`project-core/*`，项目文件读写已有项目根越界保护。
- 🟡 `project.manifest.json` 已落地，地图和点表会维护清单；勘察任务登记、旧项目资产扫描和健康面板未完成。
- ✅ 空间编辑已拆出布局、场景、绘制模式、保存、裁切完成、撤销/恢复等组件和 hooks，并复用公共 `ThreeDEngine`/`PointCloudLoader`。
- ✅ 空间区域和路径已切换到机器人协议：`description_file.json`、`reference_path.txt`，兼容读取 `path.json` 和停靠点文件。
- ✅ 勘察数据按地图导入/导出、图像标识导入/导出、标定串行保存队列和视口缩略图加载已接入。
- ✅ 项目、机器人、后台 IP 和连接状态已收敛到 `appContextStore`，业务页面不再直接读写对应 localStorage key，也不再回退到默认项目。
- ✅ 项目重命名/删除已同步目录、清单和数据库六张项目关联表，删除前会展示数据库影响数量。
- ⬜ Electron 网络/证书安全、LAZ worker/取消、LOD、typecheck/lint/回归脚本仍未完成。

## 原则

- 先优化客户端操作链路、工程数据模型、目录管理和大文件处理；三维换引擎放到最后做验证。
- `project/` 和 `data/` 是运行时目录，不作为源码任务处理。
- `doc/*.java` 和 `doc/导入逻辑总结.md` 保留，后续点表导入逻辑还会参考。
- 优先保证 Electron 客户端闭环，浏览器模式只作为 UI/前端逻辑调试入口。

## P0：客户端工作上下文和稳定性

### 1. ✅ 建立统一 AppContext

目标：项目、机器人、后台 IP、连接状态不要再由页面散读 `localStorage`。

涉及文件：
- `packages/app/src/pages/app-header/index.tsx`
- `packages/app/src/stores/appContextStore.ts`
- `packages/app/src/components/DeviceTree.tsx`
- `packages/app/src/views/space-edit/**`
- `packages/app/src/views/image-edit/**`
- `packages/app/src/views/import-export/index.tsx`

已完成：
- `selectedProject`、`selectedRobot`、`backendIp`、`connectionStatus` 收敛到一个外部 store，通过 `useSyncExternalStore` 提供 React hooks。
- store 兼容原有 localStorage key，并统一负责持久化；业务页面已移除对应 key 的直接读写。
- 项目切换通过 `App.tsx` 的 Outlet key 重建当前业务页，地图树、设备树、点表和勘察状态随项目刷新。
- 后台连接成功时原子更新 IP、状态和版本；IP 改变会清空旧机器人选择，配置页只订阅后台相关变化。
- 未选择项目时，空间模型、点表、勘察任务和 Electron 下载明确阻断，不再写入 `"默认项目"` 或 `"default"`。

验收：
- 顶部切换项目后，不刷新应用也能看到设备树和地图树同步变化。
- 清空项目选择后，各页面不再使用 `"默认项目"` 或 `"default"` 静默写文件。

### 2. ✅ 项目重命名/删除同步数据库

目标：项目目录生命周期与数据库中的项目关联数据保持一致。

涉及文件：
- `packages/app/electron/project-core/project-service.ts`
- `packages/app/electron/ipc/project-ipc.ts`
- `packages/app/electron/preload.cjs`
- `packages/app/src/pages/app-header/index.tsx`
- `packages/database/src/services/project-lifecycle.service.ts`

已完成：
- 数据库侧集中提供项目数据统计、重命名和删除服务，同步处理：
  - `project_station.project_name`
  - `device_voltage.project_name`
  - `device_bay.project_name`
  - `device_main.project_name`
  - `device_component.project_name`
  - `device_point.project_name`
- 重命名同步更新目录、项目清单和数据库；目标名称存在数据库残留时阻断，失败时尝试回滚目录、清单和数据库。
- 删除确认后直接清理数据库关联数据并递归删除原项目目录，不创建临时隔离目录；遇到 Windows 只读文件会清除只读属性后立即重试，仍失败时明确报错。
- 删除策略固定为同时删除目录和数据库关联数据；顶部项目管理二次确认弹窗会明确影响范围并显示六类记录数量。

验收：
- 项目重命名后，点表、设备树、勘察标定仍可查询。
- 删除项目后，数据库中该项目相关记录不残留，或明确标记为保留。

### 3. 🟡 统一模型文件格式和命名协议

现状：客户端导入入口只支持 LAS/LAZ/ZIP；项目内模型统一命名为 `map.las`。加载器根据 LAS header 压缩位识别 LAZ，因此能够解压，但清单 `ext` 和导出文件名会把源 LAZ 表现为 LAS。PLY 只保留在 demo/历史加载代码，不属于当前业务导入协议。

涉及文件：
- `packages/app/electron/project-core/project-service.ts`
- `packages/app/electron/project-core/project-manifest.ts`
- `packages/app/src/views/space-edit/hooks/useFileOperations.ts`
- `packages/app/src/views/space-edit/components/TreeView.tsx`

具体任务：
- 明确选择“项目内永远规范为未压缩 `map.las`”或“保留 `map.laz`”，并让内容、扩展名、manifest `ext` 一致。
- 同名地图导入时提示覆盖/重命名/取消，避免静默覆盖。
- 空间模型 ZIP 当前会直接覆盖同名地图，也需要一致的冲突策略。

验收：
- 导入 `.las`、`.laz` 后，项目文件内容、扩展名和 manifest 元数据一致。
- 从地图树再次加载时，走对应加载逻辑。

### 4. 🟡 加强 Electron 文件和网络边界

涉及文件：
- `packages/app/electron/app/app-lifecycle.ts`
- `packages/app/electron/app/create-window.ts`
- `packages/app/electron/ipc/system-ipc.ts`
- `packages/app/electron/project-core/project-paths.ts`
- `packages/app/electron/preload.cjs`
- `packages/app/src/vite-env.d.ts`

具体任务：
- ✅ `project:write-file`、`project:export-file`、删除、重命名和打开目录已统一走项目根校验。
- `ping` 不再拼 shell 字符串；至少先限制 IP 格式，再执行。
- 生产环境不要无条件放行证书错误；自签名证书需要可配置策略。
- 评估 `webSecurity: false` 是否必须，能收则收。

验收：
- 任何 `../` 或绝对路径写入都不能越过项目根。
- 后台 IP 输入非法字符时不会传入 shell。

### 5. ⬜ 清理调试输出

涉及文件：
- `packages/app/src/pages/app-header/index.tsx`
- `packages/app/src/components/image-canvas/ImageCanvas.tsx`
- `packages/app/electron/main.ts`
- `packages/app/src/views/image-edit/hooks/useTaskLoader.ts`
- `packages/app/src/views/space-edit/hooks/useClipSave.ts`

具体任务：
- 高频渲染日志必须删除或挂到开发调试开关下。
- Electron 主进程日志保留关键错误和导入/导出进度，不打印过多内部状态。

验收：
- 正常操作 5 分钟，控制台不会被重复绘制日志刷屏。

## P1：项目目录和 Manifest

### 1. 🟡 完善项目 manifest

目标：不要只靠中文目录名和文件扫描推断项目状态。

新增文件格式：
- `project/{项目}/project.manifest.json`

当前结构（精简示例）：

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "uuid",
    "name": "项目名",
    "createdAt": "2026-07-13T00:00:00.000Z",
    "updatedAt": "2026-07-13T00:00:00.000Z"
  },
  "layout": {
    "version": 1,
    "dirs": {
      "maps": "地图",
      "pointTables": "点表",
      "surveyImages": "勘察数据"
    }
  },
  "assets": {
    "maps": [],
    "pointTables": [],
    "surveyTasks": []
  }
}
```

已完成：
- 项目创建/列举时生成或修复 manifest。
- 导入地图、写入点表、删除/重命名项目资产时更新 manifest。
- 项目重命名时更新 `project.name`。

剩余任务：
- 导入/删除勘察数据时维护 `assets.surveyTasks`。
- 对旧项目扫描 `地图/`、`点表/`、`勘察数据/` 并回填资产；当前缺少清单时只会生成空资产列表。
- 评估厂站绑定、地图缓存状态等是否进入 manifest，避免同时维护不一致的数据源。

验收：
- 启动后项目列表可以显示：是否有地图、是否有点表、是否有勘察任务、厂站绑定状态。

### 2. ⬜ 项目健康状态面板

涉及文件：
- `packages/app/src/pages/app-header/index.tsx`
- 新增 `packages/app/src/components/ProjectHealthPanel.tsx`

具体任务：
- 顶部项目选择旁增加状态入口。
- 展示：
  - 当前项目路径
  - 厂站绑定
  - 点表数量和最近导入时间
  - 地图数量和缓存状态
  - 勘察任务数量
  - 是否存在未保存绘制

验收：
- 新用户打开项目后，能明确知道下一步应该导入点表还是导入地图。

## P2：点云大文件加载优化

### 1. ⬜ 加性能埋点

涉及文件：
- `packages/app/src/components/three-d-engine/PointCloudLoader.ts`
- `packages/app/src/views/space-edit/hooks/useLasLoader.ts`
- `packages/app/electron/main.ts`

具体任务：
- 记录并输出结构化性能数据：
  - 文件大小
  - LAS 版本和点格式
  - 总点数/加载点数
  - 读取头耗时
  - 读取点数据耗时
  - LAZ 解压耗时
  - GPU buffer 创建耗时
  - 首帧耗时
  - 错误原因
- 先写入开发日志，后续可落到 `userData/logs/pointcloud-load.jsonl`。

验收：
- 任意加载一个地图后，可以得到完整耗时分段，不再靠主观感觉判断慢在哪里。

### 2. ⬜ 导入阶段生成点云缓存

现状：每次打开都重新解析原始 LAS/LAZ。

建议目录：

```text
地图/{地图名}/
  原始文件.las
  cache/
    metadata.json
    preview.bin
    lod-0.bin
    lod-1.bin
```

具体任务：
- 导入地图时先复制原始文件，再生成低精预览缓存。
- 打开地图时先加载 `preview.bin`，再按需加载更高精度。
- 缓存 metadata 记录原始 bbox、坐标变换、点数、颜色格式。
- 首版可以只做一个 preview 缓存，不必一次实现完整 LOD。

验收：
- 第二次打开同一地图不再完整扫描原始 LAS。
- 超大文件先快速出现低精预览。

### 3. ⬜ LAZ 解压改成后台任务

涉及文件：
- `packages/app/src/components/three-d-engine/PointCloudLoader.ts`
- 新增 worker 或 Electron 主进程任务模块

具体任务：
- 避免 `readLargeFile` 把 LAZ 整文件塞进渲染进程。
- 解压和抽样放到 Worker/主进程，渲染进程只接收可渲染块。
- 增加任务取消：用户切换地图、关闭页面、重新导入时能取消旧任务。

验收：
- 加载 LAZ 大文件时 UI 仍可操作，取消后不继续占内存。

### 4. ⬜ 分块/LOD 渲染

具体任务：
- 按空间块生成点云块，而不是一个地图一个巨大 VertexBuffer。
- 先按距离或固定层级选择块，后续再做视锥裁剪。
- 保留当前 floating-origin 策略，避免坐标精度问题。

验收：
- 3000 万点以上地图不再一次性创建单个巨大 GPU buffer。

## P3：空间编辑代码整理

### 1. 🟡 继续拆分页面控制器

现状：已拆出 `SpaceEditLayout`、`SpaceEditScene`、`SceneViewport`、`DrawingEditPanels`、`useDrawingModeToggles`、`useMapDrawingVisibility`、`useClipCompletion`、`useDrawingHistory` 等；`index.tsx` 仍约 400 行，并承担大量状态编排。

建议拆分：
- `useSpaceProjectContext`
- `useMapSceneController`
- `useDrawingModeController`
- `useDrawingPersistence`
- `useClipController`

验收：
- `index.tsx` 主要保留 UI 编排，业务流程进入 hook/controller。

### 2. 🟡 完善保存状态

已完成：手动保存状态徽标、保存全部和 30 秒轻量 JSON 自动保存已接入。设备区内部有 dirty 标记。

剩余任务：
- 建立屏柜、设备区、充电区、路径统一 dirty 状态，只保存变化项。
- 自动保存改为可配置，并避免并发保存重入。
- 离开页面、切换项目/地图前提示未保存。

验收：
- 用户知道当前是否已保存。
- 切换地图不会静默丢绘制。

### 3. ⬜ 裁切任务后台化

涉及文件：
- `packages/app/src/views/space-edit/hooks/useClipSave.ts`
- `packages/app/src/views/space-edit/components/ClipController.tsx`

具体任务：
- 裁切计数和写出从 UI 线程移走。
- 进度包含：扫描、写出、保存、重新加载。
- 支持取消。
- 保持当前 header bbox 中心策略，不要改回裁切紧包围盒。

验收：
- 裁切大文件时 UI 不冻结。
- 裁切后重新加载仍与原模型对齐。

## P4：勘察图像优化

### 1. 🟡 完善图片任务懒加载

现状：`useTaskLoader` 一次性读取任务配置并建立图像索引，只探测首张图片尺寸；`ImageCanvas` 已按视口加载并缓存缩略图，双击时再读取全图。

涉及文件：
- `packages/app/src/views/image-edit/hooks/useTaskLoader.ts`
- `packages/app/src/components/image-canvas/ImageCanvas.tsx`

具体任务：
- ✅ 先读取 `json_list.json` 和各 SP JSON，生成图片索引。
- ✅ 只加载当前可视区域附近图片。
- ✅ 缩略图使用最多 180 项的内存 LRU 和 3 路并发加载队列。
- ✅ 图片解码后及时释放对象 URL。
- 为任务配置索引增加取消/代次保护，评估超大任务的磁盘缓存。

验收：
- 大任务打开速度不随图片总数线性变慢。
- 左右云台切换不重新读取全部文件。

### 2. 🟡 标定保存队列

涉及文件：
- `packages/app/src/views/image-edit/components/CalibrationView.tsx`

已完成：500ms 防抖后进入单飞串行保存队列，连续编辑会排队重跑；页面显示待保存、保存中、已保存、失败状态，并按地图合并项目级 `勘察数据.json`。

剩余任务：增加显式重试按钮，并把路径/合并逻辑从 `CalibrationView.tsx` 继续抽离。

验收：
- 快速框选/绑定/解绑时不会丢数据。
- 保存失败有提示，并能重试。

## P5：导入导出和后台配置

### 1. 🟡 导入导出分清本地和后台

现状：`import-export` 同时走后台下载和本地项目临时文件，状态容易混。

涉及文件：
- `packages/app/src/views/import-export/index.tsx`
- `packages/app/src/api/config.js`
- `packages/app/src/services/http.ts`

具体任务：
- UI 区分：
  - 本地项目导入/导出
  - 后台机器人导入/导出
- 下载文件不要先写入项目 `_temp` 再导出；应提供主进程下载到目标目录接口，或直接浏览器下载。
- 后台未连接时禁用后台导入导出按钮。

验收：
- 用户能明确知道导入导出对象是当前项目还是后台机器人。

### 2. ⬜ 后台连接状态标准化

具体任务：
- HTTP 请求失败时更新连接状态。
- 顶部连接状态显示 IP、连接时间、最后错误。
- IP 切换后清理旧机器人缓存或标记缓存来源。

验收：
- 后台断开后配置页不会只显示泛化的“获取失败”。

## P6：工程质量

### 1. ⬜ 增加基础质量命令

涉及文件：
- `package.json`
- `packages/app/package.json`
- `packages/database/package.json`

具体任务：
- 增加 `typecheck`。
- 增加最小 lint 配置。
- 增加关键脚本：
  - `pnpm typecheck`
  - `pnpm build`
  - `pnpm build:electron`

验收：
- 每次改动至少能跑类型检查和相关构建。

### 2. ⬜ 增加低成本回归脚本

具体任务：
- 点表导入样例校验。
- 项目重命名后数据库查询校验。
- 地图导入扩展名校验。
- 导出 zip 内容结构校验。

验收：
- 客户端核心链路有脚本可快速验证。

## 暂不做

- 暂不直接替换 PlayCanvas。
- 暂不重写整个 `space-edit`。
- 暂不引入复杂状态管理框架，先用轻量 store 收敛上下文。
- 暂不删除 `project/`、`data/`、`doc/联调/` 运行或联调数据。

## 三维引擎替换评估条件

只有完成 P2 前三项后，再做引擎 A/B 验证。

候选方向：
- 继续 PlayCanvas：成本最低，适合保留现有绘制和裁切。
- Potree/PotreeConverter：适合超大点云浏览，需评估编辑、裁切、离线打包改造成本。
- Three.js：生态强，但仍需要自研或接入分块 LOD。
- Cesium/3D Tiles：适合地理空间大范围场景，当前厂站局部编辑场景可能偏重。

评估指标：
- 首帧时间
- 大文件内存峰值
- 交互帧率
- 裁切/拾取/绘制实现成本
- 离线部署和打包复杂度
