import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DeviceMain } from "@robot/database";
import "./CabinetPhotoModal.scss";

const CABINET_BAY_TYPE = "屏柜区";

export interface CabinetPhotoDispatchItem {
  id: string;
  areaId: string;
  areaName: string;
  areaCode: string;
  bayId: string;
  bayName: string;
  bayCode: string;
  cabinetId: string;
  cabinetCode: string;
  cabinetName: string;
  mainDeviceId: string;
  mainDeviceCode: string;
  mainDeviceName: string;
  sourceType: "db-main-device";
}

interface CabinetPhotoModalProps {
  open: boolean;
  projectName?: string | null;
  onClose: () => void;
  onDispatch?: (items: CabinetPhotoDispatchItem[]) => boolean | void | Promise<boolean | void>;
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function entityKey(id: unknown, name: unknown, code?: unknown): string {
  const idText = valueText(id);
  if (idText && idText !== "0") return `id:${idText}`;
  const codeText = valueText(code);
  if (codeText) return `code:${codeText}`;
  const nameText = valueText(name);
  if (nameText) return `name:${nameText}`;
  return "unknown";
}

function rowAreaName(row: Pick<DeviceMain, "voltId" | "voltName">): string {
  return valueText(row.voltName) || (row.voltId ? `区域${row.voltId}` : "未绑定区域");
}

function rowBayName(row: Pick<DeviceMain, "bayId" | "bayName">): string {
  return valueText(row.bayName) || (row.bayId ? `间隔${row.bayId}` : "未绑定间隔");
}

function areaKey(row: Pick<CabinetPhotoDispatchItem, "areaId" | "areaName" | "areaCode">): string {
  return entityKey(row.areaId, row.areaName, row.areaCode);
}

function rowKey(row: CabinetPhotoDispatchItem): string {
  return row.id;
}

function sortRows(a: CabinetPhotoDispatchItem, b: CabinetPhotoDispatchItem): number {
  const areaCompare = a.areaName.localeCompare(b.areaName, "zh-Hans-CN", { numeric: true });
  if (areaCompare !== 0) return areaCompare;
  const bayCompare = a.bayName.localeCompare(b.bayName, "zh-Hans-CN", { numeric: true });
  if (bayCompare !== 0) return bayCompare;
  return a.cabinetName.localeCompare(b.cabinetName, "zh-Hans-CN", { numeric: true });
}

function buildRows(mainDevices: DeviceMain[]): CabinetPhotoDispatchItem[] {
  const seenCodes = new Set<string>();
  const rows: CabinetPhotoDispatchItem[] = [];

  for (const device of mainDevices) {
    const code = valueText(device.mainDeviceCode);
    if (valueText(device.bayType) !== CABINET_BAY_TYPE || !code || seenCodes.has(code)) continue;
    seenCodes.add(code);

    const mainDeviceId = valueText(device.id);
    const mainDeviceName = valueText(device.mainDeviceName) || `主设备${device.id}`;
    rows.push({
      id: `main-${device.id}`,
      areaId: valueText(device.voltId),
      areaName: rowAreaName(device),
      areaCode: valueText(device.voltCode),
      bayId: valueText(device.bayId),
      bayName: rowBayName(device),
      bayCode: valueText(device.bayCode),
      cabinetId: mainDeviceId,
      cabinetCode: code,
      cabinetName: mainDeviceName,
      mainDeviceId,
      mainDeviceCode: code,
      mainDeviceName,
      sourceType: "db-main-device",
    });
  }

  return rows.sort(sortRows);
}

export default function CabinetPhotoModal({
  open,
  projectName,
  onClose,
  onDispatch,
}: CabinetPhotoModalProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rows, setRows] = useState<CabinetPhotoDispatchItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [cabinetKeyword, setCabinetKeyword] = useState("");

  const resetModalState = useCallback(() => {
    setLoading(false);
    setSubmitting(false);
    setRows([]);
    setSelectedKeys([]);
    setAreaFilter([]);
    setCabinetKeyword("");
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetModalState();
    onClose();
  }, [onClose, resetModalState, submitting]);

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }

    if (!projectName || !window.electronAPI?.db?.mainDevice) {
      setRows([]);
      setSelectedKeys([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    (async () => {
      try {
        const mainDevices = await window.electronAPI!.db.mainDevice.list(projectName);
        if (ignore) return;
        setRows(buildRows(mainDevices));
        setSelectedKeys([]);
      } catch (e: any) {
        if (!ignore) {
          setRows([]);
          setSelectedKeys([]);
          message.error("读取屏柜列表失败: " + (e?.message || e));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [message, open, projectName, resetModalState]);

  const areaOptions = useMemo(() => {
    const map = new Map<string, { label: string; value: string }>();
    for (const row of rows) {
      const key = areaKey(row);
      if (!key || map.has(key)) continue;
      map.set(key, { label: row.areaName, value: key });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN", { numeric: true }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const areaSet = new Set(areaFilter);
    const keyword = normalizeKeyword(cabinetKeyword);
    return rows
      .filter((row) => areaSet.size === 0 || areaSet.has(areaKey(row)))
      .filter((row) => !keyword || `${row.bayName} ${row.cabinetName} ${row.cabinetCode}`.toLowerCase().includes(keyword));
  }, [areaFilter, cabinetKeyword, rows]);

  useEffect(() => {
    if (!open) return;
    if (areaFilter.length === 0 && !normalizeKeyword(cabinetKeyword)) {
      setSelectedKeys([]);
      return;
    }
    setSelectedKeys(filteredRows.map(rowKey));
  }, [areaFilter, cabinetKeyword, filteredRows, open]);

  const selectedRows = useMemo(() => {
    const selectedSet = new Set(selectedKeys.map(String));
    return rows.filter((row) => selectedSet.has(rowKey(row)));
  }, [rows, selectedKeys]);

  const columns: ColumnsType<CabinetPhotoDispatchItem> = [
    {
      title: "序号",
      width: 78,
      align: "center",
      render: (_value, _record, index) => index + 1,
    },
    {
      title: "区域",
      dataIndex: "areaName",
      ellipsis: true,
    },
    {
      title: "间隔",
      dataIndex: "bayName",
      ellipsis: true,
    },
    {
      title: "主设备",
      dataIndex: "cabinetName",
      ellipsis: true,
    },
  ];

  const handleDispatch = async () => {
    if (selectedRows.length === 0) {
      message.warning("请选择屏柜");
      return;
    }

    setSubmitting(true);
    try {
      const shouldClose = await onDispatch?.(selectedRows);
      if (shouldClose === false) return;
      resetModalState();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="cabinet-photo-modal"
      title="屏柜拍照"
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={720}
      footer={(
        <div className="cabinet-photo-modal-footer">
          <Button onClick={handleClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={handleDispatch} loading={submitting} disabled={selectedRows.length === 0}>
            确定
          </Button>
        </div>
      )}
    >
      <div className="cabinet-photo-filter">
        <div className="cabinet-photo-filter-item">
          <span className="cabinet-photo-filter-label">区域</span>
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder="请选择区域"
            value={areaFilter}
            onChange={setAreaFilter}
            options={areaOptions}
          />
        </div>
        <div className="cabinet-photo-filter-item">
          <span className="cabinet-photo-filter-label">屏柜</span>
          <Input
            allowClear
            placeholder="请输入间隔/主设备名称"
            value={cabinetKeyword}
            onChange={(event) => setCabinetKeyword(event.target.value)}
          />
        </div>
      </div>

      <div className="cabinet-photo-list-head">
        <span>屏柜列表</span>
        <span className="cabinet-photo-selected-count">已选择 {selectedRows.length} 项</span>
      </div>

      <Spin spinning={loading}>
        <Table<CabinetPhotoDispatchItem>
          className="cabinet-photo-table"
          rowKey={rowKey}
          columns={columns}
          dataSource={filteredRows}
          size="small"
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无屏柜" /> }}
          scroll={{ y: 270 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setSelectedKeys(keys),
          }}
          pagination={false}
        />
      </Spin>
    </Modal>
  );
}
