import { useState, useEffect, useCallback } from "react";
import { Form, Button, App, Tag, Tooltip } from "antd";
import { CheckCircleFilled, CloseCircleFilled, DeleteOutlined, LinkOutlined, MinusCircleOutlined } from "@ant-design/icons";
import {
  setBackendConnection,
  setConnectionStatus,
  useAppContext,
} from "@/stores/appContextStore";
import IpInput from "@/components/ip-input";

/** localStorage 中保存 IP 列表的 key */
const STORAGE_KEY = "backend_ip_list";
const CURRENT_CONNECTION_POLL_MS = 5_000;

/** IPv4 格式正则，用于前端输入校验 */
const ipRegex = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

interface IpRecord {
  ip: string;
}

type IpHealthStatus = "connected" | "failed" | "disconnected";

interface IpHealth {
  status: IpHealthStatus;
  latencyMs?: number;
}

interface PingResult {
  ok: boolean;
  latencyMs?: number;
}

/** 从 localStorage 读取已保存的 IP 列表 */
function loadIpList(): IpRecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

/** 将 IP 列表持久化到 localStorage */
function saveIpList(list: IpRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

async function probeIp(ip: string): Promise<PingResult> {
  const startedAt = performance.now();
  try {
    const ok = __ELECTRON__ && window.electronAPI?.ping
      ? await window.electronAPI.ping(ip)
      : false;
    return { ok, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { ok: false };
  }
}

function ConnectionStatusTag({ status, latencyMs }: IpHealth): React.ReactElement {
  if (status === "connected") {
    return (
      <Tooltip title={latencyMs === undefined ? "正在检测延迟" : `当前延迟：${latencyMs} ms`}>
        <Tag color="success" icon={<CheckCircleFilled />} style={{ cursor: "help", marginInlineEnd: 0 }}>
          已连接
        </Tag>
      </Tooltip>
    );
  }

  if (status === "failed") {
    return <Tag color="error" icon={<CloseCircleFilled />} style={{ marginInlineEnd: 0 }}>连接失败</Tag>;
  }

  return <Tag icon={<MinusCircleOutlined />} style={{ marginInlineEnd: 0 }}>未连接</Tag>;
}

interface Props {
  /** 连接成功后的回调，通常用于关闭设置弹窗 */
  onConnected: () => void;
}

/**
 * 后台连接设置面板。
 *
 * 功能：
 * - 输入新 IP 并连接，连接成功后自动去重追加到列表。
 * - 已保存的 IP 列表支持一键连接和删除。
 * - 连接失败时弹出确认框，提供"重新连接"和"取消（恢复旧连接）"两个操作。
 */
export default function BackendSettingsPanel({ onConnected }: Props) {
  const { backendIp, connectionStatus } = useAppContext();
  // 使用 App.useApp() 获取 message/modal 实例，确保能读取 ConfigProvider 上下文（如 centered）
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [ipList, setIpList] = useState<IpRecord[]>(loadIpList);
  const [currentHealth, setCurrentHealth] = useState<IpHealth>({ status: connectionStatus });
  const [connecting, setConnecting] = useState(false);
  // 记录当前正在连接的列表项索引，用于显示对应行的 loading 状态
  const [connectingIndex, setConnectingIndex] = useState<number | null>(null);

  // IP 列表变化时同步持久化
  useEffect(() => { saveIpList(ipList); }, [ipList]);

  // 当前已连接的 IP 变化时，将表单初始值同步为最新 IP
  useEffect(() => {
    form.resetFields();
    if (backendIp) {
      form.setFieldsValue({ ip: backendIp });
    }
  }, [backendIp, form]);

  /**
   * 纯探测函数：调用主进程 TCP ping，不修改全局连接状态。
   * 连接成功/失败的状态更新由调用方负责，便于重试逻辑复用。
   */
  const pingIp = async (ip: string): Promise<PingResult> => {
    if (!ipRegex.test(ip)) { message.error("请输入正确的 IP 地址"); return { ok: false }; }
    return probeIp(ip);
  };

  useEffect(() => {
    let disposed = false;
    let probing = false;

    if (!backendIp) {
      setCurrentHealth({ status: "disconnected" });
      return undefined;
    }

    setCurrentHealth({ status: connectionStatus });
    const checkCurrentConnection = async () => {
      if (probing) return;
      probing = true;
      const result = await probeIp(backendIp);
      probing = false;
      if (disposed) return;
      const status: IpHealthStatus = result.ok ? "connected" : "failed";
      setCurrentHealth({ status, ...(result.ok ? { latencyMs: result.latencyMs } : {}) });
      setConnectionStatus(status);
    };

    void checkCurrentConnection();
    const timer = window.setInterval(() => {
      void checkCurrentConnection();
    }, CURRENT_CONNECTION_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [backendIp]);

  /**
   * 连接成功后的统一处理：
   * - 可选将 IP 去重追加到列表（addToList=true 用于新增表单）。
   * - 更新全局连接状态为 connected。
   * - 触发成功提示和 onConnected 回调。
   */
  const handleSuccess = useCallback((ip: string, addToList?: boolean, latencyMs?: number) => {
    if (addToList && !ipList.some((r) => r.ip === ip)) {
      setIpList((prev) => prev.some((r) => r.ip === ip) ? prev : [...prev, { ip }]);
    }
    setCurrentHealth({ status: "connected", latencyMs });
    setBackendConnection(ip, "connected");
    message.success(`${ip} 连接成功`);
    onConnected();
  }, [ipList, message, onConnected]);

  /**
   * 连接失败时弹出确认弹窗。
   * - 点"重新连接"：执行 onRetry 回调（调用方提供具体重试逻辑）。
   * - 点"取消"：若存在上一次成功的 prevIp，则恢复该连接；否则置为断开状态。
   */
  const showFailModal = useCallback((ip: string, prevIp: string, onRetry: () => Promise<void>) => {
    modal.confirm({
      title: "连接失败",
      content: "后台连接失败",
      okText: "重新连接",
      cancelText: "取消",
      onOk: onRetry,
      onCancel: () => {
        if (prevIp) {
          // 恢复上次成功的连接
          setBackendConnection(prevIp, "connected");
        } else {
          setConnectionStatus("disconnected");
        }
      },
    });
  }, [modal]);

  /**
   * 新增表单提交：连接新 IP。
   * 失败时弹出确认框，重试失败后恢复旧连接。
   */
  const handleAdd = async (values: { ip: string }) => {
    const prevIp = backendIp; // 记录连接前的旧 IP，供失败回滚使用
    setConnecting(true);
    const result = await pingIp(values.ip);
    setConnecting(false);

    if (result.ok) {
      handleSuccess(values.ip, true, result.latencyMs);
      form.resetFields();
      return;
    }

    setConnectionStatus("failed");
    showFailModal(values.ip, prevIp, async () => {
      const retryResult = await pingIp(values.ip);
      if (retryResult.ok) {
        handleSuccess(values.ip, true, retryResult.latencyMs);
        form.resetFields();
      } else {
        // 重试仍失败，恢复旧连接状态
        if (prevIp) setBackendConnection(prevIp, "connected");
        else setConnectionStatus("disconnected");
        message.error(`${values.ip} 仍然无法连接`);
      }
    });
  };

  /**
   * 点击列表中某条 IP 的连接按钮。
   * 逻辑与 handleAdd 相同，但不需要追加到列表（IP 已存在）。
   */
  const handleListConnect = async (index: number) => {
    const ip = ipList[index].ip;
    const prevIp = backendIp;
    setConnectingIndex(index);
    const result = await pingIp(ip);
    setConnectingIndex(null);

    if (result.ok) {
      handleSuccess(ip, false, result.latencyMs);
      return;
    }

    setConnectionStatus("failed");
    showFailModal(ip, prevIp, async () => {
      const retryResult = await pingIp(ip);
      if (retryResult.ok) {
        handleSuccess(ip, false, retryResult.latencyMs);
      } else {
        if (prevIp) setBackendConnection(prevIp, "connected");
        else setConnectionStatus("disconnected");
        message.error(`${ip} 仍然无法连接`);
      }
    });
  };

  /**
   * 删除列表中的 IP，弹出 Modal.confirm 二次确认，防止误操作。
   */
  const deleteIp = (index: number) => {
    const ip = ipList[index].ip;
    modal.confirm({
      title: "删除 IP 地址",
      content: `确定删除 ${ip}？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => setIpList(ipList.filter((_, i) => i !== index)),
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16, padding: "12px 14px", border: "1px solid #d9d9d9", borderRadius: 6, background: "#fafafa" }}>
        <div style={{ marginBottom: 8, color: "#262626", fontSize: 16, fontWeight: 500 }}>当前连接</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <strong>{backendIp || "暂无后台 IP"}</strong>
          <ConnectionStatusTag {...currentHealth} />
        </div>
      </div>
      <div style={{ marginBottom: 16, color: "#262626", fontSize: 16, fontWeight: 500 }}>添加IP</div>
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
      <div style={{ marginTop: 28 }}>
        <div style={{ marginBottom: 8, color: "#262626", fontSize: 16, fontWeight: 500 }}>IP地址列表</div>
        {ipList.length > 0 ? (
          <div>
          {ipList.map((item, index) => (
            <div key={index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <IpInput value={item.ip} onChange={(val) => { if (val) { const u = [...ipList]; u[index] = { ip: val }; setIpList(u); } }} />
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <Button type="link" size="small" aria-label={`连接 ${item.ip}`} icon={<LinkOutlined />} loading={connectingIndex === index} onClick={() => handleListConnect(index)} />
                <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => deleteIp(index)} />
              </div>
            </div>
          ))}
          </div>
        ) : (
          <div style={{ padding: "20px 0", color: "#bfbfbf", textAlign: "center" }}>暂无已保存的 IP 地址</div>
        )}
      </div>
    </div>
  );
}
