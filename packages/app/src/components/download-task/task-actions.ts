import { startDownloadTaskFlyAnimation } from "./events";

interface CreateLocalExportTaskOptions {
  name: string;
  operation: LocalExportOperation;
  destTitle: string;
  payload?: Record<string, unknown>;
  triggerElement?: HTMLElement;
}

export interface CreateDownloadTaskResult extends ExportTaskActionResult {
  cancelled?: boolean;
}

export async function createLocalExportTask({
  name,
  operation,
  destTitle,
  payload,
  triggerElement,
}: CreateLocalExportTaskOptions): Promise<CreateDownloadTaskResult> {
  const api = window.electronAPI;
  if (!api?.downloadTasks?.prepareLocal || !api.selectDir) {
    return { success: false, error: "仅 Electron 环境支持导出" };
  }

  if (await hasActiveDownloadTask(api)) {
    return { success: false, error: "已有导出任务进行中" };
  }

  const prepareResult = await api.downloadTasks.prepareLocal({ operation, payload });
  if (!prepareResult.success) return prepareResult;

  const destDir = await api.selectDir(destTitle);
  if (!destDir) return { success: true, cancelled: true };

  const result = await api.downloadTasks.create({
    type: "local-export",
    name,
    operation,
    destDir,
    payload,
  });

  if (result.success && triggerElement) {
    startDownloadTaskFlyAnimation(triggerElement);
  }
  return result;
}

async function hasActiveDownloadTask(api: NonNullable<Window["electronAPI"]>): Promise<boolean> {
  try {
    const tasks = await api.downloadTasks.list();
    return tasks.some((task) => task.status === "pending" || task.status === "running");
  } catch {
    return false;
  }
}
