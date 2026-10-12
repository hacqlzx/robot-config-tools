export type AppUpdatePhase = "disabled" | "idle" | "checking" | "available" | "latest" | "downloading" | "downloaded" | "installing" | "error";

export interface AppUpdateState {
  currentVersion: string;
  phase: AppUpdatePhase;
  latestVersion?: string;
  progress?: number;
  message?: string;
  checkedAt?: string;
}

export interface AppUpdateActionResult {
  success: boolean;
  state: AppUpdateState;
  error?: string;
}
