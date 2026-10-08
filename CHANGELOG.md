# 变更日志

每次 Git 提交前必须先更新本文件，新记录写在最上方。提交信息也要写清改了什么、为什么改，不能只写笼统标题。

填写要求：

- 按提交拆条，不要把多次提交混成一条。
- 同时写「修改」和「优化」：改了哪些行为/文件，以及带来什么体验或稳定性收益。
- 写清影响范围、关键文件、用户可见变化和验证方式。
- 提交完成后把哈希回填到对应条目；未提交时写「待提交」。
- 本文件从 2026-09-24 起记录，更早提交不再回填。

---

## 2026-10-08 — 屏柜统一柜排协议，空间编辑补性能监控与点云卸载，导出只带当前地图屏柜

- 提交：待提交
- 类型：feat / fix

### 修改

- 屏柜协议改为「只要有屏柜就必须有柜排根记录」：绘制、保存、二次编辑都写 `type=1` 柜排 + `type=2` 子屏柜，单个屏柜不再降级成独立 `type=2`。
- 绘制面板在已有屏柜时始终显示并提交柜排名称/编码，不再等拆成多个屏柜才出现柜排。
- 读取历史独立屏柜时补出柜排元数据，下次保存升级为柜排结构；命名序号把没有父记录的旧单屏柜也算作一个柜排，避免新旧数据重名。
- 已保存屏柜/设备区编辑弹窗增加删除：标题栏垃圾桶二次确认后走原有绘制删除，保存或删除进行中会锁住输入和关闭。
- 空间模型导出的 `cabinet.json` 只扫描当前地图目录里的 `description_file.json`，按该地图 `type=2` 屏柜生成清单；不再递归整个地图根目录，也不再把点表里其他地图或未绘制的屏柜写进当前包。
- 空间场景增加 F1 性能监控浮层：FPS、帧耗时、更新/渲染、长帧、点云总点数/可见点数、可见节点、LRU 驻留、GPU 节点、绘制调用、辅助三角形与几何纹理、画布尺寸、JS 堆内存。快捷键帮助同步写入 F1。
- Potree 查看器记录帧统计，并支持暂停渲染循环；旧运行时没有该接口时，适配器用更新函数包装和渲染事件做同等统计，页面不可见或没有点云时停掉动画循环。
- 点云加载支持 `AbortSignal`：切换/清空模型、加载超时会中止请求并终止仍在跑的节点 Worker；卸载时释放根节点几何，Electron 上缺少 `deleteVertexArray` 时改走 VAO 扩展，避免清理中断导致显存残留。
- `pnpm-workspace.yaml` 从 `ignoredBuiltDependencies` 改为 pnpm 10 的 `allowBuilds`，显式允许 `@parcel/watcher`、`electron-winstaller`、`esbuild`、`protobufjs` 执行安装脚本。
- 回填上一条提交哈希 `b847149`。`views/config/network/index.tsx` 内容与 HEAD 一致，仅换行状态误报，未纳入本次提交。

### 优化

- 单屏柜和多屏柜走同一套柜排层级，机器人侧不用再区分「独立屏柜」和「柜排子柜」。
- 导出包里的屏柜清单与当前地图绘制一致，避免把别的地图屏柜带进 `cabinet.json`。
- 大点云切换或关闭页面时能停渲染、取消未完成加载，减少后台继续解压和空转。
- F1 可直接看当前帧率和点云驻留，不用再开外部性能工具。
- 已保存区域可在编辑弹窗里直接删除，不用先关掉再去找删除入口。

### 影响范围

- `packages/app/src/views/space-edit/components/CabinetPanel.tsx`
- `packages/app/src/views/space-edit/components/SavedAreaEditModal.tsx`
- `packages/app/src/views/space-edit/hooks/drawing/area-codec.ts`
- `packages/app/src/views/space-edit/hooks/drawing/drawing-schema.ts`
- `packages/app/src/views/space-edit/hooks/drawing/drawing-storage.ts`
- `packages/app/src/views/space-edit/workspace/index.tsx`
- `packages/app/src/views/space-edit/workspace/components/SpacePerformanceMonitor.tsx`（新增）
- `packages/app/src/views/space-edit/workspace/components/SpaceSceneHost.tsx`
- `packages/app/src/views/space-edit/workspace/components/SpaceShortcutHelp.tsx`
- `packages/app/src/views/space-edit/workspace/engine/PotreeSpaceSceneAdapter.ts`
- `packages/app/src/views/space-edit/workspace/engine/types.ts`
- `packages/app/src/views/space-edit/workspace/engine/useSpaceSceneHost.ts`
- `packages/app/src/potree-core/build/potree/potree.js`
- `packages/app/src/potree-core/potree-runtime.ts`
- `packages/app/electron/export-points.ts`
- `pnpm-workspace.yaml`
- `CHANGELOG.md`

### 用户可见变化

- 画一个屏柜也会要求填写柜排，保存后描述文件里有柜排根记录。
- 编辑已保存屏柜或设备区时，标题栏可删除，需确认。
- 空间编辑页按 F1 打开/关闭性能监控；快捷键帮助里能看到这项。
- 导出空间模型时，`cabinet.json` 只含当前这张地图上画过的屏柜。

### 验证

- 新建单个屏柜：面板出现柜排字段，保存后的 `description_file.json` 含 `type=1` 根记录和对应 `type=2` 子记录。
- 打开只有独立 `type=2` 的旧地图：能回显柜排名，再保存后升级为柜排结构，后续默认名不与旧柜排重号。
- 编辑弹窗点删除并确认：屏柜或设备区从场景和侧栏消失；取消确认则保留。
- 项目下有多张地图时导出其中一张：`cabinet.json` 不含其他地图屏柜，也不含点表里未绘制的屏柜。
- 加载点云后按 F1：浮层有 FPS、点数和画布尺寸；切走页面或清空模型后渲染循环暂停。
- 加载过程中切换模型或等待超时：进行中的节点请求被中止，不继续往已卸载的点云写数据。

## 2026-09-24 — 增加提交变更日志，并补齐后台连接状态与网络保存确认

- 提交：`b847149`
- 类型：feat / chore

### 修改

- 新增根目录 `CHANGELOG.md`，作为每次提交必须同步更新的优化/修改日志；约定从今天起记，不再回填更早提交。
- `AGENTS.md` 增加「提交日志」强制约定：用户要求提交时，先写详细日志再提交，提交信息也要写细，并把 commit hash 回填到本文件。
- 后台设置面板顶部增加「当前连接」卡片：展示当前后台 IP，以及已连接 / 连接失败 / 未连接状态。
- 当前后台每 5 秒探测一次；已连接时 Tag 可悬停查看延迟毫秒数，探测结果同步写回全局连接状态。
- ping 改为返回 `{ ok, latencyMs }`，新增、列表重连成功后都会带上本次延迟。
- 网络配置卡片跟踪 IP / 子网掩码 / 网关是否相对上次成功保存值发生变化；未改动或保存中时「确定」不可点。
- 仅当 IP 相对已保存值变化时，弹出「修改 IP 会自动重启系统」确认框；只改掩码或网关仍直接保存。
- 外部 `record` 刷新时回填表单并清 dirty，避免列表重载后仍显示未保存。

### 优化

- 设置里不用先点连接，就能看到当前后台是否通、延迟多少。
- 网络页避免空保存；改 IP 这种会重启的操作先二次确认，减少误触。
- 把单次改动细节从 `AGENTS.md` 拆到本日志，后续接手能按提交回看。

### 影响范围

- `CHANGELOG.md`、`AGENTS.md`
- `packages/app/src/pages/backend-modal/index.tsx`
- `packages/app/src/views/config/network/NetworkCard.tsx`
- `packages/app/src/views/config/network/index.tsx` 仅有换行差异，未纳入本次提交。

### 验证

- 打开设置：有后台 IP 时顶部显示当前连接和状态；悬停「已连接」能看到延迟；断开或失败时 Tag 变为失败/未连接。
- 网络配置：未改字段时「确定」禁用；改掩码/网关可直接保存；改 IP 会先确认再提交；保存成功后按钮再次禁用。
- `AGENTS.md` 能找到「提交日志」规则，本文件有当前这条记录。
