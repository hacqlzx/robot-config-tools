import { useCallback, useEffect, useState } from "react";
import { Modal, Form, Input, Select, Button, App, Alert } from "antd";
import { useSelectedProject } from "@/stores/appContextStore";

interface SurveyImageExportProps {
  open: boolean;
  onClose: () => void;
}

const SURVEY_DIR_NAME = "勘察数据";

export default function SurveyImageExport({ open, onClose }: SurveyImageExportProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
  const [surveyDataPath, setSurveyDataPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const currentProject = useSelectedProject();
  const selectedMap = Form.useWatch("map", form) as string | undefined;

  const resetModalState = useCallback(() => {
    form.resetFields();
    setSurveyDataPath("");
  }, [form]);

  const handleClose = useCallback(() => {
    if (exporting) return;
    resetModalState();
    onClose();
  }, [exporting, onClose, resetModalState]);

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }

    const api = window.electronAPI?.project;
    if (!api || !currentProject) {
      setMapOptions([]);
      setSurveyDataPath("");
      return;
    }

    setLoading(true);
    api.listTree(currentProject, "地图")
      .then((tree) => {
        setMapOptions(tree.filter((node) => node.isDir).map((node) => ({ label: node.name, value: node.name })));
      })
      .catch(() => setMapOptions([]))
      .finally(() => setLoading(false));
  }, [currentProject, open, resetModalState]);

  useEffect(() => {
    if (!open || !selectedMap || !currentProject || !window.electronAPI) {
      setSurveyDataPath("");
      return;
    }

    window.electronAPI.getProjectRoot()
      .then((root) => setSurveyDataPath(`${root}\\${currentProject}\\${SURVEY_DIR_NAME}\\${selectedMap}`))
      .catch(() => setSurveyDataPath(""));
  }, [currentProject, open, selectedMap]);

  const handleExport = async () => {
    if (!currentProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!selectedMap) {
      message.warning("请先选择地图");
      return;
    }

    const exportDir = await window.electronAPI?.selectDir?.();
    if (!exportDir) {
      return;
    }

    setExporting(true);
    try {
      const result = await window.electronAPI?.exportSurveyData?.(currentProject, selectedMap, exportDir);
      if (!result?.success) {
        message.error(`导出失败: ${result?.error || "未知错误"}`);
        return;
      }
      message.success(`导出成功: ${result.zipName}`);
      resetModalState();
      onClose();
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title="勘察图像导出"
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      confirmLoading={exporting}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={handleClose} disabled={exporting}>取消</Button>
          <Button type="primary" onClick={handleExport} loading={exporting} disabled={!selectedMap}>
            导出
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
            <Input value={currentProject || "未选择"} disabled />
          </Form.Item>
          <Form.Item name="map" label="选择地图" style={{ flex: 1, marginBottom: 24 }}>
            <Select placeholder="请选择地图" allowClear loading={loading} options={mapOptions} />
          </Form.Item>
        </div>
      </Form>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>勘察数据路径</div>
        <Input value={surveyDataPath} disabled placeholder="暂无可导出的勘察数据路径" />
      </div>

      <Alert
        type={selectedMap ? "info" : "warning"}
        showIcon
        message={selectedMap ? "点击导出后选择压缩包保存目录；图像标识/标定数据不在此处导出" : "请选择需要导出的地图"}
      />
    </Modal>
  );
}
