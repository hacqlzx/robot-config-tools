import { BrowserWindow, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.js");
  console.log("preload path:", preloadPath, "exists:", fs.existsSync(preloadPath));

  const win = new BrowserWindow({
    show: false,
    backgroundColor: "#f5f5f5",
    frame: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webgl: true,
      webSecurity: false,
    },
  });

  const getWindowState = () => ({
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  });
  const emitWindowState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send("win:state", getWindowState());
    }
  };

  win.on("maximize", emitWindowState);
  win.on("unmaximize", emitWindowState);
  win.on("enter-full-screen", emitWindowState);
  win.on("leave-full-screen", emitWindowState);

  win.maximize();
  win.once("ready-to-show", () => {
    win.show();
    emitWindowState();
  });

  ipcMain.on("win:minimize", () => win.minimize());
  ipcMain.on("win:maximize", () => {
    if (win.isFullScreen()) {
      win.setFullScreen(false);
      return;
    }
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.handle("win:get-state", () => getWindowState());
  ipcMain.on("win:close", () => win.close());

  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("Render process gone:", details.reason, details.exitCode);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "bottom" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}
