import { useState, useEffect, type ReactNode } from "react";
import { Modal, Checkbox, Divider, Progress, Button, Spin, App } from "antd";
import { FolderOutlined, FileExcelOutlined } from "@ant-design/icons";
import { MAP_DIR_NAME, POINT_TABLE_DIR_NAME, POINT_TABLE_FILE_RE } from "../utils/space-paths";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FileItem {
  label: string;
  key: string;
  icon: ReactNode;
  desc?: string;
}

export default function ExportModal({ open, onClose }: Props) {
  const { message } = App.useApp();
  const projectName = localStorage.getItem("selectedProject") || "未选择";
  const [files, setFiles] = useState<FileItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStep, setProgressStep] = useState("");

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI;
    if (!api || !projectName) {
      setFiles([]);
      setChecked(new Set());
      return;
    }
    setLoading(true);
    const loadFiles = async () => {
      const items: FileItem[] = [];

      // 点表
      try {
        const ptFiles = await api.project.listTree(projectName, POINT_TABLE_DIR_NAME);
        if (ptFiles.some((f: any) => !f.isDir && POINT_TABLE_FILE_RE.test(f.name))) {
          items.push({ label: POINT_TABLE_DIR_NAME, key: POINT_TABLE_DIR_NAME, icon: <FileExcelOutlined style={{ color: "#52c41a", fontSize: 20 }} />, desc: "下发设备台账点表及巡检点位信息" });
        }
      } catch {}

      // 地图模型目录
      try {
        const mapFiles = await api.project.listTree(projectName, MAP_DIR_NAME);
        for (const node of mapFiles) {
          if (node.isDir) {
            items.push({ label: node.name, key: node.name, icon: <FolderOutlined style={{ color: "#faad14", fontSize: 20 }} />, desc: "包含点云模型及导航配置" });
          }
        }
      } catch {}

      setFiles(items);
      setChecked(new Set());
      setLoading(false);
    };
    loadFiles();
  }, [open]);

  const toggleAll = (val: boolean) => {
    setChecked(val ? new Set(files.map((f) => f.key)) : new Set());
  };

  const allChecked = files.length > 0 && checked.size === files.length;

  const handleDownload = async () => {
    if (checked.size === 0) return;
    const api = window.electronAPI;
    if (!api) return;
    const dir = await api.selectDir();
    if (!dir) return;

    setExporting(true);
    setProgressPct(0);
    setProgressStep("准备导出...");

    // 监听进度
    const unsub = api.onExportProgress(({ step, pct }) => {
      setProgressPct(pct);
      setProgressStep(step);
    });

    const items = files
      .filter((f) => checked.has(f.key))
      .map((f) => ({ type: f.key === POINT_TABLE_DIR_NAME ? POINT_TABLE_DIR_NAME : MAP_DIR_NAME, name: f.key === POINT_TABLE_DIR_NAME ? POINT_TABLE_DIR_NAME : f.label }));

    try {
      const result = await api.exportZip(projectName, items, dir);
      message.success(`导出成功: ${result.zipName}.zip`);
      onClose();
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      unsub();
      setExporting(false);
    }
  };

  const isEmpty = !loading && files.length === 0;
  const showProgress = exporting;

  return (
    <Modal
      title="导出模型"
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose} disabled={exporting}>取消</Button>
          <Button type="primary" disabled={checked.size === 0 || exporting} loading={exporting} onClick={handleDownload}>下载</Button>
        </div>
      }
      centered
      width={520}
      destroyOnHidden
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
          <FolderOutlined style={{ color: "#faad14", marginRight: 6, fontSize: 20 }} />
          当前项目
        </div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{projectName}</div>
      </div>
      <Divider style={{ margin: "12px 0" }} />
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {files.length > 0 && (
            <Checkbox
              checked={allChecked}
              indeterminate={checked.size > 0 && !allChecked}
              onChange={(e) => toggleAll(e.target.checked)}
            />
          )}
          <span style={{ fontSize: 13, color: "#666" }}>
            下载文件{files.length > 0 ? ` (${checked.size}/${files.length})` : ""}
          </span>
        </div>
        {showProgress ? (
          <div style={{ padding: "24px 0" }}>
            <Progress percent={progressPct} status="active" strokeColor="#1677ff" />
            <div style={{ color: "#666", fontSize: 13, marginTop: 8, textAlign: "center" }}>{progressStep}</div>
          </div>
        ) : loading ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <Spin size="small" />
            <div style={{ color: "#999", fontSize: 12, marginTop: 8 }}>加载文件列表...</div>
          </div>
        ) : isEmpty ? (
          <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>暂无文件</div>
        ) : (
          <Checkbox.Group
            value={[...checked]}
            onChange={(vals) => setChecked(new Set(vals as string[]))}
            style={{ width: "100%" }}
          >
            <div style={{
              border: "1px solid #f0f0f0",
              borderRadius: 6,
              overflow: "hidden",
              width: "100%",
            }}>
              {files.map((f, i) => (
                <div
                  key={f.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom: i < files.length - 1 ? "1px solid #f0f0f0" : "none",
                    background: "#fafafa",
                    width: "100%",
                  }}
                >
                  <Checkbox value={f.key} />
                  <span style={{ marginLeft: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    {f.icon}
                    <div>
                      <div style={{ fontSize: 13 }}>{f.label}</div>
                      {f.desc && <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>{f.desc}</div>}
                    </div>
                  </span>
                </div>
              ))}
            </div>
          </Checkbox.Group>
        )}
      </div>
    </Modal>
  );
}
