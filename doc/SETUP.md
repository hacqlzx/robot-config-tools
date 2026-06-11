# 架构与项目搭建思路

---

## 一、Monorepo 结构

```
robotConfigTools/
├── pnpm-workspace.yaml
├── package.json                    # 根（脚本、公共依赖版本）
├── doc/                            # 文档
│   ├── ARCHITECTURE.md
│   └── PROJECT_PLAN.md
│
├── packages/
│   ├── supersplat/                 # 原项目（submodule，零改动）
│   │   ├── src/                    # 源码
│   │   ├── vite.config.ts          # 库模式构建配置（仅生产用）
│   │   └── package.json
│   │
│   └── app/                        # 主项目
│       ├── electron/               # Electron 主进程 + preload
│       │   ├── main.ts
│       │   └── preload.ts
│       ├── src/                    # 业务代码
│       │   ├── main.tsx            # 入口
│       │   ├── App.tsx
│       │   ├── routes/
│       │   ├── pages/
│       │   ├── components/
│       │   ├── playcanvas/
│       │   ├── stores/
│       │   └── services/
│       ├── public/
│       ├── index.html
│       ├── vite.config.ts          # 唯一开发配置（浏览器 + Electron 双端）
│       └── package.json
```

**只有两个 Vite 配置**：

| 配置 | 用途 | 使用时机 |
|------|------|----------|
| `supersplat/vite.config.ts` | 库模式构建 UMD | 仅 `pnpm build` 时 |
| `app/vite.config.ts` | 主项目开发 + 生产 + Electron | 全程 |

---

## 二、核心架构思路

### 2.1 supersplat 集成策略

```
开发阶段：
  app/vite.config.ts 直接 alias 指向 supersplat/src/ 源码
  → 一个 Vite dev server，HMR 覆盖两个项目

生产构建：
  先构建 supersplat → dist/supersplat.umd.js
  app 构建时 alias 指向 UMD → 打包进最终产物
```

好处：开发体验完整（HMR），生产隔离干净（库模式产物），supersplat 源码零改动。

### 2.2 浏览器 / Electron 双端统一

同一个 `app/vite.config.ts`，通过环境变量 `ELECTRON=true` 切换：

```ts
const isElectron = process.env.ELECTRON === 'true'
```

| 差异项 | 浏览器 | Electron |
|--------|--------|----------|
| base | `/` | `./` |
| plugins | react | react + vite-plugin-electron |
| define | `__ELECTRON__: "false"` | `__ELECTRON__: "true"` |

业务代码通过 `__ELECTRON__` 编译常量 tree-shake，文件系统、对话框等自动走对应分支。

### 2.3 技术栈

| 层 | 选型 |
|----|------|
| 包管理 | pnpm（workspace） |
| 构建 | Vite 5（主项目）+ Vite lib mode（supersplat） |
| 前端 | React 18 + TypeScript |
| UI | Ant Design 5（壳）+ PCUI（3D 编辑器内） |
| 3D | PlayCanvas（Viewport 嵌入） |
| 桌面 | Electron 28 + vite-plugin-electron |
| 状态 | Zustand |
| 通信 | HTTP（axios）+ MQTT（mqtt.js） |

---

## 三、搭建步骤

### 第一步：初始化 Monorepo

1. 创建 `pnpm-workspace.yaml`，声明 `packages/*`
2. 根 `package.json` 只放 scripts

### 第二步：搭建 supersplat 包

1. 将 supersplat 源码放入 `packages/supersplat/`（建议 git submodule）
2. 写 `vite.config.ts`（库模式，external playcanvas/pcui）
3. 验证：`pnpm --filter supersplat build` 产出 `dist/supersplat.umd.js`

### 第三步：搭建 app 包

1. `pnpm create vite` 生成 React+TS 骨架
2. 配置 `vite.config.ts`：
   - SCSS 预处理器（PCUI 主题路径）
   - SVG→string 自定义插件
   - alias：`@supersplat` 开发走源码/生产走 UMD
   - Electron 条件分支
3. 建立目录结构（pages、components、playcanvas、stores、services）
4. 路由占位、Zustand store 骨架

### 第四步：Electron 集成

1. 写 `electron/main.ts` + `electron/preload.ts`
2. `vite.config.ts` 条件注入 `vite-plugin-electron`
3. 验证：`pnpm dev:electron` 能打开 Electron 窗口

---

## 四、开发命令

```bash
# 安装全部依赖
pnpm install

# 浏览器开发
pnpm dev

# Electron 开发
pnpm dev:electron

# 生产构建（先构建 supersplat，再构建 app）
pnpm build
```

package.json scripts 建议放在根目录统一调度。
