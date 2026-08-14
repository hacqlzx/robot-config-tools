import { ipcMain } from "electron";
import { ensurePotreeModel } from "../potree/potree-converter";

export function registerPotreeIpc(): void {
  ipcMain.handle("potree:ensure-model", async (event, projectName: string, modelPath: string) =>
    ensurePotreeModel(projectName, modelPath, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("potree:conversion-progress", progress);
    }),
  );
}
