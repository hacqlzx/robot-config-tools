import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Select, Table, Input, message } from "antd";
import { UndoOutlined, CloseOutlined, SaveOutlined } from "@ant-design/icons";

interface Props {
  /** 当前已放置的角点数量（0~4） */
  cornerCount: number;
  /** 当前屏柜数量（成体后 = 分隔数 + 1，未成体为 0） */
  cabinetCount: number;
  /** 撤销最后一个角点 */
  onUndo: () => void;
  /** 关闭绘制屏柜 */
  onClose: () => void;
  /** 保存：传出当前面板数据 */
  onSave?: (data: { area: { id: number; name: string; code: string }; bay: { id: number; name: string; code: string }; rows: CabinetRow[] }) => void;
  /** 屏柜名称变化时上报（用于 3D 框上方红色标签） */
  onNamesChange?: (names: string[]) => void;
}

/** 四个角点的分步标签 */
const STEP_LABELS = ["前左下角", "前右下角", "前右上角", "后右上角"];

/** 屏柜表格行 */
interface CabinetRow { key: string; code: string; name: string; }

/** 生成 18 位编号 uid */
function gen18(): string {
  const raw = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "")
    : (Math.random().toString(16).slice(2) + Date.now().toString(16));
  return (raw + "000000000000000000").slice(0, 18).toUpperCase();
}

/** 绘制屏柜操作小窗（可拖动，提示 + 撤销 + 区域/间隔选择 + 屏柜表格） */
export default function CabinetPanel({ cornerCount, cabinetCount, onUndo, onClose, onSave, onNamesChange }: Props) {
  // 相对初始右上角（right:16, top:16）的拖动位移
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  // 区域（电压）/ 间隔数据
  const [voltList, setVoltList] = useState<any[]>([]);
  const [bayList, setBayList] = useState<any[]>([]);
  const [areaId, setAreaId] = useState<number | undefined>();
  const [bayId, setBayId] = useState<number | undefined>();

  useEffect(() => {
    const projectName = localStorage.getItem("selectedProject");
    const api = (window as any).electronAPI;
    if (!projectName || !api?.db) return;
    Promise.all([api.db.voltage.list(projectName), api.db.bay.list(projectName)])
      .then(([v, b]: [any[], any[]]) => { setVoltList(v || []); setBayList(b || []); })
      .catch(() => {});
  }, []);

  // 区域：查全部
  const areaOptions = voltList.map((v) => ({ value: v.id, label: v.voltName || "(未命名)" }));
  // 间隔：查所选区域下的屏柜间隔
  const bayOptions = bayList
    .filter((b) => b.voltId === areaId && b.bayType === "屏柜区")
    .map((b) => ({ value: b.id, label: b.bayName || "(未命名)" }));

  // 屏柜表格：行数跟随屏柜数量增减，保留已编辑的值
  const [rows, setRows] = useState<CabinetRow[]>([]);
  useEffect(() => {
    setRows((prev) => {
      if (cabinetCount === prev.length) return prev;
      if (cabinetCount < prev.length) return prev.slice(0, cabinetCount);
      const next = [...prev];
      for (let i = prev.length; i < cabinetCount; i++) {
        next.push({ key: gen18(), code: gen18(), name: `屏柜${i + 1}` });
      }
      return next;
    });
  }, [cabinetCount]);

  const updateRow = useCallback((idx: number, field: "code" | "name", val: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }, []);

  // 名称变化时上报，用于 3D 框上方红色标签
  useEffect(() => {
    onNamesChange?.(rows.map((r) => r.name));
  }, [rows, onNamesChange]);

  const columns = [
    {
      title: "编号",
      dataIndex: "code",
      render: (_: any, r: CabinetRow, idx: number) => (
        <Input size="small" value={r.code} onChange={(e) => updateRow(idx, "code", e.target.value)} />
      ),
    },
    {
      title: "屏柜名称",
      dataIndex: "name",
      width: 110,
      render: (_: any, r: CabinetRow, idx: number) => (
        <Input size="small" value={r.name} onChange={(e) => updateRow(idx, "name", e.target.value)} />
      ),
    },
  ];

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

  const handleSave = useCallback(() => {
    if (areaId == null || bayId == null) {
      message.warning("请先选择区域和间隔");
      return;
    }
    const v = voltList.find((x) => x.id === areaId);
    const b = bayList.find((x) => x.id === bayId);
    const area = { id: areaId, name: v?.voltName || "", code: v?.voltCode || "" };
    const bay = { id: bayId, name: b?.bayName || "", code: b?.bayCode || "" };
    onSave?.({ area, bay, rows });
  }, [areaId, bayId, voltList, bayList, rows, onSave]);

  const tip = cornerCount < 4
    ? `点击屏柜【${STEP_LABELS[cornerCount]}】（${cornerCount + 1}/4）`
    : "已生成 ✓ 可拖动顶点调整";

  return (
    <div
      style={{
        position: "absolute",
        right: 16 - offset.x,
        top: 16 + offset.y,
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
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          cursor: "move",
          padding: "8px 12px",
          background: "#1677ff",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>绘制屏柜</span>
        <CloseOutlined
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{ cursor: "pointer", fontSize: 14 }}
        />
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ flex: 1, fontSize: 12, color: "#333" }}>{tip}</span>
          <Button size="small" icon={<UndoOutlined />} onClick={onUndo} disabled={cornerCount === 0}>
            撤销
          </Button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 36, fontSize: 12, color: "#666" }}>区域</span>
          <Select
            size="small"
            style={{ flex: 1 }}
            placeholder="选择区域"
            showSearch
            optionFilterProp="label"
            value={areaId}
            options={areaOptions}
            onChange={(v) => { setAreaId(v); setBayId(undefined); }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 36, fontSize: 12, color: "#666" }}>间隔</span>
          <Select
            size="small"
            style={{ flex: 1 }}
            placeholder="选择间隔"
            showSearch
            optionFilterProp="label"
            disabled={areaId == null}
            value={bayId}
            options={bayOptions}
            onChange={setBayId}
          />
        </div>

        {cabinetCount > 0 && (
          <Table<CabinetRow>
            style={{ marginTop: 12 }}
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ y: 180 }}
          />
        )}

        <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>4个拐角定底面 → 选区域/间隔 → 填名称 → 保存</div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={handleSave}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
