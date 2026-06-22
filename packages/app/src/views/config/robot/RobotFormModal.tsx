import { useEffect } from "react";
import { Modal, Form, Input, Select } from "antd";
import IpInput from "@/components/ip-input";

interface FacOption {
  value: number;
  label: string;
}

interface Props {
  open: boolean;
  record: { id: number; robotName: string; robotCode: string } | null;
  facOptions: FacOption[];
  confirmLoading: boolean;
  onClose: () => void;
  onSubmit: (values: any) => void;
}

export default function RobotFormModal({ open, record, facOptions, confirmLoading, onClose, onSubmit }: Props) {
  const [form] = Form.useForm();
  const isEdit = !!record;

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
      title={isEdit ? "编辑机器人" : "新增机器人"}
      open={open}
      centered
      onOk={handleOk}
      onCancel={onClose}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirmLoading}
      destroyOnClose
      getContainer={false}
    >
      <Form form={form} layout="horizontal" labelAlign="right" labelCol={{ span: 6 }} wrapperCol={{ span: 18 }}>
        {isEdit ? (
          <>
            <Form.Item label="机器人名称" name="robotName" rules={[{ required: true, message: "请输入机器人名称" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="机器人编码" name="robotCode" rules={[{ required: true, message: "请输入机器人编码" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item label="所属厂站" name="belongFacId" rules={[{ required: true, message: "请选择厂站" }]}>
              <Select placeholder="请选择" options={facOptions} />
            </Form.Item>
            <Form.Item label="IP 地址" name="ip" rules={[{ required: true, message: "请输入 IP" }]}>
              <IpInput />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
