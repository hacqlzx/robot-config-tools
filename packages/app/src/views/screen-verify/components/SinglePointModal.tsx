import { Form, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import type { SinglePointDraft } from "../types";
import { findTargetTypeOption } from "../utils/constants";
import { TargetTypeModal } from "./TargetTypeModal";

interface SinglePointModalProps {
  open: boolean;
  initialValues: SinglePointDraft;
  onCancel: () => void;
  onSubmit: (values: SinglePointDraft) => void;
}

export function SinglePointModal({ open, initialValues, onCancel, onSubmit }: SinglePointModalProps) {
  const [form] = Form.useForm<SinglePointDraft>();
  const [targetTypeModalOpen, setTargetTypeModalOpen] = useState(false);
  const recognitionLabel = Form.useWatch("recognitionLabel", form);
  const recognitionType = Form.useWatch("recognitionType", form);

  useEffect(() => {
    if (!open) {
      setTargetTypeModalOpen(false);
      return;
    }
    const matchedType = findTargetTypeOption(initialValues.recognitionLabel, initialValues.recognitionLabelDesc || initialValues.recognitionType);
    form.setFieldsValue({
      ...initialValues,
      recognitionType: matchedType?.label || initialValues.recognitionType,
      recognitionLabel: matchedType?.value || initialValues.recognitionLabel,
      recognitionLabelDesc: matchedType?.label || initialValues.recognitionLabelDesc,
    });
  }, [form, initialValues, open]);

  return (
    <>
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
            recognitionType: (values.recognitionLabelDesc || values.recognitionType || "").trim(),
            recognitionLabel: values.recognitionLabel,
            recognitionLabelDesc: values.recognitionLabelDesc,
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
            label="目标类型"
            rules={[{ required: true, whitespace: true, message: "请选择目标类型" }]}
          >
            <Input readOnly placeholder="请选择目标类型" onClick={() => setTargetTypeModalOpen(true)} />
          </Form.Item>
          <Form.Item name="recognitionLabel" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="recognitionLabelDesc" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <TargetTypeModal
        open={targetTypeModalOpen}
        value={recognitionLabel || findTargetTypeOption(undefined, recognitionType)?.value || ""}
        onCancel={() => setTargetTypeModalOpen(false)}
        onSubmit={(option) => {
          form.setFieldsValue({
            recognitionType: option.label,
            recognitionLabel: option.value,
            recognitionLabelDesc: option.label,
          });
          setTargetTypeModalOpen(false);
        }}
      />
    </>
  );
}
