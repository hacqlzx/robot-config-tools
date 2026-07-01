import React, { useState, useEffect, useCallback } from "react";
import { Tree, Modal, Input, message } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import TreeView from "./TreeView";
import { DRAWING_FILE_NAME, PATH_FILE_NAME } from "../hooks/drawing/drawing-storage";
import type { TreeNode } from "./TreeView";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 260;

interface Props {
  panelWidth: number;
  onLoadLas?: (filePath: string) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  loadedFiles: Set<string>;
  treeKey: number;
  loadingFile: string;
  /** 屏柜树勾选变化（传出勾选的间隔 id，用于 3D 回显） */
  onCabinetCheck?: (bayIds: number[]) => void;
  /** 已回显的绘制 json 路径集合 */
  mapDrawingShown?: Set<string>;
  /** 勾选/取消地图树里的绘制 json（回显屏柜） */
  onToggleDrawing?: (path: string, checked: boolean) => void;
  /** 已回显的路径 json 集合 */
  mapPathShown?: Set<string>;
  /** 勾选/取消可行驶路径 json */
  onTogglePath?: (path: string, checked: boolean) => void;
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

export default function SidePanel({ panelWidth, onLoadLas, onToggleVisible, loadedFiles, treeKey, loadingFile, onCabinetCheck, mapDrawingShown, onToggleDrawing, mapPathShown, onTogglePath }: Props) {
  const [sideTab, setSideTab] = useState("map");
  const [mapTreeData, setMapTreeData] = useState<TreeNode[]>([]);
  const [deviceTreeData, setDeviceTreeData] = useState<TreeDataNode[]>([]);
  const [cabinetTreeData, setCabinetTreeData] = useState<TreeDataNode[]>([]);
  const [deviceAreaTreeData, setDeviceAreaTreeData] = useState<TreeDataNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const [renameTarget, setRenameTarget] = useState<TreeNode | null>(null);
  const [renameValue, setRenameValue] = useState("");

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
      loadBayTypeTree("屏柜区", setCabinetTreeData);
    }
  }, [sideTab, loadBayTypeTree]);

  useEffect(() => {
    if (sideTab === "deviceArea") {
      loadBayTypeTree("设备区", setDeviceAreaTreeData);
    }
  }, [sideTab, loadBayTypeTree]);

  /** 右键-打开文件目录 */
  const handleRequestOpenDir = useCallback((node: TreeNode) => {
    window.electronAPI?.project.openDir(node.path);
  }, []);

  /** 右键-删除：直接删除文件/目录并刷新地图树 */
  const handleRequestDelete = useCallback((node: TreeNode) => {
    // 已加载到场景的模型不允许删除（含目录内已加载的子文件）
    const loadedNames: string[] = [];
    const walk = (n: TreeNode) => {
      if (!n.isDir && /\.(las|laz)$/i.test(n.name) && loadedFiles.has(n.name)) loadedNames.push(n.name);
      n.children?.forEach(walk);
    };
    walk(node);
    if (loadedNames.length > 0) {
      message.warning(`「${loadedNames.join("、")}」已加载到场景，请先在地图中取消勾选后再删除`);
      return;
    }
    Modal.confirm({
      title: "删除确认",
      content: `确定删除「${node.name}」？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          // 删除前先清除页面上的绘制回显（含子目录）
          const walkClear = (n: TreeNode) => {
            if (n.name === DRAWING_FILE_NAME) onToggleDrawing?.(n.path, false);
            else if (n.name === PATH_FILE_NAME) onTogglePath?.(n.path, false);
            n.children?.forEach(walkClear);
          };
          walkClear(node);
          await window.electronAPI?.project.deletePath(node.path);
          message.success("已删除");
          loadMapTree();
        } catch (e: any) {
          message.error("删除失败: " + (e?.message || e));
        }
      },
    });
  }, [loadMapTree, loadedFiles, onToggleDrawing, onTogglePath]);

  /** 右键-重命名：打开弹窗 */
  const handleRequestRename = useCallback((node: TreeNode) => {
    setRenameTarget(node);
    setRenameValue(node.name);
  }, []);

  /** 执行重命名 */
  const doRename = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) { message.warning("名称不能为空"); return; }
    try {
      await window.electronAPI?.project.renamePath(renameTarget.path, name);
      message.success("已重命名");
      setRenameTarget(null);
      loadMapTree();
    } catch (e: any) {
      message.error("重命名失败: " + (e?.message || e));
    }
  }, [renameTarget, renameValue, loadMapTree]);

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
      }}>
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
                loadingFile={loadingFile}
                onLoadLas={onLoadLas}
                onToggleVisible={onToggleVisible}
                onRequestRename={handleRequestRename}
                onRequestDelete={handleRequestDelete}
                onRequestOpenDir={handleRequestOpenDir}
                drawingShown={mapDrawingShown}
                onToggleDrawing={onToggleDrawing}
                pathShown={mapPathShown}
                onTogglePath={onTogglePath}
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
                  checkable
                  defaultExpandAll
                  style={{ fontSize: 12 }}
                  onCheck={(checked) => {
                    const keys = (Array.isArray(checked) ? checked : checked.checked) as React.Key[];
                    const bayIds = keys
                      .map(String)
                      .filter((k) => k.startsWith("bay/"))
                      .map((k) => parseInt(k.slice(4), 10))
                      .filter((n) => !isNaN(n));
                    onCabinetCheck?.(bayIds);
                  }}
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
      <Modal
        title="重命名"
        open={!!renameTarget}
        onOk={doRename}
        onCancel={() => setRenameTarget(null)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={doRename}
          autoFocus
        />
      </Modal>
    </>
  );
}
