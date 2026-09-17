import { Button, InputNumber, Popover, Segmented, Slider } from "antd";
import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import {
  DEFAULT_SPACE_RENDER_SETTINGS,
  SPACE_COLOR_ADJUSTMENT_MAX,
  SPACE_COLOR_ADJUSTMENT_MIN,
  SPACE_COLOR_ADJUSTMENT_STEP,
  SPACE_GAMMA_MAX,
  SPACE_GAMMA_MIN,
  SPACE_GAMMA_STEP,
  SPACE_POINT_BUDGET_MAX,
  SPACE_POINT_BUDGET_ALL,
  SPACE_POINT_BUDGET_MIN,
  SPACE_POINT_BUDGET_STEP,
  type SpaceRenderDetailLevel,
  type SpaceRenderSettings,
} from "../engine/types";

interface PotreeRenderSettingsProps {
  settings: SpaceRenderSettings;
  onChange: (settings: SpaceRenderSettings) => void;
}

const DETAIL_OPTIONS = [
  { label: "低", value: 1 },
  { label: "标准", value: 2 },
  { label: "高", value: 3 },
  { label: "极高", value: 4 },
];

const pointCountFormatter = new Intl.NumberFormat("zh-CN");

function formatPointBudget(pointBudget: SpaceRenderSettings["pointBudget"]): string {
  return pointBudget === SPACE_POINT_BUDGET_ALL
    ? "全部"
    : pointCountFormatter.format(pointBudget);
}

function formatColorAdjustment(value: number): string {
  const percentage = Math.round(value * 100);
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
}

export default function PotreeRenderSettings({ settings, onChange }: PotreeRenderSettingsProps) {
  const defaultLimitedPointBudget = typeof DEFAULT_SPACE_RENDER_SETTINGS.pointBudget === "number"
    ? DEFAULT_SPACE_RENDER_SETTINGS.pointBudget
    : SPACE_POINT_BUDGET_MAX;
  const limitedPointBudget = typeof settings.pointBudget === "number"
    ? settings.pointBudget
    : defaultLimitedPointBudget;
  const content = (
    <div style={{ width: 280, display: "grid", gap: 18, padding: "4px 2px" }}>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ color: "#4b5563", fontSize: 13 }}>显示精细度</span>
        <Segmented
          block
          options={DETAIL_OPTIONS}
          value={settings.detailLevel}
          onChange={(value) => onChange({
            ...settings,
            detailLevel: Number(value) as SpaceRenderDetailLevel,
          })}
        />
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "#4b5563", fontSize: 13 }}>加载点数量</span>
          <span style={{ color: "#111827", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
            {formatPointBudget(settings.pointBudget)}
          </span>
        </div>
        <Segmented
          block
          options={[
            { label: "数量上限", value: "limited" },
            { label: "全部加载", value: SPACE_POINT_BUDGET_ALL },
          ]}
          value={settings.pointBudget === SPACE_POINT_BUDGET_ALL ? SPACE_POINT_BUDGET_ALL : "limited"}
          onChange={(value) => onChange({
            ...settings,
            pointBudget: value === SPACE_POINT_BUDGET_ALL
              ? SPACE_POINT_BUDGET_ALL
              : (typeof settings.pointBudget === "number" ? settings.pointBudget : defaultLimitedPointBudget),
          })}
        />
        {settings.pointBudget !== SPACE_POINT_BUDGET_ALL && (
          <Slider
            min={SPACE_POINT_BUDGET_MIN}
            max={SPACE_POINT_BUDGET_MAX}
            step={SPACE_POINT_BUDGET_STEP}
            value={limitedPointBudget}
            tooltip={{ formatter: (value) => pointCountFormatter.format(value || 0) }}
            onChange={(pointBudget: number) => onChange({ ...settings, pointBudget })}
          />
        )}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ color: "#4b5563", fontSize: 13 }}>画面调整</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            disabled={settings.gamma === DEFAULT_SPACE_RENDER_SETTINGS.gamma
              && settings.brightness === DEFAULT_SPACE_RENDER_SETTINGS.brightness
              && settings.contrast === DEFAULT_SPACE_RENDER_SETTINGS.contrast}
            onClick={() => onChange({
              ...settings,
              gamma: DEFAULT_SPACE_RENDER_SETTINGS.gamma,
              brightness: DEFAULT_SPACE_RENDER_SETTINGS.brightness,
              contrast: DEFAULT_SPACE_RENDER_SETTINGS.contrast,
            })}
          >
            重置
          </Button>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "#4b5563", fontSize: 13 }}>伽马</span>
            <InputNumber
              min={SPACE_GAMMA_MIN}
              max={SPACE_GAMMA_MAX}
              step={SPACE_GAMMA_STEP}
              precision={2}
              value={settings.gamma}
              onChange={(gamma) => {
                if (gamma !== null) onChange({ ...settings, gamma });
              }}
              style={{ width: 76 }}
            />
          </div>
          <Slider
            min={SPACE_GAMMA_MIN}
            max={SPACE_GAMMA_MAX}
            step={SPACE_GAMMA_STEP}
            value={settings.gamma}
            tooltip={{ formatter: (value) => Number(value ?? 1).toFixed(2) }}
            onChange={(gamma: number) => onChange({ ...settings, gamma })}
          />
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "#4b5563", fontSize: 13 }}>亮度</span>
            <span style={{ color: "#111827", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {formatColorAdjustment(settings.brightness)}
            </span>
          </div>
          <Slider
            min={SPACE_COLOR_ADJUSTMENT_MIN}
            max={SPACE_COLOR_ADJUSTMENT_MAX}
            step={SPACE_COLOR_ADJUSTMENT_STEP}
            value={settings.brightness}
            tooltip={{ formatter: (value) => formatColorAdjustment(value || 0) }}
            onChange={(brightness: number) => onChange({ ...settings, brightness })}
          />
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <span style={{ color: "#4b5563", fontSize: 13 }}>对比度</span>
            <span style={{ color: "#111827", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
              {formatColorAdjustment(settings.contrast)}
            </span>
          </div>
          <Slider
            min={SPACE_COLOR_ADJUSTMENT_MIN}
            max={SPACE_COLOR_ADJUSTMENT_MAX}
            step={SPACE_COLOR_ADJUSTMENT_STEP}
            value={settings.contrast}
            tooltip={{ formatter: (value) => formatColorAdjustment(value || 0) }}
            onChange={(contrast: number) => onChange({ ...settings, contrast })}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "absolute", right: 18, bottom: 18, zIndex: 5 }}>
      <Popover title="显示设置" content={content} trigger="click" placement="topRight">
        <Button
          aria-label="显示设置"
          title="显示设置"
          shape="circle"
          icon={<SettingOutlined />}
          style={{ boxShadow: "0 2px 10px rgba(0, 0, 0, 0.3)" }}
        />
      </Popover>
    </div>
  );
}
