import { useState, useEffect } from "react";
import { Button, Table, Modal, Input, Popconfirm, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, EditOutlined } from "@ant-design/icons";

interface MapRecord {
  id: number;
  facId: number;
  facName: string;
  mapName: string;
  mapCode: string;
}

const STORAGE_KEY = "selectedMap";

function getStoredMap(): number | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function setStoredMap(id: number | null) {
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

export default function MapConfig() {
  const [data, setData] = useState<MapRecord[]>(mockMaps);
  const [selectedMap, setSelectedMap] = useState<number | null>(getStoredMap);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);

  useEffect(() => {
    setStoredMap(selectedMap);
  }, [selectedMap]);

  const handleSwitch = (id: number) => {
    setSelectedMap(id);
    message.success("切换成功");
  };

  const handleEditName = (record: MapRecord) => {
    setEditId(record.id);
    setEditName(record.mapName);
    setEditOpen(true);
  };

  const handleSaveName = () => {
    if (!editName.trim()) return;
    setData(data.map((item) => (item.id === editId ? { ...item, mapName: editName.trim() } : item)));
    setEditOpen(false);
    message.success("修改成功");
  };

  const handleDelete = (id: number) => {
    setData(data.filter((item) => item.id !== id));
    if (selectedMap === id) {
      setSelectedMap(null);
    }
    message.success("删除成功");
  };

  const columns: ColumnsType<MapRecord> = [
    { title: "序号", dataIndex: "id", width: 60, align: "center" },
    { title: "厂站", dataIndex: "facName" },
    {
      title: "地图名称",
      dataIndex: "mapName",
      render: (text: string, record) => (
        <span
          style={{ cursor: "default" }}
          onMouseEnter={(e) => {
            const icon = (e.currentTarget as HTMLElement).querySelector(".edit-icon") as HTMLElement;
            if (icon) icon.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const icon = (e.currentTarget as HTMLElement).querySelector(".edit-icon") as HTMLElement;
            if (icon) icon.style.opacity = "0";
          }}
        >
          {text}
          <EditOutlined
            className="edit-icon"
            style={{ marginLeft: 8, color: "#1677ff", cursor: "pointer", fontSize: 13, opacity: 0, transition: "opacity 0.2s" }}
            onClick={() => handleEditName(record)}
          />
        </span>
      ),
    },
    { title: "地图编码", dataIndex: "mapCode" },
    {
      title: "操作",
      width: 200,
      render: (_, record) => (
        <div style={{ display: "flex", gap: 4 }}>
          <Button type="link" size="small" onClick={() => handleSwitch(record.id)}>
            切换
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
      <div style={{ display: "flex", gap: 8, marginBottom: 12, justifyContent: "flex-end" }}>
        <Button icon={<ReloadOutlined />}>刷新</Button>
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
      <Modal
        title="修改地图名称"
        open={editOpen}
        centered
        onOk={handleSaveName}
        onCancel={() => setEditOpen(false)}
        okText="确定"
        cancelText="取消"
      >
        <Input
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="请输入地图名称"
          onPressEnter={handleSaveName}
        />
      </Modal>
    </div>
  );
}

const mockMaps: MapRecord[] = [
  { id: 1, facId: 1, facName: "测试场站", mapName: "一层巡检地图", mapCode: "MAP001" },
  { id: 2, facId: 1, facName: "测试场站", mapName: "二层巡检地图", mapCode: "MAP002" },
  { id: 3, facId: 2, facName: "2号场站", mapName: "室外巡检地图", mapCode: "MAP003" },
];
