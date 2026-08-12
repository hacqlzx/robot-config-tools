import { useState, useEffect, useCallback } from "react";
import { Menu, Button, Select, Modal, Alert, message, Tooltip } from "antd";
import { useRef } from "react";
import { MinusOutlined, BorderOutlined, CloseOutlined, SettingOutlined, ProjectOutlined, SwitcherOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { menuConfig } from "@/config/menu";
import DownloadTaskButton from "@/components/download-task";
import toolIcon from "@/assets/img/icon.png";
import SettingsModal from "@/pages/settings-modal";
import ProjectManagerModal from "./ProjectManagerModal";
import {
  clearRobotOptions,
  getSelectedProject,
  setConnectionStatus,
  setSelectedProject,
  setSelectedRobot,
  useAppContext,
  useRobotOptions,
} from "@/stores/appContextStore";
import { refreshRobotRecords } from "@/services/robot-options";
import { MESSAGE_TOP_OFFSET } from "@/App";

const menuItems: MenuProps["items"] = menuConfig.map((item) => ({ key: item.key, label: item.label }));

function joinProjectPath(root: string, projectName: string): string {
  if (!root || !projectName) return root || "";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${trimmedRoot}${separator}${projectName}`;
}

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    selectedProject,
    selectedRobot,
    backendIp,
    backendIpVersion,
    connectionStatus: connStatus,
  } = useAppContext();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectManagerOpen, setProjectManagerOpen] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectRoot, setProjectRoot] = useState("");
  const [deleteProjectName, setDeleteProjectName] = useState<string | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<ProjectDataCounts | null>(null);
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false);
  const [deleteSummaryError, setDeleteSummaryError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const lastBackendIpVersionRef = useRef(backendIpVersion);
  const robotOptions = useRobotOptions();
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [messageApi, contextHolder] = message.useMessage({ top: MESSAGE_TOP_OFFSET });

  const loadRobotList = useCallback(async () => {
    try {
      await refreshRobotRecords();
    } catch {
      // ignore
    }
  }, []);

  // 连接成功后刷新机器人列表。
  useEffect(() => {
    const backendVersionChanged = backendIpVersion !== lastBackendIpVersionRef.current;
    lastBackendIpVersionRef.current = backendIpVersion;
    if (backendVersionChanged && backendIpVersion > 0) clearRobotOptions();
    if (connStatus === "connected") loadRobotList();
  }, [backendIpVersion, connStatus, loadRobotList]);
  // 启动时自动检查已保存后台。
  useEffect(() => {
    if (!backendIp || !window.electronAPI?.ping) return;
    window.electronAPI.ping(backendIp).then((ok: boolean) => {
      setConnectionStatus(ok ? "connected" : "failed");
    });
  }, [backendIp]);

  useEffect(() => {
    const api = window.electronAPI;
    let disposed = false;
    const syncWindowState = (state: AppWindowState) => {
      if (!disposed) setIsWindowMaximized(Boolean(state?.isMaximized || state?.isFullScreen));
    };

    api?.getWindowState?.().then(syncWindowState).catch(() => {});
    const unsubscribe = api?.onWindowStateChange?.(syncWindowState);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const loadProjectRoot = useCallback(async () => {
    if (!window.electronAPI?.getProjectRoot) {
      setProjectRoot("");
      return;
    }
    try {
      const root = await window.electronAPI.getProjectRoot();
      setProjectRoot(root || "");
    } catch {
      setProjectRoot("");
    }
  }, []);

  const getProjectPath = useCallback((name: string) => joinProjectPath(projectRoot, name), [projectRoot]);

  const loadProjects = useCallback(async () => {
    if (!window.electronAPI?.project) return;
    try {
      const list = await window.electronAPI.project.list();
      setProjects(list);
      await loadProjectRoot();
      const currentProject = getSelectedProject();
      if (list.length === 0) {
        setSelectedProject(null);
      } else if (currentProject && !list.includes(currentProject)) {
        setSelectedProject(null);
      }
    } catch {
      messageApi.error("加载项目列表失败");
    }
  }, [loadProjectRoot, messageApi]);

  // 初始化加载项目列表
  useEffect(() => {
    loadProjects();
  }, []); // eslint-disable-next-line

  const handleDeleteProject = async () => {
    if (!deleteProjectName || !window.electronAPI?.project) return;
    const name = deleteProjectName;
    setDeleteLoading(true);
    try {
      await window.electronAPI.project.delete(name);
      messageApi.success(`项目 "${name}" 已删除`);
      if (selectedProject === name) {
        setSelectedProject(null);
      }
      setDeleteProjectName(null);
      setDeleteSummary(null);
      await loadProjects();
    } catch (e: any) {
      messageApi.error(e?.message || "删除项目失败");
    } finally {
      setDeleteLoading(false);
    }
  };

  const loadDeleteSummary = async (name: string) => {
    if (!window.electronAPI?.project.getDataSummary) {
      setDeleteSummaryError("仅 Electron 环境支持项目数据统计");
      return;
    }
    setDeleteSummary(null);
    setDeleteSummaryError("");
    setDeleteSummaryLoading(true);
    try {
      const summary = await window.electronAPI.project.getDataSummary(name);
      setDeleteSummary(summary);
    } catch (e: any) {
      setDeleteSummaryError(e?.message || "统计项目关联数据失败");
    } finally {
      setDeleteSummaryLoading(false);
    }
  };

  const handleOpenDeleteModal = (name: string) => {
    setDeleteProjectName(name);
    void loadDeleteSummary(name);
  };

  const handleCloseDeleteModal = () => {
    if (deleteLoading) return;
    setDeleteProjectName(null);
    setDeleteSummary(null);
    setDeleteSummaryError("");
  };

  const handleSwitchProject = (name: string) => {
    setSelectedProject(name);
    messageApi.success(`已切换到项目 "${name}"`);
  };

  const handleOpenProjectDir = async (name: string) => {
    const projectPath = getProjectPath(name);
    if (!projectPath || !window.electronAPI?.project) {
      messageApi.warning("项目路径不可用");
      return;
    }
    try {
      await window.electronAPI.project.openDir(projectPath);
    } catch (e: any) {
      messageApi.error(e?.message || "打开目录失败");
    }
  };

  const handleChooseProjectRoot = async () => {
    if (!window.electronAPI?.selectDir || !window.electronAPI?.setDataPath) {
      messageApi.warning("仅 Electron 环境支持选择保存目录");
      return;
    }
    try {
      const dir = await window.electronAPI.selectDir();
      if (!dir) return;
      await window.electronAPI.setDataPath(dir);
      messageApi.success("保存目录已更新");
      await loadProjects();
      await loadProjectRoot();
    } catch (e: any) {
      messageApi.error(e?.message || "保存目录更新失败");
    }
  };

  return (
    <div className="app-header" style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
      {contextHolder}
      <div className="app-header__brand" aria-label="七宝智图">
        <img src={toolIcon} alt="" draggable={false} />
      </div>
      <Menu mode="horizontal" selectedKeys={[location.hash.slice(1) || location.pathname]} items={menuItems} className="app-header__menu" style={{ width: "auto" }} onClick={({ key }) => navigate(key)} />
      <div className="app-header__toolbar">
        <Button
          type="text"
          size="small"
          icon={<ProjectOutlined />}
          title="项目管理"
          onClick={() => {
            loadProjects();
            setProjectManagerOpen(true);
          }}
        />
        <Select placeholder="选择项目" style={{ width: 160 }} size="small" value={selectedProject} onChange={(v) => { setSelectedProject(v); }} allowClear options={projects.map((p) => ({ label: p, value: p }))} />
        <Select placeholder="选择机器人" style={{ width: 120 }} size="small" value={selectedRobot} onChange={(v) => { setSelectedRobot(v ?? null); }} allowClear options={robotOptions} />
        <DownloadTaskButton />
        <div style={{ position: "relative", display: "inline-flex" }}>
          <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} />
          <span style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            pointerEvents: "none",
            backgroundColor: connStatus === "connected" ? "#52c41a" : connStatus === "failed" ? "#ff4d4f" : "#bfbfbf",
          }} />
        </div>
        <div className="app-header__controls">
          <Button className="app-header__control-btn" type="text" size="small" aria-label="最小化" title="最小化" icon={<MinusOutlined />} onClick={() => window.electronAPI?.minimize()} />
          <Button
            className="app-header__control-btn"
            type="text"
            size="small"
            aria-label={isWindowMaximized ? "还原窗口" : "最大化"}
            title={isWindowMaximized ? "还原窗口" : "最大化"}
            icon={isWindowMaximized ? <SwitcherOutlined /> : <BorderOutlined />}
            onClick={() => window.electronAPI?.maximize()}
          />
          <Button className="app-header__control-btn app-header__control-btn--close" type="text" size="small" aria-label="关闭" title="关闭" icon={<CloseOutlined />} onClick={() => window.electronAPI?.close()} />
        </div>
      </div>

      <ProjectManagerModal
        open={projectManagerOpen}
        projects={projects}
        selectedProject={selectedProject}
        projectRoot={projectRoot}
        messageApi={messageApi}
        getProjectPath={getProjectPath}
        onClose={() => setProjectManagerOpen(false)}
        onReloadProjects={loadProjects}
        onChooseProjectRoot={handleChooseProjectRoot}
        onSwitchProject={handleSwitchProject}
        onOpenProjectDir={handleOpenProjectDir}
        onDeleteProject={handleOpenDeleteModal}
      />

      <Modal
        title={`删除项目${deleteProjectName ? ` "${deleteProjectName}"` : ""}`}
        open={!!deleteProjectName}
        centered
        width={560}
        mask={{ closable: false }}
        closable={!deleteLoading}
        keyboard={!deleteLoading}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: deleteSummaryLoading || !deleteSummary }}
        confirmLoading={deleteLoading}
        onOk={handleDeleteProject}
        onCancel={handleCloseDeleteModal}
      >
        <Alert
          type="error"
          showIcon
          message="此操作不可恢复"
          description="将永久删除项目目录、点表、设备树、标定关联和厂站绑定。"
        />
        <div style={{ marginTop: 16, color: "#595959" }}>
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: "#8c8c8c" }}>项目目录：</span>
            <Tooltip title={deleteProjectName ? getProjectPath(deleteProjectName) : ""}>
              <span style={{ wordBreak: "break-all" }}>{deleteProjectName ? getProjectPath(deleteProjectName) : ""}</span>
            </Tooltip>
          </div>
          {deleteSummaryLoading ? (
            <div style={{ color: "#8c8c8c" }}>正在统计数据库关联数据...</div>
          ) : deleteSummaryError ? (
            <Alert
              type="warning"
              showIcon
              message="关联数据统计失败"
              description={(
                <div>
                  <div>{deleteSummaryError}</div>
                  <Button type="link" size="small" onClick={() => deleteProjectName && loadDeleteSummary(deleteProjectName)} style={{ padding: 0, marginTop: 4 }}>重新统计</Button>
                </div>
              )}
            />
          ) : deleteSummary ? (
            <>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>数据库关联记录：{deleteSummary.total} 条</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px 16px", color: "#595959" }}>
                <span>点位：{deleteSummary.points}</span>
                <span>部件：{deleteSummary.components}</span>
                <span>主设备：{deleteSummary.mainDevices}</span>
                <span>间隔：{deleteSummary.bays}</span>
                <span>电压区：{deleteSummary.voltages}</span>
                <span>厂站绑定：{deleteSummary.stationBindings}</span>
              </div>
            </>
          ) : null}
        </div>
      </Modal>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
