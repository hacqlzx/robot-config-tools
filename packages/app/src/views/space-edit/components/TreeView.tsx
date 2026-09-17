import { useState, useEffect, useRef } from "react";
import { Dropdown } from "antd";
import {
  AppstoreOutlined,
  BorderOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CompassOutlined,
  EnvironmentOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  QuestionCircleOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  DRAWING_FILE_NAME,
  INSPECTION_POINTS_FILE_NAME,
  NORMAL_ANNOTATIONS_FILE_NAME,
  PATH_FILE_NAME,
  ROBOT_PATH_FILE_NAME,
  ROBOT_STOP_POINTS_FILE_NAMES,
  isDrawingDataFileName,
  isReferencePathFileName,
} from "../hooks/drawing/drawing-storage";
import type { SpaceTreeNode } from "../types";
import type { InspectionPointItem } from "../hooks/drawing/drawing-schema";
import { MAP_INFO_FILE_NAME, isLasOrLazFileName, loadedFileKey } from "../utils/space-paths";

interface Props {
  nodes: SpaceTreeNode[];
  depth?: number;
  loadedFiles: Set<string>;
  loadingFile: string;
  onLoadLas?: (filePath: string, loadAllContents?: boolean) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  /** 懒加载子节点，返回的 children 会被合并到对应节点下 */
  loadChildren?: (node: SpaceTreeNode) => Promise<SpaceTreeNode[]>;
  /** 右键-删除 */
  onRequestDelete?: (node: SpaceTreeNode) => void;
  /** 右键-打开文件目录 */
  onRequestOpenDir?: (node: SpaceTreeNode) => void;
  /** 已回显的绘制 json 路径集合 */
  drawingShown?: Set<string>;
  /** 每个 JSON 文件可用的区域类型 */
  drawingAvailableTypes?: Map<string, Set<"cabinet" | "charging" | "device">>;
  /** 勾选/取消绘制 json（回显屏柜） */
  onToggleDrawing?: (path: string, checked: boolean) => void;
  /** 已回显的路径 json 集合 */
  pathShown?: Set<string>;
  /** 勾选/取消路径 json */
  onTogglePath?: (path: string, checked: boolean) => void;
  /** 地图模型的 Potree 转换状态 */
  mapPotreeStatuses?: Record<string, ProjectMapPotreeState>;
  /** 模型操作进行中，禁止地图树触发新的加载或切换 */
  modelBusy?: boolean;
  inspectionPoints?: InspectionPointItem[];
  shownInspectionPointIds?: Set<string>;
  selectedInspectionPointId?: string | null;
  onSelectInspectionPoint?: (item: InspectionPointItem) => void;
  onSetInspectionPointVisibility?: (ids: string[], visible: boolean) => void;
}

// 虚拟节点类型后缀，用于区分同一 JSON 文件的不同类型
type DrawingSubType = "cabinet" | "charging" | "device";

// 为 description_file.json 创建虚拟节点路径
function makeVirtualDrawingPath(jsonPath: string, subType: DrawingSubType): string {
  return `${jsonPath}#${subType}`;
}

// 从虚拟路径中提取实际 JSON 路径和类型
function parseVirtualDrawingPath(virtualPath: string): { jsonPath: string; subType: DrawingSubType } | null {
  const match = virtualPath.match(/^(.+)#(cabinet|charging|device)$/);
  if (!match) return null;
  return { jsonPath: match[1], subType: match[2] as DrawingSubType };
}

// 判断是否是虚拟绘制节点
function isVirtualDrawingPath(path: string): boolean {
  return /#(cabinet|charging|device)$/.test(path);
}

function requiresLoadedMap(node: SpaceTreeNode): boolean {
  return isVirtualDrawingPath(node.path)
    || isDrawingDataFileName(node.name)
    || isReferencePathFileName(node.name)
    || isRobotStopPointFileName(node.name);
}

function displayNodeName(node: SpaceTreeNode): string {
  if (node.isDir) return node.name;
  if (isLasOrLazFileName(node.name)) return "地图模型";
  if (node.name === DRAWING_FILE_NAME) return "区域";
  if (node.name === ROBOT_PATH_FILE_NAME) return "巡视路径";
  if (node.name === PATH_FILE_NAME) return "参考路径";
  // 虚拟节点显示名称
  if (isVirtualDrawingPath(node.path)) {
    const parsed = parseVirtualDrawingPath(node.path);
    if (parsed?.subType === "cabinet") return "屏柜";
    if (parsed?.subType === "charging") return "充电区域";
    if (parsed?.subType === "device") return "设备区域";
  }
  return node.name;
}

function siblingPath(filePath: string, fileName: string): string {
  return filePath.replace(/[^\\/]+$/, fileName);
}

function isRobotStopPointFileName(name: string): boolean {
  return (ROBOT_STOP_POINTS_FILE_NAMES as readonly string[]).includes(name);
}

function getNodeIcon(node: SpaceTreeNode, expanded: boolean, selected: boolean, unavailable: boolean): JSX.Element {
  const size = 14;
  const color = unavailable ? "#bfbfbf" : selected ? "#1677ff" : "#595959";
  if (node.virtualType === "inspection-root") {
    return expanded
      ? <FolderOpenOutlined style={{ color, fontSize: size }} />
      : <FolderOutlined style={{ color, fontSize: size }} />;
  }
  if (node.virtualType === "inspection-bay") {
    return expanded
      ? <FolderOpenOutlined style={{ color, fontSize: size }} />
      : <FolderOutlined style={{ color, fontSize: size }} />;
  }
  if (node.virtualType === "inspection-point") {
    return <EnvironmentOutlined style={{ color, fontSize: size }} />;
  }

  const drawingNode = parseVirtualDrawingPath(node.path);
  if (drawingNode?.subType === "cabinet") {
    return <BorderOutlined style={{ color, fontSize: size }} />;
  }
  if (drawingNode?.subType === "charging") {
    return <ThunderboltOutlined style={{ color, fontSize: size }} />;
  }
  if (drawingNode?.subType === "device") {
    return <AppstoreOutlined style={{ color, fontSize: size }} />;
  }
  if (isLasOrLazFileName(node.name)) {
    return <GlobalOutlined style={{ color, fontSize: size }} />;
  }
  if (node.name === DRAWING_FILE_NAME) {
    return expanded
      ? <FolderOpenOutlined style={{ color, fontSize: size }} />
      : <FolderOutlined style={{ color, fontSize: size }} />;
  }
  if (node.name === ROBOT_PATH_FILE_NAME) {
    return <CompassOutlined style={{ color, fontSize: size }} />;
  }
  if (node.name === PATH_FILE_NAME) {
    return <NodeIndexOutlined style={{ color, fontSize: size }} />;
  }
  if (node.isDir) {
    return expanded
      ? <FolderOpenOutlined style={{ color, fontSize: size }} />
      : <FolderOutlined style={{ color, fontSize: size }} />;
  }
  return <FileOutlined style={{ color, fontSize: size }} />;
}

function getPotreeStatusMeta(status?: ProjectMapPotreeState["status"], error?: string): { title: string; color: string; icon: JSX.Element } | null {
  switch (status) {
    case "checking":
    case "converting":
    case "validating":
      return { title: "Potree 正在转换", color: "#1677ff", icon: <LoadingOutlined spin /> };
    case "ready":
      return { title: "Potree 数据已生成", color: "#52c41a", icon: <CheckCircleOutlined /> };
    case "stale":
      return { title: "Potree 数据已过期", color: "#faad14", icon: <ClockCircleOutlined /> };
    case "error":
      return { title: error ? `Potree 转换失败：${error}` : "Potree 转换失败", color: "#ff4d4f", icon: <CloseCircleOutlined /> };
    case "missing":
      return { title: "Potree 数据未生成", color: "#8c8c8c", icon: <QuestionCircleOutlined /> };
    default:
      return null;
  }
}

export default function TreeView({ nodes, depth = 0, loadedFiles, loadingFile, onLoadLas, onToggleVisible, loadChildren, onRequestDelete, onRequestOpenDir, drawingShown, drawingAvailableTypes, onToggleDrawing, pathShown, onTogglePath, mapPotreeStatuses, modelBusy = false, inspectionPoints = [], shownInspectionPointIds = new Set(), selectedInspectionPointId = null, onSelectInspectionPoint, onSetInspectionPointVisibility }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const expandAll = (list: SpaceTreeNode[]) => {
      list.forEach((node) => {
        if (node.isDir && node.virtualType !== "inspection-root") {
          init[node.path] = true;
          if (node.children) expandAll(node.children);
        }
        // description_file.json 也默认展开
        if (!node.isDir && node.name === DRAWING_FILE_NAME) {
          init[node.path] = true;
        }
      });
    };
    expandAll(nodes);
    return init;
  });

  const [lazyChildren, setLazyChildren] = useState<Record<string, SpaceTreeNode[]>>({});
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  // 当节点变化时自动展开新目录和 description_file.json；巡检点目录常驻但默认收起。
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      const expandNew = (list: SpaceTreeNode[]) => {
        list.forEach((node) => {
          if (node.isDir && node.virtualType !== "inspection-root") {
            if (!(node.path in next)) { next[node.path] = true; changed = true; }
            if (node.children) expandNew(node.children);
          }
          // description_file.json 也自动展开
          if (!node.isDir && node.name === DRAWING_FILE_NAME) {
            if (!(node.path in next)) { next[node.path] = true; changed = true; }
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
  const isHiddenFile = (name: string) => name === MAP_INFO_FILE_NAME
    || name === NORMAL_ANNOTATIONS_FILE_NAME
    || name === INSPECTION_POINTS_FILE_NAME
    || isRobotStopPointFileName(name);
  
  const isVisibleTreeNode = (node: SpaceTreeNode) => {
    if (node.isDir) return true;
    if (isHiddenFile(node.name)) return false;
    // 如果是 description_file.json，检查是否有任何可用的区域类型
    if (node.name === DRAWING_FILE_NAME) {
      const availableTypes = drawingAvailableTypes?.get(node.path);
      // 如果已加载且为空集合，不显示
      if (availableTypes && availableTypes.size === 0) return false;
      // 未加载或有数据时显示
    }
    return true;
  };

  const uniqueByPath = (items: SpaceTreeNode[]) => {
    const seen = new Set<string>();
    const result: SpaceTreeNode[] = [];
    for (const item of items) {
      const key = loadedFileKey(item.path);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  };

  const sortPreferredModels = (items: SpaceTreeNode[]) => (
    [...items].sort((a, b) => {
      const aRank = a.name.toLowerCase() === "map.las" ? 0 : 1;
      const bRank = b.name.toLowerCase() === "map.las" ? 0 : 1;
      return aRank - bRank || a.name.localeCompare(b.name) || a.path.localeCompare(b.path);
    })
  );

  /** 合并节点自身的 children 与懒加载的 children，并为 description_file.json 注入虚拟子节点 */
  const getEffectiveChildren = (node: SpaceTreeNode): SpaceTreeNode[] | undefined => {
    // 如果是 description_file.json 文件节点，返回虚拟子节点
    if (!node.isDir && node.name === DRAWING_FILE_NAME) {
      // 获取该文件可用的类型
      const availableTypes = drawingAvailableTypes?.get(node.path);
      
      // 如果还没有加载过数据，显示所有三个类型（待检测）
      if (!availableTypes) {
        return [
          { path: makeVirtualDrawingPath(node.path, "cabinet"), name: "屏柜", isDir: false, mapContentActive: node.mapContentActive },
          { path: makeVirtualDrawingPath(node.path, "charging"), name: "充电区域", isDir: false, mapContentActive: node.mapContentActive },
          { path: makeVirtualDrawingPath(node.path, "device"), name: "设备区域", isDir: false, mapContentActive: node.mapContentActive },
        ];
      }
      
      // 已加载过数据，只显示有数据的类型
      const virtualChildren: SpaceTreeNode[] = [];
      if (availableTypes.has("cabinet")) {
        virtualChildren.push({ path: makeVirtualDrawingPath(node.path, "cabinet"), name: "屏柜", isDir: false, mapContentActive: node.mapContentActive });
      }
      if (availableTypes.has("charging")) {
        virtualChildren.push({ path: makeVirtualDrawingPath(node.path, "charging"), name: "充电区域", isDir: false, mapContentActive: node.mapContentActive });
      }
      if (availableTypes.has("device")) {
        virtualChildren.push({ path: makeVirtualDrawingPath(node.path, "device"), name: "设备区域", isDir: false, mapContentActive: node.mapContentActive });
      }
      // 已加载但没有任何类型数据时，返回空数组
      return virtualChildren;
    }
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

    // description_file.json 文件本身可展开为虚拟子节点
    if (!node.isDir && node.name === DRAWING_FILE_NAME) {
      setExpanded((prev) => ({ ...prev, [node.path]: true }));
      return;
    }

    if (node.virtualType === "inspection-root" || node.virtualType === "inspection-bay") {
      setExpanded((prev) => ({ ...prev, [node.path]: true }));
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
    if (node.virtualType === "inspection-point") {
      return { checked: !!node.inspectionPointId && shownInspectionPointIds.has(node.inspectionPointId) };
    }
    if (node.virtualType === "inspection-root" || node.virtualType === "inspection-bay") {
      const ids: string[] = [];
      const collect = (children: SpaceTreeNode[]) => children.forEach((child) => {
        if (child.inspectionPointId) ids.push(child.inspectionPointId);
        if (child.children) collect(child.children);
      });
      collect(node.children ?? []);
      if (ids.length === 0) return { checked: false };
      const selectedCount = ids.filter((id) => shownInspectionPointIds.has(id)).length;
      if (selectedCount === ids.length) return { checked: true };
      if (selectedCount > 0) return { checked: false, indeterminate: true };
      return { checked: false };
    }
    if (node.virtualType) return { checked: false };
    // 虚拟绘制节点：检查对应类型是否已显示
    if (isVirtualDrawingPath(node.path)) {
      return { checked: drawingShown?.has(node.path) || false };
    }
    // description_file.json 父节点：检查所有虚拟子节点状态
    if (!node.isDir && node.name === DRAWING_FILE_NAME) {
      const availableTypes = drawingAvailableTypes?.get(node.path);
      const types = availableTypes ? [...availableTypes] : ["cabinet", "charging", "device"] as DrawingSubType[];
      if (types.length === 0) return { checked: false };
      const childStates = types.map((type) =>
        drawingShown?.has(makeVirtualDrawingPath(node.path, type as DrawingSubType)) || false
      );
      const allChecked = childStates.every((s) => s);
      const someChecked = childStates.some((s) => s);
      if (allChecked) return { checked: true };
      if (someChecked) return { checked: false, indeterminate: true };
      return { checked: false };
    }
    if (node.isDir) {
      const children = getEffectiveChildren(node);
      if (!children || children.length === 0) return { checked: false };
      const isMapDirectory = children.some((child) => !child.isDir && isLas(child.name));
      const relevantChildren = isMapDirectory
        ? children.filter((child) => isVisibleTreeNode(child)
          && (isLas(child.name)
            || (isDrawing(child.name) && (drawingAvailableTypes?.get(child.path)?.size ?? 1) > 0)
            || isPath(child.name)
            || (child.virtualType === "inspection-root" && (child.children?.length ?? 0) > 0)))
        : children.filter((child) => !child.virtualType && isVisibleTreeNode(child) && !isDrawing(child.name) && !isPath(child.name));
      const states = relevantChildren.map(getCheckState);
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
    if (modelBusy) return;
    if (requiresLoadedMap(node) && node.mapContentActive === false) return;
    if ((node.virtualType === "inspection-root" || node.virtualType === "inspection-bay" || node.virtualType === "inspection-point")
      && !node.inspectionMapActive) return;
    if (node.virtualType === "inspection-point") {
      if (node.inspectionPointId) onSetInspectionPointVisibility?.([node.inspectionPointId], checked);
      return;
    }
    if (node.virtualType === "inspection-root" || node.virtualType === "inspection-bay") {
      const ids: string[] = [];
      const collect = (children: SpaceTreeNode[]) => children.forEach((child) => {
        if (child.inspectionPointId) ids.push(child.inspectionPointId);
        if (child.children) collect(child.children);
      });
      collect(node.children ?? []);
      onSetInspectionPointVisibility?.(ids, checked);
      return;
    }
    if (node.virtualType) return;
    // 虚拟绘制节点：直接调用回调
    if (isVirtualDrawingPath(node.path)) {
      onToggleDrawing?.(node.path, checked);
      return;
    }
    // description_file.json 父节点：需要根据加载状态处理
    if (!node.isDir && node.name === DRAWING_FILE_NAME) {
      const availableTypes = drawingAvailableTypes?.get(node.path);
      
      if (checked) {
        // 如果还未加载过，先加载完整数据以检测类型（会自动触发子类型加载）
        if (!availableTypes) {
          onToggleDrawing?.(node.path, true);
          return;
        }
        // 已知类型，加载所有有数据的类型
        availableTypes.forEach((type) => {
          onToggleDrawing?.(makeVirtualDrawingPath(node.path, type as DrawingSubType), true);
        });
      } else {
        // 取消勾选：取消所有可能的类型（包括已加载和未加载的）
        ["cabinet", "charging", "device"].forEach((type) => {
          onToggleDrawing?.(makeVirtualDrawingPath(node.path, type as DrawingSubType), false);
        });
      }
      return;
    }
    if (node.isDir) {
      const children = getEffectiveChildren(node);
      if (!children) return;
      const recurse = async (list: SpaceTreeNode[]) => {
        const lasNodes: SpaceTreeNode[] = [];
        const drawNodes: SpaceTreeNode[] = [];
        const pathNodes: SpaceTreeNode[] = [];
        const inspectionPointIds: string[] = [];
        const collect = (items: SpaceTreeNode[]) => {
          items.forEach((child) => {
            if (child.inspectionPointId) inspectionPointIds.push(child.inspectionPointId);
            if (!child.isDir && isHiddenFile(child.name)) {
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
            }
          });
        };
        collect(list);

        const uniqueLasNodes = sortPreferredModels(uniqueByPath(lasNodes));
        const lasNodesToApply = checked ? uniqueLasNodes.slice(0, 1) : uniqueLasNodes;
        let loadedAllContents = false;

        for (const child of lasNodesToApply) {
          const fileKey = loadedFileKey(child.path);
          const isLoaded = loadedFiles.has(loadedFileKey(child.path));
          if (checked) {
            if (!isLoaded && loadingFile !== fileKey) {
              await onLoadLas?.(child.path, true);
              loadedAllContents = true;
            }
          } else {
            if (isLoaded) onToggleVisible?.(child.path);
          }
        }

        if (checked && loadedAllContents) return;

        for (const child of uniqueByPath(drawNodes)) {
          // 对每个 description_file.json 勾选所有虚拟子节点
          ["cabinet", "charging", "device"].forEach((type) => {
            onToggleDrawing?.(makeVirtualDrawingPath(child.path, type as DrawingSubType), checked);
          });
        }

        for (const child of uniqueByPath(pathNodes)) {
          onTogglePath?.(child.path, checked);
        }
        if (inspectionPointIds.length > 0) {
          onSetInspectionPointVisibility?.([...new Set(inspectionPointIds)], checked);
        }
      };
      recurse(children);
    } else if (isDrawing(node.name)) {
      // 旧的直接 JSON 节点处理（兼容）
      onToggleDrawing?.(node.path, checked);
    } else if (isPath(node.name)) {
      onTogglePath?.(node.path, checked);
    } else if (isRobotStopPointFileName(node.name)) {
      onTogglePath?.(siblingPath(node.path, ROBOT_PATH_FILE_NAME), checked);
    } else if (isLas(node.name)) {
      const isLoaded = loadedFiles.has(loadedFileKey(node.path));
      const isLoading = loadingFile === loadedFileKey(node.path);
      if (checked) {
        if (!isLoaded && !isLoading) onLoadLas?.(node.path);
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
        const nodeFileKey = loadedFileKey(node.path);
        const modelStatus = !node.isDir && isLas(node.name) ? mapPotreeStatuses?.[nodeFileKey] : undefined;
        const statusMeta = !node.isDir && isLas(node.name) && loadingFile !== nodeFileKey
          ? getPotreeStatusMeta(modelStatus?.status, modelStatus?.error)
          : null;
        const menuItems = [
          { key: "openDir", label: "打开文件目录" },
          { key: "delete", label: modelBusy ? "模型处理中，暂不可删除" : "删除", danger: true, disabled: modelBusy },
        ];
        const onMenuClick = (info: { key: string }) => {
          if (info.key === "openDir") onRequestOpenDir?.(node);
          else if (info.key === "delete") onRequestDelete?.(node);
        };
        // 虚拟节点不显示右键菜单
        const enableContextMenu = !isVirtualDrawingPath(node.path) && !node.virtualType;
        const inspectionPoint = node.virtualType === "inspection-point" && node.inspectionMapActive && !modelBusy
          ? inspectionPoints.find((item) => item.id === node.inspectionPointId) ?? null
          : null;
        const inspectionCheckable = node.virtualType === "inspection-root" || node.virtualType === "inspection-bay" || node.virtualType === "inspection-point";
        const inspectionRootEmpty = node.virtualType === "inspection-root" && (node.children?.length ?? 0) === 0;
        const inspectionUnavailable = inspectionCheckable && !node.inspectionMapActive;
        const mapContentUnavailable = requiresLoadedMap(node) && node.mapContentActive === false;
        const checkUnavailable = inspectionUnavailable || mapContentUnavailable;

        // 节点内容渲染
        const nodeContent = (
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
            {node.isDir || (node.name === DRAWING_FILE_NAME) ? (
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
            {node.virtualType && !inspectionCheckable ? <span style={{ width: 14, flexShrink: 0 }} /> : (
              <input
                type="checkbox"
                checked={state.checked}
                disabled={modelBusy || inspectionRootEmpty || checkUnavailable}
                ref={(el) => {
                  if (el) el.indeterminate = state.indeterminate || false;
                }}
                title={checkUnavailable ? "请先加载当前地图" : undefined}
                style={{ width: 14, height: 14, cursor: modelBusy || inspectionRootEmpty || checkUnavailable ? "not-allowed" : "pointer", flexShrink: 0 }}
                onChange={(e) => {
                  e.stopPropagation();
                  handleCheck(node, e.target.checked);
                }}
              />
            )}

            {getNodeIcon(
              node,
              !!expanded[node.path],
              inspectionPoint?.id === selectedInspectionPointId,
              checkUnavailable,
            )}
            <span
              title={node.name}
              style={{ marginLeft: 2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: inspectionPoint ? "pointer" : "default", color: inspectionPoint?.id === selectedInspectionPointId ? "#1677ff" : undefined, fontWeight: inspectionPoint?.id === selectedInspectionPointId ? 600 : undefined }}
              onClick={() => { if (inspectionPoint) onSelectInspectionPoint?.(inspectionPoint); }}
            >
              {displayNodeName(node)}
            </span>
            {statusMeta && (
              <span
                title={statusMeta.title}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  color: statusMeta.color,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {statusMeta.icon}
              </span>
            )}
            {!node.isDir && isLas(node.name) && loadingFile === nodeFileKey && (
              <LoadingOutlined style={{ color: "#1677ff", fontSize: 14, flexShrink: 0 }} />
            )}
          </div>
        );

        return (
          <div key={node.path}>
            {enableContextMenu ? (
              <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={["contextMenu"]}>
                {nodeContent}
              </Dropdown>
            ) : (
              nodeContent
            )}
            {/* 目录或 description_file.json 的虚拟子节点可展开 */}
            {(node.isDir || node.name === DRAWING_FILE_NAME) && effectiveChildren && expanded[node.path] && (
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
                drawingAvailableTypes={drawingAvailableTypes}
                onToggleDrawing={onToggleDrawing}
                pathShown={pathShown}
                onTogglePath={onTogglePath}
                mapPotreeStatuses={mapPotreeStatuses}
                modelBusy={modelBusy}
                inspectionPoints={inspectionPoints}
                shownInspectionPointIds={shownInspectionPointIds}
                selectedInspectionPointId={selectedInspectionPointId}
                onSelectInspectionPoint={onSelectInspectionPoint}
                onSetInspectionPointVisibility={onSetInspectionPointVisibility}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

export type { SpaceTreeNode as TreeNode };
