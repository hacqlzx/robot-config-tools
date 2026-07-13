import { useCallback, useEffect, useState } from "react";
import { Modal, Form, Input, Select, Button, App, Alert } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { useSelectedProject } from "@/stores/appContextStore";

interface ImageLabelTransferProps {
  open: boolean;
  mode: "import" | "export";
  onClose: () => void;
  onImported?: (mapName: string) => void | Promise<void>;
}

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";

export default function ImageLabelTransfer({ open, mode, onClose, onImported }: ImageLabelTransferProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
  const [surveyDataPath, setSurveyDataPath] = useState("");
  const [calibrationPath, setCalibrationPath] = useState("");
  const [zipPath, setZipPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentProject = useSelectedProject();
  const selectedMap = Form.useWatch("map", form) as string | undefined;

  const resetModalState = useCallback(() => {
    form.resetFields();
    setSurveyDataPath("");
    setCalibrationPath("");
    setZipPath("");
  }, [form]);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetModalState();
    onClose();
  }, [onClose, resetModalState, submitting]);

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }

    const api = window.electronAPI?.project;
    if (!api || !currentProject) {
      setMapOptions([]);
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
      setCalibrationPath("");
      return;
    }

    window.electronAPI.getProjectRoot()
      .then((root) => {
        const surveyRoot = `${root}\\${currentProject}\\${SURVEY_DIR_NAME}`;
        setSurveyDataPath(`${surveyRoot}\\${selectedMap}`);
        setCalibrationPath(`${surveyRoot}\\${CALIBRATION_FILE_NAME}`);
      })
      .catch(() => {
        setSurveyDataPath("");
        setCalibrationPath("");
      });
  }, [currentProject, open, selectedMap]);

  const handleSelectZip = async () => {
    const filePath = await window.electronAPI?.selectZipFile?.();
    if (filePath) setZipPath(filePath);
  };

  const handleSubmit = async () => {
    if (!currentProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!selectedMap) {
      message.warning("请先选择地图");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "export") {
        const destDir = await window.electronAPI?.selectDir?.();
        if (!destDir) return;
        const result = await window.electronAPI?.exportImageLabels?.(currentProject, selectedMap, destDir);
        if (!result?.success) {
          message.error(`导出失败: ${result?.error || "未知错误"}`);
          return;
        }
        message.success(`导出成功: ${result.zipName}，共 ${result.exportedCount || 0} 个标识`);
        resetModalState();
        onClose();
        return;
      }

      if (!zipPath) {
        message.warning("请先选择图像标识 ZIP");
        return;
      }
      const result = await window.electronAPI?.importImageLabels?.(currentProject, selectedMap, zipPath);
      if (!result?.success) {
        message.error(`导入失败: ${result?.error || "未知错误"}`);
        return;
      }
      const warningText = result.warnings?.length ? `，${result.warnings.length} 条未导入` : "";
      message.success(`导入成功: ${result.importedCount || 0} 个标识${warningText}`);
      await onImported?.(selectedMap);
      resetModalState();
      onClose();
    } catch (e: any) {
      message.error(`${mode === "export" ? "导出" : "导入"}失败: ` + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "export" ? "图像标识导出" : "图像标识加载";

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={handleClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={!selectedMap || (mode === "import" && !zipPath)}>
            {mode === "export" ? "导出" : "加载"}
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

        {mode === "import" && (
          <Form.Item label="图像标识 ZIP" style={{ marginBottom: 12 }}>
            <Input
              value={zipPath}
              readOnly
              placeholder="请选择图像标识 ZIP"
              addonAfter={<Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={handleSelectZip} disabled={submitting} />}
            />
          </Form.Item>
        )}
      </Form>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>勘察数据路径</div>
        <Input value={surveyDataPath} disabled placeholder="暂无勘察数据路径" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>内部标识数据</div>
        <Input value={calibrationPath} disabled placeholder="暂无内部标识数据路径" />
      </div>

      <Alert
        type="info"
        showIcon
        message={mode === "export"
          ? "导出 ZIP 包含 calib_device 和 calib_cabinet；device_name 为设备区名称，point_name/point_code 用于工具回绑"
          : "加载 ZIP 会按 point_code 优先回绑点表，替换所选地图已有图像标识，其他地图不受影响"}
      />
    </Modal>
  );
}
