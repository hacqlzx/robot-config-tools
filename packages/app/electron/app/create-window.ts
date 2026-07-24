import { BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 创建应用主窗口并注册窗口相关 IPC。
 *
 * 注意事项：
 * - 窗口设为无边框（frame: false），标题栏由渲染侧自定义实现。
 * - webSecurity 关闭以允许跨域加载本地资源（后台 HTTPS 无证书场景）；
 *   生产环境应评估是否收紧该选项。
 * - minWidth / minHeight 限制窗口最小尺寸，防止弹窗等 UI 在极小窗口下被遮挡。
 */
export function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");
  console.log("preload path:", preloadPath, "exists:", fs.existsSync(preloadPath));

  const win = new BrowserWindow({
    show: false,
    // 限制窗口最小尺寸，确保弹窗、表单等 UI 有足够展示空间
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#f5f5f5",
    // 无边框窗口，标题栏由前端自定义
    frame: false,
    webPreferences: {
      preload: preloadPath,
      // 启用上下文隔离，渲染进程无法直接访问 Node API
      contextIsolation: true,
      // 禁用 Node 集成，安全隔离
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webgl: true,
      // 关闭同源限制，允许渲染进程访问后台 HTTPS 接口（含自签名证书场景）
      // TODO: 后续应改为可配置的证书策略，不应无条件放行
      webSecurity: false,
    },
  });

  /** 获取当前窗口最大化/全屏状态快照 */
  const getWindowState = () => ({
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  });

  /** 向渲染进程推送最新窗口状态 */
  const emitWindowState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("win:state", getWindowState());
    }
  };

  // 监听最大化/全屏变化，实时同步到渲染侧
  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);
  win.on("enter-full-screen", emitWindowState);
  win.on("leave-full-screen", emitWindowState);

  // 启动时最大化，ready-to-show 后再显示，避免白屏闪烁
  win.maximize();
  win.once("ready-to-show", () => {
    win.show();
    emitWindowState();
  });

  // 注册窗口控制 IPC：最小化、最大化/还原、全屏退出、关闭
  ipcMain.on("win:minimize", () => win.minimize());
  ipcMain.on("win:maximize", () => {
    if (win.isFullScreen()) {
      // 全屏模式下点击最大化按钮 → 退出全屏
      win.setFullScreen(false);
      return;
    }
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle("win:get-state", () => getWindowState());
  ipcMain.on("win:close", () => win.close());

  // 渲染进程崩溃时记录日志，便于排查 GPU/内存问题
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Render process gone:", details.reason, details.exitCode);
  });

  // 开发模式加载 Vite dev server，生产模式加载构建产物
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "bottom" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}
