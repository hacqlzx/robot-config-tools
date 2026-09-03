import { ipcMain } from "electron";
import { ensurePotreeModel } from "../potree/potree-converter";
import { clipLasModel, type LasClipBounds } from "../potree/las-clip";
import { correctMapCoordinates } from "../potree/map-coordinate-correction";

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
  ipcMain.handle("potree:correct-map", async (
    event,
    projectName: string,
    modelPath: string,
    origin: [number, number, number],
  ) => correctMapCoordinates(projectName, modelPath, origin, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send("potree:correction-progress", progress);
  }));
}
