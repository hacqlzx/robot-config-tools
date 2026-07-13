import { useState, useEffect } from "react";
import { Modal, Form, Button, Popconfirm, message } from "antd";
import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import {
  setBackendConnection,
  setConnectionStatus,
  useAppContext,
} from "@/stores/appContextStore";
import IpInput from "@/components/ip-input";

const STORAGE_KEY = "backend_ip_list";
const ipRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

interface IpRecord {
  ip: string;
}

function loadIpList(): IpRecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveIpList(list: IpRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BackendModal({ open, onClose }: Props) {
  const { backendIp } = useAppContext();
  const [form] = Form.useForm();
  const [ipList, setIpList] = useState<IpRecord[]>(loadIpList);
  const [connecting, setConnecting] = useState(false);
  const [connectingIndex, setConnectingIndex] = useState<number | null>(null);

  useEffect(() => { saveIpList(ipList); }, [ipList]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (backendIp) {
        form.setFieldsValue({ ip: backendIp });
      }
    }
  }, [backendIp, open, form]);

  const connect = async (ip: string) => {
    if (!ipRegex.test(ip)) { message.error("请输入正确的 IP 地址"); return false; }
    setConnecting(true);
    try {
      const ok = __ELECTRON__ && window.electronAPI?.ping
        ? await window.electronAPI.ping(ip)
        : false;
      if (!ok) setConnectionStatus("failed");
      return ok;
    } catch {
      setConnectionStatus("failed");
      return false;
    } finally {
      setConnecting(false);
    }
  };

  const handleAdd = async (values: { ip: string }) => {
    const ok = await connect(values.ip);
    if (ok) {
      setIpList([...ipList, { ip: values.ip }]);
      setBackendConnection(values.ip, "connected");
      message.success(`${values.ip} 连接成功`);
      form.resetFields();
      onClose();
    } else {
      message.error(`${values.ip} 无法连接`);
    }
  };

  const handleListConnect = async (index: number) => {
    const ip = ipList[index].ip;
    setConnectingIndex(index);
    const ok = await connect(ip);
    setConnectingIndex(null);
    if (ok) {
      setBackendConnection(ip, "connected");
      message.success(`${ip} 连接成功`);
      onClose();
    } else {
      message.error(`${ip} 无法连接`);
    }
  };

  const deleteIp = (index: number) => setIpList(ipList.filter((_, i) => i !== index));

  return (
    <Modal
      title="连接后台"
      open={open}
      centered
      mask={{ closable: false }}
      footer={null}
      onCancel={onClose}
    >
      <Form form={form} layout="horizontal" labelAlign="left" onFinish={handleAdd}>
        <Form.Item label="后台 IP" name="ip" rules={[{ required: true, message: "请输入 IP" }, { pattern: ipRegex, message: "请输入完整 IP" }]}>
          <IpInput />
        </Form.Item>
        <Form.Item style={{ marginBottom: 12, textAlign: "right" }}>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onClick={() => form.resetFields()}>重置</Button>
            <Button type="primary" htmlType="submit" loading={connecting}>连接</Button>
          </div>
        </Form.Item>
      </Form>
      {ipList.length > 0 && (
        <div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>已保存的 IP</div>
          {ipList.map((item, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <IpInput value={item.ip} onChange={(val) => { if (val) { const u = [...ipList]; u[index] = { ip: val }; setIpList(u); } }} />
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <Button type="link" size="small" icon={<LinkOutlined />} loading={connectingIndex === index} onClick={() => handleListConnect(index)}>连接</Button>
                <Popconfirm title="确定删除？" onConfirm={() => deleteIp(index)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
