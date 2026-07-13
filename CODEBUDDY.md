# robotConfigTools 项目架构速查

更新时间：2026-07-13。更完整的接手说明和修改约束见 `AGENTS.md`。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| Workspace | pnpm | `packages/app` + `packages/database` 两个包 |
| UI | React 18.3 + Ant Design 6.4 + SCSS | HashRouter，业务页位于 `src/views` |
| 3D | PlayCanvas 2.18 + laz-perf | 当前客户端模型主链路为 LAS/LAZ |
| 桌面 | Electron 42.3 + vite-plugin-electron 0.28 | 完整文件、数据库和归档能力只在 Electron 可用 |
| 数据 | sql.js | 本地数据库、迁移、Repository 和点表导入服务 |
| HTTP | axios 1.17 | 每次请求动态读取后台 IP，baseURL 为 `https://{ip}` |
| 状态 | `appContextStore` + `useSyncExternalStore` | 统一项目、机器人、后台 IP 和连接状态，兼容原 localStorage key |

## 目录结构

```text
packages/
├── app/
│   ├── electron/
│   │   ├── main.ts                 # 主进程组合入口
│   │   ├── app/                    # 生命周期、窗口
│   │   ├── ipc/                    # system/file/project/archive IPC
│   │   ├── project-core/           # 项目根、路径安全、manifest、文件服务
│   │   ├── db-ipc.ts               # 数据库 IPC
│   │   └── export-points.ts        # 点表和空间模型导出协议
│   ├── public/                     # laz-perf/webp/lodepng WASM、supersplate 静态资源
│   └── src/
│       ├── pages/                  # 应用外壳：顶部栏、后台弹窗
│       ├── views/                  # 当前业务页面
│       ├── components/three-d-engine/ # 通用 3D 引擎、点云加载和绘制回显
│       ├── components/image-canvas/   # 勘察图片画布和缩略图缓存
│       ├── playcanvas-core/        # 相机、LAS/LAZ 读取及历史 GSplat 能力
│       ├── services/http.ts
│       └── stores/appContextStore.ts # 统一应用上下文和后台订阅
└── database/
    └── src/
        ├── core/                   # sql.js 连接、自动保存和迁移执行
        ├── migrations/             # 当前 001～004
        ├── repositories/           # 设备层级和项目厂站绑定
        └── services/import.service.ts
```

## 路由表

| 路径 | 入口 | 当前状态 |
|------|------|----------|
| `/space-edit` | `views/space-edit` | 核心编辑页，默认路由 |
| `/image-edit` | `views/image-edit` | 勘察图像导入、标定、导出已接入，持续开发 |
| `/device-verify` | `views/device-verify` | 占位 |
| `/import-export` | `views/import-export` | 部分后台导入导出已接入，其余卡片占位 |
| `/config` | `views/config` | 厂站、机器人、地图、平台、网络后台配置 |

没有 `/screen-verify` 或 `/connection-test` 路由；`views/screen-verify` 目录目前未接入。

## 关键协议

- 项目根：开发环境默认使用仓库 `project/`；打包后可选择数据目录，配置保存在 Electron `userData/data-path.json`。
- 项目清单：`project/{项目}/project.manifest.json`，记录目录布局和地图/点表/勘察任务资产。
- 地图目录：`地图/{地图名}/map.las`、`map_info.json`、`description_file.json`、`reference_path.txt`。
- 区域协议：`description_file.json` 为 flat 数组，`type=1/2/4/8` 表示柜排/屏柜/充电区/设备区。
- 勘察目录：`勘察数据/{地图名}` 保存导入任务，`勘察数据/勘察数据.json` 保存跨地图标定。
- 数据库：开发默认 `data/robot-config.db`，当前迁移版本为 004。

## 架构边界

1. 浏览器模式适合 UI 调试；项目文件、点表数据库、空间模型和勘察归档依赖 `window.electronAPI`。
2. `space-edit` 和 `image-edit` 都复用 `ThreeDEngine`/`PointCloudLoader`；前者自行组装编辑态，后者使用 `useThreeDViewer` 只读组合层。
3. LAS 使用分块读取并按上限降采样；LAZ 仍整文件进入渲染进程和 WASM 内存，尚无 worker/取消/LOD。
4. 后台配置接口不再是 mock；`api/config.js` 包含厂站、机器人、地图、通信和导入导出等接口。
5. 项目、机器人和后台连接统一由 `appContextStore` 管理；项目切换会按 Outlet key 重建业务页，未选项目时不再回退到默认目录。

## 常用命令

```bash
pnpm dev              # 浏览器开发模式，端口 50050
pnpm dev:electron     # Electron 开发模式
pnpm build            # 浏览器构建
pnpm build:electron   # Electron 构建
pnpm package          # Windows NSIS 打包
```
