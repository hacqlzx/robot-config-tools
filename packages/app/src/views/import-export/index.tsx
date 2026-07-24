import { useEffect, useRef, useState, useCallback } from "react";
import { App, Button, Card, Modal, Radio, Upload } from "antd";
import type { UploadFile } from "antd";
import { DownloadOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import {
  getAllRobot,
  importSpaceModel,
  importBack,
  importCommunicateExcel,
  importProspectCalibration,
  importCorrection,
  exportSpaceModel,
  exportProspectImage,
  exportDeviceImage,
  exportDeviceCheckImage,
  exportBack,
  downloadCommunicateExcel,
} from "@/api/config.js";
import { useAppContext } from "@/stores/appContextStore";
import "./index.scss";

interface IEAction {
  key: "import" | "export" | "export-log" | "export-error";
  label: string;
  desc?: string;
  disabled?: boolean;
}

interface IECard {
  key: string;
  title: string;
  desc?: string;
  templateDownload?: boolean;
  actions?: IEAction[];
}

type BackupImportType = "1" | "2";

interface ImportDialogConfig {
  title: string;
  accept: string;
  acceptHint: string;
  showBackupType?: boolean;
  onImport: (file: File, backupType: BackupImportType) => Promise<void>;
}

const cardList: IECard[] = [
  {
    key: "space-model",
    title: "空间模型",
    actions: [
      { key: "export", label: "空间模型导出", desc: "导出 .las、路径等" },
      { key: "import", label: "空间模型导入", desc: "导入 .las、路径等" },
    ],
  },
  {
    key: "communication",
    title: "通信",
    templateDownload: true,
    actions: [
      { key: "import", label: "通信信息导入", desc: "导入机器人、后台、巡视主机通信信息等" },
    ],
  },
  {
    key: "survey-image",
    title: "勘察图像",
    actions: [
      { key: "export", label: "勘察图像导出", desc: "导出勘察图像" },
      { key: "import", label: "图像标识导入", desc: "导入勘察图像标识" },
    ],
  },
  {
    key: "screen-verify",
    title: "屏柜验证图",
    actions: [
      { key: "export", label: "屏柜验证图导出", desc: "导出屏柜验证图" },
    ],
  },
  {
    key: "device-verify",
    title: "设备验证图",
    actions: [
      { key: "export", label: "设备验证图导出", desc: "导出设备验证图" },
      { key: "import", label: "纠偏数据导入", desc: "导入设备纠偏数据" },
    ],
  },
  {
    key: "project-backup",
    title: "工程备份",
    actions: [
      { key: "export", label: "工程备份导出", desc: "导出机器人全部调试数据" },
      { key: "import", label: "工程备份导入", desc: "导入机器人调试数据" },
    ],
  },
  {
    key: "log",
    title: "日志",
    actions: [
      { key: "export-log", label: "运行日志导出", desc: "导出机器人日志" },
      { key: "export-error", label: "异常数据导出", desc: "导出机器人异常数据" },
    ],
  },
];

function calcColumns(width: number): number {
  if (width < 640) return 2;
  if (width < 960) return 3;
  if (width < 1280) return 4;
  return 5;
}

/** 判断 action key 是否为导入类型 */
function isImportKey(key: string): boolean {
  return key === "import";
}

export default function ImportExport() {
  const { message } = App.useApp();
  const { selectedProject, selectedRobot, backendIp } = useAppContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);
  const [importDialog, setImportDialog] = useState<ImportDialogConfig | null>(null);
  const [importFileList, setImportFileList] = useState<UploadFile[]>([]);
  const [backupImportType, setBackupImportType] = useState<BackupImportType>("1");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setColumns(calcColumns(el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const openImportDialog = useCallback((config: ImportDialogConfig) => {
    setImportFileList([]);
    setBackupImportType("1");
    setImportDialog(config);
  }, []);

  /** 通用下载到目录：Electron 选目录下载，浏览器直接触发下载 */
  const downloadFileToDir = useCallback(async (filePath: string, label: string) => {
    if (!backendIp) {
      message.warning("请先连接后台");
      return;
    }
    if (window.electronAPI && !selectedProject) {
      message.warning("请先在顶部选择项目");
      return;
    }

    const downloadUrl = `https://${backendIp}${filePath}`;
    // 从路径中提取文件名，并替换 Windows 非法字符
    const rawName = filePath.split("/").pop() || `${label}.xlsx`;
    const fileName = rawName.replace(/[<>:"/\\|?*]/g, "-");

    if (window.electronAPI) {
      const dir = await window.electronAPI.selectDir();
      if (!dir) return;

      setUploadingLabel(label);
      let tempFilePath = "";
      try {
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error("下载失败: " + response.status);
        const buffer = await response.arrayBuffer();

        const tempPath = `_temp/${fileName}`;
        tempFilePath = await window.electronAPI.project.writeFile(selectedProject, tempPath, buffer);
        await window.electronAPI.project.exportFile(selectedProject, tempPath, dir);

        message.success("下载成功");
      } catch (e: any) {
        message.error("下载失败: " + (e?.message || e));
      } finally {
        if (tempFilePath) {
          try {
            await window.electronAPI.project.deletePath(tempFilePath);
          } catch {}
        }
        setUploadingLabel(null);
      }
    } else {
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      message.success("已开始下载");
    }
  }, [backendIp, message, selectedProject]);

  /** 通信信息导入 */
  const handleCommunicationImport = useCallback(async (file: File) => {
    setUploadingLabel("通信信息导入");
    try {
      const res = await importCommunicateExcel(file);
      const body = res.data;
      if (body.success) {
        message.success("通信信息导入成功");
      } else {
        message.error(body.message || "通信信息导入失败");
      }
    } catch (e: any) {
      message.error("通信信息导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message]);

  /** 读取顶部栏选中的机器人 */
  const resolveSelectedRobot = useCallback(async () => {
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return null;
    }

    const robotRes = await getAllRobot();
    const robotBody = robotRes.data;
    if (!robotBody.success || !robotBody.data) {
      message.error("获取机器人列表失败");
      return null;
    }
    const robot = robotBody.data.find((r: any) => r.robotName === selectedRobot);
    if (!robot) {
      message.error(`未找到机器人「${selectedRobot}」`);
      return null;
    }
    return robot;
  }, [message, selectedRobot]);

  /** 空间模型导入 */
  const handleSpaceModelImport = useCallback(async (file: File) => {
    setUploadingLabel("空间模型导入");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;

      const res = await importSpaceModel(file, robot.id);
      const body = res.data;
      if (body.success) {
        message.success("空间模型导入成功");
      } else {
        message.error(body.message || "空间模型导入失败");
      }
    } catch (e: any) {
      message.error("空间模型导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message, resolveSelectedRobot]);

  /** 工程备份导入 */
  const handleProjectBackupImport = useCallback(async (file: File, type: BackupImportType) => {
    setUploadingLabel("工程备份导入");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;

      const res = await importBack(file, robot.id, type);
      const body = res.data;
      if (body.success) {
        message.success("工程备份导入成功");
      } else {
        message.error(body.message || "工程备份导入失败");
      }
    } catch (e: any) {
      message.error("工程备份导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message, resolveSelectedRobot]);

  /** 工程备份导出 */
  const handleProjectBackupExport = useCallback(async () => {
    setUploadingLabel("工程备份导出");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const res = await exportBack(robot.id);
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取下载路径失败");
        return;
      }

      await downloadFileToDir(body.data, "工程备份导出");
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message, downloadFileToDir]);

  /** 图像标识导入 */
  const handleImageLabelImport = useCallback(async (file: File) => {
    setUploadingLabel("图像标识导入");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;

      const res = await importProspectCalibration(file, robot.id);
      const body = res.data;
      if (body.success) {
        message.success("图像标识导入成功");
      } else {
        message.error(body.message || "图像标识导入失败");
      }
    } catch (e: any) {
      message.error("图像标识导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message]);

  /** 纠偏数据导入 */
  const handleCorrectionImport = useCallback(async (file: File) => {
    setUploadingLabel("纠偏数据导入");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;

      const res = await importCorrection(file, robot.id);
      const body = res.data;
      if (body.success) {
        message.success("纠偏数据导入成功");
      } else {
        message.error(body.message || "纠偏数据导入失败");
      }
    } catch (e: any) {
      message.error("纠偏数据导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message]);

  /** 空间模型导出 */
  const handleSpaceModelExport = useCallback(async () => {
    setUploadingLabel("空间模型导出");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const res = await exportSpaceModel(robot.id);
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取下载路径失败");
        return;
      }

      await downloadFileToDir(body.data, "空间模型导出");
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message, downloadFileToDir]);

  /** 勘察图像导出 */
  const handleSurveyImageExport = useCallback(async () => {
    setUploadingLabel("勘察图像导出");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const res = await exportProspectImage(robot.id);
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取下载路径失败");
        return;
      }

      await downloadFileToDir(body.data, "勘察图像导出");
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message, downloadFileToDir]);

  /** 屏柜验证图导出 */
  const handleDeviceImageExport = useCallback(async () => {
    setUploadingLabel("屏柜验证图导出");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const res = await exportDeviceImage(robot.id);
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取下载路径失败");
        return;
      }

      await downloadFileToDir(body.data, "屏柜验证图导出");
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message, downloadFileToDir]);

  /** 设备验证图导出 */
  const handleDeviceCheckImageExport = useCallback(async () => {
    setUploadingLabel("设备验证图导出");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const res = await exportDeviceCheckImage(robot.id);
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取下载路径失败");
        return;
      }

      await downloadFileToDir(body.data, "设备验证图导出");
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [resolveSelectedRobot, message, downloadFileToDir]);

  /** 通信模板下载 */
  const handleCommunicationTemplateDownload = useCallback(async () => {
    try {
      const res = await downloadCommunicateExcel();
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取模板失败");
        return;
      }
      await downloadFileToDir(body.data, "通信模板下载");
    } catch (e: any) {
      message.error("下载失败: " + (e?.message || e));
    }
  }, [message, downloadFileToDir]);

  const handleAction = (card: IECard, actionKey: IEAction["key"], label: string) => {
    const action = card.actions?.find((item) => item.key === actionKey && item.label === label);
    if (action?.disabled) return;

    // 空间模型导入
    if (card.key === "space-model" && actionKey === "import") {
      openImportDialog({
        title: "空间模型导入",
        accept: ".zip,.las,.laz",
        acceptHint: ".zip、.las、.laz 格式",
        onImport: handleSpaceModelImport,
      });
      return;
    }

    // 通信信息导入
    if (card.key === "communication" && actionKey === "import") {
      openImportDialog({
        title: "通信信息导入",
        accept: ".xlsx,.xls",
        acceptHint: ".xlsx、.xls 格式",
        onImport: handleCommunicationImport,
      });
      return;
    }

    // 空间模型导出
    if (card.key === "space-model" && actionKey === "export") {
      handleSpaceModelExport();
      return;
    }

    // 勘察图像导出
    if (card.key === "survey-image" && actionKey === "export") {
      handleSurveyImageExport();
      return;
    }

    // 图像标识导入
    if (card.key === "survey-image" && actionKey === "import") {
      openImportDialog({
        title: "图像标识导入",
        accept: ".zip",
        acceptHint: ".zip 格式",
        onImport: handleImageLabelImport,
      });
      return;
    }

    // 屏柜验证图导出
    if (card.key === "screen-verify" && actionKey === "export") {
      handleDeviceImageExport();
      return;
    }

    // 设备验证图导出
    if (card.key === "device-verify" && actionKey === "export") {
      handleDeviceCheckImageExport();
      return;
    }

    // 工程备份导出
    if (card.key === "project-backup" && actionKey === "export") {
      handleProjectBackupExport();
      return;
    }

    // 工程备份导入
    if (card.key === "project-backup" && actionKey === "import") {
      openImportDialog({
        title: "工程备份导入",
        accept: ".zip",
        acceptHint: ".zip 格式",
        showBackupType: true,
        onImport: handleProjectBackupImport,
      });
      return;
    }

    // 纠偏数据导入
    if (card.key === "device-verify" && actionKey === "import") {
      openImportDialog({
        title: "纠偏数据导入",
        accept: ".zip",
        acceptHint: ".zip 格式",
        onImport: handleCorrectionImport,
      });
      return;
    }

    const verb = isImportKey(actionKey) ? "导入" : "导出";
    message.info(`${verb}「${label || card.title}」（功能待接入）`);
  };

  /** 模板下载映射 */
  const templateHandlers: Record<string, () => void> = {
    "communication": handleCommunicationTemplateDownload,
  };

  const closeImportDialog = () => {
    if (uploadingLabel) return;
    setImportDialog(null);
    setImportFileList([]);
  };

  const handleImportConfirm = async () => {
    const file = importFileList[0]?.originFileObj;
    if (!importDialog || !file) {
      message.warning("请先选择导入文件");
      return;
    }
    await importDialog.onImport(file, backupImportType);
    setImportDialog(null);
    setImportFileList([]);
  };

  const renderActions = (card: IECard) => {
    const actions: IEAction[] = card.actions ?? [
      { key: "import", label: "导入" },
      { key: "export", label: "导出" },
    ];
    return actions.map((act) => (
      <div className="ie-card-action" key={act.key}>
        <Button
          type="primary"
          disabled={act.disabled}
          icon={isImportKey(act.key) ? <UploadOutlined /> : <DownloadOutlined />}
          loading={uploadingLabel === act.label}
          onClick={() => handleAction(card, act.key, act.label)}
        >
          {act.label}
        </Button>
        {act.desc && <span className="ie-action-desc">{act.desc}</span>}
      </div>
    ));
  };

  return (
    <div className="import-export-page" ref={containerRef}>
      <div className="ie-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cardList.map((card) => (
          <Card
            key={card.key}
            className={`ie-card${card.actions?.every((action) => action.disabled) ? " is-disabled" : ""}`}
          >
            <div className="ie-card-head">
              <span className="ie-card-bar" />
              <span className="ie-card-title">{card.title}</span>
              {card.templateDownload && (
                <Button
                  type="text"
                  size="small"
                  onClick={() => templateHandlers[card.key]?.()}
                  style={{ marginLeft: "auto", color: "#546bf7" }}
                >
                  模板下载
                </Button>
              )}
            </div>
            {card.desc && <p className="ie-card-desc">{card.desc}</p>}
            <div className="ie-card-actions">{renderActions(card)}</div>
          </Card>
        ))}
      </div>

      <Modal
        className="ie-import-modal"
        title={importDialog?.title}
        open={Boolean(importDialog)}
        centered
        okText="确定"
        cancelText="取消"
        confirmLoading={Boolean(importDialog && uploadingLabel === importDialog.title)}
        okButtonProps={{ disabled: importFileList.length === 0 }}
        onOk={handleImportConfirm}
        onCancel={closeImportDialog}
        destroyOnHidden
      >
        {importDialog?.showBackupType && (
          <section className="ie-import-section">
            <div className="ie-import-label">选择下发类型</div>
            <Radio.Group
              className="ie-backup-type-group"
              value={backupImportType}
              onChange={(event) => setBackupImportType(event.target.value)}
            >
              <Radio value="2" className="ie-backup-type-option">
                <span className="ie-backup-type-title">复制</span>
                <span className="ie-backup-type-desc">
                  包含机器人台账、后台通信数据、地图、拍照点、勘察图片、勘察标定数据、纠偏数据
                </span>
              </Radio>
              <Radio value="1" className="ie-backup-type-option">
                <span className="ie-backup-type-title">厂站数据</span>
                <span className="ie-backup-type-desc">包含地图、拍照点</span>
              </Radio>
            </Radio.Group>
          </section>
        )}

        <section className="ie-import-section">
          <div className="ie-import-label">上传文件</div>
          <Upload.Dragger
            accept={importDialog?.accept}
            multiple={false}
            maxCount={1}
            fileList={importFileList}
            beforeUpload={() => false}
            onChange={({ fileList }) => setImportFileList(fileList.slice(-1))}
            onRemove={() => {
              setImportFileList([]);
              return true;
            }}
          >
            <p className="ie-import-icon"><InboxOutlined /></p>
            <p className="ie-import-text">点击或拖拽上传文件</p>
            <p className="ie-import-hint">支持 {importDialog?.acceptHint}</p>
          </Upload.Dragger>
        </section>
      </Modal>
    </div>
  );
}
