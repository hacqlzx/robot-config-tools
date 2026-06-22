import { useState, useRef, useEffect } from "react";
import { Button, Table, Modal, Input, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined, EditOutlined } from "@ant-design/icons";
import {
  getMapList,
  editMap,
  deleteMap,
  setCurrentMap,
  getFacInfo,
} from "@/api/config.js";

interface MapRecord {
  id: number;
  facId: number;
  mapName: string;
  mapCode: string;
}

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

export default function MapConfig() {
  const [data, setData] = useState<MapRecord[]>([]);
  const [facNameMap, setFacNameMap] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const fetchedRef = useRef(false);

  /** 查询地图列表 */
  const fetchMaps = async () => {
    setLoading(true);
    try {
      const res = await getMapList();
      const body = res.data as ApiResponse<MapRecord[]>;
      if (body.success) {
        if (body.data) {
          setData(body.data);
        }
      } else {
        message.error(body.message || "获取地图列表失败");
      }
    } catch {
      message.error("获取地图列表失败");
    } finally {
      setLoading(false);
    }
  };

  /** 查询厂站列表（供显示厂站名称） */
  const fetchFacNames = async () => {
    try {
      const res = await getFacInfo();
      const body = res.data as ApiResponse<
        { id: number; stationName: string }[]
      >;
      if (body.success) {
        if (body.data) {
          const map: Record<number, string> = {};
          body.data.forEach((item) => {
            map[item.id] = item.stationName;
          });
          setFacNameMap(map);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchMaps();
      fetchFacNames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 切换运行地图 */
  const handleSwitch = async (id: number) => {
    try {
      const res = await setCurrentMap(id);
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        message.success("切换成功");
      } else {
        message.error(body.message || "切换失败");
      }
    } catch {
      message.error("切换失败");
    }
  };

  /** 编辑地图名称 */
  const handleEditName = (record: MapRecord) => {
    setEditId(record.id);
    setEditName(record.mapName);
    setEditOpen(true);
  };

  const handleSaveName = async () => {
    const name = editName.trim();
    if (!name || editId === null) return;
    try {
      const res = await editMap({ id: editId, mapName: name });
      const body = res.data as ApiResponse<null>;
      if (body.success) {
        setData(
          data.map((item) =>
            item.id === editId ? { ...item, mapName: name } : item,
          ),
        );
        setEditOpen(false);
        message.success("修改成功");
      } else {
        message.error(body.message || "修改失败");
      }
    } catch {
      message.error("修改失败");
    }
  };

  /** 删除 */
  const handleDelete = (record: MapRecord) => {
    Modal.confirm({
      centered: true,
      title: "确认删除",
      content: `确定要删除地图「${record.mapName}」吗？`,
      okText: "确定",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteMap(record.id);
          const body = res.data as ApiResponse<null>;
          if (body.success) {
            message.success("删除成功");
            fetchMaps();
          } else {
            message.error(body.message || "删除失败");
          }
        } catch {
          message.error("删除失败");
        }
      },
    });
  };

  const columns: ColumnsType<MapRecord> = [
    {
      title: "序号",
      width: 60,
      align: "center",
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: "厂站",
      width: 140,
      render: (_, record) => facNameMap[record.facId] || record.facId,
    },
    {
      title: "地图名称",
      dataIndex: "mapName",
      render: (text: string, record) => (
        <span style={{ cursor: "default" }}>
          {text}
          <EditOutlined
            className="edit-icon"
            style={{
              marginLeft: 8,
              color: "#1677ff",
              cursor: "pointer",
              fontSize: 13,
              opacity: 0,
              transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.opacity = "0";
            }}
            onClick={() => handleEditName(record)}
          />
        </span>
      ),
    },
    { title: "地图编码", dataIndex: "mapCode" },
    {
      title: "操作",
      width: 140,
      render: (_, record) => (
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            type="link"
            size="small"
            onClick={() => handleSwitch(record.id)}
          >
            切换
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
          justifyContent: "flex-end",
        }}
      >
        <Button icon={<ReloadOutlined />} onClick={fetchMaps} loading={loading}>
          刷新
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
      <Modal
        title="修改地图名称"
        open={editOpen}
        centered
        onOk={handleSaveName}
        onCancel={() => setEditOpen(false)}
        okText="确定"
        cancelText="取消"
        getContainer={false}
        destroyOnClose
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
