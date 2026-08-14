import { ipcMain } from "electron";
import { ensurePotreeModel } from "../potree/potree-converter";
import { clipLasModel, type LasClipBounds } from "../potree/las-clip";

export function registerPotreeIpc(): void {
  ipcMain.handle("potree:ensure-model", async (event, projectName: string, modelPath: string) =>
    ensurePotreeModel(projectName, modelPath, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("potree:conversion-progress", progress);
    }),
  );
  ipcMain.handle("potree:clip-model", async (
    event,
    projectName: string,
    modelPath: string,
    bounds: LasClipBounds,
  ) => clipLasModel(projectName, modelPath, bounds, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("potree:clip-progress", progress);
  }));
}
