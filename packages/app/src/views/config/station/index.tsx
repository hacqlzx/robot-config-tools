import { useState, useRef, useEffect } from "react";
import { Button, Table, Modal, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import StationFormModal from "./StationFormModal";
import { getFacInfo, addFac, editFac, deleteFac, setCurrentFac } from "@/api/config.js";
import { subscribe } from "@/stores/backendStore";

export interface StationRecord {
  id: number;
  stationName: string;
  stationCode: string;
  voltName: string;
  stationTypeDesc: string;
  /** 是否默认厂站 0=是 1=否 */
  currentFac: number;
  /** 表单用：厂站类型代码 */
  facType?: string;
  /** 表单用：变电站类型代码 */
  stationType?: string;
  provinceName?: string;
  cityName?: string;
  areaName?: string;
}

/** 响应通用结构 */
interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

export default function StationConfig() {
  const [data, setData] = useState<StationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<StationRecord | null>(null);
  const fetchedRef = useRef(false);

  /** 查询厂站列表 */
  const fetchStations = async () => {
    setLoading(true);
    try {
      const res = await getFacInfo();
      const body = res.data as ApiResponse<StationRecord[]>;
      if (body.success) {
        if (body.data) {
          setData(body.data);
        }
      } else {
        message.error(body.message || "获取厂站列表失败");
      }
    } catch {
      message.error("获取厂站列表失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchStations();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IP 切换时重新加载
  useEffect(() => {
    return subscribe(() => {
      fetchStations();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 切换默认厂站 */
  const handleSwitch = async (id: number) => {
    try {
      const res = await setCurrentFac(id);
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("切换成功");
        fetchStations();
      } else {
        message.error(body.message || "切换失败");
      }
    } catch {
      message.error("切换失败");
    }
  };

  /** 编辑 */
  const handleEdit = (record: StationRecord) => {
    setEditRecord(record);
    setModalOpen(true);
  };

  /** 删除 */
  const handleDelete = (record: StationRecord) => {
    Modal.confirm({
      centered: true,
      title: "确认删除",
      content: `确定要删除厂站「${record.stationName}」吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteFac(record.id);
          const body = res.data as ApiResponse<null>;
          if (body.success) {
            message.success("删除成功");
            fetchStations();
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
        res = await editFac({ id: editRecord.id, ...values });
      } else {
        res = await addFac(values);
      }
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success(editRecord ? "编辑成功" : "新增成功");
        setModalOpen(false);
        fetchStations();
      } else {
        message.error(body.message || (editRecord ? "编辑失败" : "新增失败"));
      }
    } catch {
      message.error(editRecord ? "编辑失败" : "新增失败");
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<StationRecord> = [
    { title: "序号", width: 60, align: "center", render: (_: any, __: any, index: number) => index + 1 },
    { title: "厂站名称", dataIndex: "stationName" },
    { title: "厂站编码", dataIndex: "stationCode" },
    { title: "电压等级", dataIndex: "voltName", width: 100 },
    { title: "厂站类型", dataIndex: "stationTypeDesc", width: 110 },
    {
      title: "操作",
      width: 200,
      render: (_, record) => (
        <div style={{ display: "flex", gap: 4 }}>
          {record.currentFac === 1 && (
            <Button type="link" size="small" onClick={() => handleSwitch(record.id)}>
              切换
            </Button>
          )}
          <Button type="link" size="small" onClick={() => handleEdit(record)}>
            编辑
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
        <Button icon={<ReloadOutlined />} onClick={fetchStations} loading={loading}>
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
      <StationFormModal
        open={modalOpen}
        record={editRecord}
        confirmLoading={submitting}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
