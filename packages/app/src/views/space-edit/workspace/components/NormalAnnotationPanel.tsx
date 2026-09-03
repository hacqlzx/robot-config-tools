import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Spin } from "antd";
import { CloseOutlined, CompassOutlined, DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import type { DevicePoint } from "@robot/database";
import { useSelectedProject } from "@/stores/appContextStore";
import type { NormalAnnotationItem } from "../../hooks/drawing/drawing-schema";

interface NormalPoint {
  pointCode: string;
  pointName: string;
}

interface Props {
  items: NormalAnnotationItem[];
  selectedId: string | null;
  saving?: boolean;
  exporting?: boolean;
  onClose: () => void;
  onSelect: (item: NormalAnnotationItem) => void;
  onRename: (normalId: string, name: string) => void;
  onBindPoint: (normalId: string, point: NormalPoint) => void;
  onUnbindPoint: (normalId: string) => void;
  onDelete: (normalId: string) => void;
  onExport: (triggerElement?: HTMLElement) => void;
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

function pointLabel(point: NormalPoint): string {
  return point.pointName || point.pointCode;
}

export default function NormalAnnotationPanel({
  items,
  selectedId,
  saving = false,
  exporting = false,
  onClose,
  onSelect,
  onRename,
  onBindPoint,
  onUnbindPoint,
  onDelete,
  onExport,
}: Props) {
  const projectName = useSelectedProject();
  const [points, setPoints] = useState<DevicePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setNameDrafts((current) => {
      const next: Record<string, string> = {};
      items.forEach((item, index) => {
        next[item.id] = Object.prototype.hasOwnProperty.call(current, item.id)
          ? current[item.id]
          : item.name?.trim() || `法线 ${index + 1}`;
      });
      return next;
    });
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!projectName || !api?.db?.point) {
      setPoints([]);
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    api.db.point.list(projectName)
      .then((list) => {
        if (cancelled) return;
        setPoints(
          [...list]
            .filter((point) => String(point.pointCode || "").trim())
            .sort((left, right) => (
              Number(left.sortNum || 0) - Number(right.sortNum || 0)
              || String(left.pointName || "").localeCompare(String(right.pointName || ""))
            )),
        );
      })
      .catch(() => {
        if (!cancelled) setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectName]);

  const pointOptions = useMemo(
    () => points.map((point) => ({
      value: point.pointCode,
      label: pointLabel({ pointCode: point.pointCode, pointName: point.pointName }),
    })),
    [points],
  );
  const boundPointCodes = useMemo(
    () => new Set(items.map((item) => normalizePointCode(item.pointCode)).filter(Boolean)),
    [items],
  );

  return (
    <div
      className="normal-annotation-panel"
      data-space-edit-overlay="normal-panel"
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 420,
        maxWidth: "calc(100% - 32px)",
        background: "#fff",
        border: "1px solid #d9d9d9",
        borderRadius: 8,
        boxShadow: "0 4px 18px rgba(0, 0, 0, 0.24)",
        zIndex: 30,
        overflow: "hidden",
        userSelect: "none",
        pointerEvents: "auto",
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <style>{`
        .normal-annotation-panel-row:hover { background: #fafcff !important; }
        .normal-annotation-panel-row.selected:hover { background: #f0f7ff !important; }
        .normal-annotation-panel-row:focus-visible { outline: 2px solid #91caff; outline-offset: -2px; }
        .normal-annotation-panel .normal-name-input.ant-input,
        .normal-annotation-panel .normal-name-input.ant-input-affix-wrapper {
          color: #262626;
          font-size: 13px;
          font-weight: 600;
          line-height: 24px;
          padding: 0 4px;
          border: 0;
          box-shadow: none;
          background: transparent;
        }
        .normal-annotation-panel .normal-name-input.ant-input:hover,
        .normal-annotation-panel .normal-name-input.ant-input:focus {
          background: #fff;
          border: 1px solid #91caff;
          box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.08);
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "9px 12px",
          color: "#fff",
          background: "#1677ff",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <CompassOutlined />
          <span>法线标注</span>
          <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.86 }}>({items.length})</span>
        </span>
        <Button
          type="text"
          size="small"
          aria-label="关闭法线标注列表"
          title="关闭法线标注"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{ color: "#fff", width: 24, height: 24, padding: 0 }}
        />
      </div>

      {loading ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 120 }}>
          <Spin size="small" />
        </div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无法线标注" style={{ margin: "28px 0" }} />
      ) : (
        <div style={{ maxHeight: 470, overflowY: "auto", padding: "8px 12px 10px" }}>
          {items.map((item, index) => {
            const selected = item.id === selectedId;
            const currentPoint = item.pointCode
              ? points.find((point) => point.pointCode === item.pointCode)
              : undefined;
            const currentValue = item.pointCode || undefined;
            const options = pointOptions.map((option) => ({
              ...option,
              disabled: boundPointCodes.has(normalizePointCode(option.value))
                && normalizePointCode(option.value) !== normalizePointCode(currentValue),
            }));
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(item)}
                onKeyDown={(event) => {
                  if ((event.target as HTMLElement | null)?.closest("input,button,[role='combobox']")) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(item);
                  }
                }}
                className={`normal-annotation-panel-row${selected ? " selected" : ""}`}
                style={{
                  display: "grid",
                  gap: 8,
                  padding: "11px 4px 12px",
                  borderBottom: "1px solid #f0f0f0",
                  borderLeft: selected ? "3px solid #1677ff" : "3px solid transparent",
                  background: selected ? "#f0f7ff" : "transparent",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ color: selected ? "#1677ff" : "#8c8c8c", fontSize: 12, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Input
                    className="normal-name-input"
                    value={nameDrafts[item.id] ?? item.name?.trim() ?? `法线 ${index + 1}`}
                    aria-label={`法线 ${index + 1} 名称`}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={(event) => setNameDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    onBlur={() => {
                      const fallback = item.name?.trim() || `法线 ${index + 1}`;
                      const nextName = (nameDrafts[item.id] ?? fallback).trim() || fallback;
                      setNameDrafts((current) => ({ ...current, [item.id]: nextName }));
                      if (nextName !== (item.name?.trim() || fallback)) onRename(item.id, nextName);
                    }}
                    onPressEnter={(event) => event.currentTarget.blur()}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Button
                    type="text"
                    danger
                    size="small"
                    aria-label={`删除${item.name?.trim() || `法线 ${index + 1}`}`}
                    title="删除法线"
                    icon={<DeleteOutlined />}
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(item.id);
                    }}
                    style={{ width: 24, height: 24, padding: 0, marginLeft: item.pointCode ? 0 : "auto" }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, color: "#8c8c8c", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                  <span>X {formatCoordinate(item.origin[0])}</span>
                  <span>Y {formatCoordinate(item.origin[1])}</span>
                  <span>Z {formatCoordinate(item.origin[2])}</span>
                </div>
                <div onClick={(event) => event.stopPropagation()}>
                  <Select
                    size="small"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    value={currentValue}
                    placeholder="选择绑定点位"
                    options={options}
                    loading={loading}
                    disabled={saving}
                    notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无点位" style={{ margin: 8 }} />}
                    style={{ width: "100%" }}
                    onChange={(value) => {
                      if (!value) {
                        onUnbindPoint(item.id);
                        return;
                      }
                      const point = points.find((candidate) => candidate.pointCode === value);
                      if (point) onBindPoint(item.id, { pointCode: point.pointCode, pointName: point.pointName });
                    }}
                    optionRender={(option) => (
                      <span title={String(option.label)}>{option.label}</span>
                    )}
                  />
                </div>
                {item.pointCode && !currentPoint && (
                  <div style={{ color: "#fa8c16", fontSize: 11, wordBreak: "break-all" }}>
                    已绑定点位：{item.pointName || item.pointCode}（当前点表中未找到）
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "10px 12px 12px",
          borderTop: "1px solid #f0f0f0",
          background: "#fff",
        }}
      >
        <Button
          type="primary"
          size="small"
          icon={<DownloadOutlined />}
          loading={exporting}
          disabled={saving || exporting || loading || items.length === 0}
          onClick={(event) => {
            event.stopPropagation();
            onExport(event.currentTarget);
          }}
        >
          导出
        </Button>
      </div>
    </div>
  );
}

function normalizePointCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}
