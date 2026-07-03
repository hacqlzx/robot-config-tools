import { useEffect, useState } from "react";
import { Modal, Form, Input, Select, Upload, Button, App, Tabs } from "antd";
import { InboxOutlined } from "@ant-design/icons";

const { Dragger } = Upload;

interface SurveyImageLoadProps {
  open: boolean;
  onClose: () => void;
  onImport: (mapName: string) => void;
  onTaskImport?: (taskDir: string) => void;
}

export default function SurveyImageLoad({ open, onClose, onImport, onTaskImport }: SurveyImageLoadProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
  const [taskOptions, setTaskOptions] = useState<{ label: string; value: string }[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [taskTab, setTaskTab] = useState<"import" | "existing">("import");
  const currentProject = localStorage.getItem("selectedProject") || "—";

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI?.project;
    if (!api || !currentProject || currentProject === "—") {
      setMapOptions([]);
      setTaskOptions([]);
      return;
    }
    (async () => {
      try {
        const tree = await api.listTree(currentProject, "地图");
        setMapOptions(tree.filter((n) => n.isDir).map((d) => ({ label: d.name, value: d.name })));
      } catch { setMapOptions([]); }
      try {
        const tree = await api.listTree(currentProject, "勘察图");
        setTaskOptions(tree.filter((n) => n.isDir).map((d) => ({
          label: d.name,
          value: d.path,
        })));
      } catch { setTaskOptions([]); }
    })();
  }, [open, currentProject]);

  const handleZipFile = (file: File) => {
    console.log("[SurveyImageLoad] ZIP选择:", file.name, file.size);
    setZipFile(file);
    return false;
  };

  const handleImport = async () => {
    const hasMap = form.getFieldValue("map");
    const hasTask = form.getFieldValue("task");

    // 加载地图
    if (hasMap) onImport(hasMap);

    // 加载已有任务 — hasTask 已是从 listTree 返回的绝对路径
    if (hasTask && onTaskImport) {
      onTaskImport(hasTask);
    }

    // 导入新任务（解压 ZIP）
    if (zipFile && onTaskImport && taskTab === "import") {
      setExtracting(true);
      try {
        const api = window.electronAPI!;
        const filePath = (api as any).getFilePath?.(zipFile) || "";
        if (!filePath) { message.error("无法获取文件路径"); return; }
        const projectName = localStorage.getItem("selectedProject") || "default";
        const projectRoot = await api.getProjectRoot();
        const taskName = zipFile.name.replace(/\.(zip|rar|7z)$/i, "");
        const destDir = `${projectRoot}\\${projectName}\\勘察图\\${taskName}`;
        const result = await api.extractZip(filePath, destDir);
        if (!result.success) { message.error("解压失败: " + (result.error || "未知错误")); return; }
        onTaskImport(result.actualDir || destDir);
      } finally { setExtracting(false); }
    }

    if (!hasMap && !hasTask && !(zipFile && taskTab === "import")) {
      message.warning("请选择地图、已有任务或上传压缩包");
      return;
    }
    onClose();
  };

  return (
    <Modal title="勘察图像加载" open={open} onCancel={onClose} footer={null} destroyOnClose centered confirmLoading={extracting}>
      <Form form={form} layout="vertical">
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
            <Input value={currentProject} disabled />
          </Form.Item>
          <Form.Item name="map" label="选择地图" style={{ flex: 1, marginBottom: 24 }}>
            <Select placeholder="请选择地图" allowClear options={mapOptions} />
          </Form.Item>
        </div>

        <Form.Item name="task" label="选择已有项目" style={{ marginBottom: 12 }}>
          <Select placeholder="选择已导入的勘察项目" allowClear showSearch optionFilterProp="label" options={taskOptions} />
        </Form.Item>

        <Tabs
          activeKey={taskTab}
          onChange={(k) => setTaskTab(k as "import" | "existing")}
          size="small"
          items={[
            {
              key: "import",
              label: "导入新项目",
              children: (
                <Dragger
                  name="file" multiple={false} accept=".zip,.rar,.7z"
                  beforeUpload={handleZipFile}
                  fileList={zipFile ? [{ uid: "-1", name: zipFile.name, status: "done" as const }] : []}
                  onRemove={() => setZipFile(null)}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p className="ant-upload-text">点击或拖拽项目压缩包到此区域</p>
                  <p className="ant-upload-hint">支持 .zip / .rar / .7z</p>
                </Dragger>
              ),
            },
          ]}
        />
      </Form>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={handleImport} loading={extracting}>加载</Button>
      </div>
    </Modal>
  );
}
