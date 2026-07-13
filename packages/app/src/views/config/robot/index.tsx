import { useState, useRef, useEffect } from "react";
import { Button, Table, Modal, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import RobotFormModal from "./RobotFormModal";
import CameraTableModal, { type CameraVO } from "./CameraTableModal";
import { getAllRobot, addRobot, updateRobot, deleteRobot, getFacInfo } from "@/api/config.js";
import { subscribeBackendContext } from "@/stores/appContextStore";

export interface RobotRecord {
  id: number;
  robotName: string;
  robotCode: string;
  ip: string;
  port: number;
  operationFacName: string;
  currentMapName: string;
  robotTypeName: string;
  onlineState: number;
  cameraVOS?: CameraVO[];
  mqttIp?: string;
  mqttPort?: number;
  ftpsIp?: string;
  ftpsPort?: number;
}

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

const getStatusPill = (state: number) => {
  const online = state === 1;
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
  const [data, setData] = useState<RobotRecord[]>([]);
  const [facOptions, setFacOptions] = useState<{ value: number; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<{ id: number; robotName: string; robotCode: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraData, setCameraData] = useState<CameraVO[]>([]);
  const fetchedRef = useRef(false);

  /** 查询机器人列表 */
  const fetchRobots = async () => {
    setLoading(true);
    try {
      const res = await getAllRobot();
      const body = res.data as ApiResponse<RobotRecord[]>;
      if (body.success) {
        if (body.data) {
          setData(body.data);
        }
      } else {
        message.error(body.message || "获取机器人列表失败");
      }
    } catch {
      message.error("获取机器人列表失败");
    } finally {
      setLoading(false);
    }
  };

  /** 查询厂站列表（供新增时选择） */
  const fetchFacOptions = async () => {
    try {
      const res = await getFacInfo();
      const body = res.data as ApiResponse<{ id: number; stationName: string }[]>;
      if (body.success) {
        if (body.data) {
          setFacOptions(
            body.data.map((item) => ({ value: item.id, label: item.stationName })),
          );
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchRobots();
      fetchFacOptions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IP 切换时重新加载
  useEffect(() => {
    return subscribeBackendContext(() => {
      fetchRobots();
      fetchFacOptions();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 编辑 */
  const handleEdit = (record: RobotRecord) => {
    setEditRecord({ id: record.id, robotName: record.robotName, robotCode: record.robotCode });
    setModalOpen(true);
  };

  /** 删除 */
  const handleDelete = (record: RobotRecord) => {
    Modal.confirm({
      centered: true,
      title: "确认删除",
      content: `确定要删除机器人「${record.robotName}」吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteRobot(record.id);
          const body = res.data as ApiResponse<null>;
          if (body.success) {
            message.success("删除成功");
            fetchRobots();
          } else {
            message.error(body.message || "删除失败");
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  /** 新增 */
  const handleAdd = () => {
    setEditRecord(null);
    setModalOpen(true);
  };

  /** 新增 / 编辑 提交 */
  const handleSubmit = async (values: any) => {
    setSubmitting(true);
    try {
      let res;
      if (editRecord) {
        res = await updateRobot({ id: editRecord.id, ...values });
      } else {
        res = await addRobot(values);
      }
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success(editRecord ? "编辑成功" : "新增成功");
        setModalOpen(false);
        fetchRobots();
      } else {
        message.error(body.message || (editRecord ? "编辑失败" : "新增失败"));
      }
    } catch {
      message.error(editRecord ? "编辑失败" : "新增失败");
    } finally {
      setSubmitting(false);
    }
  };

  /** 相机 */
  const handleCamera = (record: RobotRecord) => {
    setCameraData(record.cameraVOS || []);
    setCameraOpen(true);
  };

  const columns: ColumnsType<RobotRecord> = [
    { title: "序号", width: 60, align: "center", render: (_: any, __: any, index: number) => index + 1 },
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
          <Button type="link" size="small" danger onClick={() => handleDelete(record)}>
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "flex-end" }}>
        <Button icon={<ReloadOutlined />} onClick={fetchRobots} loading={loading}>
          刷新
        </Button>
        <Button icon={<PlusOutlined />} type="primary" onClick={handleAdd}>
          新增
        </Button>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          pagination={false}
          size="small"
          bordered
          loading={loading}
        />
      </div>
      <RobotFormModal
        open={modalOpen}
        record={editRecord}
        facOptions={facOptions}
        confirmLoading={submitting}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
      <CameraTableModal
        open={cameraOpen}
        data={cameraData}
        onClose={() => setCameraOpen(false)}
      />
    </div>
  );
}
