import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Select, Table, Input, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import { useSelectedProject } from "@/stores/appContextStore";

interface Props {
  /** 当前已放置的角点数量（0~4） */
  cornerCount: number;
  /** 当前屏柜数量（成体后 = 分隔数 + 1，未成体为 0） */
  cabinetCount: number;
  /** 当前地图内新增柜排、屏柜的默认名称起始序号 */
  nameSequence?: { cabinetRowStart: number; cabinetStart: number };
  /** 成功保存后重置当前新增表单，保留区域/间隔选择。 */
  resetToken?: number;
  /** 当前地图已有的屏柜名称列表（用于重复校验） */
  existingCabinetNames?: string[];
  /** 关闭绘制屏柜 */
  onClose: () => void;
  /** 保存：传出当前面板数据 */
  onSave?: (data: CabinetSaveData) => void;
  /** 面板当前表单快照变化，用于 Ctrl+S/工具栏保存 */
  onDraftChange?: (data: CabinetSaveData | null) => void;
  /** 屏柜名称变化时上报（用于 3D 框上方红色标签） */
  onNamesChange?: (names: string[]) => void;
  /** 保存进行中时禁用重复提交。 */
  saving?: boolean;
}

/** 四个角点的分步标签 */
const STEP_LABELS = ["前左下角", "前右下角", "前右上角", "后右上角"];

/** 屏柜表格行 */
interface CabinetRow { key: string; code: string; name: string; }

export interface CabinetSaveData {
  area: { id: number; name: string; code: string };
  bay: { id: number; name: string; code: string };
  cabinetRow?: CabinetRow | null;
  rows: CabinetRow[];
}

/** 生成 18 位编号 uid */
function gen18(): string {
  const raw = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "")
    : (Math.random().toString(16).slice(2) + Date.now().toString(16));
  return (raw + "000000000000000000").slice(0, 18).toUpperCase();
}

/** 绘制屏柜操作小窗（可拖动，提示 + 区域/间隔选择 + 屏柜表格） */
export default function CabinetPanel({ cornerCount, cabinetCount, nameSequence, resetToken, existingCabinetNames = [], onClose, onSave, onDraftChange, onNamesChange, saving }: Props) {
  const projectName = useSelectedProject();
  const cabinetRowNameStart = nameSequence?.cabinetRowStart ?? 1;
  const cabinetNameStart = nameSequence?.cabinetStart ?? 1;
  // 相对初始右上角（right:16, top:16）的拖动位移
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const editedRowNameKeysRef = useRef<Set<string>>(new Set());
  const cabinetRowNameEditedRef = useRef(false);

  // 区域（电压）/ 间隔数据
  const [voltList, setVoltList] = useState<any[]>([]);
  const [bayList, setBayList] = useState<any[]>([]);
  const [areaId, setAreaId] = useState<number | undefined>();
  const [bayId, setBayId] = useState<number | undefined>();

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!projectName || !api?.db) {
      setVoltList([]);
      setBayList([]);
      return;
    }
    Promise.all([api.db.voltage.list(projectName), api.db.bay.list(projectName)])
      .then(([v, b]: [any[], any[]]) => { setVoltList(v || []); setBayList(b || []); })
      .catch(() => {});
  }, [projectName]);

  // 区域：查全部
  const areaOptions = voltList.map((v) => ({ value: v.id, label: v.voltName || "(未命名)" }));
  // 间隔：查所选区域下的屏柜间隔
  const bayOptions = bayList
    .filter((b) => b.voltId === areaId && b.bayType === "屏柜区")
    .map((b) => ({ value: b.id, label: b.bayName || "(未命名)" }));

  // 屏柜表格：行数跟随屏柜数量增减，保留已编辑的值
  const [rows, setRows] = useState<CabinetRow[]>([]);
  const [cabinetRow, setCabinetRow] = useState<CabinetRow>(() => ({ key: gen18(), code: gen18(), name: `柜排${cabinetRowNameStart}` }));
  const isSplit = cabinetCount > 1;

  useEffect(() => {
    editedRowNameKeysRef.current.clear();
    cabinetRowNameEditedRef.current = false;
    setRows([]);
    setCabinetRow({ key: gen18(), code: gen18(), name: `柜排${cabinetRowNameStart}` });
  }, [resetToken]);

  useEffect(() => {
    setRows((prev) => {
      if (cabinetCount === prev.length) return prev;
      if (cabinetCount < prev.length) return prev.slice(0, cabinetCount);
      const next = [...prev];
      for (let i = prev.length; i < cabinetCount; i++) {
        next.push({ key: gen18(), code: gen18(), name: `屏柜${cabinetNameStart + i}` });
      }
      return next;
    });
  }, [cabinetCount, cabinetNameStart]);

  useEffect(() => {
    if (cabinetRowNameEditedRef.current) return;
    setCabinetRow((prev) => ({ ...prev, name: `柜排${cabinetRowNameStart}` }));
  }, [cabinetRowNameStart]);

  useEffect(() => {
    setRows((prev) => prev.map((row, index) =>
      editedRowNameKeysRef.current.has(row.key)
        ? row
        : { ...row, name: `屏柜${cabinetNameStart + index}` }
    ));
  }, [cabinetNameStart]);

  const updateRow = useCallback((idx: number, field: "code" | "name", val: string) => {
    if (field === "name") {
      const key = rows[idx]?.key;
      if (key) editedRowNameKeysRef.current.add(key);
    }
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  }, [rows]);

  const updateCabinetRow = useCallback((field: "code" | "name", val: string) => {
    if (field === "name") cabinetRowNameEditedRef.current = true;
    setCabinetRow((prev) => ({ ...prev, [field]: val }));
  }, []);

  // 名称变化时上报，用于 3D 框上方红色标签
  useEffect(() => {
    onNamesChange?.(rows.map((r) => r.name));
  }, [rows, onNamesChange]);

  useEffect(() => {
    if (areaId == null || bayId == null) {
      onDraftChange?.(null);
      return;
    }
    const v = voltList.find((x) => x.id === areaId);
    const b = bayList.find((x) => x.id === bayId);
    const area = { id: areaId, name: v?.voltName || "", code: v?.voltCode || "" };
    const bay = { id: bayId, name: b?.bayName || "", code: b?.bayCode || "" };
    const nextRows = rows.map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() }));
    const nextCabinetRow = isSplit
      ? { ...cabinetRow, code: cabinetRow.code.trim(), name: cabinetRow.name.trim() }
      : null;
    onDraftChange?.({ area, bay, cabinetRow: nextCabinetRow, rows: nextRows });
  }, [areaId, bayId, voltList, bayList, rows, cabinetRow, isSplit, onDraftChange]);

  const columns = [
    {
      title: "屏柜名称",
      dataIndex: "name",
      width: 110,
      render: (_: any, r: CabinetRow, idx: number) => (
        <Input size="small" value={r.name} onChange={(e) => updateRow(idx, "name", e.target.value)} />
      ),
    },
    {
      title: "屏柜编码",
      dataIndex: "code",
      render: (_: any, r: CabinetRow, idx: number) => (
        <Input size="small" value={r.code} onChange={(e) => updateRow(idx, "code", e.target.value)} />
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
    const nextRows = rows.map((r) => ({ ...r, code: r.code.trim(), name: r.name.trim() }));
    const nextCabinetRow = isSplit
      ? { ...cabinetRow, code: cabinetRow.code.trim(), name: cabinetRow.name.trim() }
      : null;
    if (nextRows.length === 0) {
      message.warning("请先完成屏柜绘制");
      return;
    }
    if (nextCabinetRow && !nextCabinetRow.name) {
      message.warning("柜排名称不能为空");
      return;
    }
    if (nextRows.some((r) => !r.name)) {
      message.warning("屏柜名称不能为空");
      return;
    }
    if (nextRows.some((r) => !r.code)) {
      message.warning("屏柜编码不能为空");
      return;
    }
    // 检查当前提交批次内的名称重复
    const duplicateName = nextRows.find((row, index) =>
      nextRows.findIndex((item) => item.name === row.name) !== index
    );
    if (duplicateName) {
      message.warning(`屏柜名称重复：${duplicateName.name}`);
      return;
    }
    // 检查与当前地图已有屏柜名称重复
    const existingDuplicate = nextRows.find((row) => existingCabinetNames.includes(row.name));
    if (existingDuplicate) {
      message.warning(`当前地图已存在同名屏柜：${existingDuplicate.name}`);
      return;
    }
    const duplicateCode = nextRows.find((row, index) =>
      nextRows.findIndex((item) => item.code === row.code) !== index
    );
    if (duplicateCode) {
      message.warning(`屏柜编码重复：${duplicateCode.code}`);
      return;
    }
    const v = voltList.find((x) => x.id === areaId);
    const b = bayList.find((x) => x.id === bayId);
    const area = { id: areaId, name: v?.voltName || "", code: v?.voltCode || "" };
    const bay = { id: bayId, name: b?.bayName || "", code: b?.bayCode || "" };
    onSave?.({ area, bay, cabinetRow: nextCabinetRow, rows: nextRows });
  }, [areaId, bayId, voltList, bayList, rows, cabinetRow, isSplit, existingCabinetNames, onSave]);

  const tip = cornerCount < 4
    ? `点击屏柜【${STEP_LABELS[cornerCount]}】（${cornerCount + 1}/4）`
    : "已生成 ✓ 可拖动红色顶点调整";

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

        {isSplit && (
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "36px 1fr", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#666" }}>柜排</span>
            <Input
              size="small"
              placeholder="柜排名称"
              value={cabinetRow.name}
              onChange={(e) => updateCabinetRow("name", e.target.value)}
            />
          </div>
        )}

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
            loading={saving}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
