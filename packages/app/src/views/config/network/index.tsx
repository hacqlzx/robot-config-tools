import { useState, useRef, useEffect } from "react";
import { Alert, Card, Form, Button, message } from "antd";
import IpInput from "@/components/ip-input";
import { getNetworkList, editNetwork } from "@/api/config.js";
import { NetworkCard } from "./NetworkCard";
import { subscribeBackendContext } from "@/stores/appContextStore";

export interface NetworkRecord {
  id: number;
  type: number;
  name: string;
  ip: string;
  subnetMask: string;
  gateway: string;
}

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

export default function NetworkConfig() {
  const [lanForm] = Form.useForm();
  const [intranetForm] = Form.useForm();
  const [robotList, setRobotList] = useState<NetworkRecord[]>([]);
  const [lanSaving, setLanSaving] = useState(false);
  const [intranetSaving, setIntranetSaving] = useState(false);
  const fetchedRef = useRef(false);
  const lanRef = useRef<NetworkRecord | null>(null);
  const intranetRef = useRef<NetworkRecord | null>(null);

  const fetchNetworks = async () => {
    try {
      const res = await getNetworkList();
      const body = res.data as ApiResponse<NetworkRecord[]>;
      if (body.success) {
        if (body.data) {
          const robots: NetworkRecord[] = [];
          body.data.forEach((item) => {
            if (item.type === 0) {
              lanRef.current = item;
              lanForm.setFieldsValue(item);
            } else if (item.type === 1) {
              intranetRef.current = item;
              intranetForm.setFieldsValue(item);
            } else {
              robots.push(item);
            }
          });
          setRobotList(robots);
        }
      } else {
        message.error(body.message || "获取网络列表失败");
      }
    } catch (err) {
      console.error("获取网络列表失败:", err);
      message.error("获取网络列表失败");
    }
  };

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchNetworks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IP 切换时重新加载
  useEffect(() => {
    return subscribeBackendContext(() => {
      fetchNetworks();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLanSave = async () => {
    const values = await lanForm.validateFields();
    if (!lanRef.current) return;
    setLanSaving(true);
    try {
      const res = await editNetwork({ ...lanRef.current, ...values });
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存失败:", err);
      message.error("保存失败");
    } finally {
      setLanSaving(false);
    }
  };

  const handleIntranetSave = async () => {
    const values = await intranetForm.validateFields();
    if (!intranetRef.current) return;
    setIntranetSaving(true);
    try {
      const res = await editNetwork({ ...intranetRef.current, ...values });
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存失败:", err);
      message.error("保存失败");
    } finally {
      setIntranetSaving(false);
    }
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
              <Form.Item label="子网掩码" name="subnetMask" rules={[{ required: true, message: "请输入子网掩码" }]}>
                <IpInput />
              </Form.Item>
              <Form.Item label="网关" name="gateway" rules={[{ required: true, message: "请输入网关" }]}>
                <IpInput />
              </Form.Item>
              <Form.Item>
                <Button type="link" loading={lanSaving} onClick={handleLanSave}>确定</Button>
              </Form.Item>
            </div>
          </Form>
        </Card>
        <Card size="small" title="后台内网IP">
          <Form form={intranetForm} layout="vertical">
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
                <Button type="link" loading={intranetSaving} onClick={handleIntranetSave}>确定</Button>
              </Form.Item>
            </div>
          </Form>
        </Card>
        {robotList.map((robot) => (
          <NetworkCard key={robot.id} record={robot} />
        ))}
      </div>
    </div>
  );
}
