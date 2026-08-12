import { useSyncExternalStore } from "react";

const SELECTED_PROJECT_KEY = "selectedProject";
const SELECTED_ROBOT_KEY = "selectedRobot";
const BACKEND_IP_KEY = "backend_current_ip";
const CACHED_ROBOT_LIST_KEY = "cachedRobotList";
const CACHED_ROBOT_RECORDS_KEY = "cachedRobotRecords";

export type ConnectionStatus = "disconnected" | "connected" | "failed";

/**
 * 全局应用上下文。
 *
 * selectedProject：当前项目名称，业务页面用它定位项目目录和数据库项目字段。
 * selectedRobot：当前后台机器人名称/编码，配置和导入导出接口会用到。
 * backendIp：当前后台 IP，不包含协议头。
 * connectionStatus：后台连接状态，用于拦截请求和驱动顶部状态。
 * backendIpVersion：后台 IP 或连接成功事件的版本号，供配置页判断是否需要重新拉取数据。
 */
export interface AppContextState {
  selectedProject: string | null;
  selectedRobot: string | null;
  backendIp: string;
  connectionStatus: ConnectionStatus;
  backendIpVersion: number;
}

type Listener = () => void;

export interface RobotOption {
  /** 展示在顶部机器人下拉框里的名称 */
  label: string;
  /** 后台接口使用的机器人值 */
  value: string;
  /** 后台机器人 ID，导入导出和任务下发直接复用缓存，不再实时查询机器人列表。 */
  id?: number;
  /** 后台机器人编码，预留给后续需要编码的接口。 */
  robotCode?: string;
}

export interface RobotRecordCacheItem {
  id?: number;
  robotName?: string;
  robotCode?: string;
  [key: string]: unknown;
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

function clearStorage(keys: string[]): void {
  for (const key of keys) {
    writeStorage(key, null);
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

function readRobotRecords(): RobotRecordCacheItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHED_ROBOT_RECORDS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RobotRecordCacheItem =>
      item && typeof item === "object",
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
const robotRecordListeners = new Set<Listener>();
let robotOptions = readRobotOptions();
let robotRecords = readRobotRecords();

/**
 * 合并更新上下文状态，并只在实际变化时通知订阅者。
 */
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

export function getRobotRecords(): RobotRecordCacheItem[] {
  return robotRecords;
}

export function subscribeRobotRecords(listener: Listener): () => void {
  robotRecordListeners.add(listener);
  return () => robotRecordListeners.delete(listener);
}

/**
 * 更新机器人下拉选项。
 * validateSelection=true 时会校验当前选中机器人是否仍存在，不存在则清空。
 */
function updateRobotOptions(options: RobotOption[], validateSelection: boolean): void {
  const seen = new Set<string>();
  const next = options.reduce<RobotOption[]>((result, option) => {
    const value = option.value?.trim();
    if (!value || seen.has(value)) return result;
    seen.add(value);
    result.push({
      label: option.label?.trim() || value,
      value,
      id: Number.isFinite(Number(option.id)) ? Number(option.id) : undefined,
      robotCode: option.robotCode?.trim(),
    });
    return result;
  }, []);
  const changed = next.length !== robotOptions.length
    || next.some((option, index) => option.label !== robotOptions[index]?.label
      || option.value !== robotOptions[index]?.value
      || option.id !== robotOptions[index]?.id
      || option.robotCode !== robotOptions[index]?.robotCode);
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
  updateRobotRecords([], true);
}

/** 清除本地持久化缓存，回到未选择项目/机器人/后台的初始状态。 */
export function resetAppPersistentState(): void {
  clearStorage([SELECTED_PROJECT_KEY, SELECTED_ROBOT_KEY, BACKEND_IP_KEY, CACHED_ROBOT_LIST_KEY, CACHED_ROBOT_RECORDS_KEY]);
  robotOptions = [];
  robotRecords = [];
  updateState({
    selectedProject: null,
    selectedRobot: null,
    backendIp: "",
    connectionStatus: "disconnected",
    backendIpVersion: state.backendIpVersion + 1,
  });
  robotOptionListeners.forEach((listener) => listener());
  robotRecordListeners.forEach((listener) => listener());
}

/** 发布后台完整机器人列表，配置页表格和顶部选择框共享同一份缓存。 */
export function setRobotRecords(records: RobotRecordCacheItem[]): void {
  updateRobotRecords(records, true);
  setRobotOptions(records.map((robot) => ({
    label: String(robot.robotName || ""),
    value: String(robot.robotName || ""),
    id: Number(robot.id),
    robotCode: String(robot.robotCode || ""),
  })));
}

function updateRobotRecords(records: RobotRecordCacheItem[], notify: boolean): void {
  const next = records.filter((item) => item && typeof item === "object").map((item) => ({ ...item }));
  const changed = JSON.stringify(next) !== JSON.stringify(robotRecords);
  if (!changed) return;
  robotRecords = next;
  writeStorage(CACHED_ROBOT_RECORDS_KEY, JSON.stringify(next));
  if (notify) robotRecordListeners.forEach((listener) => listener());
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

/** 设置当前机器人；传空时清空本地持久化选择。 */
export function getSelectedRobot(): string | null {
  return state.selectedRobot;
}

export function setSelectedRobot(robotName: string | null): void {
  const value = robotName?.trim() || null;
  writeStorage(SELECTED_ROBOT_KEY, value);
  updateState({ selectedRobot: value });
}

/** 读取后台 IP，返回值不带 https://。 */
export function getBackendIp(): string {
  return state.backendIp;
}

/** 仅更新后台 IP，不代表连接已成功。 */
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

export function useRobotRecords(): RobotRecordCacheItem[] {
  return useSyncExternalStore(subscribeRobotRecords, getRobotRecords, getRobotRecords);
}
