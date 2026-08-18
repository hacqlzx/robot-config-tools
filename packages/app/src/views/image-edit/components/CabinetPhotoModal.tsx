import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { App, Button, Empty, Input, Modal, Progress, Select, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DeviceMain } from "@robot/database";
import type { RobotAreaRecord } from "@/space-model/drawing-data";
import type { SurveyRunningState } from "./SurveyPhotoModal";
import "./CabinetPhotoModal.scss";

const MAP_DIR_NAME = "地图";
const AREA_FILE_NAME = "description_file.json";
const CABINET_BAY_TYPE = "屏柜区";
const AREA_TYPE_CABINET_ROW = "1";
const AREA_TYPE_CABINET = "2";

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
  sourceType: "map-cabinet";
}

interface CabinetPhotoModalProps {
  open: boolean;
  projectName?: string | null;
  mapName?: string | null;
  surveyRunning?: SurveyRunningState | null;
  onClose: () => void;
  onDispatch?: (items: CabinetPhotoDispatchItem[]) => boolean | void | Promise<boolean | void>;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

function getRobotAreaRecords(value: unknown): RobotAreaRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord) as RobotAreaRecord[];
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord) as RobotAreaRecord[];
  return [];
}

function walkTree(nodes: TreeNode[], visit: (node: TreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walkTree(node.children, visit);
  }
}

function findFilePath(nodes: TreeNode[], fileName: string): string {
  let found = "";
  walkTree(nodes, (node) => {
    if (!node.isDir && !found && node.name === fileName) found = node.path;
  });
  return found;
}

function splitTextList(value: unknown): string[] {
  return valueText(value)
    .split(/[,，;；|]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function buildRows(areaRecords: RobotAreaRecord[], mainDevices: DeviceMain[]): CabinetPhotoDispatchItem[] {
  const cabinetDevices = mainDevices.filter((device) => valueText(device.bayType) === CABINET_BAY_TYPE);
  const parentById = new Map<string, RobotAreaRecord>();
  for (const record of areaRecords) {
    if (valueText(record.type) !== AREA_TYPE_CABINET_ROW) continue;
    const id = valueText(record.id);
    if (id) parentById.set(id, record);
  }

  const seenIds = new Set<string>();
  const rows: CabinetPhotoDispatchItem[] = [];

  for (const record of areaRecords) {
    if (valueText(record.type) !== AREA_TYPE_CABINET) continue;
    const cabinetId = valueText(record.id);
    if (!cabinetId || seenIds.has(cabinetId)) continue;
    seenIds.add(cabinetId);

    const parent = parentById.get(valueText(record.parent_id));
    const recordCode = valueText(record.code);
    const recordName = valueText(record.name) || `屏柜${cabinetId}`;
    const bayCodes = splitTextList(record.bay_code);
    if (bayCodes.length === 0 && parent) bayCodes.push(...splitTextList(parent.bay_code));

    const candidates = cabinetDevices.filter((device) => (
      (recordCode && valueText(device.mainDeviceCode) === recordCode)
      || (!recordCode && valueText(device.mainDeviceName) === recordName)
    ));
    const device = candidates.find((item) => bayCodes.includes(valueText(item.bayCode))) || candidates[0];
    const bayCode = bayCodes[0] || valueText(device?.bayCode);
    const mainDeviceId = valueText(device?.id);
    const mainDeviceCode = valueText(device?.mainDeviceCode) || recordCode;
    const mainDeviceName = valueText(device?.mainDeviceName) || recordName;
    rows.push({
      id: `map-cabinet-${cabinetId}`,
      areaId: valueText(device?.voltId),
      areaName: device ? rowAreaName(device) : "未绑定区域",
      areaCode: valueText(device?.voltCode),
      bayId: valueText(device?.bayId),
      bayName: device ? rowBayName(device) : (bayCode || "未绑定间隔"),
      bayCode,
      cabinetId,
      cabinetCode: recordCode || mainDeviceCode,
      cabinetName: recordName,
      mainDeviceId,
      mainDeviceCode,
      mainDeviceName,
      sourceType: "map-cabinet",
    });
  }

  return rows.sort(sortRows);
}

export default function CabinetPhotoModal({
  open,
  projectName,
  mapName,
  surveyRunning,
  onClose,
  onDispatch,
}: CabinetPhotoModalProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mapOptions, setMapOptions] = useState<{ label: string; value: string }[]>([]);
  const [selectedMapName, setSelectedMapName] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<CabinetPhotoDispatchItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [cabinetKeyword, setCabinetKeyword] = useState("");

  const resetModalState = useCallback(() => {
    setLoading(false);
    setSubmitting(false);
    setMapOptions([]);
    setSelectedMapName(undefined);
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

    setSelectedMapName(valueText(mapName) || undefined);
  }, [mapName, open, resetModalState]);

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI?.project;
    if (!projectName || !api) {
      setMapOptions([]);
      return;
    }

    let ignore = false;
    (async () => {
      try {
        const tree = await api.listTree(projectName, MAP_DIR_NAME);
        if (!ignore) setMapOptions(tree.filter((node) => node.isDir).map((node) => ({ label: node.name, value: node.name })));
      } catch {
        if (!ignore) setMapOptions([]);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [open, projectName]);

  useEffect(() => {
    if (!open) return;

    setAreaFilter([]);
    setSelectedKeys([]);
  }, [open, selectedMapName]);

  useEffect(() => {
    if (!open) return;

    if (!projectName || !selectedMapName || !window.electronAPI?.project || !window.electronAPI?.readLargeFile) {
      setRows([]);
      setSelectedKeys([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    setRows([]);
    setSelectedKeys([]);
    (async () => {
      try {
        const tree = await window.electronAPI!.project.listTree(projectName, `${MAP_DIR_NAME}/${selectedMapName}`);
        const areaFilePath = findFilePath(tree as TreeNode[], AREA_FILE_NAME);
        if (!areaFilePath) {
          if (!ignore) {
            setRows([]);
            setSelectedKeys([]);
          }
          return;
        }

        const [areaBuffer, mainDevices] = await Promise.all([
          window.electronAPI!.readLargeFile(areaFilePath),
          window.electronAPI!.db?.mainDevice?.list(projectName).catch(() => []) ?? Promise.resolve([]),
        ]);
        const records = getRobotAreaRecords(parseJsonText(new TextDecoder().decode(areaBuffer)));
        if (ignore) return;
        setRows(buildRows(records, mainDevices));
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
  }, [message, open, projectName, selectedMapName]);

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
    if (surveyRunning?.running) {
      message.warning("勘察任务执行中，请等待结束后再下发");
      return;
    }
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
      width={860}
      footer={(
        <div className="cabinet-photo-modal-footer">
          <Button onClick={handleClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={handleDispatch} loading={submitting} disabled={selectedRows.length === 0 || !!surveyRunning?.running}>
            确定
          </Button>
        </div>
      )}
    >
      {surveyRunning && !surveyRunning.queryFailed && (
        <div className={`cabinet-photo-progress${surveyRunning.failed ? " is-error" : ""}`}>
          <div className="cabinet-photo-progress-head">
            <span>{surveyRunning.taskName || "勘察任务"}</span>
            <span>{surveyRunning.statusText}</span>
          </div>
          <Progress
            percent={surveyRunning.progressPercent}
            size="small"
            status={surveyRunning.failed ? "exception" : surveyRunning.finished ? "success" : "active"}
          />
          {(surveyRunning.taskCode || surveyRunning.errorMessage) && (
            <div className="cabinet-photo-progress-meta">
              {surveyRunning.errorMessage || surveyRunning.taskCode}
            </div>
          )}
        </div>
      )}

      <div className="cabinet-photo-filter">
        <div className="cabinet-photo-filter-item">
          <span className="cabinet-photo-filter-label">地图</span>
          <Select
            allowClear
            showSearch
            placeholder="请选择地图"
            value={selectedMapName}
            onChange={setSelectedMapName}
            options={mapOptions}
            optionFilterProp="label"
          />
        </div>
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
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={!selectedMapName ? "请先选择地图" : "暂无屏柜"} /> }}
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
