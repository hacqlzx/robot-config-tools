import { useRef, useState, useCallback, useEffect } from "react";
import { Button, Space, Divider, App, Spin } from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  FileImageOutlined,
  CameraOutlined,
  HddOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import SurveyImageLoad from "./components/SurveyImageLoad";
import { useThreeDViewer } from "@/components/three-d-engine";
import "./index.scss";

const MIN_LEFT = 160;
const MAX_LEFT = 500;

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export default function ImageEdit() {
  const { message } = App.useApp();
  const [leftWidth, setLeftWidth] = useState(240);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(240);

  // 公共 3D 查看器
  const viewerCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const { loadFile, loadDrawing, loading, loadingFile, progress } = useThreeDViewer({
    canvasRef: viewerCanvasRef,
    containerRef: viewerContainerRef,
  });

  // 弹窗状态
  const [surveyLoadOpen, setSurveyLoadOpen] = useState(false);

  // 已加载的地图数据
  const [loadedMap, setLoadedMap] = useState<string | null>(null);

  const handleSurveyLoad = useCallback(async (mapName: string) => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !window.electronAPI?.project) return;
    try {
      const tree = await window.electronAPI.project.listTree(project, `地图/${mapName}`);

      const lasFiles: string[] = [];
      const jsonFiles: string[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const n of nodes) {
          if (!n.isDir) {
            const ext = n.name.toLowerCase();
            if (ext.endsWith(".las") || ext.endsWith(".laz")) {
              lasFiles.push(n.path);
            } else if (ext.endsWith(".json")) {
              jsonFiles.push(n.path);
            }
          }
          if (n.children) walk(n.children);
        }
      };
      walk(tree);

      if (lasFiles.length === 0) {
        message.warning("未找到 LAS 点云文件");
        setLoadedMap(mapName);
        return;
      }

      // 加载 LAS
      for (let i = 0; i < lasFiles.length; i++) {
        await loadFile(lasFiles[i]);
      }

      // 加载 JSON 绘制数据
      for (const jsonPath of jsonFiles) {
        try {
          await loadDrawing(jsonPath);
        } catch (e) {
          console.error("绘制数据加载失败:", jsonPath, e);
        }
      }

      message.success(`地图"${mapName}"加载成功`);
      setLoadedMap(mapName);
    } catch (e: any) {
      message.error("加载地图数据失败: " + (e?.message || ""));
    }
  }, [message, loadFile, loadDrawing]);

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    setResizing(true);
  }, [leftWidth]);

  useEffect(() => {
    if (!resizing) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const w = Math.min(MAX_LEFT, Math.max(MIN_LEFT, startWidthRef.current + delta));
      setLeftWidth(w);
    };
    const onMouseUp = () => {
      setResizing(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing]);

  return (
    <div className={`image-edit-page${resizing ? " is-resizing" : ""}`}>
      {/* 顶部工具栏 */}
      <div className="image-edit-toolbar">
        <Space size={4} wrap>
          <Button icon={<UploadOutlined />} onClick={() => setSurveyLoadOpen(true)}>
            勘察图像加载
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => placeholder("勘察图像导出")}>
            勘察图像导出
          </Button>

          <Divider type="vertical" />

          <Button icon={<FileImageOutlined />} onClick={() => placeholder("图像标识加载")}>
            图像标识加载
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => placeholder("图像标识导出")}>
            图像标识导出
          </Button>

          <Divider type="vertical" />

          <Button icon={<CameraOutlined />} onClick={() => placeholder("勘察拍照")}>
            勘察拍照
          </Button>
          <Button icon={<HddOutlined />} onClick={() => placeholder("屏柜拍照")}>
            屏柜拍照
          </Button>

          <Divider type="vertical" />

          <Button icon={<CheckCircleOutlined />} onClick={() => placeholder("验证任务")}>
            验证任务
          </Button>
        </Space>
      </div>

      {/* 主体：左右布局 */}
      <div className="image-edit-body" ref={containerRef}>
        {/* 左侧：设备区地图 */}
        <div className="image-edit-sider" style={{ width: leftWidth }}>
          <div className="image-edit-map" ref={viewerContainerRef}>
            <canvas ref={viewerCanvasRef} className="viewer-canvas" />
            {!loadedMap && !loading && (
              <div className="map-empty">请先加载勘察图像</div>
            )}
            {loading && (
              <div className="map-loading-overlay">
                <Spin size="large" />
                <div className="map-loading-name">{loadingFile}</div>
                {progress > 0 && (
                  <div className="map-loading-bar-wrap">
                    <div className="map-loading-bar">
                      <div className="map-loading-bar-fill" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="map-loading-pct">{progress}%</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 拖拽手柄 */}
        <div className="image-edit-resizer" onMouseDown={onMouseDown} />

        {/* 右侧：主内容 */}
        <div className="image-edit-content">
          {/* TODO: 主内容区 */}
        </div>
      </div>

      {/* 勘察图像加载弹窗 */}
      <SurveyImageLoad open={surveyLoadOpen} onClose={() => setSurveyLoadOpen(false)} onImport={handleSurveyLoad} />
    </div>
  );
}
