import { useState } from "react";
import { Modal, Divider, Button, App } from "antd";
import { FolderOutlined } from "@ant-design/icons";
import { createLocalExportTask } from "@/components/download-task/task-actions";
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
  const mapName = mapNameFromModelPath(modelPath);

  const handleDownload = async (triggerElement?: HTMLElement) => {
    if (!mapName) {
      message.warning("请先在左侧地图树加载一个模型");
      return;
    }

    setExporting(true);
    try {
      const result = await createLocalExportTask({
        name: "空间模型导出",
        operation: "project-export-zip",
        destTitle: "选择空间模型保存目录",
        payload: {
          projectName,
          items: [{ type: MAP_DIR_NAME, name: mapName }],
        },
        triggerElement,
      });
      if (!result.success) {
        message.warning(result.error || "创建导出任务失败");
        return;
      }
      if (!result.cancelled) {
        onClose();
      }
    } catch (e: any) {
      message.error(e?.message || "创建导出任务失败");
    } finally {
      setExporting(false);
    }
  };

  const canExport = !!projectName && !!mapName;

  return (
    <Modal
      title="导出模型"
      open={open}
      onCancel={onClose}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={onClose} disabled={exporting}>取消</Button>
            <Button type="primary" disabled={!canExport || exporting} loading={exporting} onClick={(event) => handleDownload(event.currentTarget)}>下载</Button>
          </div>
        }
      centered
      width={520}
      destroyOnHidden
      styles={{ body: { overflowX: "hidden" } }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 4 }}>
          <FolderOutlined style={{ color: "#faad14", marginRight: 6, fontSize: 20 }} />
          当前项目
        </div>
        <div
          title={projectName}
          style={{
            fontSize: 14,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {projectName}
        </div>
      </div>
      <Divider style={{ margin: "12px 0" }} />
      <div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>导出内容</div>
        {!canExport ? (
          <div style={{ color: "#999", fontSize: 12, padding: "8px 0" }}>请先在左侧地图树加载一个模型</div>
        ) : (
          <div style={{
            border: "1px solid #f0f0f0",
            borderRadius: 6,
            overflow: "hidden",
            width: "100%",
            boxSizing: "border-box",
          }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                background: "#fafafa",
                width: "100%",
                boxSizing: "border-box",
                gap: 8,
              }}
            >
              <FolderOutlined style={{ color: "#faad14", fontSize: 20, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  title={mapName}
                  style={{
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {mapName}
                </div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 1, lineHeight: 1.5, whiteSpace: "normal" }}>
                  导出当前左侧树已加载模型、地图区域/路径文件，以及点表 Excel 和 cabinet.json
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
