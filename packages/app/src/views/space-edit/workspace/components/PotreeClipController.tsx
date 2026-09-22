import { useEffect, useMemo, useState } from "react";
import { Button, InputNumber, Progress, Spin, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  RotateRightOutlined,
} from "@ant-design/icons";
import type { SpaceClipBox } from "../engine/types";

interface PotreeClipControllerProps {
  box: SpaceClipBox;
  saving: boolean;
  progress?: number;
  rotationVisible: boolean;
  onChange: (box: SpaceClipBox) => void;
  onRotationVisibleChange: (visible: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

type ClipBoxKey = keyof SpaceClipBox;
type FieldDefinition = {
  key: ClipBoxKey;
  label: "X" | "Y" | "Z";
  color: string;
  degrees?: boolean;
};

const AXIS_COLORS = {
  X: "#d4380d",
  Y: "#237804",
  Z: "#0958d9",
} as const;

const FIELD_GROUPS: { label: string; fields: FieldDefinition[] }[] = [
  {
    label: "中心",
    fields: [
      { key: "centerX", label: "X", color: AXIS_COLORS.X },
      { key: "centerY", label: "Y", color: AXIS_COLORS.Y },
      { key: "centerZ", label: "Z", color: AXIS_COLORS.Z },
    ],
  },
  {
    label: "尺寸",
    fields: [
      { key: "sizeX", label: "X", color: AXIS_COLORS.X },
      { key: "sizeY", label: "Y", color: AXIS_COLORS.Y },
      { key: "sizeZ", label: "Z", color: AXIS_COLORS.Z },
    ],
  },
  {
    label: "旋转",
    fields: [
      { key: "rotationX", label: "X", color: AXIS_COLORS.X, degrees: true },
      { key: "rotationY", label: "Y", color: AXIS_COLORS.Y, degrees: true },
      { key: "rotationZ", label: "Z", color: AXIS_COLORS.Z, degrees: true },
    ],
  },
];

const radiansToDegrees = (value: number) => value * 180 / Math.PI;
const degreesToRadians = (value: number) => value * Math.PI / 180;

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

export default function PotreeClipController({
  box,
  saving,
  progress,
  rotationVisible,
  onChange,
  onRotationVisibleChange,
  onConfirm,
  onCancel,
}: PotreeClipControllerProps) {
  const [draft, setDraft] = useState(box);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(box), [box]);

  const valid = useMemo(() => (
    draft.sizeX > 0 && draft.sizeY > 0 && draft.sizeZ > 0
  ), [draft]);

  const update = (key: ClipBoxKey, value: number | null, degrees = false) => {
    if (value === null || !Number.isFinite(value)) return;
    const next = { ...draft, [key]: degrees ? degreesToRadians(value) : value };
    setDraft(next);
    setError(null);
    onChange(next);
  };

  const resetRotation = () => {
    const next = { ...draft, rotationX: 0, rotationY: 0, rotationZ: 0 };
    setDraft(next);
    setError(null);
    onChange(next);
  };

  const confirm = () => {
    if (!valid) {
      setError("包围盒尺寸必须大于零");
      return;
    }
    onConfirm();
  };

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 16,
        transform: "translateX(-50%)",
        zIndex: 20,
        width: "min(650px, calc(100% - 32px))",
        padding: "12px 14px",
        border: "1px solid #d9dde5",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.18)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button
          type={rotationVisible ? "primary" : "default"}
          icon={<RotateRightOutlined />}
          disabled={saving}
          aria-pressed={rotationVisible}
          onClick={() => onRotationVisibleChange(!rotationVisible)}
        >
          {rotationVisible ? "隐藏旋转" : "显示旋转"}
        </Button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "48px repeat(3, minmax(0, 1fr))", gap: "7px 10px", alignItems: "end" }}>
        {FIELD_GROUPS.map((group) => (
          <div key={group.label} style={{ display: "contents" }}>
            <span style={{ alignSelf: "center", color: "#5d6673", fontSize: 12 }}>{group.label}</span>
            {group.fields.map(({ key, label, color, degrees }) => (
              <label key={key} style={{ display: "grid", gap: 3, minWidth: 0, fontSize: 11 }}>
                <span style={{ color, fontWeight: 600 }}>{label}{degrees ? " (°)" : ""}</span>
                <InputNumber
                  size="small"
                  value={degrees ? radiansToDegrees(draft[key]) : draft[key]}
                  controls={false}
                  precision={degrees ? 1 : 3}
                  step={degrees ? 1 : 0.01}
                  onChange={(value) => update(key, value, degrees)}
                  disabled={saving}
                  style={{ width: "100%" }}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, minHeight: 24 }}>
        <span style={{ flex: 1, color: error ? "#cf1322" : "#8a929e", fontSize: 11 }}>
          {error || `尺寸 ${formatValue(draft.sizeX)} × ${formatValue(draft.sizeY)} × ${formatValue(draft.sizeZ)}`}
        </span>
        {saving ? <Spin size="small" /> : (
          <>
            <Tooltip title="重置旋转">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                aria-label="重置旋转"
                onClick={resetRotation}
              />
            </Tooltip>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={confirm} disabled={!valid}>
              保存
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={onCancel}>
              取消
            </Button>
          </>
        )}
      </div>
      {saving && typeof progress === "number" && <Progress percent={Math.round(progress)} size="small" showInfo={false} />}
    </div>
  );
}
