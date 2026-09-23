import { useRef } from "react";
import { useState } from "react";
import { TableOutlined, SaveOutlined, BorderOutlined, ThunderboltOutlined, AppstoreOutlined, NodeIndexOutlined, EnvironmentOutlined, ExportOutlined, ImportOutlined, ArrowLeftOutlined, ArrowRightOutlined, AimOutlined, EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { POINT_TABLE_FILE_ACCEPT, POINT_TABLE_FILE_RE } from "../utils/space-paths";

interface Props {
  cabinetMode?: boolean;
  onToggleCabinet?: () => void;
  chargingMode?: boolean;
  onToggleCharging?: () => void;
  deviceAreaMode?: boolean;
  onToggleDeviceArea?: () => void;
  pathMode?: boolean;
  onTogglePath?: () => void;
  inspectionMode?: boolean;
  inspectionCount?: number;
  inspectionNamesVisible?: boolean;
  inspectionSaving?: boolean;
  inspectionImporting?: boolean;
  inspectionExporting?: boolean;
  onToggleInspection?: () => void;
  onToggleInspectionNames?: () => void;
  onImportInspection?: (file: File) => void;
  onExportInspection?: (triggerElement?: HTMLElement) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSaveAll?: () => void;
  /** 点击"空间模型加载"按钮时的回调，由父级控制弹窗的打开 */
  onOpenLoadModel?: () => void;
  correctionMode?: boolean;
  onToggleCorrection?: () => void;
  onImportPointTable?: (file: File) => void;
  onExportModel?: () => void;
  /** 点表导入进行中，禁用点表加载按钮防止重复触发 */
  importing?: boolean;
  /** 模型导入、转换、加载或替换进行中，暂时锁定工具栏 */
  modelBusy?: boolean;
}

/**
 * 工具栏按钮配置表。
 * action 字段与 handleClick 中的 switch 分支一一对应。
 * 绘制类按钮（cabinet/charging/deviceArea/path）支持激活态高亮。
 */
const BUTTON_GROUPS = [
  {
    label: "数据加载",
    buttons: [
      { icon: <ImportOutlined style={{ fontSize: 20 }} />, label: "空间模型加载", action: "file" as const },
      { icon: <ExportOutlined style={{ fontSize: 20 }} />, label: "空间模型导出", action: "export" as const },
      { icon: <TableOutlined style={{ fontSize: 20 }} />, label: "点表加载", action: "point" as const },
    ],
  },
  {
    label: "编辑操作",
    buttons: [
      { icon: <SaveOutlined style={{ fontSize: 20 }} />, label: "保存全部", action: "saveAll" as const },
      { icon: <ArrowLeftOutlined style={{ fontSize: 20 }} />, label: "撤销", action: "undo" as const },
      { icon: <ArrowRightOutlined style={{ fontSize: 20 }} />, label: "恢复", action: "redo" as const },
    ],
  },
  {
    label: "空间配置",
    buttons: [
      { icon: <AimOutlined style={{ fontSize: 20 }} />, label: "坐标纠正", action: "correction" as const },
      { icon: <BorderOutlined style={{ fontSize: 20 }} />, label: "绘制屏柜", action: "cabinet" as const },
      { icon: <ThunderboltOutlined style={{ fontSize: 20 }} />, label: "绘制充电区域", action: "charging" as const },
      { icon: <AppstoreOutlined style={{ fontSize: 20 }} />, label: "绘制设备区域", action: "deviceArea" as const },
      { icon: <NodeIndexOutlined style={{ fontSize: 20 }} />, label: "可行路径设定", action: "path" as const },
    ],
  },
  {
    label: "巡检点",
    buttons: [
      { icon: <EnvironmentOutlined style={{ fontSize: 20 }} />, label: "巡检点标注", action: "inspection" as const },
      { icon: <EyeOutlined style={{ fontSize: 20 }} />, label: "巡检点名称", action: "inspectionNames" as const },
      { icon: <ImportOutlined style={{ fontSize: 20 }} />, label: "巡检点导入", action: "inspectionImport" as const },
      { icon: <ExportOutlined style={{ fontSize: 20 }} />, label: "巡检点导出", action: "inspectionExport" as const },
    ],
  },
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
export default function Toolbar({ onOpenLoadModel, correctionMode, onToggleCorrection, cabinetMode, onToggleCabinet, chargingMode, onToggleCharging, deviceAreaMode, onToggleDeviceArea, pathMode, onTogglePath, inspectionMode, inspectionCount = 0, inspectionNamesVisible = true, inspectionSaving, inspectionImporting, inspectionExporting, onToggleInspection, onToggleInspectionNames, onImportInspection, onExportInspection, onUndo, onRedo, canUndo, canRedo, onSaveAll, onImportPointTable, onExportModel, importing, modelBusy }: Props) {
  const pointInputRef = useRef<HTMLInputElement>(null);
  const inspectionInputRef = useRef<HTMLInputElement>(null);
  const [pointDropActive, setPointDropActive] = useState(false);

  /** 点表文件选中后立即触发导入，清空 input 值防止同名文件无法重复选择 */
  const handlePointFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImportPointTable?.(file);
    e.target.value = "";
  };

  const canImportPointFile = !modelBusy && !importing;

  const handlePointDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canImportPointFile) return;
    const hasPointTable = Array.from(event.dataTransfer.files).some((file) => POINT_TABLE_FILE_RE.test(file.name));
    setPointDropActive(hasPointTable);
    event.dataTransfer.dropEffect = hasPointTable ? "copy" : "none";
  };

  const handlePointDragLeave = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setPointDropActive(false);
  };

  const handlePointDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setPointDropActive(false);
    if (!canImportPointFile) return;
    const file = Array.from(event.dataTransfer.files).find((candidate) => POINT_TABLE_FILE_RE.test(candidate.name));
    if (file) onImportPointTable?.(file);
  };

  const handleInspectionFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onImportInspection?.(file);
    event.target.value = "";
  };

  /** 根据按钮 action 分发到对应的回调 */
  const handleClick = (action?: string, triggerElement?: HTMLElement) => {
    switch (action) {
      case "file": onOpenLoadModel?.(); break;       // 打开空间模型加载弹窗
      case "point": pointInputRef.current?.click(); break; // 触发点表文件选择
      case "correction": onToggleCorrection?.(); break;
      case "cabinet": onToggleCabinet?.(); break;
      case "charging": onToggleCharging?.(); break;
      case "deviceArea": onToggleDeviceArea?.(); break;
      case "path": onTogglePath?.(); break;
      case "inspection": onToggleInspection?.(); break;
      case "inspectionNames": onToggleInspectionNames?.(); break;
      case "inspectionImport": inspectionInputRef.current?.click(); break;
      case "inspectionExport": onExportInspection?.(triggerElement); break;
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
        .space-edit-toolbar-btn.drop-active {
          background: #e6f4ff;
          color: #1677ff;
          outline: 1px dashed #1677ff;
          outline-offset: -2px;
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
        .space-edit-toolbar-group {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
        }
        .space-edit-toolbar-divider {
          width: 1px;
          height: 40px;
          margin: 0 8px;
          background: #d9d9d9;
          flex: 0 0 auto;
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center",
        padding: "6px 12px",
        background: "#fff",
        borderBottom: "1px solid #e8e8e8",
        flexShrink: 0,
        overflowX: "auto",
      }}>
        {/* 点表文件选择器，隐藏在 DOM 中，由按钮点击触发 */}
        <input ref={pointInputRef} type="file" accept={POINT_TABLE_FILE_ACCEPT} onChange={handlePointFile} style={{ display: "none" }} />
        <input ref={inspectionInputRef} type="file" accept=".xlsx,.xls" onChange={handleInspectionFile} style={{ display: "none" }} />
        {BUTTON_GROUPS.map((group, groupIndex) => (
          <div key={group.label} style={{ display: "flex", alignItems: "center", flex: "0 0 auto" }}>
            {groupIndex > 0 && <div className="space-edit-toolbar-divider" aria-hidden="true" />}
            <div className="space-edit-toolbar-group" role="group" aria-label={group.label}>
              {group.buttons.map(({ icon, label, action }) => {
                const isInspectionNamesAction = action === "inspectionNames";
                const buttonLabel = isInspectionNamesAction
                  ? (inspectionNamesVisible ? "隐藏名称" : "显示名称")
                  : label;
                const isActive = (action === "cabinet" && cabinetMode) ||
                  (action === "charging" && chargingMode) ||
                  (action === "deviceArea" && deviceAreaMode) ||
                  (action === "path" && pathMode) ||
                  (action === "correction" && correctionMode) ||
                  (action === "inspection" && inspectionMode) ||
                  (isInspectionNamesAction && !inspectionNamesVisible);
                const buttonIcon = isInspectionNamesAction
                  ? (inspectionNamesVisible
                    ? <EyeOutlined style={{ fontSize: 20 }} />
                    : <EyeInvisibleOutlined style={{ fontSize: 20 }} />)
                  : icon;
                const isPointAction = action === "point";
                return (
                  <button
                    key={action}
                    className={`space-edit-toolbar-btn${isActive ? " active" : ""}${isPointAction && pointDropActive ? " drop-active" : ""}`}
                    onClick={(event) => handleClick(action, event.currentTarget)}
                    onDragOver={isPointAction ? handlePointDragOver : undefined}
                    onDragLeave={isPointAction ? handlePointDragLeave : undefined}
                    onDrop={isPointAction ? handlePointDrop : undefined}
                    aria-label={`${buttonLabel}${action === "inspection" && inspectionCount > 0 ? `，已有 ${inspectionCount} 个` : ""}`}
                    title={isInspectionNamesAction ? `${inspectionNamesVisible ? "隐藏" : "显示"}巡检点名称` : undefined}
                    disabled={modelBusy || (action === "point" && importing) || (action === "undo" && !canUndo) || (action === "redo" && !canRedo) || (action === "inspection" && (inspectionSaving || inspectionImporting)) || (isInspectionNamesAction && inspectionCount === 0) || (action === "inspectionImport" && (inspectionSaving || inspectionImporting || inspectionExporting)) || (action === "inspectionExport" && (inspectionSaving || inspectionImporting || inspectionExporting || inspectionCount === 0))}
                  >
                    {buttonIcon}
                    <span>{buttonLabel}{action === "point" && importing ? "..." : action === "inspectionImport" && inspectionImporting ? "..." : action === "inspectionExport" && inspectionExporting ? "..." : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
