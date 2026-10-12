import type { AppUpdateActionResult, AppUpdateState } from "../../src/shared/app-update";

/** Small adapter so update lifecycle can be tested without Electron or an installer. */
export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export class UpdateController {
  private state: AppUpdateState;
  private busy = false;
  private hasUpdate = false;
  private hasDownload = false;

  constructor(
    private readonly updater: UpdateAdapter,
    version: string,
    private readonly enabled: boolean,
    private readonly changed: (state: AppUpdateState) => void,
  ) {
    this.state = { currentVersion: version, phase: enabled ? "idle" : "disabled", message: enabled ? undefined : "开发模式不检查更新" };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("checking-for-update", () => this.setState({ phase: "checking", message: undefined }));
    updater.on("update-available", (info: { version: string }) => {
      this.hasUpdate = true;
      this.setState({ phase: "available", latestVersion: info.version, message: undefined, checkedAt: new Date().toISOString() });
    });
    updater.on("update-not-available", () => {
      this.hasUpdate = false;
      this.setState({ phase: "latest", latestVersion: undefined, progress: undefined, message: undefined, checkedAt: new Date().toISOString() });
    });
    updater.on("download-progress", (info: { percent: number }) => this.setState({ phase: "downloading", progress: Math.max(0, Math.min(100, info.percent)) }));
    updater.on("update-downloaded", (info: { version: string }) => {
      this.hasDownload = true;
      this.setState({ phase: "downloaded", latestVersion: info.version, progress: 100, message: undefined });
    });
    updater.on("error", (error: Error) => this.failed(error));
  }

  snapshot(): AppUpdateState {
    return { ...this.state };
  }

  private setState(next: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...next };
    this.changed(this.snapshot());
  }

  private failed(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const message = /404|ERR_UPDATER_LATEST_VERSION_NOT_FOUND/.test(detail)
      ? "暂未发布可用更新，请稍后重试"
      : /ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED/.test(detail)
        ? "无法连接更新服务器，请检查网络后重试"
        : "更新失败，请重试或从 GitHub Releases 下载安装包";
    this.setState({ phase: "error", message });
    console.error("[app-update]", detail);
  }

  private result(success: boolean, error?: string): AppUpdateActionResult {
    return { success, state: this.snapshot(), ...(error ? { error } : {}) };
  }

  async check(): Promise<AppUpdateActionResult> {
    if (!this.enabled) return this.result(false, "仅安装版支持在线更新");
    if (this.busy || this.hasDownload || this.state.phase === "installing") return this.result(true);
    this.busy = true;
    this.setState({ phase: "checking", message: undefined });
    try {
      const result = await this.updater.checkForUpdates();
      if (!result) throw new Error("更新检查未返回结果");
      return this.result(this.state.phase !== "error", this.state.message);
    } catch (error) {
      this.failed(error);
      return this.result(false, this.state.message);
    } finally {
      this.busy = false;
    }
  }

  async download(): Promise<AppUpdateActionResult> {
    if (!this.enabled) return this.result(false, "仅安装版支持在线更新");
    if (this.busy || this.hasDownload || this.state.phase === "installing") return this.result(true);
    if (!this.hasUpdate) return this.result(false, "请先检查可用更新");
    this.busy = true;
    this.setState({ phase: "downloading", progress: 0, message: undefined });
    try {
      await this.updater.downloadUpdate();
      return this.result(this.hasDownload, this.state.message);
    } catch (error) {
      this.failed(error);
      return this.result(false, this.state.message);
    } finally {
      this.busy = false;
    }
  }

  install(): AppUpdateActionResult {
    if (!this.enabled || !this.hasDownload || this.busy) return this.result(false, "更新尚未下载完成");
    if (this.state.phase === "installing") return this.result(true);
    this.setState({ phase: "installing", message: undefined });
    // Give the IPC response and the footer state time to reach the renderer.
    setImmediate(() => {
      try { this.updater.quitAndInstall(false, true); }
      catch (error) { this.failed(error); }
    });
    return this.result(true);
  }
}
