import { useRef, useState } from "react";
import { Button, Space, App } from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  SyncOutlined,
  PushpinOutlined,
  CloudSyncOutlined,
} from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
import DeviceTree from "@/components/DeviceTree";
import "./index.scss";

export default function DeviceVerify() {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);

  const { width: leftWidth, onMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.3,
    minWidth: 200,
    maxPercent: 0.5,
  });

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  return (
    <div className="device-verify-page">
      <div className="device-verify-toolbar">
        <Space size={4} wrap>
          <Button icon={<UploadOutlined />} onClick={() => placeholder("验证图加载")}>验证图加载</Button>
          <Button icon={<DownloadOutlined />} onClick={() => placeholder("验证图导出")}>验证图导出</Button>
          <Button icon={<SyncOutlined />} onClick={() => placeholder("导出纠偏数据")}>导出纠偏数据</Button>
          <Button icon={<PushpinOutlined />} onClick={() => placeholder("导出标记点位")}>导出标记点位</Button>
          <Button icon={<CloudSyncOutlined />} onClick={() => placeholder("同步分析主机")}>同步分析主机</Button>
        </Space>
      </div>

      <div className="device-verify-body" ref={containerRef}>
        <div className="device-verify-left" style={{ width: leftWidth }}>
          <div className="device-verify-left-title">
            <span className="device-verify-title-text">点位树</span>
          </div>
          <div className="device-verify-tree">
            <DeviceTree defaultExpandLevel={3} />
          </div>
        </div>

        <div className="device-verify-resizer" onMouseDown={onMouseDown} />

        <div className="device-verify-right">
          <div className="device-verify-img-placeholder">图片展示区域</div>
        </div>
      </div>
    </div>
  );
}
