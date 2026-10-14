import { app, BrowserWindow, dialog, ipcMain } from "electron";
import * as net from "net";
import { getDataPathMigrationStatus, getProjectRoot, migrateDataPath } from "../project-core/project-root";
import { getProjectDatabaseMigrationStatus } from "../db-ipc";

/**
 * 合法 IPv4 格式正则（主进程侧独立校验）。
 * 不依赖渲染侧传入的任何校验结果，防止绕过校验的注入攻击。
 */
const IP_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

/**
 * 通过 TCP 连接探测目标 IP 的指定端口是否可达。
 *
 * 相比原来的 exec("ping ...") 方案，优势如下：
 * 1. 无 shell 调用，彻底消除命令注入风险。
 * 2. 直接探测 443（HTTPS）端口，比 ICMP ping 更贴近后台实际连通情况。
 * 3. 跨平台一致，不需要区分 Windows / Linux ping 参数。
 *
 * @param ip        目标 IPv4 地址
 * @param port      探测端口，默认 443
 * @param timeoutMs 超时毫秒数，默认 3000
 */
function probeTcp(ip: string, port = 443, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    // 用 settled 防止 error 和 timeout 事件同时触发导致 resolve 被调用两次
    let settled = false;

    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.connect(port, ip, () => done(true));   // 连接成功
    socket.on("error", () => done(false));         // 连接被拒绝或网络不可达
    socket.on("timeout", () => done(false));       // 超时
  });
}

/**
 * 注册系统级 IPC 处理器：后台 ping、目录/文件选择对话框、数据路径、GPU 信息。
 */
export function registerSystemIpc(): void {
  /**
   * ping：探测后台 IP 的 443 端口是否可达。
   * 主进程侧独立做 IPv4 格式校验，不信任渲染侧传入值。
   */
  ipcMain.handle("ping", async (_event, ip: string) => {
    if (typeof ip !== "string" || !IP_REGEX.test(ip.trim())) return false;
    return probeTcp(ip.trim());
  });

  /** 弹出系统目录选择对话框，返回所选路径或 null（用户取消） */
  ipcMain.handle("dialog:select-dir", async (_event, title?: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: String(title || "").trim() || "选择保存目录",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  /** 弹出系统文件选择对话框，仅允许选择 ZIP 文件 */
  ipcMain.handle("dialog:select-zip-file", async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      title: "选择ZIP压缩包",
      filters: [{ name: "ZIP压缩包", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  /** 设置运行时数据根路径；文件搬迁完成后才提交配置。 */
  ipcMain.handle("set-data-path", async (event, newPath: string) => migrateDataPath(newPath, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("storage:migration-progress", progress);
  }));

  ipcMain.handle("storage:migration-status", async () => getDataPathMigrationStatus());

  ipcMain.handle("project:database-migration-status", async () => getProjectDatabaseMigrationStatus());

  /** 获取当前项目根路径 */
  ipcMain.handle("get-project-root", async () => getProjectRoot());

  /** 获取 GPU 基本信息，供渲染侧展示或调试使用 */
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
