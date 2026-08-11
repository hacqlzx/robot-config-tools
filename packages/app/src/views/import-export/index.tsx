import { useEffect, useRef, useState, useCallback } from "react";
import { App, Button, Card, Modal, Radio, Upload } from "antd";
import type { UploadFile } from "antd";
import { DownloadOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import {
  getFacInfo,
  importDevicePoint,
  importSpaceModel,
  importBack,
  importCommunicateExcel,
  importProspectCalibration,
  importCorrection,
  importScreenVerifyAnnotationParams,
  exportSpaceModel,
  exportProspectImage,
  exportDeviceImage,
  exportDeviceCheckImage,
  exportBack,
  downloadCommunicateExcel,
} from "@/api/config.js";
import { startDownloadTaskFlyAnimation } from "@/components/download-task";
import { useAppContext, useRobotOptions } from "@/stores/appContextStore";
import "./index.scss";

interface IEAction {
  /** 行为类型，决定按钮图标和默认兜底文案。 */
  key: "import" | "export" | "export-log" | "export-error";
  /** 按钮文案，也是分发具体导入导出逻辑时的区分条件之一。 */
  label: string;
  /** 按钮下方的短说明。 */
  desc?: string;
  /** 预留未接入能力的禁用态。 */
  disabled?: boolean;
}

interface IECard {
  /** 卡片业务域 key，用于 handleAction 路由到具体接口。 */
  key: string;
  /** 卡片标题。 */
  title: string;
  /** 卡片整体描述，当前多数卡片为空。 */
  desc?: string;
  /** 是否展示模板下载按钮。 */
  templateDownload?: boolean;
  /** 卡片内的操作按钮列表。 */
  actions?: IEAction[];
}

type BackupImportType = "1" | "2";

interface ImportDialogConfig {
  /** 弹窗标题，同时作为上传 loading 状态的显示文案。 */
  title: string;
  /** Upload accept 配置。 */
  accept: string;
  /** 上传区域展示的格式说明。 */
  acceptHint: string;
  /** 工程备份导入需要展示下发类型，其余导入隐藏。 */
  showBackupType?: boolean;
  /** 真正执行导入的函数；backupType 只有工程备份导入会读取。 */
  onImport: (file: File, backupType: BackupImportType) => Promise<void>;
}

interface RemoteExportTaskOptions {
  label: string;
  exportPath: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  destTitle: string;
  triggerElement?: HTMLElement;
  fallbackExport: () => Promise<any>;
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
      { key: "import", label: "点表导入", desc: "导入屏柜验证图点表" },
      { key: "import", label: "标注参数导入", desc: "导入屏柜标注参数" },
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

function matchImportAccept(fileName: string, accept: string): boolean {
  const rules = accept.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const name = fileName.toLowerCase();
  return rules.some((rule) => rule.startsWith(".") && name.endsWith(rule));
}

export default function ImportExport() {
  const { message } = App.useApp();
  const { selectedRobot, backendIp } = useAppContext();
  const robotOptions = useRobotOptions();
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

  /** 下载后台返回的文件路径到指定目录；Electron 由主进程流式落盘，避免依赖项目临时目录。 */
  const downloadFileToSelectedDir = useCallback(async (filePath: string, label: string, destDir?: string) => {
    if (!backendIp) {
      message.warning("请先连接后台");
      return;
    }

    const downloadUrl = /^https?:\/\//i.test(filePath) ? filePath : `https://${backendIp}${filePath}`;
    // 从路径中提取文件名，并替换 Windows 非法字符
    const rawName = filePath.split("/").pop() || `${label}.xlsx`;
    const fileName = rawName.replace(/[<>:"/\\|?*]/g, "-");

    if (window.electronAPI) {
      if (!destDir) return;
      if (!window.electronAPI.downloadRemoteFile) {
        message.error("当前版本不支持直接下载");
        return;
      }

      setUploadingLabel(label);
      try {
        const result = await window.electronAPI.downloadRemoteFile(downloadUrl, fileName, destDir);
        if (!result.success) throw new Error(result.error || "下载失败");
        message.success(`下载成功：${result.fileName || fileName}`);
      } catch (e: any) {
        message.error("下载失败: " + (e?.message || e));
      } finally {
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
  }, [backendIp, message]);

  /** 创建后台导出任务：先选择保存目录，再由下载任务中心调用后台导出接口并下载。 */
  const createRemoteExportTask = useCallback(async ({
    label,
    exportPath,
    query,
    destTitle,
    triggerElement,
    fallbackExport,
  }: RemoteExportTaskOptions) => {
    if (!backendIp) {
      message.warning("请先连接后台");
      return;
    }

    if (window.electronAPI?.downloadTasks) {
      const tasks = await window.electronAPI.downloadTasks.list().catch(() => []);
      if (tasks.some((task) => task.status === "pending" || task.status === "running")) {
        message.warning("已有导出任务进行中");
        return;
      }
    }

    if (window.electronAPI) {
      const destDir = await window.electronAPI.selectDir(destTitle);
      if (!destDir) return;

      if (window.electronAPI.downloadTasks) {
        const result = await window.electronAPI.downloadTasks.create({
          type: "remote-export",
          name: label,
          backendIp,
          exportPath,
          query,
          destDir,
        });
        if (!result.success) {
          message.warning(result.error || "创建导出任务失败");
          return;
        }
        if (triggerElement) startDownloadTaskFlyAnimation(triggerElement);
        return;
      }

      setUploadingLabel(label);
      try {
        const res = await fallbackExport();
        const body = res?.data;
        if (!body?.success || !body?.data) {
          message.error(body?.message || "获取下载路径失败");
          return;
        }
        await downloadFileToSelectedDir(String(body.data || ""), label, destDir);
      } finally {
        setUploadingLabel(null);
      }
      return;
    }

    setUploadingLabel(label);
    try {
      const res = await fallbackExport();
      const body = res?.data;
      if (!body?.success || !body?.data) {
        message.error(body?.message || "获取下载路径失败");
        return;
      }
      await downloadFileToSelectedDir(String(body.data || ""), label);
    } finally {
      setUploadingLabel(null);
    }
  }, [backendIp, downloadFileToSelectedDir, message]);

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

  /** 读取顶部栏已缓存的机器人，避免导入导出时重复请求机器人列表接口。 */
  const resolveSelectedRobot = useCallback(() => {
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return null;
    }

    const robot = robotOptions.find((item) => item.value === selectedRobot || item.label === selectedRobot);
    const robotId = Number(robot?.id);
    if (!robot || !Number.isFinite(robotId)) {
      message.warning("机器人列表未加载，请先连接后台或刷新机器人配置");
      return null;
    }
    return {
      id: robotId,
      robotName: robot.label,
      robotCode: robot.robotCode || "",
    };
  }, [message, robotOptions, selectedRobot]);

  /** 读取当前默认厂站 */
  const resolveCurrentStation = useCallback(async () => {
    const stationRes = await getFacInfo();
    const stationBody = stationRes.data;
    if (!stationBody.success || !stationBody.data) {
      message.error(stationBody.message || "获取厂站列表失败");
      return null;
    }
    const stations = Array.isArray(stationBody.data) ? stationBody.data : [];
    const station = stations.find((item: any) => Number(item.currentFac) === 0) || stations[0];
    if (!station) {
      message.error("未找到可用厂站");
      return null;
    }
    return station;
  }, [message]);

  /** 屏柜点表导入：后台当前接收屏柜点表 ZIP 包，文件内容由后台解析。 */
  const handleScreenVerifyPointTableImport = useCallback(async (file: File) => {
    setUploadingLabel("点表导入");
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      const station = await resolveCurrentStation();
      if (!station) return;

      // 后台点表导入要求同时携带机器人和厂站 id，这两个值来自当前顶部选择/后台默认厂站。
      const res = await importDevicePoint(file, robot.id, station.id);
      const body = res.data;
      if (body.success) {
        message.success("屏柜点表导入成功");
      } else {
        message.error(body.message || "屏柜点表导入失败");
      }
    } catch (e: any) {
      message.error("屏柜点表导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message, resolveCurrentStation, resolveSelectedRobot]);

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
  const handleProjectBackupExport = useCallback(async (triggerElement?: HTMLElement) => {
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      await createRemoteExportTask({
        label: "工程备份导出",
        exportPath: "/robot/tool/file/exportBack",
        query: { robotId: robot.id },
        destTitle: "选择工程备份保存目录",
        triggerElement,
        fallbackExport: () => exportBack(robot.id),
      });
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, resolveSelectedRobot, message]);

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

  /** 屏柜标注参数导入 */
  const handleScreenVerifyAnnotationParamsImport = useCallback(async (file: File) => {
    setUploadingLabel("标注参数导入");
    try {
      const res = await importScreenVerifyAnnotationParams(file);
      const body = res.data;
      if (body.success) {
        message.success("屏柜标注参数导入成功");
      } else {
        message.error(body.message || "屏柜标注参数导入失败");
      }
    } catch (e: any) {
      message.error("屏柜标注参数导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message]);

  /** 空间模型导出 */
  const handleSpaceModelExport = useCallback(async (triggerElement?: HTMLElement) => {
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return;
    }

    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      await createRemoteExportTask({
        label: "空间模型导出",
        exportPath: "/robot/tool/file/exportSpaceModel",
        query: { robotId: robot.id },
        destTitle: "选择空间模型保存目录",
        triggerElement,
        fallbackExport: () => exportSpaceModel(robot.id),
      });
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, selectedRobot, resolveSelectedRobot, message]);

  /** 勘察图像导出 */
  const handleSurveyImageExport = useCallback(async (triggerElement?: HTMLElement) => {
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      await createRemoteExportTask({
        label: "勘察图像导出",
        exportPath: "/robot/tool/file/exportProspectImage",
        query: { robotId: robot.id },
        destTitle: "选择勘察图像保存目录",
        triggerElement,
        fallbackExport: () => exportProspectImage(robot.id),
      });
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, resolveSelectedRobot, message]);

  /** 屏柜验证图导出 */
  const handleDeviceImageExport = useCallback(async (triggerElement?: HTMLElement) => {
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      await createRemoteExportTask({
        label: "屏柜验证图导出",
        exportPath: "/robot/tool/file/exportDeviceImage",
        query: { robotId: robot.id },
        destTitle: "选择屏柜验证图保存目录",
        triggerElement,
        fallbackExport: () => exportDeviceImage(robot.id),
      });
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, resolveSelectedRobot, message]);

  /** 设备验证图导出 */
  const handleDeviceCheckImageExport = useCallback(async (triggerElement?: HTMLElement) => {
    try {
      const robot = await resolveSelectedRobot();
      if (!robot) return;
      await createRemoteExportTask({
        label: "设备验证图导出",
        exportPath: "/robot/tool/file/exportDeviceCheckImage",
        query: { robotId: robot.id },
        destTitle: "选择设备验证图保存目录",
        triggerElement,
        fallbackExport: () => exportDeviceCheckImage(robot.id),
      });
    } catch (e: any) {
      message.error("导出失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, resolveSelectedRobot, message]);

  /** 通信模板下载 */
  const handleCommunicationTemplateDownload = useCallback(async (triggerElement?: HTMLElement) => {
    try {
      await createRemoteExportTask({
        label: "通信模板下载",
        exportPath: "/robot/tool/file/downloadCommunicateExcel",
        destTitle: "选择通信模板保存目录",
        triggerElement,
        fallbackExport: () => downloadCommunicateExcel(),
      });
    } catch (e: any) {
      message.error("下载失败: " + (e?.message || e));
    }
  }, [createRemoteExportTask, message]);

  const handleAction = (card: IECard, actionKey: IEAction["key"], label: string, triggerElement?: HTMLElement) => {
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
      handleSpaceModelExport(triggerElement);
      return;
    }

    // 勘察图像导出
    if (card.key === "survey-image" && actionKey === "export") {
      handleSurveyImageExport(triggerElement);
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
      handleDeviceImageExport(triggerElement);
      return;
    }

    // 屏柜点表导入
    if (card.key === "screen-verify" && actionKey === "import" && label === "点表导入") {
      openImportDialog({
        title: "点表导入",
        accept: ".zip",
        acceptHint: ".zip 格式",
        onImport: handleScreenVerifyPointTableImport,
      });
      return;
    }

    // 屏柜标注参数导入：目前只负责上传按钮和接口调用，参数内容校验由后台处理。
    if (card.key === "screen-verify" && actionKey === "import" && label === "标注参数导入") {
      openImportDialog({
        title: "标注参数导入",
        accept: ".json",
        acceptHint: ".json 格式",
        onImport: handleScreenVerifyAnnotationParamsImport,
      });
      return;
    }

    // 设备验证图导出
    if (card.key === "device-verify" && actionKey === "export") {
      handleDeviceCheckImageExport(triggerElement);
      return;
    }

    // 工程备份导出
    if (card.key === "project-backup" && actionKey === "export") {
      handleProjectBackupExport(triggerElement);
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
  const templateHandlers: Record<string, (triggerElement?: HTMLElement) => Promise<void> | void> = {
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
    if (!matchImportAccept(file.name, importDialog.accept)) {
      message.warning(`请选择${importDialog.acceptHint}文件`);
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
      <div className="ie-card-action" key={`${act.key}:${act.label}`}>
        <Button
          type="primary"
          disabled={act.disabled}
          icon={isImportKey(act.key) ? <UploadOutlined /> : <DownloadOutlined />}
          loading={uploadingLabel === act.label}
          onClick={(event) => handleAction(card, act.key, act.label, event.currentTarget)}
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
                  onClick={(event) => templateHandlers[card.key]?.(event.currentTarget)}
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
            beforeUpload={(file) => {
              if (importDialog && !matchImportAccept(file.name, importDialog.accept)) {
                message.warning(`请选择${importDialog.acceptHint}文件`);
                return Upload.LIST_IGNORE;
              }
              return false;
            }}
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
