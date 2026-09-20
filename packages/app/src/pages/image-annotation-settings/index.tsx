import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Empty, Form, Input, Radio, Space, message } from "antd";
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
import "./index.css";

const MASKED_API_KEY_LENGTH = 24;
const API_KEY_PREFIX_LENGTH = 5;
const API_KEY_SUFFIX_LENGTH = 3;

/** 固定长度脱敏，避免从界面推断密钥长度或撑破设置面板。 */
function maskApiKey(key: string): string {
  const normalizedKey = key.trim();
  if (!normalizedKey) return "";
  if (normalizedKey.length <= API_KEY_PREFIX_LENGTH + API_KEY_SUFFIX_LENGTH) {
    return "*".repeat(MASKED_API_KEY_LENGTH);
  }
  const prefix = normalizedKey.slice(0, API_KEY_PREFIX_LENGTH);
  const suffix = normalizedKey.slice(-API_KEY_SUFFIX_LENGTH);
  const maskLength = MASKED_API_KEY_LENGTH - API_KEY_PREFIX_LENGTH - API_KEY_SUFFIX_LENGTH;
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
    <div className="image-annotation-settings">
      <section className="image-annotation-settings__section">
        <h3 className="image-annotation-settings__title">文字识别 API Key</h3>
        <Space direction="vertical" className="image-annotation-settings__stack" size={12}>
          {/* 新增 API Key 输入框 */}
          <Space.Compact className="image-annotation-settings__key-input">
            <Input.Password
              placeholder="请输入新的 API Key"
              value={newApiKey}
              autoComplete="new-password"
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
              className="image-annotation-settings__key-group"
            >
              <div className="image-annotation-settings__key-list">
                {apiKeys.map((key, index) => (
                  <div
                    key={index}
                    className={`image-annotation-settings__key-row${selectedIndex === index ? " image-annotation-settings__key-row--selected" : ""}`}
                  >
                    <Radio value={index} className="image-annotation-settings__key-choice">
                      <code className="image-annotation-settings__key-value">{maskApiKey(key)}</code>
                    </Radio>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label="删除 API Key"
                      title="删除 API Key"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteApiKey(index);
                      }}
                    />
                  </div>
                ))}
              </div>
            </Radio.Group>
          ) : (
            <div className="image-annotation-settings__empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 API Key" />
            </div>
          )}
        </Space>
      </section>

      <section className="image-annotation-settings__section image-annotation-settings__section--service">
        <h3 className="image-annotation-settings__title">缺陷识别服务</h3>
        <Form form={form} layout="vertical" autoComplete="off">
          <Form.Item
            label="IP 地址"
            name="defectDetectionIp"
            rules={[
              { required: false, message: "请输入缺陷识别服务 IP 地址" },
              {
                pattern: /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/,
                message: "请输入有效的 IP 地址格式 (例如: 192.168.1.100:8080)",
              },
            ]}
          >
            <Input placeholder="例如: 192.168.1.100:52002" />
          </Form.Item>

          <Form.Item className="image-annotation-settings__actions">
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveIp} loading={loading}>
              保存 IP 地址
            </Button>
          </Form.Item>
        </Form>
      </section>
    </div>
  );
}
