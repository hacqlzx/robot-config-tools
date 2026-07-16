import { useRef, useState, useCallback, useEffect } from "react";
import { Button, Space, Divider, App, Spin, Radio, Select, Input, Checkbox, Dropdown } from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  FileImageOutlined,
  CameraOutlined,
  HddOutlined,
  CheckCircleOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import SurveyImageLoad from "./components/SurveyImageLoad";
import SurveyImageExport from "./components/SurveyImageExport";
import ImageLabelTransfer from "./components/ImageLabelTransfer";
import SurveyPhotoModal, { type SurveyPhotoDispatchItem, type SurveyPhotoMode } from "./components/SurveyPhotoModal";
import CabinetPhotoModal, { type CabinetPhotoDispatchItem } from "./components/CabinetPhotoModal";
import VerifyTaskModal from "./components/VerifyTaskModal";
import CalibrationView from "./components/CalibrationView";
import { useThreeDViewer } from "@/components/three-d-engine";
import { useResizable } from "@/components/useResizable";
import ImageCanvas from "@/components/image-canvas/ImageCanvas";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";
import { useTaskLoader } from "./hooks/useTaskLoader";
import { useSelectedProject, useSelectedRobot } from "@/stores/appContextStore";
import { cabinetDeviceMainCollect, equipmentDeviceMainCollect, getAllRobot, stopPointCollect } from "@/api/config.js";
import "./index.scss";

type CalibrationImageItem = ImageItem & { img: HTMLImageElement };

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
}

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";

function getSharedCalibrationFilePath(surveyDir: string): string {
  const normalized = surveyDir.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[parts.length - 1] === SURVEY_DIR_NAME) return `${normalized}/${CALIBRATION_FILE_NAME}`;
  const root = normalized.replace(/[\\/][^\\/]+$/, "");
  return `${root}/${CALIBRATION_FILE_NAME}`;
}

function getCalibrationEntryMapCode(entry: any, fileMapCode?: string): string {
  return String(entry?.mapCode || fileMapCode || "");
}

export default function ImageEdit() {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const selectedRobot = useSelectedRobot();
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
  const [totalImageCount, setTotalImageCount] = useState(0);
  const { loading: taskLoading, progress: taskProgress, loadTask, setSide, clear: clearTask, getTotalCount, loadFullImage } = useTaskLoader();
  const [bayList, setBayList] = useState<{ id: number; bayName: string }[]>([]);
  const [selBayId, setSelBayId] = useState<number | undefined>(undefined);
  const [nameFilter, setNameFilter] = useState("");
  const [pointFilter, setPointFilter] = useState<"all" | "marked" | "unmarked">("all");
  const [pointTableVisible, setPointTableVisible] = useState(true);
  const [mapVisible, setMapVisible] = useState(true);
  const [checkedPoints, setCheckedPoints] = useState<number[]>([]);
  const [points, setPoints] = useState<{ id: number; pointCode: string; pointName: string; demarcateState: number }[]>([]);

  const [calibrationImage, setCalibrationImage] = useState<CalibrationImageItem | null>(null);
  const [calibrationRects, setCalibrationRects] = useState<Map<number, { x: number; y: number; w: number; h: number }[]>>(new Map());
  const [calibratedPointCodes, setCalibratedPointCodes] = useState<Set<string>>(new Set());
  const [calibratedImageCount, setCalibratedImageCount] = useState(0);
  const resetViewRef = useRef<(() => void) | null>(null);
  const surveyDirRef = useRef<string>("");
  const loadedMapRef = useRef<string | null>(null);

  // 加载已标定的图片 ID 集合 + 已标定点位编码集合
  const refreshCalibratedRects = useCallback(async (mapName?: string | null) => {
    const td = surveyDirRef.current;
    if (!td || !window.electronAPI?.readLargeFile) return;
    try {
      const filePath = getSharedCalibrationFilePath(td);
      if (!filePath) return;
      const buf = await window.electronAPI.readLargeFile(filePath);
      const json = JSON.parse(new TextDecoder().decode(buf));
      const currentMapCode = mapName || loadedMapRef.current || json.mapCode || "";
      const map = new Map<number, { x: number; y: number; w: number; h: number }[]>();
      const codes = new Set<string>();
      for (const entry of json.data || []) {
        if (currentMapCode && getCalibrationEntryMapCode(entry, json.mapCode) !== currentMapCode) continue;
        if (entry.rects && entry.rects.length > 0) {
          map.set(entry.imageId, entry.rects.map((r: any) => ({ x: r.x, y: r.y, w: r.w, h: r.h })));
          const hasBinding = entry.rects.some((r: any) => r.bindings && r.bindings.length > 0);
          if (hasBinding) {
            for (const r of entry.rects) {
              for (const b of r.bindings || []) {
                codes.add(b.pointCode);
              }
            }
          }
        }
      }
      setCalibrationRects(map);
      setCalibratedPointCodes(codes);
      let calCount = 0;
      for (const entry of json.data || []) {
        if (currentMapCode && getCalibrationEntryMapCode(entry, json.mapCode) !== currentMapCode) continue;
        if (entry.rects && entry.rects.some((r: any) => r.bindings && r.bindings.length > 0)) calCount++;
      }
      setCalibratedImageCount(calCount);
    } catch {
      setCalibrationRects(new Map());
      setCalibratedPointCodes(new Set());
      setCalibratedImageCount(0);
    }
  }, []);

  const handleImageDoubleClick = useCallback(async (item: ImageItem) => {
    try {
      const fullImage = await loadFullImage(item);
      setCalibrationImage(fullImage);
    } catch (e: any) {
      message.error("加载原图失败: " + (e?.message || ""));
    }
  }, [loadFullImage, message]);

  // 拉取当前项目下所有间隔
  useEffect(() => {
    if (!selectedProject || !window.electronAPI?.db?.bay) {
      setBayList([]);
      return;
    }
    window.electronAPI.db.bay.list(selectedProject).then((list) => {
      setBayList(list.map((b) => ({ id: b.id, bayName: b.bayName })));
    }).catch(() => {});
  }, [selectedProject]);

  // 根据选中间隔查询巡检点
  useEffect(() => {
    if (!selectedProject || !selBayId || !window.electronAPI?.db?.point) {
      if (!selBayId) setPoints([]);
      return;
    }
    window.electronAPI.db.point.list(selectedProject).then((list) => {
      setPoints(
        list
          .filter((p) => p.bayId === selBayId)
          .map((p) => ({ id: p.id, pointCode: p.pointCode, pointName: p.pointName, demarcateState: p.demarcateState }))
      );
    }).catch(() => setPoints([]));
  }, [selBayId, selectedProject]);

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
  const [surveyExportOpen, setSurveyExportOpen] = useState(false);
  const [imageLabelImportOpen, setImageLabelImportOpen] = useState(false);
  const [imageLabelExportOpen, setImageLabelExportOpen] = useState(false);
  const [surveyPhotoOpen, setSurveyPhotoOpen] = useState(false);
  const [surveyPhotoMode, setSurveyPhotoMode] = useState<SurveyPhotoMode>("normal");
  const [cabinetPhotoOpen, setCabinetPhotoOpen] = useState(false);
  const [verifyTaskOpen, setVerifyTaskOpen] = useState(false);

  // 已加载的地图数据
  const [loadedMap, setLoadedMap] = useState<string | null>(null);

  /** 加载勘察图像（地图模式：LAS + JSON） */
  const handleSurveyLoad = useCallback(async (mapName: string) => {
    if (!selectedProject || !window.electronAPI?.project) return;
    // 卸载旧模型
    loaderRef.current?.destroy();
    drawingRef.current?.clear();
    loadedMapRef.current = null;
    setLoadedMap(null);
    surveyDirRef.current = "";
    clearTask();
    setTaskImages([]);
    setTotalImageCount(0);
    setCalibrationImage(null);
    setCalibrationRects(new Map());
    setCalibratedPointCodes(new Set());
    setCalibratedImageCount(0);
    setSelBayId(undefined);
    setCheckedPoints([]);
    setPoints([]);
    try {
      const tree = await window.electronAPI.project.listTree(selectedProject, `地图/${mapName}`);

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
        loadedMapRef.current = mapName;
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
      loadedMapRef.current = mapName;
      setLoadedMap(mapName);
    } catch (e: any) {
      message.error("加载地图数据失败: " + (e?.message || ""));
    }
  }, [message, loadFile, loadDrawing, clearTask, selectedProject]);

  /** 加载任务图像（任务模式：JSON + JPG 拼接） */
  const handleTaskLoad = useCallback(async (taskDir: string) => {
    console.log("[handleTaskLoad] 开始加载:", taskDir);
    surveyDirRef.current = taskDir;
    try {
      clearTask();
      setTaskImages([]);
      const result = await loadTask(taskDir);
      surveyDirRef.current = result.surveyDir;
      // 按当前选中的云台侧计算布局
      const items = setSide(ptzSide);
      setTaskImages(items);
      setTotalImageCount(getTotalCount());
      console.log("[handleTaskLoad] 完成, 图片数:", items.length);
      refreshCalibratedRects(loadedMapRef.current);
    } catch (e: any) {
      console.error("[handleTaskLoad] 失败:", e);
      message.error("加载任务数据失败: " + (e?.message || ""));
    }
  }, [loadTask, clearTask, setSide, ptzSide, message, refreshCalibratedRects]);

  // ptzSide 切换时重新计算布局
  useEffect(() => {
    const items = setSide(ptzSide);
    if (items.length > 0 || taskImages.length > 0) {
      setTaskImages(items);
    }
  }, [ptzSide]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenSurveyPhoto = useCallback((mode: SurveyPhotoMode = "normal") => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!loadedMapRef.current) {
      message.warning("请先加载勘察图像");
      return;
    }
    setSurveyPhotoMode(mode);
    setSurveyPhotoOpen(true);
  }, [message, selectedProject]);

  const handleOpenCabinetPhoto = useCallback(() => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    if (!loadedMapRef.current) {
      message.warning("请先加载勘察图像");
      return;
    }
    setCabinetPhotoOpen(true);
  }, [message, selectedProject]);

  const handleOpenVerifyTask = useCallback(() => {
    if (!selectedProject) {
      message.warning("请先选择项目");
      return;
    }
    setVerifyTaskOpen(true);
  }, [message, selectedProject]);

  const resolveSelectedRobotId = useCallback(async (): Promise<number | null> => {
    if (!selectedRobot) {
      message.warning("请先在顶部选择机器人");
      return null;
    }

    const robotRes = await getAllRobot();
    const robotBody = robotRes.data;
    if (!robotBody.success || !Array.isArray(robotBody.data)) {
      message.error("获取机器人列表失败");
      return null;
    }

    const robot = robotBody.data.find((item: any) => item.robotName === selectedRobot);
    if (!robot) {
      message.error(`未找到机器人「${selectedRobot}」`);
      return null;
    }

    const robotId = Number(robot.id);
    if (!Number.isFinite(robotId)) {
      message.error(`机器人「${selectedRobot}」ID 无效`);
      return null;
    }
    return robotId;
  }, [message, selectedRobot]);

  const handleSurveyPhotoDispatch = useCallback(async (areas: SurveyPhotoDispatchItem[]) => {
    const label = surveyPhotoMode === "supplement" ? "补充勘察拍照" : "勘察拍照";
    const unit = surveyPhotoMode === "supplement" ? "条停靠点记录" : "个设备区";
    try {
      const robotId = await resolveSelectedRobotId();
      if (robotId == null) return false;

      const ids = surveyPhotoMode === "supplement"
        ? Array.from(new Set(areas.map((item) => String(item.stopPointId || "")).filter(Boolean)))
        : Array.from(new Set(areas.map((item) => String(item.regionId || item.bayId)).filter(Boolean)));
      if (ids.length === 0) {
        message.warning(`请选择有效的${surveyPhotoMode === "supplement" ? "停靠点" : "设备区"}`);
        return false;
      }

      const res = surveyPhotoMode === "supplement"
        ? await stopPointCollect(robotId, ids)
        : await equipmentDeviceMainCollect(robotId, ids);
      const body = res.data;
      if (!body.success) {
        message.error(body.message || `${label}下发失败`);
        return false;
      }

      message.success(`已下发 ${areas.length} ${unit}`);
      return true;
    } catch (e: any) {
      message.error(`${label}下发失败: ${e?.message || e}`);
      return false;
    }
  }, [message, resolveSelectedRobotId, surveyPhotoMode]);

  const handleCabinetPhotoDispatch = useCallback(async (items: CabinetPhotoDispatchItem[]) => {
    try {
      const robotId = await resolveSelectedRobotId();
      if (robotId == null) return false;

      const ids = Array.from(new Set(items.map((item) => String(item.fileCabinetId || "")).filter(Boolean)));
      if (ids.length === 0) {
        message.warning("请选择有效的屏柜");
        return false;
      }

      const res = await cabinetDeviceMainCollect(robotId, ids);
      const body = res.data;
      if (!body.success) {
        message.error(body.message || "屏柜拍照下发失败");
        return false;
      }

      message.success(`已下发 ${items.length} 个屏柜`);
      return true;
    } catch (e: any) {
      message.error("屏柜拍照下发失败: " + (e?.message || e));
      return false;
    }
  }, [message, resolveSelectedRobotId]);

  const surveyPhotoMenu: MenuProps = {
    items: [
      { key: "normal", label: "勘察拍照", icon: <CameraOutlined /> },
      { key: "supplement", label: "补充勘察拍照", icon: <CameraOutlined /> },
    ],
    onClick: ({ key }) => handleOpenSurveyPhoto(key as SurveyPhotoMode),
  };

  return (
    <div className={`image-edit-page${resizing || rightResizing ? " is-resizing" : ""}`}>
      {/* 顶部工具栏 */}
      <div className="image-edit-toolbar">
        <Space size={4} wrap>
          <Button icon={<UploadOutlined />} onClick={() => setSurveyLoadOpen(true)}>
            勘察图像加载
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => setSurveyExportOpen(true)}>
            勘察图像导出
          </Button>

          <Divider orientation="vertical" />

          <Button icon={<FileImageOutlined />} onClick={() => setImageLabelImportOpen(true)}>
            图像标识加载
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => setImageLabelExportOpen(true)}>
            图像标识导出
          </Button>

          <Divider orientation="vertical" />

          <Dropdown.Button menu={surveyPhotoMenu} icon={<DownOutlined />} onClick={() => handleOpenSurveyPhoto("normal")}>
            <CameraOutlined />
            <span>勘察拍照</span>
          </Dropdown.Button>
          <Button icon={<HddOutlined />} onClick={handleOpenCabinetPhoto}>
            屏柜拍照
          </Button>

          <Divider orientation="vertical" />

          <Button icon={<CheckCircleOutlined />} onClick={handleOpenVerifyTask}>
            验证任务
          </Button>
        </Space>
      </div>

      {/* 主体：左右布局 */}
      <div className="image-edit-body" ref={containerRef}>
        {/* 左侧：设备区地图 */}
        <div
          className={`image-edit-sider${mapVisible ? "" : " image-edit-sider-collapsed"}`}
          style={{ width: mapVisible ? leftWidth : 32, minWidth: 0, overflow: "hidden" }}
          onClick={mapVisible ? undefined : () => setMapVisible(true)}
        >
          <div className="image-edit-sider-title" style={{ borderRadius: mapVisible ? "4px 4px 0 0" : 4, justifyContent: mapVisible ? undefined : "center", flex: mapVisible ? undefined : 1 }}>
            <span className="image-edit-title-text" style={{ display: mapVisible ? "" : "none" }}>设备区地图</span>
            <span
              className="image-edit-toggle-btn"
              onClick={(e) => { setMapVisible(!mapVisible); if (!mapVisible) e.stopPropagation(); }}
              style={{ marginLeft: mapVisible ? "auto" : 0 }}
            >{mapVisible ? '<' : '>'}</span>
          </div>
          <div className="image-edit-map" ref={viewerContainerRef} style={{ display: mapVisible ? "" : "none" }}>
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
              <Radio.Group value={ptzSide} onChange={(e) => setPtzSide(e.target.value)} size="middle">
                <Radio.Button value="left">云台左</Radio.Button>
                <Radio.Button value="right">云台右</Radio.Button>
              </Radio.Group>
              <span className="image-edit-header-info">
                <b>区域：</b>{selBayId ? bayList.find((b) => b.id === selBayId)?.bayName || "—" : "—"}&emsp;|&emsp;全部 {totalImageCount}张&emsp;已标 {calibratedImageCount}张
              </span>
              <Button size="small" style={{ marginLeft: "auto" }} onClick={() => resetViewRef.current?.()}>重置视角</Button>
            </div>
            <div className="image-edit-main-body" ref={imageContainerRef} style={{ position: "relative" }}>
              <ImageCanvas
                canvasRef={imageCanvasRef}
                containerRef={imageContainerRef}
                images={taskImages}
                calibrationRects={calibrationRects}
                resetViewRef={resetViewRef}
                onImageDoubleClick={handleImageDoubleClick}
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
          {/* 点表 */}
          {pointTableVisible ? (
            <div className="image-edit-point-table" style={{ width: rightWidth, minWidth: 120 }}>
              <div className="image-edit-sider-title">
                <span className="image-edit-title-text">点表</span>
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
              <div className="point-filter-btns">
                <span
                  className={`point-filter-btn${pointFilter === "all" ? " active" : ""}`}
                  onClick={() => setPointFilter("all")}
                >全部</span>
                <span
                  className={`point-filter-btn${pointFilter === "marked" ? " active" : ""}`}
                  onClick={() => setPointFilter("marked")}
                >已标</span>
                <span
                  className={`point-filter-btn${pointFilter === "unmarked" ? " active" : ""}`}
                  onClick={() => setPointFilter("unmarked")}
                >未标</span>
              </div>
            </div>
            <div className="image-edit-point-list">
              <Checkbox.Group
                style={{ width: "100%" }}
                value={checkedPoints}
                onChange={(v) => setCheckedPoints(v as number[])}
              >
                {points
                  .filter((p) => !nameFilter || p.pointName.includes(nameFilter))
                  .filter((p) => pointFilter === "all" || (pointFilter === "marked" ? calibratedPointCodes.has(p.pointCode) : !calibratedPointCodes.has(p.pointCode)))
                  .map((p) => {
                    const isCalibrated = calibratedPointCodes.has(p.pointCode);
                    return (
                    <div key={p.id} className="image-edit-point-item">
                      <Checkbox value={p.id}><span className="image-edit-point-name">{p.pointName}</span></Checkbox>
                      <span className={`image-edit-point-status${isCalibrated ? " marked" : " unmarked"}`}>
                        {isCalibrated ? "已标" : "未标"}
                      </span>
                    </div>
                    );
                  })}
              </Checkbox.Group>
            </div>
          </div>
          ) : (
            <div className="image-edit-point-table-collapsed" onClick={() => setPointTableVisible(true)}>
              {'<'}
            </div>
          )}
        </div>
      </div>

      {/* 勘察图像加载弹窗 */}
      <SurveyImageLoad open={surveyLoadOpen} onClose={() => setSurveyLoadOpen(false)} onImport={handleSurveyLoad} onTaskImport={handleTaskLoad} />

      {/* 勘察图像导出弹窗 */}
      <SurveyImageExport open={surveyExportOpen} onClose={() => setSurveyExportOpen(false)} />

      {/* 图像标识加载/导出弹窗 */}
      <ImageLabelTransfer
        open={imageLabelImportOpen}
        mode="import"
        onClose={() => setImageLabelImportOpen(false)}
        onImported={(mapName) => {
          if (mapName === loadedMapRef.current) refreshCalibratedRects(mapName);
        }}
      />
      <ImageLabelTransfer
        open={imageLabelExportOpen}
        mode="export"
        onClose={() => setImageLabelExportOpen(false)}
      />

      <SurveyPhotoModal
        open={surveyPhotoOpen}
        title={surveyPhotoMode === "supplement" ? "补充勘察拍照" : "勘察拍照"}
        mode={surveyPhotoMode}
        projectName={selectedProject}
        mapName={loadedMap}
        onClose={() => setSurveyPhotoOpen(false)}
        onDispatch={handleSurveyPhotoDispatch}
      />

      <CabinetPhotoModal
        open={cabinetPhotoOpen}
        projectName={selectedProject}
        mapName={loadedMap}
        onClose={() => setCabinetPhotoOpen(false)}
        onDispatch={handleCabinetPhotoDispatch}
      />

      <VerifyTaskModal
        open={verifyTaskOpen}
        projectName={selectedProject}
        onClose={() => setVerifyTaskOpen(false)}
      />

      {/* 标定视图（双击图片进入） */}
      {calibrationImage && (
        <CalibrationView
          key={calibrationImage.id}
          image={calibrationImage}
          taskDir={surveyDirRef.current}
          mapName={loadedMap}
          selBayId={selBayId}
          onSelBayIdChange={setSelBayId}
          nameFilter={nameFilter}
          onNameFilterChange={setNameFilter}
          pointFilter={pointFilter}
          onPointFilterChange={setPointFilter}
          onBack={() => { setCalibrationImage(null); refreshCalibratedRects(); }}
        />
      )}
    </div>
  );
}
