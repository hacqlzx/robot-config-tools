# robotConfigTools 客户端优化 TODO

生成时间：2026-07-06

## 原则

- 先优化客户端操作链路、工程数据模型、目录管理和大文件处理；三维换引擎放到最后做验证。
- `project/` 和 `data/` 是运行时目录，不作为源码任务处理。
- `doc/*.java` 和 `doc/导入逻辑总结.md` 保留，后续点表导入逻辑还会参考。
- 优先保证 Electron 客户端闭环，浏览器模式只作为 UI/前端逻辑调试入口。

## P0：客户端工作上下文和稳定性

### 1. 建立统一 AppContext

目标：项目、机器人、后台 IP、连接状态不要再由页面散读 `localStorage`。

涉及文件：
- `packages/app/src/pages/app-header/index.tsx`
- `packages/app/src/stores/backendStore.ts`
- 新增 `packages/app/src/stores/appContextStore.ts`
- `packages/app/src/components/DeviceTree.tsx`
- `packages/app/src/views/space-edit/**`
- `packages/app/src/views/image-edit/**`
- `packages/app/src/views/import-export/index.tsx`

具体任务：
- 把 `selectedProject`、`selectedRobot`、`currentBackendIp`、`connectionStatus` 收敛到一个 store。
- store 内部负责持久化到 `localStorage`，业务页面只订阅 store。
- 项目/机器人切换后，地图树、设备树、点表列表、勘察图像点位列表自动刷新。
- 未选择项目时，空间模型加载、点表导入、勘察任务导入、导出按钮给出明确阻断提示。

验收：
- 顶部切换项目后，不刷新应用也能看到设备树和地图树同步变化。
- 清空项目选择后，各页面不再使用 `"默认项目"` 或 `"default"` 静默写文件。

### 2. 项目重命名/删除同步数据库

现状：`project:rename` 只改目录名，数据库表仍按旧 `project_name` 查询，重命名后设备树会丢数据。

涉及文件：
- `packages/app/electron/main.ts`
- `packages/app/electron/db-ipc.ts`
- `packages/database/src/repositories/project-station.repo.ts`
- `packages/database/src/repositories/*.repo.ts`
- `packages/database/src/migrations/*.ts`

具体任务：
- 增加数据库侧 `renameProject(oldName, newName)`，同步更新：
  - `project_station.project_name`
  - `device_voltage.project_name`
  - `device_bay.project_name`
  - `device_main.project_name`
  - `device_component.project_name`
  - `device_point.project_name`
- 项目删除时提供明确策略：只删目录、只删数据库、或全部删除。默认建议全部删除并二次确认。
- UI 删除项目时显示会删除哪些数据。

验收：
- 项目重命名后，点表、设备树、勘察标定仍可查询。
- 删除项目后，数据库中该项目相关记录不残留，或明确标记为保留。

### 3. 修正模型导入扩展名问题

现状：`project:import-file` 固定写成 `{fileName}.las`，导入 `.laz` / `.ply` 会被误命名。

涉及文件：
- `packages/app/electron/main.ts`
- `packages/app/src/views/space-edit/hooks/useFileOperations.ts`
- `packages/app/src/views/space-edit/components/TreeView.tsx`

具体任务：
- 导入时保留源文件扩展名。
- 目录名和文件名分离，避免 `xxx.laz` 被保存成 `xxx.las`。
- 同名地图导入时提示覆盖/重命名/取消，避免静默覆盖。
- 地图树识别 `.las`、`.laz`、`.ply`。

验收：
- 导入 `.las`、`.laz`、`.ply` 后，项目目录扩展名正确。
- 从地图树再次加载时，走对应加载逻辑。

### 4. 加强 Electron 文件和网络边界

涉及文件：
- `packages/app/electron/main.ts`
- `packages/app/electron/preload.cjs`
- `packages/app/src/vite-env.d.ts`

具体任务：
- `project:write-file`、`project:export-file` 对 `subPath` 做 `path.resolve` + `path.relative` 校验，禁止路径越界。
- `project:delete-path`、`project:rename-path` 继续保留越界保护，并补齐大小写/路径分隔符边界。
- `ping` 不再拼 shell 字符串；至少先限制 IP 格式，再执行。
- 生产环境不要无条件放行证书错误；自签名证书需要可配置策略。
- 评估 `webSecurity: false` 是否必须，能收则收。

验收：
- 任何 `../` 或绝对路径写入都不能越过项目根。
- 后台 IP 输入非法字符时不会传入 shell。

### 5. 清理调试输出

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

### 1. 增加项目 manifest

目标：不要只靠中文目录名和文件扫描推断项目状态。

新增文件格式：
- `project/{项目}/manifest.json`

建议结构：

```json
{
  "version": 1,
  "projectId": "uuid",
  "projectName": "项目名",
  "createdAt": "2026-07-06T00:00:00.000Z",
  "updatedAt": "2026-07-06T00:00:00.000Z",
  "station": {
    "name": "",
    "code": ""
  },
  "maps": [
    {
      "id": "uuid",
      "name": "地图名",
      "sourceFile": "地图/地图名/地图名.las",
      "format": "las",
      "pointCount": 0,
      "cacheStatus": "none"
    }
  ],
  "pointTables": [
    {
      "name": "厂站.xlsx",
      "path": "点表/厂站.xlsx",
      "importedAt": ""
    }
  ],
  "surveyTasks": [
    {
      "name": "task_xxx",
      "path": "勘察图/task_xxx",
      "importedAt": ""
    }
  ]
}
```

具体任务：
- 项目创建时生成 manifest。
- 导入地图、点表、勘察任务时更新 manifest。
- 项目重命名时更新 manifest 内 `projectName`。
- 对旧项目提供扫描迁移：没有 manifest 时从目录结构生成。

验收：
- 启动后项目列表可以显示：是否有地图、是否有点表、是否有勘察任务、厂站绑定状态。

### 2. 项目健康状态面板

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

### 1. 加性能埋点

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

### 2. 导入阶段生成点云缓存

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

### 3. LAZ 解压改成后台任务

涉及文件：
- `packages/app/src/components/three-d-engine/PointCloudLoader.ts`
- 新增 worker 或 Electron 主进程任务模块

具体任务：
- 避免 `readLargeFile` 把 LAZ 整文件塞进渲染进程。
- 解压和抽样放到 Worker/主进程，渲染进程只接收可渲染块。
- 增加任务取消：用户切换地图、关闭页面、重新导入时能取消旧任务。

验收：
- 加载 LAZ 大文件时 UI 仍可操作，取消后不继续占内存。

### 4. 分块/LOD 渲染

具体任务：
- 按空间块生成点云块，而不是一个地图一个巨大 VertexBuffer。
- 先按距离或固定层级选择块，后续再做视锥裁剪。
- 保留当前 floating-origin 策略，避免坐标精度问题。

验收：
- 3000 万点以上地图不再一次性创建单个巨大 GPU buffer。

## P3：空间编辑代码整理

### 1. 拆分页面控制器

现状：`space-edit/index.tsx` 同时管理加载、绘制、保存、裁切、树回显。

建议拆分：
- `useSpaceProjectContext`
- `useMapSceneController`
- `useDrawingModeController`
- `useDrawingPersistence`
- `useClipController`

验收：
- `index.tsx` 主要保留 UI 编排，业务流程进入 hook/controller。

### 2. 重新设计保存状态

具体任务：
- 建立 dirty 状态：屏柜、设备区、充电区、路径分别标记。
- 手动保存保存全部 dirty 项。
- 自动保存改为可配置，默认先关闭或只保存轻量 JSON。
- 离开页面/切换地图前提示未保存。

验收：
- 用户知道当前是否已保存。
- 切换地图不会静默丢绘制。

### 3. 裁切任务后台化

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

### 1. 图片任务懒加载

现状：`useTaskLoader` 一次性读取任务下所有图片。

涉及文件：
- `packages/app/src/views/image-edit/hooks/useTaskLoader.ts`
- `packages/app/src/components/image-canvas/ImageCanvas.tsx`

具体任务：
- 先读取 `json_list.json` 和各 SP JSON，生成图片索引。
- 只加载当前可视区域附近图片。
- 缩略图缓存落到内存 LRU，必要时落磁盘缓存。
- 释放不在视口附近的大图对象 URL。

验收：
- 大任务打开速度不随图片总数线性变慢。
- 左右云台切换不重新读取全部文件。

### 2. 标定保存队列

涉及文件：
- `packages/app/src/views/image-edit/components/CalibrationView.tsx`

具体任务：
- 自动保存从 500ms 防抖改为保存队列，避免连续编辑覆盖。
- 增加保存状态：保存中、已保存、失败重试。
- JSON 合并逻辑集中成工具函数，避免页面里直接拼路径。

验收：
- 快速框选/绑定/解绑时不会丢数据。
- 保存失败有提示，并能重试。

## P5：导入导出和后台配置

### 1. 导入导出分清本地和后台

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

### 2. 后台连接状态标准化

具体任务：
- HTTP 请求失败时更新连接状态。
- 顶部连接状态显示 IP、连接时间、最后错误。
- IP 切换后清理旧机器人缓存或标记缓存来源。

验收：
- 后台断开后配置页不会只显示泛化的“获取失败”。

## P6：工程质量

### 1. 增加基础质量命令

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

### 2. 增加低成本回归脚本

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
