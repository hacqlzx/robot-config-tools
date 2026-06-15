import { useState } from "react";
import { FolderOutlined, FileOutlined, ImportOutlined, EyeOutlined, EyeInvisibleOutlined } from "@ant-design/icons";

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
  onLoadLas?: (filePath: string) => void;
  onToggleVisible?: (filePath: string) => void;
}

export default function TreeView({ nodes, depth = 0, loadedFiles, hiddenFiles, onLoadLas, onToggleVisible }: Props) {
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

  const isLas = (name: string) => name.endsWith(".las") || name.endsWith(".laz");

  return (
    <>
      {nodes.map((node) => (
        <div key={node.path}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 4px",
              paddingLeft: depth * 16,
              cursor: "pointer",
              fontSize: 13,
              color: "#333",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            onClick={() => {
              if (node.isDir) {
                setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }));
              }
            }}
          >
            {node.isDir ? (
              <span style={{ fontSize: 10, width: 12, textAlign: "center" }}>
                {expanded[node.path] ? "▼" : "▶"}
              </span>
            ) : (
              <span style={{ width: 12 }} />
            )}
            {node.isDir ? (
              <FolderOutlined style={{ color: "#faad14", fontSize: 14 }} />
            ) : (
              <FileOutlined style={{ color: "#999", fontSize: 14 }} />
            )}
            <span style={{ marginLeft: 2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
            {!node.isDir && isLas(node.name) && (
              loadedFiles.has(node.path) ? (
                hiddenFiles.has(node.path) ? (
                  <EyeInvisibleOutlined
                    style={{ color: "#999", fontSize: 14, flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); onToggleVisible?.(node.path); }}
                  />
                ) : (
                  <EyeOutlined
                    style={{ color: "#1677ff", fontSize: 14, flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); onToggleVisible?.(node.path); }}
                  />
                )
              ) : (
                <ImportOutlined
                  style={{ color: "#999", fontSize: 14, flexShrink: 0 }}
                  onClick={(e) => { e.stopPropagation(); onLoadLas?.(node.path); }}
                />
              )
            )}
          </div>
          {node.isDir && node.children && expanded[node.path] && (
            <TreeView
              nodes={node.children}
              depth={depth + 1}
              loadedFiles={loadedFiles}
              hiddenFiles={hiddenFiles}
              onLoadLas={onLoadLas}
              onToggleVisible={onToggleVisible}
            />
          )}
        </div>
      ))}
    </>
  );
}

export type { TreeNode };
