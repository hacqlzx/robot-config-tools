import { app } from "electron";
import { initDbIpc, closeDbIpc } from "./db-ipc";
import { configureAppCommandLine, configureCertificateHandling, disableApplicationMenu, logGPUInfo } from "./app/app-lifecycle";
import { migrateLegacyUserData } from "./app/legacy-user-data-migration";
import { createWindow } from "./app/create-window";
import { registerAppUpdater } from "./app/app-updater";
import { loadInitialProjectRoot } from "./project-core/project-root";
import { isProjectDirectoryMigrating } from "./project-core/project-activity";
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
app.setName("RobotConfigTools");
if (process.platform === "win32") app.setAppUserModelId("com.robot.config-tools");

app.whenReady().then(async () => {
  try {
    if (app.isPackaged) await migrateLegacyUserData();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[userData] Legacy data migration failed", error);
    app.showErrorBox("旧版数据迁移失败", `无法将旧版数据复制到新目录，应用尚未启动：\n${message}\n\n旧数据仍保留在原目录，请检查磁盘空间和文件权限后重试。`);
    app.quit();
    return;
  }

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

app.on("before-quit", (event) => {
  if (isProjectDirectoryMigrating()) { event.preventDefault(); return; }
  closeDbIpc();
});

app.on("window-all-closed", () => {
  closeDbIpc();
  if (process.platform !== "darwin") app.quit();
});
