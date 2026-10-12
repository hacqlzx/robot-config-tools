# 打包与版本号

在项目根目录执行 `pnpm package`，终端显示当前版本和默认的新版本：

```text
当前版本 1.0.3，新版本 [1.0.4]（回车使用默认值，q 取消）：
```

- 直接回车：末位版本号加 1，例如 `1.0.3 -> 1.0.4`。
- 手动输入：可以使用 `1.1.0`、`2.0.0` 或 `1.1.0-beta.1`，也可以输入当前版本重新打包。
- 输入 `q` 或在版本选择阶段按 Ctrl+C：取消，尚未修改版本或运行打包准备。
- 输入格式错误时重新提示，不开始打包。

选择后更新 `packages/app/package.json` 的顶层 `version`，再执行原有的进程/产物清理、Electron 构建和 Windows NSIS 打包。成功后保留版本号供下一次递增；子步骤失败时恢复原版本号。若打包期间该文件被手动修改，则保留手动修改。强制终止进程或断电可能无法执行恢复，此时请检查版本号。

## 无交互打包

```powershell
pnpm package --auto                 # 默认末位加 1
pnpm package --version 1.1.0        # 指定版本
```

无交互终端必须使用上述显式参数，不会静默修改版本号。当前版本包含预发布/构建标记时，自动递增将去掉标记，例如 `1.1.0-beta.1 -> 1.1.1`。

## 开发与代理校验

```powershell
pnpm build                         # 浏览器构建
pnpm build:electron                # Electron 构建
pnpm package:check                 # 打包前构建校验，等同 Electron 构建
node --test packages/app/scripts/package-version.test.mjs
```

这些入口不调用版本选择逻辑，也不修改版本号。`package:check` 不执行进程/产物清理或生成 NSIS 安装包。代理日常构建校验使用这些入口；只有明确要求生成正式安装包时才执行 `pnpm package`。

## GitHub Releases 与应用更新

应用使用 `electron-updater`，更新源为公开仓库 `hacqlzx/robot-config-tools` 的正式 Releases。Windows 安装版每次启动后检查一次；底部版本号右侧可以手动检查，发现新版本时显示标记，点击「更新」下载，下载后点击「重启安装」并确认。开发/浏览器模式不检查更新。退出应用不会自动安装已下载更新。

`pnpm package` 只生成产物，显式禁止 electron-builder 自动上传，以免本地构建意外发布。正式发布时将 `release/` 下对应版本的 `RobotConfigTools-Setup-版本-x64.exe`、同名 `.exe.blockmap` 和 `latest.yml` 上传至同一个 `v版本` Release。安装包内的 `resources/app-update.yml` 由 `build.publish` 配置生成，包含更新源信息，不含发布令牌。

首次安装这一版本前的旧客户端尚未内置更新器，需要手动安装新包；以后可通过底部更新入口升级。当前发布仅提供 Windows x64 NSIS 安装包。
