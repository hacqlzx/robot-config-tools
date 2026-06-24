import React, { useState, useEffect, useCallback, useRef } from "react";
import { Tree } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import TreeView from "./TreeView";
import type { TreeNode } from "./TreeView";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 260;

interface Props {
  onLoadLas?: (filePath: string) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  loadedFiles: Set<string>;
  hiddenFiles: Set<string>;
  treeKey: number;
  loadingFile: string;
}

const TABS = [
  { key: "map", label: "地图" },
  { key: "device", label: "设备台账" },
  { key: "cabinet", label: "屏柜" },
  { key: "deviceArea", label: "设备区" },
];

function upsertChildren(
  tree: TreeDataNode[],
  parentKey: React.Key,
  children: TreeDataNode[],
): TreeDataNode[] {
  return tree.map((node) => {
    if (node.key === parentKey) {
      if (node.children && node.children.length > 0) return node;
      return { ...node, children };
    }
    if (node.children) {
      return { ...node, children: upsertChildren(node.children, parentKey, children) };
    }
    return node;
  });
}

/** 设备台账树：电压 → 间隔 → 主设备 → 部件 */
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
      .filter((b) => b.voltId === v.id)
      .map((b) => ({
        key: `bay/${b.id}`,
        title: b.bayName || "(未命名)",
        children: mainList
          .filter((m) => m.bayId === b.id)
          .map((m) => ({
            key: `main/${m.id}`,
            title: m.mainDeviceName || "(未命名)",
            children: compList
              .filter((c) => c.mainDeviceId === m.id)
              .map((c) => ({
                key: `component/${c.id}`,
                title: c.componentName || "(未命名)",
                isLeaf: false,
              })),
          })),
      })),
  }));
}

/** 屏柜/设备区树：电压 → 指定类型的间隔 */
function buildBayTypeTree(voltList: any[], bayList: any[], bayType: string): TreeDataNode[] {
  return voltList
    .map((v) => {
      const children = bayList
        .filter((b) => b.voltId === v.id && b.bayType === bayType)
        .map((b) => ({
          key: `bay/${b.id}`,
          title: b.bayName || "(未命名)",
          isLeaf: true,
        }));
      if (children.length === 0) return null;
      return {
        key: `volt/${v.id}`,
        title: v.voltName || "(未命名)",
        children,
      };
    })
    .filter(Boolean) as TreeDataNode[];
}

/** 创建懒加载点位回调 */
function makeLoadPoints(
  setTreeData: React.Dispatch<React.SetStateAction<TreeDataNode[]>>,
): TreeProps["loadData"] {
  return (node) =>
    new Promise<void>(async (resolve) => {
      const key = String(node.key);
      if (!key.startsWith("component/")) {
        resolve();
        return;
      }
      const componentId = parseInt(key.split("/")[1], 10);
      if (isNaN(componentId)) {
        resolve();
        return;
      }
      const projectName = localStorage.getItem("selectedProject");
      if (!projectName || !window.electronAPI) {
        resolve();
        return;
      }
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

const TREE_CSS = `
  .side-tree .ant-tree-treenode { white-space: nowrap; }
  .side-tree .ant-tree-node-content-wrapper { overflow: hidden; flex: 1; min-width: 0; line-height: 22px; min-height: 22px; }
  .side-tree .ant-tree-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-tree .ant-tree-indent-unit { width: 14px; }
  .side-tree .ant-tree-switcher { width: 16px; flex-shrink: 0; }
`;

export default function SidePanel({ onLoadLas, onToggleVisible, loadedFiles, hiddenFiles, treeKey, loadingFile }: Props) {
  const [sideTab, setSideTab] = useState("map");
  const [mapTreeData, setMapTreeData] = useState<TreeNode[]>([]);
  const [deviceTreeData, setDeviceTreeData] = useState<TreeDataNode[]>([]);
  const [cabinetTreeData, setCabinetTreeData] = useState<TreeDataNode[]>([]);
  const [deviceAreaTreeData, setDeviceAreaTreeData] = useState<TreeDataNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);

  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta)));
    };
    const onUp = () => { draggingRef.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
  };

  const loadMapTree = useCallback(async () => {
    const selectedProject = localStorage.getItem("selectedProject");
    if (!selectedProject || !window.electronAPI) return;
    try {
      const nodes = await window.electronAPI.project.listTree(selectedProject, "地图");
      setMapTreeData(nodes);
    } catch {
      setMapTreeData([]);
    }
  }, []);

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
      setDeviceTreeData(buildDeviceTree(voltList, bayList, mainList, compList));
    } catch {
      setDeviceTreeData([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const loadBayTypeTree = useCallback(async (bayType: string, setter: React.Dispatch<React.SetStateAction<TreeDataNode[]>>) => {
    const projectName = localStorage.getItem("selectedProject");
    if (!projectName || !window.electronAPI) return;
    setTreeLoading(true);
    try {
      const api = window.electronAPI;
      const [voltList, bayList] = await Promise.all([
        api.db.voltage.list(projectName),
        api.db.bay.list(projectName),
      ]);
      setter(buildBayTypeTree(voltList, bayList, bayType));
    } catch {
      setter([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sideTab === "map") {
      loadMapTree();
      const timer = setInterval(loadMapTree, 3000);
      return () => clearInterval(timer);
    }
  }, [sideTab, treeKey, loadMapTree]);

  useEffect(() => {
    if (sideTab === "device") {
      loadDeviceTree();
    }
  }, [sideTab, loadDeviceTree]);

  useEffect(() => {
    if (sideTab === "cabinet") {
      loadBayTypeTree("屏柜", setCabinetTreeData);
    }
  }, [sideTab, loadBayTypeTree]);

  useEffect(() => {
    if (sideTab === "deviceArea") {
      loadBayTypeTree("设备区", setDeviceAreaTreeData);
    }
  }, [sideTab, loadBayTypeTree]);

  /** 渲染 antd Tree（设备台账或屏柜共用） */
  const renderAntdTree = (data: TreeDataNode[], loadData: TreeProps["loadData"]) => (
    <div className="side-tree" style={{ overflow: "hidden" }}>
      <Tree
        treeData={data}
        loadData={loadData}
        showIcon={false}
        blockNode
        defaultExpandAll
        style={{ fontSize: 12 }}
      />
    </div>
  );

  return (
    <>
      <style>{TREE_CSS}</style>
      <div style={{
        width: panelWidth,
        flexShrink: 0,
        background: "#fff",
        borderRight: "1px solid #e8e8e8",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontSize: 13,
        position: "relative",
      }}>
        {/* 拖拽调整宽度手柄 */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute",
            right: -3,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: "col-resize",
            zIndex: 10,
          }}
        />
        <div style={{ display: "flex", borderBottom: "1px solid #f0f0f0", flexShrink: 0 }}>
          {TABS.map((tab) => (
            <div
              key={tab.key}
              onClick={() => setSideTab(tab.key)}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "8px 0",
                cursor: "pointer",
                color: sideTab === tab.key ? "#1677ff" : "#666",
                fontWeight: sideTab === tab.key ? 500 : 400,
                fontSize: 12,
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "4px 8px" }}>
          {sideTab === "map" ? (
            mapTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              <TreeView
                nodes={mapTreeData}
                loadedFiles={loadedFiles}
                hiddenFiles={hiddenFiles}
                onLoadLas={onLoadLas}
                onToggleVisible={onToggleVisible}
                loadingFile={loadingFile}
              />
            )
          ) : sideTab === "device" ? (
            treeLoading ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>加载中...</div>
            ) : deviceTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              renderAntdTree(deviceTreeData, makeLoadPoints(setDeviceTreeData))
            )
          ) : sideTab === "cabinet" ? (
            treeLoading ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>加载中...</div>
            ) : cabinetTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              <div className="side-tree" style={{ overflow: "hidden" }}>
                <Tree
                  treeData={cabinetTreeData}
                  showIcon={false}
                  blockNode
                  defaultExpandAll
                  style={{ fontSize: 12 }}
                />
              </div>
            )
          ) : sideTab === "deviceArea" ? (
            treeLoading ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>加载中...</div>
            ) : deviceAreaTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              <div className="side-tree" style={{ overflow: "hidden" }}>
                <Tree
                  treeData={deviceAreaTreeData}
                  showIcon={false}
                  blockNode
                  defaultExpandAll
                  style={{ fontSize: 12 }}
                />
              </div>
            )
          ) : (
            <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
          )}
        </div>
      </div>
    </>
  );
}
