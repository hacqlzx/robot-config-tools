import { useSyncExternalStore } from "react";

const SELECTED_PROJECT_KEY = "selectedProject";
const SELECTED_ROBOT_KEY = "selectedRobot";
const BACKEND_IP_KEY = "backend_current_ip";
const CACHED_ROBOT_LIST_KEY = "cachedRobotList";

export type ConnectionStatus = "disconnected" | "connected" | "failed";

export interface AppContextState {
  selectedProject: string | null;
  selectedRobot: string | null;
  backendIp: string;
  connectionStatus: ConnectionStatus;
  backendIpVersion: number;
}

type Listener = () => void;

export interface RobotOption {
  label: string;
  value: string;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function readRobotOptions(): RobotOption[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHED_ROBOT_LIST_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RobotOption =>
      typeof item?.label === "string" && typeof item?.value === "string",
    );
  } catch {
    return [];
  }
}

let state: AppContextState = {
  selectedProject: readStorage(SELECTED_PROJECT_KEY),
  selectedRobot: readStorage(SELECTED_ROBOT_KEY),
  backendIp: readStorage(BACKEND_IP_KEY) || "",
  connectionStatus: "disconnected",
  backendIpVersion: 0,
};

const listeners = new Set<Listener>();
const robotOptionListeners = new Set<Listener>();
let robotOptions = readRobotOptions();

function updateState(patch: Partial<AppContextState>): void {
  const next = { ...state, ...patch };
  const changed = Object.keys(patch).some((key) =>
    state[key as keyof AppContextState] !== next[key as keyof AppContextState],
  );
  if (!changed) return;
  state = next;
  listeners.forEach((listener) => listener());
}

export function getAppContextSnapshot(): AppContextState {
  return state;
}

export function subscribeAppContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRobotOptions(): RobotOption[] {
  return robotOptions;
}

export function subscribeRobotOptions(listener: Listener): () => void {
  robotOptionListeners.add(listener);
  return () => robotOptionListeners.delete(listener);
}

function updateRobotOptions(options: RobotOption[], validateSelection: boolean): void {
  const seen = new Set<string>();
  const next = options.reduce<RobotOption[]>((result, option) => {
    const value = option.value?.trim();
    if (!value || seen.has(value)) return result;
    seen.add(value);
    result.push({ label: option.label?.trim() || value, value });
    return result;
  }, []);
  const changed = next.length !== robotOptions.length
    || next.some((option, index) => option.label !== robotOptions[index]?.label
      || option.value !== robotOptions[index]?.value);
  if (validateSelection) {
    const currentRobot = getSelectedRobot();
    if (currentRobot && !next.some((option) => option.value === currentRobot)) {
      setSelectedRobot(null);
    }
  }
  if (!changed) return;

  robotOptions = next;
  writeStorage(CACHED_ROBOT_LIST_KEY, JSON.stringify(next));
  robotOptionListeners.forEach((listener) => listener());
}

/** 发布后台最新机器人列表，供运维页和顶部工具栏共享。 */
export function setRobotOptions(options: RobotOption[]): void {
  updateRobotOptions(options, true);
}

/** 后台切换期间暂时清空旧列表，等待新后台返回后再校验当前选择。 */
export function clearRobotOptions(): void {
  updateRobotOptions([], false);
}

/** 仅在后台连接状态或后台 IP 版本变化时通知配置页。 */
export function subscribeBackendContext(listener: Listener): () => void {
  let previous = state;
  return subscribeAppContext(() => {
    const next = state;
    const backendChanged = next.connectionStatus !== previous.connectionStatus
      || next.backendIpVersion !== previous.backendIpVersion;
    previous = next;
    if (backendChanged) listener();
  });
}

export function getSelectedProject(): string | null {
  return state.selectedProject;
}

export function setSelectedProject(projectName: string | null): void {
  const value = projectName?.trim() || null;
  writeStorage(SELECTED_PROJECT_KEY, value);
  updateState({ selectedProject: value });
}

export function getSelectedRobot(): string | null {
  return state.selectedRobot;
}

export function setSelectedRobot(robotName: string | null): void {
  const value = robotName?.trim() || null;
  writeStorage(SELECTED_ROBOT_KEY, value);
  updateState({ selectedRobot: value });
}

export function getBackendIp(): string {
  return state.backendIp;
}

export function setBackendIp(ip: string): void {
  const value = ip.trim();
  writeStorage(BACKEND_IP_KEY, value || null);
  updateState({ backendIp: value });
}

/** 成功连接后台后原子更新上下文，避免订阅方先读取到旧 IP。 */
export function setBackendConnection(ip: string, connectionStatus: ConnectionStatus): void {
  const value = ip.trim();
  const backendChanged = value !== state.backendIp;
  writeStorage(BACKEND_IP_KEY, value || null);
  if (backendChanged) writeStorage(SELECTED_ROBOT_KEY, null);
  updateState({
    backendIp: value,
    connectionStatus,
    backendIpVersion: state.backendIpVersion + 1,
    ...(backendChanged ? { selectedRobot: null } : {}),
  });
}

export function getConnectionStatus(): ConnectionStatus {
  return state.connectionStatus;
}

export function setConnectionStatus(connectionStatus: ConnectionStatus): void {
  updateState({ connectionStatus });
}

/** IP 切换成功后调用，供配置页重新拉取新后台的数据。 */
export function notifyBackendIpSwitch(): void {
  updateState({ backendIpVersion: state.backendIpVersion + 1 });
}

export function useAppContext(): AppContextState {
  return useSyncExternalStore(subscribeAppContext, getAppContextSnapshot, getAppContextSnapshot);
}

export function useSelectedProject(): string | null {
  return useSyncExternalStore(subscribeAppContext, getSelectedProject, getSelectedProject);
}

export function useSelectedRobot(): string | null {
  return useSyncExternalStore(subscribeAppContext, getSelectedRobot, getSelectedRobot);
}

export function useRobotOptions(): RobotOption[] {
  return useSyncExternalStore(subscribeRobotOptions, getRobotOptions, getRobotOptions);
}
