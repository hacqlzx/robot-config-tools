import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { UpdateController } from "./update-controller";

/** Uses app-update.yml generated from build.publish; never embeds publishing credentials. */
export function registerAppUpdater(): () => void {
  const controller = new UpdateController(
    autoUpdater,
    app.isPackaged ? app.getVersion() : __APP_VERSION__,
    app.isPackaged && process.platform === "win32",
    (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("app-update:changed", state);
      }
    },
  );
  autoUpdater.logger = console;
  ipcMain.handle("app-update:state", () => controller.snapshot());
  ipcMain.handle("app-update:check", () => controller.check());
  ipcMain.handle("app-update:download", () => controller.download());
  ipcMain.handle("app-update:install", () => controller.install());
  let started = false;
  return () => {
    if (started || !app.isPackaged) return;
    started = true;
    const timer = setTimeout(() => { void controller.check(); }, 3_000);
    timer.unref();
    app.once("before-quit", () => clearTimeout(timer));
  };
}
