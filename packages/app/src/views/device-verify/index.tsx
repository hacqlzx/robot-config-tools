import { useRef, useState, useEffect, useCallback } from "react";
import { Button, Space, App, Tree, Spin } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  SyncOutlined,
  PushpinOutlined,
  CloudSyncOutlined,
} from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
import "./index.scss";

/** 在树中找到指定 key 的节点并 set children（仅空时写入） */
function upsertChildren(nodes: TreeDataNode[], targetKey: string, children: TreeDataNode[]): TreeDataNode[] {
  return nodes.map((node) => {
    if (node.key === targetKey) {
      return (node.children && node.children.length > 0) ? node : { ...node, children };
    }
    if (node.children) return { ...node, children: upsertChildren(node.children, targetKey, children) };
    return node;
  });
}

/** 构建设备台账树（4层：电压→间隔→主设备→部件，点位懒加载） */
function buildDeviceTree(
  voltList: any[],
  bayList: any[],
  mainList: any[],
  compList: any[],
): TreeDataNode[] {
  return voltList.map((v) => ({
    key: `volt/${v.id}`,
    title: v.voltName || "(未命名)",
    children: bayList
      .filter((b: any) => b.voltId === v.id)
      .map((b: any) => ({
        key: `bay/${b.id}`,
        title: b.bayName || "(未命名)",
        children: mainList
          .filter((m: any) => m.bayId === b.id)
          .map((m: any) => ({
            key: `main/${m.id}`,
            title: m.mainDeviceName || "(未命名)",
            children: compList
              .filter((c: any) => c.mainDeviceId === m.id)
              .map((c: any) => ({
                key: `component/${c.id}`,
                title: c.componentName || "(未命名)",
                isLeaf: false,
              })),
          })),
      })),
  }));
}

/** 点位懒加载回调 */
function makeLoadPoints(
  setTreeData: React.Dispatch<React.SetStateAction<TreeDataNode[]>>,
): TreeProps["loadData"] {
  return (node) =>
    new Promise<void>(async (resolve) => {
      const key = String(node.key);
      if (!key.startsWith("component/")) { resolve(); return; }
      const componentId = parseInt(key.split("/")[1], 10);
      if (isNaN(componentId)) { resolve(); return; }
      const projectName = localStorage.getItem("selectedProject");
      if (!projectName || !window.electronAPI) { resolve(); return; }
      try {
        const points = await window.electronAPI.db.point.findByComponentId(componentId, projectName);
        const children: TreeDataNode[] = points.map((p: any) => ({
          key: `point/${p.id}`,
          title: p.pointName || "(未命名)",
          isLeaf: true,
        }));
        setTreeData((prev) => upsertChildren(prev, node.key, children));
      } finally {
        resolve();
      }
    });
}

export default function DeviceVerify() {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);

  const { width: leftWidth, onMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.3,
    minWidth: 200,
    maxPercent: 0.5,
  });

  const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  // 收集需要默认展开的 key（排除 component 层级）
  const collectExpandKeys = (nodes: TreeDataNode[]): React.Key[] => {
    const keys: React.Key[] = [];
    const walk = (list: TreeDataNode[]) => {
      for (const n of list) {
        if (!String(n.key).startsWith("component/")) {
          keys.push(n.key);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(nodes);
    return keys;
  };

  // 加载设备台账树
  const loadDeviceTree = useCallback(async () => {
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName || !window.electronAPI) return;
    setTreeLoading(true);
    try {
      const api = window.electronAPI;
      const [voltList, bayList, mainList, compList] = await Promise.all([
        api.db.voltage.list(projectName),
        api.db.bay.list(projectName),
        api.db.mainDevice.list(projectName),
        api.db.component.list(projectName),
      ]);
      const tree = buildDeviceTree(voltList, bayList, mainList, compList);
      setTreeData(tree);
      setExpandedKeys(collectExpandKeys(tree));
    } catch {
      setTreeData([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => { loadDeviceTree(); }, [loadDeviceTree]);

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  return (
    <div className="device-verify-page">
      {/* 顶部工具栏 */}
      <div className="device-verify-toolbar">
        <Space size={4} wrap>
          <Button icon={<UploadOutlined />} onClick={() => placeholder("验证图加载")}>
            验证图加载
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => placeholder("验证图导出")}>
            验证图导出
          </Button>
          <Button icon={<SyncOutlined />} onClick={() => placeholder("导出纠偏数据")}>
            导出纠偏数据
          </Button>
          <Button icon={<PushpinOutlined />} onClick={() => placeholder("导出标记点位")}>
            导出标记点位
          </Button>
          <Button icon={<CloudSyncOutlined />} onClick={() => placeholder("同步分析主机")}>
            同步分析主机
          </Button>
        </Space>
      </div>

      {/* 主体 */}
      <div className="device-verify-body" ref={containerRef}>
        {/* 左侧点位树 */}
        <div className="device-verify-left" style={{ width: leftWidth }}>
          <div className="device-verify-left-title">
            <span className="device-verify-title-text">点位树</span>
          </div>
          <div className="device-verify-tree">
            {treeLoading ? (
              <Spin style={{ display: "block", marginTop: 24, textAlign: "center" }} />
            ) : (
              <Tree showLine loadData={makeLoadPoints(setTreeData)} treeData={treeData} expandedKeys={expandedKeys} onExpand={(keys) => setExpandedKeys(keys)} />
            )}
          </div>
        </div>

        {/* 拖拽手柄 */}
        <div className="device-verify-resizer" onMouseDown={onMouseDown} />

        {/* 右侧图片区 */}
        <div className="device-verify-right">
          <div className="device-verify-img-placeholder">
            图片展示区域
          </div>
        </div>
      </div>
    </div>
  );
}
