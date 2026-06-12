import { useState } from "react";
import { Button, Table, Modal, Tag, Popconfirm, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import RobotFormModal from "./RobotFormModal";

export interface CameraVO {
  cameraId: number;
  cameraName: string;
  videoType: string;
  visibleManufacturerTypeName: string;
  visibleIp: string;
  visiblePort: number;
  infraredIp: string;
  infraredPort: number;
  visibleRtspAddress: string;
  infraredRtspAddress: string;
  visibleRtmpAddress: string;
  infraredRtmpAddress: string;
  pullFlowMode?: number;
}

export interface RobotRecord {
  id: number;
  robotName: string;
  robotCode: string;
  ip: string;
  port: number;
  operationFacName: string;
  currentMapName: string;
  robotTypeName: string;
  onlineState: string;
  cameraVOS?: CameraVO[];
  mqttIp?: string;
  mqttPort?: number;
  ftpsIp?: string;
  ftpsPort?: number;
}

const PULL_FLOW_MODE_MAP: Record<number, string> = {
  1: "RTSP",
  2: "RTMP",
};

const getVideoTypeTag = (videoType: string) => {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    "1": { color: "#1677ff", bg: "#e6f4ff", label: "可见光" },
    "2": { color: "#fa8c16", bg: "#fff7e6", label: "红外" },
    "3": { color: "#722ed1", bg: "#f9f0ff", label: "可见光与红外" },
  };
  const item = map[videoType];
  if (!item) return videoType;
  return <Tag color={item.label === "可见光" ? "blue" : item.label === "红外" ? "orange" : "purple"}>{item.label}</Tag>;
};

const getStatusPill = (state: string) => {
  const online = state === "online";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 10,
        backgroundColor: online ? "#d9f7be" : "#ffccc7",
        color: online ? "#389e0d" : "#cf1322",
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: online ? "#389e0d" : "#cf1322",
        }}
      />
      {online ? "在线" : "离线"}
    </span>
  );
};

export default function RobotConfig() {
  const [data] = useState<RobotRecord[]>([mockRobot]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<{ id: number; robotName: string; robotCode: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraData, setCameraData] = useState<CameraVO[]>([]);

  const facOptions = data.map((item) => ({
    value: String(item.id),
    label: item.operationFacName,
  }));

  const handleEdit = (record: RobotRecord) => {
    setEditRecord({ id: record.id, robotName: record.robotName, robotCode: record.robotCode });
    setModalOpen(true);
  };

  const handleAdd = () => {
    setEditRecord(null);
    setModalOpen(true);
  };

  const handleSubmit = (values: any) => {
    message.success(editRecord ? "编辑成功" : "新增成功");
    setModalOpen(false);
  };

  const handleCamera = (record: RobotRecord) => {
    setCameraData(record.cameraVOS || []);
    setCameraOpen(true);
  };

  const robotColumns: ColumnsType<RobotRecord> = [
    { title: "序号", dataIndex: "id", width: 60, align: "center" },
    { title: "厂站", dataIndex: "operationFacName", width: 120 },
    { title: "机器人名称", dataIndex: "robotName", width: 160 },
    { title: "机器人编码", dataIndex: "robotCode", width: 160 },
    { title: "IP", dataIndex: "ip", width: 140 },
    { title: "端口", dataIndex: "port", width: 80 },
    { title: "机器人类型", dataIndex: "robotTypeName", width: 180 },
    { title: "运行地图", dataIndex: "currentMapName", width: 150 },
    {
      title: "状态",
      dataIndex: "onlineState",
      width: 90,
      render: getStatusPill,
    },
    {
      title: "操作",
      width: 240,
      render: (_, record) => (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>
            修改
          </Button>
          <Button type="link" size="small" onClick={() => handleCamera(record)}>
            相机
          </Button>
          <Popconfirm title="确定删除？" okText="确定" cancelText="取消">
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const cameraColumns: ColumnsType<CameraVO> = [
    { title: "序号", dataIndex: "cameraId", width: 60, align: "center" },
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
      render: () => (
        <Button type="link" size="small">
          查看
        </Button>
      ),
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />}>刷新</Button>
        <Button icon={<PlusOutlined />} type="primary" onClick={handleAdd}>
          新增
        </Button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Table
          rowKey="id"
          columns={robotColumns}
          dataSource={data}
          pagination={false}
          size="small"
          bordered
        />
      </div>
      <RobotFormModal
        open={modalOpen}
        record={editRecord}
        facOptions={facOptions}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
      <Modal
        title="相机列表"
        open={cameraOpen}
        width={1200}
        centered
        footer={null}
        onCancel={() => setCameraOpen(false)}
      >
        <Table
          rowKey="cameraId"
          columns={cameraColumns}
          dataSource={cameraData}
          pagination={false}
          scroll={{ y: 400 }}
          size="small"
          bordered
        />
      </Modal>
    </div>
  );
}

const mockRobot: RobotRecord = {
  id: 1,
  robotName: "巡检机器人1号",
  robotCode: "RB20250301",
  ip: "192.168.1.100",
  port: 8080,
  operationFacName: "测试场站",
  currentMapName: "一层地图",
  robotTypeName: "轮式巡检机器人",
  onlineState: "online",
  cameraVOS: [
    {
      cameraId: 1,
      cameraName: "前视相机",
      videoType: "1",
      visibleManufacturerTypeName: "海康威视",
      visibleIp: "192.168.1.101",
      visiblePort: 554,
      infraredIp: "",
      infraredPort: 0,
      visibleRtspAddress: "rtsp://192.168.1.101/stream1",
      infraredRtspAddress: "",
      visibleRtmpAddress: "",
      infraredRtmpAddress: "",
      pullFlowMode: 1,
    },
    {
      cameraId: 2,
      cameraName: "红外热成像",
      videoType: "2",
      visibleManufacturerTypeName: "大华",
      visibleIp: "",
      visiblePort: 0,
      infraredIp: "192.168.1.102",
      infraredPort: 554,
      visibleRtspAddress: "",
      infraredRtspAddress: "rtsp://192.168.1.102/thermal",
      visibleRtmpAddress: "",
      infraredRtmpAddress: "",
      pullFlowMode: 2,
    },
  ],
};
