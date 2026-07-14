import { useCallback, useEffect, useState } from "react";
import { Modal, Form, Input, Select, Button, App, Alert } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { useSelectedProject } from "@/stores/appContextStore";
import ExportMapPicker, { ExportMapFooter, type ExportMapOption } from "./ExportMapPicker";

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
  const [mapOptions, setMapOptions] = useState<ExportMapOption[]>([]);
  const [surveyDataPath, setSurveyDataPath] = useState("");
  const [calibrationPath, setCalibrationPath] = useState("");
  const [zipPath, setZipPath] = useState("");
  const [selectedMap, setSelectedMap] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const currentProject = useSelectedProject();

  const resetModalState = useCallback(() => {
    form.resetFields();
    setSurveyDataPath("");
    setCalibrationPath("");
    setZipPath("");
    setSelectedMap(undefined);
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
      setSelectedMap(undefined);
      return;
    }

    setLoading(true);
    api.listTree(currentProject, "地图")
      .then((tree) => {
        const options = tree.filter((node) => node.isDir).map((node) => ({ label: node.name, value: node.name }));
        setMapOptions(options);
        if (mode === "export") {
          setSelectedMap((currentMap) => options.some((option) => option.value === currentMap) ? currentMap : options[0]?.value);
        }
      })
      .catch(() => {
        setMapOptions([]);
        setSelectedMap(undefined);
      })
      .finally(() => setLoading(false));
  }, [currentProject, mode, open, resetModalState]);

  useEffect(() => {
    if (mode === "export" || !open || !selectedMap || !currentProject || !window.electronAPI) {
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
  }, [currentProject, mode, open, selectedMap]);

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
        message.success("导出成功");
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
      title={mode === "export" ? <span style={{ fontSize: 14 }}>{title}</span> : title}
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={mode === "export" ? 480 : undefined}
      footer={
        mode === "export" ? (
          <ExportMapFooter
            selectedMap={selectedMap}
            confirming={submitting}
            disabled={!selectedMap}
            onConfirm={handleSubmit}
          />
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={handleClose} disabled={submitting}>取消</Button>
            <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={!selectedMap || !zipPath}>
              加载
            </Button>
          </div>
        )
      }
    >
      {mode === "export" ? (
        <ExportMapPicker
          currentProject={currentProject}
          loading={loading}
          mapOptions={mapOptions}
          selectedMap={selectedMap}
          onSelect={setSelectedMap}
        />
      ) : (
        <>
          <Form form={form} layout="vertical">
            <div style={{ display: "flex", gap: 12 }}>
              <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
                <Input value={currentProject || "未选择"} disabled />
              </Form.Item>
              <Form.Item label="选择地图" style={{ flex: 1, marginBottom: 24 }}>
                <Select placeholder="请选择地图" allowClear loading={loading} options={mapOptions} value={selectedMap} onChange={setSelectedMap} />
              </Form.Item>
            </div>

            <Form.Item label="图像标识 ZIP" style={{ marginBottom: 12 }}>
              <Input
                value={zipPath}
                readOnly
                placeholder="请选择图像标识 ZIP"
                addonAfter={<Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={handleSelectZip} disabled={submitting} />}
              />
            </Form.Item>
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
            message="加载 ZIP 会按 point_code 优先回绑点表，替换所选地图已有图像标识，其他地图不受影响"
          />
        </>
      )}
    </Modal>
  );
}
