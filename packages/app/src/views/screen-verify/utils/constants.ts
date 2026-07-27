import { createElement } from "react";
import { Input } from "antd";
import type { TableColumnsType } from "antd";
import type { CabinetPointRow } from "../types";

export interface TargetTypeOption {
  index: number;
  value: string;
  label: string;
  deviceName: string;
  algorithmType: number;
  algorithmName: string;
}

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
  deviceBoxInferred: "#8c8c8c",
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

export const FACADE_TARGET_TYPE: TargetTypeOption = {
  index: 3,
  value: "facade",
  label: "外观",
  deviceName: "设备外观",
  algorithmType: 13,
  algorithmName: "外观识别",
};

export const targetTypeOptions: TargetTypeOption[] = [
  { index: 0, value: "backup", label: "压板备用", deviceName: "压板", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 1, value: "bl_off", label: "灯灭", deviceName: "指示灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 2, value: "bl_on", label: "灯亮", deviceName: "指示灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  FACADE_TARGET_TYPE,
  { index: 4, value: "fd_off", label: "放电开关自动", deviceName: "放电开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 5, value: "fhkg_off", label: "分合开关分", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 6, value: "fhkg_on", label: "分合开关合", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 7, value: "handle_0", label: "把手水平向左", deviceName: "把手", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 8, value: "handle_180", label: "把手水平向右", deviceName: "把手", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 9, value: "handle_270", label: "把手垂直向上", deviceName: "把手", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 10, value: "handle_90", label: "把手垂直向下", deviceName: "把手", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 11, value: "infrared", label: "红外测温", deviceName: "红外测温", algorithmType: 256, algorithmName: "红外测温" },
  { index: 12, value: "jd", label: "旋钮开关就地", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 13, value: "keyhole_0", label: "钥匙孔开关向右", deviceName: "钥匙孔开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 14, value: "keyhole_135", label: "钥匙孔开关左上45", deviceName: "钥匙孔开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 15, value: "keyhole_45", label: "钥匙孔开关右上45", deviceName: "钥匙孔开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 16, value: "keyhole_90", label: "钥匙孔开关垂直向上", deviceName: "钥匙孔开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 17, value: "led_off", label: "LED灯灭", deviceName: "led灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 18, value: "led_on", label: "LED灯亮", deviceName: "led灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 19, value: "little_light", label: "小灯", deviceName: "小灯", algorithmType: 13, algorithmName: "外观识别" },
  { index: 20, value: "meter_sf6", label: "室内屏柜SF6表", deviceName: "指针表", algorithmType: 5, algorithmName: "指针表智能" },
  { index: 21, value: "num_led", label: "数字表", deviceName: "数字表", algorithmType: 23, algorithmName: "数字表检测" },
  { index: 22, value: "rect_led_off", label: "矩形LED灯灭", deviceName: "矩形灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 23, value: "rect_led_on", label: "矩形LED灯亮", deviceName: "矩形灯", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 24, value: "show_off", label: "显示屏灭", deviceName: "显示屏", algorithmType: 13, algorithmName: "外观识别" },
  { index: 25, value: "show_on", label: "显示屏亮", deviceName: "显示屏", algorithmType: 13, algorithmName: "外观识别" },
  { index: 26, value: "s_down", label: "空开下", deviceName: "空开", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 27, value: "s_left", label: "空开左", deviceName: "空开", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 28, value: "s_right", label: "空开右", deviceName: "空开", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 29, value: "s_up", label: "空开上", deviceName: "空开", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 30, value: "unknown", label: "未知", deviceName: "未知设备", algorithmType: 0, algorithmName: "无检测" },
  { index: 31, value: "xnkg_off", label: "旋钮开关分", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 32, value: "xnkg_on", label: "旋钮开关合", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 33, value: "ybzz", label: "仪表装置", deviceName: "仪表装置", algorithmType: 13, algorithmName: "外观识别" },
  { index: 34, value: "yb_close", label: "压板合", deviceName: "压板", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 35, value: "yb_left", label: "压板左", deviceName: "压板", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 36, value: "yb_open", label: "压板分", deviceName: "压板", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 37, value: "yf", label: "旋钮开关远方", deviceName: "旋钮开关", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 38, value: "zldlq_left", label: "直流断路器合(左)", deviceName: "直流断路器", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 39, value: "zldlq_off", label: "直流断路器分(下)", deviceName: "直流断路器", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 40, value: "zldlq_on", label: "直流断路器合(上)", deviceName: "直流断路器", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 41, value: "zldlq_right", label: "直流断路器分(右)", deviceName: "直流断路器", algorithmType: 49, algorithmName: "室内深度学习目标检测" },
  { index: 42, value: "zzb", label: "指针表", deviceName: "指针表", algorithmType: 5, algorithmName: "指针表智能" },
];

export function findTargetTypeOption(value?: string, label?: string): TargetTypeOption | undefined {
  const normalizedValue = value?.trim();
  const normalizedLabel = label?.trim();
  return targetTypeOptions.find((option) => (
    (normalizedValue && option.value === normalizedValue)
    || (normalizedLabel && option.label === normalizedLabel)
  ));
}

interface CabinetPointColumnOptions {
  editingNameRowKey: string;
  editingNameValue: string;
  onStartEditName: (record: CabinetPointRow) => void;
  onChangeEditName: (value: string) => void;
  onSubmitEditName: () => void;
  onCancelEditName: () => void;
  onEditType: (record: CabinetPointRow) => void;
}

export function createCabinetPointColumns(options: CabinetPointColumnOptions): TableColumnsType<CabinetPointRow> {
  return [
  {
    title: "序号",
    dataIndex: "index",
    width: 64,
  },
  {
    title: "名称",
    dataIndex: "name",
    ellipsis: true,
    onCell: (record) => ({
      onDoubleClick: () => {
        if (record.key !== options.editingNameRowKey) options.onStartEditName(record);
      },
    }),
    render: (value: string, record) => {
      const lowConfidence = record.source === "ocr" && typeof record.confidence === "number" && record.confidence < 0.5;
      if (record.key === options.editingNameRowKey) {
        return createElement(Input, {
          autoFocus: true,
          size: "small",
          className: "screen-verify-table-name-input",
          value: options.editingNameValue,
          onChange: (event) => options.onChangeEditName(event.target.value),
          onPressEnter: (event) => event.currentTarget.blur(),
          onBlur: () => options.onSubmitEditName(),
          onClick: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          onKeyDown: (event) => {
            event.stopPropagation();
            if (event.key === "Escape") options.onCancelEditName();
          },
        });
      }
      const emptyName = !String(value || "").trim();
      return createElement(
        "span",
        {
          className: emptyName
            ? "screen-verify-table-name screen-verify-table-name-empty"
            : lowConfidence
            ? "screen-verify-table-name screen-verify-table-name-low-confidence"
            : "screen-verify-table-name",
          title: value || "",
          onDoubleClick: (event) => {
            event.stopPropagation();
            options.onStartEditName(record);
          },
        },
        value || "",
      );
    },
  },
  {
    title: "类型",
    dataIndex: "type",
    width: 120,
    ellipsis: true,
    render: (value: string | undefined, record) => {
      const label = value || record.recognitionLabelDesc || record.recognitionLabel || "";
      return createElement(
        "button",
        {
          type: "button",
          className: "screen-verify-table-type-button",
          title: label || "选择目标类型",
          onClick: (event) => {
            event.stopPropagation();
            options.onEditType(record);
          },
        },
        label || "请选择",
      );
    },
  },
  ];
}
