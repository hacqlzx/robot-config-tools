import { useState, useEffect, useCallback } from "react";
import { Tree, Spin } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import { useSelectedProject } from "@/stores/appContextStore";

interface Props {
  /** 是否显示复选框 */
  checkable?: boolean;
  /** 复选框选中回调 */
  onCheck?: (checkedKeys: React.Key[]) => void;
  /** 默认展开到第几层，1=电压, 2=间隔, 3=主设备, 0=全部 */
  defaultExpandLevel?: number;
  style?: React.CSSProperties;
}

/** 在树中找到指定 key 的节点并写入 children（仅空时写入） */
function upsertChildren(nodes: TreeDataNode[], targetKey: string, children: TreeDataNode[]): TreeDataNode[] {
  return nodes.map((node) => {
    if (node.key === targetKey) {
      return (node.children && node.children.length > 0) ? node : { ...node, children };
    }
    if (node.children) return { ...node, children: upsertChildren(node.children, targetKey, children) };
    return node;
  });
}

/** 构建设备台账树（电压→间隔→主设备→部件，点位懒加载） */
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

/** 收集需要展开的 key（按层级） */
function collectExpandKeys(nodes: TreeDataNode[], maxLevel: number): React.Key[] {
  if (maxLevel <= 0) {
    const all: React.Key[] = [];
    const walk = (list: TreeDataNode[]) => {
      for (const n of list) { all.push(n.key); if (n.children) walk(n.children); }
    };
    walk(nodes);
    return all;
  }
  const keys: React.Key[] = [];
  const walk = (list: TreeDataNode[], depth: number) => {
    if (depth >= maxLevel) return;
    for (const n of list) {
      keys.push(n.key);
      if (n.children) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return keys;
}

export default function DeviceTree({ checkable, onCheck, defaultExpandLevel = 0, style }: Props) {
  const projectName = useSelectedProject();
  const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTree = useCallback(async () => {
    if (!projectName || !window.electronAPI) {
      setTreeData([]);
      setExpandedKeys([]);
      return;
    }
    setLoading(true);
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
      setExpandedKeys(collectExpandKeys(tree, defaultExpandLevel));
    } catch {
      setTreeData([]);
    } finally {
      setLoading(false);
    }
  }, [defaultExpandLevel, projectName]);

  useEffect(() => { loadTree(); }, [loadTree]);

  /** 点位懒加载 */
  const loadData: TreeProps["loadData"] = (node) =>
    new Promise<void>(async (resolve) => {
      const key = String(node.key);
      if (!key.startsWith("component/")) { resolve(); return; }
      const componentId = parseInt(key.split("/")[1], 10);
      if (isNaN(componentId)) { resolve(); return; }
      if (!projectName || !window.electronAPI) { resolve(); return; }
      try {
        const points = await window.electronAPI.db.point.findByComponentId(componentId, projectName);
        const children: TreeDataNode[] = points.map((p: any) => ({
          key: `point/${p.id}`,
          title: p.pointName || "(未命名)",
          isLeaf: true,
        }));
        setTreeData((prev) => upsertChildren(prev, key, children));
      } finally {
        resolve();
      }
    });

  const handleCheck = (checked: any) => {
    const keys = (Array.isArray(checked) ? checked : checked.checked) as React.Key[];
    onCheck?.(keys);
  };

  if (loading) {
    return <Spin style={{ display: "block", marginTop: 24, textAlign: "center" }} />;
  }

  return (
    <>
      <style>{`
        .device-tree .ant-tree-treenode { white-space: nowrap; }
        .device-tree .ant-tree-node-content-wrapper { overflow: hidden; flex: 1; min-width: 0; }
        .device-tree .ant-tree-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
      <div className="device-tree">
        <Tree
          showLine
          treeData={treeData}
          loadData={loadData}
          expandedKeys={expandedKeys}
          onExpand={(keys) => setExpandedKeys(keys)}
          checkable={checkable}
          onCheck={checkable ? handleCheck : undefined}
          blockNode
          style={style}
        />
      </div>
    </>
  );
}

// 保留过滤器函数供外部使用
export { buildDeviceTree };
