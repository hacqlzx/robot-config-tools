import { useEffect, useMemo, useState } from "react";
import { Button, InputNumber, Progress, Spin } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import type { SpaceClipBounds } from "../engine/types";

interface PotreeClipControllerProps {
  bounds: SpaceClipBounds;
  saving: boolean;
  progress?: number;
  onChange: (bounds: SpaceClipBounds) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

type BoundKey = keyof SpaceClipBounds;

const FIELDS: { key: BoundKey; label: string }[] = [
  { key: "minX", label: "X 最小" },
  { key: "maxX", label: "X 最大" },
  { key: "minY", label: "Y 最小" },
  { key: "maxY", label: "Y 最大" },
  { key: "minZ", label: "Z 最小" },
  { key: "maxZ", label: "Z 最大" },
];

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

export default function PotreeClipController({
  bounds,
  saving,
  progress,
  onChange,
  onConfirm,
  onCancel,
}: PotreeClipControllerProps) {
  const [draft, setDraft] = useState(bounds);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(bounds), [bounds]);

  const valid = useMemo(() => (
    draft.minX < draft.maxX && draft.minY < draft.maxY && draft.minZ < draft.maxZ
  ), [draft]);

  const update = (key: BoundKey, value: number | null) => {
    if (value === null || !Number.isFinite(value)) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    setError(null);
    onChange(next);
  };

  const confirm = () => {
    if (!valid) {
      setError("隐藏范围必须大于零");
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
        width: "min(590px, calc(100% - 32px))",
        padding: "12px 14px",
        border: "1px solid #d9dde5",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.18)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {FIELDS.map(({ key, label }) => (
          <label key={key} style={{ display: "grid", gap: 4, minWidth: 0, color: "#5d6673", fontSize: 11 }}>
            <span>{label}</span>
            <InputNumber
              size="small"
              value={draft[key]}
              controls={false}
              precision={3}
              onChange={(value) => update(key, value)}
              disabled={saving}
              style={{ width: "100%" }}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, minHeight: 24 }}>
        <span style={{ flex: 1, color: error ? "#cf1322" : "#8a929e", fontSize: 11 }}>
          {error || `范围 ${formatValue(draft.maxX - draft.minX)} × ${formatValue(draft.maxY - draft.minY)} × ${formatValue(draft.maxZ - draft.minZ)}`}
        </span>
        {saving ? <Spin size="small" /> : (
          <>
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
