import { useState, useEffect, useCallback } from "react";
import { Menu, Button, Select, Dropdown, Modal, Input, Popconfirm, message } from "antd";
import { MinusOutlined, BorderOutlined, CloseOutlined, SettingOutlined, ProjectOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined } from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import { menuConfig } from "@/config/menu";
import BackendModal from "@/pages/backend-modal";
import { getConnectionStatus, subscribe, ConnectionStatus, getCurrentIp } from "@/stores/backendStore";

const menuItems: MenuProps["items"] = menuConfig.map((item) => ({ key: item.key, label: item.label }));

const SELECTED_PROJECT_KEY = "selectedProject";

function getStoredProject(): string | null {
  try {
    return localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

function setStoredProject(name: string | null) {
  try {
    if (name) {
      localStorage.setItem(SELECTED_PROJECT_KEY, name);
    } else {
      localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  } catch {
    // ignore
  }
}

export default function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [backendOpen, setBackendOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [editProjectOpen, setEditProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(getStoredProject);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(getConnectionStatus);
  const [messageApi, contextHolder] = message.useMessage();

  // 同步 selectedProject 到 localStorage
  useEffect(() => {
    setStoredProject(selectedProject);
  }, [selectedProject]);

  useEffect(() => {
    return subscribe(() => setConnStatus(getConnectionStatus()));
  }, []);



  // ?????????????????

  // ?????????? IP????????????
  useEffect(() => {
    console.log("[app-header] mount, checking saved IP...");
    console.log("[app-header] window.electronAPI exists:", !!window.electronAPI);
    console.log("[app-header] window.electronAPI?.ping exists:", !!window.electronAPI?.ping);
    const lastIp = getCurrentIp();
    console.log("[app-header] lastIp:", lastIp || "(none)");
    if (!lastIp || !window.electronAPI?.ping) {
      console.log("[app-header] skip auto-connect: no IP or no ping API");
      return;
    }

    console.log("[app-header] pinging", lastIp, "...");
    window.electronAPI.ping(lastIp).then(async (ok: boolean) => {
      console.log("[app-header] ping result:", ok);
      if (ok) {
        setConnStatus("connected");
      } else {
        setConnStatus("failed");
      }
    });
  }, []);

  const loadProjects = useCallback(async () => {
    if (!window.electronAPI?.project) return;
    try {
      const list = await window.electronAPI.project.list();
      setProjects(list);
    } catch {
      messageApi.error("加载项目列表失败");
    }
  }, [messageApi]);

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
      await window.electronAPI.project.create(projectName.trim());
      messageApi.success(`项目 "${projectName.trim()}" 创建成功`);
      setProjectName("");
      setAddProjectOpen(false);
      await loadProjects();
    } catch (e: any) {
      messageApi.error(e?.message || "创建项目失败");
    }
  };

  const handleDeleteProject = async (name: string) => {
    if (!window.electronAPI?.project) return;
    try {
      await window.electronAPI.project.delete(name);
      messageApi.success(`项目 "${name}" 已删除`);
      if (selectedProject === name) {
        setSelectedProject(null);
      }
      loadProjects();
    } catch (e: any) {
      messageApi.error(e?.message || "删除项目失败");
    }
  };

  const handleSwitchProject = (name: string) => {
    setSelectedProject(name);
    messageApi.success(`已切换到项目 "${name}"`);
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
      onClick: () => setAddProjectOpen(true),
    },
    {
      key: "edit-project",
      icon: <EditOutlined />,
      label: "编辑项目",
      onClick: () => setEditProjectOpen(true),
    },
  ];

  return (
    <div className="app-header" style={{ background: "#fff", borderBottom: "1px solid #f0f0f0" }}>
      {contextHolder}
      <Menu mode="horizontal" selectedKeys={[location.hash.slice(1) || location.pathname]} items={menuItems} className="app-header__menu" style={{ width: "auto" }} onClick={({ key }) => navigate(key)} />
      <div className="app-header__toolbar">
        <Dropdown menu={{ items: projectMenu }} trigger={["hover"]}>
          <Button type="text" size="small" icon={<ProjectOutlined />} />
        </Dropdown>
        <Select placeholder="选择项目" style={{ width: 160 }} size="small" value={selectedProject} onChange={(v) => { setSelectedProject(v); }} allowClear options={projects.map((p) => ({ label: p, value: p }))} />
        <Select placeholder="选择机器人" style={{ width: 120 }} size="small" options={[]} />
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
      </Modal>

      {/* 编辑项目弹窗 */}
      <Modal
        title="编辑项目"
        open={editProjectOpen}
        centered
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
          projects.map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              {editingName === item ? (
                <Input
                  size="small"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onPressEnter={handleConfirmRename}
                  autoFocus
                  style={{ width: 200 }}
                />
              ) : (
                <span>{item}</span>
              )}
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
                    <Button type="link" size="small" onClick={() => handleStartRename(item)}>重命名</Button>
                    {selectedProject !== item ? (
                      <Popconfirm
                        title={`确定删除项目 "${item}"？`}
                        description="删除后不可恢复"
                        onConfirm={() => handleDeleteProject(item)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
                      </Popconfirm>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </Modal>

      <BackendModal open={backendOpen} onClose={() => setBackendOpen(false)} />
    </div>
  );
}
