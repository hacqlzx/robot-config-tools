import { useCallback, useEffect, useState } from "react";
import { Modal, App } from "antd";
import { useSelectedProject } from "@/stores/appContextStore";
import { createLocalExportTask } from "@/components/download-task/task-actions";
import ExportMapPicker, { ExportMapFooter, type ExportMapOption } from "./ExportMapPicker";

interface SurveyImageExportProps {
  open: boolean;
  onClose: () => void;
}

export default function SurveyImageExport({ open, onClose }: SurveyImageExportProps) {
  const { message } = App.useApp();
  const [mapOptions, setMapOptions] = useState<ExportMapOption[]>([]);
  const [selectedMap, setSelectedMap] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const currentProject = useSelectedProject();

  const resetModalState = useCallback(() => {
    setSelectedMap(undefined);
  }, []);

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
      setSelectedMap(undefined);
      return;
    }

    setLoading(true);
    api.listTree(currentProject, "地图")
      .then((tree) => {
        const options = tree.filter((node) => node.isDir).map((node) => ({ label: node.name, value: node.name }));
        setMapOptions(options);
        setSelectedMap((current) => options.some((option) => option.value === current) ? current : options[0]?.value);
      })
      .catch(() => {
        setMapOptions([]);
        setSelectedMap(undefined);
      })
      .finally(() => setLoading(false));
  }, [currentProject, open, resetModalState]);

  const handleExport = async (triggerElement?: HTMLElement) => {
    if (!currentProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!selectedMap) {
      message.warning("请先选择地图");
      return;
    }

    setExporting(true);
    try {
      const result = await createLocalExportTask({
        name: "勘察图像导出",
        operation: "survey-data",
        destTitle: "选择勘察图像导出目录",
        payload: { projectName: currentProject, mapName: selectedMap },
        triggerElement,
      });
      if (!result.success) {
        message.warning(result.error || "创建导出任务失败");
        return;
      }
      if (!result.cancelled) {
        resetModalState();
        onClose();
      }
    } catch (e: any) {
      message.error(e?.message || "创建导出任务失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title={<span style={{ fontSize: 14 }}>勘察图像导出</span>}
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={480}
      footer={
        <ExportMapFooter
          selectedMap={selectedMap}
          confirming={exporting}
          disabled={!selectedMap}
          onConfirm={handleExport}
        />
      }
    >
      <ExportMapPicker
        currentProject={currentProject}
        loading={loading}
        mapOptions={mapOptions}
        selectedMap={selectedMap}
        onSelect={setSelectedMap}
      />
    </Modal>
  );
}
