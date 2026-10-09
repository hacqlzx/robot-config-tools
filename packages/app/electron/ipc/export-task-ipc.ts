import { BrowserWindow, ipcMain, shell } from "electron";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { buildBackendResponseError, requestBackendResource } from "../backend-http";
import { exportProjectZip, prepareProjectZipExport, type ExportZipItem } from "../project-core/project-service";
import {
  exportCabinetAnnotationParams,
  exportCabinetPointTable,
  exportImageLabelsArchive,
  exportSurveyDataArchive,
  prepareCabinetAnnotationParamsExport,
  prepareCabinetPointTableExport,
  prepareImageLabelsArchive,
  prepareSurveyDataArchive,
} from "./archive-ipc";
import {
  exportDeviceVerificationCorrectionData,
  exportMarkedDeviceVerificationPoints,
  prepareDeviceVerificationCorrectionData,
  prepareMarkedDeviceVerificationPoints,
} from "./device-verify-ipc";
import {
  exportInspectionPointExcel,
  exportNormalAnnotationExcel,
  prepareInspectionPointExport,
  prepareNormalAnnotationExport,
} from "../normal-annotation-export";

type ExportTaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";
type LocalExportOperation =
  | "project-export-zip"
  | "survey-data"
  | "image-labels"
  | "cabinet-point-table"
  | "cabinet-annotation-params"
  | "device-correction-data"
  | "device-marked-points"
  | "normal-annotations"
  | "inspection-points";

interface RemoteExportTaskRequest {
  type: "remote-export";
  name: string;
  backendIp: string;
  exportPath: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  destDir: string;
  preferredFileName?: string;
}

interface RemoteDownloadTaskRequest {
  type: "remote-download";
  name: string;
  backendIp: string;
  downloadPath: string;
  destDir: string;
  preferredFileName?: string;
}

interface LocalExportTaskRequest {
  type: "local-export";
  name: string;
  operation: LocalExportOperation;
  destDir: string;
  payload?: Record<string, unknown>;
}

interface LocalExportPrepareRequest {
  operation: LocalExportOperation;
  payload?: Record<string, unknown>;
}

type ExportTaskRequest = RemoteExportTaskRequest | RemoteDownloadTaskRequest | LocalExportTaskRequest;

interface LocalExportResult {
  success?: boolean;
  error?: string;
  filePath?: string;
  fileName?: string;
  zipPath?: string;
  zipName?: string;
}

interface ExportTaskRecord {
  id: string;
  type: string;
  name: string;
  status: ExportTaskStatus;
  progress: number | null;
  message: string;
  outputPath: string;
  outputDir: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  request: ExportTaskRequest;
}

const MAX_TASK_HISTORY = 20;
const EXPORT_TASK_CHANGED_CHANNEL = "export-task:changed";
class ExportTaskManager {
  private tasks: ExportTaskRecord[] = [];
  private runningTaskId = "";
  private runningAbort: AbortController | null = null;
  private runTokens = new Map<string, number>();

  list(): ExportTaskRecord[] {
    return this.tasks.map(toPublicTask);
  }

  async createRemoteExport(request: RemoteExportTaskRequest): Promise<ExportTaskRecord> {
    if (this.runningTaskId) {
      throw new Error("已有导出任务进行中");
    }

    validateRemoteExportRequest(request);
    const task: ExportTaskRecord = {
      id: createTaskId(),
      type: request.type || "export",
      name: request.name || "导出任务",
      status: "pending",
      progress: null,
      message: "等待导出",
      outputPath: "",
      outputDir: path.resolve(request.destDir),
      fileName: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      request: { ...request, destDir: path.resolve(request.destDir) },
    };

    this.tasks.unshift(task);
    this.tasks = this.tasks.slice(0, MAX_TASK_HISTORY);
    this.emitChange();

    void this.runRemoteExportTask(task);
    return toPublicTask(task);
  }

  async createRemoteDownload(request: RemoteDownloadTaskRequest): Promise<ExportTaskRecord> {
    if (this.runningTaskId) {
      throw new Error("已有导出任务进行中");
    }

    validateRemoteDownloadRequest(request);
    const task: ExportTaskRecord = {
      id: createTaskId(),
      type: "remote-download",
      name: request.name || "导出任务",
      status: "pending",
      progress: null,
      message: "等待导出",
      outputPath: "",
      outputDir: path.resolve(request.destDir),
      fileName: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      request: { ...request, destDir: path.resolve(request.destDir) },
    };

    this.tasks.unshift(task);
    this.tasks = this.tasks.slice(0, MAX_TASK_HISTORY);
    this.emitChange();

    void this.runRemoteDownloadTask(task);
    return toPublicTask(task);
  }

  async createLocalExport(request: LocalExportTaskRequest): Promise<ExportTaskRecord> {
    if (this.runningTaskId) {
      throw new Error("已有导出任务进行中");
    }

    validateLocalExportRequest(request);
    await prepareLocalExport(request);
    const task: ExportTaskRecord = {
      id: createTaskId(),
      type: "local-export",
      name: request.name || "导出任务",
      status: "pending",
      progress: null,
      message: "等待导出",
      outputPath: "",
      outputDir: path.resolve(request.destDir),
      fileName: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      request: { ...request, destDir: path.resolve(request.destDir) },
    };

    this.tasks.unshift(task);
    this.tasks = this.tasks.slice(0, MAX_TASK_HISTORY);
    this.emitChange();

    void this.runLocalExportTask(task);
    return toPublicTask(task);
  }

  cancel(taskId: string): ExportTaskRecord | null {
    const task = this.findTask(taskId);
    if (!task) return null;
    if (task.status !== "running" && task.status !== "pending") return toPublicTask(task);
    this.invalidateRun(task.id);
    this.runningAbort?.abort();
    task.status = "cancelled";
    task.message = "已取消";
    task.progress = null;
    task.updatedAt = Date.now();
    if (this.runningTaskId === task.id) {
      this.runningTaskId = "";
      this.runningAbort = null;
    }
    this.emitChange();
    return toPublicTask(task);
  }

  async retry(taskId: string): Promise<ExportTaskRecord> {
    if (this.runningTaskId) throw new Error("已有导出任务进行中");
    const task = this.findTask(taskId);
    if (!task) throw new Error("任务不存在");
    validateExportRequest(task.request);
    if (task.request.type === "local-export") {
      await prepareLocalExport(task.request);
    }
    task.status = "pending";
    task.progress = null;
    task.message = "等待重试";
    task.outputPath = "";
    task.fileName = "";
    task.updatedAt = Date.now();
    this.tasks = [task, ...this.tasks.filter((item) => item.id !== task.id)];
    this.emitChange();
    if (task.request.type === "local-export") {
      void this.runLocalExportTask(task);
    } else if (task.request.type === "remote-download") {
      void this.runRemoteDownloadTask(task);
    } else {
      void this.runRemoteExportTask(task);
    }
    return toPublicTask(task);
  }

  remove(taskId: string): ExportTaskRecord | null {
    const task = this.findTask(taskId);
    if (!task) return null;
    if (task.status === "running" || task.status === "pending") {
      this.invalidateRun(task.id);
      this.runningAbort?.abort();
      if (this.runningTaskId === task.id) {
        this.runningTaskId = "";
        this.runningAbort = null;
      }
    }
    this.tasks = this.tasks.filter((item) => item.id !== task.id);
    this.emitChange();
    return toPublicTask(task);
  }

  async openFolder(taskId: string): Promise<boolean> {
    const task = this.findTask(taskId);
    if (!task) throw new Error("任务不存在");
    if (task.outputPath && fs.existsSync(task.outputPath)) {
      shell.showItemInFolder(task.outputPath);
      return true;
    }
    const dir = task.outputDir || task.request.destDir;
    if (dir && fs.existsSync(dir)) {
      await shell.openPath(dir);
      return true;
    }
    throw new Error("导出目录不存在");
  }

  private async runRemoteExportTask(task: ExportTaskRecord): Promise<void> {
    if (task.request.type !== "remote-export") return;
    if (!this.findTask(task.id)) return;
    const runToken = this.nextRunToken(task.id);
    this.runningTaskId = task.id;
    const abortController = new AbortController();
    this.runningAbort = abortController;
    let tempPath = "";

    try {
      this.updateTask(task, { status: "running", message: "正在获取下载地址" });
      const exportUrl = buildBackendUrl(task.request.backendIp, task.request.exportPath, task.request.query);
      const filePath = await requestRemoteExportFile(exportUrl, abortController.signal);
      if (!this.isCurrentRun(task.id, runToken)) return;

      this.updateTask(task, { message: "正在下载文件" });
      const downloadUrl = buildBackendUrl(task.request.backendIp, filePath);
      const fileName = uniqueDownloadFileName(
        task.outputDir,
        normalizeDownloadFileName(task.request.preferredFileName || getDownloadFileName(filePath, `${task.name}.zip`)),
      );
      const outputPath = path.join(task.outputDir, fileName);
      tempPath = `${outputPath}.download-${process.pid}-${Date.now()}`;

      const response = await requestBackendResource(downloadUrl, {
        signal: abortController.signal,
        responseType: "stream",
      }, "导出文件下载");
      if (response.status < 200 || response.status >= 300) {
        throw new Error(await buildBackendResponseError(response, "导出文件下载失败"));
      }
      if (!response.data) throw new Error("下载内容为空");

      await pipeline(
        response.data,
        fs.createWriteStream(tempPath),
        { signal: abortController.signal } as any,
      );
      if (!this.isCurrentRun(task.id, runToken)) return;
      await fs.promises.rename(tempPath, outputPath);
      tempPath = "";

      this.updateTask(task, {
        status: "success",
        message: "导出完成",
        outputPath,
        fileName,
      });
    } catch (error: any) {
      if (tempPath) {
        await fs.promises.rm(tempPath, { force: true }).catch((): undefined => undefined);
      }
      if (!this.isCurrentRun(task.id, runToken)) return;
      const aborted = abortController.signal.aborted || error?.name === "AbortError" || task.status === "cancelled";
      this.updateTask(task, {
        status: aborted ? "cancelled" : "failed",
        message: aborted ? "已取消" : (error?.message || "导出失败"),
      });
    } finally {
      if (this.isCurrentRun(task.id, runToken)) {
        if (this.runningTaskId === task.id) this.runningTaskId = "";
        if (this.runningAbort === abortController) this.runningAbort = null;
      }
    }
  }

  private async runRemoteDownloadTask(task: ExportTaskRecord): Promise<void> {
    if (task.request.type !== "remote-download") return;
    if (!this.findTask(task.id)) return;
    const runToken = this.nextRunToken(task.id);
    this.runningTaskId = task.id;
    const abortController = new AbortController();
    this.runningAbort = abortController;
    let tempPath = "";

    try {
      this.updateTask(task, { status: "running", message: "正在下载文件" });
      const downloadUrl = buildBackendUrl(task.request.backendIp, task.request.downloadPath);
      const fileName = uniqueDownloadFileName(
        task.outputDir,
        normalizeDownloadFileName(task.request.preferredFileName || task.request.downloadPath.split("/").pop() || `${task.name}.zip`),
      );
      const outputPath = path.join(task.outputDir, fileName);
      tempPath = `${outputPath}.download-${process.pid}-${Date.now()}`;

      const response = await requestBackendResource(downloadUrl, {
        signal: abortController.signal,
        responseType: "stream",
      }, "后台文件下载");
      if (response.status < 200 || response.status >= 300) {
        throw new Error(await buildBackendResponseError(response, "后台文件下载失败"));
      }
      if (!response.data) throw new Error("下载内容为空");

      await pipeline(
        response.data,
        fs.createWriteStream(tempPath),
        { signal: abortController.signal } as any,
      );
      if (!this.isCurrentRun(task.id, runToken)) return;
      await fs.promises.rename(tempPath, outputPath);
      tempPath = "";

      this.updateTask(task, {
        status: "success",
        message: "导出完成",
        outputPath,
        fileName,
      });
    } catch (error: any) {
      if (tempPath) {
        await fs.promises.rm(tempPath, { force: true }).catch((): undefined => undefined);
      }
      if (!this.isCurrentRun(task.id, runToken)) return;
      const aborted = abortController.signal.aborted || error?.name === "AbortError" || task.status === "cancelled";
      this.updateTask(task, {
        status: aborted ? "cancelled" : "failed",
        message: aborted ? "已取消" : (error?.message || "导出失败"),
      });
    } finally {
      if (this.isCurrentRun(task.id, runToken)) {
        if (this.runningTaskId === task.id) this.runningTaskId = "";
        if (this.runningAbort === abortController) this.runningAbort = null;
      }
    }
  }

  private async runLocalExportTask(task: ExportTaskRecord): Promise<void> {
    if (task.request.type !== "local-export") return;
    if (!this.findTask(task.id)) return;
    const runToken = this.nextRunToken(task.id);
    this.runningTaskId = task.id;

    try {
      this.updateTask(task, { status: "running", message: "正在导出文件", progress: null });
      const result = await executeLocalExport(task.request, (step, pct) => {
        if (!this.isCurrentRun(task.id, runToken)) return;
        this.updateTask(task, {
          message: step || "正在导出文件",
          progress: Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null,
        });
      });
      if (!this.isCurrentRun(task.id, runToken)) return;

      const normalized = normalizeLocalExportResult(result, task.name);
      this.updateTask(task, {
        status: "success",
        progress: 100,
        message: "导出完成",
        outputPath: normalized.outputPath,
        outputDir: path.dirname(normalized.outputPath) || task.outputDir,
        fileName: normalized.fileName,
      });
    } catch (error: any) {
      if (!this.isCurrentRun(task.id, runToken)) return;
      const cancelled = task.status === "cancelled";
      this.updateTask(task, {
        status: cancelled ? "cancelled" : "failed",
        message: cancelled ? "已取消" : (error?.message || "导出失败"),
        progress: null,
      });
    } finally {
      if (this.isCurrentRun(task.id, runToken)) {
        if (this.runningTaskId === task.id) this.runningTaskId = "";
      }
    }
  }

  private updateTask(task: ExportTaskRecord, patch: Partial<ExportTaskRecord>) {
    Object.assign(task, patch, { updatedAt: Date.now() });
    this.emitChange();
  }

  private findTask(taskId: string): ExportTaskRecord | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  private nextRunToken(taskId: string): number {
    const token = (this.runTokens.get(taskId) || 0) + 1;
    this.runTokens.set(taskId, token);
    return token;
  }

  private invalidateRun(taskId: string): void {
    this.nextRunToken(taskId);
  }

  private isCurrentRun(taskId: string, token: number): boolean {
    return this.runTokens.get(taskId) === token;
  }

  private emitChange() {
    const payload = this.list();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(EXPORT_TASK_CHANGED_CHANNEL, payload);
      }
    }
  }
}

const manager = new ExportTaskManager();

export function registerExportTaskIpc(): void {
  ipcMain.handle("export-task:list", () => manager.list());
  ipcMain.handle("export-task:prepare-local", async (_event, request: LocalExportPrepareRequest) => {
    try {
      await prepareLocalExport(request);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || "导出校验失败" };
    }
  });
  ipcMain.handle("export-task:create", async (_event, request: ExportTaskRequest) => {
    try {
      const task = request?.type === "local-export"
        ? await manager.createLocalExport(request)
        : request?.type === "remote-download"
          ? await manager.createRemoteDownload(request)
          : await manager.createRemoteExport(request as RemoteExportTaskRequest);
      return { success: true, task };
    } catch (error: any) {
      return { success: false, error: error?.message || "创建导出任务失败" };
    }
  });
  ipcMain.handle("export-task:cancel", (_event, taskId: string) => {
    try {
      const task = manager.cancel(taskId);
      return { success: true, task };
    } catch (error: any) {
      return { success: false, error: error?.message || "取消导出任务失败" };
    }
  });
  ipcMain.handle("export-task:retry", async (_event, taskId: string) => {
    try {
      const task = await manager.retry(taskId);
      return { success: true, task };
    } catch (error: any) {
      return { success: false, error: error?.message || "重试导出任务失败" };
    }
  });
  ipcMain.handle("export-task:open-folder", async (_event, taskId: string) => {
    try {
      await manager.openFolder(taskId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || "打开导出目录失败" };
    }
  });
  ipcMain.handle("export-task:remove", (_event, taskId: string) => {
    try {
      const task = manager.remove(taskId);
      return { success: true, task };
    } catch (error: any) {
      return { success: false, error: error?.message || "移出导出列表失败" };
    }
  });
}

async function requestRemoteExportFile(url: string, signal: AbortSignal): Promise<string> {
  const response = await requestBackendResource(url, {
    signal,
    headers: createBackendJsonHeaders(),
    responseType: "json",
  }, "后台导出接口");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(await buildBackendResponseError(response, "导出接口失败"));
  }
  const body = response.data as any;
  if (body?.success !== true && Number(body?.code) !== 200) {
    throw new Error(body?.message || "获取下载路径失败");
  }
  const downloadPath = extractDownloadPath(body?.data);
  if (!downloadPath) throw new Error(body?.message || "获取下载路径失败");
  return downloadPath;
}

function extractDownloadPath(data: unknown): string {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const record = data as Record<string, unknown>;
  for (const key of ["fileUrl", "downloadUrl", "url", "filePath", "path"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function createBackendJsonHeaders(): Record<string, string> {
  return {
    "req-id": Date.now().toString() + Math.random().toString(36).slice(2, 8),
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
  };
}

function validateRemoteExportRequest(request: RemoteExportTaskRequest) {
  if (!request || typeof request !== "object") throw new Error("导出参数无效");
  const outputDir = path.resolve(String(request.destDir || "").trim());
  const stat = fs.existsSync(outputDir) ? fs.statSync(outputDir) : null;
  if (!stat?.isDirectory()) throw new Error("保存目录无效");
  buildBackendUrl(request.backendIp, request.exportPath, request.query);
}

function validateRemoteDownloadRequest(request: RemoteDownloadTaskRequest) {
  if (!request || typeof request !== "object") throw new Error("导出参数无效");
  const outputDir = path.resolve(String(request.destDir || "").trim());
  const stat = fs.existsSync(outputDir) ? fs.statSync(outputDir) : null;
  if (!stat?.isDirectory()) throw new Error("保存目录无效");
  buildBackendUrl(request.backendIp, request.downloadPath);
}

function validateLocalExportRequest(request: LocalExportTaskRequest) {
  if (!request || typeof request !== "object") throw new Error("导出参数无效");
  const outputDir = path.resolve(String(request.destDir || "").trim());
  const stat = fs.existsSync(outputDir) ? fs.statSync(outputDir) : null;
  if (!stat?.isDirectory()) throw new Error("保存目录无效");
  validateLocalExportOperation(request.operation);
}

function validateExportRequest(request: ExportTaskRequest) {
  if (request.type === "local-export") {
    validateLocalExportRequest(request);
  } else if (request.type === "remote-download") {
    validateRemoteDownloadRequest(request);
  } else {
    validateRemoteExportRequest(request);
  }
}

function validateLocalExportOperation(operation: LocalExportOperation) {
  if (!LOCAL_EXPORT_OPERATIONS.has(operation)) throw new Error("不支持的本地导出类型");
}

async function prepareLocalExport(request: LocalExportPrepareRequest): Promise<void> {
  if (!request || typeof request !== "object") throw new Error("导出参数无效");
  validateLocalExportOperation(request.operation);

  switch (request.operation) {
    case "project-export-zip": {
      const projectName = asString(request.payload?.projectName);
      const items = Array.isArray(request.payload?.items) ? request.payload.items as ExportZipItem[] : [];
      prepareProjectZipExport(projectName, items);
      return;
    }
    case "survey-data": {
      const projectName = asString(request.payload?.projectName);
      const mapName = asString(request.payload?.mapName);
      prepareSurveyDataArchive(projectName, mapName);
      return;
    }
    case "image-labels": {
      const projectName = asString(request.payload?.projectName);
      const mapName = asString(request.payload?.mapName);
      prepareImageLabelsArchive(projectName, mapName);
      return;
    }
    case "cabinet-point-table": {
      const projectName = asString(request.payload?.projectName);
      prepareCabinetPointTableExport(projectName);
      return;
    }
    case "cabinet-annotation-params": {
      const projectName = asString(request.payload?.projectName);
      prepareCabinetAnnotationParamsExport(projectName, request.payload?.data);
      return;
    }
    case "device-correction-data": {
      const projectName = asString(request.payload?.projectName);
      prepareDeviceVerificationCorrectionData(projectName);
      return;
    }
    case "device-marked-points": {
      const projectName = asString(request.payload?.projectName);
      prepareMarkedDeviceVerificationPoints(projectName);
      return;
    }
    case "normal-annotations": {
      const projectName = asString(request.payload?.projectName);
      prepareNormalAnnotationExport(projectName, request.payload?.items);
      return;
    }
    case "inspection-points": {
      const projectName = asString(request.payload?.projectName);
      prepareInspectionPointExport(projectName, request.payload?.items);
      return;
    }
    default:
      throw new Error("不支持的本地导出类型");
  }
}

async function executeLocalExport(
  request: LocalExportTaskRequest,
  onProgress?: (step: string, pct: number) => void,
): Promise<LocalExportResult> {
  switch (request.operation) {
    case "project-export-zip": {
      const projectName = asString(request.payload?.projectName);
      const items = Array.isArray(request.payload?.items) ? request.payload.items as ExportZipItem[] : [];
      onProgress?.("准备导出文件", 5);
      const result = await exportProjectZip(projectName, items, request.destDir, (step, pct) => onProgress?.(step, pct));
      return { success: true, zipPath: result.zipPath, zipName: result.zipName };
    }
    case "survey-data": {
      const projectName = asString(request.payload?.projectName);
      const mapName = asString(request.payload?.mapName);
      onProgress?.("准备导出勘察图像", 20);
      return { success: true, ...(await exportSurveyDataArchive(projectName, mapName, request.destDir)) };
    }
    case "image-labels": {
      const projectName = asString(request.payload?.projectName);
      const mapName = asString(request.payload?.mapName);
      onProgress?.("准备导出图像标识", 20);
      return { success: true, ...(await exportImageLabelsArchive(projectName, mapName, request.destDir)) };
    }
    case "cabinet-point-table": {
      const projectName = asString(request.payload?.projectName);
      onProgress?.("准备导出屏柜点表", 20);
      return { success: true, ...(await exportCabinetPointTable(projectName, request.destDir)) };
    }
    case "cabinet-annotation-params": {
      const projectName = asString(request.payload?.projectName);
      const data = request.payload?.data;
      onProgress?.("准备导出标注参数", 20);
      return { success: true, ...exportCabinetAnnotationParams(projectName, request.destDir, data) };
    }
    case "device-correction-data": {
      const projectName = asString(request.payload?.projectName);
      onProgress?.("准备导出纠偏数据", 20);
      return { success: true, ...exportDeviceVerificationCorrectionData(projectName, request.destDir) };
    }
    case "device-marked-points": {
      const projectName = asString(request.payload?.projectName);
      onProgress?.("准备导出标记点位", 20);
      return { success: true, ...exportMarkedDeviceVerificationPoints(projectName, request.destDir) };
    }
    case "normal-annotations": {
      const projectName = asString(request.payload?.projectName);
      onProgress?.("准备导出法线标注", 20);
      return { success: true, ...exportNormalAnnotationExcel(projectName, request.destDir, request.payload?.items) };
    }
    case "inspection-points": {
      const projectName = asString(request.payload?.projectName);
      onProgress?.("准备导出巡检点标注", 20);
      return { success: true, ...exportInspectionPointExcel(projectName, request.destDir, request.payload?.items) };
    }
    default:
      throw new Error("不支持的本地导出类型");
  }
}

function normalizeLocalExportResult(result: LocalExportResult, fallbackName: string): { outputPath: string; fileName: string } {
  if (!result || result.success === false) {
    throw new Error(result?.error || "导出失败");
  }
  const outputPath = String(result.filePath || result.zipPath || "").trim();
  if (!outputPath) throw new Error("导出结果无效");
  const fileName = path.basename(outputPath) || result.fileName || result.zipName || fallbackName;
  return { outputPath, fileName };
}

function buildBackendUrl(backendIp: string, requestPath: string, query?: RemoteExportTaskRequest["query"]): string {
  const baseText = String(backendIp || "").trim();
  if (!baseText) throw new Error("请先连接后台");
  const pathText = String(requestPath || "").trim();
  if (!pathText) throw new Error("下载地址为空");
  if (/^[a-z][a-z\d+.-]*:/i.test(pathText) && !/^https?:\/\//i.test(pathText)) {
    throw new Error("仅支持 HTTP/HTTPS 下载地址");
  }

  const base = /^https?:\/\//i.test(baseText) ? baseText : `https://${baseText}`;
  const url = /^https?:\/\//i.test(pathText)
    ? new URL(pathText)
    : new URL(pathText.startsWith("/") ? pathText : `/${pathText}`, base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持 HTTP/HTTPS 下载地址");
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function normalizeDownloadFileName(value: string): string {
  const baseName = path.basename(String(value || "").trim())
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "");
  return baseName || "download.bin";
}

function getDownloadFileName(downloadPath: string, fallback: string): string {
  let filePath = String(downloadPath || "").trim();
  try {
    filePath = new URL(filePath).pathname;
  } catch {
    filePath = filePath.split(/[?#]/, 1)[0];
  }
  const encodedName = filePath.split(/[\\/]/).pop() || fallback;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function uniqueDownloadFileName(dir: string, preferredName: string): string {
  const parsed = path.parse(preferredName);
  let candidate = preferredName;
  let index = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${parsed.name}_${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function createTaskId(): string {
  return `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPublicTask(task: ExportTaskRecord): ExportTaskRecord {
  return {
    ...task,
    request: { ...task.request },
  };
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

const LOCAL_EXPORT_OPERATIONS = new Set<LocalExportOperation>([
  "project-export-zip",
  "survey-data",
  "image-labels",
  "cabinet-point-table",
  "cabinet-annotation-params",
  "device-correction-data",
  "device-marked-points",
  "normal-annotations",
  "inspection-points",
]);
