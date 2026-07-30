import { useCallback, useEffect, useState } from "react";
import { Modal, Form, Input, Select, Upload, Button, App, Alert } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useSelectedProject } from "@/stores/appContextStore";

const { Dragger } = Upload;
const SURVEY_DIR_NAME = "勘察数据";

interface SurveyImageLoadProps {
  open: boolean;
  onClose: () => void;
  onImport: (mapName: string) => void | Promise<void>;
  onTaskImport?: (taskDir: string) => void | Promise<void>;
}

function formatSpIds(ids: number[]): string {
  return ids.length > 0 ? ids.join("、") : "";
}

export default function SurveyImageLoad({ open, onClose, onImport, onTaskImport }: SurveyImageLoadProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
  const [surveyDataDir, setSurveyDataDir] = useState("");
  const [importedSpIds, setImportedSpIds] = useState<number[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const currentProject = useSelectedProject();
  const selectedMap = Form.useWatch("map", form) as string | undefined;

  const readImportedSpIds = useCallback(async (surveyDir: string): Promise<number[]> => {
    const api = window.electronAPI;
    if (!api || !surveyDir) return [];
    for (const manifestPath of [
      `${surveyDir}\\device\\json_list.json`,
      `${surveyDir}\\json_list.json`,
    ]) {
      try {
        const buf = await api.readLargeFile(manifestPath);
        const manifest = JSON.parse(new TextDecoder().decode(buf));
        if (!Array.isArray(manifest.ordered_sp)) return [];
        const ids = manifest.ordered_sp
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isFinite(id));
        return Array.from(new Set(ids)).sort((a, b) => a - b);
      } catch {}
    }
    return [];
  }, []);

  const resolveSurveyDataDir = useCallback(async (mapName: string): Promise<string> => {
    if (!window.electronAPI || !currentProject || !mapName) return "";
    const root = await window.electronAPI.getProjectRoot();
    return `${root}\\${currentProject}\\${SURVEY_DIR_NAME}\\${mapName}`;
  }, [currentProject]);

  const resetModalState = useCallback(() => {
    form.resetFields();
    setSurveyDataDir("");
    setImportedSpIds([]);
    setZipFile(null);
  }, [form]);

  const handleClose = useCallback(() => {
    resetModalState();
    onClose();
  }, [onClose, resetModalState]);

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI?.project;
    if (!api || !currentProject) {
      setMapOptions([]);
      setSurveyDataDir("");
      setImportedSpIds([]);
      return;
    }
    (async () => {
      try {
        const tree = await api.listTree(currentProject, "地图");
        setMapOptions(tree.filter((n) => n.isDir).map((d) => ({ label: d.name, value: d.name })));
      } catch {
        setMapOptions([]);
      }
    })();
  }, [open, currentProject]);

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }
    let ignore = false;
    if (!selectedMap) {
      setSurveyDataDir("");
      setImportedSpIds([]);
      return;
    }
    (async () => {
      try {
        const dir = await resolveSurveyDataDir(selectedMap);
        const ids = await readImportedSpIds(dir);
        if (ignore) return;
        setSurveyDataDir(dir);
        setImportedSpIds(ids);
      } catch {
        if (ignore) return;
        setSurveyDataDir("");
        setImportedSpIds([]);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open, selectedMap, readImportedSpIds, resetModalState, resolveSurveyDataDir]);

  const handleZipFile = (file: File) => {
    setZipFile(file);
    return false;
  };

  const handleImport = async () => {
    const mapName = form.getFieldValue("map");
    const shouldImportZip = !!zipFile;

    if (!mapName) {
      message.warning("请先选择地图");
      return;
    }
    if (!currentProject) {
      message.warning("请先选择项目");
      return;
    }

    setExtracting(true);

    try {
      let taskDirToLoad = "";
      if (shouldImportZip && zipFile) {
        const api = window.electronAPI!;
        const filePath = api.getFilePath?.(zipFile) || "";
        if (!filePath) {
          message.error("无法获取文件路径");
          return;
        }
        const result = await api.importSurveyData(currentProject, mapName, filePath);
        if (!result.success) {
          message.error("解压失败: " + (result.error || "未知错误"));
          return;
        }
        const ids = result.importedSpIds || [];
        setImportedSpIds(ids);
        if (ids.length > 0) message.success(`已导入点位数据：${formatSpIds(ids)}`);
        if (ids.length > 0) taskDirToLoad = result.surveyDir || surveyDataDir || await resolveSurveyDataDir(mapName);
      } else if (onTaskImport) {
        const dir = surveyDataDir || await resolveSurveyDataDir(mapName);
        const ids = importedSpIds.length > 0 ? importedSpIds : await readImportedSpIds(dir);
        if (ids.length > 0) {
          setImportedSpIds(ids);
          taskDirToLoad = dir;
        }
      }

      await onImport(mapName);
      if (taskDirToLoad && onTaskImport) {
        await onTaskImport(taskDirToLoad);
      }
      handleClose();
    } finally {
      setExtracting(false);
    }
  };

  const alertMessage = !selectedMap
    ? "请选择地图后查看已导入点位数据"
    : importedSpIds.length > 0
      ? `已导入点位数据：${formatSpIds(importedSpIds)}`
      : "当前地图暂无已导入点位数据";

  return (
    <Modal title="勘察图像加载" open={open} onCancel={handleClose} footer={null} destroyOnHidden centered confirmLoading={extracting}>
      <Form form={form} layout="vertical">
        <div style={{ display: "flex", gap: 12 }}>
          <Form.Item label="当前项目" style={{ flex: 1, marginBottom: 24 }}>
            <Input value={currentProject || "未选择"} disabled />
          </Form.Item>
          <Form.Item name="map" label="选择地图" style={{ flex: 1, marginBottom: 24 }}>
            <Select placeholder="请选择地图" allowClear options={mapOptions} />
          </Form.Item>
        </div>

        <Alert
          type={selectedMap && importedSpIds.length > 0 ? "success" : "info"}
          showIcon
          style={{ marginBottom: 12 }}
          message={alertMessage}
        />

        <Dragger
          name="file"
          multiple={false}
          accept=".zip"
          beforeUpload={handleZipFile}
          fileList={zipFile ? [{ uid: "-1", name: zipFile.name, status: "done" as const }] : []}
          onRemove={() => setZipFile(null)}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 ZIP 压缩包到此区域</p>
          <p className="ant-upload-hint">导入后会全量覆盖勘察数据/{selectedMap || "所选地图"}，保留点表绑定结果</p>
        </Dragger>
      </Form>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={handleClose}>取消</Button>
        <Button type="primary" onClick={handleImport} loading={extracting}>加载</Button>
      </div>
    </Modal>
  );
}
