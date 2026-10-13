import { FolderOpenOutlined, LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Progress, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { confirmWorkspaceTransition } from "@/services/workspace-transition-guard";
import { setStorageMigrating } from "@/stores/appContextStore";
import "./index.scss";

type MigrationProgress = {
  phase: string; message: string;
  mode?: "move" | "copy";
  totalFiles: number; completedFiles: number;
  totalBytes: number; completedBytes: number;
};
interface Props {
  onBusyChange: (busy: boolean) => void;
  onMigrationComplete?: () => Promise<void> | void;
}

export default function StorageSettings({ onBusyChange, onMigrationComplete }: Props) {
  const [root, setRoot] = useState("");
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ type: "error" | "warning" | "success"; text: string } | null>(null);
  const api = window.electronAPI;

  const refresh = async () => {
    if (!api) return;
    const [current, status] = await Promise.all([api.getProjectRoot(), api.getDataPathMigrationStatus()]);
    setRoot(current);
    setPending(status.pending);
    if (status.pending && status.target) setTarget(status.target);
  };

  useEffect(() => {
    void refresh().catch((e) => setNotice({ type: "error", text: e.message }));
    return api?.onDataPathMigrationProgress?.(setProgress);
  }, []);

  const choose = async () => {
    try {
      const selected = await api?.selectDir("选择新的项目保存目录（空目录）");
      if (selected) { setTarget(selected); setNotice(null); }
    } catch (e: any) { setNotice({ type: "error", text: e?.message || "选择目录失败" }); }
  };

  const migrate = async () => {
    if (!api || !target || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); onBusyChange(true); setNotice(null); setProgress(null);
    let paused = false;
    try {
      if (!(await confirmWorkspaceTransition("迁移保存目录"))) return;
      // 同步卸载业务页，清除自动保存定时器和旧文件缓存，再调用主进程。
      flushSync(() => setStorageMigrating(true));
      paused = true;
      const result = await api.setDataPath(target);
      await refresh();
      await onMigrationComplete?.();
      setNotice({
        type: result.warning ? "warning" : "success",
        text: result.warning || (result.changed ? "项目文件已迁移，保存目录已更新。" : "当前保存目录无需迁移。"),
      });
    } catch (e: any) {
      setNotice({ type: "error", text: e?.message || "迁移失败，请重试。" });
      await refresh().catch(() => {});
    } finally {
      if (paused) flushSync(() => setStorageMigrating(false));
      busyRef.current = false;
      setBusy(false); onBusyChange(false);
    }
  };

  const moving = progress?.mode === "move";
  const stages = moving ? ["移动目录", "更新路径"] : ["复制文件", "更新路径", "清理原目录"];
  // 复制占主要进度；整体移动无需遍历文件计数，路径切换结束后才显示完成。
  const copyRatio = progress && progress.totalBytes > 0
    ? progress.completedBytes / progress.totalBytes
    : progress && progress.totalFiles > 0 ? progress.completedFiles / progress.totalFiles : 0;
  const percent = progress?.phase === "complete" ? 100
    : progress?.phase === "cleaning" ? 99
    : progress?.phase === "switching" ? 98
    : progress?.phase === "verifying" ? 96
    : progress?.phase === "moving" ? 50
    : Math.min(95, Math.floor(copyRatio * 95));
  const stage = progress?.phase === "complete" ? stages.length
    : progress?.phase === "cleaning" ? 2
    : ["verifying", "switching"].includes(progress?.phase || "") ? 1 : 0;

  return (
    <div className="storage-settings">
      <Alert type="info" showIcon message="更改目录会迁移全部项目，请选择空目录并保持应用开启。" />
      {pending && !busy && <Alert type="warning" showIcon message="上次迁移未完成，请继续迁移。" />}
      <div className="storage-settings__paths">
        <div className="storage-settings__path-row">
          <Typography.Text type="secondary">当前保存目录</Typography.Text>
          <Typography.Paragraph className="storage-settings__path" copyable={root ? { text: root } : false}>
            {root || (api ? "正在读取…" : "仅桌面客户端支持配置")}
          </Typography.Paragraph>
        </div>
        <div className="storage-settings__path-row">
          <div className="storage-settings__path-heading">
            <Typography.Text type="secondary">目标目录</Typography.Text>
            <Button size="small" icon={<FolderOpenOutlined />} onClick={choose} disabled={!api || busy || pending}>选择目录</Button>
          </div>
          <Typography.Paragraph className="storage-settings__path">{target || "尚未选择"}</Typography.Paragraph>
        </div>
      </div>
      {busy && <div className="storage-settings__progress" role="status" aria-live="polite">
        <div className="storage-settings__progress-heading">
          <LoadingOutlined spin />
          <span>{progress?.message || "正在准备迁移…"}</span>
          <span className="storage-settings__percent">{percent}%</span>
        </div>
        <Progress percent={percent} status="active" showInfo={false} />
        <div className="storage-settings__stages">
          {stages.map((label, index) => (
            <span key={label} className={stage === index ? "is-active" : stage > index ? "is-complete" : ""}>
              {stage > index ? "✓" : index + 1} {label}
            </span>
          ))}
        </div>
        {!moving && progress && progress.totalFiles > 0 && <Typography.Text type="secondary" className="storage-settings__file-count">
          已复制 {progress.completedFiles} / {progress.totalFiles} 个文件
        </Typography.Text>}
      </div>}
      {notice && <Alert type={notice.type} showIcon message={notice.text} />}
      <div className="storage-settings__actions">
        <Button type="primary" onClick={migrate} loading={busy} disabled={!api || !target || (!pending && target === root)}>
          {busy ? "迁移中" : pending ? "继续迁移" : "迁移并保存"}
        </Button>
      </div>
    </div>
  );
}
