import { app, Menu } from "electron";
import fs from "fs";
import path from "path";

export function configureAppCommandLine(): void {
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("use-angle", "d3d11");
  app.commandLine.appendSwitch("disable-gpu-vsync");

  if (!app.isPackaged) {
    app.commandLine.appendSwitch("ignore-certificate-errors");
  }
}

export function configureCertificateHandling(): void {
  app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(true);
  });
}

export function disableApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}

export async function logGPUInfo(): Promise<void> {
  const logPath = path.join(app.getPath("userData"), "gpu-info.log");
  try {
    const gpuInfo: any = await app.getGPUInfo("basic");
    const devices = (gpuInfo.gpuDevice || []).map((d: any) =>
      `  - ${d.deviceId}: ${d.vendorId} ${d.description || ""} (active: ${d.active})`
    ).join("\n");
    const log = [
      `=== GPU Info ${new Date().toISOString()} ===`,
      `Platform: ${process.platform}`,
      `Electron: ${process.versions.electron}`,
      `Chromium: ${process.versions.chrome}`,
      `GPU Devices:`,
      devices || "  (none)",
      `Aux Attributes: ${JSON.stringify(gpuInfo.auxAttributes || {})}`,
      `=== End ===`,
    ].join("\n");
    fs.writeFileSync(logPath, log, "utf-8");
    console.log("GPU info logged to:", logPath);
  } catch (err) {
    fs.writeFileSync(logPath, `GPU info failed: ${err}`, "utf-8");
  }
}
