import { app } from "electron";
import { initDbIpc, closeDbIpc } from "./db-ipc";
import { configureAppCommandLine, configureCertificateHandling, disableApplicationMenu, logGPUInfo } from "./app/app-lifecycle";
import { createWindow } from "./app/create-window";
import { registerAppUpdater } from "./app/app-updater";
import { loadInitialProjectRoot } from "./project-core/project-root";
import { registerArchiveIpc } from "./ipc/archive-ipc";
import { registerCalibrationGrpcIpc } from "./ipc/calibration-grpc-ipc";
import { registerDeviceVerifyIpc } from "./ipc/device-verify-ipc";
import { registerExportTaskIpc } from "./ipc/export-task-ipc";
import { registerFileIpc } from "./ipc/file-ipc";
import { registerProjectIpc } from "./ipc/project-ipc";
import { registerPotreeIpc } from "./ipc/potree-ipc";
import { registerSystemIpc } from "./ipc/system-ipc";
import { configureProjectAssetScheme, registerProjectAssetProtocol } from "./potree/project-asset-protocol";

configureAppCommandLine();
disableApplicationMenu();
configureCertificateHandling();
configureProjectAssetScheme();

app.whenReady().then(async () => {
  await logGPUInfo();
  loadInitialProjectRoot();
  registerProjectAssetProtocol();

  registerSystemIpc();
  registerFileIpc();
  registerProjectIpc();
  registerPotreeIpc();
  registerArchiveIpc();
  registerCalibrationGrpcIpc();
  registerDeviceVerifyIpc();
  registerExportTaskIpc();

  await initDbIpc();
  const startUpdateCheck = registerAppUpdater();
  const window = createWindow();
  window.once("ready-to-show", startUpdateCheck);
});

app.on("before-quit", () => {
  closeDbIpc();
});

app.on("window-all-closed", () => {
  closeDbIpc();
  if (process.platform !== "darwin") app.quit();
});
