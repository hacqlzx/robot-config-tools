import { useState, useEffect, useRef } from "react";
import { Dropdown } from "antd";
import { FolderOutlined, FileOutlined, LoadingOutlined } from "@ant-design/icons";
import {
  DRAWING_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  ROBOT_STOP_POINTS_FILE_NAMES,
  isDrawingDataFileName,
  isReferencePathFileName,
} from "../hooks/drawing/drawing-storage";
import type { SpaceTreeNode } from "../types";
import { MAP_INFO_FILE_NAME, isLasOrLazFileName, loadedFileKey } from "../utils/space-paths";

interface Props {
  nodes: SpaceTreeNode[];
  depth?: number;
  loadedFiles: Set<string>;
  loadingFile: string;
  onLoadLas?: (filePath: string) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  /** 懒加载子节点，返回的 children 会被合并到对应节点下 */
  loadChildren?: (node: SpaceTreeNode) => Promise<SpaceTreeNode[]>;
  /** 右键-删除 */
  onRequestDelete?: (node: SpaceTreeNode) => void;
  /** 右键-打开文件目录 */
  onRequestOpenDir?: (node: SpaceTreeNode) => void;
  /** 已回显的绘制 json 路径集合 */
  drawingShown?: Set<string>;
  /** 勾选/取消绘制 json（回显屏柜） */
  onToggleDrawing?: (path: string, checked: boolean) => void;
  /** 已回显的路径 json 集合 */
  pathShown?: Set<string>;
  /** 勾选/取消路径 json */
  onTogglePath?: (path: string, checked: boolean) => void;
}

function displayNodeName(node: SpaceTreeNode): string {
  if (node.isDir) return node.name;
  if (isLasOrLazFileName(node.name)) return "地图模型";
  if (node.name === DRAWING_FILE_NAME) return "区域";
  if (node.name === ROBOT_PATH_FILE_NAME) return "巡视路径";
  if (node.name === PATH_FILE_NAME) return "参考路径";
  return node.name;
}

function parentPath(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/, "");
}

function siblingPath(filePath: string, fileName: string): string {
  return filePath.replace(/[^\\/]+$/, fileName);
}

function isRobotStopPointFileName(name: string): boolean {
  return (ROBOT_STOP_POINTS_FILE_NAMES as readonly string[]).includes(name);
}

export default function TreeView({ nodes, depth = 0, loadedFiles, loadingFile, onLoadLas, onToggleVisible, loadChildren, onRequestDelete, onRequestOpenDir, drawingShown, onToggleDrawing, pathShown, onTogglePath }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const expandAll = (list: SpaceTreeNode[]) => {
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

  const [lazyChildren, setLazyChildren] = useState<Record<string, SpaceTreeNode[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  // 当节点变化时自动展开新目录
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      const expandNew = (list: SpaceTreeNode[]) => {
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

  const isLas = isLasOrLazFileName;
  const isDrawing = isDrawingDataFileName;
  const isPath = isReferencePathFileName;
  const isHiddenFile = (name: string) => name === MAP_INFO_FILE_NAME || isRobotStopPointFileName(name);
  const isVisibleTreeNode = (node: SpaceTreeNode) => node.isDir || !isHiddenFile(node.name);

  /** 合并节点自身的 children 与懒加载的 children */
  const getEffectiveChildren = (node: SpaceTreeNode): SpaceTreeNode[] | undefined => {
    if (node.children && node.children.length > 0) return node.children;
    const lazy = lazyChildren[node.path];
    if (lazy && lazy.length > 0) return lazy;
    return node.children;
  };

  const handleExpand = async (node: SpaceTreeNode) => {
    const isExpanded = expanded[node.path];

    // 折叠
    if (isExpanded) {
      setExpanded((prev) => ({ ...prev, [node.path]: false }));
      return;
    }

    // 已懒加载过或已有子节点 → 直接展开
    const hasChildren = (node.children && node.children.length > 0) || lazyChildren[node.path];
    if (hasChildren) {
      setExpanded((prev) => ({ ...prev, [node.path]: true }));
      return;
    }

    // 需要懒加载
    if (loadChildren && !loadedRef.current.has(node.path)) {
      loadedRef.current.add(node.path);
      setLoadingNodes((prev) => new Set(prev).add(node.path));
      try {
        const children = await loadChildren(node);
        setLazyChildren((prev) => ({ ...prev, [node.path]: children }));
        setExpanded((prev) => ({ ...prev, [node.path]: true }));
      } finally {
        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(node.path);
          return next;
        });
      }
    }
  };

  const getCheckState = (node: SpaceTreeNode): { checked: boolean; indeterminate?: boolean } => {
    if (node.isDir) {
      const children = getEffectiveChildren(node);
      if (!children || children.length === 0) return { checked: false };
      const states = children.filter((c) => isVisibleTreeNode(c) && !isDrawing(c.name) && !isPath(c.name)).map(getCheckState);
      if (states.length === 0) return { checked: false };
      const allChecked = states.every((s) => s.checked);
      const someChecked = states.some((s) => s.checked || s.indeterminate);
      if (allChecked) return { checked: true };
      if (someChecked) return { checked: false, indeterminate: true };
      return { checked: false };
    }
    if (isDrawing(node.name)) {
      return { checked: drawingShown?.has(node.path) || false };
    }
    if (isPath(node.name)) {
      return { checked: pathShown?.has(node.path) || false };
    }
    if (isRobotStopPointFileName(node.name)) {
      return { checked: pathShown?.has(siblingPath(node.path, ROBOT_PATH_FILE_NAME)) || false };
    }
    if (isLas(node.name)) {
      return { checked: loadedFiles.has(loadedFileKey(node.path)) };
    }
    return { checked: false };
  };

  const handleCheck = (node: SpaceTreeNode, checked: boolean) => {
    if (node.isDir) {
      const children = getEffectiveChildren(node);
      if (!children) return;
      const recurse = async (list: SpaceTreeNode[]) => {
        const lasNodes: SpaceTreeNode[] = [];
        const drawNodes: SpaceTreeNode[] = [];
        const pathNodes: SpaceTreeNode[] = [];
        const robotPathDirs = new Set<string>();
        const stopPointDirs = new Set<string>();
        const collect = (items: SpaceTreeNode[]) => {
          items.forEach((child) => {
            if (!child.isDir && child.name === MAP_INFO_FILE_NAME) {
              return;
            }
            if (child.isDir && child.children) {
              collect(child.children);
            } else if (isLas(child.name)) {
              lasNodes.push(child);
            } else if (isDrawing(child.name)) {
              drawNodes.push(child);
            } else if (isPath(child.name)) {
              pathNodes.push(child);
              if (child.name === ROBOT_PATH_FILE_NAME) robotPathDirs.add(parentPath(child.path));
            } else if (isRobotStopPointFileName(child.name)) {
              stopPointDirs.add(parentPath(child.path));
            }
          });
        };
        collect(list);
        const robotRouteDirs = new Set(
          Array.from(robotPathDirs).filter((dir) => stopPointDirs.has(dir)),
        );
        const effectivePathNodes = checked
          ? pathNodes.filter((child) => child.name !== PATH_FILE_NAME || !robotRouteDirs.has(parentPath(child.path)))
          : pathNodes;
        const skippedReferencePathNodes = checked
          ? pathNodes.filter((child) => child.name === PATH_FILE_NAME && robotRouteDirs.has(parentPath(child.path)))
          : [];

        for (const child of lasNodes) {
          const isLoaded = loadedFiles.has(loadedFileKey(child.path));
          if (checked) {
            if (!isLoaded) await onLoadLas?.(child.path);
          } else {
            if (isLoaded) onToggleVisible?.(child.path);
          }
        }

        for (const child of drawNodes) {
          onToggleDrawing?.(child.path, checked);
        }

        for (const child of skippedReferencePathNodes) {
          if (pathShown?.has(child.path)) onTogglePath?.(child.path, false);
        }

        for (const child of effectivePathNodes) {
          onTogglePath?.(child.path, checked);
        }
      };
      recurse(children);
    } else if (isDrawing(node.name)) {
      onToggleDrawing?.(node.path, checked);
    } else if (isPath(node.name)) {
      onTogglePath?.(node.path, checked);
    } else if (isRobotStopPointFileName(node.name)) {
      onTogglePath?.(siblingPath(node.path, ROBOT_PATH_FILE_NAME), checked);
    } else if (isLas(node.name)) {
      const isLoaded = loadedFiles.has(loadedFileKey(node.path));
      if (checked) {
        if (!isLoaded) onLoadLas?.(node.path);
      } else {
        if (isLoaded) onToggleVisible?.(node.path);
      }
    }
  };

  return (
    <>
      {nodes.filter(isVisibleTreeNode).map((node) => {
        const state = getCheckState(node);
        const effectiveChildren = getEffectiveChildren(node);
        const isLoading = loadingNodes.has(node.path);
        const menuItems = [
          { key: "openDir", label: "打开文件目录" },
          { key: "delete", label: "删除", danger: true },
        ];
        const onMenuClick = (info: { key: string }) => {
          if (info.key === "openDir") onRequestOpenDir?.(node);
          else if (info.key === "delete") onRequestDelete?.(node);
        };

        return (
          <div key={node.path}>
            <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={["contextMenu"]}>
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
                  onClick={() => handleExpand(node)}
                >
                  {isLoading ? (
                    <LoadingOutlined style={{ fontSize: 12 }} />
                  ) : expanded[node.path] ? (
                    "▼"
                  ) : (
                    "▶"
                  )}
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
              <span
                title={node.name}
                style={{ marginLeft: 2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "default" }}
              >
                {displayNodeName(node)}
              </span>
              {!node.isDir && isLas(node.name) && loadingFile === loadedFileKey(node.path) && (
                <LoadingOutlined style={{ color: "#1677ff", fontSize: 14, flexShrink: 0 }} />
              )}
            </div>
            </Dropdown>
            {node.isDir && effectiveChildren && expanded[node.path] && (
              <TreeView
                nodes={effectiveChildren}
                depth={depth + 1}
                loadedFiles={loadedFiles}
                loadingFile={loadingFile}
                onLoadLas={onLoadLas}
                onToggleVisible={onToggleVisible}
                loadChildren={loadChildren}
                onRequestDelete={onRequestDelete}
                onRequestOpenDir={onRequestOpenDir}
                drawingShown={drawingShown}
                onToggleDrawing={onToggleDrawing}
                pathShown={pathShown}
                onTogglePath={onTogglePath}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export type { SpaceTreeNode as TreeNode };
