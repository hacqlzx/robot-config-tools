import { useState, useEffect } from "react";
import { FolderOutlined, FileOutlined, LoadingOutlined } from "@ant-design/icons";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface Props {
  nodes: TreeNode[];
  depth?: number;
  loadedFiles: Set<string>;
  hiddenFiles: Set<string>;
  loadingFile: string;
  onLoadLas?: (filePath: string) => void;
  onToggleVisible?: (filePath: string) => void;
}

export default function TreeView({ nodes, depth = 0, loadedFiles, hiddenFiles, loadingFile, onLoadLas, onToggleVisible }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const expandAll = (list: TreeNode[]) => {
      list.forEach((node) => {
        if (node.isDir) {
          init[node.path] = true;
          if (node.children) expandAll(node.children);
        }
      });
    };
    expandAll(nodes);
    return init;
  });

  // 当节点变化时自动展开新目录
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      const expandNew = (list: TreeNode[]) => {
        list.forEach((node) => {
          if (node.isDir) {
            if (!(node.path in next)) { next[node.path] = true; changed = true; }
            if (node.children) expandNew(node.children);
          }
        });
      };
      expandNew(nodes);
      return changed ? next : prev;
    });
  }, [nodes]);

  const isLas = (name: string) => name.endsWith(".las") || name.endsWith(".laz");

  const getCheckState = (node: TreeNode): { checked: boolean; indeterminate?: boolean } => {
    if (node.isDir) {
      if (!node.children || node.children.length === 0) return { checked: false };
      const states = node.children.map(getCheckState);
      const allChecked = states.every((s) => s.checked);
      const someChecked = states.some((s) => s.checked || s.indeterminate);
      if (allChecked) return { checked: true };
      if (someChecked) return { checked: false, indeterminate: true };
      return { checked: false };
    }
    if (isLas(node.name)) {
      const nameKey = node.name;
      return { checked: loadedFiles.has(nameKey) && !hiddenFiles.has(node.path) };
    }
    return { checked: false };
  };

  const handleCheck = (node: TreeNode, checked: boolean) => {
    if (node.isDir) {
      // 递归设置子节点
      const recurse = (list: TreeNode[]) => {
        list.forEach((child) => {
          if (child.isDir && child.children) {
            recurse(child.children);
          } else if (isLas(child.name)) {
            const isLoaded = loadedFiles.has(child.name);
            const isHidden = hiddenFiles.has(child.path);
            if (checked) {
              if (!isLoaded) onLoadLas?.(child.path);
              else if (isHidden) onToggleVisible?.(child.path);
            } else {
              if (isLoaded && !isHidden) onToggleVisible?.(child.path);
            }
          }
        });
      };
      if (node.children) recurse(node.children);
    } else if (isLas(node.name)) {
      const isLoaded = loadedFiles.has(node.name);
      const isHidden = hiddenFiles.has(node.path);
      if (checked) {
        if (!isLoaded) onLoadLas?.(node.path);
        else if (isHidden) onToggleVisible?.(node.path);
      } else {
        if (isLoaded && !isHidden) onToggleVisible?.(node.path);
      }
    }
  };

  return (
    <>
      {nodes.map((node) => {
        const state = getCheckState(node);
        return (
          <div key={node.path}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 4px",
                paddingLeft: depth * 16,
                fontSize: 13,
                color: "#333",
                borderRadius: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {/* 展开/折叠 */}
              {node.isDir ? (
                <span
                  style={{ fontSize: 10, width: 12, textAlign: "center", cursor: "pointer" }}
                  onClick={() => setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
                >
                  {expanded[node.path] ? "▼" : "▶"}
                </span>
              ) : (
                <span style={{ width: 12 }} />
              )}

              {/* 复选框 */}
              <input
                type="checkbox"
                checked={state.checked}
                ref={(el) => {
                  if (el) el.indeterminate = state.indeterminate || false;
                }}
                style={{ width: 14, height: 14, cursor: "pointer", flexShrink: 0 }}
                onChange={(e) => {
                  e.stopPropagation();
                  handleCheck(node, e.target.checked);
                }}
              />

              {node.isDir ? (
                <FolderOutlined style={{ color: "#faad14", fontSize: 14 }} />
              ) : (
                <FileOutlined style={{ color: "#999", fontSize: 14 }} />
              )}
              <span style={{ marginLeft: 2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default" }}>
                {node.name}
              </span>
              {!node.isDir && isLas(node.name) && loadingFile === node.name && (
                <LoadingOutlined style={{ color: "#1677ff", fontSize: 14, flexShrink: 0 }} />
              )}
            </div>
            {node.isDir && node.children && expanded[node.path] && (
              <TreeView
                nodes={node.children}
                depth={depth + 1}
                loadedFiles={loadedFiles}
                hiddenFiles={hiddenFiles}
                loadingFile={loadingFile}
                onLoadLas={onLoadLas}
                onToggleVisible={onToggleVisible}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export type { TreeNode };
