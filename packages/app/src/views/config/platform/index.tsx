import { useState, useRef, useEffect } from "react";
import { Card, Form, Input, Button, Select, Tag, message } from "antd";
import IpInput from "@/components/ip-input";
import { getRobotInfo, saveRobotInfo, getAnalysisMachineInfo, saveAnalysisMachineInfo, getSuperSystemInfo, saveSuperSystemInfo } from "@/api/config.js";
import { subscribe } from "@/stores/backendStore";

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

const sectionStyle: React.CSSProperties = {
  margin: 0,
  padding: "0 0 12px 0",
  fontSize: 16,
  display: "flex",
  alignItems: "center",
  gap: 10,
  lineHeight: "24px",
};

export default function PlatformConfig() {
  const [backendForm] = Form.useForm();
  const [analysisForm] = Form.useForm();
  const [hostForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [hostLoading, setHostLoading] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState(1);
  const backendDataRef = useRef<Record<string, any>>({});
  const analysisDataRef = useRef<Record<string, any>>({});
  const hostDataRef = useRef<Record<string, any>>({});

  /** 查询后台配置 */
  const fetchBackend = async () => {
    try {
      const res = await getRobotInfo();
      const body = res.data as ApiResponse<Record<string, any>>;
      if (body.success) {
        if (body.data) {
          backendDataRef.current = body.data;
          backendForm.setFieldsValue(body.data);
        }
      } else {
        message.error(body.message || "获取后台配置失败");
      }
    } catch (err) {
      console.error("获取后台配置失败:", err);
      message.error("获取后台配置失败");
    }
  };

  /** 查询分析主机 */
  const fetchAnalysis = async () => {
    try {
      const res = await getAnalysisMachineInfo();
      const body = res.data as ApiResponse<Record<string, any>>;
      if (body.success) {
        if (body.data) {
          analysisDataRef.current = body.data;
          analysisForm.setFieldsValue(body.data);
        }
      } else {
        message.error(body.message || "获取分析主机失败");
      }
    } catch (err) {
      console.error("获取分析主机失败:", err);
      message.error("获取分析主机失败");
    }
  };

  /** 查询上级主机 */
  const fetchHost = async () => {
    try {
      const res = await getSuperSystemInfo();
      const body = res.data as ApiResponse<Record<string, any>>;
      if (body.success) {
        if (body.data) {
          hostDataRef.current = body.data;
          hostForm.setFieldsValue(body.data);
          setOnlineStatus(body.data.onlineStatus);
        }
      } else {
        message.error(body.message || "获取上级主机失败");
      }
    } catch (err) {
      console.error("获取上级主机失败:", err);
      message.error("获取上级主机失败");
    }
  };

  useEffect(() => {
    fetchBackend();
    fetchAnalysis();
    fetchHost();
  }, []);

  // IP 切换时重新加载
  useEffect(() => {
    return subscribe(() => {
      fetchBackend();
      fetchAnalysis();
      fetchHost();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackendSave = async () => {
    const values = await backendForm.validateFields();
    const data = { ...backendDataRef.current, ...values };
    delete data.mqttPd;
    delete data.ftpsPd;
    setLoading(true);
    try {
      const res = await saveRobotInfo(data);
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
        fetchBackend();
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存后台配置失败:", err);
      message.error("保存失败");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalysisSave = async () => {
    const values = await analysisForm.validateFields();
    const data = { ...analysisDataRef.current, ...values };
    setAnalysisLoading(true);
    try {
      const res = await saveAnalysisMachineInfo(data);
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
        fetchAnalysis();
    fetchHost();
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存分析主机失败:", err);
      message.error("保存失败");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleHostSave = async () => {
    const values = await hostForm.validateFields();
    const data = { ...hostDataRef.current, ...values };
    delete data.ftpsPd;
    setHostLoading(true);
    try {
      const res = await saveSuperSystemInfo(data);
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("保存成功");
        fetchHost();
      } else {
        message.error(body.message || "保存失败");
      }
    } catch (err) {
      console.error("保存上级主机失败:", err);
      message.error("保存失败");
    } finally {
      setHostLoading(false);
    }
  };

  return (
    <div>
      <h3 style={sectionStyle}>
        <span style={{ display: "inline-block", width: 3, height: 18, background: "#546BF7", borderRadius: 2 }} />
        后台
      </h3>
      <Form form={backendForm} layout="vertical">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card
            size="small"
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#546BF7" }} />
                基础信息
              </span>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Form.Item label="设备名称" name="deviceName" rules={[{ required: true, message: "请输入设备名称" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="设备编码" name="deviceCode" rules={[{ required: true, message: "请输入设备编码" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
            </div>
          </Card>
          <Card
            size="small"
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#546BF7" }} />
                通讯信息
              </span>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Form.Item label="局域网IP" name="lanIp" rules={[{ required: true, message: "请输入局域网IP" }]}>
                <IpInput />
              </Form.Item>
              <Form.Item label="内网IP" name="intranetIp" rules={[{ required: true, message: "请输入内网IP" }]}>
                <IpInput />
              </Form.Item>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: "8px 0 12px", paddingLeft: 2 }}>
              MQTT配置
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Form.Item label="MQTT IP" name="mqttIp" rules={[{ required: true, message: "请选择MQTT IP" }]}>
                <Select
                  placeholder="请选择"
                  options={[
                    { value: 0, label: "局域网IP" },
                    { value: 1, label: "内网IP" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="MQTT端口" name="mqttPort" rules={[{ required: true, message: "请输入MQTT端口" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="MQTT用户名" name="mqttUm" rules={[{ required: true, message: "请输入MQTT用户名" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="MQTT口令" name="mqttPd" rules={[{ required: true, message: "请输入MQTT口令" }]}>
                <Input.Password placeholder="请输入" />
              </Form.Item>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: "8px 0 12px", paddingLeft: 2 }}>
              FTPS配置
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Form.Item label="FTPS IP" name="ftpsIp" rules={[{ required: true, message: "请选择FTPS IP" }]}>
                <Select
                  placeholder="请选择"
                  options={[
                    { value: 0, label: "局域网IP" },
                    { value: 1, label: "内网IP" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="FTPS端口" name="ftpsPort" rules={[{ required: true, message: "请输入FTPS端口" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="FTPS用户名" name="ftpsUm" rules={[{ required: true, message: "请输入FTPS用户名" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="FTPS口令" name="ftpsPd" rules={[{ required: true, message: "请输入FTPS口令" }]}>
                <Input.Password placeholder="请输入" />
              </Form.Item>
              <Form.Item label="对上ftps主动端口" name="ftpActivePort" rules={[{ required: true, message: "请输入对上ftps主动端口" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: "8px 0 12px", paddingLeft: 2 }}>
              其他服务
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
              <Form.Item label="GRPC服务端口" name="robotServerPort" rules={[{ required: true, message: "请输入GRPC服务端口" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="分析主机反馈端口" name="analysisHostFeedbackPort" rules={[{ required: true, message: "请输入分析主机反馈端口" }]}>
                <Input placeholder="请输入" />
              </Form.Item>
              <Form.Item label="分析主机服务IP" name="analysisHostIp" rules={[{ required: true, message: "请选择分析主机服务IP" }]}>
                <Select
                  placeholder="请选择"
                  options={[
                    { value: 0, label: "局域网IP" },
                    { value: 1, label: "内网IP" },
                  ]}
                />
              </Form.Item>
            </div>
          </Card>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="primary" loading={loading} onClick={handleBackendSave}>
              保存
            </Button>
          </div>
        </div>
      </Form>

      <h3 style={{ ...sectionStyle, marginTop: 24 }}>
        <span style={{ display: "inline-block", width: 3, height: 18, background: "#546BF7", borderRadius: 2 }} />
        分析服务
      </h3>
      <Card
        size="small"
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#546BF7" }} />
            智能分析服务
          </span>
        }
      >
        <Form form={analysisForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <Form.Item label="智能分析服务IP" name="analysisMachineIp" rules={[{ required: true, message: "请输入智能分析服务IP" }]}>
              <IpInput />
            </Form.Item>
            <Form.Item label="智能分析服务端口" name="httpAnalysisServerPort" rules={[{ required: true, message: "请输入智能分析服务端口" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="GRPC服务端口" name="grpcServerPort" rules={[{ required: true, message: "请输入GRPC服务端口" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="GRPC附加功能服务端口" name="grpcAppendServerPort" rules={[{ required: true, message: "请输入GRPC附加功能服务端口" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
          </div>
        </Form>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <Button type="primary" loading={analysisLoading} onClick={handleAnalysisSave}>
          保存
        </Button>
      </div>

      <h3 style={{ ...sectionStyle, marginTop: 24 }}>
        <span style={{ display: "inline-block", width: 3, height: 18, background: "#546BF7", borderRadius: 2 }} />
        上级主机
      </h3>
      <Card
        size="small"
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#546BF7" }} />
            上级主机
            <Tag color={onlineStatus === 1 ? "green" : "red"} style={{ marginLeft: 8 }}>{onlineStatus === 1 ? "在线" : "离线"}</Tag>
          </span>
        }
      >
        <Form form={hostForm} layout="vertical">
          <div style={{ fontSize: 13, fontWeight: 500, color: "#333", marginBottom: 12 }}>
            基础信息
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <Form.Item label="上级主机名称" name="deviceName" rules={[{ required: true, message: "请输入上级主机名称" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="上级主机编码" name="deviceCode" rules={[{ required: true, message: "请输入上级主机编码" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: "8px 0 12px" }}>
            通讯信息
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <Form.Item label="内网IP" name="serverIp" rules={[{ required: true, message: "请输入内网IP" }]}>
              <IpInput />
            </Form.Item>
            <Form.Item label="服务端口" name="serverPort" rules={[{ required: true, message: "请输入服务端口" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="FTPS IP" name="ftpsIp" rules={[{ required: true, message: "请输入FTPS IP" }]}>
              <IpInput />
            </Form.Item>
            <Form.Item label="FTPS端口" name="ftpsPort" rules={[{ required: true, message: "请输入FTPS端口" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="FTPS用户名" name="ftpsUm" rules={[{ required: true, message: "请输入FTPS用户名" }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item label="FTPS口令" name="ftpsPd" rules={[{ required: true, message: "请输入FTPS口令" }]}>
              <Input.Password placeholder="请输入" />
            </Form.Item>
            <Form.Item label="FTPS连接模式" name="ftpsConnectedMode" rules={[{ required: true, message: "请选择FTPS连接模式" }]}>
              <Select
                placeholder="请选择"
                options={[
                  { value: 1, label: "主动模式" },
                  { value: 2, label: "被动模式" },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <Button type="primary" loading={hostLoading} onClick={handleHostSave}>
          保存
        </Button>
      </div>
    </div>
  );
}


