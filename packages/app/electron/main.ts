import { app, dialog } from "electron";
import path from "node:path";
import { getDefaultDatabasePath } from "@robot/database";
import { initDbIpc, closeDbIpc } from "./db-ipc";
import { configureAppCommandLine, configureCertificateHandling, disableApplicationMenu, logGPUInfo } from "./app/app-lifecycle";
import { migrateLegacyUserDataForStartup } from "./app/legacy-user-data-migration";
import { createWindow } from "./app/create-window";
import { registerAppUpdater } from "./app/app-updater";
import { ensureProjectRoot, getProjectRoot, loadInitialProjectRoot } from "./project-core/project-root";
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
  if (app.isPackaged) await migrateLegacyUserDataForStartup();

  await logGPUInfo();
  try {
    loadInitialProjectRoot();
    ensureProjectRoot();
    await initDbIpc({
      projectRoot: getProjectRoot(),
      legacyDatabasePath: getDefaultDatabasePath(),
      journalPath: path.join(app.getPath("userData"), "project-database-migration.json"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[startup] Project initialization unavailable", error);
    dialog.showErrorBox("项目初始化失败", `应用无法初始化项目目录或数据库接口：\n${message}`);
    app.quit();
    return;
  }
  registerProjectAssetProtocol();
  registerSystemIpc();
  registerFileIpc();
  registerProjectIpc();
  registerPotreeIpc();
  registerArchiveIpc();
  registerCalibrationGrpcIpc();
  registerDeviceVerifyIpc();
  registerExportTaskIpc();
  const startUpdateCheck = registerAppUpdater();
  const window = createWindow();
  window.once("ready-to-show", startUpdateCheck);
});

let databaseCloseStarted = false;
let databaseClosed = false;

app.on("before-quit", (event) => {
  if (isProjectDirectoryMigrating()) { event.preventDefault(); return; }
  if (!databaseClosed) {
    event.preventDefault();
    if (databaseCloseStarted) return;
    databaseCloseStarted = true;
    void closeDbIpc().then(() => {
      databaseClosed = true;
      app.quit();
    }).catch((error) => {
      databaseCloseStarted = false;
      console.error("[DB] Database close failed", error);
      dialog.showErrorBox("数据库保存失败", `应用暂未退出，请检查磁盘空间和文件权限后重试：\n${error instanceof Error ? error.message : String(error)}`);
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
