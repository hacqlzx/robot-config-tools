import { ipcMain, type IpcMainInvokeEvent } from "electron";

const activeOperations = new Map<symbol, string>();
let migrating = false;
const rootChangeListeners = new Set<() => void>();

export function onProjectRootChanged(listener: () => void): void {
  rootChangeListeners.add(listener);
}

export function notifyProjectRootChanged(): void {
  for (const listener of rootChangeListeners) {
    try { listener(); } catch (error) { console.error("清理项目路径缓存失败", error); }
  }
}

export function isProjectDirectoryMigrating(): boolean { return migrating; }

export function beginProjectOperation(label: string): () => void {
  if (migrating) throw new Error("保存目录正在迁移，请完成后重试");
  const token = Symbol(label);
  activeOperations.set(token, label);
  return () => { activeOperations.delete(token); };
}

/** 后台操作与迁移互斥；已有操作完成后用户可重试，不强行终止写入。 */
export function beginProjectDirectoryMigration(): () => void {
  if (migrating) throw new Error("已有保存目录迁移进行中");
  if (activeOperations.size) throw new Error("项目文件正在读取、保存或处理，请等待当前操作完成后再迁移");
  migrating = true;
  return () => { migrating = false; };
}

export function registerProjectActivityHandler(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const release = beginProjectOperation(channel);
    try { return await handler(event, ...args); } finally { release(); }
  });
}
