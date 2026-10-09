import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Popover, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  RedoOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { DOWNLOAD_TASK_FLY_EVENT, type DownloadTaskFlyRect } from "./events";
import "./index.scss";

type TaskStatus = ExportTaskStatus | "idle";

const STATUS_TEXT: Record<TaskStatus, string> = {
  idle: "暂无导出任务",
  pending: "等待中",
  running: "导出中",
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function DownloadTaskButton() {
  const { message } = App.useApp();
  const buttonWrapRef = useRef<HTMLSpanElement>(null);
  const previousTaskStatusRef = useRef<Record<string, ExportTaskStatus>>({});
  const [tasks, setTasks] = useState<ExportTaskInfo[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const hasRunningTask = tasks.some((task) => task.status === "running" || task.status === "pending");
  const hasFailedTask = tasks.some((task) => task.status === "failed");
  const indicatorMode = hasRunningTask ? "running" : hasFailedTask ? "failed" : tasks.length > 0 ? "normal" : "idle";
  const indicatorCount = tasks.length > 99 ? "99+" : String(tasks.length);

  useEffect(() => {
    const api = window.electronAPI?.downloadTasks;
    if (!api) return;
    let disposed = false;
    api.list().then((list) => {
      if (!disposed) setTasks(list || []);
    }).catch((): undefined => undefined);
    const unsubscribe = api.onChanged((list) => setTasks(list || []));
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const onBackendRequestLog = window.electronAPI?.onBackendRequestLog;
    if (!onBackendRequestLog) return;

    console.log("[后台请求] 已连接 Electron 主进程请求日志");
    const unsubscribe = onBackendRequestLog((log) => {
      const logger = log.level === "warn" ? console.warn : console.log;
      logger("[后台请求][主进程]", log);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const previous = previousTaskStatusRef.current;
    const shouldOpen = tasks.some((task) => {
      const lastStatus = previous[task.id];
      const newlyStarted = !lastStatus && (task.status === "pending" || task.status === "running");
      const completed = (task.status === "success" || task.status === "failed")
        && lastStatus
        && lastStatus !== task.status;
      return newlyStarted || completed;
    });

    previousTaskStatusRef.current = tasks.reduce<Record<string, ExportTaskStatus>>((result, task) => {
      result[task.id] = task.status;
      return result;
    }, {});

    if (shouldOpen) {
      setPopoverOpen(true);
    }
  }, [tasks]);

  useEffect(() => {
    const handleFly = (event: Event) => {
      const custom = event as CustomEvent<{ from?: DownloadTaskFlyRect }>;
      const from = custom.detail?.from;
      const toEl = buttonWrapRef.current;
      if (!from || !toEl) return;
      runFlyAnimation(from, toEl.getBoundingClientRect());
    };
    window.addEventListener(DOWNLOAD_TASK_FLY_EVENT, handleFly);
    return () => window.removeEventListener(DOWNLOAD_TASK_FLY_EVENT, handleFly);
  }, []);

  const handleCancel = useCallback(async (taskId: string) => {
    const result = await window.electronAPI?.downloadTasks?.cancel(taskId);
    if (!result?.success) {
      message.error(result?.error || "取消失败");
    }
  }, [message]);

  const handleRetry = useCallback(async (taskId: string) => {
    const result = await window.electronAPI?.downloadTasks?.retry(taskId);
    if (!result?.success) {
      message.error(result?.error || "重试失败");
    }
  }, [message]);

  const handleOpenFolder = useCallback(async (taskId: string) => {
    const result = await window.electronAPI?.downloadTasks?.openFolder(taskId);
    if (!result?.success) {
      message.error(result?.error || "打开目录失败");
    }
  }, [message]);

  const handleRemove = useCallback(async (taskId: string) => {
    const result = await window.electronAPI?.downloadTasks?.remove(taskId);
    if (!result?.success) {
      message.error(result?.error || "移出列表失败");
    }
  }, [message]);

  const panel = useMemo(() => (
    <div className="download-task-panel">
      <div className="download-task-panel-title">导出任务</div>
      {tasks.length === 0 ? (
        <div className="download-task-empty">暂无任务</div>
      ) : (
        <div className="download-task-list">
          {tasks.map((task) => (
            <div className="download-task-item" key={task.id}>
              {task.status !== "running" && task.status !== "pending" ? (
                <Tooltip title="移出列表">
                  <Button
                    type="text"
                    size="small"
                    className="download-task-remove"
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemove(task.id)}
                  />
                </Tooltip>
              ) : null}
              <div className="download-task-icon">
                {renderTaskIcon(task.status)}
              </div>
              <div className="download-task-main">
                <Tooltip title={task.fileName || task.name}>
                  <span className="download-task-name">{task.fileName || task.name}</span>
                </Tooltip>
                <div className="download-task-message">{task.message || STATUS_TEXT[task.status]}</div>
              </div>
              <div className="download-task-side">
                <span className={`download-task-status ${task.status}`}>{STATUS_TEXT[task.status]}</span>
                <div className="download-task-actions">
                  {task.status === "running" || task.status === "pending" ? (
                    <Button size="small" type="link" danger icon={<StopOutlined />} onClick={() => handleCancel(task.id)}>
                      取消
                    </Button>
                  ) : null}
                  {task.status === "success" ? (
                    <Button size="small" type="link" icon={<FolderOpenOutlined />} onClick={() => handleOpenFolder(task.id)}>
                      打开目录
                    </Button>
                  ) : null}
                  {task.status === "failed" || task.status === "cancelled" ? (
                    <Button size="small" type="link" icon={<RedoOutlined />} onClick={() => handleRetry(task.id)}>
                      重试
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  ), [handleCancel, handleOpenFolder, handleRemove, handleRetry, tasks]);

  if (!window.electronAPI?.downloadTasks) return null;

  return (
    <span ref={buttonWrapRef} className="download-task-button-wrap">
      <Popover
        content={panel}
        trigger="click"
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        placement="bottomRight"
        overlayClassName="download-task-popover"
      >
        <Tooltip title="导出任务">
          <Button
            type="text"
            size="small"
            className="download-task-button"
            icon={<ArrowDownOutlined className="download-task-button-icon" />}
          />
        </Tooltip>
      </Popover>
      {indicatorMode !== "idle" && (
        <span className={`download-task-indicator is-${indicatorMode}`}>
          {indicatorMode === "running" ? <LoadingOutlined /> : <span>{indicatorCount}</span>}
        </span>
      )}
    </span>
  );
}

function renderTaskIcon(status: ExportTaskStatus) {
  if (status === "running" || status === "pending") return <LoadingOutlined style={{ color: "#1677ff" }} />;
  if (status === "success") return <CheckCircleFilled style={{ color: "#52c41a" }} />;
  if (status === "failed") return <CloseCircleFilled style={{ color: "#ff4d4f" }} />;
  return <DownloadOutlined style={{ color: "#8c8c8c" }} />;
}

function runFlyAnimation(from: DownloadTaskFlyRect, to: DOMRect) {
  const icon = document.createElement("div");
  icon.className = "download-task-fly-icon";
  icon.innerHTML = `<span role="img" aria-label="download" class="anticon anticon-arrow-down"><svg viewBox="64 64 896 896" focusable="false" data-icon="arrow-down" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M505.7 661a8 8 0 0012.6 0l112-141.7c4.1-5.2.4-12.9-6.3-12.9h-74.1V168c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v338.3H400c-6.7 0-10.4 7.7-6.3 12.9l112 141.8z"></path><path d="M878 626h-60c-4.4 0-8 3.6-8 8v154H214V634c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v198c0 17.7 14.3 32 32 32h684c17.7 0 32-14.3 32-32V634c0-4.4-3.6-8-8-8z"></path></svg></span>`;
  document.body.appendChild(icon);

  const start = {
    x: from.left + from.width / 2 - 12,
    y: from.top + from.height / 2 - 12,
  };
  const end = {
    x: to.left + to.width / 2 - 12,
    y: to.top + to.height / 2 - 12,
  };
  const control = {
    x: (start.x + end.x) / 2,
    y: Math.min(start.y, end.y) - 90,
  };
  const startTime = performance.now();
  const duration = 620;

  const step = (now: number) => {
    const raw = Math.min(1, (now - startTime) / duration);
    const t = 1 - Math.pow(1 - raw, 3);
    const x = quadratic(start.x, control.x, end.x, t);
    const y = quadratic(start.y, control.y, end.y, t);
    icon.style.transform = `translate(${x}px, ${y}px) scale(${1 - t * 0.35})`;
    icon.style.opacity = String(raw > 0.82 ? Math.max(0, 1 - (raw - 0.82) / 0.18) : 1);
    if (raw < 1) {
      requestAnimationFrame(step);
    } else {
      icon.remove();
    }
  };
  requestAnimationFrame(step);
}

function quadratic(a: number, b: number, c: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * a + 2 * mt * t * b + t * t * c;
}

export { startDownloadTaskFlyAnimation } from "./events";
