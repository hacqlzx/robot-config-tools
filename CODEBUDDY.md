# robotConfigTools 项目架构速查（写给 AI 助手）

---

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 构建 | Vite 5.4 + TypeScript 5.5 | ESM |
| UI | React 18.3 + Ant Design 6.4 + SCSS | |
| 3D | PlayCanvas 2.18 + @playcanvas/pcui 6.1 | WebGL |
| 桌面 | Electron 42.3 + vite-plugin-electron 0.28 | 可选 |
| 路由 | react-router-dom 7.17 | Data Router |
| HTTP | axios 1.17 | |
| MQTT | mqtt 5.15 | |
| 状态 | 自定义发布/订阅模式 (无 Zustand) | |
| 包管理 | pnpm Monorepo (单包) | |

## 目录结构

```
packages/app/                     # 唯一 app 包
├── index.html                    # Vite 入口 HTML
├── vite.config.ts                # 双模式：浏览器 vs Electron（ELECTRON=true）
├── .env                          # VITE_API_TARGET=https://192.168.0.79
├── electron/
│   ├── main.ts                   # Electron 主进程
│   └── preload.cjs               # contextBridge 暴露 electronAPI
├── public/
│   ├── supersplate/              # supersplat 编辑器预构建产物（子应用嵌入）
│   └── static/lib/               # WASM 库：laz-perf / webp / lodepng
└── src/
    ├── main.tsx                  # 入口: ReactDOM.createRoot + RouterProvider
    ├── App.tsx                   # 根布局: Ant Design Layout + AppHeader + Outlet
    ├── vite-env.d.ts             # __ELECTRON__ 和 window.electronAPI 类型
    ├── config/menu.ts            # 6个菜单项配置
    ├── router/index.tsx          # 路由表（7条路由，默认重定向 / -> /space-edit）
    ├── pages/                    # 【当前活跃】页面组件
    │   ├── space-edit/index.tsx  # ★ 核心：3D点云查看器（PLY/SPLAT/LAS/LAZ）
    │   ├── image-edit/           # 占位
    │   ├── screen-verify/        # 占位
    │   ├── device-verify/        # 占位
    │   ├── connection-test/      # HTTP+MQTT 调试工具（完成）
    │   └── config/               # 配置管理（部分完成）
    │       └── station|robot|map|platform|network/
    ├── views/                    # 【旧版】相同功能的另一套实现，pages/是迭代后版本
    ├── components/               # 通用组件
    │   ├── app-header/           # 顶部导航栏（菜单+项目选择+厂站/机器人选择+后端连接+Electron窗口按钮）
    │   ├── backend-modal/        # 后台IP连接弹窗（ping检测+历史列表）
    │   └── ip-input/             # 四段式IP输入
    ├── stores/backendStore.ts    # 简易发布/订阅模式管理后端连接状态+IP持久化
    ├── services/http.ts          # axios实例：动态baseURL(localStorage IP) + req-id + 拦截器
    ├── api/config.js             # API: getAllFac() 获取厂站列表
    ├── styles/global.css + title-bar.scss
    └── playcanvas-core/          # ★ 3D引擎核心（从supersplat提取）
        ├── pc-app.ts             # PlayCanvas App容器
        ├── scene.ts              # 核心场景管理器（527行，E-C-S架构，3渲染层，按需渲染）
        ├── splat.ts              # 高斯泼溅数据类（776行）
        ├── controllers.ts        # 指针/触摸/键盘相机控制器（669行，轨道+飞行模式）
        ├── simple-camera.ts      # 简易轨道/飞行相机（页面直接使用）
        ├── pointcloud.ts         # 点云渲染
        ├── shaders/              # GLSL着色器（splat/pointcloud/position/bound/blit）
        ├── io/read/              # 数据读写：loader.ts(Splat)、las-reader.ts(LAS/LAZ)
        └── data-processor/       # 位置/包围盒/交叉检测计算
```

## 路由表

| 路径 | 组件 | 状态 |
|------|------|------|
| `/` → 重定向至 `/space-edit` | — | — |
| `/space-edit` | pages/space-edit | ★ 核心完成 |
| `/image-edit` | pages/image-edit | 占位 |
| `/screen-verify` | pages/screen-verify | 占位 |
| `/device-verify` | pages/device-verify | 占位 |
| `/config` | pages/config（含子导航） | 部分完成 |
| `/connection-test` | pages/connection-test | 完成 |

## 关键架构决策

1. **双端模式**: 通过 `ELECTRON=true` 环境变量在编译时切换 浏览器SPA / Electron桌面端，base 分别为 `/` 和 `./`
2. **React + PlayCanvas 混合**: Canvas 通过 `useRef` 嵌入 React，页面直接操作 PlayCanvas Engine API
3. **状态管理**: 无第三方库，`backendStore.ts` 是自定义发布/订阅，IP 通过 localStorage 持久化
4. **pages/ vs views/**: pages/ 是当前活跃版本（space-edit 增加了流式分块加载和非压缩LAS解析），views/ 是历史代码
5. **配置页**: 厂站/机器人/地图的 CRUD 表格和表单弹窗已完成（使用 mock 数据），平台/网络为占位
6. **后端 API**: 仅有 `getAllFac()` 一个已实现接口，axios baseURL 从 localStorage 动态读取 IP

## 常用命令

```bash
pnpm dev              # 浏览器开发模式（端口50050）
pnpm dev:electron     # Electron桌面端开发
pnpm build            # 构建浏览器版本
pnpm build:electron   # 构建Electron桌面端
```
