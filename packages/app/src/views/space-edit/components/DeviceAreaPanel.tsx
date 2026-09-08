import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Select, Table, InputNumber } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import type { DeviceBay } from "@robot/database";
import { useSelectedProject } from "@/stores/appContextStore";

interface Props {
  boxCount: number;
  boundBoxCount: number;
  height: number;
  selectedBoxId: string | null;
  selectedBoxBay: { id: number; name: string; code: string } | null;
  onClose: () => void;
  onSave: () => void;
  onSetHeight: (h: number) => void;
  onBindBay: (bay: { id: number; name: string; code: string }) => void;
  onUnbind: () => void;
  /** 已绑定的间隔 ID 列表（用于禁用已绑定项） */
  boundBayIds: Set<number>;
  saving?: boolean;
}

export default function DeviceAreaPanel({
  boxCount, boundBoxCount, height, selectedBoxId, selectedBoxBay,
  onClose, onSave, onSetHeight, onBindBay, onUnbind, boundBayIds, saving = false,
}: Props) {
  const projectName = useSelectedProject();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [areaId, setAreaId] = useState<number | undefined>();
  const [voltList, setVoltList] = useState<DeviceBay[]>([]);
  const [allBays, setAllBays] = useState<DeviceBay[]>([]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api || !projectName) {
      setVoltList([]);
      setAllBays([]);
      return;
    }
    Promise.all([
      api.db.voltage.list(projectName),
      api.db.bay.list(projectName),
    ]).then(([volts, bays]: [DeviceBay[], DeviceBay[]]) => {
      setVoltList(volts);
      setAllBays(bays);
    }).catch(() => {});
  }, [projectName]);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setOffset({ x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [offset]);

  const areaOptions = voltList.map((v) => ({ value: v.id, label: v.voltName }));
  const bayList = allBays.filter((b) =>
    b.bayType === "设备区" && (!areaId || b.voltId === areaId),
  );

  const columns = [
    { title: "序号", width: 60, render: (_: any, __: any, idx: number) => idx + 1 },
    { title: "间隔名称", dataIndex: "bayName", ellipsis: true },
    {
      title: "操作",
      width: 80,
      render: (_: any, record: DeviceBay) => {
        const isBoundToSelected = selectedBoxBay?.id === record.id;
        const isBoundToOther = !isBoundToSelected && boundBayIds.has(record.id);
        if (isBoundToSelected) {
          return <Button size="small" danger disabled={saving} onClick={() => onUnbind()}>解绑</Button>;
        }
        return (
          <Button size="small" type="primary" disabled={saving || isBoundToOther || !selectedBoxId}
            onClick={() => onBindBay({ id: record.id, name: record.bayName, code: record.bayCode })}>
            {isBoundToOther ? "已绑" : "绑定"}
          </Button>
        );
      },
    },
  ];

  return (
    <div
      style={{
        position: "absolute",
        right: 16 - offset.x,
        top: 120 + offset.y,
        width: 360,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
        zIndex: 30,
        userSelect: "none",
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div onMouseDown={onTitleMouseDown}
        style={{
          cursor: "move", padding: "8px 12px", background: "#1677ff",
          color: "#fff", fontSize: 13, fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
        <span>设备区域 - 绑定间隔</span>
        <CloseOutlined onMouseDown={(e) => e.stopPropagation()} onClick={onClose}
          style={{ cursor: "pointer", fontSize: 14 }} />
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>区域</span>
          <Select size="small" placeholder="筛选区域" allowClear showSearch optionFilterProp="label"
            style={{ flex: 1 }} options={areaOptions} value={areaId}
            onChange={(v) => setAreaId(v)} />
          <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>高度(m)</span>
          <InputNumber size="small" min={0.1} max={100} step={0.1} value={height}
            onChange={(v) => v != null && onSetHeight(v)} style={{ width: 72 }} />
        </div>
        <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>点击3个点生成设备区 → 选中框 → 在下表中绑定间隔</div>
        <Table<DeviceBay>
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={bayList}
          pagination={false}
          scroll={{ y: 240 }}
          locale={{ emptyText: "暂无可绑定间隔" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#666" }}>
          <span>已绘制 {boxCount} 个区域，已绑定 {boundBoxCount} 个 | {selectedBoxId ? (selectedBoxBay ? `已绑定: ${selectedBoxBay.name}` : "选中框未绑定") : "点击框选中"}</span>
          <span style={{ color: "#1677ff", cursor: "help" }} title="方向键平移选中框 / Delete 键删除选中框">ⓘ</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} disabled={saving} onClick={onSave}>保存全部设备区</Button>
        </div>
      </div>
    </div>
  );
}
