import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { RobotAreaRecord } from "@/components/three-d-engine/drawing-data";
import "./CabinetPhotoModal.scss";

const MAP_DIR_NAME = "地图";
const DESCRIPTION_FILE_NAME = "description_file.json";
const CABINET_TYPE = "2";

export interface CabinetPhotoDispatchItem {
  id: string;
  areaId: string;
  areaName: string;
  bayId: string;
  bayName: string;
  cabinetId: string;
  cabinetCode: string;
  cabinetName: string;
  fileCabinetId: string;
  sourceType: "description-file+db";
}

interface CabinetPhotoModalProps {
  open: boolean;
  projectName?: string | null;
  mapName?: string | null;
  onClose: () => void;
  onDispatch?: (items: CabinetPhotoDispatchItem[]) => boolean | void | Promise<boolean | void>;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface DeviceMainLike {
  id: number;
  mainDeviceName: string;
  mainDeviceCode: string;
  bayId: number;
  bayName: string;
  voltId: number;
  voltName: string;
  sortNum: number;
}

function walkTree(nodes: TreeNode[], visit: (node: TreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walkTree(node.children, visit);
  }
}

function findFilePath(nodes: TreeNode[], names: readonly string[]): string {
  let found = "";
  walkTree(nodes, (node) => {
    if (!node.isDir && !found && names.includes(node.name)) {
      found = node.path;
    }
  });
  return found;
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRobotAreaRecords(value: unknown): RobotAreaRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord) as RobotAreaRecord[];
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord) as RobotAreaRecord[];
  return [];
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function areaKey(row: Pick<CabinetPhotoDispatchItem, "areaId" | "areaName">): string {
  return row.areaId || row.areaName;
}

function rowKey(row: CabinetPhotoDispatchItem): string {
  return row.id;
}

function sortRows(a: CabinetPhotoDispatchItem, b: CabinetPhotoDispatchItem): number {
  const areaCompare = a.areaName.localeCompare(b.areaName, "zh-Hans-CN", { numeric: true });
  if (areaCompare !== 0) return areaCompare;
  return a.cabinetName.localeCompare(b.cabinetName, "zh-Hans-CN", { numeric: true });
}

function collectFileCabinetCodes(records: RobotAreaRecord[]): Map<string, RobotAreaRecord> {
  const codeToCabinet = new Map<string, RobotAreaRecord>();
  for (const record of records) {
    if (valueText(record.type) !== CABINET_TYPE) continue;
    const code = valueText((record as Record<string, unknown>).code);
    if (!code || codeToCabinet.has(code)) continue;
    codeToCabinet.set(code, record);
  }
  return codeToCabinet;
}

function buildRows(fileCodeMap: Map<string, RobotAreaRecord>, mainDevices: DeviceMainLike[]): CabinetPhotoDispatchItem[] {
  return mainDevices
    .filter((device) => fileCodeMap.has(valueText(device.mainDeviceCode)))
    .map((device) => {
      const code = valueText(device.mainDeviceCode);
      const fileCabinet = fileCodeMap.get(code);
      return {
        id: `main-${device.id}`,
        areaId: valueText(device.voltId),
        areaName: valueText(device.voltName) || "未绑定区域",
        bayId: valueText(device.bayId),
        bayName: valueText(device.bayName),
        cabinetId: valueText(device.id),
        cabinetCode: code,
        cabinetName: valueText(device.mainDeviceName) || valueText(fileCabinet?.name) || `屏柜${valueText(fileCabinet?.id) || device.id}`,
        fileCabinetId: valueText(fileCabinet?.id),
        sourceType: "description-file+db" as const,
      };
    })
    .sort(sortRows);
}

export default function CabinetPhotoModal({
  open,
  projectName,
  mapName,
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

    if (!projectName || !mapName || !window.electronAPI?.project || !window.electronAPI?.readLargeFile || !window.electronAPI?.db?.mainDevice) {
      setRows([]);
      setSelectedKeys([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    (async () => {
      try {
        const tree = await window.electronAPI!.project.listTree(projectName, `${MAP_DIR_NAME}/${mapName}`);
        const descriptionPath = findFilePath(tree as TreeNode[], [DESCRIPTION_FILE_NAME]);
        if (!descriptionPath) {
          if (!ignore) {
            setRows([]);
            setSelectedKeys([]);
          }
          return;
        }

        const buf = await window.electronAPI!.readLargeFile(descriptionPath);
        const records = getRobotAreaRecords(parseJsonText(new TextDecoder().decode(buf)));
        const fileCodeMap = collectFileCabinetCodes(records);
        if (fileCodeMap.size === 0) {
          if (!ignore) {
            setRows([]);
            setSelectedKeys([]);
          }
          return;
        }
        const mainDevices = await window.electronAPI!.db.mainDevice.list(projectName);
        if (ignore) return;
        setRows(buildRows(fileCodeMap, mainDevices as DeviceMainLike[]));
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
  }, [mapName, message, open, projectName, resetModalState]);

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
      .filter((row) => !keyword || row.cabinetName.toLowerCase().includes(keyword));
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
      title: "屏柜",
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
            placeholder="请输入屏柜名称"
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
