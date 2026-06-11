import { useState, useEffect, useRef } from "react";
import { Modal, Form, Button, List, Popconfirm, Space, Input, message } from "antd";
import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import { getCurrentIp, setCurrentIp } from "@/stores/backendStore";

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

/** IP 输入组件 */
function IpInput({ value, onChange }: { value?: string; onChange?: (val: string) => void }) {
  const parts = (value || "").split(".");
  const refs = useRef<any[]>([]);
  const [vals, setVals] = useState([parts[0] || "", parts[1] || "", parts[2] || "", parts[3] || ""]);

  const emit = (next: string[]) => {
    const ip = next.join(".");
    next.every((n) => n !== "") ? onChange?.(ip) : onChange?.("");
  };

  const handleChange = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 3) {
      const overflow = digits.slice(3);
      const next = [...vals];
      next[index] = digits.slice(0, 3);
      setVals(next); emit(next);
      if (overflow && index < 3) {
        const next2 = [...next];
        next2[index + 1] = overflow;
        setVals(next2); emit(next2);
        if (overflow.length >= 3 && index < 2) refs.current[index + 2]?.focus();
        else refs.current[index + 1]?.focus();
      }
      return;
    }
    const next = [...vals];
    next[index] = digits;
    setVals(next); emit(next);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "." || e.key === "ArrowRight") { e.preventDefault(); if (index < 3) refs.current[index + 1]?.focus(); }
    else if (e.key === "ArrowLeft" && index > 0 && !vals[index]) refs.current[index - 1]?.focus();
    else if (e.key === "Backspace" && !vals[index] && index > 0) refs.current[index - 1]?.focus();
  };

  const inputStyle: React.CSSProperties = { width: 52, textAlign: "center", padding: "4px 0", border: "none", outline: "none", background: "transparent", boxShadow: "none" };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid #d9d9d9", borderRadius: 6, padding: "0 8px", background: "#fff" }}>
      {vals.map((v, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center" }}>
          <Input ref={(el: any) => (refs.current[i] = el)} value={v} onChange={(e) => handleChange(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} style={inputStyle} maxLength={4} placeholder="0" />
          {i < 3 && <span style={{ color: "#bfbfbf", userSelect: "none" }}>.</span>}
        </span>
      ))}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function BackendModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const [ipList, setIpList] = useState<IpRecord[]>(loadIpList);
  const [connecting, setConnecting] = useState(false);
  const [connectingIndex, setConnectingIndex] = useState<number | null>(null);

  useEffect(() => { saveIpList(ipList); }, [ipList]);

  const connect = async (ip: string) => {
    if (!ipRegex.test(ip)) { message.error("请输入正确的 IP 地址"); return false; }
    setConnecting(true);
    const ok = __ELECTRON__ ? (window.electronAPI?.ping?.(ip) ?? false) : false;
    setConnecting(false);
    return ok;
  };

  const handleAdd = async (values: { ip: string }) => {
    const ok = await connect(values.ip);
    if (ok) {
      setIpList([...ipList, { ip: values.ip }]);
      setCurrentIp(values.ip);
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
      setCurrentIp(ip);
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
      maskClosable={false}
      footer={null}
      onCancel={onClose}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="horizontal" labelAlign="left" onFinish={handleAdd}>
        <Form.Item label="后台 IP" name="ip" rules={[{ required: true, message: "请输入 IP" }, { pattern: ipRegex, message: "请输入完整 IP" }]}>
          <IpInput />
        </Form.Item>
        <Form.Item style={{ marginBottom: 12, textAlign: "right" }}>
          <Space>
            <Button onClick={() => form.resetFields()}>重置</Button>
            <Button type="primary" htmlType="submit" loading={connecting}>连接</Button>
          </Space>
        </Form.Item>
      </Form>
      {ipList.length > 0 && (
        <List
          size="small"
          header={<div style={{ fontWeight: 500 }}>已保存的 IP</div>}
          dataSource={ipList}
          renderItem={(item, index) => (
            <List.Item
              actions={[
                <Button key="connect" type="link" size="small" icon={<LinkOutlined />} loading={connectingIndex === index} onClick={() => handleListConnect(index)}>连接</Button>,
                <Popconfirm key="del" title="确定删除？" onConfirm={() => deleteIp(index)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <IpInput value={item.ip} onChange={(val) => { if (val) { const u = [...ipList]; u[index] = { ip: val }; setIpList(u); } }} />
            </List.Item>
          )}
        />
      )}
    </Modal>
  );
}
