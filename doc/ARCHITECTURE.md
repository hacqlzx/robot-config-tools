# 机器人配置工具 - 技术架构设计文档

---

## 一、项目概述

搭建一个机器人配置功能的软件，需要同时支持**浏览器端**和 **Electron 桌面端**。核心功能包括三维场景的渲染与编辑、机器人参数配置、本地模型/图片资源管理，以及通过 HTTP + MQTT 与后端通信。

---

## 二、框架选型：React vs Vue3

| 维度 | React 18+ | Vue 3 |
|------|-----------|-------|
| Vite 集成 | 官方 `@vitejs/plugin-react` 稳定成熟 | 天然亲缘关系（尤雨溪同时主导），但差距已很小 |
| Electron 集成 | `vite-plugin-electron` 支持良好 | 同样支持，无明显差异 |
| TypeScript | 生态更偏向 TS，类型推导优秀 | 支持良好，Composition API 与 TS 配合佳 |
| 学习曲线 | JSX、Hooks 心智模型 | SFC 单文件组件更直观，模板语法易上手 |
| 状态管理 | Zustand / Jotai（轻量，适合 3D 场景高频更新） | Pinia（官方推荐，响应式友好） |
| UI 组件生态 | Ant Design、PCUI 均可使用 | Ant Design、PCUI 均可使用 |

### 结论：推荐 React

> 核心理由：已有 supersplat 项目基于 React 体系进行过改造，团队对 React + PlayCanvas 的混合架构有实践经验，迁移成本最低。

---

## 二-B、3D 引擎选型：PlayCanvas vs Three.js

由于用户之前改造过 supersplat（基于 PlayCanvas），需要明确新项目的 3D 引擎方案。

| 维度 | PlayCanvas | Three.js |
|------|-----------|----------|
| 引擎类型 | 完整游戏引擎（Entity-Component 架构） | 轻量渲染库 |
| 编辑器 | 内置 Web 编辑器 | 无（需自行搭建） |
| 模型加载 | 内置 GLTF/FBX/OBJ 支持，资源管线成熟 | GLTFLoader 等独立 loader |
| PBR 渲染 | 内置物理渲染管线 | 需自行配置材质 |
| 变换控制 | 编辑器内置 Gizmo | 需 `TransformControls` 或自行实现 |
| React 集成 | 命令式嵌入 Canvas，通过 ref 控制 | `react-three-fiber` 声明式绑定 |
| 迁移成本 | **低**：团队有 supersplat 改造经验 | **中**：需重新学习 r3f 生态 |
| 社区生态 | 较小，但引擎本身功能完整 | 极大，社区资源丰富 |
| 性能 | GPU-driven，移动端优化好 | 灵活，手动优化空间大 |
| 文件大小 | ~1.5MB（engine only） | ~700KB（core only） |

### 结论：推荐 PlayCanvas

> 核心理由：
> 1. **团队经验**：已改造过 supersplat（PlayCanvas + React 混合架构），直接复用技术积累
> 2. **引擎完备性**：PlayCanvas 内置 PBR 渲染、模型加载、变换 Gizmo，不需要额外拼装
> 3. **React 集成策略**：PlayCanvas 作为 Viewport 嵌入 React 应用，React 管理 UI 面板和状态，PlayCanvas 专注 3D 渲染，分工清晰
> 4. **参考项目**：supersplat 已验证了 React + PlayCanvas + Vite 的技术可行性

---

## 三、技术栈总览

### 3.1 核心技术

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 构建工具 | **Vite 5+** | 替代 Rollup 脚手架，开发 HMR 极快。底层 Rollup + esbuild |
| 前端框架 | **React 18** + TypeScript | 应用外壳 + UI 面板 |
| 桌面端 | **Electron 28+** | 跨平台桌面应用 |
| 3D 引擎 | **PlayCanvas** | 完整 WebGL 游戏引擎，独占 `<canvas>` 负责 3D 渲染 |
| 3D 编辑器 UI | **@playcanvas/pcui** | PlayCanvas 官方 UI 组件库（supersplat 同款），用于 3D 编辑器的内部面板 |
| PlayCanvas 别名 | Vite `resolve.alias` | 开发/生产切换 `.dbg` 版本 |
| 路由 | **React Router v6** | 页面路由 |

### 3.4 UI 组件（双轨制）

| 层级 | 技术选型 | 适用区域 |
|------|----------|----------|
| 应用外壳 | **Ant Design 5** | 全局布局壳、路由页面（仪表盘、设置、模型管理）、顶部导航、侧边栏 |
| 3D 编辑器面板 | **@playcanvas/pcui** | 3D Viewport 内的树形控件、工具栏、属性面板、弹出菜单（supersplat 核心编辑 UI） |
| CSS 方案 | **SCSS**（PCUI 主题） + **Ant Design CSS-in-JS** | 两者隔离，互不污染（详见下节） |

> **架构分层**：Ant Design 做项目"壳"（Shell），PCUI 做 3D 编辑器"芯"（Core）。类比：VS Code 的菜单/侧栏是 Ant Design，编辑器视口内的操作面板是 PCUI。两者职责清晰、命名空间隔离。

### 3.2 状态管理 & 数据层

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 全局状态 | **Zustand** | 轻量、无 boilerplate、适合高频更新 |
| 服务端请求 | **TanStack Query (React Query)** | 缓存、重试、自动刷新 |
| HTTP 客户端 | **axios** | 请求拦截、文件上传 |
| MQTT 客户端 | **mqtt.js** | 与机器人实时通信，订阅/发布遥测指令 |

### 3.3 本地存储

| 场景 | 技术选型 | 说明 |
|------|----------|------|
| 浏览器端（KV） | **localforage** | IndexedDB 降级方案，Promise API |
| 浏览器端（数据库） | **Dexie.js** | 功能型 IndexedDB 封装，支持索引查询 |
| 模型/图片文件 | **File System Access API** (浏览器) / **IPC + Node fs** (Electron) | 大文件本地读写 |
| Electron 本地持久化 | **electron-store** | JSON 配置持久化 |
| Electron 大文件 | **原始 fs 模块** | 配置文件夹、模型缓存目录 |

### 3.5 工程化

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| Electron + Vite 集成 | **vite-plugin-electron**（推荐）/ electron-vite（备选） | 对现有 Vite 项目侵入最小 |
| 桌面端打包 | **electron-builder** | 跨平台打包分发 |
| 代码规范 | **ESLint** + **Prettier** | 统一代码风格 |
| 测试 | **Vitest** + **React Testing Library** | Vite 原生测试框架 |
| 包管理 | **pnpm** | 节省磁盘空间 |

---

## 四、Electron + Vite 集成方案选型

在 Vite 基础上叠加 Electron，需要处理三个层面的问题：

| 层面 | 内容 | 难度 |
|------|------|------|
| **构建层** | renderer 用 Vite，main/preload 也要编译，打包分发 | ★★★ |
| **通信层** | File System Access API → Electron IPC 替代 | ★★☆ |
| **运行时** | 浏览器模式 vs Electron 模式的条件分支 | ★★☆ |

### 工具链对比

| 方案 | 工具 | 适用场景 |
|------|------|----------|
| **vite-plugin-electron** | Vite 插件，在 renderer 构建时自动编译 main/preload | 在现有 Vite 项目上附加 Electron，侵入最小（**推荐**） |
| **electron-vite** | 一个配置同时处理 main + preload + renderer | 全新的 Electron + Vite 项目，集成度最高 |
| **手动双配置** | `vite.config.renderer.ts` + `vite.config.main.ts` | 需要最大控制力时 |

> **本项目推荐使用 `vite-plugin-electron`**，因为可以在一个 `vite.config.ts` 中统一管理浏览器模式和 Electron 模式，通过环境变量切换。

---

## 五、项目结构

```
robotConfigTools/
├── package.json                    # 项目配置 + electron-builder 配置
├── pnpm-lock.yaml
├── tsconfig.json
├── postcss.config.js               # PostCSS 配置（autoprefixer）
│
├── electron/                       # Electron 专属（主进程 + preload）
│   ├── main.ts                     # Electron 主进程入口
│   └── preload.ts                  # preload 脚本（contextBridge 暴露 IPC）
│
├── public/                         # 静态资源（Vite publicDir）
│   └── models/                     # 内置默认 3D 模型（.glb/.gltf）
│
├── src/                            # 业务源码
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 根组件（含路由 + 双端环境初始化）
│   ├── global.d.ts                 # 全局类型声明（ElectronAPI 等）
│   ├── routes/                     # 路由配置
│   ├── pages/                      # 页面组件
│   │   ├── dashboard/              # 仪表盘/概览
│   │   ├── robot-editor/           # 机器人配置编辑
│   │   ├── scene-3d/               # 3D 场景编辑
│   │   └── settings/               # 系统设置
│   ├── components/                 # 通用 UI 组件
│   ├── playcanvas/                  # PlayCanvas 3D 相关
│   │   ├── viewport/                # Viewport 组件（嵌入 PlayCanvas Canvas）
│   │   │   ├── Viewport.tsx         # PlayCanvas 应用外壳组件
│   │   │   ├── SceneSetup.ts        # 场景初始化（相机、灯光、地面）
│   │   │   └── CameraController.ts  # 相机轨道控制
│   │   ├── entities/                # PlayCanvas Entity 工厂
│   │   │   ├── RobotEntity.ts       # 机器人模型 Entity 创建
│   │   │   ├── GridEntity.ts        # 网格地面
│   │   │   └── GizmoEntity.ts       # 变换 Gizmo
│   │   ├── systems/                 # 自定义 PlayCanvas 系统（可选）
│   │   └── utils/                   # PlayCanvas 工具函数
│   │       └── materialUtils.ts     # 材质/高亮等
│   ├── stores/                     # Zustand 状态管理
│   │   ├── robotStore.ts           # 机器人配置状态
│   │   ├── sceneStore.ts           # 3D 场景状态
│   │   └── fileStore.ts            # 本地文件/模型管理
│   ├── services/                   # API 服务层
│   │   ├── http.ts                 # HTTP 请求封装（axios）
│   │   ├── mqtt.ts                 # MQTT 连接管理
│   │   ├── robotApi.ts             # 机器人相关 API
│   │   └── fileApi.ts              # 文件上传下载 API
│   ├── storage/                    # 本地存储层
│   │   ├── db.ts                   # Dexie.js 数据库定义
│   │   ├── modelCache.ts           # 3D 模型本地缓存
│   │   └── configStorage.ts        # 配置文件本地存储
│   └── styles/                     # 全局样式
│       └── global.scss
│
├── index.html                      # Vite 入口 HTML
├── vite.config.ts                  # Vite 配置（浏览器 + Electron 双模式统一）
├── electron-builder.json5          # electron-builder 打包配置
│
├── supersplat/                     # supersplat 源码（git submodule / 复制）
│   ├── src/                        # supersplat 原始源码（PCUI 编辑器 + PlayCanvas 逻辑）
│   │   ├── ui/                     # PCUI 面板组件（树形控件、工具栏、属性面板等）
│   │   ├── scene-3d/              # 3D 场景逻辑
│   │   └── index.ts               # supersplat 入口
│   ├── static/                     # supersplat 静态资源
│   └── node_modules/              # supersplat 原始依赖（playcanvas, pcui 等）
│
└── vite.config.supersplat.ts       # supersplat 的独立 Vite 适配层（按需）
```

### 5.1 Monorepo 扩展结构（可选）

当项目规模增长到需要多团队/多子项目协作时，可扩展为 monorepo：

```
robotConfigTools/
├── pnpm-workspace.yaml             # pnpm workspace 声明
├── package.json                    # 根 workspace（electron-builder 配置放此处）
│
├── packages/
│   └── shared/                     # 共享模块
│       ├── src/
│       │   ├── types/              # 公共 TS 类型（robot.ts, mqtt.ts 等）
│       │   └── utils/              # 工具函数（纯逻辑，无 DOM 依赖）
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   └── desktop/                    # 应用本体 = 原单项目结构移入此处
│       ├── electron/               # Electron 主进程 + preload
│       │   ├── main.ts
│       │   └── preload.ts
│       ├── public/                 # 静态资源
│       ├── src/                    # 业务源码（同单项目结构）
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json
│       └── .electron-builder.json5 # electron-builder 配置
└── ...
```

### 5.2 Monorepo 对 Electron 打包的影响

**结论：无实质影响，只需确保 shared 包被内联打包进 `dist/`，不依赖运行时 node_modules 解析。**

#### 原理

electron-builder 只打包 `files` 配置中匹配的文件。monorepo 的 shared 包如果以**源码形式**存在（`packages/shared/src/`），运行时将无法加载，因为：

1. `node_modules` 中 `packages/shared` 是 pnpm 的符号链接，指向 `../../packages/shared`
2. electron-builder 可能不会把这个链接目标的源码目录包含进最终安装包
3. 即使包含了，TypeScript 源码也无法直接在 Node/浏览器中执行

#### 解决方案：Vite 内联打包（推荐，零额外配置）

在 `vite.config.ts` 中，Vite 通过 `resolve.alias` 直接解析 shared 包的源码路径。Vite build 时会将 shared 包的代码**内联编译**进 `dist/`，不再依赖外部 `node_modules`。

```typescript
// apps/desktop/vite.config.ts
resolve: {
  alias: {
    '@shared': path.resolve('../../packages/shared/src'),
    // ... 其他 alias
  },
},
```

**built 后 `dist/` 内部结构**：
```
dist/
├── assets/
│   ├── index-abc123.js     # 包含 shared 包的代码（已内联）
│   └── ...
└── index.html
```

此时 electron-builder 只需：
```json5
// .electron-builder.json5
{
  "files": [
    "dist/**/*",
    "dist-electron/**/*"
  ]
}
```

shared 包的代码已内联在 `dist/assets/index-xxx.js` 中，无需额外配置。

#### 备选方案：shared 包预构建（需要额外步骤）

如果 shared 包需要独立发布或被非 Vite 项目引用：

```
packages/shared/
├── src/       # TypeScript 源码
├── dist/      # tsc/tsup 构建产物
└── package.json  # "main": "./dist/index.js"
```

此时 electron-builder 需要把 shared 的 `dist/` 也纳入打包：

```json5
// .electron-builder.json5
{
  "files": [
    "dist/**/*",
    "dist-electron/**/*",
    "packages/shared/dist/**/*"    // 额外包含
  ]
}
```

#### 两方案对比

| 维度 | Vite 内联（推荐） | shared 预构建 |
|------|-------------------|---------------|
| shared 包依赖方式 | `@shared` → 源码 alias | `@shared` → `dist/index.js` |
| shared 是否需要构建 | 否 | 是（`tsc`/`tsup`） |
| electron-builder 配置 | `files: ["dist/**/*"]` 够用 | 需额外加 `packages/shared/dist/**/*` |
| 构建顺序 | 无要求 | shared 必须先构建 |
| 产物大小 | 可能重复打包（每个 consumer 各一份） | 共享一份引用 |
| 适用场景 | 小型 shared 包，类型/工具函数（本项目推荐） | shared 包体量大，或多个 consumer 复用 |

> **本项目推荐 Vite 内联方案**。shared 包主要是类型定义和工具函数，体量小，内联打包最简洁，electron-builder 零额外配置。

---

## 六、Vite 配置：双模式统一方案

### 6.1 架构差异对照

| 维度 | 浏览器 SPA | Electron 桌面端 |
|------|-----------|----------------|
| `base` | `/` | `./`（必须相对路径，兼容 `file://` 协议） |
| 入口 | `src/main.tsx` | 同左 |
| 文件系统 | File System Access API | **IPC + Node fs** |
| 静态资源 | 同目录 | 同目录 |
| 构建产物 | `vite build` → `dist/` | `vite build` → `dist/` + `dist-electron/` |
| 打包分发 | 部署到 Web 服务器 | `electron-builder` → 安装包 |

### 6.2 统一 vite.config.ts

```typescript
// vite.config.ts — 通过环境变量 ELECTRON 切换模式
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const isElectron = process.env.ELECTRON === 'true';

  const baseConfig: any = {
    // Electron 必须用相对路径，浏览器可用绝对路径
    base: isElectron ? './' : '/',

    resolve: {
      alias: {
        '@': path.resolve('src'),
        // PlayCanvas 开发/生产版本切换
        'playcanvas': path.resolve(
          `node_modules/playcanvas/build/playcanvas${isDev ? '.dbg' : ''}/src/index.js`
        ),
        '@playcanvas/pcui': path.resolve('node_modules/@playcanvas/pcui'),
      },
    },

    css: {
      preprocessorOptions: {
        scss: {
          // PCUI 主题 SCSS（supersplat 的 PCUI 组件样式依赖）
          includePaths: [path.resolve('node_modules/@playcanvas/pcui/dist')],
          silenceDeprecations: ['legacy-js-api'],
        },
      },
      postcss: './postcss.config.js',
      devSourcemap: true,
    },

    build: {
      cssCodeSplit: false,
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            playcanvas: ['playcanvas'],
            pcui: ['@playcanvas/pcui'],
            'react-vendor': ['react', 'react-dom'],
            antd: ['antd', '@ant-design/icons'],
          },
        },
      },
    },

    define: {
      // 编译时常量，可在业务代码中直接使用
      __ELECTRON__: JSON.stringify(isElectron),
      __BUILD_TYPE__: JSON.stringify(isDev ? 'debug' : 'release'),
    },

    optimizeDeps: {
      include: ['playcanvas', '@playcanvas/pcui', 'mqtt'],
    },

    plugins: [
      react(),

      // 自定义插件：将 src/assets/svg/ 下的 SVG 导入为字符串
      // （替代旧 Rollup 项目中的 @rollup/plugin-image 行为）
      {
        name: 'svg-string',
        transform(code, id) {
          if (id.endsWith('.svg') && id.includes('/svg/')) {
            return `export default ${JSON.stringify(code)}`;
          }
        },
      },
    ],
  };

  // Electron 模式动态注入插件
  if (isElectron) {
    const electron = require('vite-plugin-electron');
    const renderer = require('vite-plugin-electron-renderer');

    baseConfig.plugins.push(
      electron([
        {
          // 主进程入口
          entry: 'electron/main.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
        {
          // preload 入口
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload();
          },
        },
      ]),
      // 允许渲染进程使用 Node.js API（按需开启）
      renderer(),
    );
  }

  return baseConfig;
});
```

### 6.3 postcss.config.js

```javascript
import autoprefixer from 'autoprefixer';

export default {
  plugins: [
    autoprefixer(),
  ],
};
```

---

## 七、PCUI + Ant Design 共存策略（无痛集成 supersplat）

### 7.1 为什么可以共存

PCUI 和 Ant Design 使用完全不同的 CSS 类名前缀和渲染机制，天然不会互相干扰：

| 维度 | PCUI | Ant Design 5 |
|------|------|--------------|
| CSS 方案 | SCSS 编译，全局类名 | CSS-in-JS（运行时注入 `<style>`）|
| 类名前缀 | `.pcui-*` | `.ant-*` |
| 渲染方式 | DOM 操作（命令式） | React 组件（声明式） |
| 冲突风险 | **无**：前缀完全隔离 | **无**：前缀完全隔离 |

### 7.2 全局样式隔离

PCUI 的 grey 主题 SCSS 会对 `body`、`html`、`*` 等全局元素设置样式（字体、颜色、间距），可能影响 Ant Design 页面的默认外观。解决方案：

```
方案：SCSS 仅在 3D 编辑页面加载，其他页面不引入

# 通过 Vite 的异步 CSS 分割实现：
# 3D 编辑页面的入口 chunk 才会包含 pcui-grey.scss
# 仪表盘、设置页等页面不会加载 PCUI 样式
```

```scss
// src/styles/pcui-overrides.scss
// 覆盖 PCUI 对 body/html 的全局样式，避免污染 Ant Design 页面

// 将 PCUI 的 body 重置限定在 3D 编辑区域内
.pcui-editor-wrapper {
  @import '@playcanvas/pcui/dist/pcui-theme-grey';
}
```

实际实现中，采用 **CSS 层叠上下文隔离**：

```tsx
// src/pages/scene-3d/Scene3DEditor.tsx
import { useEffect } from 'react';

// PCUI 样式仅在此组件加载时注入
import '@playcanvas/pcui/dist/pcui-theme-grey.scss';

export function Scene3DEditor() {
  // 3D 编辑器实现...
}
```

由于 Vite 的 CSS code split 特性（`cssCodeSplit: false` 关闭了分割，所以需要在 JS 入口按需导入），PCUI 样式可以像普通 npm 包一样被 Vite 的 SCSS 预处理器编译，与 Ant Design 的 CSS-in-JS 平行存在，互不干扰。

> **更稳妥的做法**：将 PCUI 的 SCSS 导入放在一个包装组件中，该组件内部渲染 supersplat 的 UI。这样其他页面不会拉到 PCUI 样式。

### 7.3 supersplat 无痛集成方案（方案 C：子包嵌入）

参考 `vite-migration-analysis.md` 的方案 C，supersplat 源码**原封不动**放入 `supersplat/` 目录，通过 Vite 配置层适配：

```
robotConfigTools/
├── supersplat/              # git submodule，零改动
│   ├── src/                 # supersplat 原始源码
│   │   ├── ui/              # PCUI 编辑面板（工具栏、模型树、属性面板）
│   │   ├── editor/          # 3D 编辑器核心逻辑
│   │   ├── scene-viewer.ts  # Viewport 入口
│   │   └── index.ts         # supersplat 应用入口
│   ├── static/              # 原始静态资源（WASM 等）
│   └── node_modules/        # 原始依赖
│
├── src/                     # 本项目代码
│   ├── pages/
│   │   └── scene-3d/
│   │       └── index.tsx    # 包装 supersplat，提供 Ant Design 外壳
│   └── ...
```

**编辑器页面集成示例**：

```tsx
// src/pages/scene-3d/index.tsx
import { useEffect, useRef } from 'react';
import { Layout } from 'antd';
import { startSupersplatEditor } from '@/supersplat-bridge';

const { Sider, Content } = Layout;

export default function Scene3DEditor() {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 启动 supersplat 编辑器，挂载到指定 DOM 节点
    const editor = startSupersplatEditor(viewportRef.current!);
    return () => editor.destroy();
  }, []);

  return (
    <Layout style={{ height: '100vh' }}>
      {/* Ant Design 侧边栏：机器人列表、场景管理 */}
      <Sider width={280} theme="light">
        <RobotPanel />   {/* Ant Design 组件 */}
        <SceneTree />    {/* Ant Design 组件 */}
      </Sider>

      <Content>
        {/* supersplat 的 PCUI 编辑器在此处渲染，与上方 Ant Design 隔离 */}
        <div ref={viewportRef} className="supersplat-viewport" />
      </Content>
    </Layout>
  );
}
```

### 7.4 边界划分

```
┌─────────────────────────────────────────────────┐
│  Ant Design（应用壳）                             │
│  ┌─────────────┐ ┌────────────────────────────┐ │
│  │ 顶部导航 (Antd)                              │ │
│  ├──────┬──────┤ │                            │ │
│  │ 侧栏  │ 内容  │ │  supersplat 编辑器          │ │
│  │(Antd)│(Antd)│ │  ┌──────────────────────┐  │ │
│  │      │      │ │  │ PCUI 工具栏           │  │ │
│  │ 机器  │ 仪表 │ │  │ PCUI 模型树           │  │ │
│  │ 列表  │ 盘   │ │  │ PCUI 属性面板         │  │ │
│  │(Antd)│(Antd)│ │  │ PlayCanvas <canvas>   │  │ │
│  │      │      │ │  └──────────────────────┘  │ │
│  └──────┴──────┘ └────────────────────────────┘ │
│                                                  │
│  Ant Design 区域          supersplat 区域        │
│  (CSS-in-JS)              (PCUI SCSS)           │
└─────────────────────────────────────────────────┘
```

> 总结：**Ant Design 管"外"（路由、导航、仪表盘、设置），PCUI 管"内"（3D 编辑器视口内的完整编辑 UI）。supersplat 源码整个丢进 `supersplat/` 目录，不改一行代码，Vite 配置层做适配。**

---

## 八、Electron 集成详细设计

### 8.1 主进程（electron/main.ts）

```typescript
import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import fs from 'fs';
import path from 'path';

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,    // 安全：隔离渲染进程
      nodeIntegration: false,     // 安全：禁止渲染进程直接访问 Node
      webgl: true,                // 必须：3D 渲染
      webSecurity: false,         // 开发阶段允许跨域加载本地模型
    },
  });

  // 开发模式：加载 Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    // 生产模式：加载打包后的文件
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// --- 注册自定义协议，解决 Electron file:// 下 WASM 跨域问题 ---
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { bypassCSP: true, supportFetchAPI: true } },
]);

// --- IPC 处理 ---

// 文件对话框：打开文件
ipcMain.handle('dialog:openFile', async (_, options?: {
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', ...(options?.multiple ? ['multiSelections'] : [])],
    filters: options?.filters ?? [
      { name: '3D Models', extensions: ['glb', 'gltf', 'fbx', 'obj'] },
      { name: 'Config Files', extensions: ['json', 'yaml', 'yml'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return null;
  return result.filePaths;
});

// 文件对话框：保存文件
ipcMain.handle('dialog:saveFile', async (_, options?: {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}) => {
  const result = await dialog.showSaveDialog(options);
  if (result.canceled) return null;
  return result.filePath;
});

// 读取文件内容
ipcMain.handle('fs:readFile', async (_, filePath: string) => {
  const buffer = await fs.promises.readFile(filePath);
  return buffer; // Electron IPC 自动序列化 Buffer
});

// 写入文件
ipcMain.handle('fs:writeFile', async (_, filePath: string, data: ArrayBuffer) => {
  await fs.promises.writeFile(filePath, Buffer.from(data));
});

// 读取文件信息（大小、修改时间）
ipcMain.handle('fs:stat', async (_, filePath: string) => {
  return fs.promises.stat(filePath);
});

// 列出目录内容
ipcMain.handle('fs:readdir', async (_, dirPath: string) => {
  return fs.promises.readdir(dirPath, { withFileTypes: true });
});

// 获取应用数据目录（模型缓存、配置文件存放处）
ipcMain.handle('app:getPath', async (_, name: string) => {
  return app.getPath(name);
});

// 创建/确保目录存在
ipcMain.handle('fs:mkdir', async (_, dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

### 8.2 预加载脚本（electron/preload.ts）

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ========== 文件对话框 ==========
  openFile: (options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }) => ipcRenderer.invoke('dialog:openFile', options),

  saveFile: (options?: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke('dialog:saveFile', options),

  // ========== 文件读写 ==========
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('fs:writeFile', filePath, data),
  statFile: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:readdir', dirPath),
  mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),

  // ========== 应用路径 ==========
  getAppPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  getModelsDir: () => ipcRenderer.invoke('app:getPath', 'userData'),

  // ========== 平台信息 ==========
  platform: process.platform,
});
```

### 8.3 全局类型声明（src/global.d.ts）

```typescript
// global.d.ts

interface ElectronAPI {
  openFile: (options?: {
    filters?: { name: string; extensions: string[] }[];
    multiple?: boolean;
  }) => Promise<string[] | null>;
  saveFile: (options?: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;
  readFile: (filePath: string) => Promise<ArrayBuffer>;
  writeFile: (filePath: string, data: ArrayBuffer) => Promise<void>;
  statFile: (filePath: string) => Promise<{
    size: number;
    mtime: Date;
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  readDir: (dirPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  mkdir: (dirPath: string) => Promise<void>;
  getAppPath: (name: string) => Promise<string>;
  getModelsDir: () => Promise<string>;
  platform: string;
}

// Vite define 编译时常量
declare const __ELECTRON__: boolean;
declare const __BUILD_TYPE__: 'debug' | 'release';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
```

---

## 九、运行时双端适配策略

### 9.1 文件读取：双端统一入口

```typescript
// src/services/fileService.ts

/**
 * 打开文件对话框，返回文件内容列表
 * 浏览器：使用 File System Access API
 * Electron：使用 IPC 原生对话框 + fs 读取
 */
export async function openModelFiles(): Promise<{ name: string; data: ArrayBuffer }[]> {
  // 方式 1：编译时常量判断（Vite define 注入，可被 tree-shake）
  if (__ELECTRON__) {
    return openFilesElectron();
  }
  // 方式 2：运行时检测（兜底，更灵活）
  if (window.electronAPI) {
    return openFilesElectron();
  }
  return openFilesBrowser();
}

async function openFilesElectron() {
  const paths = await window.electronAPI!.openFile({
    filters: [
      { name: '3D Models', extensions: ['glb', 'gltf', 'fbx'] },
    ],
    multiple: true,
  });
  if (!paths) return [];

  const results = [];
  for (const filePath of paths) {
    const buffer = await window.electronAPI!.readFile(filePath);
    const name = filePath.split(/[\\/]/).pop()!;
    results.push({ name, data: buffer });
  }
  return results;
}

async function openFilesBrowser() {
  const handles = await window.showOpenFilePicker({
    types: [{
      description: '3D Models',
      accept: { 'model/gltf+json': ['.gltf'], 'model/gltf-binary': ['.glb'] },
    }],
    multiple: true,
  });

  const results = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    results.push({ name: file.name, data: buffer });
  }
  return results;
}
```

### 9.2 模型本地缓存：双端不同策略

```typescript
// src/storage/modelCache.ts

export async function cacheModel(key: string, data: ArrayBuffer): Promise<void> {
  if (window.electronAPI) {
    // Electron：直接写入用户数据目录
    const modelsDir = await window.electronAPI.getModelsDir();
    const cacheDir = `${modelsDir}/model-cache`;
    await window.electronAPI.mkdir(cacheDir);
    await window.electronAPI.writeFile(`${cacheDir}/${key}.glb`, data);
  } else {
    // 浏览器：写入 IndexedDB
    const db = await getModelDB();
    await db.put('models', { key, data, timestamp: Date.now() });
  }
}

export async function loadCachedModel(key: string): Promise<ArrayBuffer | null> {
  if (window.electronAPI) {
    const modelsDir = await window.electronAPI.getModelsDir();
    const filePath = `${modelsDir}/model-cache/${key}.glb`;
    try {
      const stat = await window.electronAPI.statFile(filePath);
      return stat.isFile() ? await window.electronAPI.readFile(filePath) : null;
    } catch {
      return null; // 文件不存在
    }
  } else {
    const db = await getModelDB();
    const entry = await db.get('models', key);
    return entry?.data ?? null;
  }
}
```

### 9.3 环境判断工具函数

```typescript
// src/utils/env.ts

/** 是否运行在 Electron 环境中（编译时常量，可被 tree-shake） */
export const isElectron = __ELECTRON__;

/** 运行时检测 Electron 环境（兜底） */
export const isElectronRuntime = (): boolean => {
  return !!(window as any).electronAPI;
};

/** 是否运行在开发模式 */
export const isDev = __BUILD_TYPE__ === 'debug';

/** 获取当前平台 */
export const getPlatform = (): string => {
  return window.electronAPI?.platform ?? 'browser';
};
```

---

## 十、核心模块设计

### 10.1 路由设计

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Dashboard | 仪表盘，机器人列表概览 |
| `/robot/:id` | RobotEditor | 单机器人参数配置 |
| `/scene` | Scene3DEditor | 3D 场景编辑器（布局、模型摆放） |
| `/scene/robot/:id` | Robot3DEditor | 单机器人 3D 编辑视图 |
| `/models` | ModelManager | 本地模型/资源管理 |
| `/settings` | Settings | 通信设置（HTTP/MQTT 地址） |

### 10.2 数据流架构

```
┌──────────────────────────────────────────────┐
│                   UI Layer                    │
│  ┌────────────┐  ┌────────────┐  ┌────────┐ │
│  │ React 页面 │  │ 3D Canvas  │  │ 控制面板│ │
│  └─────┬──────┘  └─────┬──────┘  └───┬────┘ │
│        │               │              │       │
│  ┌─────▼───────────────▼──────────────▼────┐ │
│  │          Zustand Store                  │ │
│  │  ┌──────────┐ ┌─────────┐ ┌─────────┐  │ │
│  │  │robotStore│ │sceneStore│ │fileStore │  │ │
│  │  └────┬─────┘ └────┬────┘ └────┬─────┘  │ │
│  └───────┼─────────────┼───────────┼────────┘ │
│          │             │           │           │
│  ┌───────▼─────────────▼───────────▼────────┐ │
│  │            Service Layer                 │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐  │ │
│  │  │ Http API│ │   MQTT   │ │  Storage │  │ │
│  │  │(axios)  │ │ (mqtt.js)│ │(Dexie/fs)│  │ │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘  │ │
│  └───────┼────────────┼───────────┼────────┘ │
│          │            │           │           │
└──────────┼────────────┼───────────┼───────────┘
           │            │           │
     ┌─────▼────┐  ┌────▼────┐ ┌───▼──────┐
     │  Backend │  │  MQTT   │ │ Local FS │
     │  Server  │  │ Broker  │ │ /IDB     │
     └──────────┘  └─────────┘ └──────────┘
```

### 10.3 MQTT 通信模块

```typescript
// MQTT 主题设计
const Topics = {
  // 机器人遥测数据上报
  TELEMETRY: 'robot/{robotId}/telemetry',
  // 控制指令下发
  COMMAND: 'robot/{robotId}/command',
  // 配置同步
  CONFIG_SYNC: 'robot/{robotId}/config',
  // 在线状态
  STATUS: 'robot/{robotId}/status',
};
```

- 使用 **QoS 1** 确保指令可达
- 断线自动重连 + 消息队列缓存
- 与 Zustand Store 联动，实时更新 3D 场景中机器人姿态

### 10.4 本地存储方案

| 存储内容 | 浏览器端 | Electron 端 |
|----------|----------|-------------|
| 配置 JSON | Dexie.js (IndexedDB) | `electron-store` + 本地 JSON |
| 3D 模型 (GLB/GLTF) | IndexedDB 大文件存储 / OPFS | 用户目录 `app.getPath('userData')/models/` |
| 纹理贴图/图片 | IndexedDB | 本地文件夹 |
| 用户偏好设置 | localStorage / IndexedDB | `electron-store` |
| 缓存数据 | TanStack Query 内存缓存 + IndexedDB 持久化 | 同左 |

### 10.5 模型文件读取策略

```
浏览器端：
  用户上传 → FileReader 解析 → PlayCanvas Container Asset 加载
  或：从 IndexedDB 读取 ArrayBuffer → Blob URL → Asset 加载

Electron 端：
  本地路径 → IPC → fs.readFile → Blob URL → Asset 加载
  优势：无浏览器存储配额限制，可读取任意大小模型
```

---

## 十一、3D 场景技术方案（PlayCanvas）

### 11.1 架构模式：React 外壳 + PlayCanvas Viewport

本项目采用与 supersplat 相同的混合架构：

```
┌──────────────────────────────────────────────┐
│              React Application                │
│  ┌──────────┐ ┌────────────────────────────┐ │
│  │ 左侧面板  │ │                            │ │
│  │ (Antd)   │ │   PlayCanvas Viewport       │ │
│  │          │ │   <canvas>                  │ │
│  │ 模型树    │ │                            │ │
│  │ 属性编辑  │ │   机器人 3D 模型            │ │
│  │ 工具栏    │ │   地面网格 / 坐标轴         │ │
│  │          │ │   变换 Gizmo                │ │
│  │          │ │                            │ │
│  └──────────┘ └────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │              底部状态栏 / 时间轴          │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- **React**：管理 UI 面板（模型树、属性编辑器、工具栏）、路由、全局状态
- **PlayCanvas**：独占一个 `<canvas>` 元素，负责全部 3D 渲染逻辑
- **通信方式**：React 通过 PlayCanvas `Application` 实例的引用，命令式调用 PlayCanvas API

### 11.2 Viewport 组件实现

```typescript
// src/playcanvas/viewport/Viewport.tsx
import { useEffect, useRef } from 'react';
import * as pc from 'playcanvas';
import { setupScene } from './SceneSetup';
import { useRobotStore } from '@/stores/robotStore';

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<pc.Application | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;

    // 创建 PlayCanvas Application
    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: {
        // Electron 兼容：关闭透明交换链（Windows 下 WebGL 渲染异常修复）
        preferWebGl2: true,
      },
    });

    // 设置画布自适应
    const resize = () => app.resizeCanvas();
    window.addEventListener('resize', resize);

    // 初始化场景（灯光、地面、相机等）
    setupScene(app);

    // 启动渲染循环
    app.start();
    appRef.current = app;

    // 挂载到 window 供调试（开发模式）
    if (__BUILD_TYPE__ === 'debug') {
      (window as any).__pcApp = app;
    }

    return () => {
      window.removeEventListener('resize', resize);
      app.destroy();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
```

### 11.3 场景初始化

```typescript
// src/playcanvas/viewport/SceneSetup.ts
import * as pc from 'playcanvas';

export function setupScene(app: pc.Application) {
  const scene = app.scene;

  // --- 环境光 ---
  scene.ambientLight = new pc.Color(0.3, 0.3, 0.3);

  // --- 方向光（主光源）---
  const light = new pc.Entity('directionalLight');
  light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 1, 1),
    intensity: 1.0,
    castShadows: true,
  });
  light.setEulerAngles(45, 45, 0);
  app.root.addChild(light);

  // --- 地面网格 ---
  const grid = new pc.Entity('grid');
  grid.addComponent('model', {
    type: 'box',
  });
  grid.setLocalScale(20, 0.02, 20);
  grid.setLocalPosition(0, -0.01, 0);
  app.root.addChild(grid);

  // --- 相机 ---
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', {
    fov: 60,
    clearColor: new pc.Color(0.15, 0.15, 0.15),
  });
  camera.setLocalPosition(5, 3, 5);
  camera.lookAt(0, 0, 0);
  app.root.addChild(camera);
}
```

### 11.4 模型加载

```typescript
// src/playcanvas/entities/RobotEntity.ts
import * as pc from 'playcanvas';

/**
 * 加载 GLTF/GLB 机器人模型到 PlayCanvas 场景中
 */
export async function loadRobotModel(
  app: pc.Application,
  url: string,
  position: pc.Vec3 = new pc.Vec3(0, 0, 0)
): Promise<pc.Entity> {
  const asset = new pc.Asset(
    `robot_${Date.now()}`,
    'container',
    { url },
    { type: 'glb' }
  );

  return new Promise((resolve, reject) => {
    asset.on('load', () => {
      const entity = asset.resource.instantiateRenderEntity();
      entity.setLocalPosition(position);
      app.root.addChild(entity);
      resolve(entity);
    });
    asset.on('error', reject);
    app.assets.add(asset);
    app.assets.load(asset);
  });
}

/**
 * 从 ArrayBuffer 加载模型（Electron IPC 读取本地文件场景）
 */
export async function loadRobotFromBuffer(
  app: pc.Application,
  buffer: ArrayBuffer,
  filename: string,
  position?: pc.Vec3
): Promise<pc.Entity> {
  // 创建 Blob URL
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);

  const entity = await loadRobotModel(app, url, position);

  // 加载完成后释放 Blob URL
  URL.revokeObjectURL(url);
  return entity;
}
```

### 11.5 选择与高亮

```typescript
// src/playcanvas/utils/materialUtils.ts
import * as pc from 'playcanvas';

/**
 * 为 Entity 及其所有子节点的 meshInstance 设置高亮
 */
export function setEntityHighlight(entity: pc.Entity, highlight: boolean) {
  entity.findComponents('render').forEach((render) => {
    render.meshInstances.forEach((mi) => {
      if (highlight) {
        // 保存原始材质用于恢复
        (mi as any).__originalMaterial = mi.material;
        // 创建高亮材质（发光效果）
        const highlightMat = mi.material.clone();
        highlightMat.emissive = new pc.Color(0.3, 0.6, 1);
        highlightMat.emissiveIntensity = 0.5;
        highlightMat.update();
        mi.material = highlightMat;
      } else {
        // 恢复原始材质
        if ((mi as any).__originalMaterial) {
          mi.material = (mi as any).__originalMaterial;
        }
      }
    });
  });

  // 递归处理子节点
  entity.children.forEach((child) => setEntityHighlight(child, highlight));
}
```

### 11.6 核心能力清单

- [x] 3D 模型加载：GLTF/GLB 格式（PlayCanvas 内置 Container Asset）
- [x] 从 ArrayBuffer 直接加载（Electron 本地文件场景）
- [x] 场景交互：相机旋转/缩放/平移（PlayCanvas 内置 Mouse/Touch/Keyboard）
- [x] 模型编辑：位移/旋转/缩放 Gizmo（基于 PCUI + PlayCanvas 自定义实现）
- [x] 辅助元素：网格地面、坐标轴指示
- [x] 多机器人实例：多个模型 Entity 同时渲染
- [x] 选择高亮：Emissive 材质克隆方案
- [x] 模型树：通过 Entity 层级结构同步到 React 组件树
- [x] 截图导出：`app.graphicsDevice.canvas.toDataURL()`

---

## 十二、supersplat 迁移经验总结

本项目的前身是对 supersplat 的改造版本（Rollup 脚手架），以下是从中可复用的技术经验。

### 12.1 从 supersplat 可复用的部分

| 模块 | 说明 | 是否复用 | 备注 |
|------|------|----------|------|
| **PlayCanvas 集成模式** | React 外壳 + PlayCanvas Viewport 的混合架构 | 复用 | 架构模式沿用 |
| **PCUI 组件** | 树形控件、工具栏、菜单、弹出面板等 | **复用** | supersplat 核心编辑 UI 完整保留，在 3D 编辑器视口内使用 |
| **PCUI SCSS 主题** | PCUI 的 grey 主题样式 | **复用** | 仅在 3D 编辑器页面内引入，其他页面不加载（按需导入） |
| **PlayCanvas alias 切换** | 开发 `.dbg` / 生产版本切换 | 复用 | Vite `resolve.alias` 等价实现 |
| **SVG 图标导入** | `import svg from './icon.svg'` 返回字符串 | 复用 | Vite 自定义 `svg-string` 插件拦截 |
| **文件对话框模式** | 浏览器 File System Access API ↔ Electron IPC 双端适配 | 复用 | 参考第九章双端适配策略 |
| **WASM 加载** | WebP/PNG 编解码等 WASM 在 Electron 中的处理 | 按需 | `protocol.registerSchemesAsPrivileged` |

> **复用策略**：supersplat 源码作为独立子目录放入 `supersplat/`，通过 Vite 配置层做 Rollup → Vite 适配。PCUI 的 SCSS 在 3D 编辑器页面内按需导入，不污染 Ant Design 的页面。

### 12.2 Rollup → Vite 迁移对照

| 原 Rollup 机制 | Vite 等价方案 | 详见 |
|----------------|--------------|------|
| `@rollup/plugin-typescript` | esbuild 内置转译（Vite 默认） | - |
| `rollup-plugin-scss` | Vite 内置 SCSS + `preprocessorOptions` | 六章 |
| `@rollup/plugin-image`（SVG → string） | 自定义 `svg-string` 插件 | 六章 |
| `@rollup/plugin-strip`（去除 Debug） | `vite-plugin-strip` 或 `define` 注入 | 风险表 |
| `rollup-plugin-copy` + `copy-and-watch.mjs` | `publicDir` 自动复制 | 六章 |
| Rollup 多入口输出 | `build.rollupOptions.input` | 六章 |
| `process.env.BUILD_TYPE` | `define: { __BUILD_TYPE__ }` | 六章 |

### 12.3 需要适配的差异点

| 差异 | supersplat 原方案 | 本项目方案 | 原因 |
|------|-------------------|-----------|------|
| 构建工具 | Rollup 直接调用 | Vite 5 | 开发体验更好，HMR 极快 |
| 打包方式 | `serve dist` 静态服务 | Vite dev server + HMR | 原生 HMR 支持 |
| `static/` 路径 | 代码中 `static/lib/xxx` | `public/` → 运行时可访问根路径 | Vite `publicDir` 行为不同 |
| Service Worker | `sw.ts` + PWA | Electron 端删除，浏览器端按需 | 桌面端不需要 SW |
| PlayCanvas 版本 | `playcanvas.dbg/src/index.js` | 同，Vite alias 按 mode 切换 | 无变化 |
| CSS 方案 | PCUI SCSS 主题 | PCUI SCSS（3D 编辑器内） + Ant Design CSS-in-JS（外壳） | 保留 PCUI 主题供 supersplat 编辑器使用，外壳走 Ant Design |
| 包管理器 | npm | pnpm | 更快，节省磁盘 |

### 12.4 不需要迁移的部分

以下 supersplat 的功能模块在本项目中**不需要**：

- **Gaussian Splatting 渲染**：supersplat 的核心（`.ply`/`.splat` 文件加载），本项目是标准 GLTF/GLB 模型
- **splat 编辑工具**：选择/删除/裁剪 splat 点云，本项目无此需求
- **splat 导出**：压缩 splat 格式导出，本项目无此需求
- **PlayCanvas Editor 依赖**：supersplat 是 PlayCanvas Editor 的导出项目，本项目纯 Runtime API

---

## 十三、构建与打包

### 13.1 开发命令

```bash
# 安装依赖
pnpm install

# 启动浏览器端开发
pnpm dev

# 启动 Electron 桌面端开发
pnpm dev:electron

# 构建浏览器端
pnpm build

# 构建 Electron 桌面端
pnpm build:electron
```

### 13.2 package.json scripts

```json
{
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "dev:electron": "cross-env ELECTRON=true vite",
    "build:electron": "cross-env ELECTRON=true vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx",
    "pack:win": "pnpm build:electron && electron-builder --win",
    "pack:mac": "pnpm build:electron && electron-builder --mac",
    "pack:linux": "pnpm build:electron && electron-builder --linux"
  },
  "build": {
    "appId": "com.company.robot-config-tools",
    "productName": "RobotConfigTools",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "dist-electron/**/*"
    ],
    "win": {
      "target": "nsis",
      "icon": "public/icon.png"
    },
    "mac": {
      "target": "dmg",
      "icon": "public/icon.png"
    },
    "linux": {
      "target": "AppImage",
      "icon": "public/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

### 13.3 依赖清单

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "playcanvas": "^2.4.0",
    "@playcanvas/pcui": "^4.5.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.51.0",
    "axios": "^1.7.0",
    "mqtt": "^5.9.0",
    "antd": "^5.20.0",
    "@ant-design/icons": "^5.4.0",
    "dexie": "^4.0.0",
    "localforage": "^1.10.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0",
    "electron-store": "^8.2.0",
    "cross-env": "^7.0.3",
    "sass": "^1.77.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.0",
    "vitest": "^2.0.0",
    "@testing-library/react": "^16.0.0"
  }
}
```

---

## 十四、进度规划建议

| 阶段 | 内容 | 产出 |
|------|------|------|
| **P0 基础搭建** | Vite + React + PlayCanvas + Electron 骨架跑通，双模式统一配置 | 浏览器 + 桌面双端可启动 |
| **P1 3D 核心** | PlayCanvas 场景搭建、模型加载、基础交互 | 能加载并查看 3D 机器人模型 |
| **P2 配置编辑** | 参数面板、模型树、变换 Gizmo 编辑 | 可拖拽编辑机器人位姿 |
| **P3 数据层** | Zustand Store、HTTP 服务、文件双端读写 | 配置可保存/加载 |
| **P4 通信** | MQTT 连接、遥测实时刷新 3D 场景 | 实时同步机器人状态 |
| **P5 完善** | 模型管理、批量操作、Electron 打包分发 | 可交付的桌面端应用 |

---

## 十五、风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| **GLTF/GLB 模型体积大** | 加载慢、内存占用高 | 加载进度提示 + 本地缓存 + PlayCanvas Draco 压缩支持 |
| **Electron 内存占用** | 3D + Chromium 双进程内存高 | 限制渲染进程数，`app.destroy()` 及时释放 PlayCanvas 资源 |
| **`file://` 协议下 WASM 跨域** | PlayCanvas Draco/WebP 解码失败 | `protocol.registerSchemesAsPrivileged` 注册自定义协议，或将 WASM 内联为 Blob URL |
| **PlayCanvas `.dbg` vs 正式版差异** | 开发模式堆栈信息不同，性能差异大 | Vite alias 按 mode 切换 `playcanvas.dbg` |
| **MQTT 断线重连** | 机器人场景网络不稳定 | 自动重连 + 消息队列缓存 + QoS 1 |
| **跨平台路径差异** | Windows/Mac/Linux 路径分隔符不同 | 统一使用 `path.join` / `path.resolve` |
| **contextIsolation 限制** | 渲染进程无法直接访问 `window.__pcApp` 调试 | preload 暴露调试 API，或开发期关 contextIsolation |
| **Electron File System Access API 持久化权限** | Chromium 可能不保证文件句柄持久 | 全部走 IPC + Node fs，不使用 File System Access API |
| **Web Worker 阻塞** | 大模型解析卡主线程 | 模型解析放入 Web Worker 或使用 PlayCanvas Asset 异步加载 |
| **SCSS `@use` 跨项目解析** | PCUI 主题找不到 | 检查 `includePaths` 配置，指向 `node_modules/@playcanvas/pcui/dist` |
| **SVG import 默认行为不同** | UI 图标无法显示（Vite 返回 URL 而非字符串） | 自定义 `svg-string` Vite 插件拦截转换 |
| **PCUI SCSS 全局样式污染** | PCUI 的 body/html 重置影响 Ant Design 页面 | PCUI SCSS 仅在 3D 编辑器页面按需导入，其他页面不加载；或使用 `.pcui-editor-wrapper` 包裹限制作用域 |

---

## 十六、环境变量对照

| 用途 | Vite | 说明 |
|------|------|------|
| 构建模式 | `import.meta.env.MODE` | `'development'` / `'production'` |
| 是否生产环境 | `import.meta.env.PROD` | 布尔值 |
| 是否开发环境 | `import.meta.env.DEV` | 布尔值 |
| base URL | `import.meta.env.BASE_URL` | 自动，对应 `vite.config.ts` 中 `base` |
| 构建类型 | `__BUILD_TYPE__` | `'debug'` / `'release'`，通过 `define` 注入 |
| 是否 Electron | `__ELECTRON__` | 通过 `define` 注入，编译时常量 |
