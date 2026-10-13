import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Empty, Input, Modal, Space, Tooltip } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { CheckOutlined, DeleteOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";

const INVALID_PROJECT_NAME_PATTERN = /[<>:"/\\|?*\x00-\x1F]/;

type ProjectFormMode = "detail" | "create" | "rename";
type ProjectAction = "create" | "rename" | "switch" | "openDir" | "reload" | null;

interface ProjectManagerModalProps {
  open: boolean;
  projects: string[];
  selectedProject: string | null;
  projectRoot: string;
  messageApi: MessageInstance;
  getProjectPath: (name: string) => string;
  onClose: () => void;
  onReloadProjects: () => Promise<void>;
  onSwitchProject: (name: string, skipConfirmation?: boolean) => Promise<boolean>;
  onConfirmProjectChange: (actionText: string) => Promise<boolean>;
  onOpenProjectDir: (name: string) => Promise<void>;
  onDeleteProject: (name: string) => void;
}

function normalizeProjectName(value: string): string {
  return value.trim();
}

function getProjectNameError(value: string, projects: string[], currentName?: string): string {
  const name = normalizeProjectName(value);
  if (!name) return "请输入项目名称";
  if (INVALID_PROJECT_NAME_PATTERN.test(name)) return "项目名称不能包含 \\ / : * ? \" < > | 等字符";
  const duplicated = projects.some((project) => (
    project !== currentName && project.toLocaleLowerCase() === name.toLocaleLowerCase()
  ));
  if (duplicated) return `项目 "${name}" 已存在`;
  return "";
}

export default function ProjectManagerModal({
  open,
  projects,
  selectedProject,
  projectRoot,
  messageApi,
  getProjectPath,
  onClose,
  onReloadProjects,
  onSwitchProject,
  onConfirmProjectChange,
  onOpenProjectDir,
  onDeleteProject,
}: ProjectManagerModalProps) {
  const [filterText, setFilterText] = useState("");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [mode, setMode] = useState<ProjectFormMode>("detail");
  const [formName, setFormName] = useState("");
  const [switchAfterCreate, setSwitchAfterCreate] = useState(true);
  const [action, setAction] = useState<ProjectAction>(null);

  useEffect(() => {
    if (!open) return;
    const nextProject = selectedProject && projects.includes(selectedProject)
      ? selectedProject
      : projects[0] || null;
    setActiveProject((current) => (current && projects.includes(current) ? current : nextProject));
    setMode(projects.length ? "detail" : "create");
    setFormName("");
    setFilterText("");
  }, [open, projects, selectedProject]);

  const filteredProjects = useMemo(() => {
    const keyword = filterText.trim().toLocaleLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => project.toLocaleLowerCase().includes(keyword));
  }, [filterText, projects]);

  const editingProject = mode === "rename" ? activeProject || undefined : undefined;
  const nameError = mode === "detail" ? "" : getProjectNameError(formName, projects, editingProject);
  const trimmedFormName = normalizeProjectName(formName);
  const previewProjectName = mode === "detail" ? activeProject || "" : trimmedFormName;
  const previewPath = previewProjectName ? getProjectPath(previewProjectName) : "";
  const isBusy = action !== null;
  const canSubmit = mode === "create"
    ? !nameError
    : mode === "rename" && !nameError && trimmedFormName !== activeProject;

  const startCreate = () => {
    setMode("create");
    setFormName("");
    setActiveProject(null);
    setSwitchAfterCreate(true);
  };

  const startRename = () => {
    if (!activeProject) return;
    setMode("rename");
    setFormName(activeProject);
  };

  const cancelEdit = () => {
    setMode(projects.length ? "detail" : "create");
    setFormName("");
    if (!activeProject && projects.length) setActiveProject(selectedProject && projects.includes(selectedProject) ? selectedProject : projects[0]);
  };

  const handleReload = async () => {
    setAction("reload");
    try {
      await onReloadProjects();
    } finally {
      setAction(null);
    }
  };

  const handleCreate = async () => {
    if (nameError || !window.electronAPI?.project) return;
    setAction("create");
    try {
      const createdName = await window.electronAPI.project.create(trimmedFormName);
      await onReloadProjects();
      setActiveProject(createdName);
      setMode("detail");
      setFormName("");
      if (switchAfterCreate) await onSwitchProject(createdName);
      messageApi.success(`项目 "${createdName}" 创建成功`);
    } catch (error: any) {
      messageApi.error(error?.message || "创建项目失败");
    } finally {
      setAction(null);
    }
  };

  const handleRename = async () => {
    if (!activeProject || nameError || trimmedFormName === activeProject || !window.electronAPI?.project) return;
    const oldName = activeProject;
    setAction("rename");
    try {
      if (selectedProject === oldName && !(await onConfirmProjectChange("重命名项目"))) return;
      await window.electronAPI.project.rename(oldName, trimmedFormName);
      await onReloadProjects();
      setActiveProject(trimmedFormName);
      setMode("detail");
      setFormName("");
      if (selectedProject === oldName) await onSwitchProject(trimmedFormName, true);
      messageApi.success(`已重命名为 "${trimmedFormName}"`);
    } catch (error: any) {
      messageApi.error(error?.message || "重命名失败");
    } finally {
      setAction(null);
    }
  };

  const handleSwitchProject = async (name: string) => {
    setAction("switch");
    try {
      await onSwitchProject(name);
    } finally {
      setAction(null);
    }
  };

  const handleOpenProjectDir = async (name: string) => {
    setAction("openDir");
    try {
      await onOpenProjectDir(name);
    } finally {
      setAction(null);
    }
  };

  const renderProjectList = () => (
    <div style={{ width: 240, borderRight: "1px solid #f0f0f0", paddingRight: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <Input.Search
        size="small"
        placeholder="搜索项目"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        allowClear
      />
      <div style={{ flex: 1, minHeight: 280, maxHeight: 360, overflowY: "auto", paddingRight: 4 }}>
        {filteredProjects.length ? filteredProjects.map((project) => {
          const active = activeProject === project && mode !== "create";
          return (
            <button
              key={project}
              type="button"
              onClick={() => {
                setActiveProject(project);
                setMode("detail");
                setFormName("");
              }}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 6,
                background: active ? "#e6f4ff" : "transparent",
                color: active ? "#1677ff" : "#262626",
                padding: "8px 10px",
                textAlign: "left",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project}</span>
              {selectedProject === project ? <CheckOutlined style={{ color: "#52c41a", fontSize: 12 }} /> : null}
            </button>
          );
        }) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目" style={{ marginTop: 48 }} />
        )}
      </div>
      <Button block type="primary" icon={<PlusOutlined />} onClick={startCreate}>
        新增项目
      </Button>
    </div>
  );

  const renderProjectForm = () => (
    <div style={{ flex: 1, minWidth: 0, paddingLeft: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ color: "#8c8c8c", flexShrink: 0 }}>保存目录</span>
        <Tooltip title={projectRoot || "未获取到保存目录"}>
          <span style={{ flex: 1, minWidth: 0, color: projectRoot ? "#1677ff" : "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectRoot || "未获取到保存目录"}
          </span>
        </Tooltip>
        <Button size="small" icon={<ReloadOutlined />} onClick={handleReload} loading={action === "reload"}>刷新</Button>
      </div>

      {mode === "detail" ? (
        activeProject ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: "#8c8c8c", marginBottom: 4 }}>项目名称</div>
              <div style={{ fontSize: 18, fontWeight: 500 }}>{activeProject}</div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: "#8c8c8c", marginBottom: 4 }}>项目路径</div>
              <Tooltip title={getProjectPath(activeProject)}>
                <div style={{ color: "#595959", wordBreak: "break-all" }}>{getProjectPath(activeProject) || "项目路径不可用"}</div>
              </Tooltip>
            </div>
            <Space wrap>
              {selectedProject === activeProject ? (
                <Button icon={<CheckOutlined />} disabled>当前项目</Button>
              ) : (
                <Button type="primary" onClick={() => handleSwitchProject(activeProject)} loading={action === "switch"}>设为当前项目</Button>
              )}
              <Button icon={<FolderOpenOutlined />} onClick={() => handleOpenProjectDir(activeProject)} loading={action === "openDir"}>打开目录</Button>
              <Button onClick={startRename}>重命名</Button>
              {selectedProject !== activeProject ? (
                <Button danger icon={<DeleteOutlined />} onClick={() => onDeleteProject(activeProject)}>删除</Button>
              ) : null}
            </Space>
          </>
        ) : (
          <Empty description="请选择或新增项目" style={{ marginTop: 64 }} />
        )
      ) : (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ color: "#8c8c8c", marginBottom: 6 }}>{mode === "create" ? "项目名称" : "新项目名称"}</div>
            <Input
              value={formName}
              placeholder="请输入项目名称"
              onChange={(event) => setFormName(event.target.value)}
              onPressEnter={mode === "create" ? handleCreate : handleRename}
              status={nameError ? "error" : undefined}
              autoFocus
              disabled={isBusy}
            />
            <div style={{ minHeight: 22, color: nameError ? "#ff4d4f" : "#8c8c8c", fontSize: 12, marginTop: 4 }}>
              {nameError || "名称确认后会同步生成项目目录"}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "#8c8c8c", marginBottom: 4 }}>项目路径</div>
            <Tooltip title={previewPath || "输入项目名称后显示完整路径"}>
              <div style={{ color: previewPath ? "#595959" : "#999", wordBreak: "break-all" }}>
                {previewPath || "输入项目名称后显示完整路径"}
              </div>
            </Tooltip>
          </div>
          {mode === "create" ? (
            <Checkbox checked={switchAfterCreate} onChange={(event) => setSwitchAfterCreate(event.target.checked)}>
              创建后自动切换到该项目
            </Checkbox>
          ) : null}
          {!projectRoot ? (
            <Alert type="warning" showIcon message="未获取到保存目录，请到设置中的项目存储配置" style={{ marginTop: 14 }} />
          ) : null}
          <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={cancelEdit} disabled={isBusy}>取消</Button>
            <Button
              type="primary"
              disabled={!canSubmit || !projectRoot}
              loading={action === "create" || action === "rename"}
              onClick={mode === "create" ? handleCreate : handleRename}
            >
              {mode === "create" ? "创建项目" : "保存修改"}
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <Modal
      title="项目管理"
      open={open}
      centered
      width={860}
      mask={{ closable: false }}
      footer={null}
      onCancel={onClose}
    >
      <div style={{ display: "flex", gap: 16 }}>
        {renderProjectList()}
        {renderProjectForm()}
      </div>
    </Modal>
  );
}
