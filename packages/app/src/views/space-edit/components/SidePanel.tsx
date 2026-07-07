import React, { useState, useEffect, useCallback } from "react";
import { Tree, Modal, Input, message } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import TreeView from "./TreeView";
import DeviceTree from "@/components/DeviceTree";
import { DRAWING_FILE_NAME, PATH_FILE_NAME } from "../hooks/drawing/drawing-storage";
import type { SpaceTreeNode } from "../types";
import { MAP_DIR_NAME, isLasOrLazFileName } from "../utils/space-paths";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 260;

interface Props {
  panelWidth: number;
  onLoadLas?: (filePath: string) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  onUnloadMapFile?: (filePath: string) => void;
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

const TREE_CSS = `
  .side-tree .ant-tree-treenode { white-space: nowrap; }
  .side-tree .ant-tree-node-content-wrapper { overflow: hidden; flex: 1; min-width: 0; }
  .side-tree .ant-tree-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-tree .ant-tree-indent-unit { width: 14px; }
  .side-tree .ant-tree-switcher { width: 16px; flex-shrink: 0; }
`;

export default function SidePanel({ panelWidth, onLoadLas, onToggleVisible, onUnloadMapFile, loadedFiles, treeKey, loadingFile, onCabinetCheck, mapDrawingShown, onToggleDrawing, mapPathShown, onTogglePath }: Props) {
  const [sideTab, setSideTab] = useState("map");
  const [mapTreeData, setMapTreeData] = useState<SpaceTreeNode[]>([]);
  const [cabinetTreeData, setCabinetTreeData] = useState<TreeDataNode[]>([]);
  const [deviceAreaTreeData, setDeviceAreaTreeData] = useState<TreeDataNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const [renameTarget, setRenameTarget] = useState<SpaceTreeNode | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const loadMapTree = useCallback(async () => {
    const selectedProject = localStorage.getItem("selectedProject");
    if (!selectedProject || !window.electronAPI) return;
    try {
      const nodes = await window.electronAPI.project.listTree(selectedProject, MAP_DIR_NAME);
      setMapTreeData(nodes);
    } catch {
      setMapTreeData([]);
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
  const handleRequestOpenDir = useCallback((node: SpaceTreeNode) => {
    window.electronAPI?.project.openDir(node.path);
  }, []);

  /** 右键-删除：直接删除文件/目录并刷新地图树 */
  const handleRequestDelete = useCallback((node: SpaceTreeNode) => {
    Modal.confirm({
      title: "删除确认",
      content: `确定删除「${node.name}」？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          // 删除前先清除页面上的模型、绘制和路径回显（含子目录）
          const walkClear = (n: SpaceTreeNode) => {
            if (!n.isDir && isLasOrLazFileName(n.name) && loadedFiles.has(n.name)) onUnloadMapFile?.(n.path);
            else if (n.name === DRAWING_FILE_NAME) onToggleDrawing?.(n.path, false);
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
  }, [loadMapTree, loadedFiles, onToggleDrawing, onTogglePath, onUnloadMapFile]);

  /** 右键-重命名：打开弹窗 */
  const handleRequestRename = useCallback((node: SpaceTreeNode) => {
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
        <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
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
            <div className="side-tree" style={{ overflow: "hidden", height: "100%" }}>
              <DeviceTree />
            </div>
          ) : sideTab === "cabinet" ? (
            treeLoading ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>加载中...</div>
            ) : cabinetTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              <div className="side-tree" style={{ overflow: "hidden" }}>
                <Tree
                  treeData={cabinetTreeData}
                  showLine
                  blockNode
                  defaultExpandAll
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
                  showLine
                  blockNode
                  defaultExpandAll
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
