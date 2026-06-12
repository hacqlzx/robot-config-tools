import { useState, useEffect } from "react";
import { Button, Table, Popconfirm, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import StationFormModal from "./StationFormModal";
// import { getAllFac } from "@/api/config.js";

export const FAC_TYPE_MAP: Record<string, string> = {
  "10": "配电房",
  "20": "开闭所",
  "30": "变电站",
};

export const STATION_TYPE_MAP: Record<string, string> = {
  "1": "AIS站",
  "2": "GIS站",
  "3": "HGIS站",
  "4": "室内站",
};

export interface StationRecord {
  id: number;
  stationName: string;
  stationCode: string;
  voltName: string;
  facType: string;
  stationType: string;
  provinceName?: string;
  cityName?: string;
  areaName?: string;
}

const STORAGE_KEY = "selectedStation";

function getStoredStation(): number | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function setStoredStation(id: number | null) {
  try {
    if (id !== null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export default function StationConfig() {
  const [data, setData] = useState<StationRecord[]>(mockData);
  const [selectedStation, setSelectedStation] = useState<number | null>(getStoredStation);
  const [modalOpen, setModalOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<StationRecord | null>(null);

  useEffect(() => {
    setStoredStation(selectedStation);
  }, [selectedStation]);

  // TODO: 自动获取厂站列表
  // const fetchStations = async () => {
  //   try {
  //     const res = await getAllFac();
  //     setData(res.data || []);
  //   } catch {
  //     message.error("获取厂站列表失败");
  //   }
  // };
  //
  // useEffect(() => {
  //   fetchStations();
  // }, []);

  const handleSwitch = (id: number) => {
    setSelectedStation(id);
    message.success("切换成功");
  };

  const handleEdit = (record: StationRecord) => {
    setEditRecord(record);
    setModalOpen(true);
  };

  const handleDelete = (id: number) => {
    setData(data.filter((item) => item.id !== id));
    if (selectedStation === id) {
      setSelectedStation(null);
    }
    message.success("删除成功");
  };

  const handleAdd = () => {
    setEditRecord(null);
    setModalOpen(true);
  };

  const handleSubmit = (values: StationRecord) => {
    if (editRecord) {
      setData(data.map((item) => (item.id === editRecord.id ? { ...values, id: editRecord.id } : item)));
      message.success("编辑成功");
    } else {
      const newId = Math.max(0, ...data.map((d) => d.id)) + 1;
      setData([...data, { ...values, id: newId }]);
      message.success("新增成功");
    }
    setModalOpen(false);
  };

  const columns: ColumnsType<StationRecord> = [
    { title: "序号", dataIndex: "id", width: 60, align: "center" },
    { title: "厂站名称", dataIndex: "stationName" },
    { title: "厂站编码", dataIndex: "stationCode" },
    { title: "电压等级", dataIndex: "voltName", width: 100 },
    {
      title: "厂站类型",
      dataIndex: "facType",
      width: 110,
      render: (v: string) => FAC_TYPE_MAP[v] || v,
    },
    {
      title: "变电站类型",
      dataIndex: "stationType",
      width: 110,
      render: (v: string) => STATION_TYPE_MAP[v] || v,
    },
    {
      title: "操作",
      width: 200,
      render: (_, record) => (
        <div style={{ display: "flex", gap: 4 }}>
          <Button type="link" size="small" onClick={() => handleSwitch(record.id)}>
            切换
          </Button>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </div>
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
          columns={columns}
          dataSource={data}
          pagination={false}
          size="small"
          bordered
        />
      </div>
      <StationFormModal
        open={modalOpen}
        record={editRecord}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

const mockData: StationRecord[] = [
  { id: 1, stationName: "测试场站", stationCode: "20250228", voltName: "220kV", facType: "30", stationType: "3" },
  { id: 2, stationName: "2号场站", stationCode: "20250301", voltName: "110kV", facType: "10", stationType: "1" },
  { id: 3, stationName: "3号场站", stationCode: "20250302", voltName: "35kV", facType: "20", stationType: "2" },
];
