import { registerProjectActivityHandler } from "../project-core/project-activity";
import { closeActiveProjectDatabase, openProjectDatabase } from "../project-core/project-database";
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
  inspectProjectModelZipImport,
  listProjects,
  listProjectTree,
  openProjectPath,
  renameProject,
  renameProjectPath,
  writeProjectFile,
  type ExportZipItem,
} from "../project-core/project-service";

export function registerProjectIpc(): void {
  registerProjectActivityHandler("project:list", async () => listProjects());
  registerProjectActivityHandler("project:open-database", async (_event, projectName: string) => openProjectDatabase(projectName));
  registerProjectActivityHandler("project:close-database", async () => closeActiveProjectDatabase());
  registerProjectActivityHandler("project:create", async (_event, name: string) => createProject(name));
  registerProjectActivityHandler("project:rename", async (_event, oldName: string, newName: string) => renameProject(oldName, newName));
  registerProjectActivityHandler("project:delete", async (_event, name: string) => deleteProject(name));
  registerProjectActivityHandler("project:data-summary", async (_event, name: string) => getProjectDatabaseSummary(name));
  registerProjectActivityHandler("project:import-file", async (_event, projectName: string, sourcePath: string, fileName: string) =>
    importProjectModel(projectName, sourcePath, fileName),
  );
  registerProjectActivityHandler("project:import-model-zip", async (_event, projectName: string, sourcePath: string) =>
    importProjectModelZip(projectName, sourcePath),
  );
  registerProjectActivityHandler("project:inspect-model-zip-import", async (_event, projectName: string, sourcePath: string) =>
    inspectProjectModelZipImport(projectName, sourcePath),
  );
  registerProjectActivityHandler("project:get-manifest", async (_event, projectName: string) => getProjectManifest(projectName));
  registerProjectActivityHandler("project:list-tree", async (_event, projectName: string, subDir: string) => listProjectTree(projectName, subDir));
  registerProjectActivityHandler("project:write-file", async (_event, projectName: string, subPath: string, data: ArrayBuffer) =>
    writeProjectFile(projectName, subPath, data),
  );
  registerProjectActivityHandler("project:delete-path", async (_event, targetPath: string) => deleteProjectPath(targetPath));
  registerProjectActivityHandler("project:rename-path", async (_event, targetPath: string, newName: string) => renameProjectPath(targetPath, newName));
  registerProjectActivityHandler("project:open-dir", async (_event, targetPath: string) => openProjectPath(targetPath));
  registerProjectActivityHandler("project:export-file", async (_event, projectName: string, subPath: string, destDir: string) =>
    exportProjectFile(projectName, subPath, destDir),
  );
  registerProjectActivityHandler("project:export-zip", async (event, projectName: string, items: ExportZipItem[], destDir: string) =>
    exportProjectZip(projectName, items, destDir, (step, pct) => {
      event.sender.send("export:progress", { step, pct });
    }),
  );
}
