import type { TableColumnsType } from "antd";
import type { CabinetPointRow } from "../types";

export const MIN_ANNOTATION_RECT_SIZE = 4;
export const ANNOTATION_HANDLE_RADIUS = 4;
export const ANNOTATION_HANDLE_HIT_RADIUS = 8;

export const ANNOTATION_COLORS = {
  standardPartManual: "#22b8ff",
  standardPartRecognition: "#0050b3",
  deviceLabelManual: "#ffd43b",
  deviceLabelRecognition: "#d48806",
  deviceBoxManual: "#22b8ff",
  deviceBoxRecognition: "#0050b3",
  appearance: "#52c41a",
} as const;

export const statusOptions = [
  { value: "marked", label: "已标注" },
  { value: "unmarked", label: "未标注" },
  { value: "all", label: "全部" },
];

export const generateModeLabels = {
  whole: "多点生成（整图）",
  add: "多点生成（新增）",
} as const;

export const recognitionTypeOptions = [
  { value: "表计读取", label: "表计读取" },
  { value: "位置状态识别", label: "位置状态识别" },
  { value: "设备外观查看", label: "设备外观查看" },
  { value: "声音检测", label: "声音检测" },
  { value: "红外测温", label: "红外测温" },
  { value: "可见光查看", label: "可见光查看" },
];

export const columns: TableColumnsType<CabinetPointRow> = [
  {
    title: "序号",
    dataIndex: "index",
    width: 64,
  },
  {
    title: "名称",
    dataIndex: "name",
    ellipsis: true,
  },
  {
    title: "类型",
    dataIndex: "type",
    width: 96,
    ellipsis: true,
  },
  {
    title: "置信度",
    dataIndex: "confidence",
    width: 86,
    render: (value?: number) => (typeof value === "number" ? `${Math.round(value * 100)}%` : ""),
  },
];
