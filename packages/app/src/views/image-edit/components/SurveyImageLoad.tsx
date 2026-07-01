import { useEffect, useState } from "react";
import { Modal, Form, Input, Select, Upload, Button, App } from "antd";
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
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const currentProject = localStorage.getItem("selectedProject") || "—";

  useEffect(() => {
    if (!open) return;
    const loadMaps = async () => {
      if (!currentProject || currentProject === "—" || !window.electronAPI?.project) {
        setMapOptions([]);
        return;
      }
      try {
        const tree = await window.electronAPI.project.listTree(currentProject, "地图");
        const dirs = tree.filter((n) => n.isDir);
        setMapOptions(dirs.map((d) => ({ label: d.name, value: d.name })));
      } catch {
        setMapOptions([]);
      }
    };
    loadMaps();
  }, [open, currentProject]);

  const handleZipFile = (file: File) => {
    console.log("[SurveyImageLoad] ZIP选择:", file.name, file.size);
    setZipFile(file);
    return false;
  };

  const handleImport = async () => {
    console.log("[SurveyImageLoad] handleImport, zipFile:", zipFile?.name, "hasMap:", form.getFieldValue("map"));
    try {
      // 如果选了地图，走地图加载
      const hasMap = form.getFieldValue("map");
      if (hasMap) {
        onImport(hasMap);
        onClose();
        return;
      }
      // 如果上传了 ZIP，解压后走任务加载
      if (zipFile && onTaskImport) {
        setExtracting(true);
        try {
          const api = window.electronAPI!;
          const filePath = (api as any).getFilePath?.(zipFile) || "";
          if (!filePath) {
            message.error("无法获取文件路径");
            return;
          }
          const taskName = zipFile.name.replace(/\.(zip|rar|7z)$/i, "");
          // 获取文件真实路径并解压到同级目录
          const dir = filePath.substring(0, filePath.lastIndexOf("\\"));
          const destDir = `${dir}\\${taskName}`;
          const result = await api.extractZip(filePath, destDir);
          if (!result.success) {
            message.error("解压失败: " + (result.error || "未知错误"));
            return;
          }
          onTaskImport(destDir);
          onClose();
        } finally {
          setExtracting(false);
        }
        return;
      }
      message.warning("请选择地图或上传任务压缩包");
    } catch {
      // 校验未通过
    }
  };

  return (
    <Modal
      title="勘察图像加载"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      confirmLoading={extracting}
    >
      <Form form={form} layout="vertical">
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
            <Input value={currentProject} disabled />
          </Form.Item>
          <Form.Item name="map" label="选择地图" style={{ flex: 1, marginBottom: 24 }}>
            <Select placeholder="请选择地图" allowClear options={mapOptions} />
          </Form.Item>
        </div>
        <Dragger
          name="file"
          multiple={false}
          accept=".zip,.rar,.7z"
          beforeUpload={handleZipFile}
          fileList={zipFile ? [{ uid: "-1", name: zipFile.name, status: "done" as const }] : []}
          onRemove={() => setZipFile(null)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽任务压缩包到此区域</p>
          <p className="ant-upload-hint">支持 .zip / .rar / .7z</p>
        </Dragger>
      </Form>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={handleImport} loading={extracting}>
          导入
        </Button>
      </div>
    </Modal>
  );
}
