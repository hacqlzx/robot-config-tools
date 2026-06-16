import { useState, useEffect, useCallback } from "react";
import TreeView from "./TreeView";
import type { TreeNode } from "./TreeView";

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

export default function SidePanel({ onLoadLas, onToggleVisible, loadedFiles, hiddenFiles, treeKey, loadingFile }: Props) {
  const [sideTab, setSideTab] = useState("map");
  const [treeData, setTreeData] = useState<TreeNode[]>([]);

  const loadMapTree = useCallback(async () => {
    const selectedProject = localStorage.getItem("selectedProject");
    if (!selectedProject || !window.electronAPI) return;
    try {
      const nodes = await window.electronAPI.project.listTree(selectedProject, "地图");
      setTreeData(nodes);
    } catch {
      setTreeData([]);
    }
  }, []);

  useEffect(() => {
    if (sideTab === "map") {
      loadMapTree();
      const timer = setInterval(loadMapTree, 3000);
      return () => clearInterval(timer);
    }
  }, [sideTab, treeKey, loadMapTree]);

  return (
    <div style={{
      width: 260,
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
          treeData.length === 0 ? (
            <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
          ) : (
            <TreeView
              nodes={treeData}
              loadedFiles={loadedFiles}
              hiddenFiles={hiddenFiles}
              onLoadLas={onLoadLas}
              onToggleVisible={onToggleVisible}
              loadingFile={loadingFile}
            />
          )
        ) : (
          <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
        )}
      </div>
    </div>
  );
}
