import { App as AntdApp, Button, Dropdown, Modal, Spin } from "antd";
import type { MenuProps } from "antd";
import {
  AlertOutlined,
  CameraOutlined,
  CheckCircleOutlined,
  DownOutlined,
  EnvironmentOutlined,
  FileZipOutlined,
  HddOutlined,
  HomeOutlined,
  LockOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  StepForwardOutlined,
  StopOutlined,
  ThunderboltOutlined,
  UnlockOutlined,
  VideoCameraOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cabinetDeviceMainCollect,
  equipmentDeviceMainCollect,
  findFacMap,
  getFacInfo,
  getRobotIndexData,
  getRobotLog,
  getRobotRegionByMapCode,
  getRobotRoad,
  getRobotRunData,
  getRobotStatusData,
  getRobotStatusPanel,
  getRobotStopNode,
  getRobotSupState,
  getSurveyRunning,
  pauseRealtimeTask,
  queryCameraListByFacId,
  queryRunningListV2,
  resumeRealtimeTask,
  robotControlToRobotHost,
  startTask,
  stopPointCollect,
  terminateRealtimeTask,
} from "@/api/config.js";
import http, { downloadByAxios, getRequestErrorMessage } from "@/services/http";
import { refreshRobotRecords } from "@/services/robot-options";
import { useDocumentActive } from "@/components/useElementActive";
import {
  getBackendIp,
  getConnectionStatus,
  useAppContext,
  useRobotOptions,
  useRobotRecords,
} from "@/stores/appContextStore";
import CabinetPhotoModal, { type CabinetPhotoDispatchItem } from "@/views/image-edit/components/CabinetPhotoModal";
import SurveyPhotoModal, {
  type SurveyPhotoDispatchItem,
  type SurveyPhotoMode,
  type SurveyRunningState,
} from "@/views/image-edit/components/SurveyPhotoModal";
import VerifyTaskModal, {
  type VerifyTaskBayItem,
  type VerifyTaskPointItem,
} from "@/views/image-edit/components/VerifyTaskModal";
import { startDownloadTaskFlyAnimation } from "@/components/download-task";
import RealtimeMapCanvas, { DirectMapData, RobotPosition } from "./RealtimeMapCanvas";
import RealtimeVideoPlayer from "./RealtimeVideoPlayer";
import "./index.scss";

interface ApiResponse<T> {
  code?: number;
  success?: boolean;
  message?: string | null;
  data?: T;
}

interface StationRecord {
  id: number;
  stationName?: string;
  stationCode?: string;
  currentFac?: number | string | boolean;
}

interface RealtimeMapRecord {
  id?: number;
  mapName?: string;
  mapCode?: string;
  mapFilePath?: string;
  width?: number | string;
  height?: number | string;
  mapWidth?: number | string;
  mapHeight?: number | string;
  [key: string]: any;
}

interface ResolvedRobot {
  id?: number;
  robotId?: number;
  robotName?: string;
  robotCode?: string;
  visibleCamera?: any;
  infraredCamera?: any;
  [key: string]: any;
}

interface CameraRobotRecord extends ResolvedRobot {
  cameraVOS?: any[];
}

interface StatusPanelItem {
  code?: string;
  displayName?: string;
  statusText?: string;
  params?: any;
  abnormal?: boolean | string | number;
  alarmLevel?: number | string;
  [key: string]: any;
}

interface StatusPanelCategory {
  categoryName: string;
  items: StatusPanelItem[];
  totalCount?: number;
  abnormalCount?: number;
  normalCount?: number;
}

interface StatusPanelData {
  categories: StatusPanelCategory[];
  totalCount?: number;
  abnormalCount?: number;
  normalCount?: number;
}

interface TaskRecord {
  id?: number | string;
  nodeLevel?: number | string;
  derivedTaskPatrolledId?: number | string;
  type?: number | string;
  taskName?: string;
  taskProgress?: number | string;
  taskStartTime?: string;
  taskStatus?: number | string;
  taskStatusDesc?: string;
  derivedTaskPatrolledVOS?: TaskRecord[];
  [key: string]: any;
}

const CONTROL_SPEED = 0.1;
const SURVEY_POLL_INTERVAL_MS = 2000;
const SURVEY_START_WAIT_MS = 15000;
const WS_RECONNECT_BASE_DELAY = 1000;
const WS_RECONNECT_MAX_DELAY = 10000;

const modeMenuItems: MenuProps["items"] = [
  { key: "1", label: "任务模式" },
  { key: "2", label: "紧急定位模式" },
  { key: "3", label: "后台遥控模式" },
  { key: "4", label: "手持遥控模式" },
];

const controlButtons = [
  { key: "up", label: "前进", command: "1" },
  { key: "right", label: "右转", command: "4" },
  { key: "down", label: "后退", command: "2" },
  { key: "left", label: "左转", command: "3" },
] as const;

function isOk<T>(body: ApiResponse<T>): boolean {
  return body?.success === true || body?.code === 200;
}

function getBodyData<T>(body: ApiResponse<T>, fallback: T): T {
  return isOk(body) && body.data !== undefined && body.data !== null ? body.data : fallback;
}

function parseSurveyProgress(value: unknown): number {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function buildSurveyRunningState(data: any): SurveyRunningState | null {
  if (!data) return null;
  const progressPercent = parseSurveyProgress(data.progress);
  const statusText = String(data.status ?? "");
  const failed = statusText === "2" || ["fail", "failed", "error"].includes(statusText.toLowerCase());
  const finished = !failed && (statusText === "1" || progressPercent >= 100);
  if (finished) return null;
  return {
    robotId: Number(data.robotId) || undefined,
    robotCode: String(data.robotCode || ""),
    type: String(data.type || ""),
    taskCode: String(data.taskCode || ""),
    taskName: String(data.taskName || ""),
    progressPercent,
    progressText: String(data.progress || `${progressPercent}%`),
    statusText: failed ? "执行失败" : "执行中",
    running: !failed,
    finished,
    failed,
    errorMessage: "",
  };
}

function buildSurveyErrorState(error: unknown): SurveyRunningState {
  return {
    progressPercent: 0,
    progressText: "0%",
    statusText: "查询失败",
    running: false,
    finished: false,
    failed: true,
    queryFailed: true,
    errorMessage: error instanceof Error ? error.message : String(error || "查询勘察进度失败"),
  };
}

function buildSurveyFailureState(value: unknown): SurveyRunningState {
  return {
    progressPercent: 0,
    progressText: "0%",
    statusText: "任务异常",
    running: false,
    finished: false,
    failed: true,
    queryFailed: false,
    errorMessage: String(value || "勘察任务执行失败"),
  };
}

function buildSurveyStartingState(taskName: string): SurveyRunningState {
  return {
    taskName,
    progressPercent: 0,
    progressText: "0%",
    statusText: "执行中",
    running: true,
    finished: false,
    failed: false,
    errorMessage: "",
  };
}

function formatValue(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "--";
  const text = String(value);
  if (!suffix || text.endsWith(suffix.trim())) return text;
  return `${text}${suffix}`;
}

function formatBatteryLevel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "--";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return formatValue(value, "%");
  const percentage = Math.abs(numericValue) <= 1 ? numericValue * 100 : numericValue;
  return `${Number(percentage.toFixed(2))}%`;
}

function normalizeDateText(value: unknown): string {
  if (!value) return "--";
  const date = new Date(value as any);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLogDateTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getRobotLogFileUrl(data: unknown): string {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const record = data as Record<string, unknown>;
  const value = record.fileUrl || record.downloadUrl || record.url || record.filePath || record.path;
  return typeof value === "string" ? value.trim() : "";
}

function buildBackendFileUrl(fileUrl: string, backendIp: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const backendOrigin = backendIp.trim().replace(/\/+$/, "");
  if (!backendOrigin) return fileUrl;
  const origin = /^https?:\/\//i.test(backendOrigin) ? backendOrigin : `https://${backendOrigin}`;
  return `${origin}/${fileUrl.replace(/^\/+/, "")}`;
}

function getRobotLogFileName(fileUrl: string): string {
  const path = fileUrl.split(/[?#]/)[0];
  const rawName = path.split(/[\\/]/).pop() || "机器人日志小包.zip";
  try {
    return decodeURIComponent(rawName).replace(/[<>:"/\\|?*]/g, "-") || "机器人日志小包.zip";
  } catch {
    return rawName.replace(/[<>:"/\\|?*]/g, "-") || "机器人日志小包.zip";
  }
}

function getRobotId(robot: ResolvedRobot | null): number | undefined {
  const value = Number(robot?.robotId ?? robot?.id);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function getRobotLabel(robot: ResolvedRobot | null): string {
  return String(robot?.robotName || robot?.robotCode || "").trim();
}

function resolveSelectedRobot(
  selectedRobot: string | null,
  robotOptions: ReturnType<typeof useRobotOptions>,
  robotRecords: ReturnType<typeof useRobotRecords>,
): ResolvedRobot | null {
  if (!selectedRobot) return null;
  const option = robotOptions.find(
    (item) => item.value === selectedRobot || item.label === selectedRobot || item.robotCode === selectedRobot,
  );
  const matchValue = option?.value || selectedRobot;
  const record = robotRecords.find((item) => {
    const robot = item as ResolvedRobot;
    return robot.robotName === matchValue
      || robot.robotName === selectedRobot
      || robot.robotCode === selectedRobot
      || robot.robotCode === option?.robotCode
      || String(robot.id ?? robot.robotId ?? "") === selectedRobot;
  }) as ResolvedRobot | undefined;

  if (record) return { ...record, robotId: getRobotId(record) };
  if (option) {
    return {
      id: option.id,
      robotId: option.id,
      robotName: option.label,
      robotCode: option.robotCode,
    };
  }
  return { robotName: selectedRobot, robotCode: selectedRobot };
}

function hasCameraStream(camera: any): boolean {
  return Boolean(camera && (camera.id || camera.cameraId || camera.cameraIp || camera.rtspUrl));
}

function getCameraRobotId(robot: CameraRobotRecord): number | undefined {
  const value = Number(robot.robotId ?? robot.id);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function cameraRobotMatches(robot: CameraRobotRecord, selectedRobot: ResolvedRobot | null): boolean {
  if (!selectedRobot) return false;
  const selectedId = getRobotId(selectedRobot);
  const cameraRobotId = getCameraRobotId(robot);
  if (selectedId && cameraRobotId && selectedId === cameraRobotId) return true;

  const selectedCode = String(selectedRobot.robotCode || "").trim();
  const selectedName = String(selectedRobot.robotName || "").trim();
  return Boolean(
    (selectedCode && String(robot.robotCode || "").trim() === selectedCode)
    || (selectedName && String(robot.robotName || "").trim() === selectedName),
  );
}

function buildCameraSource(camera: any, visibleType: 1 | 2): any {
  if (!camera) return undefined;
  const cameraId = camera.cameraId ?? camera.id;
  const isInfrared = visibleType === 2;
  return {
    ...camera,
    id: camera.id ?? cameraId,
    cameraId,
    cameraName: camera.cameraName || camera.name,
    cameraIp: isInfrared
      ? camera.cameraIp || camera.infraredIp || camera.visibleIp
      : camera.cameraIp || camera.visibleIp || camera.infraredIp,
    cameraPort: isInfrared
      ? camera.cameraPort || camera.infraredPort || camera.visiblePort
      : camera.cameraPort || camera.visiblePort || camera.infraredPort,
    channel: isInfrared
      ? camera.channel || camera.infraredChannel || camera.visibleChannel
      : camera.channel || camera.visibleChannel || camera.infraredChannel,
    rtspPort: isInfrared
      ? camera.rtspPort || camera.infraredRtspPort || camera.visibleRtspPort
      : camera.rtspPort || camera.visibleRtspPort || camera.infraredRtspPort,
    visibleType,
  };
}

function normalizeCameraRobotRecord(record: CameraRobotRecord): CameraRobotRecord {
  if (record.visibleCamera || record.infraredCamera) return record;

  const cameras = Array.isArray(record.cameraVOS) ? record.cameraVOS : [];
  const visibleCamera = cameras.find((camera) => {
    const type = String(camera?.videoType || "");
    return type === "1" || type === "3" || camera?.visibleIp || camera?.visibleRtspAddress;
  });
  const infraredCamera = cameras.find((camera) => {
    const type = String(camera?.videoType || "");
    return type === "2" || type === "3" || camera?.infraredIp || camera?.infraredRtspAddress;
  });

  return {
    ...record,
    visibleCamera: buildCameraSource(visibleCamera, 1),
    infraredCamera: buildCameraSource(infraredCamera, 2),
  };
}

function resolveCameraRobot(
  selectedRobot: ResolvedRobot | null,
  cameraRobotRecords: CameraRobotRecord[],
): CameraRobotRecord | null {
  return cameraRobotRecords.find((robot) => cameraRobotMatches(robot, selectedRobot)) || null;
}

function normalizeTaskNode(item: TaskRecord): TaskRecord {
  const node = {
    ...item,
    taskStartTime: item.taskStartTime ? normalizeDateText(item.taskStartTime) : "",
  };
  if (Array.isArray(node.derivedTaskPatrolledVOS) && node.derivedTaskPatrolledVOS.length) {
    node.derivedTaskPatrolledVOS = node.derivedTaskPatrolledVOS.map((child) => normalizeTaskNode(child));
  }
  return node;
}

function getTaskProgressValue(task: TaskRecord | null): number {
  const value = Number(String(task?.taskProgress || "").replace("%", ""));
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function getTaskDisplayName(task: TaskRecord | null, operateRow: TaskRecord | null): string {
  const candidates = [
    task?.taskName,
    operateRow?.taskName,
    task?.rootTaskName,
    operateRow?.rootTaskName,
    task?.name,
    operateRow?.name,
  ];
  const name = candidates.map((item) => String(item || "").trim()).find(Boolean);
  return name || "--";
}

function isTaskOperateDisabled(task: TaskRecord | null): boolean {
  return !task || !task.id || String(task.type) === "1";
}

function normalizeRobotStatus(data: Record<string, any>): Record<string, any> {
  const transformMap: Record<string, Record<string, string>> = {
    batteryState: { 0: "正常", 1: "异常" },
    communicationState: { 0: "正常", 1: "异常" },
    ultrasonicStop: { 0: "正常", 1: "异常" },
    driver: { 0: "正常", 1: "异常" },
    faultAlarm: { 0: "正常", 1: "异常" },
    runningState: { 1: "空闲", 2: "巡视", 3: "充电", 4: "检修" },
    controlMode: { 1: "任务模式", 2: "紧急定位模式", 3: "后台遥控模式", 4: "手持遥控模式" },
    controlState: { 0: "空闲", 1: "获得" },
    rotationalState: { 0: "空闲", 1: "值班" },
  };
  const next = { ...data };
  Object.keys(next).forEach((key) => {
    const map = transformMap[key];
    if (!map) return;
    const normalized = map[String(next[key])];
    if (normalized !== undefined) next[key] = normalized;
  });
  return next;
}

function isRobotControlGranted(value: unknown): boolean {
  return value === "获得" || value === 1 || String(value) === "1";
}

function isStatusPanelItemAbnormal(item: StatusPanelItem): boolean {
  if (item?.abnormal === true || item?.abnormal === "true" || item?.abnormal === 1 || item?.abnormal === "1") {
    return true;
  }
  if (item?.alarmLevel !== undefined && item?.alarmLevel !== null) {
    return Number(item.alarmLevel) > 0;
  }
  return false;
}

function normalizeStatusPanelData(data: any): StatusPanelData {
  const source = data || {};
  const categories = Array.isArray(source.categories) ? source.categories : [];
  const normalizedCategories = categories.map((category: any) => {
    const items = Array.isArray(category.items) ? category.items : [];
    const normalizedItems = items.map((item: StatusPanelItem) => ({
      ...item,
      abnormal: isStatusPanelItemAbnormal(item),
    }));
    const abnormalCount = category.abnormalCount !== undefined && category.abnormalCount !== null
      ? Number(category.abnormalCount) || 0
      : normalizedItems.filter((item: StatusPanelItem) => item.abnormal).length;
    const totalCount = category.totalCount !== undefined && category.totalCount !== null
      ? Number(category.totalCount) || 0
      : normalizedItems.length;
    return {
      ...category,
      categoryName: String(category.categoryName || "未分类"),
      items: normalizedItems,
      totalCount,
      abnormalCount,
      normalCount: Math.max(totalCount - abnormalCount, 0),
    };
  });
  const totalCount = normalizedCategories.reduce((sum: number, category: StatusPanelCategory) => sum + Number(category.totalCount || 0), 0);
  const abnormalCount = normalizedCategories.reduce((sum: number, category: StatusPanelCategory) => sum + Number(category.abnormalCount || 0), 0);
  return {
    ...source,
    categories: normalizedCategories,
    totalCount,
    abnormalCount,
    normalCount: Math.max(totalCount - abnormalCount, 0),
  };
}

function getCurrentStation(stations: StationRecord[]): StationRecord | null {
  return stations.find((station) => station.currentFac === 0 || station.currentFac === "0" || station.currentFac === true) || stations[0] || null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

async function loadMapImageSource(mapFilePath?: string): Promise<string> {
  if (!mapFilePath) return "";
  try {
    const response = await http.request<Blob>({
      url: mapFilePath,
      method: "get",
      responseType: "blob",
    });
    return await blobToDataUrl(response.data);
  } catch {
    return mapFilePath;
  }
}

function getToneClass(value: unknown, successValue = "正常"): string {
  if (value === successValue || value === 0 || value === "0") return "is-good";
  if (value === "异常" || value === 1 || value === "1") return "is-danger";
  return "is-muted";
}

function formatStatusPanelValue(value: any): string {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface WeatherMetric {
  key: string;
  label: string;
  value: string;
}

const WEATHER_METRIC_DEFINITIONS = [
  { key: "temperature", label: "温度", aliases: ["temperature", "温度"] },
  { key: "humidity", label: "湿度", aliases: ["humidness", "humidity", "湿度"] },
  { key: "windSpeed", label: "风速", aliases: ["windSpeed", "风速"] },
  { key: "rainfall", label: "雨量", aliases: ["hyetal", "rainfall", "降雨量", "雨量"] },
  { key: "windDirection", label: "风向", aliases: ["windDirection", "风向"] },
  { key: "airPressure", label: "气压", aliases: ["atmosphericPressure", "airPressure", "气压"] },
] as const;

function getWeatherMetricDefinition(key: string) {
  const normalizedKey = key.trim().toLowerCase();
  return WEATHER_METRIC_DEFINITIONS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === normalizedKey));
}

function getWeatherMetricSources(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, itemValue]) => {
        const definition = getWeatherMetricDefinition(key);
        return definition ? `${definition.label}:${formatStatusPanelValue(itemValue)}` : "";
      })
      .filter(Boolean);
  }
  return [formatStatusPanelValue(value)];
}

function parseWeatherMetrics(item: StatusPanelItem): WeatherMetric[] {
  const source = [
    ...getWeatherMetricSources(item.statusText),
    ...getWeatherMetricSources(item.params),
  ].join(" ");
  if (!source || source === "--") return [];

  const labels = WEATHER_METRIC_DEFINITIONS.flatMap((definition) => definition.aliases.filter((alias) => /[\u4e00-\u9fa5]/.test(alias)));
  const labelPattern = labels.join("|");
  const metrics = new Map<string, WeatherMetric>();
  const matcher = new RegExp(`(${labelPattern})\\s*[:：]?\\s*(.*?)(?=\\s*(?:${labelPattern})\\s*[:：]?|$)`, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null) {
    const definition = getWeatherMetricDefinition(match[1]);
    const value = match[2].trim();
    if (definition && value && value !== "--" && !metrics.has(definition.key)) {
      metrics.set(definition.key, { key: definition.key, label: definition.label, value });
    }
  }
  return WEATHER_METRIC_DEFINITIONS
    .map((definition) => metrics.get(definition.key))
    .filter((metric): metric is WeatherMetric => Boolean(metric));
}

function isWeatherCategory(categoryName: string): boolean {
  return /气象/.test(categoryName);
}

function isWeatherCommunicationItem(item: StatusPanelItem): boolean {
  return /通讯|通信/.test(String(item.displayName || item.name || item.code || ""));
}

interface CoordinateValue {
  axis: "X" | "Y" | "Z";
  value: string;
}

function parseCoordinateValues(item: StatusPanelItem): CoordinateValue[] {
  const coordinatePattern = "[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?";
  const stringSources = [item.statusText, item.params]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const match = stringSources.match(new RegExp(
    `坐标\\s*\\(\\s*x\\s*[,，]\\s*y\\s*[,，]\\s*z\\s*\\)\\s*[:：]?\\s*(${coordinatePattern})\\s*[,，]\\s*(${coordinatePattern})\\s*[,，]\\s*(${coordinatePattern})`,
    "i",
  ));
  if (match) {
    return ["X", "Y", "Z"].map((axis, index) => ({ axis: axis as CoordinateValue["axis"], value: match[index + 1] }));
  }

  const sourceObjects = [item.params, item.statusText].filter(
    (value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  );
  const values = ["x", "y", "z"].map((axis) => {
    for (const source of sourceObjects) {
      const key = Object.keys(source).find((itemKey) => itemKey.toLowerCase() === axis);
      if (key && source[key] !== null && source[key] !== undefined && source[key] !== "") {
        return { axis: axis.toUpperCase() as CoordinateValue["axis"], value: formatStatusPanelValue(source[key]) };
      }
    }
    return null;
  });
  return values.filter((value): value is CoordinateValue => Boolean(value));
}

function isCoordinateItem(item: StatusPanelItem): boolean {
  const text = [item.displayName, item.name, item.code, item.statusText, formatStatusPanelValue(item.params)]
    .map((value) => String(value || ""))
    .join(" ");
  return /定位状态|坐标/.test(text);
}

interface ServiceMetric {
  key: string;
  label: string;
  value: string;
}

const SERVICE_METRIC_DEFINITIONS = [
  { key: "speed", label: "速度", aliases: ["速度"] },
  { key: "mileage", label: "里程", aliases: ["里程"] },
  { key: "cpu", label: "CPU使用率", aliases: ["当前CPU使用率", "CPU使用率"] },
  { key: "memory", label: "内存使用率", aliases: ["当前内存使用率", "内存使用率"] },
] as const;

function getServiceMetricDefinition(key: string) {
  const normalizedKey = key.trim().toLowerCase();
  return SERVICE_METRIC_DEFINITIONS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === normalizedKey));
}

function parseServiceMetrics(item: StatusPanelItem): ServiceMetric[] {
  const sources = [item.statusText, item.params]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  if (!sources || sources === "--") return [];

  const labels = SERVICE_METRIC_DEFINITIONS.flatMap((definition) => definition.aliases).sort((a, b) => b.length - a.length);
  const labelPattern = labels.join("|");
  const metrics = new Map<string, ServiceMetric>();
  const matcher = new RegExp(`(${labelPattern})\\s*[:：]?\\s*(.*?)(?=\\s*(?:${labelPattern})\\s*[:：]?|$)`, "g");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(sources)) !== null) {
    const definition = getServiceMetricDefinition(match[1]);
    const value = match[2].trim();
    if (definition && value && value !== "--" && !metrics.has(definition.key)) {
      metrics.set(definition.key, { key: definition.key, label: definition.label, value });
    }
  }
  return SERVICE_METRIC_DEFINITIONS
    .map((definition) => metrics.get(definition.key))
    .filter((metric): metric is ServiceMetric => Boolean(metric));
}

function isServiceResourceCategory(categoryName: string): boolean {
  return /服务资源/.test(categoryName);
}

function isPercentValue(value: unknown): boolean {
  return /^[-+]?\d+(?:\.\d+)?\s*%$/.test(String(value || "").trim());
}

interface PowerMetric {
  key: string;
  label: string;
  value: string;
}

const POWER_METRIC_DEFINITIONS = [
  { key: "battery", label: "当前电量", aliases: ["当前电量", "电量"] },
  { key: "voltage", label: "当前电压", aliases: ["当前电压", "电压"] },
  { key: "chargingCurrent", label: "充电电流", aliases: ["充电电流"] },
  { key: "bodyTemperature", label: "机身温度", aliases: ["机身温度"] },
] as const;

function getPowerMetricDefinition(key: string) {
  const normalizedKey = key.trim().toLowerCase();
  return POWER_METRIC_DEFINITIONS.find((item) => item.aliases.some((alias) => alias.toLowerCase() === normalizedKey));
}

function parsePowerMetrics(item: StatusPanelItem): PowerMetric[] {
  const stringSources = [item.params, item.statusText]
    .filter((value): value is string => typeof value === "string");
  const objectSources = [item.params, item.statusText].filter(
    (value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  );
  const labels = POWER_METRIC_DEFINITIONS.flatMap((definition) => definition.aliases).sort((a, b) => b.length - a.length);
  const labelPattern = labels.join("|");
  const metrics = new Map<string, PowerMetric>();
  const matcher = new RegExp(`(${labelPattern})\\s*[:：]?\\s*(.*?)(?=\\s*(?:${labelPattern})\\s*[:：]?|$)`, "g");

  const collect = (source: string) => {
    if (!source || source === "--") return;
    matcher.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(source)) !== null) {
      const definition = getPowerMetricDefinition(match[1]);
      const value = match[2].trim();
      const statusOnly = /^(?:正常|异常|成功|失败|连接正常|连接异常|开门|关门|打开|关闭)$/.test(value);
      if (definition && value && value !== "--" && !statusOnly && !metrics.has(definition.key)) {
        metrics.set(definition.key, { key: definition.key, label: definition.label, value });
      }
    }
  };

  stringSources.forEach(collect);
  objectSources.forEach((source) => {
    Object.entries(source).forEach(([key, value]) => {
      const definition = getPowerMetricDefinition(key);
      if (definition && value !== null && value !== undefined && value !== "" && !metrics.has(definition.key)) {
        metrics.set(definition.key, {
          key: definition.key,
          label: definition.label,
          value: formatStatusPanelValue(value),
        });
      }
    });
  });

  return POWER_METRIC_DEFINITIONS
    .map((definition) => metrics.get(definition.key))
    .filter((metric): metric is PowerMetric => Boolean(metric));
}

function isPowerCategory(categoryName: string): boolean {
  return /电源充电/.test(categoryName);
}

function createWsClientId(length = 32): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const values = new Uint32Array(length);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < length; index += 1) values[index] = Math.floor(Math.random() * alphabet.length);
  }
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function readStorageContent(name: string): unknown {
  const keys = [name, `chiebot-${name}`];
  const stores = [window.sessionStorage, window.localStorage];
  for (const storage of stores) {
    for (const key of keys) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && "content" in parsed) return parsed.content;
          return parsed;
        } catch {
          return raw;
        }
      } catch {
        // Ignore unavailable storage.
      }
    }
  }
  return undefined;
}

function readStorageText(name: string): string {
  const value = readStorageContent(name);
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeBackendWsOrigin(backendIp: string): string {
  const value = backendIp.trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^wss?:\/\//i.test(value)) return value;
  if (/^https:\/\//i.test(value)) return value.replace(/^https:/i, "wss:");
  if (/^http:\/\//i.test(value)) return value.replace(/^http:/i, "ws:");
  return `wss://${value}`;
}

function buildRealtimeWsUrl(backendIp: string, wsMonitor: string, wsParams: string): string {
  const origin = normalizeBackendWsOrigin(backendIp || getBackendIp());
  if (!origin || !wsMonitor || !wsParams) return "";

  const userInfo = readStorageContent("userInfo") as Record<string, any> | undefined;
  const chiebotInfo = readStorageContent("chiebotInfo") as Record<string, any> | undefined;
  const token = readStorageText("access_token") || readStorageText("token");
  const username = readStorageText("username") || readStorageText("chiebotUm") || String(userInfo?.chiebotUm || chiebotInfo?.chiebotUm || "").trim();
  const roleCode = readStorageText("roleCode") || String(userInfo?.roleCode || chiebotInfo?.roleCode || "").trim();
  const params: string[] = [];
  const appendParam = (key: string, value: string, preserveComma = false) => {
    const encoded = encodeURIComponent(value).replace(/%2C/g, preserveComma ? "," : "%2C");
    params.push(`${key}=${encoded}`);
  };
  if (token) appendParam("access_token", token);
  if (username) appendParam("username", username);
  if (roleCode) appendParam("roleCode", roleCode);
  appendParam("wsClientId", createWsClientId());
  appendParam("wsMonitor", wsMonitor);
  appendParam("wsParams", wsParams, true);
  return `${origin}/robot/ws/info?${params.join("&")}`;
}

function refreshWsClientId(url: string): string {
  const clientId = createWsClientId();
  return url.replace(/([?&]wsClientId=)[^&]*/, `$1${clientId}`);
}

function parseSocketPayload(data: unknown): { type?: string; message?: any } | null {
  try {
    const payload = typeof data === "string" ? JSON.parse(data) : data;
    return payload && typeof payload === "object" ? payload as { type?: string; message?: any } : null;
  } catch {
    return null;
  }
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function getModeLabel(value: unknown): string {
  const label = modeMenuItems?.find((item: any) => item.key === String(value)) as any;
  return label?.label || "任务模式";
}

function mergeTaskPatch(task: TaskRecord | null, patch: any): TaskRecord | null {
  if (!patch || typeof patch !== "object") return task;
  return normalizeTaskNode({ ...(task || {}), ...patch });
}

function closeRealtimeSocket(socket: WebSocket | null): void {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}

function useReconnectingWebSocket(url: string, onMessage: (event: MessageEvent) => void): void {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url || typeof WebSocket === "undefined") return;

    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer === null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      const delay = Math.min(
        WS_RECONNECT_BASE_DELAY * (2 ** reconnectAttempts),
        WS_RECONNECT_MAX_DELAY,
      );
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      try {
        const nextSocket = new WebSocket(refreshWsClientId(url));
        socket = nextSocket;
        nextSocket.onmessage = (event) => {
          reconnectAttempts = 0;
          onMessageRef.current(event);
        };
        nextSocket.onerror = () => {
          if (nextSocket.readyState === WebSocket.CONNECTING || nextSocket.readyState === WebSocket.OPEN) {
            nextSocket.close();
          }
          scheduleReconnect();
        };
        nextSocket.onclose = () => {
          if (socket === nextSocket) socket = null;
          scheduleReconnect();
        };
      } catch {
        socket = null;
        scheduleReconnect();
      }
    };

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 0);
    return () => {
      disposed = true;
      clearReconnectTimer();
      const currentSocket = socket;
      socket = null;
      closeRealtimeSocket(currentSocket);
    };
  }, [url]);
}

export default function RealtimeMonitor() {
  const { selectedProject, selectedRobot, connectionStatus, backendIp } = useAppContext();
  const robotOptions = useRobotOptions();
  const robotRecords = useRobotRecords();
  const { message } = AntdApp.useApp();
  const pageActive = useDocumentActive();
  const currentRobot = useMemo(
    () => resolveSelectedRobot(selectedRobot, robotOptions, robotRecords),
    [robotOptions, robotRecords, selectedRobot],
  );
  const currentRobotId = getRobotId(currentRobot);
  const currentRobotCode = currentRobot?.robotCode || "";
  const currentRobotLabel = getRobotLabel(currentRobot);

  const [station, setStation] = useState<StationRecord | null>(null);
  const [cameraRobotRecords, setCameraRobotRecords] = useState<CameraRobotRecord[]>([]);
  const [mapList, setMapList] = useState<RealtimeMapRecord[]>([]);
  const [activeMapCode, setActiveMapCode] = useState("");
  const [directMapData, setDirectMapData] = useState<DirectMapData | null>(null);
  const [robotPosition, setRobotPosition] = useState<RobotPosition>({});
  const [runData, setRunData] = useState<Record<string, any>>({});
  const [robotStatusData, setRobotStatusData] = useState<Record<string, any>>({});
  const [statusPanelData, setStatusPanelData] = useState<StatusPanelData>({ categories: [] });
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const [statusPanelLoading, setStatusPanelLoading] = useState(false);
  const [statusPanelActiveTab, setStatusPanelActiveTab] = useState<"all" | "abnormal">("all");
  const [statusPanelActiveCategory, setStatusPanelActiveCategory] = useState("");
  const [taskDetailInfo, setTaskDetailInfo] = useState<TaskRecord | null>(null);
  const [nowOperateRow, setNowOperateRow] = useState<TaskRecord | null>(null);
  const [taskOperateLoading, setTaskOperateLoading] = useState(false);
  const [stageLoading, setStageLoading] = useState(false);
  const [stageLoadingText, setStageLoadingText] = useState("正在加载监控数据...");
  const [errorText, setErrorText] = useState("");
  const [videoPanel, setVideoPanel] = useState<"visible" | "infrared" | null>(null);
  const [videoExpanded, setVideoExpanded] = useState(false);
  const [controlActiveKey, setControlActiveKey] = useState<string | null>(null);
  const [hasRobotControl, setHasRobotControl] = useState(false);
  const [controlOwnershipLoading, setControlOwnershipLoading] = useState(false);
  const [surveyPhotoOpen, setSurveyPhotoOpen] = useState(false);
  const [surveyPhotoMode, setSurveyPhotoMode] = useState<SurveyPhotoMode>("normal");
  const [cabinetPhotoOpen, setCabinetPhotoOpen] = useState(false);
  const [verifyTaskOpen, setVerifyTaskOpen] = useState(false);
  const [robotLogLoading, setRobotLogLoading] = useState(false);
  const [surveyRunning, setSurveyRunning] = useState<SurveyRunningState | null>(null);
  const [taskModeName, setTaskModeName] = useState("任务模式");
  const loadMapKeyRef = useRef("");
  const realtimeLoadSeqRef = useRef(0);
  const realtimeMessageVersionRef = useRef<Record<string, number>>({});
  const statusPanelActiveCategoryRef = useRef("");
  const statusPanelRequestRef = useRef<{ robotCode: string; promise: Promise<void> } | null>(null);
  const statusPanelRequestSeqRef = useRef(0);
  const surveyProgressRequestRef = useRef<number | null>(null);
  const surveyPendingStartUntilRef = useRef(0);
  const controlOwnershipTouchedRef = useRef(false);

  const currentMap = useMemo(
    () => mapList.find((map) => map.mapCode === activeMapCode) || mapList[0] || null,
    [activeMapCode, mapList],
  );
  const cameraRobot = useMemo(
    () => resolveCameraRobot(currentRobot, cameraRobotRecords),
    [cameraRobotRecords, currentRobot],
  );

  const statusPanelSummary = useMemo(() => {
    const categories = statusPanelData.categories || [];
    const totalCount = categories.reduce((sum, category) => sum + Number(category.totalCount || category.items?.length || 0), 0);
    const abnormalCount = categories.reduce((sum, category) => sum + Number(category.abnormalCount || 0), 0);
    return {
      totalCount,
      abnormalCount,
      normalCount: Math.max(totalCount - abnormalCount, 0),
    };
  }, [statusPanelData]);

  const currentStatusPanelCategory = useMemo(() => {
    const categories = statusPanelData.categories || [];
    return categories.find((category) => category.categoryName === statusPanelActiveCategory) || categories[0] || null;
  }, [statusPanelActiveCategory, statusPanelData]);

  const currentStatusPanelItems = useMemo(() => {
    const items = currentStatusPanelCategory?.items || [];
    return statusPanelActiveTab === "abnormal" ? items.filter((item) => item.abnormal) : items;
  }, [currentStatusPanelCategory, statusPanelActiveTab]);

  const taskProgress = getTaskProgressValue(taskDetailInfo);
  const taskDisplayName = getTaskDisplayName(taskDetailInfo, nowOperateRow);
  const taskBriefItems = [
    {
      key: "status",
      label: "状态",
      value: formatValue(nowOperateRow?.taskStatusDesc || taskDetailInfo?.taskStatusDesc),
    },
    { key: "progress", label: "进度", value: `${taskProgress}%` },
    { key: "time", label: "时间", value: formatValue(taskDetailInfo?.taskStartTime) },
  ];
  const taskOperateDisabled = isTaskOperateDisabled(nowOperateRow);
  const hasBackendReady = Boolean(backendIp) && connectionStatus === "connected" && getConnectionStatus() === "connected";
  const carControlDisabled = !currentRobotId || !hasBackendReady || !hasRobotControl;
  const visibleCamera = cameraRobot ? cameraRobot.visibleCamera : currentRobot?.visibleCamera;
  const infraredCamera = cameraRobot ? cameraRobot.infraredCamera : currentRobot?.infraredCamera;

  const syncStatusPanelSelection = useCallback((data: StatusPanelData, preferTab?: "all" | "abnormal") => {
    const categories = data.categories || [];
    if (!categories.length) {
      setStatusPanelActiveCategory("");
      setStatusPanelActiveTab("all");
      return;
    }

    const hasAbnormal = categories.some((category) => Number(category.abnormalCount || 0) > 0);
    const nextTab = preferTab === "abnormal" && hasAbnormal ? "abnormal" : "all";
    setStatusPanelActiveTab(nextTab);
    const preferredCategory = nextTab === "abnormal"
      ? categories.find((category) => Number(category.abnormalCount || 0) > 0) || categories[0]
      : categories[0];
    setStatusPanelActiveCategory(preferredCategory.categoryName);
  }, []);

  const applyStatusPanelData = useCallback((data: any, preferTab?: "all" | "abnormal") => {
    const normalized = normalizeStatusPanelData(data || {});
    setStatusPanelData(normalized);
    const activeCategory = statusPanelActiveCategoryRef.current;
    const activeCategoryExists = Boolean(activeCategory)
      && normalized.categories.some((category) => category.categoryName === activeCategory);
    if (preferTab || !activeCategoryExists) {
      syncStatusPanelSelection(normalized, preferTab || (normalized.abnormalCount ? "abnormal" : "all"));
    }
  }, [syncStatusPanelSelection]);

  const loadStatusPanelData = useCallback(async (preferTab?: "all" | "abnormal") => {
    if (!currentRobotCode) return;
    const robotCode = currentRobotCode;
    if (statusPanelRequestRef.current?.robotCode === robotCode) {
      return statusPanelRequestRef.current.promise;
    }
    const requestSeq = statusPanelRequestSeqRef.current + 1;
    statusPanelRequestSeqRef.current = requestSeq;

    const request = (async () => {
      setStatusPanelLoading(true);
      try {
        const res = await getRobotStatusPanel({ robotCode });
        if (requestSeq !== statusPanelRequestSeqRef.current) return;
        applyStatusPanelData(getBodyData((res.data || {}) as ApiResponse<any>, {}), preferTab);
      } catch {
        if (requestSeq !== statusPanelRequestSeqRef.current) return;
        applyStatusPanelData({}, preferTab);
      } finally {
        if (requestSeq === statusPanelRequestSeqRef.current) setStatusPanelLoading(false);
      }
    })();
    statusPanelRequestRef.current = { robotCode, promise: request };
    try {
      await request;
    } finally {
      if (statusPanelRequestRef.current?.promise === request) statusPanelRequestRef.current = null;
    }
  }, [applyStatusPanelData, currentRobotCode]);

  const emitRobotMove = useCallback((data: any, state: string) => {
    if (!data?.coordinatePixel) return;
    const [x, y, , rotation] = String(data.coordinatePixel).split(",");
    setRobotPosition({
      x,
      y,
      rotation: rotation || "0",
      name: data.robotName || currentRobotLabel,
      onlineState: data.onlineState,
      state,
    });
  }, [currentRobotLabel]);

  const loadDirectMapData = useCallback(async (map: RealtimeMapRecord | null, robot: ResolvedRobot | null) => {
    const mapCode = map?.mapCode;
    const robotId = getRobotId(robot);
    if (!mapCode || !robotId) {
      setDirectMapData(null);
      return;
    }

    const loadKey = `${robotId}_${mapCode}_${Date.now()}`;
    loadMapKeyRef.current = loadKey;
    setDirectMapData(null);
    const [imageSource, regionResult, roadResult, stopNodeResult] = await Promise.all([
      loadMapImageSource(map.mapFilePath),
      getRobotRegionByMapCode({ mapCode }).catch(() => null),
      getRobotRoad({ mapId: mapCode }).catch(() => null),
      getRobotStopNode({ mapId: mapCode }).catch(() => null),
    ]);
    if (loadMapKeyRef.current !== loadKey) return;
    setDirectMapData({
      ...map,
      imageSource,
      regions: getBodyData((regionResult?.data || {}) as ApiResponse<any[]>, []),
      roads: getBodyData((roadResult?.data || {}) as ApiResponse<any[]>, []),
      stopNodes: getBodyData((stopNodeResult?.data || {}) as ApiResponse<any[]>, []),
    });
  }, []);

  const loadRunningTask = useCallback(async (facId: number) => {
    try {
      const res = await queryRunningListV2({ facId });
      const body = (res.data || {}) as ApiResponse<TaskRecord | null>;
      if (!isOk(body) || !body.data) {
        setNowOperateRow(null);
        setTaskDetailInfo(null);
        return;
      }

      const row = normalizeTaskNode(body.data);
      setNowOperateRow(row);
      setTaskDetailInfo({ ...row });
    } catch {
      setNowOperateRow(null);
      setTaskDetailInfo(null);
    }
  }, []);

  const loadRealtimeSnapshot = useCallback(async (robot: ResolvedRobot | null, map: RealtimeMapRecord | null, facId?: number) => {
    if (!robot?.robotCode) return;
    const seq = realtimeLoadSeqRef.current + 1;
    realtimeLoadSeqRef.current = seq;
    const messageVersions = { ...realtimeMessageVersionRef.current };
    const statusPanelPromise = loadStatusPanelData();
    const [runResult, statusResult, indexResult, supResult] = await Promise.allSettled([
      getRobotRunData({ deviceCode: robot.robotCode }),
      getRobotStatusData({ deviceCode: robot.robotCode }),
      getRobotIndexData({ deviceCode: robot.robotCode, mapId: map?.mapCode }),
      getRobotSupState({ robotCode: robot.robotCode }),
    ]);
    await statusPanelPromise;
    if (seq !== realtimeLoadSeqRef.current) return;

    if (runResult.status === "fulfilled"
      && realtimeMessageVersionRef.current.robot_protocol_run_data === messageVersions.robot_protocol_run_data) {
      setRunData(getBodyData((runResult.value.data || {}) as ApiResponse<Record<string, any>>, {}));
    }
    if (statusResult.status === "fulfilled"
      && realtimeMessageVersionRef.current.robot_protocol_state_data === messageVersions.robot_protocol_state_data) {
      const statusData = normalizeRobotStatus(
        getBodyData((statusResult.value.data || {}) as ApiResponse<Record<string, any>>, {}),
      );
      setRobotStatusData(statusData);
      if (!controlOwnershipTouchedRef.current && statusData.controlState !== undefined) {
        setHasRobotControl(isRobotControlGranted(statusData.controlState));
      }
    }
    if (indexResult.status === "fulfilled"
      && realtimeMessageVersionRef.current.robot_index_data === messageVersions.robot_index_data) {
      const data = getBodyData((indexResult.value.data || {}) as ApiResponse<any>, null);
      if (data) emitRobotMove(data, "create");
    }
    if (supResult.status === "fulfilled") {
      const realtimeState = getBodyData((supResult.value.data || {}) as ApiResponse<any[]>, []);
      const modeItem = Array.isArray(realtimeState)
        ? realtimeState.find((item) => String(item.command) === "5" && String(item.type) === "1")
        : null;
      if (modeItem?.value) {
        setTaskModeName(getModeLabel(modeItem.value));
      }
    }
    if (facId) {
      await loadRunningTask(facId);
    }
  }, [emitRobotMove, loadRunningTask, loadStatusPanelData]);

  useEffect(() => {
    statusPanelActiveCategoryRef.current = statusPanelActiveCategory;
  }, [statusPanelActiveCategory]);

  const patchCurrentTask = useCallback((patch: any) => {
    if (!patch || typeof patch !== "object") return;
    const patchId = patch.id;
    const mergeIfCurrentTask = (previous: TaskRecord | null) => {
      if (!previous) return previous;
      if (patchId !== undefined && patchId !== null && previous.id !== undefined
        && String(patchId) !== String(previous.id)) {
        return previous;
      }
      return mergeTaskPatch(previous, patch);
    };
    setNowOperateRow(mergeIfCurrentTask);
    setTaskDetailInfo(mergeIfCurrentTask);
  }, []);

  const markRobotMessageReceived = useCallback((type: string) => {
    realtimeMessageVersionRef.current[type] = (realtimeMessageVersionRef.current[type] || 0) + 1;
  }, []);

  const handleRobotSocketMessage = useCallback((event: MessageEvent) => {
    const receiveData = parseSocketPayload(event.data);
    if (!receiveData) return;
    const { type, message: socketMessage } = receiveData;

    if (type === "robot_monitor_alarm_flag" && isTruthyFlag(socketMessage)) {
      if (station?.id) loadRunningTask(station.id).catch(() => {});
      void loadStatusPanelData("abnormal");
      return;
    }

    if (type === "robot_online_statue") {
      const patch = socketMessage && typeof socketMessage === "object" ? socketMessage : { onlineState: socketMessage };
      setRobotStatusData((prev) => normalizeRobotStatus({ ...prev, ...patch }));
    }

    if (socketMessage?.robotCode && socketMessage.robotCode !== currentRobotCode) return;
    switch (type) {
      case "robot_index_data":
        markRobotMessageReceived(type);
        emitRobotMove(socketMessage, "move");
        break;
      case "robot_protocol_run_data":
        if (socketMessage && typeof socketMessage === "object") {
          markRobotMessageReceived(type);
          setRunData((prev) => ({ ...prev, ...socketMessage }));
        }
        break;
      case "robot_protocol_state_data":
        if (socketMessage && typeof socketMessage === "object") {
          markRobotMessageReceived(type);
          const normalizedStatus = normalizeRobotStatus(socketMessage);
          setRobotStatusData((prev) => normalizeRobotStatus({ ...prev, ...socketMessage }));
          if (!controlOwnershipTouchedRef.current && socketMessage.controlState !== undefined) {
            setHasRobotControl(isRobotControlGranted(normalizedStatus.controlState));
          }
          if (socketMessage.controlMode !== undefined && socketMessage.controlMode !== null) {
            setTaskModeName(getModeLabel(socketMessage.controlMode));
          }
        }
        break;
      case "robot_visible_online_state":
        setRobotStatusData((prev) => ({
          ...prev,
          visibleOnline: socketMessage?.visibleOnline ?? socketMessage,
        }));
        break;
      case "robot_infrared_online_state":
        setRobotStatusData((prev) => ({
          ...prev,
          infraredOnline: socketMessage?.infraredOnline ?? socketMessage,
        }));
        break;
      case "status_data":
        applyStatusPanelData(socketMessage);
        break;
      case "status_alarm":
        void loadStatusPanelData("abnormal");
        break;
      default:
        break;
    }
  }, [applyStatusPanelData, currentRobotCode, emitRobotMove, loadRunningTask, loadStatusPanelData, markRobotMessageReceived, station?.id]);

  const handleTaskSocketMessage = useCallback((event: MessageEvent) => {
    const receiveData = parseSocketPayload(event.data);
    if (!receiveData) return;
    const { type, message: socketMessage } = receiveData;
    switch (type) {
      case "taskMonitorStatistic":
        patchCurrentTask(socketMessage);
        break;
      case "patrolResultMonitor":
        patchCurrentTask(socketMessage?.taskProgress || socketMessage);
        break;
      case "derived_task_status":
        patchCurrentTask(socketMessage);
        break;
      default:
        break;
    }
  }, [patchCurrentTask]);

  const bootstrap = useCallback(async () => {
    realtimeLoadSeqRef.current += 1;
    statusPanelRequestSeqRef.current += 1;
    statusPanelRequestRef.current = null;
    setErrorText("");
    setMapList([]);
    setCameraRobotRecords([]);
    setActiveMapCode("");
    setDirectMapData(null);
    setRobotPosition({});
    setRunData({});
    setRobotStatusData({});
    setHasRobotControl(false);
    controlOwnershipTouchedRef.current = false;
    setControlActiveKey(null);
    setControlOwnershipLoading(false);
    realtimeMessageVersionRef.current = {};
    setStatusPanelData({ categories: [] });
    setStatusPanelLoading(false);
    setTaskDetailInfo(null);
    setNowOperateRow(null);

    if (!hasBackendReady) {
      setErrorText("请先在右上角设置中连接后台");
      return;
    }
    if (!currentRobot || !currentRobotId || !currentRobot.robotCode) {
      setErrorText("请先在顶部选择机器人");
      return;
    }

    const startTime = Date.now();
    setStageLoading(true);
    setStageLoadingText("正在加载监控数据...");
    try {
      const facRes = await getFacInfo();
      const facBody = (facRes.data || {}) as ApiResponse<StationRecord[]>;
      const currentStation = getCurrentStation(getBodyData(facBody, []));
      setStation(currentStation);
      if (!currentStation?.id) {
        setErrorText("未找到可用厂站");
        return;
      }

      try {
        const cameraRes = await queryCameraListByFacId({ facId: currentStation.id });
        const cameraBody = (cameraRes.data || {}) as ApiResponse<CameraRobotRecord[]>;
        const cameraRecords = getBodyData(cameraBody, []);
        setCameraRobotRecords(
          Array.isArray(cameraRecords)
            ? cameraRecords.map((record) => normalizeCameraRobotRecord(record))
            : [],
        );
      } catch {
        setCameraRobotRecords([]);
      }

      const mapRes = await findFacMap({ robotId: currentRobotId, facId: currentStation.id });
      const maps = getBodyData((mapRes.data || {}) as ApiResponse<RealtimeMapRecord[]>, []);
      setMapList(Array.isArray(maps) ? maps : []);
      const firstMap = Array.isArray(maps) && maps.length ? maps[0] : null;
      setActiveMapCode(firstMap?.mapCode || "");
      await Promise.all([
        loadDirectMapData(firstMap, currentRobot),
        loadRealtimeSnapshot(currentRobot, firstMap, currentStation.id),
      ]);
    } catch (error) {
      setErrorText(getRequestErrorMessage(error, "实时监控数据加载失败"));
    } finally {
      const remaining = 300 - (Date.now() - startTime);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      setStageLoading(false);
    }
  }, [currentRobot, currentRobotId, hasBackendReady, loadDirectMapData, loadRealtimeSnapshot]);

  useEffect(() => {
    if (connectionStatus === "connected" && robotRecords.length === 0) {
      refreshRobotRecords().catch(() => {});
    }
  }, [connectionStatus, robotRecords.length]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!videoPanel) setVideoExpanded(false);
  }, [videoPanel]);

  useEffect(() => {
    if (!videoExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVideoExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoExpanded]);

  const robotDeviceWsUrl = useMemo(() => {
    if (!hasBackendReady || !backendIp || !currentRobotCode) return "";
    return buildRealtimeWsUrl(backendIp, "robotDeviceWebsocket", currentRobotCode);
  }, [backendIp, currentRobotCode, hasBackendReady]);
  const taskWsUrl = useMemo(() => {
    const taskSocketParam = nowOperateRow?.derivedTaskPatrolledId
      || taskDetailInfo?.derivedTaskPatrolledId;
    if (!hasBackendReady || !backendIp || !taskSocketParam) return "";
    return buildRealtimeWsUrl(backendIp, "patrolMonitorWebsocket", String(taskSocketParam));
  }, [backendIp, hasBackendReady, nowOperateRow?.derivedTaskPatrolledId, taskDetailInfo?.derivedTaskPatrolledId]);

  useReconnectingWebSocket(robotDeviceWsUrl, handleRobotSocketMessage);
  useReconnectingWebSocket(taskWsUrl, handleTaskSocketMessage);

  const sendRobotControl = useCallback(async (params: { command: string | number; type: string | number; item?: string | number }) => {
    if (!currentRobotId) {
      message.warning("未选中机器人");
      return false;
    }
    try {
      const res = await robotControlToRobotHost({
        robotId: currentRobotId,
        item: params.item ?? "",
        command: String(params.command),
        type: String(params.type),
      });
      const body = (res.data || {}) as ApiResponse<any>;
      if (!isOk(body)) {
        message.error(body.message || "下发失败");
        return false;
      }
      return true;
    } catch (error) {
      message.error(getRequestErrorMessage(error, "下发失败"));
      return false;
    }
  }, [currentRobotId, message]);

  const handleModeCommand: MenuProps["onClick"] = useCallback(async ({ key }) => {
    const ok = await sendRobotControl({ command: "5", type: "1", item: String(key) });
    if (ok) {
      setTaskModeName(getModeLabel(key));
      message.success("下发成功");
    }
  }, [message, sendRobotControl]);

  const handleSendBack = useCallback(async () => {
    const ok = await sendRobotControl({ command: "3", type: "1" });
    if (ok) message.success("下发成功");
  }, [message, sendRobotControl]);

  const handleToggleRobotControl = useCallback(async () => {
    if (controlOwnershipLoading) return;
    const releasing = hasRobotControl;
    try {
      setControlOwnershipLoading(true);
      const ok = await sendRobotControl({ command: releasing ? "7" : "6", type: "1" });
      if (!ok) return;

      setRobotStatusData((previous) => ({
        ...previous,
        controlState: releasing ? "空闲" : "获得",
      }));
      controlOwnershipTouchedRef.current = true;
      setHasRobotControl(!releasing);
      if (releasing) setControlActiveKey(null);
      message.success(releasing ? "控制权已释放" : "控制权已获取");
    } finally {
      setControlOwnershipLoading(false);
    }
  }, [controlOwnershipLoading, hasRobotControl, message, sendRobotControl]);

  const handleOpenSurveyPhoto = useCallback((mode: SurveyPhotoMode = "normal") => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    setSurveyPhotoMode(mode);
    setSurveyPhotoOpen(true);
  }, [message, selectedProject]);

  const handleOpenCabinetPhoto = useCallback(() => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    setCabinetPhotoOpen(true);
  }, [message, selectedProject]);

  const handleOpenVerifyTask = useCallback(() => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    setVerifyTaskOpen(true);
  }, [message, selectedProject]);

  const handleRobotLog = useCallback(async (triggerElement?: HTMLElement) => {
    if (robotLogLoading) return;
    if (currentRobotId == null) {
      message.warning("请先在顶部选择机器人");
      return;
    }

    const now = new Date();
    const startDate = formatLogDateTime(new Date(now.getTime() - 60 * 1000));
    const endDate = formatLogDateTime(new Date(now.getTime() + 60 * 1000));
    setRobotLogLoading(true);
    try {
      const downloadTasks = window.electronAPI?.downloadTasks;
      if (downloadTasks) {
        const tasks = await downloadTasks.list().catch(() => [] as ExportTaskInfo[]);
        if (tasks.some((task) => task.status === "pending" || task.status === "running")) {
          message.warning("已有下载任务进行中，请稍后再试");
          return;
        }

        const selectDir = window.electronAPI?.selectDir;
        if (!selectDir) {
          message.error("当前版本不支持选择下载目录");
          return;
        }
        const destDir = await selectDir("选择录制小包保存目录");
        if (!destDir) return;

        const result = await downloadTasks.create({
          type: "remote-export",
          name: "机器人日志小包",
          backendIp: getBackendIp(),
          exportPath: "/robot/tool/file/getRobotLog",
          query: { robotId: currentRobotId, startDate, endDate },
          destDir,
        });
        if (!result.success) {
          message.error(result.error || "创建下载任务失败");
          return;
        }
        if (triggerElement) startDownloadTaskFlyAnimation(triggerElement);
        return;
      }

      const res = await getRobotLog({ robotId: currentRobotId, startDate, endDate });
      const body = (res.data || {}) as ApiResponse<unknown>;
      if (!isOk(body)) {
        message.error(body.message || "录制小包失败");
        return;
      }
      const fileUrl = getRobotLogFileUrl(body.data);
      if (!fileUrl) {
        message.error("录制小包已完成，但未获取到文件地址");
        return;
      }

      await downloadByAxios(buildBackendFileUrl(fileUrl, backendIp), getRobotLogFileName(fileUrl));
    } catch (error) {
      message.error(`录制小包失败: ${getRequestErrorMessage(error, "请求失败")}`);
    } finally {
      setRobotLogLoading(false);
    }
  }, [backendIp, currentRobotId, message, robotLogLoading]);

  const refreshSurveyRunning = useCallback(async (options?: { silent?: boolean }) => {
    if (!pageActive) return;
    const robotId = currentRobotId;
    if (surveyProgressRequestRef.current !== null) return;
    if (robotId == null) {
      setSurveyRunning(null);
      return;
    }

    surveyProgressRequestRef.current = robotId;
    try {
      const res = await getSurveyRunning(robotId);
      if (surveyProgressRequestRef.current !== robotId || currentRobotId !== robotId) return;
      const body = res.data || {};
      if (!isOk(body)) {
        if (!options?.silent) message.error(body.message || "查询勘察进度失败");
        surveyPendingStartUntilRef.current = 0;
        setSurveyRunning(buildSurveyFailureState(body.message || "查询勘察进度失败"));
        return;
      }

      const nextState = buildSurveyRunningState(body.data);
      if (!nextState && Date.now() < surveyPendingStartUntilRef.current) {
        setSurveyRunning((previous) => previous?.running || !previous
          ? previous || buildSurveyStartingState("勘察任务")
          : previous);
        return;
      }
      if (nextState) surveyPendingStartUntilRef.current = 0;
      setSurveyRunning(nextState);
    } catch (error) {
      if (currentRobotId !== robotId) return;
      if (!options?.silent) message.error("查询勘察进度失败: " + getRequestErrorMessage(error, "请求失败"));
      setSurveyRunning(buildSurveyErrorState(error));
    } finally {
      if (surveyProgressRequestRef.current === robotId) surveyProgressRequestRef.current = null;
    }
  }, [currentRobotId, message, pageActive]);

  useEffect(() => {
    surveyPendingStartUntilRef.current = 0;
    surveyProgressRequestRef.current = null;
    setSurveyRunning(null);
  }, [currentRobotId]);

  useEffect(() => {
    if (!pageActive) return;
    void refreshSurveyRunning({ silent: true });
  }, [pageActive, refreshSurveyRunning]);

  useEffect(() => {
    if (!pageActive || !surveyRunning?.running) return;
    const timer = window.setInterval(() => {
      void refreshSurveyRunning({ silent: true });
    }, SURVEY_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pageActive, refreshSurveyRunning, surveyRunning?.running]);

  const handleSurveyPhotoDispatch = useCallback(async (areas: SurveyPhotoDispatchItem[]) => {
    const label = surveyPhotoMode === "supplement" ? "补充勘察拍照" : "勘察拍照";
    const unit = surveyPhotoMode === "supplement" ? "条停靠点记录" : "个设备区";
    try {
      if (surveyRunning?.running) {
        message.warning("勘察任务执行中，请等待结束后再下发");
        return false;
      }
      if (currentRobotId == null) {
        message.warning("请先在顶部选择机器人");
        return false;
      }

      const ids = surveyPhotoMode === "supplement"
        ? Array.from(new Set(areas.map((item) => String(item.stopPointId || "")).filter(Boolean)))
        : Array.from(new Set(areas.map((item) => String(item.regionId || item.bayId)).filter(Boolean)));
      if (ids.length === 0) {
        message.warning(`请选择有效的${surveyPhotoMode === "supplement" ? "停靠点" : "设备区"}`);
        return false;
      }

      const res = surveyPhotoMode === "supplement"
        ? await stopPointCollect(currentRobotId, ids)
        : await equipmentDeviceMainCollect(currentRobotId, ids);
      const body = res.data || {};
      if (!isOk(body)) {
        message.error(body.message || `${label}下发失败`);
        return false;
      }

      message.success(`已下发 ${areas.length} ${unit}`);
      surveyPendingStartUntilRef.current = Date.now() + SURVEY_START_WAIT_MS;
      setSurveyRunning(buildSurveyStartingState(label));
      void refreshSurveyRunning({ silent: true });
      return true;
    } catch (error) {
      message.error(`${label}下发失败: ${getRequestErrorMessage(error, "请求失败")}`);
      return false;
    }
  }, [currentRobotId, message, refreshSurveyRunning, surveyPhotoMode, surveyRunning?.running]);

  const handleCabinetPhotoDispatch = useCallback(async (items: CabinetPhotoDispatchItem[]) => {
    try {
      if (surveyRunning?.running) {
        message.warning("勘察任务执行中，请等待结束后再下发");
        return false;
      }
      if (currentRobotId == null) {
        message.warning("请先在顶部选择机器人");
        return false;
      }

      const cabinetIds = Array.from(new Set(items.map((item) => String(item.cabinetId || "").trim()).filter(Boolean)));
      if (cabinetIds.length === 0) {
        message.warning("请选择带有效地图屏柜 ID 的屏柜");
        return false;
      }

      const res = await cabinetDeviceMainCollect(currentRobotId, cabinetIds);
      const body = res.data || {};
      if (!isOk(body)) {
        message.error(body.message || "屏柜拍照下发失败");
        return false;
      }

      message.success(`已下发 ${cabinetIds.length} 个屏柜`);
      surveyPendingStartUntilRef.current = Date.now() + SURVEY_START_WAIT_MS;
      setSurveyRunning(buildSurveyStartingState("屏柜拍照"));
      void refreshSurveyRunning({ silent: true });
      return true;
    } catch (error) {
      message.error("屏柜拍照下发失败: " + getRequestErrorMessage(error, "请求失败"));
      return false;
    }
  }, [currentRobotId, message, refreshSurveyRunning, surveyRunning?.running]);

  const handleVerifyTaskDispatch = useCallback(async (payload: {
    type: "bay" | "point";
    bays: VerifyTaskBayItem[];
    points: VerifyTaskPointItem[];
  }) => {
    try {
      if (surveyRunning?.running) {
        message.warning("勘察任务执行中，请等待结束后再下发");
        return false;
      }
      if (currentRobotId == null) {
        message.warning("请先在顶部选择机器人");
        return false;
      }

      const isBayTask = payload.type === "bay";
      const codes = Array.from(new Set(
        (isBayTask ? payload.bays.map((item) => item.bayCode) : payload.points.map((item) => item.pointCode))
          .map((code) => String(code || "").trim())
          .filter(Boolean),
      ));
      if (codes.length === 0) {
        message.warning(isBayTask ? "请选择带有效编码的间隔" : "请选择带有效编码的点位");
        return false;
      }

      const res = await startTask(currentRobotId, isBayTask ? { bayCodeList: codes } : { pointCodeList: codes });
      const body = res.data || {};
      if (!isOk(body)) {
        message.error(body.message || "巡视任务下发失败");
        return false;
      }

      message.success(isBayTask ? `已下发 ${codes.length} 个间隔` : `已下发 ${codes.length} 个点位`);
      surveyPendingStartUntilRef.current = Date.now() + SURVEY_START_WAIT_MS;
      setSurveyRunning(buildSurveyStartingState("验证任务"));
      void refreshSurveyRunning({ silent: true });
      return true;
    } catch (error) {
      message.error("巡视任务下发失败: " + getRequestErrorMessage(error, "请求失败"));
      return false;
    }
  }, [currentRobotId, message, refreshSurveyRunning, surveyRunning?.running]);

  const surveyPhotoMenu: MenuProps = {
    items: [
      { key: "normal", label: "勘察拍照", icon: <CameraOutlined /> },
      { key: "supplement", label: "补充勘察拍照", icon: <CameraOutlined /> },
    ],
    onClick: ({ key }) => handleOpenSurveyPhoto(key as SurveyPhotoMode),
  };

  const handleCarControlStart = useCallback((button: (typeof controlButtons)[number]) => {
    if (carControlDisabled) return;
    setControlActiveKey(button.key);
    void sendRobotControl({ command: button.command, type: "2", item: CONTROL_SPEED });
  }, [carControlDisabled, sendRobotControl]);

  const handleCarControlStop = useCallback(() => {
    if (!controlActiveKey) return;
    setControlActiveKey(null);
    void sendRobotControl({ command: "6", type: "2", item: CONTROL_SPEED });
  }, [controlActiveKey, sendRobotControl]);

  useEffect(() => {
    if (!controlActiveKey) return;
    window.addEventListener("mouseup", handleCarControlStop, { once: true });
    window.addEventListener("touchend", handleCarControlStop, { once: true });
    window.addEventListener("touchcancel", handleCarControlStop, { once: true });
    return () => {
      window.removeEventListener("mouseup", handleCarControlStop);
      window.removeEventListener("touchend", handleCarControlStop);
      window.removeEventListener("touchcancel", handleCarControlStop);
    };
  }, [controlActiveKey, handleCarControlStop]);

  const handleTaskOperate = useCallback(async (type: 1 | 2 | 3) => {
    if (taskOperateLoading) return;
    if (isTaskOperateDisabled(nowOperateRow)) {
      if (String(nowOperateRow?.type) === "1") {
        message.warning("勘察任务不支持暂停、继续和停止");
      } else if (!nowOperateRow?.id) {
        message.warning("暂无可操作任务");
      }
      return;
    }
    if (!nowOperateRow?.id) {
      message.warning("暂无可操作任务");
      return;
    }
    const params = { id: nowOperateRow.id, nodeLevel: nowOperateRow.nodeLevel || null };
    const actionMap = {
      1: pauseRealtimeTask,
      2: resumeRealtimeTask,
      3: terminateRealtimeTask,
    };
    try {
      setTaskOperateLoading(true);
      const res = await actionMap[type](params);
      const body = (res.data || {}) as ApiResponse<any>;
      if (isOk(body)) {
        message.success(body.message || "操作成功");
        if (type === 3) {
          setNowOperateRow(null);
          setTaskDetailInfo(null);
        }
        if (station?.id) await loadRunningTask(station.id);
      } else {
        message.error(body.message || "操作失败");
      }
    } catch (error) {
      message.error(getRequestErrorMessage(error, "操作失败"));
    } finally {
      setTaskOperateLoading(false);
    }
  }, [loadRunningTask, message, nowOperateRow, station?.id, taskOperateLoading]);

  const openStatusPanel = useCallback(async () => {
    if (!currentRobotCode) {
      message.warning("未选中机器人");
      return;
    }
    setStatusPanelOpen(true);
    await loadStatusPanelData(statusPanelSummary.abnormalCount > 0 ? "abnormal" : "all");
  }, [currentRobotCode, loadStatusPanelData, message, statusPanelSummary.abnormalCount]);

  const toggleVideoPanel = useCallback((panel: "visible" | "infrared") => {
    setVideoExpanded(false);
    setVideoPanel((current) => (current === panel ? null : panel));
  }, []);

  const positionNormal = Number.isFinite(Number(robotPosition.x)) && Number.isFinite(Number(robotPosition.y));
  const statusPanelCategoryName = String(currentStatusPanelCategory?.categoryName || "");
  const statusPanelIsWeather = isWeatherCategory(statusPanelCategoryName);
  const statusPanelIsService = isServiceResourceCategory(statusPanelCategoryName);
  const statusPanelIsPower = isPowerCategory(statusPanelCategoryName);
  const statusChips = [
    {
      key: "battery",
      icon: <ThunderboltOutlined />,
      label: "电池",
      value: formatBatteryLevel(runData.batteryLevel),
      className: "is-good",
    },
    {
      key: "comm",
      icon: <WifiOutlined />,
      label: "通信",
      value: formatValue(robotStatusData.communicationState),
      className: getToneClass(robotStatusData.communicationState),
    },
    {
      key: "position",
      icon: <EnvironmentOutlined />,
      label: "定位",
      value: positionNormal ? "正常" : "--",
      className: positionNormal ? "is-good" : "is-muted",
    },
    {
      key: "run",
      icon: <PoweroffOutlined />,
      label: "运行",
      value: formatValue(robotStatusData.runningState),
      className: robotStatusData.runningState === "检修" ? "is-warn" : "is-good",
    },
    {
      key: "status",
      icon: <AlertOutlined />,
      label: "状态",
      value: statusPanelSummary.abnormalCount > 0 ? `异常 ${statusPanelSummary.abnormalCount} 项` : "正常",
      className: statusPanelSummary.abnormalCount > 0 ? "is-danger" : "is-good",
      clickable: true,
    },
  ];

  return (
    <div className="realtime-monitor-page">
      <div className="realtime-monitor-toolbar">
        <div className="realtime-monitor-toolbar__left">
          <Dropdown.Button
            menu={surveyPhotoMenu}
            icon={<DownOutlined />}
            onClick={() => handleOpenSurveyPhoto("normal")}
          >
            <CameraOutlined />
            <span>勘察拍照</span>
          </Dropdown.Button>
          <Button icon={<HddOutlined />} onClick={handleOpenCabinetPhoto}>
            屏柜拍照
          </Button>
          <Button icon={<CheckCircleOutlined />} onClick={handleOpenVerifyTask}>
            验证任务
          </Button>
        </div>
        <div className="realtime-monitor-toolbar__right">
          <Dropdown menu={{ items: modeMenuItems, onClick: handleModeCommand }} trigger={["hover"]} disabled={!currentRobotId}>
            <Button disabled={!currentRobotId} title={taskModeName}>
              {taskModeName}
              <DownOutlined />
            </Button>
          </Dropdown>
          <Button icon={<HomeOutlined />} disabled={!currentRobotId} onClick={handleSendBack}>
            一键返航
          </Button>
          <Button
            icon={hasRobotControl ? <LockOutlined /> : <UnlockOutlined />}
            disabled={!currentRobotId || !hasBackendReady}
            loading={controlOwnershipLoading}
            onClick={handleToggleRobotControl}
          >
            {hasRobotControl ? "控制权释放" : "控制权获取"}
          </Button>
          <Button
            icon={<FileZipOutlined />}
            loading={robotLogLoading}
            disabled={!currentRobotId || !hasBackendReady}
            onClick={(event) => handleRobotLog(event.currentTarget)}
          >
            录制小包
          </Button>
        </div>
      </div>

      <section className="realtime-monitor-stage">
        <RealtimeMapCanvas
          directMapData={directMapData}
          robotPosition={robotPosition}
        />

        <div className="realtime-monitor-status-strip">
          {statusChips.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`realtime-monitor-chip ${item.className} ${item.clickable ? "is-clickable" : ""}`}
              onClick={item.clickable ? openStatusPanel : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </button>
          ))}
        </div>

        <div className="realtime-monitor-metrics">
          <span>
            速度
            <strong>{formatValue(runData.horizontalVelocity, " m/s")}</strong>
          </span>
          <i />
          <span>
            电池温度
            <strong>{formatValue(runData.batteryTemperature ?? runData.chassisTemperature, " ℃")}</strong>
          </span>
        </div>

        {hasCameraStream(visibleCamera) && (
          <button
            type="button"
            className={`realtime-monitor-camera realtime-monitor-camera--visible ${videoPanel === "visible" ? "is-active" : ""}`}
            onClick={() => toggleVideoPanel("visible")}
          >
            <VideoCameraOutlined />
            <span>可见光</span>
          </button>
        )}
        {hasCameraStream(infraredCamera) && (
          <button
            type="button"
            className={`realtime-monitor-camera realtime-monitor-camera--infrared ${videoPanel === "infrared" ? "is-active" : ""}`}
            onClick={() => toggleVideoPanel("infrared")}
          >
            <VideoCameraOutlined />
            <span>红外</span>
          </button>
        )}

        {videoPanel && (
          <article className={`realtime-monitor-video realtime-monitor-video--${videoPanel} ${videoExpanded ? "is-expanded" : ""}`}>
            <header>
              <strong>{videoPanel === "visible" ? "可见光视频" : "红外视频"}</strong>
              <span>{formatValue((videoPanel === "visible" ? visibleCamera : infraredCamera)?.cameraName)}</span>
              <button
                type="button"
                onClick={() => {
                  setVideoExpanded(false);
                  setVideoPanel(null);
                }}
              >
                ×
              </button>
            </header>
            <div className="realtime-monitor-video__body">
              <RealtimeVideoPlayer
                camera={videoPanel === "visible" ? visibleCamera : infraredCamera}
                visibleType={videoPanel === "visible" ? 1 : 2}
                backendReady={hasBackendReady}
                onDoubleClick={() => setVideoExpanded((current) => !current)}
              />
            </div>
          </article>
        )}

        <article className="realtime-monitor-task">
          <header>当前任务</header>
          <div className="realtime-monitor-task__body">
            <div className="realtime-monitor-task__row realtime-monitor-task__row--name">
              <span>名称</span>
              <strong title={taskDisplayName}>{taskDisplayName}</strong>
            </div>
            <div className="realtime-monitor-task__meta">
              {taskBriefItems.map((item) => (
                <span key={item.key} className="realtime-monitor-task__field">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
            <div className="realtime-monitor-task__actions">
              <button
                type="button"
                className="realtime-monitor-task__action realtime-monitor-task__action--pause"
                disabled={taskOperateDisabled || taskOperateLoading}
                onClick={() => handleTaskOperate(1)}
              >
                <PauseOutlined />
                暂停
              </button>
              <button
                type="button"
                className="realtime-monitor-task__action realtime-monitor-task__action--resume"
                disabled={taskOperateDisabled || taskOperateLoading}
                onClick={() => handleTaskOperate(2)}
              >
                <PlayCircleOutlined />
                继续
              </button>
              <button
                type="button"
                className="realtime-monitor-task__action realtime-monitor-task__action--stop"
                disabled={taskOperateDisabled || taskOperateLoading}
                onClick={() => handleTaskOperate(3)}
              >
                <StopOutlined />
                停止
              </button>
            </div>
          </div>
        </article>

        <div className={`realtime-monitor-control ${carControlDisabled ? "is-disabled" : ""}`} title={hasRobotControl ? "车体控制" : "车体控制"}>
          {controlButtons.map((button) => (
            <button
              key={button.key}
              type="button"
              className={`realtime-monitor-control__btn realtime-monitor-control__btn--${button.key} ${controlActiveKey === button.key ? "is-active" : ""}`}
              aria-label={button.label}
              disabled={carControlDisabled}
              onMouseDown={(event) => {
                event.preventDefault();
                handleCarControlStart(button);
              }}
              onMouseUp={handleCarControlStop}
              onTouchStart={(event) => {
                event.preventDefault();
                handleCarControlStart(button);
              }}
              onTouchEnd={handleCarControlStop}
            >
              <StepForwardOutlined />
            </button>
          ))}
          <span className="realtime-monitor-control__center" />
        </div>

        {stageLoading && (
          <div className="realtime-monitor-loading">
            <Spin size="small" />
            <span>{stageLoadingText}</span>
          </div>
        )}

        {!stageLoading && errorText && (
          <div className="realtime-monitor-empty">
            <AlertOutlined />
            <span>{errorText}</span>
          </div>
        )}
      </section>

      <SurveyPhotoModal
        open={surveyPhotoOpen}
        title={surveyPhotoMode === "supplement" ? "补充勘察拍照" : "勘察拍照"}
        mode={surveyPhotoMode}
        projectName={selectedProject}
        mapName={currentMap?.mapName}
        mapCode={currentMap?.mapCode}
        surveyRunning={surveyRunning}
        onClose={() => setSurveyPhotoOpen(false)}
        onDispatch={handleSurveyPhotoDispatch}
      />

      <CabinetPhotoModal
        open={cabinetPhotoOpen}
        projectName={selectedProject}
        mapName={currentMap?.mapName}
        mapCode={currentMap?.mapCode}
        surveyRunning={surveyRunning}
        onClose={() => setCabinetPhotoOpen(false)}
        onDispatch={handleCabinetPhotoDispatch}
      />

      <VerifyTaskModal
        open={verifyTaskOpen}
        projectName={selectedProject}
        surveyRunning={surveyRunning}
        onClose={() => setVerifyTaskOpen(false)}
        onDispatch={handleVerifyTaskDispatch}
      />

      <Modal
        title="机器人状态面板"
        open={statusPanelOpen}
        width={1000}
        footer={null}
        onCancel={() => setStatusPanelOpen(false)}
        className="realtime-monitor-status-modal"
      >
        <div className="realtime-monitor-status-panel">
          <div className="realtime-monitor-status-panel__tabs">
            <button
              type="button"
              className={statusPanelActiveTab === "all" ? "is-active" : ""}
              onClick={() => setStatusPanelActiveTab("all")}
            >
              全部状态
              <em>{statusPanelSummary.totalCount}</em>
            </button>
            <button
              type="button"
              className={`${statusPanelActiveTab === "abnormal" ? "is-active" : ""} ${statusPanelSummary.abnormalCount > 0 ? "is-abnormal" : ""}`}
              onClick={() => {
                setStatusPanelActiveTab("abnormal");
                const category = statusPanelData.categories.find((item) => Number(item.abnormalCount || 0) > 0);
                if (category) setStatusPanelActiveCategory(category.categoryName);
              }}
            >
              异常状态
              <em>{statusPanelSummary.abnormalCount}</em>
            </button>
          </div>
          <div className="realtime-monitor-status-panel__content">
            <aside>
              {(statusPanelData.categories || []).map((category) => (
                <button
                  key={category.categoryName}
                  type="button"
                  className={category.categoryName === currentStatusPanelCategory?.categoryName ? "is-active" : ""}
                  onClick={() => setStatusPanelActiveCategory(category.categoryName)}
                >
                  <span>{category.categoryName}</span>
                  <strong className={Number(category.abnormalCount || 0) > 0 ? "is-abnormal" : ""}>
                    {Number(category.abnormalCount || 0)}
                    <em>/{Number(category.totalCount || category.items?.length || 0)}</em>
                  </strong>
                </button>
              ))}
            </aside>
            <main>
              <div className="realtime-monitor-status-panel__summary">
                <span>分类 {currentStatusPanelCategory?.categoryName || "--"}</span>
                <span>总数 {Number(currentStatusPanelCategory?.totalCount || 0)}</span>
                <span>正常 {Number(currentStatusPanelCategory?.normalCount || 0)}</span>
                <span className={Number(currentStatusPanelCategory?.abnormalCount || 0) > 0 ? "is-abnormal" : ""}>
                  异常 {Number(currentStatusPanelCategory?.abnormalCount || 0)}
                </span>
              </div>
              {statusPanelLoading ? (
                <div className="realtime-monitor-status-panel__empty">加载中...</div>
              ) : !currentStatusPanelItems.length ? (
                <div className="realtime-monitor-status-panel__empty">
                  {statusPanelActiveTab === "abnormal" ? "当前分类暂无异常" : "暂无状态数据"}
                </div>
              ) : (
                <div className="realtime-monitor-status-panel__grid">
                  {currentStatusPanelItems.map((item, index) => {
                    const weatherMetrics = statusPanelIsWeather ? parseWeatherMetrics(item) : [];
                    const coordinateValues = isCoordinateItem(item) ? parseCoordinateValues(item) : [];
                    const serviceMetrics = statusPanelIsService ? parseServiceMetrics(item) : [];
                    const powerMetrics = statusPanelIsPower ? parsePowerMetrics(item) : [];
                    const servicePercentValue = statusPanelIsService && isPercentValue(item.statusText)
                      ? String(item.statusText).trim()
                      : "";
                    const isCoordinate = coordinateValues.length > 0;
                    const isGenericStatus = !isCoordinate && !statusPanelIsService && !statusPanelIsPower && !statusPanelIsWeather;
                    const genericStatusText = formatValue(item.statusText);
                    const genericParamsText = formatStatusPanelValue(item.params);
                    return (
                      <article
                        key={item.code || index}
                        className={`${item.abnormal ? "is-abnormal" : ""} ${statusPanelIsWeather ? "is-weather" : ""} ${statusPanelIsService ? "is-service" : ""} ${statusPanelIsPower ? "is-power" : ""} ${isCoordinate ? "is-coordinate" : ""} ${isGenericStatus ? "is-generic" : ""}`}
                      >
                        <strong title={item.displayName || item.name || item.code || "--"}>
                          {item.displayName || item.name || item.code || "--"}
                        </strong>
                        {isCoordinate ? (
                          <>
                            <div className={`realtime-monitor-coordinate-status ${item.abnormal ? "is-abnormal" : "is-good"}`}>
                              <i />
                              <span>{formatValue(item.statusText)}</span>
                            </div>
                            <div className="realtime-monitor-coordinate-values">
                              {coordinateValues.map((coordinate) => (
                                <div className="realtime-monitor-coordinate-row" key={coordinate.axis}>
                                  <span>{coordinate.axis}</span>
                                  <strong>{coordinate.value}</strong>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : statusPanelIsService ? (
                          <>
                            {!servicePercentValue && item.statusText && item.statusText !== "--" && (
                              <div className={`realtime-monitor-service-status ${item.abnormal ? "is-abnormal" : "is-good"}`}>
                                <i />
                                <span>{formatValue(item.statusText)}</span>
                              </div>
                            )}
                            {servicePercentValue ? (
                              <div className="realtime-monitor-service-primary-value">{servicePercentValue}</div>
                            ) : serviceMetrics.length ? (
                              <div className="realtime-monitor-service-metrics">
                                {serviceMetrics.map((metric) => (
                                  <div className="realtime-monitor-service-metric" key={metric.key}>
                                    <span>{metric.label}</span>
                                    <strong>{metric.value}</strong>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : statusPanelIsPower ? (
                          <>
                            {item.statusText && item.statusText !== "--" && (
                              <div className={`realtime-monitor-power-status ${item.abnormal ? "is-abnormal" : "is-good"}`}>
                                <i />
                                <span>{formatValue(item.statusText)}</span>
                              </div>
                            )}
                            {powerMetrics.length > 0 && (
                              <div className="realtime-monitor-power-metrics">
                                {powerMetrics.map((metric) => (
                                  <div className="realtime-monitor-power-metric" key={metric.key}>
                                    <span>{metric.label}</span>
                                    <strong>{metric.value}</strong>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        ) : statusPanelIsWeather && isWeatherCommunicationItem(item) ? (
                          <div className={`realtime-monitor-weather-status ${item.abnormal ? "is-abnormal" : "is-good"}`}>
                            <i />
                            <span>{formatValue(item.statusText)}</span>
                          </div>
                        ) : statusPanelIsWeather ? (
                          <div className="realtime-monitor-weather-metrics">
                            {weatherMetrics.map((metric) => (
                              <div className="realtime-monitor-weather-metric" key={metric.key}>
                                <span>{metric.label}</span>
                                <strong>{metric.value}</strong>
                              </div>
                            ))}
                            {!weatherMetrics.length && (
                              <span className="realtime-monitor-weather-empty">暂无气象数据</span>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className={`realtime-monitor-generic-status ${item.abnormal ? "is-abnormal" : genericStatusText === "--" ? "is-muted" : "is-good"}`}>
                              <i />
                              <span title={genericStatusText}>{genericStatusText === "--" ? "暂无状态" : genericStatusText}</span>
                            </div>
                            {genericParamsText !== "--" && (
                              <div className="realtime-monitor-generic-params" title={genericParamsText}>
                                <span>参数</span>
                                <strong>{genericParamsText}</strong>
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        </div>
      </Modal>
    </div>
  );
}
