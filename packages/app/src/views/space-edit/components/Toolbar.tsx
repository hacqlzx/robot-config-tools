import { useRef } from "react";
import { UploadOutlined, TableOutlined, SaveOutlined, ScissorOutlined, BorderOutlined, ThunderboltOutlined, AppstoreOutlined, NodeIndexOutlined, CompassOutlined, ExportOutlined, ArrowLeftOutlined, ArrowRightOutlined, AimOutlined } from "@ant-design/icons";
import { POINT_TABLE_FILE_ACCEPT } from "../utils/space-paths";

interface Props {
  cabinetMode?: boolean;
  onToggleCabinet?: () => void;
  chargingMode?: boolean;
  onToggleCharging?: () => void;
  deviceAreaMode?: boolean;
  onToggleDeviceArea?: () => void;
  pathMode?: boolean;
  onTogglePath?: () => void;
  normalMode?: boolean;
  normalCount?: number;
  normalSaving?: boolean;
  onToggleNormal?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSaveAll?: () => void;
  /** 点击"空间模型加载"按钮时的回调，由父级控制弹窗的打开 */
  onOpenLoadModel?: () => void;
  onClipModel?: () => void;
  correctionMode?: boolean;
  onToggleCorrection?: () => void;
  onImportPointTable?: (file: File) => void;
  onExportModel?: () => void;
  /** 点表导入进行中，禁用点表加载按钮防止重复触发 */
  importing?: boolean;
}

/**
 * 工具栏按钮配置表。
 * action 字段与 handleClick 中的 switch 分支一一对应。
 * 绘制类按钮（cabinet/charging/deviceArea/path）支持激活态高亮。
 */
const BUTTONS = [
  { icon: <UploadOutlined style={{ fontSize: 20 }} />, label: "空间模型加载", action: "file" as const },
  { icon: <TableOutlined style={{ fontSize: 20 }} />, label: "点表加载", action: "point" as const },
  { icon: <SaveOutlined style={{ fontSize: 20 }} />, label: "保存全部", action: "saveAll" as const },
  { icon: <ArrowLeftOutlined style={{ fontSize: 20 }} />, label: "撤销", action: "undo" as const },
  { icon: <ArrowRightOutlined style={{ fontSize: 20 }} />, label: "恢复", action: "redo" as const },
  { icon: <ScissorOutlined style={{ fontSize: 20 }} />, label: "裁切模型", action: "clip" as const },
  { icon: <AimOutlined style={{ fontSize: 20 }} />, label: "坐标纠正", action: "correction" as const },
  { icon: <BorderOutlined style={{ fontSize: 20 }} />, label: "绘制屏柜", action: "cabinet" as const },
  { icon: <ThunderboltOutlined style={{ fontSize: 20 }} />, label: "绘制充电区域", action: "charging" as const },
  { icon: <AppstoreOutlined style={{ fontSize: 20 }} />, label: "绘制设备区域", action: "deviceArea" as const },
  { icon: <NodeIndexOutlined style={{ fontSize: 20 }} />, label: "可行路径设定", action: "path" as const },
  { icon: <CompassOutlined style={{ fontSize: 20 }} />, label: "法线标注", action: "normal" as const },
  { icon: <ExportOutlined style={{ fontSize: 20 }} />, label: "导出模型", action: "export" as const },
];

/**
 * 空间编辑页顶部工具栏。
 *
 * 设计说明：
 * - "空间模型加载"改为触发 onOpenLoadModel 回调，由父级弹窗处理文件选择和项目校验，
 *   不再使用隐藏 input[type=file]，避免在无项目时仍能触发文件选择。
 * - "点表加载"仍使用隐藏 input，因为点表导入不需要额外的弹窗交互。
 * - 绘制模式按钮互斥由父级 useDrawingModeToggles 控制，Toolbar 仅根据 mode 显示激活态。
 */
export default function Toolbar({ onOpenLoadModel, onClipModel, correctionMode, onToggleCorrection, cabinetMode, onToggleCabinet, chargingMode, onToggleCharging, deviceAreaMode, onToggleDeviceArea, pathMode, onTogglePath, normalMode, normalCount = 0, normalSaving, onToggleNormal, onUndo, onRedo, canUndo, canRedo, onSaveAll, onImportPointTable, onExportModel, importing }: Props) {
  const pointInputRef = useRef<HTMLInputElement>(null);

  /** 点表文件选中后立即触发导入，清空 input 值防止同名文件无法重复选择 */
  const handlePointFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImportPointTable?.(file);
    e.target.value = "";
  };

  /** 根据按钮 action 分发到对应的回调 */
  const handleClick = (action?: string) => {
    switch (action) {
      case "file": onOpenLoadModel?.(); break;       // 打开空间模型加载弹窗
      case "point": pointInputRef.current?.click(); break; // 触发点表文件选择
      case "clip": onClipModel?.(); break;
      case "correction": onToggleCorrection?.(); break;
      case "cabinet": onToggleCabinet?.(); break;
      case "charging": onToggleCharging?.(); break;
      case "deviceArea": onToggleDeviceArea?.(); break;
      case "path": onTogglePath?.(); break;
      case "normal": onToggleNormal?.(); break;
      case "undo": onUndo?.(); break;
      case "redo": onRedo?.(); break;
      case "saveAll": onSaveAll?.(); break;
      case "export": onExportModel?.(); break;
    }
  };

  return (
    <>
      {/* 工具栏按钮样式，注入全局 class 避免 styled-components 依赖 */}
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
          flex: 0 0 auto;
          min-width: 64px;
        }
        .space-edit-toolbar-btn.active { background: #1677ff; color: #fff; }
        .space-edit-toolbar-btn:hover {
          background: #e6f4ff;
          color: #1677ff;
        }
        .space-edit-toolbar-btn:disabled {
          cursor: not-allowed;
          color: #bfbfbf;
          background: transparent;
        }
        .space-edit-toolbar-btn:disabled:hover {
          color: #bfbfbf;
          background: transparent;
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "6px 12px",
        background: "#fff",
        borderBottom: "1px solid #e8e8e8",
        flexShrink: 0,
        overflowX: "auto",
      }}>
        {/* 点表文件选择器，隐藏在 DOM 中，由按钮点击触发 */}
        <input ref={pointInputRef} type="file" accept={POINT_TABLE_FILE_ACCEPT} onChange={handlePointFile} style={{ display: "none" }} />
        {BUTTONS.map(({ icon, label, action }) => {
          // 绘制模式按钮激活态判断
          const isActive = (action === "cabinet" && cabinetMode) ||
            (action === "charging" && chargingMode) ||
            (action === "deviceArea" && deviceAreaMode) ||
            (action === "path" && pathMode) ||
            (action === "correction" && correctionMode) ||
            (action === "normal" && normalMode);
          return (
            <button
              key={label}
              className={`space-edit-toolbar-btn${isActive ? " active" : ""}`}
              onClick={() => handleClick(action)}
              aria-label={`${label}${action === "normal" && normalCount > 0 ? `，已有 ${normalCount} 条` : ""}`}
              // 点表导入中禁用点表按钮；历史栈为空时禁用撤销/恢复
              disabled={(action === "point" && importing) || (action === "undo" && !canUndo) || (action === "redo" && !canRedo) || (action === "normal" && normalSaving)}
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
