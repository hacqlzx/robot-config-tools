import { useEffect } from "react";
import { Modal, Form, Input, Select } from "antd";
import type { StationRecord } from "./index";

const FAC_TYPE_OPTIONS = [
  { value: "10", label: "配电房" },
  { value: "20", label: "开闭所" },
  { value: "30", label: "变电站" },
];

const STATION_TYPE_OPTIONS = [
  { value: "1", label: "AIS站" },
  { value: "2", label: "GIS站" },
  { value: "3", label: "HGIS站" },
  { value: "4", label: "室内站" },
];

interface Props {
  open: boolean;
  record: StationRecord | null;
  onClose: () => void;
  onSubmit: (values: StationRecord) => void;
}

export default function StationFormModal({ open, record, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      if (record) {
        form.setFieldsValue(record);
      } else {
        form.resetFields();
      }
    }
  }, [open, record, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit(values);
  };

  return (
    <Modal
      title={record ? "编辑厂站" : "新增厂站"}
      open={open}
      centered
      onOk={handleOk}
      onCancel={onClose}
      okText="确定"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="horizontal" labelAlign="right" labelCol={{ span: 6 }} wrapperCol={{ span: 18 }}>
        <Form.Item label="厂站名称" name="stationName" rules={[{ required: true, message: "请输入厂站名称" }]}>
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="厂站编码" name="stationCode" rules={[{ required: true, message: "请输入厂站编码" }]}>
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="电压等级" name="voltName" rules={[{ required: true, message: "请输入电压等级" }]}>
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="厂站类型" name="facType" rules={[{ required: true, message: "请选择厂站类型" }]}>
          <Select placeholder="请选择" options={FAC_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="变电站类型" name="stationType" rules={[{ required: true, message: "请选择变电站类型" }]}>
          <Select placeholder="请选择" options={STATION_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="省" name="provinceName">
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="市" name="cityName">
          <Input placeholder="请输入" />
        </Form.Item>
        <Form.Item label="区" name="areaName">
          <Input placeholder="请输入" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
