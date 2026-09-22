import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Select, Spin } from "antd";
import { CloseOutlined, DeleteOutlined, EnvironmentOutlined } from "@ant-design/icons";
import type { DevicePoint } from "@robot/database";
import { useSelectedProject } from "@/stores/appContextStore";
import type { InspectionPointItem } from "../../hooks/drawing/drawing-schema";
import { SpaceShortcutHelpButton } from "./SpaceShortcutHelp";

interface Props {
  item: InspectionPointItem | null;
  count: number;
  items: InspectionPointItem[];
  marking: boolean;
  saving?: boolean;
  bayFilter?: string;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onSave: () => void;
  onBayFilterChange: (value: string | undefined) => void;
  onBindPoint: (id: string, point: { pointCode: string; pointName: string; bayCode?: string; bayName?: string }) => void;
  onUnbindPoint: (id: string) => void;
  onDelete: (id: string) => void;
}

function normalizeCode(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }

function pointDisplayName(point: Pick<DevicePoint, "pointName">): string {
  return String(point.pointName || "").trim() || "未命名点位";
}

function pointOptionLabel(point: DevicePoint): string {
  const name = pointDisplayName(point);
  const context = [point.mainDeviceName, point.componentName]
    .map((value) => String(value || "").trim())
    .filter((value, index, values) => value && value !== name && values.indexOf(value) === index);
  return context.length > 0 ? `${name}（${context.join(" / ")}）` : name;
}

function pointBayKey(point: DevicePoint): string {
  const bayCode = String(point.bayCode || "").trim();
  if (bayCode) return `code:${bayCode}`;
  if (Number.isFinite(point.bayId) && point.bayId > 0) return `id:${point.bayId}`;
  const bayName = String(point.bayName || "").trim();
  return bayName ? `name:${bayName}` : "";
}

export default function InspectionPointPanel({ item, count, items, marking, saving = false, bayFilter, onClose, onRename, onSave, onBayFilterChange, onBindPoint, onUnbindPoint, onDelete }: Props) {
  const projectName = useSelectedProject();
  const [points, setPoints] = useState<DevicePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => { setNameDraft(item?.name?.trim() || ""); }, [item?.id, item?.name]);
  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!projectName || !api?.db?.point) { setPoints([]); return () => { cancelled = true; }; }
    setLoading(true);
    api.db.point.list(projectName)
      .then((list) => { if (!cancelled) setPoints([...list].filter((point) => String(point.pointCode || "").trim()).sort((a, b) => Number(a.sortNum || 0) - Number(b.sortNum || 0))); })
      .catch(() => { if (!cancelled) setPoints([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectName]);

  const boundCodes = useMemo(() => new Set(items.map((candidate) => normalizeCode(candidate.pointCode)).filter(Boolean)), [items]);
  const options = useMemo(() => {
    const next = points
      .filter((point) => !bayFilter
      || pointBayKey(point) === bayFilter
      || normalizeCode(point.pointCode) === normalizeCode(item?.pointCode))
      .map((point) => ({
        value: point.pointCode,
        label: pointOptionLabel(point),
        disabled: boundCodes.has(normalizeCode(point.pointCode)) && normalizeCode(point.pointCode) !== normalizeCode(item?.pointCode),
      }));
    const currentCode = normalizeCode(item?.pointCode);
    if (currentCode && !next.some((option) => normalizeCode(option.value) === currentCode)) {
      next.unshift({
        value: item?.pointCode || "",
        label: item?.pointName?.trim() || item?.name?.trim() || "未命名点位",
        disabled: false,
      });
    }
    return next;
  }, [bayFilter, boundCodes, item?.name, item?.pointCode, item?.pointName, points]);
  const bayOptions = useMemo(() => {
    const bays = new Map<string, { value: string; label: string }>();
    points.forEach((point) => {
      const value = pointBayKey(point);
      if (!value || bays.has(value)) return;
      const bayName = String(point.bayName || "").trim();
      const bayCode = String(point.bayCode || "").trim();
      bays.set(value, { value, label: bayName || bayCode || `间隔 ${point.bayId}` });
    });
    return [...bays.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN", { numeric: true }));
  }, [points]);

  return (
    <div data-space-edit-overlay="inspection-point-panel" style={{ position: "absolute", top: 16, right: 16, width: 360, maxWidth: "calc(100% - 32px)", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 8, boxShadow: "0 4px 18px rgba(0,0,0,.24)", zIndex: 30, overflow: "hidden", userSelect: "none", pointerEvents: "auto" }} onMouseDown={(event) => event.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", color: "#fff", background: "#1677ff", fontSize: 13, fontWeight: 600 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><EnvironmentOutlined /><span>{marking ? "巡检点标注" : "巡检点"}</span><span style={{ fontSize: 12, fontWeight: 400, opacity: .86 }}>({count})</span></span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {marking && <SpaceShortcutHelpButton inverse />}
          <Button type="text" size="small" aria-label="关闭巡检点面板" title="关闭" icon={<CloseOutlined />} onClick={onClose} style={{ color: "#fff", width: 24, height: 24, padding: 0 }} />
        </span>
      </div>
      {loading ? (
        <div style={{ display: "grid", placeItems: "center", minHeight: 150 }}><Spin size="small" /></div>
      ) : !item ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择巡检点" style={{ margin: "30px 0" }} />
      ) : (
        <div style={{ display: "grid", gap: 14, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Input value={nameDraft} disabled={saving} aria-label="巡检点名称" placeholder="巡检点名称" onChange={(event) => setNameDraft(event.target.value)} onPressEnter={(event) => event.currentTarget.blur()} onBlur={() => { const fallback = item.name?.trim() || "巡检点"; const next = nameDraft.trim() || fallback; setNameDraft(next); if (next !== item.name?.trim()) onRename(item.id, next); }} />
            <Button danger type="text" disabled={saving} aria-label="删除巡检点" title="删除巡检点" icon={<DeleteOutlined />} onClick={() => onDelete(item.id)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#595959", fontSize: 12, whiteSpace: "nowrap" }}>间隔筛选</span>
            <Select
              size="small"
              allowClear
              showSearch
              optionFilterProp="label"
              value={bayFilter}
              options={bayOptions}
              disabled={saving || loading}
              placeholder="全部间隔"
              style={{ width: "100%" }}
              onChange={onBayFilterChange}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#595959", fontSize: 12, whiteSpace: "nowrap" }}>绑定点位 <span style={{ color: "#ff4d4f" }}>*</span></span>
            <Select size="small" allowClear showSearch optionFilterProp="label" value={item.pointCode || undefined} options={options} loading={loading} disabled={saving} placeholder="选择点位（可搜索）" style={{ width: "100%" }} notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无点位" style={{ margin: 8 }} />} onChange={(value) => { if (!value) { onUnbindPoint(item.id); return; } const point = points.find((candidate) => candidate.pointCode === value); if (point) onBindPoint(item.id, { pointCode: point.pointCode, pointName: point.pointName, bayCode: point.bayCode, bayName: point.bayName }); }} />
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "10px 14px", borderTop: "1px solid #f0f0f0", background: "#fff" }}>
        <Button type="primary" size="small" onClick={onSave} loading={saving} disabled={saving || items.length === 0}>保存</Button>
      </div>
    </div>
  );
}
