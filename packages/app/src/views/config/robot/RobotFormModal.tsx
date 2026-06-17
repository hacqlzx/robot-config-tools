import { useEffect } from "react";
import { Modal, Form, Input, InputNumber, Select } from "antd";
import IpInput from "@/components/ip-input";

interface FacOption {
  value: string;
  label: string;
}

interface Props {
  open: boolean;
  record: { id: number; robotName: string; robotCode: string } | null;
  facOptions: FacOption[];
  onClose: () => void;
  onSubmit: (values: any) => void;
}

export default function RobotFormModal({ open, record, facOptions, onClose, onSubmit }: Props) {
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
      destroyOnClose
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
            <Form.Item label="所属厂站" name="belongFacIdList" rules={[{ required: true, message: "请选择厂站" }]}>
              <Select mode="multiple" placeholder="请选择" options={facOptions} />
            </Form.Item>
            <Form.Item label="IP 地址" name="ip" rules={[{ required: true, message: "请输入 IP" }]}>
              <IpInput />
            </Form.Item>
            <Form.Item label="端口" name="port" rules={[{ required: true, message: "请输入端口" }]}>
              <InputNumber placeholder="请输入" style={{ width: "100%" }} min={1} max={65535} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
