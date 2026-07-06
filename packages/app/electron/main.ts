import { app } from "electron";
import { initDbIpc, closeDbIpc } from "./db-ipc";
import { configureAppCommandLine, configureCertificateHandling, disableApplicationMenu, logGPUInfo } from "./app/app-lifecycle";
import { createWindow } from "./app/create-window";
import { loadInitialProjectRoot } from "./project-core/project-root";
import { registerArchiveIpc } from "./ipc/archive-ipc";
import { registerFileIpc } from "./ipc/file-ipc";
import { registerProjectIpc } from "./ipc/project-ipc";
import { registerSystemIpc } from "./ipc/system-ipc";

configureAppCommandLine();
disableApplicationMenu();
configureCertificateHandling();

app.whenReady().then(async () => {
  await logGPUInfo();
  loadInitialProjectRoot();

  registerSystemIpc();
  registerFileIpc();
  registerProjectIpc();
  registerArchiveIpc();

  await initDbIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  closeDbIpc();
  if (process.platform !== "darwin") app.quit();
});
