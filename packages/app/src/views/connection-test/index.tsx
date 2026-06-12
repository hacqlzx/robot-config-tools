import { useState, useRef } from 'react';
import { Card, Input, Button, Select, Space, Divider, message, Tag } from 'antd';
import http from '@/services/http';
import mqtt from 'mqtt';

export default function ConnectionTest() {
  const [httpUrl, setHttpUrl] = useState('');
  const [httpMethod, setHttpMethod] = useState('GET');
  const [httpStatus, setHttpStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [httpResult, setHttpResult] = useState('');

  const [mqttUrl, setMqttUrl] = useState('ws://192.168.0.79:8083/mqtt');
  const [mqttUser, setMqttUser] = useState('patrol_tmq');
  const [mqttPass, setMqttPass] = useState('tq_chiebot1003');
  const [mqttTopic, setMqttTopic] = useState('123qqq');
  const [mqttStatus, setMqttStatus] = useState<'idle' | 'connected' | 'loading' | 'error'>('idle');
  const [mqttMsg, setMqttMsg] = useState<string[]>([]);
  const [sendMsg, setSendMsg] = useState('');
  const clientRef = useRef<any>(null);

  const testHttp = async () => {
    if (!httpUrl) {
      message.warning('请输入接口地址');
      return;
    }
    setHttpStatus('loading');
    const startTime = Date.now();
    try {
      const res = await http.request({ method: httpMethod, url: httpUrl, timeout: 10000 });
      const elapsed = Date.now() - startTime;
      setHttpStatus('success');
      setHttpResult(
        `状态码: ${res.status} ${res.statusText}\n耗时: ${elapsed}ms\n\n` +
        JSON.stringify(res.data, null, 2),
      );
    } catch (e: any) {
      const elapsed = Date.now() - startTime;
      setHttpStatus('error');
      if (e.response) {
        setHttpResult(
          `状态码: ${e.response.status}\n耗时: ${elapsed}ms\n\n` +
          JSON.stringify(e.response.data, null, 2),
        );
      } else {
        setHttpResult(`请求失败\n耗时: ${elapsed}ms\n\n${e.message}`);
      }
    }
  };

  const connectMqtt = () => {
    if (!mqttUrl) {
      message.warning('请输入 MQTT 地址');
      return;
    }
    setMqttStatus('loading');
    setMqttMsg([]);
    const client = mqtt.connect(mqttUrl, {
      connectTimeout: 10000,
      username: mqttUser || undefined,
      password: mqttPass || undefined,
    });

    client.on('connect', () => {
      setMqttStatus('connected');
      addMsg('MQTT 连接成功');
      client.subscribe(mqttTopic, (err: any) => {
        if (err) {
          addMsg(`订阅失败: ${err.message}`);
        } else {
          addMsg(`已订阅: ${mqttTopic}`);
        }
      });
    });

    client.on('message', (topic: string, payload: Buffer) => {
      const text = payload.toString();
      addMsg(`[${topic}] ${text}`);
    });

    client.on('error', (err: Error) => {
      addMsg(`[错误] ${err.message}`);
    });

    client.on('close', () => {
      setMqttStatus('idle');
      addMsg('[已断开]');
      clientRef.current = null;
    });

    clientRef.current = client;
  };

  const addMsg = (msg: string) => {
    setMqttMsg((prev) => [...prev, msg]);
  };

  const disconnectMqtt = () => {
    if (clientRef.current) {
      clientRef.current.end();
    }
  };

  const publishMqtt = () => {
    if (!clientRef.current || !sendMsg) return;
    clientRef.current.publish(mqttTopic, sendMsg, (err: any) => {
      if (err) {
        addMsg(`发送失败: ${err.message}`);
      } else {
        addMsg(`已发送: ${sendMsg}`);
      }
    });
    setSendMsg('');
  };

  const statusTag = (status: string) => {
    const map: Record<string, { color: string; text: string }> = {
      idle: { color: 'default', text: '未连接' },
      loading: { color: 'processing', text: '连接中' },
      connected: { color: 'success', text: '已连接' },
      success: { color: 'success', text: '请求成功' },
      error: { color: 'error', text: '失败' },
    };
    const { color, text } = map[status] || map.idle;
    return <Tag color={color}>{text}</Tag>;
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="HTTP 接口测试" extra={statusTag(httpStatus)}>
        <Space style={{ width: '100%', flexWrap: 'wrap' }}>
          <Select
            value={httpMethod}
            onChange={setHttpMethod}
            style={{ width: 100 }}
            options={[
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
              { value: 'PUT', label: 'PUT' },
              { value: 'DELETE', label: 'DELETE' },
            ]}
          />
          <Input
            placeholder="/robot/tool/test?id=111"
            value={httpUrl}
            onChange={(e) => setHttpUrl(e.target.value)}
            style={{ width: 380 }}
          />
          <Button type="primary" onClick={testHttp} loading={httpStatus === 'loading'}>
            发送请求
          </Button>
        </Space>
        {httpResult && (
          <pre style={{ marginTop: 16, padding: 12, background: '#f0f0f0', borderRadius: 4, overflow: 'auto', maxHeight: 400 }}>
            {httpResult}
          </pre>
        )}
      </Card>

      <Divider />

      <Card title="MQTT 测试" extra={statusTag(mqttStatus)}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Input
              placeholder="ws://host:port/mqtt"
              value={mqttUrl}
              onChange={(e) => setMqttUrl(e.target.value)}
              style={{ width: 240 }}
            />
            <Input
              placeholder="用户名"
              value={mqttUser}
              onChange={(e) => setMqttUser(e.target.value)}
              style={{ width: 120 }}
            />
            <Input.Password
              placeholder="密码"
              value={mqttPass}
              onChange={(e) => setMqttPass(e.target.value)}
              style={{ width: 120 }}
            />
          </Space>
          <Space wrap>
            <Input
              placeholder="主题"
              value={mqttTopic}
              onChange={(e) => setMqttTopic(e.target.value)}
              style={{ width: 180 }}
            />
            <Button type="primary" onClick={connectMqtt} loading={mqttStatus === 'loading'}>
              连接
            </Button>
            {mqttStatus === 'connected' && (
              <Button danger onClick={disconnectMqtt}>断开</Button>
            )}
          </Space>
          {mqttStatus === 'connected' && (
            <Space>
              <Input
                placeholder="发送消息内容"
                value={sendMsg}
                onChange={(e) => setSendMsg(e.target.value)}
                style={{ width: 280 }}
              />
              <Button onClick={publishMqtt}>发送</Button>
            </Space>
          )}
          {mqttMsg.length > 0 && (
            <pre style={{ padding: 12, background: '#f0f0f0', borderRadius: 4, maxHeight: 350, overflow: 'auto' }}>
              {mqttMsg.join('\n')}
            </pre>
          )}
        </Space>
      </Card>
    </Space>
  );
}
