import { useEffect, useRef, useState, useCallback } from "react";
import { App, Button, Card } from "antd";
import { UploadOutlined, DownloadOutlined } from "@ant-design/icons";
import { getAllRobot, getFacInfo, importDevicePoint, importCommunicateExcel, exportSpaceModel, downLoadExcelTemplate, downloadCommunicateExcel } from "@/api/config.js";
import { getCurrentIp } from "@/stores/backendStore";
import "./index.scss";

interface IEAction {
  key: "import" | "export" | "export-log" | "export-error";
  label: string;
  desc?: string;
}

interface IECard {
  key: string;
  title: string;
  desc?: string;
  templateDownload?: boolean;
  actions?: IEAction[];
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
    key: "patrol-point",
    title: "巡视点表",
    templateDownload: true,
    actions: [
      { key: "import", label: "点表导入", desc: "导入设备区、屏柜点位" },
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
      { key: "import", label: "设备验证图导入", desc: "导入设备纠偏数据" },
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
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [columns, setColumns] = useState(4);
  const [uploadingLabel, setUploadingLabel] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setColumns(calcColumns(el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 打开文件选择器 */
  const pickFile = useCallback((onFile: (file: File) => Promise<void>) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.onchange = async (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        await onFile(file);
      }
      input.value = "";
    };
    input.click();
  }, []);

  /** 通用下载到目录：Electron 选目录下载，浏览器直接触发下载 */
  const downloadFileToDir = useCallback(async (filePath: string, label: string) => {
    const ip = getCurrentIp();
    if (!ip) {
      message.warning("请先连接后台");
      return;
    }

    const downloadUrl = `https://${ip}${filePath}`;
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

        const projectName = localStorage.getItem("selectedProject") || "default";
        const tempPath = `_temp/${fileName}`;
        tempFilePath = await window.electronAPI.project.writeFile(projectName, tempPath, buffer);
        await window.electronAPI.project.exportFile(projectName, tempPath, dir);

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
  }, [message]);

  /** 点表导入 */
  const handlePatrolPointImport = useCallback(async (file: File) => {
    const selectedRobot = localStorage.getItem("selectedRobot");
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return;
    }

    setUploadingLabel("点表导入");
    try {
      // 获取机器人列表拿 robotId
      const robotRes = await getAllRobot();
      const robotBody = robotRes.data;
      if (!robotBody.success || !robotBody.data) {
        message.error("获取机器人列表失败");
        return;
      }
      const robot = robotBody.data.find((r: any) => r.robotName === selectedRobot);
      if (!robot) {
        message.error(`未找到机器人「${selectedRobot}」`);
        return;
      }
      const robotId = robot.id;
      const operationFacName = robot.operationFacName;

      // 获取厂站列表拿 stationId（通过 operationFacName 匹配）
      const facRes = await getFacInfo();
      const facBody = facRes.data;
      if (!facBody.success || !facBody.data) {
        message.error("获取厂站列表失败");
        return;
      }
      const station = facBody.data.find((s: any) => s.stationName === operationFacName);
      if (!station) {
        message.error(`未找到与机器人关联的厂站「${operationFacName}」`);
        return;
      }
      const stationId = station.id;

      // 上传文件
      const importRes = await importDevicePoint(file, robotId, stationId);
      const importBody = importRes.data;
      if (importBody.success) {
        message.success("点表导入成功");
      } else {
        message.error(importBody.message || "点表导入失败");
      }
    } catch (e: any) {
      message.error("点表导入失败: " + (e?.message || e));
    } finally {
      setUploadingLabel(null);
    }
  }, [message]);

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

  /** 空间模型导出 */
  const handleSpaceModelExport = useCallback(async () => {
    const selectedRobot = localStorage.getItem("selectedRobot");
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return;
    }

    setUploadingLabel("空间模型导出");
    try {
      const robotRes = await getAllRobot();
      const robotBody = robotRes.data;
      if (!robotBody.success || !robotBody.data) {
        message.error("获取机器人列表失败");
        return;
      }
      const robot = robotBody.data.find((r: any) => r.robotName === selectedRobot);
      if (!robot) {
        message.error(`未找到机器人「${selectedRobot}」`);
        return;
      }

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
  }, [message, downloadFileToDir]);

  /** 点表模板下载 */
  const handlePatrolPointTemplateDownload = useCallback(async () => {
    try {
      const res = await downLoadExcelTemplate();
      const body = res.data;
      if (!body.success || !body.data) {
        message.error(body.message || "获取模板失败");
        return;
      }
      await downloadFileToDir(body.data, "点表模板下载");
    } catch (e: any) {
      message.error("下载失败: " + (e?.message || e));
    }
  }, [message, downloadFileToDir]);

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
    // 点表导入
    if (card.key === "patrol-point" && actionKey === "import") {
      pickFile(handlePatrolPointImport);
      return;
    }

    // 通信信息导入
    if (card.key === "communication" && actionKey === "import") {
      pickFile(handleCommunicationImport);
      return;
    }

    // 空间模型导出
    if (card.key === "space-model" && actionKey === "export") {
      handleSpaceModelExport();
      return;
    }

    const verb = isImportKey(actionKey) ? "导入" : "导出";
    message.info(`${verb}「${label || card.title}」（功能待接入）`);
  };

  /** 模板下载映射 */
  const templateHandlers: Record<string, () => void> = {
    "patrol-point": handlePatrolPointTemplateDownload,
    "communication": handleCommunicationTemplateDownload,
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
      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
      />

      <div className="ie-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {cardList.map((card) => (
          <Card key={card.key} className="ie-card" hoverable>
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
    </div>
  );
}
