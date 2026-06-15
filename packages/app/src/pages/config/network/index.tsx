import { Alert, Card, Form, Input, Button, message } from "antd";
import IpInput from "@/components/ip-input";

export default function NetworkConfig() {
  const [lanForm] = Form.useForm();
  const [wanForm] = Form.useForm();

  const handleLanSave = async () => {
    const values = await lanForm.validateFields();
    console.log(values);
    message.success("保存成功");
  };

  const handleWanSave = async () => {
    const values = await wanForm.validateFields();
    console.log(values);
    message.success("保存成功");
  };

  return (
    <div>
      <Alert
        message="此操作为修改后台服务器IP/机器人本体IP"
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card size="small" title="后台局域网IP">
          <Form form={lanForm} layout="vertical">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0 24px", alignItems: "end" }}>
              <Form.Item label="IP地址" name="ip" rules={[{ required: true, message: "请输入IP地址" }]}>
                <IpInput />
              </Form.Item>
              <Form.Item label="子网掩码" name="mask" rules={[{ required: true, message: "请输入子网掩码" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="网关" name="gateway" rules={[{ required: true, message: "请输入网关" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item>
                <Button type="link" onClick={handleLanSave}>确定</Button>
              </Form.Item>
            </div>
          </Form>
        </Card>
        <Card size="small" title="后台内网IP">
          <Form form={wanForm} layout="vertical">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0 24px", alignItems: "end" }}>
              <Form.Item label="IP地址" name="ip" rules={[{ required: true, message: "请输入IP地址" }]}>
                <IpInput />
              </Form.Item>
              <Form.Item label="子网掩码" name="mask" rules={[{ required: true, message: "请输入子网掩码" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="网关" name="gateway" rules={[{ required: true, message: "请输入网关" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item>
                <Button type="link" onClick={handleWanSave}>确定</Button>
              </Form.Item>
            </div>
          </Form>
        </Card>
      </div>
    </div>
  );
}
