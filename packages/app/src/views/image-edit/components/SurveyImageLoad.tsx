import { useEffect, useState } from "react";
import { Modal, Form, Input, Select, Upload, Button } from "antd";
import { InboxOutlined } from "@ant-design/icons";

const { Dragger } = Upload;

interface SurveyImageLoadProps {
  open: boolean;
  onClose: () => void;
  onImport: (mapName: string) => void;
}

export default function SurveyImageLoad({ open, onClose, onImport }: SurveyImageLoadProps) {
  const [form] = Form.useForm();
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
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

  const handleImport = async () => {
    try {
      const values = await form.validateFields();
      onImport(values.map);
      onClose();
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
    >
      <Form form={form} layout="vertical">
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
            <Input value={currentProject} disabled />
          </Form.Item>
          <Form.Item name="map" label="选择地图" rules={[{ required: true, message: "请选择地图" }]} style={{ flex: 1, marginBottom: 24 }}>
            <Select placeholder="请选择地图" allowClear options={mapOptions} />
          </Form.Item>
        </div>
        <Dragger
          name="file"
          multiple={false}
          accept=".zip,.rar,.7z"
          beforeUpload={() => false}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽压缩包到此区域上传</p>
          <p className="ant-upload-hint">支持 .zip / .rar / .7z</p>
        </Dragger>
      </Form>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={handleImport}>
          导入
        </Button>
      </div>
    </Modal>
  );
}
