# Potree 资源目录

该目录保存与 `potree-develop` 官方示例配套的固定版本资源。业务代码不要直接从这里 import `potree.js`，后续统一通过 `SpaceSceneAdapter` 接入。

- `build/`：Potree Viewer、Worker、语言包、UI 和资源文件。
- `libs/`：官方示例依赖的 Three.js、jQuery、LAS/LAZ、WASM 等版本锁定资源。
- `PotreeConverter_2.1.3/`：Windows 离线转换工具，不属于浏览器运行资源。
- `potree-assets.ts`：前端可复用的 URL、CSS 和脚本顺序清单。
- `vite-potree-assets.ts`：开发服务和构建发布插件。
- `potree-runtime.ts`：按官方顺序加载 CSS/经典脚本，并向引擎适配器提供最小类型边界。

不要混用 npm 最新版 Three.js 替换 `libs/three.js`。Potree 构建产物与这套依赖存在版本耦合，升级时应整体替换并重新验证官方示例、Worker、WASM、GUI 和点云加载。

项目模型的 Converter 产物不放在本目录。Electron 主进程统一生成到 `项目/地图/{地图名}/.potree/`，renderer 通过受限的 `robot-project://asset/` 协议按 Range 读取。

运行资源发布到 `static/potree`，转换工具在 Electron 打包后位于 `resources/potree/PotreeConverter_2.1.3`。完整迁移边界和 TODO 见仓库根目录 `POTREE_MIGRATION.md`。
