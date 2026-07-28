import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Segmented, Space, Spin, Tree, Tooltip } from "antd";
import type { MenuProps, TreeDataNode, TreeProps } from "antd";
import {
  AimOutlined,
  CloudSyncOutlined,
  DownOutlined,
  FileImageOutlined,
  PushpinOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useLocation } from "react-router-dom";
import { useResizable } from "@/components/useResizable";
import { useSelectedProject } from "@/stores/appContextStore";
import VerificationImageCanvas from "./components/VerificationImageCanvas";
import "./index.scss";

interface VerificationTreeNode extends TreeDataNode {
  key: string;
  title: string;
  code: string;
  kind: DeviceVerificationNodeKind;
  hasImage: boolean;
  marked: boolean;
  children?: VerificationTreeNode[];
}

interface SelectedPoint {
  key: string;
  title: string;
  code: string;
  hasImage: boolean;
}

type VerificationImportMode = "zip" | "directory";
type PointMarkFilter = "all" | "marked" | "unmarked";

const markFilterOptions: { label: string; value: PointMarkFilter }[] = [
  { label: "全部", value: "all" },
  { label: "已标记", value: "marked" },
  { label: "未标记", value: "unmarked" },
];

function updateTreeChildren(
  nodes: VerificationTreeNode[],
  targetKey: string,
  children: VerificationTreeNode[],
): VerificationTreeNode[] {
  return nodes.map((node) => {
    if (node.key === targetKey) return { ...node, children };
    if (!node.children) return node;
    return { ...node, children: updateTreeChildren(node.children, targetKey, children) };
  });
}

function updateTreePointMarked(
  nodes: VerificationTreeNode[],
  targetKey: string,
  marked: boolean,
): VerificationTreeNode[] {
  return nodes.map((node) => {
    const nextNode = node.key === targetKey && node.kind === "point"
      ? { ...node, marked, className: marked ? "device-verify-tree-node-marked" : undefined }
      : node;
    if (!nextNode.children) return nextNode;
    return { ...nextNode, children: updateTreePointMarked(nextNode.children, targetKey, marked) };
  });
}

function filterTreeByMark(nodes: VerificationTreeNode[], filter: PointMarkFilter): VerificationTreeNode[] {
  if (filter === "all") return nodes;

  const walk = (node: VerificationTreeNode): VerificationTreeNode | null => {
    if (node.kind === "point") {
      const matched = filter === "marked" ? node.marked : !node.marked;
      return matched ? node : null;
    }

    const children = (node.children || [])
      .map(walk)
      .filter((child): child is VerificationTreeNode => Boolean(child));
    return children.length > 0 ? { ...node, children } : null;
  };

  return nodes
    .map(walk)
    .filter((node): node is VerificationTreeNode => Boolean(node));
}

function toTreeNode(node: DeviceVerificationTreeNode): VerificationTreeNode {
  return {
    ...node,
    marked: Boolean(node.marked),
    className: node.kind === "point" && node.marked ? "device-verify-tree-node-marked" : undefined,
    children: node.children?.map(toTreeNode),
  };
}

function collectExpandedKeys(nodes: VerificationTreeNode[]): React.Key[] {
  const keys: React.Key[] = [];
  const walk = (node: VerificationTreeNode) => {
    if (!node.isLeaf && node.children && node.children.length > 0) keys.push(node.key);
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return keys;
}

export default function DeviceVerify() {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCacheRef = useRef(new Map<string, string>());
  const imageRequestRef = useRef(0);
  const correctionRequestRef = useRef(0);
  const autoLoadingRef = useRef(false);
  const autoLoadRequestRef = useRef(0);
  const autoLoadActiveRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const [sessionId, setSessionId] = useState("");
  const [packageName, setPackageName] = useState("");
  const [treeData, setTreeData] = useState<VerificationTreeNode[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [loadingPackage, setLoadingPackage] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [exportingCorrectionData, setExportingCorrectionData] = useState(false);
  const [exportingMarkedPoints, setExportingMarkedPoints] = useState(false);
  const [markFilter, setMarkFilter] = useState<PointMarkFilter>("all");
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionRect, setCorrectionRect] = useState<DeviceCorrectionRect | null>(null);
  const [savingCorrection, setSavingCorrection] = useState(false);

  const { width: leftWidth, onMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.3,
    minWidth: 240,
    maxPercent: 0.5,
  });

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  const handleExportCorrectionData = async () => {
    const api = window.electronAPI;
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!api?.exportDeviceCorrectionData || !api.selectDir) {
      message.warning("仅 Electron 环境支持导出纠偏数据");
      return;
    }

    const destDir = await api.selectDir("选择纠偏数据导出目录");
    if (!destDir) return;

    setExportingCorrectionData(true);
    try {
      const result = await api.exportDeviceCorrectionData(selectedProject, destDir);
      if (!result.success) throw new Error(result.error || "导出纠偏数据失败");
      message.success(`已导出 ${result.exportedCount || 0} 个纠偏数据：${result.fileName || ""}`);
    } catch (error: any) {
      const text = error?.message || "导出纠偏数据失败";
      if (text.includes("暂无纠偏数据")) message.warning(text);
      else message.error(text);
    } finally {
      setExportingCorrectionData(false);
    }
  };

  const handleExportMarkedPoints = async () => {
    const api = window.electronAPI;
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!api?.exportMarkedDevicePoints || !api.selectDir) {
      message.warning("仅 Electron 环境支持导出标记点位");
      return;
    }

    const destDir = await api.selectDir("选择标记点位导出目录");
    if (!destDir) return;

    setExportingMarkedPoints(true);
    try {
      const result = await api.exportMarkedDevicePoints(selectedProject, destDir);
      if (!result.success) throw new Error(result.error || "导出标记点位失败");
      message.success(`已导出 ${result.exportedCount || 0} 个标记点位：${result.fileName || ""}`);
    } catch (error: any) {
      const text = error?.message || "导出标记点位失败";
      if (text.includes("暂无标记点位")) message.warning(text);
      else message.error(text);
    } finally {
      setExportingMarkedPoints(false);
    }
  };

  const filteredTreeData = useMemo(() => filterTreeByMark(treeData, markFilter), [markFilter, treeData]);
  const filterEmptyDescription = markFilter === "marked"
    ? "暂无已标记点位"
    : markFilter === "unmarked"
      ? "暂无未标记点位"
      : "请加载验证图";

  const resetSelection = useCallback(() => {
    imageRequestRef.current += 1;
    setSelectedKeys([]);
    setSelectedPoint(null);
    setImageDataUrl("");
    setImageError("");
    setLoadingImage(false);
    setCorrectionRect(null);
  }, []);

  const applyPackageResult = useCallback((result: DeviceVerificationPackageResult, showSuccess: boolean) => {
    if (!result.success || !result.sessionId) {
      throw new Error(result.error || "设备验证图加载失败");
    }

    const nextTreeData = (result.roots || []).map(toTreeNode);
    imageCacheRef.current.clear();
    resetSelection();
    setSessionId(result.sessionId);
    setPackageName(result.packageName || "");
    setTreeData(nextTreeData);
    setExpandedKeys(result.expandedKeys?.length ? result.expandedKeys : collectExpandedKeys(nextTreeData));
    if (showSuccess) {
      message.success(`已加载 ${result.pointCount || 0} 个点位，匹配 ${result.imageCount || 0} 张图片`);
    }
  }, [message, resetSelection]);

  const handleLoadPackage = async (mode: VerificationImportMode = "zip") => {
    const api = window.electronAPI;
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!api?.importDeviceVerificationPackage) {
      message.warning("仅 Electron 环境支持加载设备验证图");
      return;
    }
    if (mode === "zip" && !api.selectZipFile) {
      message.warning("当前环境不支持选择 ZIP 压缩包");
      return;
    }
    if (mode === "directory" && !api.selectDir) {
      message.warning("当前环境不支持选择目录");
      return;
    }

    const sourcePath = mode === "directory"
      ? await api.selectDir("选择设备验证图目录")
      : await api.selectZipFile();
    if (!sourcePath) return;

    autoLoadRequestRef.current += 1;
    autoLoadingRef.current = false;
    autoLoadActiveRequestRef.current = 0;
    setLoadingPackage(true);
    try {
      const result = await api.importDeviceVerificationPackage(selectedProject, sourcePath);
      applyPackageResult(result, true);
    } catch (error: any) {
      message.error(error?.message || "设备验证图加载失败");
    } finally {
      setLoadingPackage(false);
    }
  };

  const loadMenuItems: MenuProps["items"] = [
    { key: "zip", label: "选择 ZIP 压缩包" },
    { key: "directory", label: "选择目录" },
  ];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      autoLoadRequestRef.current += 1;
      autoLoadingRef.current = false;
      autoLoadActiveRequestRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    const isActive = location.pathname === "/device-verify";
    if (!isActive || !selectedProject || treeData.length > 0) return;
    if (!api?.loadLocalDeviceVerificationPackage) {
      if (import.meta.env.DEV) {
        console.warn("[device-verify] loadLocalDeviceVerificationPackage 不可用，请重启 Electron 进程以加载最新 preload/main。");
      }
      return;
    }
    if (autoLoadingRef.current) return;

    const requestId = ++autoLoadRequestRef.current;
    autoLoadingRef.current = true;
    autoLoadActiveRequestRef.current = requestId;
    api.loadLocalDeviceVerificationPackage(selectedProject)
      .then((result) => {
        if (!mountedRef.current || autoLoadRequestRef.current !== requestId) return;
        if (result.hasData === false) return;
        applyPackageResult(result, false);
      })
      .catch((error: any) => {
        if (mountedRef.current && autoLoadRequestRef.current === requestId) {
          message.error(error?.message || "本地设备验证图加载失败");
        }
      })
      .finally(() => {
        if (autoLoadActiveRequestRef.current === requestId) {
          autoLoadingRef.current = false;
          autoLoadActiveRequestRef.current = 0;
        }
      });
  }, [applyPackageResult, location.pathname, message, selectedProject, treeData.length]);

  const loadTreeChildren: TreeProps<VerificationTreeNode>["loadData"] = async (node) => {
    if (!sessionId || node.isLeaf || node.children) return;
    const api = window.electronAPI;
    if (!api?.loadDeviceVerificationChildren) return;

    const result = await api.loadDeviceVerificationChildren(sessionId, String(node.key));
    if (!result.success) {
      message.error(result.error || "点位树加载失败");
      throw new Error(result.error || "点位树加载失败");
    }
    const children = (result.children || []).map(toTreeNode);
    setTreeData((current) => updateTreeChildren(current, String(node.key), children));
  };

  const loadPointImage = useCallback(async (point: SelectedPoint) => {
    const requestId = ++imageRequestRef.current;
    setSelectedPoint(point);
    setImageDataUrl("");
    setImageError("");

    if (!point.hasImage) {
      setImageError("该点位没有对应图片");
      setLoadingImage(false);
      return;
    }

    const cached = imageCacheRef.current.get(point.key);
    if (cached) {
      setImageDataUrl(cached);
      setLoadingImage(false);
      return;
    }

    const api = window.electronAPI;
    if (!sessionId || !api?.loadDeviceVerificationImage) {
      setImageError("当前环境不支持加载点位图片");
      return;
    }

    setLoadingImage(true);
    try {
      const result = await api.loadDeviceVerificationImage(sessionId, point.key);
      if (!result.success || !result.dataUrl) throw new Error(result.error || "点位图片加载失败");
      if (requestId !== imageRequestRef.current) return;
      imageCacheRef.current.set(point.key, result.dataUrl);
      setImageDataUrl(result.dataUrl);
    } catch (error: any) {
      if (requestId === imageRequestRef.current) setImageError(error?.message || "点位图片加载失败");
    } finally {
      if (requestId === imageRequestRef.current) setLoadingImage(false);
    }
  }, [sessionId]);

  const loadPointCorrection = useCallback(async (point: SelectedPoint) => {
    const requestId = ++correctionRequestRef.current;
    setCorrectionRect(null);

    const api = window.electronAPI;
    if (!selectedProject || !point.code || !api?.loadDeviceCorrection) return;

    try {
      const result = await api.loadDeviceCorrection(selectedProject, point.code);
      if (requestId !== correctionRequestRef.current) return;
      if (!result.success) throw new Error(result.error || "设备纠偏加载失败");
      setCorrectionRect(result.rect || null);
    } catch (error: any) {
      if (requestId === correctionRequestRef.current) message.error(error?.message || "设备纠偏加载失败");
    }
  }, [message, selectedProject]);

  const handleCorrectionChange = useCallback(async (rect: DeviceCorrectionRect) => {
    const api = window.electronAPI;
    if (!selectedProject || !selectedPoint || !api?.saveDeviceCorrection) {
      message.warning("当前环境不支持保存设备纠偏");
      return;
    }

    setCorrectionRect(rect);
    setSavingCorrection(true);
    try {
      const result = await api.saveDeviceCorrection(selectedProject, {
        pointCode: selectedPoint.code,
        pointName: selectedPoint.title,
        rect,
      });
      if (!result.success) throw new Error(result.error || "设备纠偏保存失败");
      if (result.rect) setCorrectionRect(result.rect);
    } catch (error: any) {
      message.error(error?.message || "设备纠偏保存失败");
    } finally {
      setSavingCorrection(false);
    }
  }, [message, selectedPoint, selectedProject]);

  const handleCorrectionDelete = useCallback(async () => {
    const api = window.electronAPI;
    if (!selectedProject || !selectedPoint || !api?.deleteDeviceCorrection) return;

    setCorrectionRect(null);
    setSavingCorrection(true);
    try {
      const result = await api.deleteDeviceCorrection(selectedProject, selectedPoint.code);
      if (!result.success) throw new Error(result.error || "设备纠偏删除失败");
    } catch (error: any) {
      message.error(error?.message || "设备纠偏删除失败");
    } finally {
      setSavingCorrection(false);
    }
  }, [message, selectedPoint, selectedProject]);

  const handleTogglePointMark = useCallback(async (node: VerificationTreeNode) => {
    const api = window.electronAPI;
    if (!selectedProject || !api?.setDevicePointMark) {
      message.warning("当前环境不支持标记点位");
      return;
    }
    if (node.kind !== "point" || !node.code) return;

    const nextMarked = !node.marked;
    setTreeData((current) => updateTreePointMarked(current, node.key, nextMarked));
    try {
      const result = await api.setDevicePointMark(selectedProject, {
        pointCode: node.code,
        pointName: String(node.title || ""),
        marked: nextMarked,
      });
      if (!result.success) throw new Error(result.error || "标记点位保存失败");
      setTreeData((current) => updateTreePointMarked(current, node.key, Boolean(result.marked)));
    } catch (error: any) {
      setTreeData((current) => updateTreePointMarked(current, node.key, node.marked));
      message.error(error?.message || "标记点位保存失败");
    }
  }, [message, selectedProject]);

  const renderTreeTitle = useCallback((node: VerificationTreeNode) => {
    const isPoint = node.kind === "point";
    return (
      <div className={`device-verify-tree-title${isPoint && node.marked ? " is-marked" : ""}`}>
        {isPoint && (
          <FileImageOutlined className={`device-verify-point-icon ${node.hasImage ? "has-image" : "without-image"}`} />
        )}
        <span className="device-verify-tree-title-text">{node.title}</span>
        {isPoint && (
          <Tooltip title={node.marked ? "取消标记" : "标记遮挡或不在画面中央的点位"}>
            <Button
              className="device-verify-point-mark-button"
              type={node.marked ? "primary" : "text"}
              danger={node.marked}
              size="small"
              icon={<PushpinOutlined />}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                void handleTogglePointMark(node);
              }}
            >
              {node.marked ? "取消" : "标记"}
            </Button>
          </Tooltip>
        )}
      </div>
    );
  }, [handleTogglePointMark]);

  const handleSelect: TreeProps<VerificationTreeNode>["onSelect"] = (keys, info) => {
    setSelectedKeys(keys);
    const node = info.node;
    if (node.kind !== "point") {
      imageRequestRef.current += 1;
      correctionRequestRef.current += 1;
      setSelectedPoint(null);
      setImageDataUrl("");
      setImageError("");
      setLoadingImage(false);
      setCorrectionRect(null);
      return;
    }
    const point = {
      key: String(node.key),
      title: String(node.title || ""),
      code: node.code,
      hasImage: node.hasImage,
    };
    void loadPointImage(point);
    void loadPointCorrection(point);
  };

  return (
    <div className="device-verify-page">
      <div className="device-verify-toolbar">
        <Space size={4} wrap>
          <Space.Compact>
            <Button icon={<UploadOutlined />} loading={loadingPackage} onClick={() => handleLoadPackage("zip")}>验证图加载</Button>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: loadMenuItems,
                onClick: ({ key }) => handleLoadPackage(key as VerificationImportMode),
              }}
            >
              <Button icon={<DownOutlined />} disabled={loadingPackage} />
            </Dropdown>
          </Space.Compact>
          <Button icon={<SyncOutlined />} loading={exportingCorrectionData} onClick={handleExportCorrectionData}>导出纠偏数据</Button>
          <Button icon={<PushpinOutlined />} loading={exportingMarkedPoints} onClick={handleExportMarkedPoints}>导出标记点位</Button>
          <Button icon={<CloudSyncOutlined />} onClick={() => placeholder("同步分析主机")}>同步分析主机</Button>
        </Space>
      </div>

      <div className="device-verify-body" ref={containerRef}>
        <div className="device-verify-left" style={{ width: leftWidth }}>
          <div className="device-verify-left-title">
            <span className="device-verify-title-text">点位树</span>
            {packageName && <Tooltip title={packageName}><span className="device-verify-package-name">{packageName}</span></Tooltip>}
          </div>
          {treeData.length > 0 && (
            <div className="device-verify-tree-filter">
              <span className="device-verify-tree-filter-label">过滤</span>
              <Segmented
                size="small"
                value={markFilter}
                options={markFilterOptions}
                onChange={(value) => setMarkFilter(value as PointMarkFilter)}
              />
            </div>
          )}
          <div className="device-verify-tree">
            {loadingPackage ? (
              <div className="device-verify-tree-loading">
                <Spin />
              </div>
            ) : filteredTreeData.length > 0 ? (
              <Tree<VerificationTreeNode>
                blockNode
                showLine={{ showLeafIcon: false }}
                treeData={filteredTreeData}
                loadData={loadTreeChildren}
                selectedKeys={selectedKeys}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={handleSelect}
                titleRender={renderTreeTitle}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filterEmptyDescription} />
            )}
          </div>
        </div>

        <div className="device-verify-resizer" onMouseDown={onMouseDown} />

        <div className="device-verify-right">
          {selectedPoint && (
            <div className="device-verify-image-header">
              <div className="device-verify-image-meta">
                <span className="device-verify-point-name">{selectedPoint.title}</span>
                <span className="device-verify-point-code">{selectedPoint.code}</span>
              </div>
              <Button
                className="device-verify-correction-button"
                size="small"
                icon={<AimOutlined />}
                type={correctionMode ? "primary" : "default"}
                loading={savingCorrection}
                disabled={!imageDataUrl}
                onClick={() => setCorrectionMode((current) => !current)}
              >
                设备纠偏
              </Button>
            </div>
          )}
          <div className="device-verify-image-stage">
            {loadingImage ? (
              <Spin />
            ) : imageDataUrl ? (
              <VerificationImageCanvas
                src={imageDataUrl}
                label={selectedPoint?.title || "点位图片"}
                correctionMode={correctionMode}
                correctionRect={correctionRect}
                onCorrectionChange={handleCorrectionChange}
                onCorrectionDelete={handleCorrectionDelete}
                onLoadError={(error) => {
                  setImageDataUrl("");
                  setImageError(error);
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={treeData.length === 0 ? "请加载验证图" : imageError || "未选择点位"} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
