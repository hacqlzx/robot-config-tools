import frontRaw from "@/assets/svg/front.svg?raw";
import backRaw from "@/assets/svg/back.svg?raw";
import leftRaw from "@/assets/svg/left.svg?raw";
import rightRaw from "@/assets/svg/right.svg?raw";
import topRaw from "@/assets/svg/top.svg?raw";
import bottomRaw from "@/assets/svg/bottom.svg?raw";
import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import type { ViewDirection } from "../types";

function svgDataUri(raw: string) {
  return `data:image/svg+xml,${encodeURIComponent(raw)}`;
}

const ICONS: Record<ViewDirection, string> = {
  前: svgDataUri(frontRaw),
  后: svgDataUri(backRaw),
  左: svgDataUri(leftRaw),
  右: svgDataUri(rightRaw),
  上: svgDataUri(topRaw),
  下: svgDataUri(bottomRaw),
};


interface Props {
  onViewChange?: (direction: ViewDirection) => void;
  hideMode?: boolean;
  modelHidden?: boolean;
  modelBusy?: boolean;
  canHideModel?: boolean;
  onToggleHide?: () => void;
  onRestoreModel?: () => void;
}

const DIRECTIONS: ViewDirection[] = ["前", "后", "左", "右", "上", "下"];

export default function ViewCube({ onViewChange, hideMode, modelHidden, modelBusy, canHideModel, onToggleHide, onRestoreModel }: Props) {
  return (
    <>
      <style>{`
        .space-edit-view-btn {
          width: 28px;
          height: 28px;
          border: 1px solid #d9d9d9;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
          padding: 3px;
          color: #595959;
        }
        .space-edit-view-btn img {
          width: 100%;
          height: 100%;
          opacity: 0.55;
          transition: opacity 0.15s;
        }
        .space-edit-view-btn:hover {
          background: #1677ff;
          border-color: #1677ff;
          color: #fff;
        }
        .space-edit-view-btn:hover img {
          opacity: 1;
          filter: brightness(10);
        }
        .space-edit-view-btn.active {
          background: #1677ff;
          border-color: #1677ff;
          color: #fff;
        }
        .space-edit-view-btn:disabled,
        .space-edit-view-btn:disabled:hover {
          cursor: not-allowed;
          color: #bfbfbf;
          background: transparent;
          border-color: #e8e8e8;
        }
        .space-edit-view-btn.active:disabled {
          background: #1677ff;
          border-color: #1677ff;
          color: #fff;
        }
        .space-edit-view-divider {
          width: 24px;
          height: 1px;
          margin: 4px auto;
          background: #d9d9d9;
          flex: 0 0 auto;
        }
      `}</style>
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 6px",
        background: "#fff",
        borderRight: "1px solid #e8e8e8",
        flexShrink: 0,
      }}>
        {DIRECTIONS.map((v) => (
          <button
            key={v}
            className="space-edit-view-btn"
            type="button"
            aria-label={`${v}视角`}
            title={`${v}视角`}
            onClick={() => onViewChange?.(v)}
          >
            <img src={ICONS[v]} alt={v} />
          </button>
        ))}
        <div className="space-edit-view-divider" aria-hidden="true" />
        <button
          className={`space-edit-view-btn${hideMode ? " active" : ""}`}
          type="button"
          aria-label="隐藏模型"
          aria-pressed={hideMode}
          title="隐藏模型"
          disabled={!canHideModel || modelBusy}
          onClick={onToggleHide}
        >
          <EyeInvisibleOutlined style={{ fontSize: 17 }} />
        </button>
        <button
          className="space-edit-view-btn"
          type="button"
          aria-label="恢复模型"
          title="恢复模型"
          disabled={!modelHidden || modelBusy}
          onClick={onRestoreModel}
        >
          <EyeOutlined style={{ fontSize: 17 }} />
        </button>
      </div>
    </>
  );
}
