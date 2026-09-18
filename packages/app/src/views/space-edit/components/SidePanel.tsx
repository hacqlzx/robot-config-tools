import React, { useState, useEffect, useCallback, useRef } from "react";
import { Tree, Modal, message } from "antd";
import type { TreeProps, TreeDataNode } from "antd";
import TreeView from "./TreeView";
import DeviceTree from "@/components/DeviceTree";
import type { DevicePoint } from "@robot/database";
import {
  deleteCabinetDevicesFromJson,
  INSPECTION_POINTS_FILE_NAME,
  isDrawingDataFileName,
  isReferencePathFileName,
  loadInspectionPoints,
} from "../hooks/drawing/drawing-storage";
import type { SpaceTreeNode } from "../types";
import type { InspectionPointItem } from "../hooks/drawing/drawing-schema";
import { MAP_DIR_NAME, isLasOrLazFileName, loadedFileKey } from "../utils/space-paths";
import { useSelectedProject } from "@/stores/appContextStore";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 260;
const MAIN_DEVICE_TYPE_CABINET = 29;

interface Props {
  panelWidth: number;
  onLoadLas?: (filePath: string, loadAllContents?: boolean) => Promise<void>;
  onToggleVisible?: (filePath: string) => void;
  onUnloadMapFile?: (filePath: string) => Promise<boolean>;
  loadedFiles: Set<string>;
  treeKey: number;
  loadingFile: string;
  /** 已回显的绘制 json 路径集合 */
  mapDrawingShown?: Set<string>;
  /** 每个 JSON 文件可用的区域类型 */
  mapDrawingAvailableTypes?: Map<string, Set<"cabinet" | "charging" | "device">>;
  /** 勾选/取消地图树里的绘制 json（回显屏柜） */
  onToggleDrawing?: (path: string, checked: boolean) => void;
  /** 删除区域文件中的指定区域类型 */
  onDeleteDrawingType?: (path: string, type: DrawingSubType) => Promise<void>;
  /** 已回显的路径 json 集合 */
  mapPathShown?: Set<string>;
  /** 勾选/取消可行驶路径 json */
  onTogglePath?: (path: string, checked: boolean) => void;
  /** 模型操作进行中，禁止地图树触发新的加载或删除 */
  modelBusy?: boolean;
  /** 地图树加载完成后的回调，用于扫描区域文件 */
  onMapTreeLoaded?: (nodes: SpaceTreeNode[]) => void;
  activeModelPath?: string | null;
  inspectionPoints?: InspectionPointItem[];
  shownInspectionPointIds?: Set<string>;
  selectedInspectionPointId?: string | null;
  onSelectInspectionPoint?: (item: InspectionPointItem) => void;
  onSetInspectionPointVisibility?: (ids: string[], visible: boolean) => void;
}

type DrawingSubType = "cabinet" | "charging" | "device";

function parseVirtualDrawingPath(path: string): { filePath: string; type: DrawingSubType } | null {
  const match = path.match(/^(.+)#(cabinet|charging|device)$/);
  return match ? { filePath: match[1], type: match[2] as DrawingSubType } : null;
}

function drawingTypeLabel(type: DrawingSubType): string {
  if (type === "cabinet") return "屏柜";
  if (type === "charging") return "充电区域";
  return "设备区域";
}

const TABS = [
  { key: "map", label: "地图" },
  { key: "device", label: "巡检点" },
  { key: "cabinet", label: "屏柜" },
  { key: "deviceArea", label: "设备区" },
];

function isDirectMapDirNode(node: SpaceTreeNode): boolean {
  if (!node.isDir) return false;
  const parts = node.path.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 && parts[parts.length - 2] === MAP_DIR_NAME;
}

function parentPath(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function normalizedPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function normalizePointCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function pointBayKey(point: Pick<DevicePoint, "bayId" | "bayCode" | "bayName">): string {
  const code = String(point.bayCode || "").trim();
  if (code) return `code:${code}`;
  const id = Number(point.bayId);
  if (Number.isFinite(id) && id > 0) return `id:${id}`;
  const name = String(point.bayName || "").trim();
  return name ? `name:${name}` : "unassigned";
}

function pointBayName(point: Pick<DevicePoint, "bayId" | "bayCode" | "bayName">): string {
  return String(point.bayName || point.bayCode || (Number(point.bayId) > 0 ? `间隔 ${point.bayId}` : "未分配间隔")).trim();
}

function collectInspectionPointFiles(nodes: SpaceTreeNode[]): Array<{ mapDir: string; filePath: string | null }> {
  const result: Array<{ mapDir: string; filePath: string | null }> = [];
  const walk = (items: SpaceTreeNode[]) => {
    items.forEach((node) => {
      if (isDirectMapDirNode(node)) {
        const file = node.children?.find((child) => !child.isDir && child.name === INSPECTION_POINTS_FILE_NAME);
        result.push({ mapDir: normalizedPath(node.path), filePath: file?.path ?? null });
        return;
      }
      if (node.children) walk(node.children);
    });
  };
  walk(nodes);
  return result;
}

function setMapContentActive(nodes: SpaceTreeNode[], active: boolean): SpaceTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    mapContentActive: active,
    children: node.children ? setMapContentActive(node.children, active) : node.children,
  }));
}

function injectInspectionPointTree(
  nodes: SpaceTreeNode[],
  activeModelPath: string | null | undefined,
  activeItems: InspectionPointItem[],
  storedItemsByMap: Map<string, InspectionPointItem[]>,
  pointBayByCode: Map<string, { key: string; name: string }>,
): SpaceTreeNode[] {
  const activeDir = activeModelPath ? parentPath(activeModelPath) : null;
  return nodes.map((node) => {
    const children = node.children
      ? injectInspectionPointTree(node.children, activeModelPath, activeItems, storedItemsByMap, pointBayByCode)
      : node.children;
    if (!isDirectMapDirNode(node)) return children === node.children ? node : { ...node, children };
    const mapDir = normalizedPath(node.path);
    const isActiveMap = !!activeDir && mapDir === activeDir;
    const inspectionItems = isActiveMap ? activeItems : storedItemsByMap.get(mapDir) ?? [];
    const mapChildren = setMapContentActive(children ?? [], isActiveMap);
    if (inspectionItems.length === 0) {
      return { ...node, mapContentActive: isActiveMap, children: mapChildren };
    }
    const groups = new Map<string, { name: string; items: InspectionPointItem[] }>();
    inspectionItems.forEach((item) => {
      const bay = item.pointCode ? pointBayByCode.get(normalizePointCode(item.pointCode)) : undefined;
      const key = bay?.key || "unassigned";
      const name = bay?.name || "未分配间隔";
      const group = groups.get(key) || { name, items: [] };
      group.items.push(item);
      groups.set(key, group);
    });
    const inspectionBays = [...groups.entries()]
      .sort((left, right) => left[1].name.localeCompare(right[1].name, "zh-Hans-CN", { numeric: true }))
      .map(([bayKey, group]) => ({
        name: group.name,
        path: `${node.path}#inspection-bay:${encodeURIComponent(bayKey)}`,
        isDir: true,
        virtualType: "inspection-bay" as const,
        inspectionBayKey: bayKey,
        inspectionMapActive: isActiveMap,
        mapContentActive: isActiveMap,
        children: group.items.map((item, index) => ({
          name: item.name?.trim() || `巡检点 ${index + 1}`,
          path: `${node.path}#inspection-point:${item.id}`,
          isDir: false,
          virtualType: "inspection-point" as const,
          inspectionPointId: item.id,
          inspectionBayKey: bayKey,
          inspectionMapActive: isActiveMap,
          mapContentActive: isActiveMap,
        })),
      }));
    const inspectionRoot: SpaceTreeNode = {
      name: `巡检点 (${inspectionItems.length})`,
      path: `${node.path}#inspection-points`,
      isDir: true,
      virtualType: "inspection-root",
      inspectionMapActive: isActiveMap,
      mapContentActive: isActiveMap,
      children: inspectionBays,
    };
    return { ...node, mapContentActive: isActiveMap, children: [...mapChildren, inspectionRoot] };
  });
}

type DeleteStage = "unload" | "database" | "filesystem";

function deleteErrorMessage(error: unknown, isMapDir: boolean, stage: DeleteStage): string {
  const raw = (error instanceof Error ? error.message : String(error ?? ""))
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  if (stage === "database") {
    const target = isMapDir ? "地图关联的屏柜和点位数据" : "区域关联的屏柜和点位数据";
    return `无法清理${target}，文件尚未删除。请重试；如持续失败，请重启应用后再操作。`;
  }
  if (/EBUSY|EPERM|EACCES|permission|access is denied|文件.*占用|拒绝访问/i.test(raw)) {
    return `${isMapDir ? "地图目录" : "文件"}正在被占用或没有访问权限，请关闭相关程序后重试。`;
  }
  if (/ENOENT|not found|文件不存在/i.test(raw)) {
    return "目标已不存在，地图列表已刷新。";
  }
  if (stage === "unload") {
    return "无法卸载当前地图，已停止删除。请稍后重试。";
  }
  return isMapDir ? "地图目录删除失败，请稍后重试。" : "删除失败，请稍后重试。";
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

/** 屏柜树：电压 → 屏柜区间隔 → 主设备屏柜 */
function buildCabinetMainDeviceTree(voltList: any[], bayList: any[], mainList: any[]): TreeDataNode[] {
  const cabinetsByBay = new Map<number, any[]>();
  mainList
    .filter((main) => Number(main.mainDeviceType) === MAIN_DEVICE_TYPE_CABINET)
    .forEach((main) => {
      const bayId = Number(main.bayId);
      if (!Number.isFinite(bayId) || bayId <= 0) return;
      const items = cabinetsByBay.get(bayId) || [];
      items.push(main);
      cabinetsByBay.set(bayId, items);
    });

  return voltList
    .map((volt) => {
      const bayNodes = bayList
        .filter((bay) => Number(bay.voltId) === Number(volt.id) && String(bay.bayType || "").trim() === "屏柜区")
        .map<TreeDataNode>((bay) => {
          const mains = (cabinetsByBay.get(Number(bay.id)) || [])
            .sort((a, b) => Number(a.sortNum || 0) - Number(b.sortNum || 0) || Number(a.id || 0) - Number(b.id || 0));
          return {
            key: `bay/${bay.id}`,
            title: bay.bayName || "(未命名间隔)",
            isLeaf: mains.length === 0,
            children: mains.length > 0
              ? mains.map((main) => ({
                key: `main/${main.id}/bay/${bay.id}`,
                title: main.mainDeviceName || main.mainDeviceCode || "(未命名主设备)",
                isLeaf: true,
              }))
              : undefined,
          };
        });
      if (bayNodes.length === 0) return null;
      return {
        key: `volt/${volt.id}`,
        title: volt.voltName || "(未命名区域)",
        children: bayNodes,
      };
    })
    .filter(Boolean) as TreeDataNode[];
}

function collectTreeKeys(nodes: TreeDataNode[]): Set<React.Key> {
  const keys = new Set<React.Key>();
  const visit = (items: TreeDataNode[]) => items.forEach((item) => {
    keys.add(item.key);
    if (item.children) visit(item.children);
  });
  visit(nodes);
  return keys;
}

function normalizeRootPath(rootPath: string): string {
  return rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function buildMapPotreeStatuses(projectRoot: string, manifest: ProjectManifest): Record<string, ProjectMapPotreeState> {
  const root = normalizeRootPath(projectRoot);
  if (!root) return {};

  const statuses: Record<string, ProjectMapPotreeState> = {};
  manifest.assets.maps.forEach((asset) => {
    const sourceRelativePath = String(asset.entryFile || "").replace(/\\/g, "/");
    if (!sourceRelativePath) return;
    const mapRelativePath = String(asset.relativePath || "").replace(/\\/g, "/");
    const outputRelativePath = `${mapRelativePath}/.potree`;
    const metadataRelativePath = `${outputRelativePath}/metadata.json`;
    const key = loadedFileKey(`${root}/${sourceRelativePath}`);
    statuses[key] = asset.potree || {
      status: "missing",
      outputRelativePath,
      metadataRelativePath,
      updatedAt: asset.updatedAt,
    };
  });
  return statuses;
}

const TREE_CSS = `
  .side-tree .ant-tree-treenode { white-space: nowrap; }
  .side-tree .ant-tree-node-content-wrapper { overflow: hidden; flex: 1; min-width: 0; }
  .side-tree .ant-tree-title { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .side-tree .ant-tree-indent-unit { width: 14px; }
  .side-tree .ant-tree-switcher { width: 16px; flex-shrink: 0; }
`;

export default function SidePanel({ panelWidth, onLoadLas, onToggleVisible, onUnloadMapFile, loadedFiles, treeKey, loadingFile, mapDrawingShown, mapDrawingAvailableTypes, onToggleDrawing, onDeleteDrawingType, mapPathShown, onTogglePath, modelBusy = false, onMapTreeLoaded, activeModelPath, inspectionPoints = [], shownInspectionPointIds = new Set(), selectedInspectionPointId = null, onSelectInspectionPoint, onSetInspectionPointVisibility }: Props) {
  const selectedProject = useSelectedProject();
  const [sideTab, setSideTab] = useState("map");
  const [mapTreeData, setMapTreeData] = useState<SpaceTreeNode[]>([]);
  const [storedInspectionPointsByMap, setStoredInspectionPointsByMap] = useState<Map<string, InspectionPointItem[]>>(new Map());
  const [pointBayByCode, setPointBayByCode] = useState<Map<string, { key: string; name: string }>>(new Map());
  const [mapPotreeStatuses, setMapPotreeStatuses] = useState<Record<string, ProjectMapPotreeState>>({});
  const [cabinetTreeData, setCabinetTreeData] = useState<TreeDataNode[]>([]);
  const [cabinetSelectedKeys, setCabinetSelectedKeys] = useState<React.Key[]>([]);
  const [deviceAreaTreeData, setDeviceAreaTreeData] = useState<TreeDataNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const mapTreeRequestVersion = useRef(0);
  const cabinetTreeRequestVersion = useRef(0);
  const deleteLockedRef = useRef(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const renderedMapTreeData = React.useMemo(
    () => injectInspectionPointTree(mapTreeData, activeModelPath, inspectionPoints, storedInspectionPointsByMap, pointBayByCode),
    [activeModelPath, inspectionPoints, mapTreeData, pointBayByCode, storedInspectionPointsByMap],
  );

  const loadMapTree = useCallback(async () => {
    const requestVersion = ++mapTreeRequestVersion.current;
    if (!selectedProject || !window.electronAPI) {
      setMapTreeData([]);
      setMapPotreeStatuses({});
      setStoredInspectionPointsByMap(new Map());
      return;
    }
    try {
      const api = window.electronAPI;
      const [nodes, manifest, projectRoot] = await Promise.all([
        api.project.listTree(selectedProject, MAP_DIR_NAME),
        api.project.getManifest(selectedProject),
        api.getProjectRoot(),
      ]);
      const inspectionEntries = await Promise.all(
        collectInspectionPointFiles(nodes).map(async ({ mapDir, filePath }) => [
          mapDir,
          filePath ? await loadInspectionPoints(api, filePath) : [],
        ] as const),
      );
      if (requestVersion !== mapTreeRequestVersion.current) return;
      setMapTreeData(nodes);
      setMapPotreeStatuses(buildMapPotreeStatuses(projectRoot || "", manifest));
      setStoredInspectionPointsByMap(new Map(inspectionEntries));
      // 通知 workspace 扫描区域文件
      onMapTreeLoaded?.(nodes);
    } catch {
      if (requestVersion !== mapTreeRequestVersion.current) return;
      setMapTreeData([]);
      setMapPotreeStatuses({});
      setStoredInspectionPointsByMap(new Map());
    }
  }, [selectedProject, onMapTreeLoaded]);

  useEffect(() => {
    let cancelled = false;
    const api = window.electronAPI;
    if (!selectedProject || !api?.db?.point) {
      setPointBayByCode(new Map());
      return () => { cancelled = true; };
    }
    api.db.point.list(selectedProject)
      .then((points) => {
        if (cancelled) return;
        const bayMap = new Map<string, { key: string; name: string }>();
        (points as DevicePoint[]).forEach((point) => {
          const code = normalizePointCode(point.pointCode);
          if (code) bayMap.set(code, { key: pointBayKey(point), name: pointBayName(point) });
        });
        setPointBayByCode(bayMap);
      })
      .catch(() => { if (!cancelled) setPointBayByCode(new Map()); });
    return () => { cancelled = true; };
  }, [selectedProject, treeKey]);

  const loadBayTypeTree = useCallback(async (bayType: string, setter: React.Dispatch<React.SetStateAction<TreeDataNode[]>>) => {
    if (!selectedProject || !window.electronAPI) {
      setter([]);
      return;
    }
    setTreeLoading(true);
    try {
      const api = window.electronAPI;
      const [voltList, bayList] = await Promise.all([
        api.db.voltage.list(selectedProject),
        api.db.bay.list(selectedProject),
      ]);
      setter(buildBayTypeTree(voltList, bayList, bayType));
    } catch {
      setter([]);
    } finally {
      setTreeLoading(false);
    }
  }, [selectedProject]);

  const loadCabinetTree = useCallback(async () => {
    const requestVersion = ++cabinetTreeRequestVersion.current;
    if (!selectedProject || !window.electronAPI) {
      setCabinetTreeData([]);
      setCabinetSelectedKeys([]);
      return;
    }
    setTreeLoading(true);
    try {
      const api = window.electronAPI;
      const [voltList, bayList, mainList] = await Promise.all([
        api.db.voltage.list(selectedProject),
        api.db.bay.list(selectedProject),
        api.db.mainDevice.list(selectedProject),
      ]);
      if (requestVersion !== cabinetTreeRequestVersion.current) return;
      const nextTree = buildCabinetMainDeviceTree(voltList || [], bayList || [], mainList || []);
      const nextKeys = collectTreeKeys(nextTree);
      setCabinetTreeData(nextTree);
      setCabinetSelectedKeys((current) => current.filter((key) => nextKeys.has(key)));
    } catch {
      if (requestVersion !== cabinetTreeRequestVersion.current) return;
      setCabinetTreeData([]);
      setCabinetSelectedKeys([]);
    } finally {
      if (requestVersion === cabinetTreeRequestVersion.current) setTreeLoading(false);
    }
  }, [selectedProject]);

  const handleCabinetTreeSelect: TreeProps["onSelect"] = useCallback((selectedKeys) => {
    // 屏柜树使用 Tree 默认的单选节点模式，避免复选框级联产生多选结果。
    const keys = selectedKeys.slice(-1);
    setCabinetSelectedKeys(keys);
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
      loadCabinetTree();
    }
  }, [sideTab, treeKey, loadCabinetTree]);

  useEffect(() => {
    if (sideTab === "deviceArea") {
      loadBayTypeTree("设备区", setDeviceAreaTreeData);
    }
  }, [sideTab, treeKey, loadBayTypeTree]);

  /** 右键-打开文件目录 */
  const handleRequestOpenDir = useCallback((node: SpaceTreeNode) => {
    window.electronAPI?.project.openDir(node.path);
  }, []);

  /** 右键-删除：直接删除文件/目录并刷新地图树 */
  const handleRequestDelete = useCallback((node: SpaceTreeNode) => {
    if (modelBusy) {
      message.info({ key: "space-model-busy", content: "模型正在处理中，请稍后再试" });
      return;
    }
    if (deleteLockedRef.current) {
      message.info({ key: "space-map-delete-busy", content: "正在处理另一项删除，请稍后再试" });
      return;
    }
    deleteLockedRef.current = true;
    setDeletingPath(node.path);
    const drawingType = parseVirtualDrawingPath(node.path);
    const isMapDir = isDirectMapDirNode(node);
    Modal.confirm({
      title: "删除确认",
      content: drawingType
        ? `确定删除该地图中的全部${drawingTypeLabel(drawingType.type)}？此操作不可恢复。`
        : isMapDir
        ? `确定删除地图「${node.name}」？将同步清理该地图的屏柜及关联点位、勘察图片和图像标识，且不可恢复。`
        : `确定删除「${node.name}」？`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      afterClose: () => {
        deleteLockedRef.current = false;
        setDeletingPath(null);
      },
      onOk: async () => {
        if (drawingType) {
          const label = drawingTypeLabel(drawingType.type);
          try {
            if (!onDeleteDrawingType) throw new Error("区域删除服务不可用");
            await onDeleteDrawingType(drawingType.filePath, drawingType.type);
            message.success(`${label}已删除`);
            await loadMapTree();
          } catch (error) {
            console.error("[地图树区域删除] 删除失败", { ...drawingType, error });
            message.error(`删除${label}失败：${error instanceof Error ? error.message : String(error)}`);
            await loadMapTree();
          }
          return;
        }
        let stage: DeleteStage = "unload";
        try {
          // 删除前先完成模型卸载，再清除绘制和路径回显（含子目录）。
          const loadedModelFiles: string[] = [];
          const drawingFiles: string[] = [];
          const walkClear = (n: SpaceTreeNode) => {
            if (!n.isDir && isLasOrLazFileName(n.name) && loadedFiles.has(loadedFileKey(n.path))) loadedModelFiles.push(n.path);
            else if (isDrawingDataFileName(n.name)) drawingFiles.push(n.path);
            n.children?.forEach(walkClear);
          };
          walkClear(node);

          for (const modelPath of loadedModelFiles) {
            const unloaded = await onUnloadMapFile?.(modelPath);
            if (unloaded === false) {
              message.info("已取消删除地图");
              return;
            }
          }

          const clearOverlays = (n: SpaceTreeNode) => {
            if (isDrawingDataFileName(n.name)) onToggleDrawing?.(n.path, false);
            else if (isReferencePathFileName(n.name)) onTogglePath?.(n.path, false);
            n.children?.forEach(clearOverlays);
          };
          clearOverlays(node);

          const api = window.electronAPI;
          if (!api?.project) throw new Error("项目文件服务不可用");
          stage = "database";
          if (selectedProject && api) {
            for (const jsonPath of drawingFiles) {
              await deleteCabinetDevicesFromJson(api, selectedProject, jsonPath);
            }
          }
          stage = "filesystem";
          await api.project.deletePath(node.path);
          message.success(isMapDir ? "地图已删除，关联数据已同步清理" : "已删除");
          await loadMapTree();
        } catch (error: unknown) {
          console.error("[地图树删除] 删除失败", { path: node.path, isMapDir, stage, error });
          message.error(deleteErrorMessage(error, isMapDir, stage));
          await loadMapTree();
        }
      },
    });
  }, [loadMapTree, loadedFiles, modelBusy, onDeleteDrawingType, onToggleDrawing, onTogglePath, onUnloadMapFile, selectedProject]);

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
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8 }}>
          {sideTab === "map" ? (
            renderedMapTreeData.length === 0 ? (
              <div style={{ color: "#999", textAlign: "center", padding: 16, fontSize: 12 }}>暂无数据</div>
            ) : (
              <TreeView
                nodes={renderedMapTreeData}
                loadedFiles={loadedFiles}
                loadingFile={loadingFile}
                onLoadLas={onLoadLas}
                onToggleVisible={onToggleVisible}
                onRequestDelete={handleRequestDelete}
                onRequestOpenDir={handleRequestOpenDir}
                drawingShown={mapDrawingShown}
                drawingAvailableTypes={mapDrawingAvailableTypes}
                onToggleDrawing={onToggleDrawing}
                pathShown={mapPathShown}
                onTogglePath={onTogglePath}
                mapPotreeStatuses={mapPotreeStatuses}
                modelBusy={modelBusy || deletingPath !== null}
                inspectionPoints={inspectionPoints}
                shownInspectionPointIds={shownInspectionPointIds}
                selectedInspectionPointId={selectedInspectionPointId}
                onSelectInspectionPoint={onSelectInspectionPoint}
                onSetInspectionPointVisibility={onSetInspectionPointVisibility}
              />
            )
          ) : sideTab === "device" ? (
            <div className="side-tree">
              <DeviceTree key={treeKey} defaultExpandLevel={3} />
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
                  multiple={false}
                  selectedKeys={cabinetSelectedKeys}
                  onSelect={handleCabinetTreeSelect}
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
    </>
  );
}
