import { Modal, Descriptions, Tag } from "antd";
import type { CameraVO } from "./CameraTableModal";

interface Props {
  open: boolean;
  camera: CameraVO | null;
  onClose: () => void;
}

const VIDEO_TYPE_MAP: Record<string, string> = {
  "1": "可见光",
  "2": "红外",
  "3": "可见光与红外",
};

const PULL_FLOW_MODE_MAP: Record<number, string> = {
  1: "RTSP",
  2: "RTMP",
};

const getIpDisplay = (camera: CameraVO) => {
  if (camera.videoType === "2") return camera.infraredIp || "-";
  return camera.visibleIp || "-";
};

const getPortDisplay = (camera: CameraVO) => {
  if (camera.videoType === "2") return camera.infraredPort || "-";
  return camera.visiblePort || "-";
};

export default function CameraDetailModal({ open, camera, onClose }: Props) {
  if (!camera) return null;

  return (
    <Modal
      title="相机详情"
      open={open}
      width={560}
      centered
      footer={null}
      getContainer={false}
      onCancel={onClose}
      destroyOnClose
    >
      <Descriptions column={1} size="small" bordered labelStyle={{ width: 100 }}>
        <Descriptions.Item label="相机ID">{camera.cameraId}</Descriptions.Item>
        <Descriptions.Item label="相机名称">{camera.cameraName}</Descriptions.Item>
        <Descriptions.Item label="相机类型">
          <Tag color="blue">{VIDEO_TYPE_MAP[camera.videoType] || camera.videoType}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="生产厂家">{camera.visibleManufacturerTypeName || "-"}</Descriptions.Item>
        <Descriptions.Item label="IP 地址">{getIpDisplay(camera)}</Descriptions.Item>
        <Descriptions.Item label="服务端口">{getPortDisplay(camera)}</Descriptions.Item>
        <Descriptions.Item label="拉流方式">
          {camera.pullFlowMode ? PULL_FLOW_MODE_MAP[camera.pullFlowMode] || camera.pullFlowMode : "-"}
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  );
}
