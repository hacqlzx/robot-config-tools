import { Form, Input, Modal, Select } from "antd";
import { useEffect } from "react";
import type { SinglePointDraft } from "../types";
import { recognitionTypeOptions } from "../utils/constants";

interface SinglePointModalProps {
  open: boolean;
  initialValues: SinglePointDraft;
  onCancel: () => void;
  onSubmit: (values: SinglePointDraft) => void;
}

export function SinglePointModal({ open, initialValues, onCancel, onSubmit }: SinglePointModalProps) {
  const [form] = Form.useForm<SinglePointDraft>();

  useEffect(() => {
    if (open) form.setFieldsValue(initialValues);
  }, [form, initialValues, open]);

  return (
    <Modal
      title="单点新增生成"
      open={open}
      centered
      destroyOnHidden
      okText="确定"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={(values) => onSubmit({
          pointName: values.pointName.trim(),
          recognitionType: values.recognitionType,
        })}
      >
        <Form.Item
          name="pointName"
          label="点位名称"
          rules={[
            { required: true, whitespace: true, message: "请输入点位名称" },
          ]}
        >
          <Input autoFocus placeholder="请输入点位名称" maxLength={80} />
        </Form.Item>
        <Form.Item
          name="recognitionType"
          label="识别类型"
          rules={[{ required: true, message: "请选择识别类型" }]}
        >
          <Select
            placeholder="请选择识别类型"
            options={recognitionTypeOptions}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
