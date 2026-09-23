import { useState } from "react";
import { Button, Input, Table, message } from "antd";
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import type { CabinetItem, DeviceAreaItem } from "../hooks/drawing/drawing-schema";

type EditableArea = CabinetItem | DeviceAreaItem;

interface Props {
  item: EditableArea;
  saving: boolean;
  onClose: () => void;
  onSave: (item: EditableArea) => Promise<boolean>;
}

export default function SavedAreaEditModal({ item, saving, onClose, onSave }: Props) {
  const [name, setName] = useState(item.type === "cabinet" ? item.cabinetRow?.name || "" : item.name || "");
  const [cabinets, setCabinets] = useState(() => item.type === "cabinet"
    ? item.cabinets.map((cabinet) => ({ ...cabinet }))
    : []);

  const updateCabinet = (index: number, value: string) => {
    setCabinets((current) => current.map((cabinet, row) => row === index ? { ...cabinet, name: value } : cabinet));
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (item.type === "device-area") {
      if (!trimmedName) return message.warning("设备区域名称不能为空");
      await onSave({ ...item, name: trimmedName });
      return;
    }
    const nextCabinets = cabinets.map((cabinet) => ({ ...cabinet, name: cabinet.name.trim(), code: cabinet.code.trim() }));
    if (item.cabinetRow && !trimmedName) return message.warning("柜排名称不能为空");
    if (nextCabinets.some((cabinet) => !cabinet.name)) return message.warning("屏柜名称不能为空");
    if (new Set(nextCabinets.map((cabinet) => cabinet.name)).size !== nextCabinets.length) return message.warning("屏柜名称不能重复");
    await onSave({
      ...item,
      cabinetRow: item.cabinetRow ? { ...item.cabinetRow, name: trimmedName } : null,
      cabinets: nextCabinets,
    });
  };

  return (
    <div
      role="dialog"
      aria-label={item.type === "cabinet" ? "编辑屏柜" : "编辑设备区域"}
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        width: item.type === "cabinet" ? 440 : 360,
        maxWidth: "calc(100% - 32px)",
        maxHeight: "calc(100% - 32px)",
        zIndex: 31,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div style={{
        minHeight: 40,
        padding: "8px 8px 8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#1677ff",
        color: "#fff",
        fontSize: 13,
        fontWeight: 600,
      }}>
        <span>{item.type === "cabinet" ? "编辑屏柜" : "编辑设备区域"}</span>
        <Button
          type="text"
          size="small"
          aria-label="关闭"
          title="关闭"
          icon={<CloseOutlined />}
          disabled={saving}
          onClick={onClose}
          style={{ color: "#fff" }}
        />
      </div>
      <div style={{ padding: 12, overflow: "auto" }}>
        {item.type === "cabinet" ? (
          <>
            {item.cabinetRow && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6, fontSize: 12, color: "#666" }}>柜排名称</div>
                <Input size="small" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={saving} />
              </div>
            )}
            <Table
              size="small"
              rowKey={(_, index) => String(index)}
              pagination={false}
              dataSource={cabinets}
              scroll={{ y: 220 }}
              columns={[
                { title: "屏柜名称", dataIndex: "name", width: 170, render: (_value, _record, index) => (
                  <Input size="small" value={cabinets[index].name} maxLength={100} disabled={saving}
                    onChange={(event) => updateCabinet(index, event.target.value)} />
                ) },
                { title: "屏柜编码", dataIndex: "code", render: (_value, _record, index) => (
                  <Input size="small" value={cabinets[index].code} readOnly title="编码关联点表，请通过点表维护" />
                ) },
              ]}
            />
          </>
        ) : (
          <div>
            <div style={{ marginBottom: 6, fontSize: 12, color: "#666" }}>设备区域名称</div>
            <Input size="small" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={saving} />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Button size="small" disabled={saving} onClick={onClose}>取消</Button>
          <Button type="primary" size="small" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
