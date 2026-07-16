import { useCallback, useEffect, useMemo, useState, type Key } from "react";
import { App, Button, Empty, Form, Input, Modal, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  robotAreasToDrawingItemsData,
  type DrawingRenderItem,
  type RobotAreaRecord,
} from "@/components/three-d-engine/drawing-data";
import "./SurveyPhotoModal.scss";

const MAP_DIR_NAME = "地图";
const AREA_FILE_NAME = "description_file.json";
const STOP_POINT_FILE_NAMES = ["stop_points.json", "stop_point.json"] as const;

export type SurveyPhotoMode = "normal" | "supplement";

export interface SurveyPhotoDeviceArea {
  bayId: number;
  bayName: string;
}

export interface SurveyPhotoDispatchItem extends SurveyPhotoDeviceArea {
  regionId?: string;
  stopPointId?: string;
  stopPointName?: string;
  poseX?: string;
  poseY?: string;
  poseYaw?: string;
  pointType?: string;
  genType?: string;
  spin?: string;
  accurateArrival?: string;
}

interface SupplementSurveyPhotoRow extends SurveyPhotoDispatchItem {
  stopPointId: string;
  regionId: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface SurveyPhotoModalProps {
  open: boolean;
  title?: string;
  mode?: SurveyPhotoMode;
  projectName?: string | null;
  mapName?: string | null;
  onClose: () => void;
  onDispatch?: (items: SurveyPhotoDispatchItem[]) => void | Promise<void>;
}

interface StopPointRecord {
  id?: string | number;
  name?: string | number;
  pose_x?: string | number;
  pose_y?: string | number;
  pose_yaw?: string | number;
  type?: string | number;
  gen_type?: string | number;
  spin?: string | number;
  accurate_arrival?: string | number;
  region_ids?: string | number;
}

interface DeviceRegion {
  regionId: string;
  regionName: string;
}

function walkTree(nodes: TreeNode[], visit: (node: TreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children) walkTree(node.children, visit);
  }
}

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function valueText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function positiveInt(value: unknown): number | null {
  const text = valueText(value);
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRobotAreaRecords(value: unknown): RobotAreaRecord[] | null {
  if (Array.isArray(value)) return value as RobotAreaRecord[];
  if (isRecord(value) && Array.isArray(value.data)) return value.data as RobotAreaRecord[];
  return null;
}

function getRecordArray(value: unknown, keys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of keys) {
    const child = value[key];
    if (Array.isArray(child)) return child.filter(isRecord);
  }
  return [];
}

function parseJsonText(text: string): unknown {
  // 机器人导出的部分 JSON 允许对象/数组末尾尾逗号，先做轻量容错。
  return JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
}

function getDrawingItems(value: unknown): DrawingRenderItem[] {
  if (isRecord(value) && Array.isArray(value.items)) return value.items as DrawingRenderItem[];
  return [];
}

function collectDeviceAreas(items: DrawingRenderItem[]): SurveyPhotoDeviceArea[] {
  const nextAreas = new Map<number, SurveyPhotoDeviceArea>();
  for (const item of items) {
    if (item.type !== "device-area" || !item.bay?.id || !item.bay.name) continue;
    if (!nextAreas.has(item.bay.id)) {
      nextAreas.set(item.bay.id, {
        bayId: item.bay.id,
        bayName: item.bay.name,
      });
    }
  }
  return Array.from(nextAreas.values()).sort((a, b) => a.bayId - b.bayId);
}

function rowKey(row: SurveyPhotoDispatchItem): string {
  return row.stopPointId ? `stop-${row.stopPointId}-region-${row.regionId || "none"}` : `bay-${row.bayId}`;
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

function buildRegionIndex(areaRecords: RobotAreaRecord[]): DeviceRegion[] {
  const regions = new Map<string, DeviceRegion>();
  for (const record of areaRecords) {
    if (valueText(record.type) !== "8") continue;
    const regionId = valueText(record.id);
    if (!regionId || regions.has(regionId)) continue;
    regions.set(regionId, {
      regionId,
      regionName: valueText(record.name) || `设备区${regionId}`,
    });
  }
  return Array.from(regions.values());
}

function splitRegionIds(value: unknown): string[] {
  return valueText(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSupplementRows(stopPoints: StopPointRecord[], regions: DeviceRegion[]): SupplementSurveyPhotoRow[] {
  const type5 = stopPoints.filter((point) => valueText(point.type) === "5");
  const gen0 = type5.filter((point) => valueText(point.gen_type) === "0");
  const source = gen0.length > 0 ? gen0 : type5;
  const firstRegion = regions[0] || { regionId: "", regionName: "未绑定设备区" };
  const regionMap = new Map(regions.map((region) => [region.regionId, region]));
  const rows: SupplementSurveyPhotoRow[] = [];

  for (const point of source) {
    const stopPointId = valueText(point.id);
    if (!stopPointId) continue;
    const regionIds = splitRegionIds(point.region_ids);
    const effectiveRegionIds = regionIds.length > 0 ? regionIds : [firstRegion.regionId];

    for (const regionId of effectiveRegionIds) {
      const region = regionMap.get(regionId) || (regionId ? { regionId, regionName: `设备区${regionId}` } : firstRegion);
      rows.push({
        bayId: positiveInt(region.regionId) || 0,
        bayName: region.regionName,
        regionId: region.regionId,
        stopPointId,
        stopPointName: valueText(point.name) || stopPointId,
        poseX: valueText(point.pose_x),
        poseY: valueText(point.pose_y),
        poseYaw: valueText(point.pose_yaw),
        pointType: valueText(point.type),
        genType: valueText(point.gen_type),
        spin: valueText(point.spin),
        accurateArrival: valueText(point.accurate_arrival),
      });
    }
  }

  return rows.sort((a, b) => {
    const aid = Number(a.stopPointId);
    const bid = Number(b.stopPointId);
    if (Number.isFinite(aid) && Number.isFinite(bid) && aid !== bid) return aid - bid;
    return a.stopPointId.localeCompare(b.stopPointId) || a.regionId.localeCompare(b.regionId);
  });
}

export default function SurveyPhotoModal({
  open,
  title = "勘察拍照",
  mode = "normal",
  projectName,
  mapName,
  onClose,
  onDispatch,
}: SurveyPhotoModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [areas, setAreas] = useState<SurveyPhotoDeviceArea[]>([]);
  const [supplementRows, setSupplementRows] = useState<SupplementSurveyPhotoRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);
  const deviceAreaKeyword = Form.useWatch("deviceAreaName", form) || "";
  const [supplementFilters, setSupplementFilters] = useState({ deviceAreaName: "", stopPointKeyword: "" });

  const resetModalState = useCallback(() => {
    form.resetFields();
    setLoading(false);
    setAreas([]);
    setSupplementRows([]);
    setSelectedKeys([]);
    setSupplementFilters({ deviceAreaName: "", stopPointKeyword: "" });
    setSubmitting(false);
  }, [form]);

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

    if (!projectName || !mapName || !window.electronAPI?.project || !window.electronAPI?.readLargeFile) {
      setLoading(false);
      setAreas([]);
      setSupplementRows([]);
      return;
    }

    let ignore = false;
    setLoading(true);
    (async () => {
      try {
        const tree = await window.electronAPI!.project.listTree(projectName, `${MAP_DIR_NAME}/${mapName}`);
        const areaFilePath = findFilePath(tree as TreeNode[], [AREA_FILE_NAME]);

        if (!areaFilePath) {
          if (!ignore) {
            setAreas([]);
            setSupplementRows([]);
          }
          return;
        }

        const buf = await window.electronAPI!.readLargeFile(areaFilePath);
        const parsed = parseJsonText(new TextDecoder().decode(buf));
        const records = getRobotAreaRecords(parsed);

        if (!ignore) {
          if (mode === "supplement") {
            const stopPointPath = findFilePath(tree as TreeNode[], STOP_POINT_FILE_NAMES);
            const stopPointRecords = stopPointPath
              ? getRecordArray(parseJsonText(new TextDecoder().decode(await window.electronAPI!.readLargeFile(stopPointPath))), ["stop_points", "stopPoints", "items", "data"]) as StopPointRecord[]
              : [];
            setAreas([]);
            setSupplementRows(buildSupplementRows(stopPointRecords, buildRegionIndex(records || [])));
          } else {
            const drawingItems = records ? robotAreasToDrawingItemsData(records).items : getDrawingItems(parsed);
            setAreas(collectDeviceAreas(drawingItems));
            setSupplementRows([]);
          }
          setSelectedKeys([]);
        }
      } catch (e: any) {
        if (!ignore) {
          setAreas([]);
          setSupplementRows([]);
          message.error("读取设备区失败: " + (e?.message || e));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [form, mapName, message, mode, open, projectName, resetModalState]);

  const filteredAreas = useMemo(() => {
    const normalized = normalizeKeyword(deviceAreaKeyword);
    if (!normalized) return areas;
    return areas.filter((area) => area.bayName.toLowerCase().includes(normalized));
  }, [areas, deviceAreaKeyword]);

  const filteredSupplementRows = useMemo(() => {
    const areaKeyword = normalizeKeyword(supplementFilters.deviceAreaName);
    const stopPointKeyword = normalizeKeyword(supplementFilters.stopPointKeyword);
    return supplementRows
      .filter((row) => !areaKeyword || row.bayName.toLowerCase().includes(areaKeyword))
      .filter((row) => !stopPointKeyword || row.stopPointId.toLowerCase().includes(stopPointKeyword) || row.stopPointName?.toLowerCase().includes(stopPointKeyword));
  }, [supplementFilters, supplementRows]);

  const allRows: SurveyPhotoDispatchItem[] = mode === "supplement" ? supplementRows : areas;
  const tableRows: SurveyPhotoDispatchItem[] = mode === "supplement" ? filteredSupplementRows : filteredAreas;

  const selectedAreas = useMemo(() => {
    const selectedSet = new Set(selectedKeys.map(String));
    return allRows.filter((row) => selectedSet.has(rowKey(row)));
  }, [allRows, selectedKeys]);

  const columns: ColumnsType<SurveyPhotoDispatchItem> = [
    {
      title: "序号",
      width: 78,
      align: "center",
      render: (_value, _record, index) => index + 1,
    },
    {
      title: "设备区",
      dataIndex: "bayName",
      ellipsis: true,
    },
  ];
  if (mode === "supplement") {
    columns.push({
      title: "停靠点id",
      dataIndex: "stopPointId",
      ellipsis: true,
    });
  }

  const handleSupplementSearch = () => {
    const values = form.getFieldsValue();
    setSupplementFilters({
      deviceAreaName: String(values.deviceAreaName || ""),
      stopPointKeyword: String(values.stopPointKeyword || ""),
    });
  };

  const handleDispatch = async () => {
    if (selectedAreas.length === 0) {
      message.warning(mode === "supplement" ? "请选择停靠点" : "请选择设备区");
      return;
    }

    setSubmitting(true);
    try {
      await onDispatch?.(selectedAreas);
      resetModalState();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="survey-photo-modal"
      title={title}
      open={open}
      onCancel={handleClose}
      destroyOnHidden
      centered
      width={mode === "supplement" ? 640 : undefined}
      footer={
        <div className="survey-photo-modal-footer">
          <Button onClick={handleClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={handleDispatch} loading={submitting} disabled={selectedAreas.length === 0}>
            确定
          </Button>
        </div>
      }
    >
      {mode === "supplement" ? (
        <Form form={form} layout="inline" className="survey-photo-filter-form survey-photo-supplement-filter">
          <Form.Item label="设备区" name="deviceAreaName">
            <Input allowClear placeholder="请输入设备区" />
          </Form.Item>
          <Form.Item label="停靠点" name="stopPointKeyword">
            <Input allowClear placeholder="请输入停靠点" />
          </Form.Item>
          <Button type="primary" onClick={handleSupplementSearch}>查询</Button>
        </Form>
      ) : (
        <Form form={form} layout="vertical" className="survey-photo-filter-form">
          <Form.Item label="设备区" name="deviceAreaName">
            <Input allowClear placeholder="请输入设备区名称" />
          </Form.Item>
        </Form>
      )}

      <div className="survey-photo-list-head">
        <span>{mode === "supplement" ? "停靠点列表" : "设备区列表"}</span>
        <span className="survey-photo-selected-count">已选择 {selectedAreas.length} 项</span>
      </div>

      <Spin spinning={loading}>
        <Table<SurveyPhotoDispatchItem>
          className="survey-photo-table"
          rowKey={rowKey}
          columns={columns}
          dataSource={tableRows}
          pagination={false}
          size="small"
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={mode === "supplement" ? "暂无停靠点" : "暂无设备区"} /> }}
          scroll={{ y: mode === "supplement" ? 260 : 220 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setSelectedKeys(keys),
          }}
        />
      </Spin>
    </Modal>
  );
}
