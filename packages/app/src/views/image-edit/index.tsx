import { useRef, useState, useCallback, useEffect } from "react";
import { Button, Space, Divider, App, Spin, Radio, Select, Input, Checkbox } from "antd";
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
import { useResizable } from "@/components/useResizable";
import ImageCanvas from "@/components/image-canvas/ImageCanvas";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";
import { useTaskLoader } from "./hooks/useTaskLoader";
import "./index.scss";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

export default function ImageEdit() {
  const { message } = App.useApp();
  const containerRef = useRef<HTMLDivElement>(null);

  const { width: leftWidth, resizing, onMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.25,
    minWidth: 160,
    maxPercent: 0.5,
  });

  const { width: rightWidth, resizing: rightResizing, onMouseDown: onRightMouseDown } = useResizable({
    containerRef,
    initialPercent: 0.15,
    minWidth: 120,
    maxPercent: 0.6,
    reverse: true,
  });

  const [ptzSide, setPtzSide] = useState<"left" | "right">("left");
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const [taskImages, setTaskImages] = useState<ImageItem[]>([]);
  const { loading: taskLoading, progress: taskProgress, loadTask, updateImagePos, clear: clearTask } = useTaskLoader();
  const [bayList, setBayList] = useState<{ id: number; bayName: string }[]>([]);
  const [selBayId, setSelBayId] = useState<number | undefined>(undefined);
  const [nameFilter, setNameFilter] = useState("");
  const [pointTableVisible, setPointTableVisible] = useState(true);
  const [checkedPoints, setCheckedPoints] = useState<number[]>([]);
  const [points, setPoints] = useState<{ id: number; pointName: string; demarcateState: number }[]>([]);

  // 拉取当前项目下所有间隔
  useEffect(() => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !window.electronAPI?.db?.bay) return;
    window.electronAPI.db.bay.list(project).then((list) => {
      setBayList(list.map((b) => ({ id: b.id, bayName: b.bayName })));
    }).catch(() => {});
  }, []);

  // 根据选中间隔查询巡检点
  useEffect(() => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !selBayId || !window.electronAPI?.db?.point) {
      if (!selBayId) setPoints([]);
      return;
    }
    window.electronAPI.db.point.list(project).then((list) => {
      setPoints(
        list
          .filter((p) => p.bayId === selBayId)
          .map((p) => ({ id: p.id, pointName: p.pointName, demarcateState: p.demarcateState }))
      );
    }).catch(() => setPoints([]));
  }, [selBayId]);

  const handle3DSelect = useCallback((info: { type: string; bayId: number }) => {
    if (info.bayId) setSelBayId(info.bayId);
  }, []);

  // 公共 3D 查看器
  const viewerCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const { loadFile, loadDrawing, loading, loadingFile, progress, drawingRef, loaderRef } = useThreeDViewer({
    canvasRef: viewerCanvasRef,
    containerRef: viewerContainerRef,
    onSelect: handle3DSelect,
  });

  // 弹窗状态
  const [surveyLoadOpen, setSurveyLoadOpen] = useState(false);

  // 已加载的地图数据
  const [loadedMap, setLoadedMap] = useState<string | null>(null);

  /** 加载勘察图像（地图模式：LAS + JSON） */
  const handleSurveyLoad = useCallback(async (mapName: string) => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !window.electronAPI?.project) return;
    // 卸载旧模型
    loaderRef.current?.destroy();
    drawingRef.current?.clear();
    setLoadedMap(null);
    setSelBayId(undefined);
    setCheckedPoints([]);
    setPoints([]);
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

  /** 加载任务图像（任务模式：JSON + JPG 拼接） */
  const handleTaskLoad = useCallback(async (taskDir: string) => {
    try {
      clearTask();
      setTaskImages([]);
      const items = await loadTask(taskDir);
      setTaskImages(items);
    } catch (e: any) {
      message.error("加载任务数据失败: " + (e?.message || ""));
    }
  }, [loadTask, clearTask, message]);

  /** 拖拽更新单图位置 */
  const handleDragImage = useCallback((id: number, x: number, y: number) => {
    setTaskImages((prev) => {
      const idx = prev.findIndex((img) => img.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], x, y };
      return next;
    });
  }, []);

  const placeholder = (label: string) => {
    message.info(`${label}（功能待接入）`);
  };

  return (
    <div className={`image-edit-page${resizing || rightResizing ? " is-resizing" : ""}`}>
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
          <div className="image-edit-sider-title"><span className="image-edit-title-text">设备区地图</span></div>
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

        {/* 右侧 */}
        <div className="image-edit-right" style={{ display: "flex", flex: 1, minWidth: 0 }}>
          {/* 主模块 */}
          <div className="image-edit-main" style={{ flex: 1, minWidth: 0 }}>
            <div className="image-edit-main-header">
              <Radio.Group value={ptzSide} onChange={(e) => setPtzSide(e.target.value)} size="small">
                <Radio.Button value="left">云台左</Radio.Button>
                <Radio.Button value="right">云台右</Radio.Button>
              </Radio.Group>
            </div>
            <div className="image-edit-main-body" ref={imageContainerRef} style={{ position: "relative" }}>
              <ImageCanvas
                canvasRef={imageCanvasRef}
                containerRef={imageContainerRef}
                images={taskImages}
                onDragImage={handleDragImage}
              />
              {taskLoading && (
                <div className="map-loading-overlay">
                  <Spin size="large" />
                  <div className="map-loading-name">{taskProgress}</div>
                </div>
              )}
            </div>
          </div>
          {/* 拖拽手柄 */}
          <div className="image-edit-resizer" onMouseDown={onRightMouseDown} />
          {/* 点表模块 */}
          {pointTableVisible ? (
            <div className="image-edit-point-table" style={{ width: rightWidth, minWidth: 120 }}>
              <div className="image-edit-sider-title">
                <span className="image-edit-title-text">点表模块</span>
                <span className="image-edit-toggle-btn" onClick={() => setPointTableVisible(false)}>{'>'}</span>
              </div>
              <div className="image-edit-point-filters">
              <Select
                placeholder="请选择间隔"
                allowClear
                showSearch
                optionFilterProp="label"
                size="small"
                style={{ width: "100%", marginBottom: 8 }}
                value={selBayId}
                onChange={(v) => setSelBayId(v)}
                options={bayList.map((b) => ({ value: b.id, label: b.bayName }))}
              />
              <Input
                placeholder="搜索停靠点"
                allowClear
                size="small"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </div>
            <div className="image-edit-point-list">
              <Checkbox.Group
                style={{ width: "100%" }}
                value={checkedPoints}
                onChange={(v) => setCheckedPoints(v as number[])}
              >
                {points
                  .filter((p) => !nameFilter || p.pointName.includes(nameFilter))
                  .map((p) => (
                    <div key={p.id} className="image-edit-point-item">
                      <Checkbox value={p.id}><span className="image-edit-point-name">{p.pointName}</span></Checkbox>
                      <span className={`image-edit-point-status${p.demarcateState === 1 ? " marked" : ""}`}>
                        {p.demarcateState === 1 ? "已标" : "未标"}
                      </span>
                    </div>
                  ))}
              </Checkbox.Group>
            </div>
          </div>
          ) : (
            <div className="image-edit-point-table-collapsed">
              <span className="image-edit-toggle-btn" onClick={() => setPointTableVisible(true)}>{'<'}</span>
            </div>
          )}
        </div>
      </div>

      {/* 勘察图像加载弹窗 */}
      <SurveyImageLoad open={surveyLoadOpen} onClose={() => setSurveyLoadOpen(false)} onImport={handleSurveyLoad} onTaskImport={handleTaskLoad} />
    </div>
  );
}
