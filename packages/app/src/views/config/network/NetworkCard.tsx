import { Form, Button, Card, message } from "antd";
import IpInput from "@/components/ip-input";
import { editNetwork } from "@/api/config.js";
import { getRequestErrorMessage } from "@/services/http";
import type { NetworkRecord } from "./index";

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

interface NetworkCardProps {
  record: NetworkRecord;
}

export function NetworkCard({ record }: NetworkCardProps) {
  const [form] = Form.useForm();

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      const res = await editNetwork({ ...record, ...values });
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存失败:", err);
      message.error(getRequestErrorMessage(err, "保存失败"));
    }
  };

  return (
    <Card size="small" title={record.name}>
      <Form form={form} layout="vertical" initialValues={record}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0 24px", alignItems: "end" }}>
          <Form.Item label="IP地址" name="ip" rules={[{ required: true, message: "请输入IP地址" }]}>
            <IpInput />
          </Form.Item>
          <Form.Item label="子网掩码" name="subnetMask" rules={[{ required: true, message: "请输入子网掩码" }]}>
            <IpInput />
          </Form.Item>
          <Form.Item label="网关" name="gateway" rules={[{ required: true, message: "请输入网关" }]}>
            <IpInput />
          </Form.Item>
          <Form.Item>
            <Button type="link" onClick={handleSave}>确定</Button>
          </Form.Item>
        </div>
      </Form>
    </Card>
  );
}
