import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Dropdown, Empty, Space, Spin, Tree, Tooltip } from "antd";
import type { MenuProps, TreeDataNode, TreeProps } from "antd";
import {
  AppstoreOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DownOutlined,
  DownloadOutlined,
  FileImageOutlined,
  HddOutlined,
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
  children?: VerificationTreeNode[];
}

interface SelectedPoint {
  key: string;
  title: string;
  code: string;
  hasImage: boolean;
}

type VerificationImportMode = "zip" | "directory";

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

function toTreeNode(node: DeviceVerificationTreeNode): VerificationTreeNode {
  return {
    ...node,
    children: node.children?.map(toTreeNode),
    icon: node.kind === "point"
      ? <FileImageOutlined className={node.hasImage ? "has-image" : "without-image"} />
      : node.kind === "component"
        ? <AppstoreOutlined />
        : node.kind === "mainDevice"
          ? <HddOutlined />
          : <DatabaseOutlined />,
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
  const autoLoadingRef = useRef(false);
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

  const { width: leftWidth, onMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.3,
    minWidth: 240,
    maxPercent: 0.5,
  });

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  const resetSelection = useCallback(() => {
    imageRequestRef.current += 1;
    setSelectedKeys([]);
    setSelectedPoint(null);
    setImageDataUrl("");
    setImageError("");
    setLoadingImage(false);
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
    const api = window.electronAPI;
    const isActive = location.pathname === "/device-verify";
    if (!isActive || !selectedProject || treeData.length > 0) return;
    if (!api?.loadLocalDeviceVerificationPackage) return;
    if (autoLoadingRef.current) return;

    let canceled = false;
    autoLoadingRef.current = true;
    setLoadingPackage(true);
    api.loadLocalDeviceVerificationPackage(selectedProject)
      .then((result) => {
        if (canceled) return;
        if (result.hasData === false) return;
        applyPackageResult(result, false);
      })
      .catch((error: any) => {
        if (!canceled) message.error(error?.message || "本地设备验证图加载失败");
      })
      .finally(() => {
        autoLoadingRef.current = false;
        if (!canceled) setLoadingPackage(false);
      });

    return () => {
      canceled = true;
    };
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

  const handleSelect: TreeProps<VerificationTreeNode>["onSelect"] = (keys, info) => {
    setSelectedKeys(keys);
    const node = info.node;
    if (node.kind !== "point") {
      imageRequestRef.current += 1;
      setSelectedPoint(null);
      setImageDataUrl("");
      setImageError("");
      setLoadingImage(false);
      return;
    }
    void loadPointImage({
      key: String(node.key),
      title: String(node.title || ""),
      code: node.code,
      hasImage: node.hasImage,
    });
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
          <Button icon={<DownloadOutlined />} onClick={() => placeholder("验证图导出")}>验证图导出</Button>
          <Button icon={<SyncOutlined />} onClick={() => placeholder("导出纠偏数据")}>导出纠偏数据</Button>
          <Button icon={<PushpinOutlined />} onClick={() => placeholder("导出标记点位")}>导出标记点位</Button>
          <Button icon={<CloudSyncOutlined />} onClick={() => placeholder("同步分析主机")}>同步分析主机</Button>
        </Space>
      </div>

      <div className="device-verify-body" ref={containerRef}>
        <div className="device-verify-left" style={{ width: leftWidth }}>
          <div className="device-verify-left-title">
            <span className="device-verify-title-text">点位树</span>
            {packageName && <Tooltip title={packageName}><span className="device-verify-package-name">{packageName}</span></Tooltip>}
          </div>
          <div className="device-verify-tree">
            {loadingPackage ? (
              <div className="device-verify-tree-loading">
                <Spin />
              </div>
            ) : treeData.length > 0 ? (
              <Tree<VerificationTreeNode>
                blockNode
                showIcon
                showLine
                treeData={treeData}
                loadData={loadTreeChildren}
                selectedKeys={selectedKeys}
                expandedKeys={expandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={handleSelect}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请加载验证图" />
            )}
          </div>
        </div>

        <div className="device-verify-resizer" onMouseDown={onMouseDown} />

        <div className="device-verify-right">
          {selectedPoint && (
            <div className="device-verify-image-header">
              <span className="device-verify-point-name">{selectedPoint.title}</span>
              <span className="device-verify-point-code">{selectedPoint.code}</span>
            </div>
          )}
          <div className="device-verify-image-stage">
            {loadingImage ? (
              <Spin />
            ) : imageDataUrl ? (
              <VerificationImageCanvas
                src={imageDataUrl}
                label={selectedPoint?.title || "点位图片"}
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
