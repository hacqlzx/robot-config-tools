import { useRef, useState, useEffect, useCallback } from "react";
import { Button, Select, Input, Checkbox, Space, App, Segmented } from "antd";
import {
  ArrowLeftOutlined,
  AimOutlined,
  DragOutlined,
  LinkOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { useResizable } from "@/components/useResizable";
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
  mapCode: string;
  data: Array<{
    imageId: number;
    imageName: string;
    spId: number;
    side: "left" | "right";
    rects: RectData[];
  }>;
}

interface Props {
  image: ImageItem;
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

export default function CalibrationView({ image, taskDir, mapName, selBayId, onSelBayIdChange, nameFilter, onNameFilterChange, pointFilter, onPointFilterChange, onBack }: Props) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<"move" | "select">("move");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<RectData[]>([]);
  const [pendingRect, setPendingRect] = useState<RectData | null>(null);
  const [selectedRectId, setSelectedRectId] = useState<number | null>(null);

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
  // 缓存 JSON 中所有图片的标定数据，用于计算点位总绑定次数
  const allDataRef = useRef<CalibrationFileData["data"]>([]);

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

  // 拉取间隔列表
  useEffect(() => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !window.electronAPI?.db?.bay) return;
    window.electronAPI.db.bay.list(project).then((list: any[]) => {
      setBayList(list.map((b) => ({ id: b.id, bayName: b.bayName })));
    }).catch(() => {});
  }, []);

  // 查询点位
  useEffect(() => {
    const project = localStorage.getItem("selectedProject");
    if (!project || !selBayId || !window.electronAPI?.db?.point) {
      if (!selBayId) setPoints([]);
      return;
    }
    window.electronAPI.db.point.list(project).then((list: any[]) => {
      setPoints(
        list
          .filter((p: any) => p.bayId === selBayId)
          .map((p: any) => ({ id: p.id, pointCode: p.pointCode, pointName: p.pointName, demarcateState: p.demarcateState }))
      );
    }).catch(() => setPoints([]));
  }, [selBayId]);

  // 加载已有标定数据
  useEffect(() => {
    const loadData = async () => {
      if (!taskDir || !window.electronAPI?.readLargeFile) return;
      try {
        const buf = await window.electronAPI.readLargeFile(`${taskDir}/勘察数据.json`);
        const json = JSON.parse(new TextDecoder().decode(buf)) as CalibrationFileData;
        allDataRef.current = json.data || [];
        const entry = json.data?.find(
          (d) => d.imageId === image.id
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
  }, [taskDir, image.spId, image.side]);

  // 自动保存
  const saveData = useCallback(() => {
    const td = taskDirRef.current;
    const project = localStorage.getItem("selectedProject") || "";
    if (!td || !project || !window.electronAPI?.project) return;
    const allRects = [...rectsRef.current];
    const fileData: CalibrationFileData = {
      mapCode: mapName || "",
      data: [
        {
          imageId: imageRef.current.id,
          imageName: imageRef.current.visName,
          spId: imageRef.current.spId,
          side: imageRef.current.side,
          rects: allRects,
        },
      ],
    };

    // 从绝对路径中提取相对子路径（taskDir 格式: {root}\project\{project}\勘察图\{taskName}）
    const idx = td.indexOf("勘察图");
    const relPath = idx !== -1 ? td.slice(idx).replace(/\\/g, "/") : td;
    const subPath = `${relPath}/勘察数据.json`;

    // 先读取现有文件，合并其他 spId/side 的数据
    const save = async (finalData: CalibrationFileData) => {
      try {
        const buf = await window.electronAPI!.readLargeFile(`${td}/勘察数据.json`);
        const existing = JSON.parse(new TextDecoder().decode(buf)) as CalibrationFileData;
        const other = (existing.data || []).filter(
          (d) => d.imageId !== imageRef.current.id
        );
        finalData.data = [...other, finalData.data[0]];
      } catch {
        // 文件不存在
      }
      const content = JSON.stringify(finalData, null, 2);
      await window.electronAPI!.project.writeFile(project, subPath, new TextEncoder().encode(content));
      allDataRef.current = finalData.data;
      console.log("[Calibration] 保存成功:", subPath);
    };

    save(fileData).catch((e) => console.error("[Calibration] 保存失败:", e));
  }, [mapName]);

  const saveTimerRef = useRef<number>(0);
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(saveData, AUTO_SAVE_INTERVAL);
  }, [saveData]);

  // 初始自适应：图片适配画布
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    canvas.width = cw;
    canvas.height = ch;
    const imgW = imgWRef.current;
    const imgH = imgHRef.current;
    const s = Math.min(cw / imgW, ch / imgH);
    scaleRef.current = s;
    panRef.current = {
      x: (cw - imgW * s) / 2,
      y: (ch - imgH * s) / 2,
    };
    scheduleDraw();
  }, [image]);

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

    // 缩放指示 + 选中矩形距离信息（move 模式）
    if (s !== 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "12px sans-serif";
      ctx.fillText(`${Math.round(s * 100)}%`, 8, 20);
    }
  }, [image]);

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(draw);
    }
  }, [draw]);

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
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      const oldScale = scaleRef.current;
      const oldPan = panRef.current;
      const newScale = Math.max(0.05, Math.min(10, oldScale * factor));
      const worldX = (mx - oldPan.x) / oldScale;
      const worldY = (my - oldPan.y) / oldScale;
      panRef.current = { x: mx - worldX * newScale, y: my - worldY * newScale };
      scaleRef.current = newScale;
      scheduleDraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [scheduleDraw]);

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
      // 删除选中的矩形
      setRects((prev) => prev.filter((r) => r.id !== rid));
      setPendingRect((prev) => (prev?.id === rid ? null : prev));
      setSelectedRectId(null);
      scheduleSave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduleSave]);

  // 绑定：将点位绑定到选中/待定的矩形
  const handleBindPoint = (pointCode: string, pointName: string) => {
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
    const binding: PointBinding = { pointCode, pointName };
    const updated = { ...bindTo, bindings: [...bindTo.bindings, binding] };
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
  const handleUnbindPoint = (pointCode: string) => {
    const bindTo = rectsRef.current.find((r) => r.id === selectedRef.current);
    if (!bindTo) {
      message.warning("请先选中一个矩形框");
      return;
    }
    if (!bindTo.bindings.some((b) => b.pointCode === pointCode)) {
      message.info("该点位未绑定到此矩形");
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
    for (const entry of allDataRef.current) {
      if (entry.imageId === imageRef.current.id) continue;
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
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
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
      </div>

      <div className="calibration-body" ref={bodyRef}>
        <div className="calibration-main">
          <div className="calibration-canvas-wrap" ref={containerRef}>
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
            <span className="image-edit-title-text">点表模块</span>
          </div>
          <div className="image-edit-point-filters">
            <Segmented
              size="small"
              value={pointFilter}
              onChange={(v) => onPointFilterChange(v as "all" | "marked" | "unmarked")}
              options={[
                { value: "all", label: "全部" },
                { value: "marked", label: "已标" },
                { value: "unmarked", label: "未标" },
              ]}
              style={{ width: "100%", marginBottom: 8, border: "1px solid #d9d9d9", borderRadius: 20, padding: 2 }}
            />
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
