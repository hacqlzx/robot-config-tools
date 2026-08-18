# Potree 迁移准备与 TODO

更新时间：2026-08-18

## 当前结论

- 空间编辑路由已切换到 `views/space-edit/workspace`，由 `PotreeSpaceSceneAdapter` 创建和释放 Potree Viewer。
- 原空间编辑的工具栏、六面视角控件以及地图/设备台账/屏柜/设备区侧栏已恢复到新入口。裁切、区域/路径只读回显、充电区域、设备区域、屏柜和可行路径编辑已经接入 Potree。
- Potree 场景已恢复原空间编辑的 `W/A/S/D/Q/E` 键盘移动；`Shift` 为 10 倍速，`Alt` 为 0.1 倍速，文本输入控件聚焦时不会抢占按键。
- 场景右下角已提供显示设置。显示精细度控制 Potree LOD 节点阈值，加载点数量支持“全部加载”或最高 `1 亿点`上限；设置会保存到本机并在后续模型加载时继续生效。
- 20 GB 样例已完成 Electron 实机验收，覆盖首帧、点预算、显存、切换地图和释放行为。
- 地图加载后会读取同目录 `description_file.json`、`reference_path.txt` 和 `path.json`，使用 LAS 绝对坐标回显屏柜、充电区、设备区、路径、停靠点和名称标签；树勾选状态与 Potree 图层同步。
- 勘察图片页左侧设备区地图已切换到 Potree：只加载当前地图主模型，复用 Potree 转换缓存和释放流程；区域、机器人路径、停靠点和勘察图片射线均使用 LAS 绝对坐标回显，缩略图 hover/定位会刷新射线并沿拍照方向聚焦。
- 充电区域编辑已迁移：三点生成贴地正交长方体，Z 轴为高度，支持高度输入、框体选中、方向键平移、Delete 删除、撤销/恢复和保存。保存使用 LAS 坐标专用入口，不经过旧 PlayCanvas floating-origin 转换。
- 设备区域编辑已迁移：支持多个三点成框区域、既有区域加载、顶部名称标签、选中高亮、方向键平移、高度调整、Delete 删除、撤销/恢复和 `Ctrl+S` 保存；每个区域可绑定一个设备区间隔，当前地图和其他地图的已绑定间隔均会避免重复选择。保存使用 LAS 绝对坐标专用入口，不经过旧 PlayCanvas floating-origin 转换。
- 屏柜编辑已迁移：四点按“前左下→前右下→前右上→后右上”生成正交柜体，红色协议顶点可拖拽并吸附点云，前下红边可插入分隔线，支持多屏柜名称标签、撤销/恢复、区域/间隔选择、柜排与屏柜编码保存。Potree 编辑器直接使用 LAS 绝对坐标，保存后重新读取 `description_file.json`，保留柜排/子屏柜层级和主设备同步逻辑。
- 可行路径编辑已补齐旧版交互：非绘制状态可选中路径点拖拽吸附、选中路径段后显示贝塞尔控制点；直线段会显示默认 1/3 和 2/3 控制点，拖拽后写入 `segment.bezier.cp1/cp2` 并进入撤销/恢复历史。带名称的路径点会显示标签，采集点和 topo 点会按旧版语义区分大小/颜色，waypoint 不再显示为可选小球。
- 绘制对象点选已收敛到当前交互模式：路径优先抢占自身点/线/控制点选择，区域回显只在 idle 状态响应；区域命中使用射线与 OBB 最近深度，并修正半边长计算，避免屏柜绘制状态下被已保存设备区、充电区或放大的区域包围盒误选。
- Potree workspace 已恢复跨工具统一历史栈，工具栏和 `Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z` 均走同一条时间线；各编辑器内部局部栈仅作为实现细节保留，不再作为页面快捷键入口。
- 30 秒自动保存、保存状态提示、“保存全部”和加载/导入/卸载/裁切/窗口关闭前的未保存确认已接入 Potree workspace。自动保存只处理已变更的充电区、设备区和路径；屏柜涉及区域/间隔校验及主设备同步，仍需要手动保存或点击保存全部。保存全部写盘前会先复用旧版路径起点充电区校验，避免路径失败后产生部分保存。
- AABB 裁切框和完整 LAS 后台裁切已接入。裁切读取原始 LAS 全量点，完成后重新生成 PotreeConverter 产物并加载新模型，不从当前可见 LOD 导出。
- 原 `views/space-edit` PlayCanvas 实现及其绘制、裁切、保存代码完整保留，但不再由空间编辑路由引用。
- PlayCanvas 依赖暂不从 `package.json` 删除。`components/three-d-engine` 及旧空间编辑实现仍依赖它，移除依赖是迁移末期任务。
- Potree 运行资源来自官方 `potree-develop` 的同版本 `build` 与 `libs`，不改用 npm 中不同版本的 Three.js、jQuery 等包拼装。
- PotreeConverter 2.1.3 由 Electron 主进程受控调用，不进入 renderer 资源；renderer 只通过领域 IPC 请求转换并订阅进度。
- 项目清单会记录每张地图的原始 LAS/LAZ、`.potree` 输出目录、`metadata.json`、转换状态、源文件大小/mtime 和最近错误；地图树会用状态图标提示未生成、已生成、过期或失败。

## 已完成的结构

```text
router/space-edit
  -> views/space-edit/workspace/index.tsx
      -> WorkspaceMapTree
      -> SpaceSceneHost
          -> PotreeSpaceSceneAdapter
              -> PotreeCabinetEditor
              -> PotreeChargingAreaEditor
              -> PotreeDeviceAreaEditor
              -> PotreePathEditor

views/space-edit/index.tsx
  -> 原 PlayCanvas 空间编辑实现（保留但未引用）

src/potree-core
  -> build/                     Potree Viewer 构建产物
  -> libs/                      官方示例配套依赖与 WASM
  -> PotreeConverter_2.1.3/     Windows 转换工具
  -> potree-assets.ts           资源清单与官方加载顺序
  -> vite-potree-assets.ts      开发服务及构建资源发布

electron/potree
  -> potree-converter.ts        Converter 调用、产物校验和原子替换
  -> project-asset-protocol.ts  支持 Range 的项目点云资源协议
```

`SpaceSceneAdapter` 当前定义 Viewer 生命周期、模型加载、显示设置、只读绘制图层、屏柜/充电区域/设备区域/路径编辑和裁切接口。键盘相机、鼠标深度缩放、旋转中心提示、绘制对象和裁切体积均由适配器内部维护，页面只管理业务状态和文件保存；旧 PlayCanvas API 不会复制到页面层。

## 资源发布规则

开发环境：

- URL 根路径为 `/static/potree/`。
- Vite 中间件直接读取 `src/potree-core/build` 和 `src/potree-core/libs`。
- 启动构建时会检查官方示例所需 CSS、脚本、Worker 和 WASM 是否齐全，缺文件时直接失败。

生产构建：

- `build` 和 `libs` 原目录结构发布到 `dist/static/potree/`。
- 必须保留目录层级。Potree 的 Worker、语言包、图标、WASM 和侧边栏会按相对路径继续加载。
- `PotreeConverter_2.1.3` 通过 electron-builder `extraResources` 复制到安装目录 `resources/potree/PotreeConverter_2.1.3`。
- Converter 不发布到 `dist`，浏览器页面不能访问或执行它。

官方 `aijia.html` 的依赖顺序已经固化在 `potree-assets.ts`：Potree CSS 与 UI CSS，jQuery/Spectrum/jQuery UI，BinaryHeap、Tween、D3、Proj4、OpenLayers、i18next、jstree，随后是 `potree.js`、LAS/LAZ、sql.js 和 geopackage。Three.js 模块保留官方文件 `libs/three.js/build/three.module.js`。

## 点云数据约定

主加载链路使用 PotreeConverter 产物，不直接把 20 GB 原始 LAS 交给浏览器：

```text
原始 LAS/LAZ
  -> PotreeConverter 2.1.3
  -> metadata.json + octree.bin + hierarchy.bin
  -> Potree Viewer 按 LOD 加载
```

- 后续模型选择入口以 `metadata.json` 为主；如需兼容旧 Potree 1.x 数据，再单独支持 `cloud.js`。
- 不承诺任意 LAS 版本和任意 Point Data Record Format 都无条件可转换。接入转换服务时要读取 Converter 退出码和日志，并用真实的 LAS 1.0-1.4、压缩 LAZ、额外维度和异常 header 样例建立兼容矩阵。
- 转换产物与原始模型要建立明确关联。`metadata.json` 用于显示，原始 LAS/LAZ 用于高保真计算和导出。
- 每张地图的 Viewer 产物固定保存到模型同目录的 `.potree/`：`metadata.json`、`octree.bin`、`hierarchy.bin`。原始 `map.las` 仍是权威数据源。
- `.potree`、转换临时目录和备份目录属于可再生缓存，空间模型 ZIP 的文件扫描与大小统计会跳过它们。
- 勾选地图或导入模型后会先检查三项产物及时间戳。产物缺失、损坏或早于原模型时，主进程转换到 `.potree.tmp-*`，校验成功后再替换 `.potree`；失败时保留原有可用产物。
- PotreeConverter 2.1.3 在 Windows 下不能可靠读取中文输入/输出路径。主进程会在纯英文项目根下创建临时 junction，让 Converter 通过 ASCII 路径访问原地图目录，任务结束后立即清理。
- `robot-project://asset/` 只映射项目根内文件并支持字节范围请求，供 Potree 读取大型 `octree.bin`。renderer 不接收任意本地文件读取能力。
- Potree 2.1.3 的 `setPointBudget` 会先 `parseInt`，因此“全部加载”使用 `Number.MAX_SAFE_INTEGER` 表示，不能直接传 `Infinity`。

## 裁切与完整 LAS 导出

Potree Viewer 当前加载到内存的是可见 LOD 节点，不是完整点集。不能遍历场景中当前可见点后直接写 LAS，否则会漏点并受点预算、相机位置和 LOD 影响。

目标流程：

```text
Potree 场景中的裁切体积
  -> 转换为原始 LAS 坐标系的边界/多面体
  -> 后台读取原始 LAS/LAZ 并流式筛选全部点
  -> 写入完整 LAS，回填点数、bbox、scale、offset 和版本字段
  -> 校验输出后再生成新的 PotreeConverter 产物
```

裁切保存必须继续保留现有 floating-origin 语义，输出 header 的中心/范围不能随意改成裁切点的紧包围盒，否则重新加载后会与原地图错位。

## PlayCanvas 对比剩余差异

- 旧版 `screenPickLas()` 有 5px 半径拾取和整屏最近点回退；新版 Potree 屏柜和路径仍主要依赖当前鼠标下的点云交点。充电区、设备区已有地面平面兜底，但屏柜/路径不能简单改成地面兜底，否则柜体四点和路径点可能偏离真实设备表面，后续需要实现真正的 Potree 最近点 fallback。
- 旧版空间编辑有离开页面未保存确认；新版 Potree 已恢复模型加载、导入、卸载、裁切和浏览器窗口关闭前的确认弹窗。顶部项目切换和路由切换仍由外层直接重建页面，后续需要在 app context/header 层增加统一守卫。
- 旧版保存全部会尝试保存屏柜以外的全部几何；新版 Potree 已恢复统一保存入口，但屏柜自动保存刻意不启用，避免无人值守时触发主设备创建/同步。屏柜仍可通过面板保存或工具栏“保存全部”手动保存。
- 旧版裁切自建六面箭头拖拽和实时 shader 裁切预览；新版使用 Potree `BoxVolume` 的缩放手柄，能表达相同 AABB 裁切结果，但手柄样式、取消/磁盘空间预检和输出结构校验仍需继续补齐。

## 后续 TODO

状态：`[x]` 已完成，`[ ]` 未开始。

- [x] 核对 `aijia.html` 的 CSS、脚本、Three.js、Worker 和 WASM 依赖。
- [x] 准备 Potree `build/libs` 的开发服务和生产构建发布。
- [x] 准备 PotreeConverter 2.1.3 的 Electron 安装包资源位置。
- [x] 新增引擎无关的 `SpaceSceneAdapter` 生命周期边界。
- [x] 空间编辑路由断开对 PlayCanvas 页面、Hook 和实体类型的引用。
- [x] 实现 `PotreeSpaceSceneAdapter` 的 Viewer 创建、模型加载/卸载、销毁、ResizeObserver 和错误回收。
- [x] 实现 Electron `potree:ensure-model`：Converter 调用、阶段进度、产物校验、临时目录和成功后替换。
- [x] 恢复地图模型树勾选和导入后自动加载，页面显示导入、转换、校验和层级加载进度。
- [x] 恢复原空间编辑界面骨架、点表导入和空间模型导出，不因更换引擎隐藏后续迁移入口。
- [x] 恢复 `W/A/S/D/Q/E`、`Shift`、`Alt` 相机移动语义，保留 Potree 原有鼠标旋转、平移和缩放。
- [x] 增加右下角显示设置，支持 4 档 LOD 精细度、全部加载或 10 万至 1 亿点预算和本机持久化。
- [x] 使用 20 GB 样例完成首帧、点预算、显存、切换地图和释放的 Electron 实机验收。
- [x] 建立项目模型清单：原始 LAS/LAZ、转换目录、`metadata.json`、转换状态和错误日志。
- [x] 补齐地图树单模型显隐、六面视角切换和自动聚焦，Potree 对象不泄漏到 React 页面。
- [x] 迁移屏柜、充电区、设备区和路径的只读显示，保持现有 JSON 协议并直接使用 LAS 绝对坐标。
- [x] 迁移充电区域绘制、选中、方向键平移、Delete 删除、高度调整、撤销/恢复和手动保存。
- [x] 迁移设备区编辑，并接回多框加载、台账间隔绑定、选中、方向键平移、Delete、局部撤销/恢复、`Ctrl+S` 和 LAS 坐标保存。
- [x] 迁移屏柜编辑，并接回四点成柜、红点拖拽、分隔线、名称标签、撤销/恢复和 LAS 坐标保存。
- [x] 迁移路径编辑，并接回连续落点、已有点连接、路径点吸附移动、路径段选择、贝塞尔控制点编辑、名称/类型展示、选中/删除、撤销/恢复、`Ctrl+S` 和起点充电区校验；`reference_path.txt` 可编辑，机器人 `path.json` 保持只读回显。
- [x] 接通 Potree workspace 的 `Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z`，并统一到跨工具历史时间线。
- [x] 增加回显区域和屏柜的点击命中、高亮、Delete/Backspace 删除，并复用现有 LAS 协议写回及屏柜主设备同步。
- [x] 恢复屏柜树勾选，按间隔筛选 Potree 回显；取消全部勾选时隐藏屏柜，但保留地图树本身已显示的其他区域。
- [x] 恢复 30 秒自动保存、保存状态提示、`Ctrl+S` 和工具栏“保存全部”；区域和路径仍走原 `description_file.json` / `reference_path.txt` 协议，屏柜自动保存刻意跳过。
- [x] 恢复加载地图、导入模型、卸载地图、裁切模型和窗口关闭前的未保存确认。
- [ ] 在顶部项目切换和路由切换前接入同一套未保存确认守卫。
- [ ] 补齐现有完整 LAS 裁切任务的取消、磁盘空间预检和输出结构校验；当前已有进度、全量筛点、输出和再转换。
- [ ] 建立 LAS 版本/点格式/LAZ/额外维度的 Converter 兼容矩阵。
- [ ] 完成 Electron 打包后的离线资源、Worker、WASM 和 Converter smoke test。
- [x] `image-edit` 左侧设备区地图迁移到 Potree，并接回区域/路径/停靠点/图片射线回显与定位。
- [ ] 删除 PlayCanvas 依赖和 legacy 空间编辑代码前，先确认 `components/three-d-engine` 没有其他页面引用。

## 当前验收

- 空间编辑入口的静态依赖图中没有 `playcanvas`、`usePlayCanvas`、`ThreeDEngine` 或 `PointCloudLoader`。
- Viewer 初始化和 PointCloud 对象生命周期只存在于 `PotreeSpaceSceneAdapter`，页面只传递模型描述和 loading 状态。
- 键盘监听和动画帧随适配器挂载/销毁，输入框聚焦和窗口失焦不会遗留移动状态；显示设置不向 React 暴露 Viewer 或 PointCloud。
- 旧 PlayCanvas 文件和功能代码没有被删除或改写。
- 构建产物保留 Potree 官方目录结构，Converter 仅进入 Electron `extraResources`。
- 最新区域/路径回显、充电区域编辑、设备区域编辑、统一历史、自动保存/保存全部、未保存确认、勘察图片 Potree 左侧地图和 Potree 模型清单状态已通过 `pnpm --filter app build:electron`。20 GB 样例已完成 Electron 实机验收；全量 TypeScript 检查仍被仓库既有错误阻断，本轮构建未暴露新增编译错误。
- 浏览器模式没有 `window.electronAPI`，只能检查空页面和运行资源；转换、项目协议和 20 GB 模型必须在 Electron 模式验收。
