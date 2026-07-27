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
- 🟡 源码模块化复核已完成，空间绘制 schema、区域 codec、路径 codec 两阶段拆分已落地；下一步继续拆分文件 repository 和屏柜设备同步。
- ⬜ Electron 网络/证书安全、LAZ worker/取消、LOD、typecheck/lint/回归脚本仍未完成。

## 原则

- 先优化客户端操作链路、工程数据模型、目录管理和大文件处理；三维换引擎放到最后做验证。
- `project/` 和 `data/` 是运行时目录，不作为源码任务处理。
- `doc/*.java` 和 `doc/导入逻辑总结.md` 保留，后续点表导入逻辑还会参考。
- 优先保证 Electron 客户端闭环，浏览器模式只作为 UI/前端逻辑调试入口。

## 当前重点：代码结构与组件化专项

复核时间：2026-07-13。

拆分原则：
- 不以行数作为唯一标准；优先处理同时承担 UI、状态、协议转换、文件 IO 或 IPC 注册的文件。
- 协议转换、坐标转换、点表导入等高风险逻辑先补样例/回归，再做文件移动，避免“拆完能编译但数据格式变了”。
- 页面组件只负责布局和交互编排；可复用业务流程进入 hooks/controllers，Electron/数据库访问进入 service/repository。
- 不为了“通用化”引入复杂 schema 引擎、全局状态框架或多层基类；相似行为稳定出现两到三处后再抽象。

### 1. 🟡 拆分空间绘制协议与持久化模块（最高优先级）

现状：`views/space-edit/hooks/drawing/drawing-storage.ts` 原约 1256 行，同时包含类型、机器人区域协议、坐标转换、屏柜分段、路径格式转换、Electron 文件 IO 和数据库清理。

第一阶段已完成：
- 新增 `drawing-schema.ts`，集中绘制对象、路径数据、机器人区域协议类型和文件/区域类型常量。
- 路径纯数据类型从 `PathDrawing.ts` 移入 schema，`PathDrawing.ts` 继续重新导出以兼容现有调用。
- 新增 `drawing-coordinate-transform.ts`，抽离顶点和路径的 LAS/scene 双向转换。
- 新增 `drawing-codec-utils.ts` 和 `area-codec.ts`，抽离 pose/8 顶点转换、屏柜分段、旧格式兼容及机器人区域协议双向转换。
- `drawing-storage.ts` 保留兼容门面，现有业务调用方无需一次性迁移。
- 已验证顶点及含贝塞尔控制点路径的坐标 round-trip；区域 smoke test 覆盖柜排/子屏柜、独立屏柜、充电区、设备区和旧 `{items}` 格式。

第二阶段已完成：
- 新增 `path-codec.ts`，抽离 `reference_path.txt`、`path.json` 和停靠点文件的纯解析/生成逻辑。
- 路径 codec 统一负责机器人路线拓扑重建、连续单路线校验、充电区域起点判断和稳定坐标文本生成，不访问 Electron 或文件系统。
- `drawing-storage.ts` 仅保留路径候选文件查找、停靠点文件读取、LAS/scene 坐标转换和 Electron 写入编排，文件降至约 530 行。
- 路径 smoke test 覆盖停靠点包装格式、waypoint 首尾去重、机器人路线重建、参考文本往返、分支拒绝和充电区边界判定。

建议边界：
- ✅ `drawing-schema.ts`：`CabinetItem`、`DeviceAreaItem`、`ChargingAreaItem`、`RobotAreaRecord`、路径类型等类型和协议常量。
- ✅ `area-codec.ts`：`description_file.json` 与前端绘制对象的双向转换、兼容旧格式。
- ✅ `path-codec.ts`：`reference_path.txt`、`path.json`、停靠点文件的解析和生成。
- ✅ `drawing-coordinate-transform.ts`：LAS/scene 顶点和路径转换，不包含文件访问。
- `drawing-repository.ts`：读写、删除和项目相对路径处理，仅通过 `electronAPI.project` 访问文件。
- `cabinet-device-sync.ts`：屏柜删除时的数据库设备同步，不放在 JSON codec 中。

已完成验证：
- 区域协议 round-trip 样例覆盖柜排/子屏柜、充电区、设备区和旧格式兼容。
- 路径样例覆盖参考路径、机器人路径、停靠点、连续性校验和坐标变换。

验收：
- codec 可以在没有 React、PlayCanvas 和 Electron 的环境中独立测试。
- 文件 IO 层不再包含几何计算，协议层不再直接调用 `window.electronAPI`。
- 现有项目 JSON/TXT 重新加载后位置、ID、设备绑定和导出内容不变。

### 2. ⬜ 拆分勘察标定视图和共享协议

现状：`CalibrationView.tsx` 约 992 行，混合图片读取、标定文件合并、自动保存队列、Canvas 绘制、缩放拖拽、矩形编辑、点位绑定和右侧表单；`image-edit/index.tsx` 约 513 行，继续承担任务加载、三维联动、筛选和多个弹窗状态。

建议边界：
- `calibration-types.ts`：标定文件、矩形和点位绑定类型。
- `calibration-codec.ts`：跨地图 `勘察数据.json` 的 normalize/merge，不依赖 React。
- `useCalibrationPersistence.ts`：加载、防抖、串行保存、失败重试和离开页面 flush。
- `useCalibrationCanvas.ts`：viewport、缩放、拖拽、框选、命中测试和绘制调度。
- `CalibrationToolbar.tsx`、`CalibrationCanvas.tsx`、`PointBindingPanel.tsx`：拆分可见 UI。
- `useSurveyWorkspace.ts`：从 `image-edit/index.tsx` 接管地图、任务、图像索引和三维选中联动。
- 增加 renderer/Electron 共用的 survey protocol 模块，统一 `勘察数据`、`勘察数据.json`、mapCode 和标定 normalize 规则。

验收：
- `CalibrationView` 只负责组合 hooks 和子组件，不再直接拼项目路径或合并共享文件。
- 自动保存、快速连续编辑、跨地图合并和导入导出使用同一套协议函数。
- Canvas 交互拆分后缩放、框选、拖拽和快捷键行为不回退。

### 3. ⬜ 拆分 Electron 归档 IPC 和格式转换

现状：`electron/ipc/archive-ipc.ts` 约 882 行，既注册 ZIP/勘察/图像标识 IPC，又负责路径扫描、标定格式转换、图片匹配、坐标归一化和文件命名。

建议边界：
- `ipc/archive-ipc.ts`：只保留 channel 注册、参数校验和结果返回。
- `services/survey-archive.service.ts`：勘察数据导入导出和 ZIP 目录结构。
- `services/image-label.service.ts`：图像标识导入导出流程。
- `services/image-label-converter.ts`：客户端标定与机器人 label 的纯数据转换。
- `services/survey-context.ts`：任务图片索引、设备区和点位上下文加载。
- `types/survey-protocol.ts`：与 renderer 共享的数据类型和常量。

验收：
- 每个 IPC handler 只做编排，不出现大段转换循环。
- 图像标识转换可以用固定 JSON fixture 独立回归，不需要启动 Electron。
- 路径越界保护仍集中走 `project-paths.ts`，拆分后不能分散复制校验。

### 4. ⬜ 拆分顶部栏和项目管理工作流

现状：`pages/app-header/index.tsx` 约 510 行，包含导航、项目 CRUD、删除影响统计、机器人列表缓存、后台自动连接、设置弹窗和窗口控制。设置弹窗已开始独立，但项目管理仍集中在头部组件。

建议边界：
- `useProjectManagement.ts`：项目列表、项目根、创建、切换、重命名、删除和影响统计。
- `useRobotOptions.ts`：机器人缓存、后台切换刷新和无效选项清理。
- `HeaderProjectControls.tsx`、`HeaderRobotSelect.tsx`、`WindowControls.tsx`：顶部可见控件。
- `ProjectCreateModal.tsx`、`ProjectManagerModal.tsx`、`ProjectDeleteModal.tsx`：项目弹窗。
- `settings-modal/menu.ts`：设置菜单登记；新增设置项时不再修改 `AppHeader`。

验收：
- `AppHeader` 只保留导航和子组件编排，不直接执行项目文件/数据库操作。
- 项目删除弹窗、项目编辑弹窗可以独立渲染和测试。
- 新增设置页只新增菜单项和面板组件，不改顶部栏代码。

### 5. ⬜ 拆分项目服务和数据库 IPC

现状：`electron/project-core/project-service.ts` 约 546 行，混合项目生命周期、地图文件/ZIP 导入、树操作、项目文件操作和导出；`electron/db-ipc.ts` 约 343 行，混合通用 Repository IPC、批处理、点表导入和屏柜设备领域逻辑。

建议边界：
- `project-lifecycle.service.ts`：项目列举、创建、重命名、删除及数据库同步编排。
- `map-import.service.ts`：LAS/LAZ/ZIP 校验、解压、目录归一化和 manifest 更新。
- `project-file.service.ts`：树、写入、删除、重命名和打开目录。
- `project-export.service.ts`：单文件与项目 ZIP 导出。
- `ipc/db-repository-ipc.ts`：通用 CRUD handler 注册。
- `ipc/point-import-ipc.ts`、`ipc/cabinet-device-ipc.ts`：领域 IPC；实际事务逻辑继续下沉 database service。

验收：
- 项目生命周期不依赖地图 ZIP/导出实现。
- IPC 文件只做参数适配，数据库事务和业务校验在 service 中可独立测试。
- preload、IPC channel 和 renderer 类型保持一一对应。

### 6. ⬜ 组件化导入导出和后台配置页

现状：`import-export/index.tsx` 约 504 行，包含卡片配置、文件选择、本地临时文件、后台调用和所有导入导出 handler；`config/platform/index.tsx` 约 388 行，三个独立配置表单集中在一个文件。厂站、机器人、地图配置页重复加载状态、后台切换刷新、表格 CRUD 和弹窗状态。

建议边界：
- `ImportExportCard.tsx`：纯展示卡片；操作状态由父级传入。
- `useLocalProjectTransfer.ts`、`useBackendTransfer.ts`：明确区分本地项目与后台机器人流程。
- 按领域拆 `point-table-actions.ts`、`survey-actions.ts`、`communication-actions.ts`、`model-actions.ts`。
- 将 platform 拆为 `BackendPlatformForm`、`AnalysisServiceForm`、`UpstreamHostForm`。
- 抽取轻量 `useBackendRefresh` 和列表页加载/错误处理约定；不要做能够动态生成所有配置页的复杂 schema 引擎。
- 统一 `ApiResponse<T>` 和配置 DTO，移除每个页面重复声明及主要 handler 中的 `any`。

验收：
- `import-export/index.tsx` 只保留操作注册和网格布局。
- 后台切换刷新、loading、错误提示在配置页行为一致。
- 表单字段仍由领域组件明确声明，便于排查后台字段差异。

### 7. ⬜ 收敛 Electron API 类型和访问入口

现状：preload、IPC handler、`vite-env.d.ts` 和各页面分别维护调用签名；业务代码中仍有 `(window as any).electronAPI`、非空断言和大量 `any`，接口变更容易只改一侧。

具体任务：
- 将 `ElectronAPI`、Project API、数据库 Repo API、归档 DTO 拆到 `types/electron-api/*.ts`，`vite-env.d.ts` 只做 Window 全局挂载。
- 提供 renderer 侧 `getElectronAPI()`/能力检测 helper，统一 Electron-only 错误提示。
- 为 IPC channel 建立共享常量和请求/响应类型，逐步减少字符串散落。
- 新增接口时要求同时更新 handler、preload、共享类型和最小调用回归。

验收：
- 业务代码不再通过 `window as any` 访问 Electron API。
- IPC 参数或返回值变更能在构建/typecheck 阶段发现不一致。

### 8. 🟡 整理三维绘制类，避免过早重写底层引擎

现状：`PathDrawing.ts`、`CabinetDrawing.ts`、`DeviceAreaDrawing.ts`、`ChargingAreaDrawing.ts` 各约 500-800 行，重复处理 pointer 生命周期、drag 标记、点击抢占、标签和销毁；`DrawingRenderer.ts` 约 594 行，同时渲染区域、路径、标签和选中态。

具体任务：
- 先抽 `DrawingInteractionSession`/工具函数，统一 pointer 注册、drag 状态、click claim 和 dispose；不要立即改成深继承基类。
- 将 `DrawingRenderer` 拆为 area/path/label renderer，共享材质和实体生命周期 helper。
- 为每类绘制补最小交互回归后，再评估是否存在稳定的 controller 接口。
- `PointCloudLoader.ts` 和 `playcanvas-core` 的 camera/scene/splat 等算法文件暂不因行数强拆，先完成 P2 性能埋点、任务取消和缓存边界。

验收：
- 绘制模式切换和销毁不再依赖多处手工设置 `window.__drawingDragging`。
- 区域/路径 renderer 可以独立启停，点击高亮和标签行为保持一致。

### 9. ⬜ 建立拆分保护网和完成标准

具体任务：
- 为 drawing codec、survey calibration、image label converter、项目生命周期和点表导入增加 fixture 测试。
- 增加组件级检查：项目删除弹窗、设置弹窗、标定保存失败/重试、导入导出禁用状态。
- 增加模块依赖约束：纯协议模块不得导入 React、Ant Design、PlayCanvas、Electron。
- 每次拆分保持同一提交只处理一个领域，避免文件移动与行为改动混在一起。

验收：
- 拆分前后的 fixture 输出一致。
- `pnpm typecheck`、相关回归和 Electron 构建成为组件化任务的固定门槛。
- 新文件边界有明确所有者，不产生只转发一层、没有实际职责的空抽象。

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

### 3. ⬜ 屏柜图像标注补框和一键排序验证

涉及文件：
- `packages/app/src/views/screen-verify/index.tsx`
- `packages/app/src/views/screen-verify/components/CabinetImageCanvas.tsx`
- `packages/app/src/views/screen-verify/utils/constants.ts`

当前补框逻辑需要实图验证：AI 设备框按行拆分后，基于列间距补中间漏框；补出的框使用虚线标识。后续要确认补框的默认类型继承同一行已有设备框类型，整行类型不一致时给人工确认入口。

后续任务：
- 用真实屏柜图片验证自动补框是否能处理中间漏识别、左右数量不一致和上下共享标签场景。
- 自动补框仍不满足时，支持人工补框：人工选择/框选设备框后，点击“一键排序”重新建立名称和设备框对应关系。
- 一键排序需要尽量按上下位置和列中心对齐，把每个设备名称与设备框配对，生成右侧表格点位关系。
- 对无法可靠配对的名称或设备框保留空值并提示人工补充，不静默生成错误关系。

验收：
- 自动补框、人工补框和一键排序后的右侧表格数量与名称/设备框对应关系可解释、可检查。
- 虚线补框、AI 实框、人工框视觉区分清晰。
- 保存前能提示仍未配对或名称为空的点位。

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
