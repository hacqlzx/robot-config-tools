# 变更日志

每次 Git 提交前必须先更新本文件，新记录写在最上方。提交信息也要写清改了什么、为什么改，不能只写笼统标题。

填写要求：

- 按提交拆条，不要把多次提交混成一条。
- 同时写「修改」和「优化」：改了哪些行为/文件，以及带来什么体验或稳定性收益。
- 写清影响范围、关键文件、用户可见变化和验证方式。
- 提交完成后把哈希回填到对应条目；未提交时写「待提交」。
- 本文件从 2026-09-24 起记录，更早提交不再回填。

---

## 2026-10-12 — 接入 GitHub 自动更新，增加底部版本栏并准备 1.0.5 发布包

- 提交：待提交
- 类型：feat

### 修改

- 添加 `electron-updater 6.8.9` 运行时依赖及锁文件更新，主进程注册更新状态、检查、下载、安装 IPC，通过 preload 和共享类型向渲染侧暴露受限接口。
- 更新源使用 `hacqlzx/robot-config-tools` 的 GitHub 正式 Releases，通过 electron-builder 的 `build.publish` 生成 `resources/app-update.yml`。用户明确选择将该仓库公开，客户端因此能够匿名检查与下载；安装包不包含 GitHub 发布凭据。
- 新增可单独测试的 `UpdateController`：安装版窗口显示后延迟 3 秒检查一次；开发模式不发更新请求；默认不自动下载、不在退出时自动安装，不接收预发布版或降级。检查/下载请求避免并发重复，失败保留可重试状态，只有下载完成后才能安装。
- 新增底部 32px 单行版本栏，当前版本右侧提供检查更新/更新按钮。发现新版本显示蓝色版本标记；下载时显示百分比，完成后显示「更新已就绪」和「重启安装」，确认保存项目后才退出并启动安装程序。无新版本、网络失败、浏览器模式分别提供对应提示。
- 全局内容区改为可收缩的 flex 布局，底部版本栏独立占位；通过 Vite 从应用清单注入构建版本，安装版以 Electron `app.getVersion()` 为准，避免界面硬编码版本。
- Windows NSIS 产物采用 `RobotConfigTools-Setup-${version}-${arch}.exe` 文件名，正式打包显式加 `--publish never`，将构建与上传分离；此次按用户要求使用版本 `1.0.5` 打包。
- 补充 `pnpm-workspace.yaml` 中 Electron 安装脚本许可，解决新增依赖后运行文件缺失导致 `electronDist` 无效的问题；保留原有官方镜像配置。
- 更新 `PACKAGING.md`，说明启动检查、更新流程、发布所需 exe/blockmap/latest.yml、当前 Windows x64 支持范围和旧客户端首次需要手动安装的限制；回填上一条提交 `d85e6be`。

### 优化

- 用户可以在当前页面直接看到应用版本和新版本，无需访问仓库手动比较版本。
- 启动检查不会打断编辑；下载和安装都由用户主动触发，重启前明确提醒保存项目。
- 主进程集中处理更新、下载和安装，渲染侧只订阅状态并调用固定动作，不接触发布令牌或文件路径。
- 正式打包生成更新元数据，普通构建校验不修改版本，也不会意外发布 Release。
- 对更新生命周期建立回归测试，覆盖禁止提前安装、禁止自动下载、错误重试、并发检查和开发模式禁用。

### 影响范围与用户可见变化

- `packages/app/electron/app/app-updater.ts`、`update-controller.ts`、`electron/main.ts`、`electron/preload.cjs`：启动检查及更新 IPC。
- `packages/app/src/pages/app-footer/*`、`src/App.tsx`、`src/shared/app-update.ts`、`src/vite-env.d.ts`：底部版本/更新 UI、状态类型和布局。
- `packages/app/vite.config.ts`、`package.json`、`scripts/package.mjs`、`scripts/app-update.test.mjs`：版本注入、依赖、发布配置、打包和测试。
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`PACKAGING.md`、`CHANGELOG.md`：依赖解析、运行文件安装、使用说明和日志。
- 应用版本更新至 `1.0.5`；该版本是首次内置更新器的版本，此前客户端需手动安装一次，后续版本可使用底部更新入口。

### 验证

- Context7 官方 MCP 查询 electron-builder/electron-updater 文档，核对 GitHub provider、Windows NSIS 更新元数据、手动下载/安装事件与私有仓库限制；实现使用本地 6.8.9 API，避免误用文档中 v7 的破坏性接口。
- `node --test packages/app/scripts/app-update.test.mjs packages/app/scripts/package-version.test.mjs`：11 项通过。
- `pnpm package:check` 通过渲染进程、主进程和 preload 构建；新增更新主进程、控制器、底部 UI 和共享类型的定向 TypeScript 检查零错误。界面截图确认底部版本/按钮处于独立单行，内容区未被覆盖。
- 首次打包因缺失 Electron dist 失败，版本按预期恢复 `1.0.4`；执行官方 Electron 安装脚本后重新打包 `1.0.5` 成功，生成 exe、blockmap 和 latest.yml。
- 打包应用使用隔离的临时 userData 启动，数据库/IPC/preload 初始化成功、应用保持响应，启动后实际访问 GitHub 更新源；首个 Release 发布前的无版本错误被更新控制器接收，未使应用退出。
- 包内 `app-update.yml` 指向 hacqlzx/robot-config-tools；生成的 `latest.yml` 版本为 1.0.5，包含安装包文件名、大小和 SHA-512。发布流程将在同一个正式 Release 上传三类产物并验证匿名更新检查；未执行会修改当前安装应用的重启安装操作。

## 2026-10-12 — 打包前选择版本号，构建校验与版本递增分离

- 提交：`d85e6be`
- 类型：feat

### 修改

- 新增 `packages/app/scripts/package.mjs` 作为正式打包入口：先选择版本号，再依次运行原有的打包准备、Electron 构建和 Windows NSIS 打包。子进程以参数数组启动，不通过拼接 shell 命令传递版本号。
- 新增 `package-version.mjs` 管理版本输入、参数解析和格式校验。交互提示展示当前版本及末位加 1 的默认值，例如 `1.0.3 -> 1.0.4`；回车采用默认值，也可手动指定三段式版本或合法预发布版本，输入 `q` 取消，格式错误重新提示。
- `pnpm package --auto` 显式采用默认递增，`pnpm package --version 1.1.0` 显式指定版本；无交互环境且未提供参数时中止，避免自动化校验静默修改版本号。自动递增预发布版本时去掉预发布/构建标记。
- 仅修改 `packages/app/package.json` 顶层 `version` 的值，保留其他内容、缩进和换行格式；打包成功后保留新版本，普通步骤失败时恢复原内容，若期间有手动修改则保留手动修改。
- 根目录和应用包增加 `package:check`，只运行 Electron 构建。`build`、`build:electron` 和 `package:prepare` 不接入版本选择或递增。
- 新增 `PACKAGING.md` 说明交互与无交互用法、版本保留/恢复行为和校验入口；在 `AGENTS.md` 固化代理日常校验不得走正式打包入口的约定。
- 一并提交工作区已有的应用版本更新 `1.0.3 -> 1.0.4`；本次代理提交与同步流程没有运行正式打包或递增版本号。
- 回填上一条点云卸载修复提交哈希 `b716a00`。

### 优化

- 每次正式打包时可以直接确认默认的新版本，也可临时选择大版本、次版本或预发布版本，无需先手动编辑 JSON。
- 版本确认在进程清理和产物删除前执行，输入错误或取消不会开始打包准备。
- 构建校验与发布版本分离，代理检查构建不会弹版本提示，也不会改变应用版本号。
- 打包步骤失败后恢复版本，减少重试带来的重复递增；强制终止或断电无法保证恢复，使用说明已写清这一限制。

### 影响范围与用户可见变化

- `package.json`、`packages/app/package.json`：正式打包和校验脚本入口。
- `packages/app/scripts/package.mjs`、`package-version.mjs`、`package-version.test.mjs`：打包编排、版本规则和回归测试。
- `PACKAGING.md`、`AGENTS.md`、`CHANGELOG.md`：使用说明、稳定约定和变更记录。
- 用户执行 `pnpm package` 时先看到版本选择；普通构建与开发流程不弹提示。开发验证时保持 `1.0.3`，提交前工作区已更新为 `1.0.4`，下一次默认版本为 `1.0.5`。

### 验证

- `node --test packages/app/scripts/package-version.test.mjs`：5 项全部通过，覆盖末位递增、预发布/构建标记、非法版本/参数拒绝、非交互选择和保留 CRLF/嵌套版本字段。
- `node --check packages/app/scripts/package.mjs` 通过；Vite 和 electron-builder 入口均能从应用依赖解析。
- `pnpm package:check` 通过：渲染进程、Electron 主进程和 preload 构建完成；存在空 chunk、大 chunk 及依赖未使用导入提示，不阻断构建。该验证未调用版本选择、进程清理或 NSIS 打包，应用版本保持 `1.0.3`。
- `git diff --check` 通过。未生成正式安装包，未实际执行终端版本交互和打包失败恢复流程。
- 提交前复核：5 项版本测试及差异检查再次通过；已有 `1.0.4` 版本更新予以保留，未运行正式打包；GitHub 目标仓库没有已有分支或标签，历史中未发现达到 50 MB 的单文件对象。

## 2026-10-12 — 修复点云卸载后的画布残留，应用版本更新至 1.0.3

- 提交：`b716a00`
- 类型：fix

### 修改

- `PotreeSpaceSceneAdapter.syncActiveState()` 在页面处于激活状态且没有点云时，主动调用一次 `viewer.render()`。此前卸载点云会暂停动画循环，但画布仍保留最后一帧，看起来像模型没有清空；现在卸载完成后重绘空场景，返回缓存页面时也会刷新无模型画面。
- `potree-runtime.ts` 的 `PotreeViewerInstance` 接口补充必需的 `render: () => void`，使场景适配器可以通过明确的类型契约调用运行时已有的单帧渲染方法。
- `packages/app/package.json` 中应用版本由 `1.0.0` 更新为 `1.0.3`，同步后续打包使用的应用版本元信息。
- 保留并提交上一条主进程后台下载修复记录的哈希回填 `828fcc4`，使历史日志与已有提交对应。

### 优化

- 点云卸载后画布及时呈现清空结果，减少旧画面造成的误判；缓存页面重新激活时也能显示当前场景状态。
- 空场景只额外绘制一帧，继续保留无点云时暂停循环、非激活页面不重绘的行为，避免为清空画布持续占用渲染资源。
- 将单帧渲染能力纳入运行时接口，减少适配层对隐式方法的依赖；应用版本信息与本次发布准备保持一致。

### 影响范围

- `packages/app/src/views/space-edit/workspace/engine/PotreeSpaceSceneAdapter.ts`：空间编辑场景的激活、点云卸载与空场景刷新。
- `packages/app/src/potree-core/potree-runtime.ts`：Potree 查看器的 TypeScript 接口声明。
- `packages/app/package.json`：应用版本及打包元信息。
- `CHANGELOG.md`：本次详细记录和上一条提交的哈希回填。

### 用户可见变化

- 空间编辑卸载模型后，旧点云画面会被空场景替换；返回已经清空模型的缓存页面时，也会刷新画布。
- 应用版本元信息更新为 `1.0.3`。

### 验证

- `pnpm build` 通过（2026-10-12，Vite 构建耗时 57.38 秒）；构建提示 `mqtt` 空 chunk 和部分 chunk 超过 500 kB，未阻断产物生成。
- 源码检查：`clearModel()` 释放点云并将引用置空后调用 `syncActiveState()`；缓存页面激活同样调用该方法；仅在 `active && !this.pointcloud` 时进行补充渲染。内置 Potree 查看器已实现 `render()`。
- 本次未执行 Electron 界面交互验证，也未生成安装包；建议实际回归“加载模型后卸载”和“清空模型后切换页面再返回”两条场景。

## 2026-10-09 — 主进程后台下载改走 Axios，导出任务在主进程取地址

- 提交：`828fcc4`
- 类型：fix

### 修改

- 新增 `packages/app/electron/backend-http.ts`，主进程后台 GET 统一走 Axios，不再各处用 `net.fetch`。自签 HTTPS 使用 `rejectUnauthorized: false` 的长连接 Agent；超时 100 分钟，适合大文件。请求会带上 Electron 会话 Cookie，并继续最多重试 3 次（408、425、429、500、502、503、504，间隔 300ms、600ms）。
- 导出任务和远程文件下载都改用这套请求。导出接口除 `success === true` 外，也接受 `code === 200`；下载路径可以是字符串，或对象上的 `fileUrl` / `downloadUrl` / `url` / `filePath` / `path`。文件名从路径或完整 URL 里取，并做 URI 解码。
- 请求日志去掉查询参数，经 `backend-request:log` 推到渲染进程。下载任务按钮挂上监听，开发者工具里能看到主进程请求。渲染层 Axios 日志从 `console.debug` 改为 `console.log`，绝对地址不再和 `baseURL` 拼重。
- Electron 下导入导出、模板下载、机器人日志小包改为创建 `remote-export` 任务：主进程自己请求导出接口再落盘。浏览器没有任务中心时，仍由页面请求地址，但文件下载改走 `downloadByAxios`，不再用裸 `<a>` 链接触发，JSON/文本错误能读出后台文案。
- 下载任务刚进入等待或进行中时也会打开任务面板，不只在成功或失败时弹出。
- 屏柜点表导出的表计、位置状态、外观字段改用独立导出字典，不再直接套识别定义。`fd_off` 的导出位置状态类型改为「接地刀闸状态」；表计仍导出 SF6压力表 / 泄漏电流表，外观仍是设备外观查看。
- 空间编辑扫描区域文件时去掉控制台调试日志。
- 回填上一条提交哈希 `18cd553`。

### 优化

- 主进程和渲染层下载走同一套 Axios 行为，自签证书、Cookie、重试和错误文案不再因 `net.fetch` 和页面请求不一致而分叉。
- 导出取地址和文件下载都留在主进程任务里，渲染层不用先打一遍接口再把路径交回去，开发者工具也能看到这次请求。
- 浏览器兜底下载失败时能提示后台原因，而不是静默打开一个错误响应。
- 屏柜点表业务名称可以和识别页显示名分开维护。

### 影响范围

- `packages/app/electron/backend-http.ts`
- `packages/app/electron/ipc/export-task-ipc.ts`
- `packages/app/electron/ipc/file-ipc.ts`
- `packages/app/electron/preload.cjs`
- `packages/app/src/vite-env.d.ts`
- `packages/app/src/services/http.ts`
- `packages/app/src/components/download-task/index.tsx`
- `packages/app/src/views/import-export/index.tsx`
- `packages/app/src/views/realtime-monitor/index.tsx`
- `packages/app/src/shared/cabinet-detection.ts`
- `packages/app/src/views/space-edit/workspace/index.tsx`
- `CHANGELOG.md`

### 用户可见变化

- Electron 里导出、模板下载、录制小包开始后，下载面板会立刻出现；请求日志在开发者工具中可见。
- 后台返回带 `code: 200` 或对象形式下载地址时，也能继续保存文件。
- 屏柜点表里放电开关 `fd_off` 的位置状态类型导出为「接地刀闸状态」。

### 验证

- Electron 导入导出：选目录后任务面板出现，主进程完成取地址和下载；开发者工具能看到 `[后台请求][主进程]`。
- 浏览器模式同一导出：不走任务中心，由 Axios 下载；接口返回 JSON 错误时提示后台文案。
- 实时监控录制小包：Electron 创建 `remote-export`（`/robot/tool/file/getRobotLog`）；已有进行中任务时提示稍后再试。
- 导出屏柜点表：`fd_off` 位置状态类型为接地刀闸状态，数字表表计类型仍为泄漏电流表。

## 2026-10-08 — 后台下载增加重试与地址校验，导出前先选择保存目录

- 提交：`18cd553`
- 类型：fix

### 修改

- 主进程后台下载由最多 2 次改为最多 3 次。网络失败，以及 408、425、429、500、502、503、504 会按 300ms、600ms 退避重试；重试前取消未读完的响应体。导出任务在等待重试时如果已取消，则直接停止。
- 下载失败不再只显示状态码，会尽量读取后台 JSON 里的 `message` / `msg` / `error`，没有 JSON 时截取短文本。
- 请求日志只保留来源和路径，去掉查询参数，避免把带参数的下载地址打进日志。
- 下载地址为空、或不是 HTTP/HTTPS（含 `javascript:` 等其它协议）时直接拒绝。相对路径仍拼到当前后台地址上。
- 导入导出页在真正请求导出接口之前，先检查是否已有进行中的下载任务，并先弹出保存目录。用户取消选目录时不会打导出接口。
- 创建下载任务和浏览器回退下载时，优先使用本次响应的 `baseURL` 来源；取不到再用当前后台 IP，避免页面上的旧 IP 和实际导出请求不一致。
- 回填上一条提交哈希 `edcc13a`。

### 优化

- 后台短暂 5xx 或超时不再一次失败就中断导出文件下载。
- 先选目录再导出，取消保存不会白打一次导出接口，也不会留下无人接收的导出结果。
- 下载地址限制在 HTTP/HTTPS，相对路径也不会被当成任意协议打开。

### 影响范围

- `packages/app/electron/ipc/export-task-ipc.ts`
- `packages/app/electron/ipc/file-ipc.ts`
- `packages/app/src/views/import-export/index.tsx`
- `CHANGELOG.md`

### 用户可见变化

- 导出或下载后台文件时，会先选择保存目录，再开始导出。
- 后台短暂不可用时会自动重试，失败提示更容易看到后台返回的原因。
- 非法下载地址会提示仅支持 HTTP/HTTPS，而不是继续请求。

### 验证

- 导入导出任一后台导出：先出现选目录框；取消后不应发出导出请求，按钮恢复可点。
- 选目录并确认：任务使用本次后台地址下载；已有进行中任务时提示「已有导出任务进行中」。
- 后台返回 503：主进程日志能看到重试，最多 3 次；返回业务错误 JSON 时界面提示含后台文案。
- 下载路径为 `javascript:` 或其他非 HTTP(S) 协议时提示「仅支持 HTTP/HTTPS 下载地址」。

## 2026-10-08 — 屏柜统一柜排协议，空间编辑补性能监控与点云卸载，导出只带当前地图屏柜

- 提交：`edcc13a`
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
