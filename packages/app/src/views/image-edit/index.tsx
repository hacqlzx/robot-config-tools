import { useRef, useState, useCallback, useEffect } from "react";
import { Button, Space, Divider, App } from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  FileImageOutlined,
  CameraOutlined,
  HddOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import SurveyImageLoad from "./components/SurveyImageLoad";
import { useMiniViewer } from "./hooks/useMiniViewer";
import { parseLasHeader } from "../../playcanvas-core/io/read/las-reader";
import "./index.scss";

const MIN_LEFT = 160;
const MAX_LEFT = 500;

export default function ImageEdit() {
  const { message } = App.useApp();
  const [leftWidth, setLeftWidth] = useState(240);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(240);

  // Mini 3D 查看器
  const viewerCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const { loadLasFromPath, loadJsonFromPath } = useMiniViewer({
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

      // 先加载第一个 LAS，获取中心坐标
      const firstLas = lasFiles[0];
      await loadLasFromPath(firstLas);

      // 从 header 计算中心（用于 JSON 坐标转换）
      const headerBuf = await window.electronAPI.readFileChunk(firstLas, 0, 4096);
      const header = parseLasHeader(headerBuf);
      const cx = (header.minX + header.maxX) / 2;
      const cy = (header.minY + header.maxY) / 2;
      const cz = (header.minZ + header.maxZ) / 2;

      // 加载其余 LAS
      for (let i = 1; i < lasFiles.length; i++) {
        await loadLasFromPath(lasFiles[i]);
      }

      // 加载 JSON 绘制数据
      for (const jsonPath of jsonFiles) {
        try {
          await loadJsonFromPath(jsonPath, cx, cy, cz);
        } catch (e) {
          console.error("JSON 加载失败:", jsonPath, e);
        }
      }

      message.success(`地图"${mapName}"加载成功`);
      setLoadedMap(mapName);
    } catch (e: any) {
      message.error("加载地图数据失败: " + (e?.message || ""));
    }
  }, [message, loadLasFromPath, loadJsonFromPath]);

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
            {!loadedMap && (
              <div className="map-empty">请先加载勘察图像</div>
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
