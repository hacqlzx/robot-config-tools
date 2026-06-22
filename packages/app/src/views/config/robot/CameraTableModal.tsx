import { useState } from "react";
import { Modal, Table, Tag, Button } from "antd";
import type { ColumnsType } from "antd/es/table";
import CameraDetailModal from "./CameraDetailModal";

export interface CameraVO {
  cameraId: number;
  cameraName: string;
  videoType: string;
  visibleManufacturerTypeName: string;
  visibleIp: string;
  visiblePort: number | string;
  infraredIp: string;
  infraredPort: number | string;
  visibleRtspAddress: string;
  infraredRtspAddress: string;
  visibleRtmpAddress: string;
  infraredRtmpAddress: string;
  pullFlowMode?: number;
  visibleCameraOnlineState?: number;
  visibleRtspPort?: number | string;
  visibleRtmpPort?: number | string;
  visibleChannel?: string;
  visibleUserName?: string;
  infraredCameraOnlineState?: number;
  infraredManufacturerTypeName?: string;
  infraredRtspPort?: number | string;
  infraredRtmpPort?: number | string;
  infraredChannel?: string;
  infraredUserName?: string;
}

interface Props {
  open: boolean;
  data: CameraVO[];
  onClose: () => void;
}

const PULL_FLOW_MODE_MAP: Record<number, string> = {
  1: "RTSP",
  2: "RTMP",
};

const getVideoTypeTag = (videoType: string) => {
  const map: Record<string, { color: string; label: string }> = {
    "1": { color: "blue", label: "可见光" },
    "2": { color: "orange", label: "红外" },
    "3": { color: "purple", label: "可见光与红外" },
  };
  const item = map[videoType];
  if (!item) return videoType;
  return <Tag color={item.color}>{item.label}</Tag>;
};

export default function CameraTableModal({ open, data, onClose }: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCamera, setDetailCamera] = useState<CameraVO | null>(null);

  const handleView = (record: CameraVO) => {
    setDetailCamera(record);
    setDetailOpen(true);
  };

  const columns: ColumnsType<CameraVO> = [
    { title: "序号", width: 60, align: "center", render: (_: any, __: any, index: number) => index + 1 },
    { title: "相机名称", dataIndex: "cameraName", width: 120 },
    {
      title: "相机类型",
      dataIndex: "videoType",
      width: 140,
      render: getVideoTypeTag,
    },
    { title: "生产厂家", dataIndex: "visibleManufacturerTypeName", width: 120 },
    {
      title: "IP地址",
      width: 140,
      render: (_, record) => {
        const vt = record.videoType;
        if (vt === "1") return record.visibleIp;
        if (vt === "2") return record.infraredIp;
        return `${record.visibleIp} / ${record.infraredIp}`;
      },
    },
    {
      title: "服务端口",
      width: 100,
      render: (_, record) => {
        const vt = record.videoType;
        if (vt === "1") return record.visiblePort;
        if (vt === "2") return record.infraredPort;
        return `${record.visiblePort} / ${record.infraredPort}`;
      },
    },
    {
      title: "拉流方式",
      dataIndex: "pullFlowMode",
      width: 90,
      render: (v: number) => PULL_FLOW_MODE_MAP[v] || v || "-",
    },
    {
      title: "操作",
      width: 80,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => handleView(record)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <>
      <Modal
        title="相机列表"
        open={open}
        width={1200}
        centered
        footer={null}
        getContainer={false}
        onCancel={onClose}
      >
        <Table
          rowKey="cameraId"
          columns={columns}
          dataSource={data}
          pagination={false}
          scroll={{ y: 400 }}
          size="small"
          bordered
        />
      </Modal>
      <CameraDetailModal
        open={detailOpen}
        camera={detailCamera}
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
}
