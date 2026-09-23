import { Form, Button, Card, Space, Tag, Tooltip, message } from "antd";
import IpInput from "@/components/ip-input";
import { RobotFilled } from "@ant-design/icons";
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
  const isRobot = record.type === "robot";

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
    <Card
      size="small"
      title={
        <Space size={8}>
          {isRobot && (
            <Tooltip title="机器人网口">
              <span
                aria-label="机器人网口"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  border: "1px solid #bae0ff",
                  borderRadius: 4,
                  color: "#1677ff",
                  background: "#e6f4ff",
                  fontSize: 14,
                }}
              >
                <RobotFilled />
              </span>
            </Tooltip>
          )}
          <span>{record.name}</span>
          <Tag color={isRobot ? "blue" : undefined} style={{ marginInlineEnd: 0 }}>
            {record.type}
          </Tag>
        </Space>
      }
    >
      <Form form={form} layout="vertical" initialValues={record}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0 24px", alignItems: "end" }}>
          <Form.Item label="IP地址" name="ip" rules={[{ required: true, message: "请输入IP地址" }]}>
            <IpInput />
          </Form.Item>
          <Form.Item label="子网掩码" name="subnetMask" rules={[{ required: true, message: "请输入子网掩码" }]}>
            <IpInput />
          </Form.Item>
          <Form.Item label="网关" name="gateway">
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
