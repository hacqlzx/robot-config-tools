import { useEffect, useRef, useState } from "react";
import { App, Button, Card } from "antd";
import { UploadOutlined, DownloadOutlined } from "@ant-design/icons";
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
    actions: [
      { key: "import", label: "点表导入", desc: "导入设备区、屏柜点位" },
    ],
  },
  {
    key: "communication",
    title: "通信",
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

// 根据容器宽度计算列数，限制在 2~5 列之间
function calcColumns(width: number): number {
  if (width < 640) return 2;
  if (width < 960) return 3;
  if (width < 1280) return 4;
  return 5;
}

export default function ImportExport() {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setColumns(calcColumns(el.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleAction = (card: IECard, key: "import" | "export" | "export-log" | "export-error", label: string) => {
    const verb = key === "import" ? "导入" : "导出";
    message.info(`${verb}「${label || card.title}」（功能待接入）`);
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
          icon={act.key === "import" ? <UploadOutlined /> : <DownloadOutlined />}
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
          <Card key={card.key} className="ie-card" hoverable>
            <div className="ie-card-head">
              <span className="ie-card-bar" />
              <span className="ie-card-title">{card.title}</span>
            </div>
            {card.desc && <p className="ie-card-desc">{card.desc}</p>}
            <div className="ie-card-actions">{renderActions(card)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
