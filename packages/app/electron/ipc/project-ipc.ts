import { ipcMain } from "electron";
import {
  createProject,
  deleteProject,
  deleteProjectPath,
  exportProjectFile,
  exportProjectZip,
  getProjectDatabaseSummary,
  getProjectManifest,
  importProjectModel,
  importProjectModelZip,
  listProjects,
  listProjectTree,
  openProjectPath,
  renameProject,
  renameProjectPath,
  writeProjectFile,
  type ExportZipItem,
} from "../project-core/project-service";

export function registerProjectIpc(): void {
  ipcMain.handle("project:list", async () => listProjects());
  ipcMain.handle("project:create", async (_event, name: string) => createProject(name));
  ipcMain.handle("project:rename", async (_event, oldName: string, newName: string) => renameProject(oldName, newName));
  ipcMain.handle("project:delete", async (_event, name: string) => deleteProject(name));
  ipcMain.handle("project:data-summary", async (_event, name: string) => getProjectDatabaseSummary(name));
  ipcMain.handle("project:import-file", async (_event, projectName: string, sourcePath: string, fileName: string) =>
    importProjectModel(projectName, sourcePath, fileName),
  );
  ipcMain.handle("project:import-model-zip", async (_event, projectName: string, sourcePath: string) =>
    importProjectModelZip(projectName, sourcePath),
  );
  ipcMain.handle("project:get-manifest", async (_event, projectName: string) => getProjectManifest(projectName));
  ipcMain.handle("project:list-tree", async (_event, projectName: string, subDir: string) => listProjectTree(projectName, subDir));
  ipcMain.handle("project:write-file", async (_event, projectName: string, subPath: string, data: ArrayBuffer) =>
    writeProjectFile(projectName, subPath, data),
  );
  ipcMain.handle("project:delete-path", async (_event, targetPath: string) => deleteProjectPath(targetPath));
  ipcMain.handle("project:rename-path", async (_event, targetPath: string, newName: string) => renameProjectPath(targetPath, newName));
  ipcMain.handle("project:open-dir", async (_event, targetPath: string) => openProjectPath(targetPath));
  ipcMain.handle("project:export-file", async (_event, projectName: string, subPath: string, destDir: string) =>
    exportProjectFile(projectName, subPath, destDir),
  );
  ipcMain.handle("project:export-zip", async (event, projectName: string, items: ExportZipItem[], destDir: string) =>
    exportProjectZip(projectName, items, destDir, (step, pct) => {
      event.sender.send("export:progress", { step, pct });
    }),
  );
}
