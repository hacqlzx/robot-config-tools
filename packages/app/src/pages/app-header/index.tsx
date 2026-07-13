import { useState, useEffect, useCallback } from "react";
import { Menu, Button, Select, Dropdown, Modal, Input, Alert, message, Tooltip } from "antd";
import { MinusOutlined, BorderOutlined, CloseOutlined, SettingOutlined, ProjectOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, FolderOpenOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { menuConfig } from "@/config/menu";
import BackendModal from "@/pages/backend-modal";
import {
  getSelectedProject,
  getSelectedRobot,
  setConnectionStatus,
  setSelectedProject,
  setSelectedRobot,
  useAppContext,
} from "@/stores/appContextStore";
import { getAllRobot } from "@/api/config.js";
import { MESSAGE_TOP_OFFSET } from "@/App";

const menuItems: MenuProps["items"] = menuConfig.map((item) => ({ key: item.key, label: item.label }));

function joinProjectPath(root: string, projectName: string): string {
  if (!root || !projectName) return root || "";
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const separator = root.includes("\\") ? "\\" : "/";
  return `${trimmedRoot}${separator}${projectName}`;
}

const CACHED_ROBOT_LIST_KEY = "cachedRobotList";

function getCachedRobotList(): { label: string; value: string }[] | null {
  try {
    const raw = localStorage.getItem(CACHED_ROBOT_LIST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedRobotList(list: { label: string; value: string }[]) {
  try {
    localStorage.setItem(CACHED_ROBOT_LIST_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
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
  const [backendOpen, setBackendOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [projectRoot, setProjectRoot] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [deleteProjectName, setDeleteProjectName] = useState<string | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<ProjectDataCounts | null>(null);
  const [deleteSummaryLoading, setDeleteSummaryLoading] = useState(false);
  const [deleteSummaryError, setDeleteSummaryError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [robotOptions, setRobotOptions] = useState<{ label: string; value: string }[]>([]);
  const [messageApi, contextHolder] = message.useMessage({ top: MESSAGE_TOP_OFFSET });

  const loadRobotList = useCallback(async () => {
    try {
      const res = await getAllRobot();
      const body = res.data;
      if (body.success && body.data) {
        const list = body.data.map((r: any) => ({ label: r.robotName, value: r.robotName }));
        setRobotOptions(list);
        setCachedRobotList(list);
        const currentRobot = getSelectedRobot();
        if (currentRobot && !list.some((item: { value: string }) => item.value === currentRobot)) {
          setSelectedRobot(null);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // 连接成功后刷新机器人列表。
  useEffect(() => {
    if (backendIpVersion > 0) setRobotOptions([]);
    if (connStatus === "connected") loadRobotList();
  }, [backendIpVersion, connStatus, loadRobotList]);

  // 初始化先显示缓存；自动连接成功后再拉取当前后台的列表。
  useEffect(() => {
    const cached = getCachedRobotList();
    if (cached) {
      setRobotOptions(cached);
    }
  }, []);
  // 启动时自动检查已保存后台。
  useEffect(() => {
    if (!backendIp || !window.electronAPI?.ping) return;
    window.electronAPI.ping(backendIp).then((ok: boolean) => {
      setConnectionStatus(ok ? "connected" : "failed");
    });
  }, [backendIp]);

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

  useEffect(() => {
    if (editProjectOpen) {
      loadProjects();
    }
  }, [editProjectOpen, loadProjects]);

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    if (!window.electronAPI?.project) {
      messageApi.warning("仅 Electron 环境支持项目管理");
      return;
    }
    try {
      const createdName = await window.electronAPI.project.create(projectName.trim());
      setSelectedProject(createdName);
      messageApi.success(`项目 "${createdName}" 创建成功，已切换到该项目`);
      setProjectName("");
      setAddProjectOpen(false);
      await loadProjects();
    } catch (e: any) {
      messageApi.error(e?.message || "创建项目失败");
    }
  };

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

  const handleStartRename = (name: string) => {
    setEditingName(name);
    setEditingValue(name);
  };

  const handleCancelRename = () => {
    setEditingName(null);
    setEditingValue("");
  };

  const handleConfirmRename = async () => {
    if (!editingName || !editingValue.trim() || editingValue.trim() === editingName) {
      handleCancelRename();
      return;
    }
    if (!window.electronAPI?.project) return;
    try {
      const newName = editingValue.trim();
      await window.electronAPI.project.rename(editingName, newName);
      messageApi.success(`已重命名为 "${newName}"`);
      if (selectedProject === editingName) {
        setSelectedProject(newName);
      }
      setEditingName(null);
      setEditingValue("");
      loadProjects();
    } catch (e: any) {
      messageApi.error(e?.message || "重命名失败");
    }
  };

  const settingMenu: MenuProps["items"] = [
    {
      key: "backend",
      label: "连接后台",
      onClick: () => setBackendOpen(true),
    },
  ];

  const projectMenu: MenuProps["items"] = [
    {
      key: "add-project",
      icon: <PlusOutlined />,
      label: "新增项目",
      onClick: () => {
        loadProjectRoot();
        setAddProjectOpen(true);
      },
    },
    {
      key: "edit-project",
      icon: <EditOutlined />,
      label: "编辑项目",
      onClick: () => {
        loadProjects();
        setEditProjectOpen(true);
      },
    },
  ];

  const trimmedProjectName = projectName.trim();
  const addProjectPath = trimmedProjectName ? getProjectPath(trimmedProjectName) : "";

  return (
    <div className="app-header" style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
      {contextHolder}
      <Menu mode="horizontal" selectedKeys={[location.hash.slice(1) || location.pathname]} items={menuItems} className="app-header__menu" style={{ width: "auto" }} onClick={({ key }) => navigate(key)} />
      <div className="app-header__toolbar">
        <Dropdown menu={{ items: projectMenu }} trigger={["hover"]}>
          <Button type="text" size="small" icon={<ProjectOutlined />} />
        </Dropdown>
        <Select placeholder="选择项目" style={{ width: 160 }} size="small" value={selectedProject} onChange={(v) => { setSelectedProject(v); }} allowClear options={projects.map((p) => ({ label: p, value: p }))} />
        <Select placeholder="选择机器人" style={{ width: 120 }} size="small" value={selectedRobot} onChange={(v) => { setSelectedRobot(v ?? null); }} allowClear options={robotOptions} />
        <Dropdown menu={{ items: settingMenu }} trigger={["hover"]}>
          <div style={{ position: "relative", display: "inline-flex" }}>
            <Button type="text" size="small" icon={<SettingOutlined />} />
            <span style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: connStatus === "connected" ? "#52c41a" : connStatus === "failed" ? "#ff4d4f" : "#bfbfbf",
            }} />
          </div>
        </Dropdown>
        <div className="app-header__controls">
          <Button type="text" size="small" icon={<MinusOutlined />} onClick={() => window.electronAPI?.minimize()} />
          <Button type="text" size="small" icon={<BorderOutlined />} onClick={() => window.electronAPI?.maximize()} />
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => window.electronAPI?.close()} />
        </div>
      </div>

      {/* 新增项目弹窗 */}
      <Modal
        title="新增项目"
        open={addProjectOpen}
        centered
        mask={{ closable: false }}
        okText="确定"
        cancelText="取消"
        onOk={handleCreateProject}
        onCancel={() => {
          setProjectName("");
          setAddProjectOpen(false);
        }}
        afterClose={() => setProjectName("")}
      >
        <Input
          placeholder="请输入项目名称"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          onPressEnter={handleCreateProject}
          autoFocus
        />
        <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>保存目录：</span>
            <Tooltip title={projectRoot || "未获取到保存目录"}>
              <span style={{ minWidth: 0, flex: 1, color: projectRoot ? "#1677ff" : "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectRoot || "未获取到保存目录"}</span>
            </Tooltip>
            <Button size="small" type="link" onClick={handleChooseProjectRoot} style={{ padding: 0 }}>选择目录</Button>
          </div>
          <div>
            项目路径：
            <Tooltip title={addProjectPath || "输入项目名称后显示完整路径"}>
              <span style={{ color: addProjectPath ? "#1677ff" : "#999" }}>{addProjectPath || "输入项目名称后显示完整路径"}</span>
            </Tooltip>
          </div>
        </div>
      </Modal>

      {/* 编辑项目弹窗 */}
      <Modal
        title="编辑项目"
        open={editProjectOpen}
        centered
        width={760}
        mask={{ closable: false }}
        footer={null}
        onCancel={() => {
          setEditProjectOpen(false);
          setEditingName(null);
        }}
      >
        {projects.length === 0 ? (
          <div style={{ textAlign: "center", color: "#999", padding: 24 }}>暂无项目</div>
        ) : (
          projects.map((item) => {
            const displayName = editingName === item ? editingValue.trim() || item : item;
            const projectPath = getProjectPath(displayName);
            return (
            <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
              {editingName === item ? (
                <Input
                  size="small"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onPressEnter={handleConfirmRename}
                  autoFocus
                  style={{ width: 220 }}
                />
              ) : (
                <span style={{ fontWeight: selectedProject === item ? 500 : 400 }}>{item}</span>
              )}
                <Tooltip title={projectPath}>
                  <div style={{ marginTop: 2, color: "#8c8c8c", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {projectPath || "项目路径不可用"}
                  </div>
                </Tooltip>
              </div>
              <div style={{ display: "flex", gap: 0, flexShrink: 0 }}>
                {editingName === item ? (
                  <>
                    <Button type="link" size="small" onClick={handleConfirmRename}>确认</Button>
                    <Button type="link" size="small" onClick={handleCancelRename}>取消</Button>
                  </>
                ) : (
                  <>
                    {selectedProject === item ? (
                      <Button type="link" size="small" icon={<CheckOutlined />} disabled>当前项目</Button>
                    ) : (
                      <Button type="link" size="small" onClick={() => handleSwitchProject(item)}>切换</Button>
                    )}
                    <Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => handleOpenProjectDir(item)}>打开目录</Button>
                    <Button type="link" size="small" onClick={() => handleStartRename(item)}>重命名</Button>
                    {selectedProject !== item ? (
                      <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleOpenDeleteModal(item)}>删除</Button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            );
          })
        )}
      </Modal>

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

      <BackendModal open={backendOpen} onClose={() => setBackendOpen(false)} />
    </div>
  );
}
