import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { exec } from "child_process";
import { getProjectRoot, setDataPath } from "../project-core/project-root";

export function registerSystemIpc(): void {
  ipcMain.handle("ping", async (_event, ip: string) => {
    const cmd = process.platform === "win32" ? `ping -n 1 -w 2000 ${ip}` : `ping -c 1 -W 2 ${ip}`;
    return new Promise((resolve) => {
      exec(cmd, (error) => {
        resolve(!error);
      });
    });
  });

  ipcMain.handle("dialog:select-dir", async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "选择保存目录",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("set-data-path", async (_event, newPath: string) => setDataPath(newPath));
  ipcMain.handle("get-project-root", async () => getProjectRoot());

  ipcMain.handle("gpu:info", async () => {
    try {
      const gpuInfo: any = await app.getGPUInfo("basic");
      return {
        gpuDevice: gpuInfo.gpuDevice || [],
        auxAttributes: gpuInfo.auxAttributes || {},
      };
    } catch {
      return { gpuDevice: [], auxAttributes: {} };
    }
  });
}
