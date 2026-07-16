import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Table, Tabs, Tooltip } from "antd";
import { CloseOutlined, RightOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { DeviceBay, DevicePoint, DeviceVoltage } from "@robot/database";
import "./VerifyTaskModal.scss";

const VERIFY_BAY_TYPES = ["设备区", "屏柜区"] as const;
const BAY_TABLE_SCROLL = { y: 220 } as const;
const POINT_TABLE_SCROLL = { y: 214 } as const;
const SELECT_MAX_TAG_COUNT = 1;
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "500"];

type VerifyBayType = typeof VERIFY_BAY_TYPES[number];
type TabKey = "bay" | "point";

interface BayFilters {
  areaKeys: string[];
  bayName: string;
  bayTypes: string[];
}

interface PointFilters {
  areaKeys: string[];
  bayKeys: string[];
  pointName: string;
}

interface OptionItem {
  label: string;
  value: string;
}

interface PageState {
  current: number;
  pageSize: number;
}

export interface VerifyTaskBayItem {
  id: number;
  bayCode: string;
  bayName: string;
  bayType: VerifyBayType;
  voltId: number;
  voltName: string;
  voltCode: string;
}

export interface VerifyTaskPointItem {
  id: number;
  pointCode: string;
  pointName: string;
  bayId: number;
  bayName: string;
  bayCode: string;
  bayType: string;
  voltId: number;
  voltName: string;
  voltCode: string;
}

interface VerifyTaskModalProps {
  open: boolean;
  projectName?: string | null;
  onClose: () => void;
  onDispatch?: (payload: {
    type: TabKey;
    bays: VerifyTaskBayItem[];
    points: VerifyTaskPointItem[];
  }) => Promise<boolean> | boolean;
}

function createBayFilters(): BayFilters {
  return { areaKeys: [], bayName: "", bayTypes: [] };
}

function createPointFilters(): PointFilters {
  return { areaKeys: [], bayKeys: [], pointName: "" };
}

function createPageState(): PageState {
  return { current: 1, pageSize: DEFAULT_PAGE_SIZE };
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN", { numeric: true });
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

function areaKey(row: { id?: number; voltId?: number; voltName?: string; voltCode?: string }): string {
  return entityKey(row.voltId ?? row.id, row.voltName, row.voltCode);
}

function bayEntityKey(row: { id?: number; bayId?: number; bayName?: string; bayCode?: string }): string {
  return entityKey(row.bayId ?? row.id, row.bayName, row.bayCode);
}

function rowAreaName(row: { id?: number; voltId?: number; voltName?: string }): string {
  const id = row.voltId ?? row.id;
  return valueText(row.voltName) || (id ? `区域${id}` : "未绑定区域");
}

function rowBayName(row: { id?: number; bayId?: number; bayName?: string }): string {
  const id = row.bayId ?? row.id;
  return valueText(row.bayName) || (id ? `间隔${id}` : "未绑定间隔");
}

function isVerifyBayType(value: unknown): value is VerifyBayType {
  return (VERIFY_BAY_TYPES as readonly string[]).includes(valueText(value));
}

function bayRowKey(row: DeviceBay): string {
  return `bay-${row.id}`;
}

function pointRowKey(row: DevicePoint): string {
  return `point-${row.id}`;
}

function addOption(map: Map<string, OptionItem>, value: string, label: string): void {
  if (!value || value === "unknown" || map.has(value)) return;
  map.set(value, { value, label });
}

function sortedOptions(map: Map<string, OptionItem>): OptionItem[] {
  return Array.from(map.values()).sort((a, b) => compareText(a.label, b.label));
}

function buildAreaOptionsFromBays(rows: DeviceBay[]): OptionItem[] {
  const options = new Map<string, OptionItem>();
  rows.forEach((row) => addOption(options, areaKey(row), rowAreaName(row)));
  return sortedOptions(options);
}

function buildAreaOptionsFromPoints(rows: DevicePoint[]): OptionItem[] {
  const options = new Map<string, OptionItem>();
  rows.forEach((row) => addOption(options, areaKey(row), rowAreaName(row)));
  return sortedOptions(options);
}

function buildBayOptionsFromPoints(rows: DevicePoint[], areaKeys: string[]): OptionItem[] {
  const areaSet = new Set(areaKeys);
  const options = new Map<string, OptionItem>();
  rows
    .filter((row) => areaSet.size === 0 || areaSet.has(areaKey(row)))
    .forEach((row) => addOption(options, bayEntityKey(row), rowBayName(row)));
  return sortedOptions(options);
}

function sortBays(a: DeviceBay, b: DeviceBay): number {
  return (
    compareText(rowAreaName(a), rowAreaName(b))
    || compareText(valueText(a.bayType), valueText(b.bayType))
    || compareText(rowBayName(a), rowBayName(b))
    || a.id - b.id
  );
}

function sortPoints(a: DevicePoint, b: DevicePoint): number {
  return (
    compareText(rowAreaName(a), rowAreaName(b))
    || compareText(rowBayName(a), rowBayName(b))
    || compareText(valueText(a.pointName), valueText(b.pointName))
    || a.id - b.id
  );
}

function toBayItem(row: DeviceBay): VerifyTaskBayItem {
  return {
    id: row.id,
    bayCode: valueText(row.bayCode),
    bayName: rowBayName(row),
    bayType: valueText(row.bayType) as VerifyBayType,
    voltId: row.voltId,
    voltName: rowAreaName(row),
    voltCode: valueText(row.voltCode),
  };
}

function toPointItem(row: DevicePoint): VerifyTaskPointItem {
  return {
    id: row.id,
    pointCode: valueText(row.pointCode),
    pointName: valueText(row.pointName) || `点位${row.id}`,
    bayId: row.bayId,
    bayName: rowBayName(row),
    bayCode: valueText(row.bayCode),
    bayType: valueText(row.bayType),
    voltId: row.voltId,
    voltName: rowAreaName(row),
    voltCode: valueText(row.voltCode),
  };
}

function paginationConfig(page: PageState, total: number, onChange: (next: PageState) => void): TablePaginationConfig {
  return {
    current: page.current,
    pageSize: page.pageSize,
    total,
    size: "small",
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (count) => `共 ${count} 条`,
    locale: {
      items_per_page: "条/页",
      jump_to: "跳至",
      page: "页",
      prev_page: "上一页",
      next_page: "下一页",
      prev_5: "向前 5 页",
      next_5: "向后 5 页",
      prev_3: "向前 3 页",
      next_3: "向后 3 页",
      page_size: "页码",
    },
    onChange: (current, pageSize) => onChange({ current, pageSize }),
  };
}

export default function VerifyTaskModal({
  open,
  projectName,
  onClose,
  onDispatch,
}: VerifyTaskModalProps) {
  const { message } = App.useApp();
  const [activeTab, setActiveTab] = useState<TabKey>("bay");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [voltages, setVoltages] = useState<DeviceVoltage[]>([]);
  const [bays, setBays] = useState<DeviceBay[]>([]);
  const [points, setPoints] = useState<DevicePoint[]>([]);
  const [bayDraft, setBayDraft] = useState<BayFilters>(() => createBayFilters());
  const [bayFilters, setBayFilters] = useState<BayFilters>(() => createBayFilters());
  const [pointDraft, setPointDraft] = useState<PointFilters>(() => createPointFilters());
  const [pointFilters, setPointFilters] = useState<PointFilters>(() => createPointFilters());
  const [selectedBayKeys, setSelectedBayKeys] = useState<Key[]>([]);
  const [selectedPointKeys, setSelectedPointKeys] = useState<Key[]>([]);
  const [bayPage, setBayPage] = useState<PageState>(() => createPageState());
  const [pointPage, setPointPage] = useState<PageState>(() => createPageState());

  const resetFilters = useCallback(() => {
    setBayDraft(createBayFilters());
    setBayFilters(createBayFilters());
    setPointDraft(createPointFilters());
    setPointFilters(createPointFilters());
    setSelectedBayKeys([]);
    setSelectedPointKeys([]);
    setBayPage(createPageState());
    setPointPage(createPageState());
  }, []);

  const resetModalState = useCallback(() => {
    setActiveTab("bay");
    setLoading(false);
    setSubmitting(false);
    setVoltages([]);
    setBays([]);
    setPoints([]);
    resetFilters();
  }, [resetFilters]);

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

    if (!projectName || !window.electronAPI?.db?.voltage || !window.electronAPI?.db?.bay || !window.electronAPI?.db?.point) {
      setVoltages([]);
      setBays([]);
      setPoints([]);
      resetFilters();
      return;
    }

    let ignore = false;
    setLoading(true);
    resetFilters();
    (async () => {
      try {
        const [nextVoltages, nextBays, nextPoints] = await Promise.all([
          window.electronAPI!.db.voltage.list(projectName),
          window.electronAPI!.db.bay.list(projectName),
          window.electronAPI!.db.point.list(projectName),
        ]);
        if (ignore) return;
        setVoltages(nextVoltages);
        setBays(nextBays);
        setPoints(nextPoints);
      } catch (e: any) {
        if (!ignore) {
          setVoltages([]);
          setBays([]);
          setPoints([]);
          message.error("读取验证任务数据失败: " + (e?.message || e));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [message, open, projectName, resetFilters, resetModalState]);

  const verifyBays = useMemo(() => {
    return bays
      .filter((row) => isVerifyBayType(row.bayType))
      .slice()
      .sort(sortBays);
  }, [bays]);

  const verifyBayIdSet = useMemo(() => new Set(verifyBays.map((row) => row.id)), [verifyBays]);

  const verifyPoints = useMemo(() => {
    return points
      .filter((row) => verifyBayIdSet.has(row.bayId) || isVerifyBayType(row.bayType))
      .slice()
      .sort(sortPoints);
  }, [points, verifyBayIdSet]);

  const bayAreaOptions = useMemo(() => {
    const options = new Map<string, OptionItem>();
    voltages.forEach((row) => {
      if (verifyBays.some((bay) => areaKey(bay) === areaKey(row))) {
        addOption(options, areaKey(row), rowAreaName(row));
      }
    });
    buildAreaOptionsFromBays(verifyBays).forEach((option) => addOption(options, option.value, option.label));
    return sortedOptions(options);
  }, [verifyBays, voltages]);

  const pointAreaOptions = useMemo(() => buildAreaOptionsFromPoints(verifyPoints), [verifyPoints]);

  const pointBayOptions = useMemo(
    () => buildBayOptionsFromPoints(verifyPoints, pointDraft.areaKeys),
    [pointDraft.areaKeys, verifyPoints],
  );

  const filteredBays = useMemo(() => {
    const areaSet = new Set(bayFilters.areaKeys);
    const typeSet = new Set(bayFilters.bayTypes);
    const keyword = normalizeKeyword(bayFilters.bayName);
    return verifyBays
      .filter((row) => areaSet.size === 0 || areaSet.has(areaKey(row)))
      .filter((row) => typeSet.size === 0 || typeSet.has(valueText(row.bayType)))
      .filter((row) => !keyword || rowBayName(row).toLowerCase().includes(keyword));
  }, [bayFilters, verifyBays]);

  const filteredPoints = useMemo(() => {
    const areaSet = new Set(pointFilters.areaKeys);
    const baySet = new Set(pointFilters.bayKeys);
    const keyword = normalizeKeyword(pointFilters.pointName);
    return verifyPoints
      .filter((row) => areaSet.size === 0 || areaSet.has(areaKey(row)))
      .filter((row) => baySet.size === 0 || baySet.has(bayEntityKey(row)))
      .filter((row) => !keyword || valueText(row.pointName).toLowerCase().includes(keyword));
  }, [pointFilters, verifyPoints]);

  const selectedBays = useMemo(() => {
    const selectedSet = new Set(selectedBayKeys.map(String));
    return verifyBays.filter((row) => selectedSet.has(bayRowKey(row)));
  }, [selectedBayKeys, verifyBays]);

  const selectedPoints = useMemo(() => {
    const selectedSet = new Set(selectedPointKeys.map(String));
    return verifyPoints.filter((row) => selectedSet.has(pointRowKey(row)));
  }, [selectedPointKeys, verifyPoints]);

  useEffect(() => {
    setBayPage((prev) => {
      const maxPage = Math.max(1, Math.ceil(filteredBays.length / prev.pageSize));
      return prev.current > maxPage ? { ...prev, current: maxPage } : prev;
    });
  }, [filteredBays.length]);

  useEffect(() => {
    setPointPage((prev) => {
      const maxPage = Math.max(1, Math.ceil(filteredPoints.length / prev.pageSize));
      return prev.current > maxPage ? { ...prev, current: maxPage } : prev;
    });
  }, [filteredPoints.length]);

  const handleBaySelectionChange = useCallback((keys: Key[]) => {
    setSelectedBayKeys(keys);
  }, []);

  const handlePointSelectionChange = useCallback((keys: Key[]) => {
    setSelectedPointKeys(keys);
  }, []);

  const addPoint = useCallback((row: DevicePoint) => {
    const key = pointRowKey(row);
    setSelectedPointKeys((prev) => {
      const prevSet = new Set(prev.map(String));
      return prevSet.has(key) ? prev : [...prev, key];
    });
  }, []);

  const removePoint = useCallback((row: DevicePoint) => {
    const key = pointRowKey(row);
    setSelectedPointKeys((prev) => prev.filter((item) => String(item) !== key));
  }, []);

  const resetBaySearch = () => {
    const empty = createBayFilters();
    setBayDraft(empty);
    setBayFilters(empty);
    setBayPage(createPageState());
  };

  const resetPointSearch = () => {
    const empty = createPointFilters();
    setPointDraft(empty);
    setPointFilters(empty);
    setPointPage(createPageState());
  };

  const handleConfirm = async () => {
    const isBayTab = activeTab === "bay";
    const currentCount = isBayTab ? selectedBays.length : selectedPoints.length;
    if (currentCount === 0) {
      message.warning(isBayTab ? "请选择间隔" : "请选择点位");
      return;
    }

    setSubmitting(true);
    try {
      if (isBayTab) {
        const bayItems = selectedBays.map(toBayItem);
        const ok = onDispatch ? await onDispatch({ type: "bay", bays: bayItems, points: [] }) : true;
        if (!ok) return;
        if (!onDispatch) message.success(`已确认验证任务间隔：${bayItems.length} 个间隔`);
      } else {
        const pointItems = selectedPoints.map(toPointItem);
        const ok = onDispatch ? await onDispatch({ type: "point", bays: [], points: pointItems }) : true;
        if (!ok) return;
        if (!onDispatch) message.success(`已确认验证任务点位：${pointItems.length} 个点位`);
      }
      resetModalState();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const bayColumns: ColumnsType<DeviceBay> = useMemo(() => [
    {
      title: "序号",
      width: 64,
      align: "center",
      render: (_value, _record, index) => index + 1,
    },
    {
      title: "区域",
      width: "28%",
      ellipsis: true,
      render: (_value, record) => rowAreaName(record),
    },
    {
      title: "间隔",
      width: "44%",
      ellipsis: true,
      render: (_value, record) => rowBayName(record),
    },
    {
      title: "间隔类型",
      width: 120,
      render: (_value, record) => valueText(record.bayType),
    },
  ], []);

  const pointColumns: ColumnsType<DevicePoint> = useMemo(() => [
    {
      title: "序号",
      width: 58,
      align: "center",
      render: (_value, _record, index) => index + 1,
    },
    {
      title: "点位名称",
      dataIndex: "pointName",
      width: "44%",
      ellipsis: true,
    },
    {
      title: "间隔名称",
      width: "34%",
      ellipsis: true,
      render: (_value, record) => rowBayName(record),
    },
    {
      title: "操作",
      width: 76,
      align: "center",
      render: (_value, record) => (
        <Tooltip title="添加">
          <Button
            type="primary"
            size="small"
            icon={<RightOutlined />}
            onClick={() => addPoint(record)}
          />
        </Tooltip>
      ),
    },
  ], [addPoint]);

  const selectedPointColumns: ColumnsType<DevicePoint> = useMemo(() => [
    {
      title: "序号",
      width: 58,
      align: "center",
      render: (_value, _record, index) => index + 1,
    },
    {
      title: "点位名称",
      dataIndex: "pointName",
      width: "46%",
      ellipsis: true,
    },
    {
      title: "间隔名称",
      width: "34%",
      ellipsis: true,
      render: (_value, record) => rowBayName(record),
    },
    {
      title: "操作",
      width: 76,
      align: "center",
      render: (_value, record) => (
        <Tooltip title="移除">
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={() => removePoint(record)}
          />
        </Tooltip>
      ),
    },
  ], [removePoint]);

  const bayTypeOptions = VERIFY_BAY_TYPES.map((type) => ({ label: type, value: type }));
  const bayPagination = paginationConfig(bayPage, filteredBays.length, setBayPage);
  const pointPagination = paginationConfig(pointPage, filteredPoints.length, setPointPage);
  const activeSelectedCount = activeTab === "bay" ? selectedBays.length : selectedPoints.length;
  const activeSelectedLabel = activeTab === "bay" ? `已选择 ${activeSelectedCount} 个间隔` : `已选择 ${activeSelectedCount} 个点位`;

  return (
    <Modal
      className="verify-task-modal"
      title="验证任务"
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={1080}
      footer={(
        <div className="verify-task-footer">
          <span className="verify-task-footer-count">{activeSelectedLabel}</span>
          <Button onClick={handleClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={handleConfirm} loading={submitting} disabled={activeSelectedCount === 0}>
            确定
          </Button>
        </div>
      )}
    >
      <Tabs
        className="verify-task-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TabKey)}
        items={[
          {
            key: "bay",
            label: "间隔",
            children: (
              <>
                <div className="verify-task-filter verify-task-filter-bay">
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">区域</span>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      maxTagCount={SELECT_MAX_TAG_COUNT}
                      placeholder="请选择区域"
                      value={bayDraft.areaKeys}
                      onChange={(areaKeys) => setBayDraft((prev) => ({ ...prev, areaKeys }))}
                      options={bayAreaOptions}
                    />
                  </div>
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">间隔</span>
                    <Input
                      allowClear
                      placeholder="请输入间隔名称"
                      value={bayDraft.bayName}
                      onChange={(event) => setBayDraft((prev) => ({ ...prev, bayName: event.target.value }))}
                      onPressEnter={() => setBayFilters(bayDraft)}
                    />
                  </div>
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">间隔类型</span>
                    <Select
                      mode="multiple"
                      allowClear
                      maxTagCount={SELECT_MAX_TAG_COUNT}
                      placeholder="请选择间隔类型"
                      value={bayDraft.bayTypes}
                      onChange={(bayTypes) => setBayDraft((prev) => ({ ...prev, bayTypes }))}
                      options={bayTypeOptions}
                    />
                  </div>
                  <div className="verify-task-filter-actions">
                    <Button type="primary" onClick={() => { setBayFilters(bayDraft); setBayPage(createPageState()); }}>搜索</Button>
                    <Button onClick={resetBaySearch}>重置</Button>
                  </div>
                </div>

                <div className="verify-task-list-head">
                  <span>间隔列表</span>
                  <span className="verify-task-selected-count">已选择 {selectedBays.length} 项</span>
                </div>

                <Spin spinning={loading}>
                  <Table<DeviceBay>
                    className="verify-task-table verify-task-table-bay"
                    rowKey={bayRowKey}
                    columns={bayColumns}
                    dataSource={filteredBays}
                    size="small"
                    pagination={bayPagination}
                    tableLayout="fixed"
                    scroll={BAY_TABLE_SCROLL}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无间隔" /> }}
                    rowSelection={{
                      selectedRowKeys: selectedBayKeys,
                      preserveSelectedRowKeys: true,
                      onChange: (keys) => handleBaySelectionChange(keys),
                    }}
                  />
                </Spin>
              </>
            ),
          },
          {
            key: "point",
            label: "点位",
            children: (
              <>
                <div className="verify-task-filter verify-task-filter-point">
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">区域</span>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      maxTagCount={SELECT_MAX_TAG_COUNT}
                      placeholder="请选择区域"
                      value={pointDraft.areaKeys}
                      onChange={(areaKeys) => setPointDraft((prev) => ({ ...prev, areaKeys, bayKeys: [] }))}
                      options={pointAreaOptions}
                    />
                  </div>
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">间隔</span>
                    <Select
                      mode="multiple"
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      maxTagCount={SELECT_MAX_TAG_COUNT}
                      placeholder="请选择间隔"
                      value={pointDraft.bayKeys}
                      onChange={(bayKeys) => setPointDraft((prev) => ({ ...prev, bayKeys }))}
                      options={pointBayOptions}
                    />
                  </div>
                  <div className="verify-task-filter-item">
                    <span className="verify-task-filter-label">点位名称</span>
                    <Input
                      allowClear
                      placeholder="请输入点位名称"
                      value={pointDraft.pointName}
                      onChange={(event) => setPointDraft((prev) => ({ ...prev, pointName: event.target.value }))}
                      onPressEnter={() => setPointFilters(pointDraft)}
                    />
                  </div>
                  <div className="verify-task-filter-actions">
                    <Button type="primary" onClick={() => { setPointFilters(pointDraft); setPointPage(createPageState()); }}>搜索</Button>
                    <Button onClick={resetPointSearch}>重置</Button>
                  </div>
                </div>

                <Spin spinning={loading}>
                  <div className="verify-task-point-layout">
                    <div className="verify-task-point-pane">
                      <div className="verify-task-list-head">
                        <span>可选点位</span>
                        <span className="verify-task-selected-count">可选点位 {filteredPoints.length} 个</span>
                      </div>
                      <Table<DevicePoint>
                        className="verify-task-table verify-task-table-point"
                        rowKey={pointRowKey}
                        columns={pointColumns}
                        dataSource={filteredPoints}
                        size="small"
                        pagination={pointPagination}
                        tableLayout="fixed"
                        scroll={POINT_TABLE_SCROLL}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无点位" /> }}
                        rowSelection={{
                          selectedRowKeys: selectedPointKeys,
                          preserveSelectedRowKeys: true,
                          onChange: (keys) => handlePointSelectionChange(keys),
                        }}
                      />
                    </div>
                    <div className="verify-task-point-pane">
                      <div className="verify-task-list-head">
                        <span>已选点位</span>
                        <span className="verify-task-selected-count">已选点位 {selectedPoints.length} 个</span>
                      </div>
                      <Table<DevicePoint>
                        className="verify-task-table verify-task-table-point verify-task-table-point-selected"
                        rowKey={pointRowKey}
                        columns={selectedPointColumns}
                        dataSource={selectedPoints}
                        size="small"
                        pagination={false}
                        tableLayout="fixed"
                        scroll={POINT_TABLE_SCROLL}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已选点位" /> }}
                      />
                    </div>
                  </div>
                </Spin>
              </>
            ),
          },
        ]}
      />
    </Modal>
  );
}
