import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Radio, Space, message } from "antd";
import { useEffect, useState } from "react";
import {
  getOcrApiKeys,
  addOcrApiKey,
  deleteOcrApiKey,
  getSelectedOcrApiKeyIndex,
  setSelectedOcrApiKeyIndex,
  getDefectDetectionIp,
  setDefectDetectionIp,
} from "@/stores/appContextStore";

/** API Key 脱敏显示：只显示前5位和后3位，中间用 * 替代 */
function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key;
  const prefix = key.slice(0, 5);
  const suffix = key.slice(-3);
  const maskLength = Math.max(0, key.length - 8);
  return `${prefix}${"*".repeat(maskLength)}${suffix}`;
}

export default function ImageAnnotationSettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [newApiKey, setNewApiKey] = useState("");

  useEffect(() => {
    // 加载已保存的配置
    const keys = getOcrApiKeys();
    const index = getSelectedOcrApiKeyIndex();
    setApiKeys(keys);
    setSelectedIndex(index);
    form.setFieldsValue({
      defectDetectionIp: getDefectDetectionIp(),
    });
  }, [form]);

  const handleAddApiKey = () => {
    const trimmedKey = newApiKey.trim();
    if (!trimmedKey) {
      message.warning("请输入 API Key");
      return;
    }
    if (apiKeys.includes(trimmedKey)) {
      message.warning("该 API Key 已存在");
      return;
    }
    addOcrApiKey(trimmedKey);
    const updatedKeys = getOcrApiKeys();
    setApiKeys(updatedKeys);
    setNewApiKey("");
    message.success("API Key 已添加");
  };

  const handleDeleteApiKey = (index: number) => {
    deleteOcrApiKey(index);
    const updatedKeys = getOcrApiKeys();
    const updatedIndex = getSelectedOcrApiKeyIndex();
    setApiKeys(updatedKeys);
    setSelectedIndex(updatedIndex);
    message.success("API Key 已删除");
  };

  const handleSelectApiKey = (index: number) => {
    setSelectedOcrApiKeyIndex(index);
    setSelectedIndex(index);
    message.success("已切换 API Key");
  };

  const handleSaveIp = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setDefectDetectionIp(values.defectDetectionIp || "");
      message.success("IP 地址已保存");
    } catch (error) {
      console.error("保存配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ marginBottom: 12, fontWeight: 500 }}>文字识别 API Key</div>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          {/* 新增 API Key 输入框 */}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="请输入新的 API Key"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              onPressEnter={handleAddApiKey}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddApiKey}>
              添加
            </Button>
          </Space.Compact>

          {/* API Key 列表 */}
          {apiKeys.length > 0 ? (
            <Radio.Group
              value={selectedIndex}
              onChange={(e) => handleSelectApiKey(e.target.value)}
              style={{ width: "100%" }}
            >
              <Space direction="vertical" style={{ width: "100%" }}>
                {apiKeys.map((key, index) => (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 12px",
                      border: "1px solid #d9d9d9",
                      borderRadius: 6,
                      background: selectedIndex === index ? "#f0f5ff" : "#fff",
                    }}
                  >
                    <Radio value={index} style={{ flex: 1 }}>
                      <span style={{ fontFamily: "monospace" }}>{maskApiKey(key)}</span>
                    </Radio>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteApiKey(index);
                      }}
                    />
                  </div>
                ))}
              </Space>
            </Radio.Group>
          ) : (
            <div style={{ color: "#999", textAlign: "center", padding: 24 }}>
              暂无 API Key，请先添加
            </div>
          )}
        </Space>
      </div>

      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          label="缺陷识别服务 IP 地址"
          name="defectDetectionIp"
          rules={[
            { required: false, message: "请输入缺陷识别服务 IP 地址" },
            {
              pattern: /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/,
              message: "请输入有效的 IP 地址格式 (例如: 192.168.1.100:8080)",
            },
          ]}
        >
          <Input placeholder="例如: 192.168.1.100:52002" style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item>
          <Button type="primary" onClick={handleSaveIp} loading={loading}>
            保存 IP 地址
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}
