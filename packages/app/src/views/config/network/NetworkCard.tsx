import { Form, Button, Card, Space, Tag, Tooltip, message } from "antd";
import { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
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

type NetworkFormValues = Pick<NetworkRecord, "ip" | "subnetMask" | "gateway">;

function normalizeNetworkValue(value: unknown): string {
  return String(value ?? "").trim();
}

function getNetworkFormValues(values: Partial<NetworkFormValues>): NetworkFormValues {
  return {
    ip: normalizeNetworkValue(values.ip),
    subnetMask: normalizeNetworkValue(values.subnetMask),
    gateway: normalizeNetworkValue(values.gateway),
  };
}

function areNetworkValuesEqual(left: NetworkFormValues, right: NetworkFormValues): boolean {
  return left.ip === right.ip
    && left.subnetMask === right.subnetMask
    && left.gateway === right.gateway;
}

export function NetworkCard({ record }: NetworkCardProps) {
  const [form] = Form.useForm();
  const isRobot = record.type === "robot";
  const savedValuesRef = useRef<NetworkFormValues>(getNetworkFormValues(record));
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const nextValues = getNetworkFormValues(record);
    savedValuesRef.current = nextValues;
    form.setFieldsValue(nextValues);
    setIsDirty(false);
  }, [form, record]);

  const handleValuesChange = (_changedValues: unknown, allValues: Partial<NetworkFormValues>) => {
    setIsDirty(!areNetworkValuesEqual(getNetworkFormValues(allValues), savedValuesRef.current));
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const nextValues = getNetworkFormValues(values);
    const submit = async () => {
      setSaving(true);
      try {
        const res = await editNetwork({ ...record, ...values });
        const body = res.data as ApiResponse<null>;
        if (body.success) {
          savedValuesRef.current = nextValues;
          setIsDirty(false);
          message.success("保存成功");
        } else {
          message.error(body.message || "保存失败");
        }
      } catch (err) {
        console.error("保存失败:", err);
        message.error(getRequestErrorMessage(err, "保存失败"));
      } finally {
        setSaving(false);
      }
    };

    if (nextValues.ip !== savedValuesRef.current.ip) {
      Modal.confirm({
        centered: true,
        title: "确认修改 IP",
        content: "修改 IP 会自动重启系统，确定要继续吗？",
        okText: "确定修改",
        cancelText: "取消",
        onOk: submit,
      });
      return;
    }

    await submit();
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
      <Form form={form} layout="vertical" initialValues={record} onValuesChange={handleValuesChange}>
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
            <Button type="link" loading={saving} disabled={!isDirty || saving} onClick={handleSave}>确定</Button>
          </Form.Item>
        </div>
      </Form>
    </Card>
  );
}
