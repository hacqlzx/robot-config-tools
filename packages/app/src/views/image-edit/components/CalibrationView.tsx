import { useRef, useState, useEffect, useCallback } from "react";
import { Button, Select, Input, Checkbox, Space, App, Tooltip } from "antd";
import {
  ArrowLeftOutlined,
  AimOutlined,
  CompressOutlined,
  DragOutlined,
  LinkOutlined,
  DisconnectOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
import { useSelectedProject } from "@/stores/appContextStore";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";
import "./CalibrationView.scss";

/** 标定矩形（图片坐标系） */
interface PointBinding {
  pointCode: string;
  pointName: string;
}

interface RectData {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bindings: PointBinding[];
}

/** 勘察数据文件结构 */
interface CalibrationFileData {
  version?: number;
  mapCode?: string;
  data: Array<{
    mapCode?: string;
    imageId: number;
    imageName: string;
    spId: number;
    side: "left" | "right";
    rects: RectData[];
  }>;
}

interface Props {
  image: ImageItem & { img: HTMLImageElement };
  taskDir: string;
  mapName: string | null;
  selBayId: number | undefined;
  onSelBayIdChange: (v: number | undefined) => void;
  nameFilter: string;
  onNameFilterChange: (v: string) => void;
  pointFilter: "all" | "marked" | "unmarked";
  onPointFilterChange: (v: "all" | "marked" | "unmarked") => void;
  onBack: () => void;
}

/** 自动保存间隔（毫秒） */
const AUTO_SAVE_INTERVAL = 500;

/** 缩放时右下角手柄半边长 */
const HANDLE_SIZE = 8;
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.2;

const SURVEY_DIR_NAME = "勘察数据";
const CALIBRATION_FILE_NAME = "勘察数据.json";

function getSharedCalibrationFilePath(taskDir: string): string {
  const normalized = taskDir.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[parts.length - 1] === SURVEY_DIR_NAME) return `${normalized}/${CALIBRATION_FILE_NAME}`;
  const root = normalized.replace(/[\\/][^\\/]+$/, "");
  return `${root}/${CALIBRATION_FILE_NAME}`;
}

function getEntryMapCode(entry: CalibrationFileData["data"][number], fileMapCode?: string): string {
  return String(entry.mapCode || fileMapCode || "");
}

function normalizeCalibrationEntries(file?: CalibrationFileData): CalibrationFileData["data"] {
  return (file?.data || []).map((entry) => ({
    ...entry,
    mapCode: getEntryMapCode(entry, file?.mapCode),
  }));
}

function isSameMapCode(a?: string | null, b?: string | null): boolean {
  return String(a || "") === String(b || "");
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export default function CalibrationView({ image, taskDir, mapName, selBayId, onSelBayIdChange, nameFilter, onNameFilterChange, pointFilter, onPointFilterChange, onBack }: Props) {
  const { message } = App.useApp();
  const selectedProject = useSelectedProject();
  const [mode, setMode] = useState<"move" | "select">("move");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<RectData[]>([]);
  const [pendingRect, setPendingRect] = useState<RectData | null>(null);
  const [selectedRectId, setSelectedRectId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [displayScale, setDisplayScale] = useState(1);

  // 缩放/平移
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{
    type: "pan" | "moveRect" | "resizeRect";
    mx: number;
    my: number;
    startImgX?: number;
    startImgY?: number;
    rectId?: number;
    startRect?: RectData;
  } | null>(null);
  const selStartRef = useRef<{ x: number; y: number } | null>(null);
  const selRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rafRef = useRef(0);
  const hoverRef = useRef<{ type: "none" | "resize"; rectId: number }>({ type: "none", rectId: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; names: string[] } | null>(null);

  const imageRef = useRef(image);
  imageRef.current = image;
  const imgWRef = useRef(image.img.naturalWidth);
  const imgHRef = useRef(image.img.naturalHeight);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const pendingRef = useRef(pendingRect);
  pendingRef.current = pendingRect;
  const selectedRef = useRef(selectedRectId);
  selectedRef.current = selectedRectId;
  const taskDirRef = useRef(taskDir);
  taskDirRef.current = taskDir;
  const mapNameRef = useRef(mapName);
  mapNameRef.current = mapName;
  // 缓存 JSON 中所有图片的标定数据，用于计算点位总绑定次数
  const allDataRef = useRef<CalibrationFileData["data"]>([]);
  const saveTimerRef = useRef<number>(0);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const savedStatusTimerRef = useRef<number>(0);

  // 点表
  const [bayList, setBayList] = useState<{ id: number; bayName: string }[]>([]);
  const [points, setPoints] = useState<{ id: number; pointCode: string; pointName: string; demarcateState: number }[]>([]);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // 高亮点位编码（来自选中矩形）
  const selectedRect = [...rects, ...(pendingRect ? [pendingRect] : [])].find(
    (r) => r.id === selectedRectId
  );
  const highlightedPointCodes = new Set<string>();
  if (selectedRect) {
    for (const b of selectedRect.bindings) highlightedPointCodes.add(b.pointCode);
  }

  const bodyRef = useRef<HTMLDivElement>(null);
  const { width: rightWidth, onMouseDown: onRightMouseDown } = useResizable({
    containerRef: bodyRef,
    initialPercent: 0.2,
    minWidth: 200,
    maxPercent: 0.5,
    reverse: true,
  });

  // 拉取设备区间隔列表
  useEffect(() => {
    if (!selectedProject || !window.electronAPI?.db?.bay) {
      setBayList([]);
      return;
    }
    window.electronAPI.db.bay.list(selectedProject).then((list: any[]) => {
      setBayList(
        list
          .filter((b) => String(b.bayType || "").trim() === "设备区")
          .map((b) => ({ id: b.id, bayName: b.bayName })),
      );
    }).catch(() => {});
  }, [selectedProject]);

  // 查询点位
  useEffect(() => {
    if (!selectedProject || !selBayId || !window.electronAPI?.db?.point) {
      if (!selBayId) setPoints([]);
      return;
    }
    window.electronAPI.db.point.list(selectedProject).then((list: any[]) => {
      setPoints(
        list
          .filter((p: any) => p.bayId === selBayId)
          .map((p: any) => ({ id: p.id, pointCode: p.pointCode, pointName: p.pointName, demarcateState: p.demarcateState }))
      );
    }).catch(() => setPoints([]));
  }, [selBayId, selectedProject]);

  // 加载已有标定数据
  useEffect(() => {
    const loadData = async () => {
      if (!taskDir || !window.electronAPI?.readLargeFile) return;
      try {
        const filePath = getSharedCalibrationFilePath(taskDir);
        if (!filePath) return;
        const buf = await window.electronAPI.readLargeFile(filePath);
        const json = JSON.parse(new TextDecoder().decode(buf)) as CalibrationFileData;
        const entries = normalizeCalibrationEntries(json);
        const currentMapCode = mapNameRef.current || json.mapCode || "";
        allDataRef.current = entries;
        const boundPointCodes = new Set(
          entries.flatMap((item) => item.rects || [])
            .flatMap((rect) => rect.bindings || [])
            .map((binding) => binding.pointCode)
            .filter(Boolean),
        );
        if (selectedProject && window.electronAPI?.db?.point?.bindCalibrationId) {
          void Promise.all(
            [...boundPointCodes].map((pointCode) => window.electronAPI!.db.point.bindCalibrationId(pointCode, selectedProject)),
          ).catch((error) => console.error("[Calibration] 补齐标定 ID 失败:", error));
        }
        const entry = json.data?.find(
          (d) => d.imageId === image.id && isSameMapCode(getEntryMapCode(d, json.mapCode), currentMapCode)
        );
        if (entry?.rects) {
          setRects(entry.rects);
        } else {
          setRects([]);
          setPendingRect(null);
        }
      } catch {
        allDataRef.current = [];
        setRects([]);
      }
    };
    loadData();
  }, [taskDir, image.spId, image.side, selectedProject]);

  const buildSaveData = useCallback((rectSnapshot: RectData[]): CalibrationFileData => ({
    version: 2,
    mapCode: mapNameRef.current || "",
    data: [
      {
        mapCode: mapNameRef.current || "",
        imageId: imageRef.current.id,
        imageName: imageRef.current.visName,
        spId: imageRef.current.spId,
        side: imageRef.current.side,
        rects: rectSnapshot,
      },
    ],
  }), []);

  const saveSnapshot = useCallback(async (rectSnapshot: RectData[]) => {
    const td = taskDirRef.current;
    if (!td || !selectedProject || !window.electronAPI?.project) return;

    // 点表绑定/标定结果是项目级共享数据；导入图片时只覆盖各地图数据目录，不能覆盖这个文件。
    const sharedFilePath = getSharedCalibrationFilePath(td);
    if (!sharedFilePath) return;
    const subPath = `${SURVEY_DIR_NAME}/${CALIBRATION_FILE_NAME}`;
    const finalData = buildSaveData(rectSnapshot);

    // 先读取现有文件，合并其他 spId/side 的数据
    try {
      const buf = await window.electronAPI!.readLargeFile(sharedFilePath);
      const existing = JSON.parse(new TextDecoder().decode(buf)) as CalibrationFileData;
      const currentMapCode = mapNameRef.current || existing.mapCode || "";
      const other = normalizeCalibrationEntries(existing).filter(
        (d) => !(d.imageId === imageRef.current.id && isSameMapCode(d.mapCode, currentMapCode))
      );
      finalData.data = [...other, finalData.data[0]];
    } catch {
      // 文件不存在
    }
    const content = JSON.stringify(finalData, null, 2);
    await window.electronAPI!.project.writeFile(selectedProject, subPath, new TextEncoder().encode(content));
    allDataRef.current = finalData.data;
    console.log("[Calibration] 保存成功:", subPath);
  }, [buildSaveData, selectedProject]);

  const flushSave = useCallback(async () => {
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus("saving");
    try {
      do {
        saveQueuedRef.current = false;
        await saveSnapshot([...rectsRef.current]);
      } while (saveQueuedRef.current);

      setSaveStatus("saved");
      clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = window.setTimeout(() => setSaveStatus("idle"), 1200);
    } catch (e) {
      console.error("[Calibration] 保存失败:", e);
      setSaveStatus("error");
    } finally {
      saveInFlightRef.current = false;
    }
  }, [saveSnapshot]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("pending");
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = 0;
      void flushSave();
    }, AUTO_SAVE_INTERVAL);
  }, [flushSave]);

  const handleBack = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = 0;
    }
    flushSave().finally(onBack);
  }, [flushSave, onBack]);

  useEffect(() => () => {
    clearTimeout(saveTimerRef.current);
    clearTimeout(savedStatusTimerRef.current);
  }, []);

  // 画布尺寸变化
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      canvas.width = cw;
      canvas.height = ch;
      scheduleDraw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef]);

  // 关键词 → 当前可见的矩形（含 pending）
  const allRects = (): RectData[] => {
    const result = [...rects];
    if (pendingRect) result.push(pendingRect);
    return result;
  };

  const drawRectLabel = (
    ctx: CanvasRenderingContext2D,
    r: RectData,
    s: number,
    highlighted: boolean,
  ) => {
    if (r.bindings.length === 0) return;
    const firstName = r.bindings[0].pointName;
    const suffix = r.bindings.length > 1 ? "..." : "";
    const fullLabel = `${firstName}${suffix}`;
    const font = `${14 / s}px sans-serif`;
    ctx.font = font;
    const maxW = r.w - 10 / s;
    let label = fullLabel;
    while (ctx.measureText(label).width > maxW && label.length > 4) {
      label = label.slice(0, -4) + "...";
    }
    const metrics = ctx.measureText(label);
    const tw = metrics.width;
    const th = 14 / s;
    const pad = 3 / s;
    const lx = r.x + pad;
    const ly = r.y + pad;
    ctx.fillStyle = highlighted ? "rgba(255,255,0,0.85)" : "rgba(0,0,0,0.6)";
    ctx.fillRect(lx, ly, tw + pad * 2, th + pad * 2);
    ctx.fillStyle = highlighted ? "#000" : "#fff";
    ctx.fillText(label, lx + pad, ly + th * 0.85);
    // 右下角手柄（选中时）
    if (highlighted) {
      ctx.fillStyle = "#ff0";
      const hs = HANDLE_SIZE / s;
      ctx.fillRect(r.x + r.w - hs, r.y + r.h - hs, hs * 2, hs * 2);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(r.x + r.w - hs, r.y + r.h - hs, hs * 2, hs * 2);
    }
  };

  const draw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = imageRef.current.img;
    if (!img || !img.complete) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const s = scaleRef.current;
    const p = panRef.current;
    const imgW = imgWRef.current;
    const imgH = imgHRef.current;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, imgW, imgH);

    const rid = selectedRef.current;
    const pend = pendingRef.current;
    const bound = rectsRef.current;

    // 绘制已绑定的矩形（红色）
    for (const r of bound) {
      const isSelected = r.id === rid;
      ctx.strokeStyle = isSelected ? "#ff0" : "#ff2a1a";
      ctx.lineWidth = isSelected ? 3 / s : 2 / s;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "rgba(255,42,26,0.08)";
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // 标签
      drawRectLabel(ctx, r, s, isSelected);
    }

    // 绘制未绑定矩形（蓝色）
    if (pend) {
      const isSelected = pend.id === rid;
      ctx.strokeStyle = isSelected ? "#ff0" : "#1890ff";
      ctx.lineWidth = isSelected ? 3 / s : 2 / s;
      ctx.strokeRect(pend.x, pend.y, pend.w, pend.h);
      ctx.fillStyle = "rgba(24,144,255,0.08)";
      ctx.fillRect(pend.x, pend.y, pend.w, pend.h);
      drawRectLabel(ctx, pend, s, isSelected);
    }

    // 绘制拖拽中的矩形
    const sr = selRectRef.current;
    if (sr) {
      ctx.strokeStyle = "#1890ff";
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([6 / s, 3 / s]);
      ctx.strokeRect(sr.x, sr.y, sr.w, sr.h);
      ctx.setLineDash([]);
    }

    ctx.restore();

  }, [image]);

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(draw);
    }
  }, [draw]);

  const fitToView = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    canvas.width = cw;
    canvas.height = ch;
    const imgW = imageRef.current.img.naturalWidth || imgWRef.current;
    const imgH = imageRef.current.img.naturalHeight || imgHRef.current;
    imgWRef.current = imgW;
    imgHRef.current = imgH;
    const s = clampScale(Math.min(cw / imgW, ch / imgH));
    scaleRef.current = s;
    panRef.current = {
      x: (cw - imgW * s) / 2,
      y: (ch - imgH * s) / 2,
    };
    setDisplayScale(s);
    scheduleDraw();
  }, [scheduleDraw]);

  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    const oldScale = scaleRef.current;
    const oldPan = panRef.current;
    const newScale = clampScale(oldScale * factor);
    if (newScale === oldScale) return;
    const worldX = (sx - oldPan.x) / oldScale;
    const worldY = (sy - oldPan.y) / oldScale;
    panRef.current = {
      x: sx - worldX * newScale,
      y: sy - worldY * newScale,
    };
    scaleRef.current = newScale;
    setDisplayScale(newScale);
    scheduleDraw();
  }, [scheduleDraw]);

  const zoomAtCenter = useCallback((factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    zoomAt(factor, container.clientWidth / 2, container.clientHeight / 2);
  }, [zoomAt]);

  // 初始自适应：图片适配画布
  useEffect(() => { fitToView(); }, [fitToView, image]);

  // 重绘触发
  useEffect(() => { scheduleDraw(); }, [rects, pendingRect, selectedRectId, points, scheduleDraw]);

  // 滚轮缩放（move 模式）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "move") return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      zoomAt(e.deltaY < 0 ? 1.08 : 0.92, mx, my);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // 屏幕坐标 → 图片坐标
  const screenToImage = useCallback((sx: number, sy: number) => {
    const s = scaleRef.current;
    const p = panRef.current;
    return { x: (sx - p.x) / s, y: (sy - p.y) / s };
  }, []);

  // 判断图片坐标点是否在矩形内/手柄区域内
  const hitTest = (imgX: number, imgY: number) => {
    const hs = HANDLE_SIZE / scaleRef.current;
    let foundResize: { rectId: number; rect: RectData } | null = null;
    let foundBody: { rectId: number; rect: RectData } | null = null;

    for (const r of allRects()) {
      if (
        imgX >= r.x + r.w - hs && imgX <= r.x + r.w + hs &&
        imgY >= r.y + r.h - hs && imgY <= r.y + r.h + hs
      ) {
        foundResize = { rectId: r.id, rect: r };
      }
      if (
        imgX >= r.x && imgX <= r.x + r.w &&
        imgY >= r.y && imgY <= r.y + r.h
      ) {
        foundBody = { rectId: r.id, rect: r };
      }
    }
    return { resize: foundResize, body: foundBody };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setTooltip(null);
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const imgPt = screenToImage(mx, my);

    if (mode === "move") {
      const hit = hitTest(imgPt.x, imgPt.y);

      if (hit.resize) {
        setSelectedRectId(hit.resize.rectId);
        dragRef.current = {
          type: "resizeRect",
          mx: e.clientX,
          my: e.clientY,
          startImgX: imgPt.x,
          startImgY: imgPt.y,
          rectId: hit.resize.rectId,
          startRect: { ...hit.resize.rect },
        };
        return;
      }

      if (hit.body) {
        setSelectedRectId(hit.body.rectId);
        dragRef.current = {
          type: "moveRect",
          mx: e.clientX,
          my: e.clientY,
          startImgX: imgPt.x,
          startImgY: imgPt.y,
          rectId: hit.body.rectId,
          startRect: { ...hit.body.rect },
        };
        return;
      }

      setSelectedRectId(null);
      dragRef.current = {
        type: "pan",
        mx: e.clientX,
        my: e.clientY,
        startRect: undefined,
      };
      return;
    }

    // select 模式：先检测是否命中已有框体（点击选中+拖动），否则开始框选
    const hit = hitTest(imgPt.x, imgPt.y);
    if (hit.resize) {
      setSelectedRectId(hit.resize.rectId);
      dragRef.current = {
        type: "resizeRect", mx: e.clientX, my: e.clientY,
        startImgX: imgPt.x, startImgY: imgPt.y,
        rectId: hit.resize.rectId,
        startRect: { ...hit.resize.rect },
      };
      return;
    }
    if (hit.body) {
      setSelectedRectId(hit.body.rectId);
      dragRef.current = {
        type: "moveRect", mx: e.clientX, my: e.clientY,
        startImgX: imgPt.x, startImgY: imgPt.y,
        rectId: hit.body.rectId,
        startRect: { ...hit.body.rect },
      };
      return;
    }

    // 点击空白：开始框选绘制
    setSelectedRectId(null);
    selStartRef.current = { x: imgPt.x, y: imgPt.y };
    selRectRef.current = null;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 任何模式下有拖拽在进行，处理 pan / moveRect / resizeRect
    const d = dragRef.current;
    if (d) {
      if (d.type === "pan") {
        panRef.current = {
          x: panRef.current.x + e.clientX - d.mx,
          y: panRef.current.y + e.clientY - d.my,
        };
        d.mx = e.clientX;
        d.my = e.clientY;
        scheduleDraw();
        return;
      }

      if (d.type === "moveRect" && d.startRect && d.startImgX !== undefined && d.startImgY !== undefined) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cur = screenToImage(mx, my);
        const dx = cur.x - d.startImgX;
        const dy = cur.y - d.startImgY;
        const imgW = imgWRef.current;
        const imgH = imgHRef.current;
        const rw = d.startRect.w;
        const rh = d.startRect.h;
        updateRect(d.rectId, {
          x: Math.max(0, Math.min(imgW - rw, d.startRect.x + dx)),
          y: Math.max(0, Math.min(imgH - rh, d.startRect.y + dy)),
        });
        return;
      }

      if (d.type === "resizeRect" && d.startRect && d.startImgX !== undefined && d.startImgY !== undefined) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cur = screenToImage(mx, my);
        const imgW = imgWRef.current;
        const imgH = imgHRef.current;
        const newW = Math.max(20, Math.min(imgW - d.startRect.x, d.startRect.w + cur.x - d.startImgX));
        const newH = Math.max(20, Math.min(imgH - d.startRect.y, d.startRect.h + cur.y - d.startImgY));
        updateRect(d.rectId, { w: newW, h: newH });
        return;
      }
      return;
    }

    // 无拖拽：move 模式做 hover 检测，select 模式做框选绘制
    if (mode === "move") {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const imgPt = screenToImage(mx, my);
      const hit = hitTest(imgPt.x, imgPt.y);
      if (hit.resize) {
        hoverRef.current = { type: "resize", rectId: hit.resize.rectId };
      } else {
        hoverRef.current = { type: "none", rectId: 0 };
      }
      const hoveredRect = hit.body || hit.resize;
      if (hoveredRect && hoveredRect.rect.bindings.length > 0) {
        const names = hoveredRect.rect.bindings.map((b) => b.pointName);
        setTooltip({ x: e.clientX + 12, y: e.clientY - 8, names });
      } else {
        setTooltip(null);
      }
      scheduleDraw();
      return;
    }

    // select 模式：拖拽绘制矩形（限制在图片范围内）
    if (mode === "select" && selStartRef.current) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cur = screenToImage(mx, my);
      const imgW = imgWRef.current;
      const imgH = imgHRef.current;
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const sx = clamp(selStartRef.current.x, 0, imgW);
      const sy = clamp(selStartRef.current.y, 0, imgH);
      const cx = clamp(cur.x, 0, imgW);
      const cy = clamp(cur.y, 0, imgH);
      selRectRef.current = {
        x: Math.min(sx, cx),
        y: Math.min(sy, cy),
        w: Math.abs(cx - sx),
        h: Math.abs(cy - sy),
      };
      scheduleDraw();
    }
  };

  const onMouseUp = () => {
    // 拖拽结束（move/resize/pan — 任意模式）
    if (dragRef.current) {
      dragRef.current = null;
      return;
    }

    // 框选绘制结束（select 模式下的绘制矩形）
    if (selStartRef.current && selRectRef.current) {
      const r = selRectRef.current;
      if (r.w > 10 && r.h > 10) {
        const newRect: RectData = {
          id: Date.now(),
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          bindings: [],
        };
        setPendingRect(newRect);
        setSelectedRectId(newRect.id);
      }
    }
    selStartRef.current = null;
    selRectRef.current = null;
    scheduleDraw();
  };

  // 更新矩形（move/resize 回调）
  const updateRect = (rectId: number, patch: Partial<RectData>) => {
    const newRects = rectsRef.current.map((r) =>
      r.id === rectId ? { ...r, ...patch } : r
    );
    setRects(newRects);
    const pend = pendingRef.current;
    if (pend && pend.id === rectId) {
      setPendingRect({ ...pend, ...patch });
    }
    scheduleDraw();
    scheduleSave();
  };

  // 删除键处理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const rid = selectedRef.current;
      if (!rid) return;
      const target = rectsRef.current.find((rect) => rect.id === rid) || (pendingRef.current?.id === rid ? pendingRef.current : null);
      const pointCodes = [...new Set((target?.bindings || []).map((binding) => binding.pointCode).filter(Boolean))];
      void (async () => {
        try {
          if (pointCodes.length > 0) {
            if (!selectedProject || !window.electronAPI?.db?.point?.clearCalibrationId) {
              throw new Error("当前环境无法清除标定 ID");
            }
            await Promise.all(pointCodes.map((pointCode) => window.electronAPI!.db.point.clearCalibrationId(pointCode, selectedProject)));
          }
          setRects((prev) => prev.filter((r) => r.id !== rid));
          setPendingRect((prev) => (prev?.id === rid ? null : prev));
          setSelectedRectId(null);
          scheduleSave();
        } catch (error) {
          message.error("删除标定框失败: " + (error instanceof Error ? error.message : String(error)));
        }
      })();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [message, scheduleSave, selectedProject]);

  // 绑定：将点位绑定到选中/待定的矩形
  const handleBindPoint = async (pointCode: string, pointName: string) => {
    const pend = pendingRef.current;
    const bindTo = pend || rectsRef.current.find((r) => r.id === selectedRef.current);
    if (!bindTo) {
      message.warning("请先绘制或选中一个矩形框");
      return;
    }
    if (bindTo.bindings.some((b) => b.pointCode === pointCode)) {
      message.info("该点位已绑定到此矩形");
      return;
    }
    if (bindTo.bindings.length > 0) {
      message.warning("一个标定框只能绑定一个点位");
      return;
    }
    if (getPointBindCount(pointCode) > 0) {
      message.warning("该点位已绑定到其他标定框，请先解绑");
      return;
    }
    if (!selectedProject || !window.electronAPI?.db?.point?.bindCalibrationId) {
      message.error("当前环境无法生成标定 ID");
      return;
    }
    try {
      await window.electronAPI.db.point.bindCalibrationId(pointCode, selectedProject);
    } catch (error) {
      message.error("绑定失败: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const binding: PointBinding = { pointCode, pointName };
    const updated = { ...bindTo, bindings: [binding] };
    if (pend && pend.id === bindTo.id) {
      setPendingRect(null);
      setRects((prev) => [...prev, updated]);
    } else {
      setRects((prev) => prev.map((r) => (r.id === bindTo.id ? updated : r)));
    }
    setSelectedRectId(bindTo.id);
    scheduleSave();
    message.success("绑定成功");
  };

  // 解绑：从选中矩形中移除该点位绑定
  const handleUnbindPoint = async (pointCode: string) => {
    const bindTo = rectsRef.current.find((r) => r.id === selectedRef.current);
    if (!bindTo) {
      message.warning("请先选中一个矩形框");
      return;
    }
    if (!bindTo.bindings.some((b) => b.pointCode === pointCode)) {
      message.info("该点位未绑定到此矩形");
      return;
    }
    if (!selectedProject || !window.electronAPI?.db?.point?.clearCalibrationId) {
      message.error("当前环境无法清除标定 ID");
      return;
    }
    try {
      await window.electronAPI.db.point.clearCalibrationId(pointCode, selectedProject);
    } catch (error) {
      message.error("解绑失败: " + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const newBindings = bindTo.bindings.filter((b) => b.pointCode !== pointCode);
    if (newBindings.length === 0) {
      setRects((prev) => prev.filter((r) => r.id !== bindTo.id));
      setSelectedRectId(null);
    } else {
      setRects((prev) =>
        prev.map((r) => (r.id === bindTo.id ? { ...r, bindings: newBindings } : r))
      );
    }
    scheduleSave();
    message.success("解绑成功");
  };

  // 计算某点位在所有图片中的总绑定次数（allDataRef 存的是上次保存的快照，rectsRef 是当前内存数据）
  const getPointBindCount = (pointCode: string): number => {
    let count = 0;
    const currentMapCode = mapNameRef.current || "";
    for (const entry of allDataRef.current) {
      if (entry.imageId === imageRef.current.id && isSameMapCode(entry.mapCode, currentMapCode)) continue;
      for (const r of entry.rects) {
        count += r.bindings.filter((b) => b.pointCode === pointCode).length;
      }
    }
    for (const r of rectsRef.current) {
      count += r.bindings.filter((b) => b.pointCode === pointCode).length;
    }
    if (pendingRef.current) {
      count += pendingRef.current.bindings.filter((b) => b.pointCode === pointCode).length;
    }
    return count;
  };

  const cursorStyle = (() => {
    if (mode === "select") return "crosshair";
    if (dragRef.current?.type === "resizeRect" || hoverRef.current.type === "resize")
      return "nwse-resize";
    if (dragRef.current?.type === "moveRect") return "grabbing";
    if (dragRef.current?.type === "pan") return "grabbing";
    return "grab";
  })();

  return (
    <div className="calibration-view">
      <div className="calibration-toolbar">
        <Space size={8}>
          <Button
            type={mode === "move" ? "primary" : "default"}
            icon={<DragOutlined />}
            onClick={() => { setMode("move"); setSelectedRectId(null); }}
          >
            移动
          </Button>
          <Button
            type={mode === "select" ? "primary" : "default"}
            icon={<AimOutlined />}
            onClick={() => { setMode("select"); setSelectedRectId(null); }}
          >
            框选设备
          </Button>
        </Space>
        <span className="calibration-image-name">
          {image.visName}
          {`  sp${image.spId}·${image.side === "left" ? "云台左" : "云台右"}`}
          {pendingRect ? "  [待绑定]" : ""}
        </span>
        <span className={`calibration-save-status ${saveStatus}`}>
          {saveStatus === "pending" && "待保存"}
          {saveStatus === "saving" && "保存中..."}
          {saveStatus === "saved" && "已保存"}
          {saveStatus === "error" && "保存失败"}
        </span>
        <Button icon={<ArrowLeftOutlined />} onClick={handleBack} style={{ marginLeft: "auto" }}>返回图像编辑</Button>
      </div>

      <div className="calibration-body" ref={bodyRef}>
        <div className="calibration-main">
          <div className="calibration-canvas-wrap" ref={containerRef}>
            <div className="calibration-canvas-toolbar" onMouseDown={(event) => event.stopPropagation()}>
              <Tooltip title="缩小">
                <Button type="text" size="small" aria-label="缩小" icon={<ZoomOutOutlined />} onClick={() => zoomAtCenter(1 / ZOOM_STEP)} />
              </Tooltip>
              <span className="calibration-canvas-scale">{Math.round(displayScale * 100)}%</span>
              <Tooltip title="放大">
                <Button type="text" size="small" aria-label="放大" icon={<ZoomInOutlined />} onClick={() => zoomAtCenter(ZOOM_STEP)} />
              </Tooltip>
              <Tooltip title="适应窗口">
                <Button type="text" size="small" aria-label="适应窗口" icon={<CompressOutlined />} onClick={fitToView} />
              </Tooltip>
            </div>
            <canvas
              ref={canvasRef}
              className="calibration-canvas"
              style={{ cursor: cursorStyle }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            />
            {tooltip && (
              <div
                className="calibration-tooltip"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                {tooltip.names.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="image-edit-resizer" onMouseDown={onRightMouseDown} />

        {/* 右侧点表 */}
        <div className="calibration-point-table" style={{ width: rightWidth, minWidth: 200 }}>
          <div className="image-edit-sider-title">
            <span className="image-edit-title-text">点表</span>
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
              onChange={(v) => onSelBayIdChange(v)}
              options={bayList.map((b) => ({ value: b.id, label: b.bayName }))}
            />
            <Input
              placeholder="搜索停靠点"
              allowClear
              size="small"
              value={nameFilter}
              onChange={(e) => onNameFilterChange(e.target.value)}
            />
            <div className="point-filter-btns">
              <span
                className={`point-filter-btn${pointFilter === "all" ? " active" : ""}`}
                onClick={() => onPointFilterChange("all")}
              >全部</span>
              <span
                className={`point-filter-btn${pointFilter === "marked" ? " active" : ""}`}
                onClick={() => onPointFilterChange("marked")}
              >已标</span>
              <span
                className={`point-filter-btn${pointFilter === "unmarked" ? " active" : ""}`}
                onClick={() => onPointFilterChange("unmarked")}
              >未标</span>
            </div>
          </div>
          <div className="image-edit-point-list">
            {points
              .filter((p) => !nameFilter || p.pointName.includes(nameFilter))
              .filter((p) => {
                if (pointFilter === "all") return true;
                const cnt = getPointBindCount(p.pointCode);
                return pointFilter === "marked" ? cnt > 0 : cnt === 0;
              })
              .map((p) => {
                const bindCount = getPointBindCount(p.pointCode);
                const isHighlighted = highlightedPointCodes.has(p.pointCode);
                // 当前选中的矩形是否已绑定该点位
                const isBoundToSelected = selectedRectId
                  ? allRects().find((r) => r.id === selectedRectId)?.bindings.some((b) => b.pointCode === p.pointCode)
                  : false;
                return (
                  <div
                    key={p.id}
                    className={`image-edit-point-item${isHighlighted ? " point-highlight" : ""}`}
                    style={isHighlighted ? { background: "#e6f7ff" } : undefined}
                  >
                    <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", fontSize: 12 }}>
                      <span className="image-edit-point-name">{p.pointName}</span>
                      <span className="point-bind-count" style={{ marginLeft: 4, flexShrink: 0, color: bindCount > 0 ? "#1890ff" : "#bbb" }}>({bindCount}次)</span>
                    </span>
                    <Space size={2} style={{ flexShrink: 0, marginLeft: 8 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={<LinkOutlined />}
                        onClick={() => handleBindPoint(p.pointCode, p.pointName)}
                        style={{ fontSize: 12, padding: '1px 4px', border: '1px solid #91caff', borderRadius: 4, color: '#1677ff', visibility: isBoundToSelected ? 'hidden' : 'visible' }}
                      />
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DisconnectOutlined />}
                        onClick={() => handleUnbindPoint(p.pointCode)}
                        style={{ fontSize: 12, padding: '1px 4px', border: '1px solid #ffccc7', borderRadius: 4 }}
                      />
                    </Space>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
