import { useEffect, useState } from "react";
import { App, Button, Tag, Tooltip } from "antd";
import { CloudDownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AppUpdateState } from "../../shared/app-update";
import "./index.css";

export default function AppFooter() {
  const { message, modal } = App.useApp();
  const api = window.electronAPI?.appUpdate;
  const [state, setState] = useState<AppUpdateState>({ currentVersion: __APP_VERSION__, phase: api ? "idle" : "disabled" });
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!api) return;
    let active = true;
    let receivedEvent = false;
    const dispose = api.onChanged((next) => {
      receivedEvent = true;
      if (active) setState(next);
    });
    void api.state().then((next) => { if (active && !receivedEvent) setState(next); }).catch(() => {
      if (active && !receivedEvent) setState((old) => ({ ...old, phase: "error", message: "无法读取更新状态" }));
    });
    return () => { active = false; dispose(); };
  }, [api]);

  const busy = requesting || ["checking", "downloading", "installing"].includes(state.phase);
  const ready = state.phase === "downloaded";
  const available = !!state.latestVersion && state.phase !== "latest";

  async function perform(action: "check" | "download" | "install") {
    if (!api) return;
    setRequesting(true);
    try {
      const result = await api[action]();
      setState(result.state);
      if (!result.success) message.error(result.error || "更新失败，请重试");
      else if (action === "check" && result.state.phase === "latest") message.success("当前已是最新版本");
      else if (action === "download" && result.state.phase === "downloaded") message.success("更新已下载，请保存项目后重启安装");
    } catch {
      message.error("更新操作失败，请稍后重试");
    } finally {
      setRequesting(false);
    }
  }

  function handleUpdate() {
    if (ready) {
      modal.confirm({
        title: `安装新版本 ${state.latestVersion}`,
        content: "应用将退出并启动安装程序，请先保存正在编辑的项目。",
        okText: "重启安装",
        cancelText: "稍后",
        onOk: () => perform("install"),
      });
    } else {
      void perform(available ? "download" : "check");
    }
  }

  const label = state.phase === "checking" ? "检查中"
    : state.phase === "downloading" ? `下载中 ${Math.floor(state.progress || 0)}%`
    : state.phase === "installing" ? "正在安装"
    : ready ? "重启安装" : available ? "更新" : "检查更新";

  return (
    <footer className="app-footer" aria-label="应用版本与更新">
      <span className="app-footer-version">版本 v{state.currentVersion}</span>
      <Tooltip title={state.phase === "disabled" ? "仅安装版支持在线更新" : undefined}>
        <Button type="link" size="small" icon={available ? <CloudDownloadOutlined /> : <ReloadOutlined />}
          loading={busy} disabled={state.phase === "disabled" || busy} onClick={handleUpdate}>{label}</Button>
      </Tooltip>
      {available && <Tag color={ready ? "green" : "blue"}>{ready ? "更新已就绪" : "发现新版本"} v{state.latestVersion}</Tag>}
      {state.phase === "latest" && <span className="app-footer-status">已是最新版本</span>}
      {state.phase === "error" && <Tooltip title={state.message}><span className="app-footer-error">更新失败，可重试</span></Tooltip>}
    </footer>
  );
}
