import { useState } from "react";
import { Modal, Divider, Progress, Button, App } from "antd";
import { FolderOutlined } from "@ant-design/icons";
import { MAP_DIR_NAME } from "../utils/space-paths";
import { useSelectedProject } from "@/stores/appContextStore";

interface Props {
  open: boolean;
  onClose: () => void;
  modelPath: string;
}

function mapNameFromModelPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

export default function ExportModal({ open, onClose, modelPath }: Props) {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const projectName = selectedProject || "";
  const [exporting, setExporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressStep, setProgressStep] = useState("");
  const mapName = mapNameFromModelPath(modelPath);

  const handleDownload = async () => {
    const api = window.electronAPI;
    if (!api) return;
    if (!mapName) {
      message.warning("请先在左侧地图树加载一个模型");
      return;
    }
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

    const items = [{ type: MAP_DIR_NAME, name: mapName }];

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

  const showProgress = exporting;
  const canExport = !!projectName && !!mapName;

  return (
    <Modal
      title="导出模型"
      open={open}
      onCancel={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose} disabled={exporting}>取消</Button>
          <Button type="primary" disabled={!canExport || exporting} loading={exporting} onClick={handleDownload}>下载</Button>
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
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>导出内容</div>
        {showProgress ? (
          <div style={{ padding: "24px 0" }}>
            <Progress percent={progressPct} status="active" strokeColor="#1677ff" />
            <div style={{ color: "#666", fontSize: 13, marginTop: 8, textAlign: "center" }}>{progressStep}</div>
          </div>
        ) : !canExport ? (
          <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>请先在左侧地图树加载一个模型</div>
        ) : (
          <div style={{
            border: "1px solid #f0f0f0",
            borderRadius: 6,
            overflow: "hidden",
            width: "100%",
          }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                background: "#fafafa",
                width: "100%",
                gap: 8,
              }}
            >
              <FolderOutlined style={{ color: "#faad14", fontSize: 20 }} />
              <div>
                <div style={{ fontSize: 13 }}>{mapName}</div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 1 }}>
                  导出当前左侧树已加载模型、地图区域/路径文件，以及点表 Excel 和 extend.json
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
