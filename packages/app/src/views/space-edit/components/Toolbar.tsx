import { useRef } from "react";
import { UploadOutlined, TableOutlined, SaveOutlined, ScissorOutlined, BorderOutlined, ThunderboltOutlined, AppstoreOutlined, NodeIndexOutlined, ExportOutlined } from "@ant-design/icons";
import { message } from "antd";

interface Props {
  cabinetMode?: boolean;
  onToggleCabinet?: () => void;
  chargingMode?: boolean;
  onToggleCharging?: () => void;
  deviceAreaMode?: boolean;
  onToggleDeviceArea?: () => void;
  pathMode?: boolean;
  onTogglePath?: () => void;
  onSaveAll?: () => void;
  onFileSelect: (file: File) => void;
  onClipModel?: () => void;
  onImportPointTable?: (file: File) => void;
  onExportModel?: () => void;
  importing?: boolean;
}

const BUTTONS = [
  { icon: <UploadOutlined style={{ fontSize: 20 }} />, label: "空间模型加载", action: "file" as const },
  { icon: <TableOutlined style={{ fontSize: 20 }} />, label: "点表加载", action: "point" as const },
  { icon: <SaveOutlined style={{ fontSize: 20 }} />, label: "保存全部", action: "saveAll" as const },
  { icon: <ScissorOutlined style={{ fontSize: 20 }} />, label: "裁切模型", action: "clip" as const },
  { icon: <BorderOutlined style={{ fontSize: 20 }} />, label: "绘制屏柜", action: "cabinet" as const },
  { icon: <ThunderboltOutlined style={{ fontSize: 20 }} />, label: "绘制充电区域", action: "charging" as const },
  { icon: <AppstoreOutlined style={{ fontSize: 20 }} />, label: "绘制设备区域", action: "deviceArea" as const },
  { icon: <NodeIndexOutlined style={{ fontSize: 20 }} />, label: "可行路径设定", action: "path" as const },
  { icon: <ExportOutlined style={{ fontSize: 20 }} />, label: "导出模型", action: "export" as const },
];

export default function Toolbar({ onFileSelect, onClipModel, cabinetMode, onToggleCabinet, chargingMode, onToggleCharging, deviceAreaMode, onToggleDeviceArea, pathMode, onTogglePath, onSaveAll, onImportPointTable, onExportModel, importing }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pointInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.(las|laz)$/i.test(file.name)) {
      message.warning("仅支持 LAS/LAZ 模型文件");
      e.target.value = "";
      return;
    }

    const selectedProject = localStorage.getItem("selectedProject");
    if (!selectedProject) {
      message.warning("请先在顶部菜单栏选择一个项目");
      e.target.value = "";
      return;
    }

    onFileSelect(file);
    e.target.value = "";
  };

  const handlePointFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImportPointTable?.(file);
    e.target.value = "";
  };

  const handleClick = (action?: string) => {
    switch (action) {
      case "file": fileInputRef.current?.click(); break;
      case "point": pointInputRef.current?.click(); break;
      case "clip": onClipModel?.(); break;
      case "cabinet": onToggleCabinet?.(); break;
      case "charging": onToggleCharging?.(); break;
      case "deviceArea": onToggleDeviceArea?.(); break;
      case "path": onTogglePath?.(); break;
      case "saveAll": onSaveAll?.(); break;
      case "export": onExportModel?.(); break;
    }
  };

  return (
    <>
      <style>{`
        .space-edit-toolbar-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          border: none;
          background: transparent;
          cursor: pointer;
          color: #333;
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .space-edit-toolbar-btn.active { background: #1677ff; color: #fff; }
        .space-edit-toolbar-btn:hover {
          background: #e6f4ff;
          color: #1677ff;
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 12px",
        background: "#fff",
        borderBottom: "1px solid #e8e8e8",
        flexShrink: 0,
      }}>
        <input ref={fileInputRef} type="file" accept=".las,.laz" onChange={handleFile} style={{ display: "none" }} />
        <input ref={pointInputRef} type="file" accept=".xlsx,.xls" onChange={handlePointFile} style={{ display: "none" }} />
        {BUTTONS.map(({ icon, label, action }) => {
          const isActive = (action === "cabinet" && cabinetMode) ||
            (action === "charging" && chargingMode) ||
            (action === "deviceArea" && deviceAreaMode) ||
            (action === "path" && pathMode);
          return (
            <button
              key={label}
              className={`space-edit-toolbar-btn${isActive ? " active" : ""}`}
              onClick={() => handleClick(action)}
              disabled={action === "point" && importing}
            >
              {icon}
              <span>{label}{action === "point" && importing ? "..." : ""}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
