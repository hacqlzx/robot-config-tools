# 变更日志

每次 Git 提交前必须先更新本文件，新记录写在最上方。提交信息也要写清改了什么、为什么改，不能只写笼统标题。

填写要求：

- 按提交拆条，不要把多次提交混成一条。
- 同时写「修改」和「优化」：改了哪些行为/文件，以及带来什么体验或稳定性收益。
- 写清影响范围、关键文件、用户可见变化和验证方式。
- 不要写提交哈希，也不要写「待提交」或事后回填。已有历史条目保持原样。
- 本文件从 2026-09-24 起记录，更早提交不再补记。

---

## 2026-10-14 — 变更日志不再记录提交哈希

- 类型：chore

### 修改

- `AGENTS.md` 去掉提交后回填 commit hash 的要求。变更日志只写改动本身，不写提交哈希，也不再写「待提交」。
- `CHANGELOG.md` 开头的填写要求已在上一条提交中同步修改。已有历史条目里的哈希保持原样，不批量删改。

### 优化

- 提交时不用等哈希回填，也不会留下未提交的日志改动。

### 影响范围

- `AGENTS.md`
- `CHANGELOG.md`

### 用户可见变化

- 无界面变化。

### 验证

- 查看 `AGENTS.md` 提交日志一节和 `CHANGELOG.md` 开头，已不再要求填写提交哈希。

## 2026-10-14 — 一次性拆分旧总库，兼容已删除项目及后续新建同名项目

- 类型：fix

### 修改

- 修复客户升级启动时，旧总库残留已删除项目数据导致整批预检失败的问题。目录不存在的项目跳过，现存项目继续迁移；全部旧目录均已删除时也允许启动。
- 迁移台账新增可选 `skippedProjects`，保存项目名、缺少目录的原因和六张业务表各自的记录数；日志输出跳过信息。旧总库原样保留，不重建已删除目录。
- 兼容旧版 version 1 台账；未完成批次中删除的项目标为 `skipped`，批次完成前恢复目录时重新核验。同名但身份不同的目录仍拒绝迁移，空项目名、损坏数据库及关联冲突仍报错。
- 同步 `PROJECT_STORAGE_MIGRATION.md`，明确批次完成与全部旧数据迁出不同：存在跳过项目时应继续保留旧库以便恢复。
- 补齐初始化完成标记：全新安装没有旧库/项目，以及全部项目已有有效独立库时，同样持久化完成台账，来源指纹为 `null`。后续缺库不能回退到旧库按名字拆分，也不会因为后来出现旧备份而自动导入。
- 已迁移项目删除后重建同名项目、目录被跳过后新建同名项目，均使用新的稳定项目 ID 和空数据库；后续启动直接使用新库，不恢复旧快照中的数据。跳过缺失目录后继续当次启动，不要求客户重启。

### 优化

- 已删除历史项目不再阻塞客户启动或剩余项目拆分，跳过数据可通过台账追溯，旧库仍可用于人工恢复。
- 保留现存项目的身份、完整性与来源校验，避免将真实损坏或目录身份冲突当成已删除项目忽略。
- 用持久化完成状态固定一次性升级边界，使全新安装及已有独立库的启动行为与完成拆分后的行为一致。

### 影响范围

- `packages/app/electron/project-core/project-database-migration.ts`
- `packages/app/scripts/project-database-migration.test.mjs`
- `PROJECT_STORAGE_MIGRATION.md`
- 仅影响升级时旧总库拆分及未完成批次恢复，不修改项目数据库结构。

### 验证

- `node --test packages/app/scripts/project-database-migration.test.mjs`：22 组通过。覆盖部分/全部项目目录已删除、旧台账恢复中删除项目、已跳过目录恢复及身份冲突、删除/跳过后新建同名项目、无旧库和已有独立库初始化，验证源库不变、新项目为空及完成状态持久化。
- 新增独立 Node 进程模拟客户旧库残留 `test`、`智洋培训` 且目录已删除的情形：当次初始化成功，新建同名项目并写入新点位后，后续进程不回填旧数据；完成后的旧备份损坏也不影响新项目。另在第二个项目发布时注入真实文件重命名失败，验证新进程续传、临时文件清理及首个已完成项目字节不变。Electron 外壳使用测试替身，未运行客户电脑上的安装包。
- Electron 主进程 TypeScript 检查、`pnpm build:electron` 和 `git diff --check` 均通过；未生成正式安装包。

## 2026-10-13 — 默认打包版本改为补丁号序列递增

- 提交：待提交
- 类型：chore

### 修改

- 默认下一版本不再把补丁号加 1。单数字补丁号在末尾追加 `1`，之后按数值递增：`1.0.7 -> 1.0.71 -> 1.0.72`。`1.0.0` 仍变成 `1.0.1`。手动输入 `1.0.8` 就按 `1.0.8` 打包，下次默认是 `1.0.81`。
- 当前 `packages/app/package.json` 版本从 `1.0.7` 改为 `1.0.71`，作为这条规则的当前记录。本次没有重新打安装包。
- `PACKAGING.md` 的示例和 `--auto` 说明改成同一规则。
- 回填上一条提交哈希 `b0420b2`。

### 优化

- 正式包可以从 `1.0.7` 走到 `1.0.71`，不用跳到 `1.0.8` 才能和已发布的 `1.0.7` 区分。
- 无交互 `--auto` 和交互回车使用同一个默认版本，指定 `--version` 时不会被自动改写。

### 影响范围

- `packages/app/scripts/package-version.mjs`
- `packages/app/scripts/package-version.test.mjs`
- `packages/app/package.json`
- `PACKAGING.md`
- `CHANGELOG.md`

### 用户可见变化

- 下次执行 `pnpm package` 时，当前版本显示 `1.0.7` 已不再是默认起点；记录版本是 `1.0.71`，再打包默认提示 `1.0.72`。已安装的 `1.0.7` 安装包不变。

### 验证

- `node --test packages/app/scripts/package-version.test.mjs` 通过，覆盖 `1.0.7 -> 1.0.71 -> 1.0.72` 和手动 `1.0.8`。

## 2026-10-13 — 保存目录迁移改为全程复制，旧移动台账可续传

- 提交：`b0420b2`
- 类型：fix

### 修改

- 新的保存目录迁移不再对项目根目录做 `rename`。同卷也走可续传的复制：写版本 2 直写台账，核对清单、大小和修改时间，成功后再清理原目录。清理重试从 3 次、间隔 200ms 调整为 20 次、间隔 250ms。
- 未完成的版本 3 移动台账：目标已是迁走的原目录时补写配置并标记完成；源目录还在且目标为空或不存在时改成复制续传；目标里已有其他文件则两边都保留并拒绝覆盖。
- 启动恢复用 `lstat` 确认是真实目录，不用链接冒充。源目录和空目标同时存在时继续用源目录，设置里可以继续迁移，不再因为两边都在就报状态不明确。
- 回填上一条提交哈希 `f40aa4c`。

### 优化

- Windows 上目录被占用或没有整目录改名权限时，迁移不会卡在 rename，已复制的文件可以续传。
- 旧版移动中断后，空目标不会被当成冲突；非空目标也不会被覆盖。

### 影响范围

- `packages/app/electron/project-core/directory-migration.ts`
- `packages/app/electron/project-core/project-root.ts`
- `packages/app/scripts/project-storage-migration.test.mjs`
- `CHANGELOG.md`

### 用户可见变化

- 迁移保存目录时始终复制再清理原目录，不再整目录改名。旧的未完成移动可以在设置里继续；目标目录不空时会提示未覆盖任何文件。

### 验证

- `node --test packages/app/scripts/project-storage-migration.test.mjs` 通过，覆盖同卷复制、不调用 rename、旧移动台账续传和启动恢复。

## 2026-10-13 — 迁移保存目录前关闭全部数据库连接

- 提交：`f40aa4c`
- 类型：fix

### 修改

- 数据库包装器记录是否已关闭，并登记本进程打开的全部连接。目录迁移调用 `closeAllDatabaseConnections`，把项目库、全局库和未纳入会话的库都关掉；只读库直接丢弃，可写库先落盘再关。
- 重复关闭不再写盘。关闭失败会汇总路径和原因，不会悄悄留下仍占用文件的连接。
- 项目库会话在全部连接处理完后再清空；某个库已关闭才从打开列表移除，关闭失败的句柄仍留在列表里。
- 回填上一条提交哈希 `bd50b96`。

### 优化

- 迁移或退出时不再只关当前项目库，避免其它已打开的库占着文件，导致 Windows 上删不掉或搬不走数据库。
- 关闭后重新打开会换新的会话版本，旧页面请求不会写进新库。

### 影响范围

- `packages/database/src/core/connection.ts`
- `packages/database/src/index.ts`
- `packages/app/electron/project-core/project-database.ts`
- `packages/app/scripts/project-database-migration.test.mjs`
- `CHANGELOG.md`

### 用户可见变化

- 迁移保存目录时，已打开的项目库和总库会先保存并关闭。关闭失败会提示具体库路径，而不是迁移做到一半才报文件被占用。

### 验证

- `node --test packages/app/scripts/project-database-migration.test.mjs` 中「目录迁移关闭所有项目、全局和未托管数据库连接」通过。

## 2026-10-13 — 核验 1.0.7 安装包并完善 GitHub 发布说明

- 提交：`bd50b96`
- 类型：docs

### 修改

- 回填打包提交 `43dccf1`，补充本次 GitHub 发布核验记录。按项目拆库、保存目录迁移、后台连接布局、提交约定和版本号已经分别提交，本次只补充发布文档。
- 复用已成功生成的 Windows x64 1.0.7 安装包，发布附件为 `RobotConfigTools-Setup-1.0.7-x64.exe`、同名 `.exe.blockmap` 和 `latest.yml`；安装包不纳入 Git。
- 将当前 `feat/las-adaptation` 分支的最新提交推送至 GitHub 同名分支，创建 `v1.0.7` Release，并完善项目拆库、目录迁移、界面改进、安装升级和验证说明。按用户后续安排，安装包附件由用户上传；说明更新保持用户已完成的附件和公开发布状态。

### 优化

- 核对 `app.asar` 中 755 个构建文件与当前本地产物完全一致，包内版本为 1.0.7；安装包大小和 SHA-512 与 `latest.yml` 一致，避免发布旧构建或缺失更新器附件。
- 核对 GitHub 当前分支是本地提交的祖先，使用正常快进推送；不覆盖已有发布资产，不重复递增版本或重新打包。

### 验证

- 包内文件逐一比对：755 个文件，差异 0、缺失 0；安装包 168118959 字节，SHA-512 匹配更新清单。
- 当前代码已通过项目数据库 11 组和目录/userData 迁移 28 项回归、数据库/主进程类型检查及 Electron 构建；1.0.7 打包已成功。

---

## 2026-10-13 — 打包版本 1.0.7

- 提交：`43dccf1`
- 类型：chore

### 修改

- `pnpm package --auto` 将应用版本从 `1.0.6` 递增到 `1.0.7`，并生成 Windows 安装包 `RobotConfigTools-Setup-1.0.7-x64.exe`、blockmap 和 `latest.yml`。安装包不进 Git。
- 回填上一条提交哈希 `182d4a1`。

### 优化

- 这一版安装包带上按项目拆库、保存目录迁移和后台连接页改版，可供正式发布。

### 影响范围

- `packages/app/package.json`
- `packages/app/release/`（本地产物，已忽略）
- `CHANGELOG.md`

### 用户可见变化

- 安装包版本号为 1.0.7。

### 验证

- `pnpm package --auto` 完成，日志末尾为「打包完成，应用版本已保存为 1.0.7」。

## 2026-10-13 — 约定按功能模块分批提交

- 提交：`182d4a1`
- 类型：chore

### 修改

- `AGENTS.md` 写明提交必须按功能模块拆开：同一模块的代码、样式和日志进一次提交；用户只说「提交」且工作区有多个模块时，先列出拆分方案，不要默认 `git add` 全部文件。
- 回填上一条提交哈希 `84bc23a`。

### 优化

- 后续提交不会再把互不相关的功能和样式混成一个提交，日志和回滚范围跟模块对齐。

### 影响范围

- `AGENTS.md`
- `CHANGELOG.md`

### 用户可见变化

- 无界面变化。

### 验证

- 阅读 `AGENTS.md` 提交日志一节，能看到按模块分批提交的要求。

## 2026-10-13 — 重做设置里的后台连接页

- 提交：`84bc23a`
- 类型：style

### 修改

- 后台连接页改成三块：当前连接、添加 IP、已保存列表。当前地址单独成行并带连接状态；添加 IP 改为上下布局，重置和连接跟在输入框右侧。
- IP 列表显示地址数量，当前正在使用的地址标「当前」。连接和删除改成图标按钮并加提示，空列表用统一空状态。
- `IpInput` 支持传入 className，设置页里的输入框拉宽对齐。设置弹窗宽度从 780 调到 860，左侧菜单样式改由样式表控制。
- 回填上一条提交哈希 `5f587f9`。

### 优化

- 当前连接、待添加地址和历史地址分开，不用在一行里挤 IP 和按钮。
- 列表里能直接看出哪个是当前后台，窄一点的设置窗口里输入框也不再挤在一起。

### 影响范围

- `packages/app/src/pages/backend-modal/index.tsx`
- `packages/app/src/pages/backend-modal/index.scss`
- `packages/app/src/pages/settings-modal/index.tsx`
- `packages/app/src/pages/settings-modal/index.scss`
- `packages/app/src/components/ip-input/index.tsx`
- `CHANGELOG.md`

### 用户可见变化

- 设置 → 连接后台的布局、间距和按钮样式变化。连接、重置、删除行为不变。

### 验证

- 打开设置的连接后台：能添加、连接、删除 IP，当前地址有「当前」标记。
- 切换到图像标注和项目存储，弹窗宽度和左侧菜单仍可切换。

## 2026-10-13 — 首次启动自动拆分旧总库并按项目加载数据库

- 提交：`5f587f9`
- 类型：feat

### 修改

- 在创建业务窗口前自动检查旧总库及当前项目目录，按项目拆分六张业务表到 `database/robot-config.db`；源库仅做内存结构兼容，禁用写回，保留旧文件作备份。
- 新增 `project-database-migration.ts`、`project-database.ts` 和 schema 007 身份表。保留原始字段、主键、关联、标定 ID、自增序列及标定序列；以临时库、归属预检、数量/关联/完整性校验、原子发布和独立台账实现中断恢复。
- 主进程串行管理项目会话，IPC 携带项目及会话版本；切项目拒绝旧会话和项目不匹配请求。`App.tsx` 在项目数据库加载成功后挂载业务页，失败提供错误和重试，迁移目录期间停止切库。
- 项目创建、重命名、删除、摘要、点表导入/屏柜同步、空间模型和勘察/标识/屏柜点表/法线/巡检点导出及导出任务预检全部使用对应项目库。项目重命名在同一数据库事务中更新业务项目名和库内身份；保存目录迁移前排空操作、写盘并关闭库，切根后重新打开。
- 修复实际启动错误「项目数据库元数据缺失：测试」：库已经拆分成功，清单却被旧格式写回而丢失数据库字段。现在核验现有库的项目 ID、名称、格式、完整性及迁移来源后，仅补回清单元数据，不覆盖业务记录或重新拆分。
- 更新 `PROJECT_STORAGE_MIGRATION.md`，区分已实现自动拆分/切库、旧库保留和后续安装环境验收。新增临时数据库回归脚本；没有修改现场数据库或生成正式安装包。

### 优化

- 完成迁移后不再依赖旧总库，项目改名、删除、新建、目录搬迁以及旧库删除/变化不会重复拆分或复活已删除项目。
- 对未归属数据、目标库身份冲突、重复点位、关联缺失、源库变化及项目库损坏/缺失明确中止，避免静默丢数据、创建空库或用旧快照覆盖新编辑。
- 数据库及清单以临时文件加原子重命名写盘；普通文件 API 禁止修改数据库及其目录。退出时等待数据库操作队列，保存失败保留应用；无结构升级时不再因检查版本而整库重写。
- 验证：11 组项目数据库临时回归、28 项已有项目目录/userData 迁移回归通过；数据库与 Electron 主进程 TypeScript 检查及 `pnpm build:electron` 通过。现场两个项目库只读检查完整性和十组关联通过，正式安装环境仍需端到端验收。

---

## 2026-10-13 — 项目保存目录改为设置里迁移，并统一界面留白

- 提交：`a1b7e9e`
- 类型：feat

### 修改

- 保存目录只在「设置 → 项目存储」修改。项目管理去掉「选择目录」，路径只读；未配置时提示去项目存储。新建项目不再弹出选目录框。
- 修改目录会迁移该目录下全部项目文件，成功后才写入 `userData/data-path.json`。同卷优先整目录移动并记版本 3 台账（源目录卷、文件索引、创建时间）；只有明确跨卷 `EXDEV` 才复制。目标必须是空目录，且不能和源目录互相包含；junction 用真实路径校验。链接和特殊文件直接拒绝。
- 复制中断可对同一目标「继续迁移」。配置已切到新目录后，旧目录清理失败只给警告，不回退。启动若发现目录已移动但配置未落盘，按身份补写配置，不创建空的旧源目录。已配置目录丢失时提示恢复，不静默换成空目录。
- SHA-256 内容校验暂时关闭以缩短迁移时间，代码保留；复制模式仍核对文件清单、大小和修改时间。
- 打包后默认目录改为用户文档下的 `RobotConfigTools/project`，不再把业务数据放进安装目录。安装目录或旧 `app/project` 里已有数据时继续读取，空目录不算旧数据。开发环境仍用仓库 `project`。
- 正式包启动前把旧 `%APPDATA%/app` 里尚未存在的持久化文件补到 `%APPDATA%/RobotConfigTools`，不覆盖、不删除旧目录，跳过缓存和符号链接。失败则弹窗退出，下次可重试。开发模式不搬。应用名固定 `RobotConfigTools`，可执行文件名同步，`asar` 打开，版本号改为 `1.0.6`。
- 迁移前排空标定保存队列，并保存屏柜图像里尚未落盘的标注。标定绑定、识别、编辑弹窗或空间保存进行中会拦住迁移。迁移期间卸载业务页、禁止新的项目文件操作和关闭窗口；结束后按存储版本重建页面，并清掉屏柜图像源、设备验证会话里的旧路径缓存。
- 设置弹窗改为固定 520px 内容高度，窄窗口收缩；标题和导航固定，分页内容单独滚动。全局统一页面/卡片 16px、侧栏 12px、工作区 8px 留白。空间场景上右下留 8px、左侧贴齐，视口圆角 8px。运维内容区外圈 8px 留白加圆角，内部 24px。
- 数据库仍是原来的总库，本轮不拆库、不搬库。方案记在 `PROJECT_STORAGE_MIGRATION.md`。
- 回填上一条提交哈希 `1b4dba7`，并补记 1.0.5 正式发布与更新检查结果。

### 优化

- 换保存目录不会只改配置、把旧项目留在原地，也不会在复制完成前切到空目录。
- 同卷移动不再整份复制点云；跨卷才复制，进度按复制、更新路径、清理三段显示。
- 升级后用户数据目录和应用可执行文件名不再跟着 npm 包名 `app` 走，已有安装目录数据也不会升级后变成空项目。
- 设置分页切换时弹窗高度不再跳动；各业务页留白对齐。

### 影响范围

- `packages/app/electron/project-core/directory-migration.ts`
- `packages/app/electron/project-core/project-root.ts`
- `packages/app/electron/project-core/project-activity.ts`
- `packages/app/electron/app/legacy-user-data-migration.ts`
- `packages/app/electron/main.ts`
- `packages/app/electron/ipc/*`
- `packages/app/src/pages/storage-settings/`
- `packages/app/src/pages/settings-modal/`
- `packages/app/src/pages/app-header/`
- `packages/app/package.json`
- `packages/app/scripts/project-storage-migration.test.mjs`
- `packages/app/scripts/legacy-user-data-migration.test.mjs`
- `PROJECT_STORAGE_MIGRATION.md`
- 设置、空间编辑、勘察、屏柜/设备验证、导入导出、运维配置的样式文件

### 用户可见变化

- 设置里多了「项目存储」：选空目录后点「迁移并保存」，可看进度；未完成时显示「继续迁移」。
- 项目管理不能再改保存目录。迁移过程中主界面显示「正在迁移项目文件…」，此时不能关窗口。
- 打包版新安装的默认项目目录在「文档/RobotConfigTools/project」。版本号显示为 1.0.6。
- 设置弹窗和各业务页留白、圆角更一致。

### 验证

- 目录迁移与旧用户数据迁移脚本：`node --test packages/app/scripts/project-storage-migration.test.mjs`、`node --test packages/app/scripts/legacy-user-data-migration.test.mjs`。
- 界面：`pnpm build` 已通过（空 mqtt chunk 与大 chunk 提示仍在）。设置三个分页高度一致；560×620 下导航、滚动和按钮可达。空间编辑、勘察、屏柜、设备验证、导入导出、运维页面无横向溢出。浏览器空数据未覆盖桌面迁移。
- 桌面：同卷迁移后项目列表和当前项目仍在；取消或占用失败时原目录配置不变。有未完成台账时设置显示继续迁移。

---

## 2026-10-12 — 接入 GitHub 自动更新，增加底部版本栏并准备 1.0.5 发布包

- 提交：`1b4dba7`
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
- 正式发布完成：源码提交 `1b4dba7` 已推送 GitHub，`v1.0.5` Release 含安装包（169,711,461 字节）、blockmap 和 latest.yml；上传后的 GitHub SHA-256/文件大小与本地一致，匿名下载 latest.yml 与本地逐字节一致。通过临时系统代理完成 Git 推送，未修改全局 Git 配置；失败上传留下的空草稿已清理。
- 真实 electron-updater GitHub provider 检查：临时 1.0.4 测试客户端识别 1.0.5 并进入 available，实际 1.0.5 打包应用启动检查得到当前已为最新版本；没有自动下载或安装。
- 临时旧版本客户端显式下载验证通过：不存在旧版本 blockmap 时正确回退完整下载，进度达到 100%，electron-updater 校验下载产物并进入 downloaded。未执行安装，所有本次创建的应用冒烟测试进程均已关闭。

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
