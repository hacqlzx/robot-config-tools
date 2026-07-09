import { useState, useCallback, useRef } from "react";
import type { TaskManifest, TaskSPConfig, TaskLoadedImage, TaskImageConfig } from "@/views/image-edit/types/task";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";

interface TaskLoaderState {
  loading: boolean;
  progress: string;
}

const THUMBNAIL_WIDTH = 360;
const COLUMN_HEADER_SPACE = 48;

export interface TaskLoadResult {
  items: ImageItem[];
  surveyDir: string;
  deviceDir: string;
}

/** 布局：按停靠点+组号（spId + pic_loc[1]）分列，列内按序号（pic_loc[0]）从上往下排 */
function computeLayout(images: TaskLoadedImage[], thumbW = 200, thumbH = 150, side?: "left" | "right"): ImageItem[] {
  if (images.length === 0) return [];
  const colGap = 10;

  // 按云台侧过滤
  const filtered = side ? images.filter((img) => img.side === side) : images;
  if (filtered.length === 0) return [];

  // 按 spId + 组号（row = pic_loc[1]）分组，每个停靠点下的组独立一列
  const groups = new Map<string, TaskLoadedImage[]>();
  for (const img of filtered) {
    const key = `${img.spId}_${img.row}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(img);
  }

  // 排序：先 spId，再组号
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const [spA, gA] = a.split("_").map(Number);
    const [spB, gB] = b.split("_").map(Number);
    return spA - spB || gA - gB;
  });

  let xOff = 12;
  const items: ImageItem[] = [];

  for (const key of sortedKeys) {
    const [spId, groupId] = key.split("_").map(Number);
    const group = groups.get(key)!;
    // 组内按序号（col = pic_loc[0]）从上往下排，无间隙
    group.sort((a, b) => a.col - b.col);

    let yOff = COLUMN_HEADER_SPACE;
    const sideLabel = group[0]?.side === "right" ? "云台右" : "云台左";
    const columnLabel = `SP${spId} · 组${groupId + 1} · ${sideLabel}`;
    for (const img of group) {
      items.push({
        imagePath: img.imagePath,
        id: img.config.pic_loc[0] + img.config.pic_loc[1] * 100 + img.spId * 10000 + (img.side === "right" ? 5000 : 0),
        x: xOff,
        y: yOff,
        w: thumbW,
        h: thumbH,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        side: img.side,
        spId: img.spId,
        columnKey: key,
        columnLabel,
        visName: img.config.vis_name,
      });
      yOff += thumbH;
    }
    xOff += thumbW + colGap;
  }
  return items;
}

export function useTaskLoader() {
  const [state, setState] = useState<TaskLoaderState>({ loading: false, progress: "" });
  const rawImagesRef = useRef<TaskLoadedImage[]>([]);
  const resolvedDeviceDirRef = useRef("");

  const pathJoin = (base: string, child: string) => `${base.replace(/[\\/]+$/, "")}/${child}`;

  const loadImageElement = useCallback(async (imagePath: string, name: string): Promise<HTMLImageElement> => {
    const imgBuf = await window.electronAPI!.readLargeFile(imagePath);
    const blob = new Blob([imgBuf]);
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`图片加载失败: ${name}`));
        el.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, []);

  const fileExists = useCallback(async (filePath: string): Promise<boolean> => {
    try {
      await window.electronAPI!.readLargeFile(filePath);
      return true;
    } catch {
      return false;
    }
  }, []);

  const resolveDeviceTaskDir = useCallback(async (taskDir: string): Promise<string> => {
    const normalized = taskDir.replace(/[\\/]+$/, "");
    if (await fileExists(pathJoin(normalized, "json_list.json"))) return normalized;
    const imgDir = pathJoin(normalized, "img");
    if (await fileExists(pathJoin(pathJoin(imgDir, "device"), "json_list.json"))) return pathJoin(imgDir, "device");
    if (await fileExists(pathJoin(imgDir, "json_list.json"))) return imgDir;
    const deviceDir = pathJoin(normalized, "device");
    if (await fileExists(pathJoin(deviceDir, "json_list.json"))) return deviceDir;
    throw new Error("未找到设备区 json_list.json");
  }, [fileExists]);

  const resolveSurveyDir = (taskDir: string, deviceDir: string): string => {
    const normalizedTask = taskDir.replace(/[\\/]+$/, "");
    const normalizedDevice = deviceDir.replace(/[\\/]+$/, "");
    if (/[\\/]img[\\/]device$/i.test(normalizedDevice)) return normalizedDevice.replace(/[\\/]img[\\/]device$/i, "");
    if (/[\\/]img$/i.test(normalizedDevice)) return normalizedDevice.replace(/[\\/]img$/i, "");
    if (/[\\/]device$/i.test(normalizedDevice)) return normalizedDevice.replace(/[\\/]device$/i, "");
    return normalizedTask;
  };

  const loadTask = useCallback(async (taskDir: string): Promise<TaskLoadResult> => {
    setState({ loading: true, progress: "读取任务配置..." });
    const api = window.electronAPI!;
    const deviceDir = await resolveDeviceTaskDir(taskDir);
    const surveyDir = resolveSurveyDir(taskDir, deviceDir);
    resolvedDeviceDirRef.current = deviceDir;

    const manifestBuf = await api.readLargeFile(pathJoin(deviceDir, "json_list.json"));
    const manifest: TaskManifest = JSON.parse(new TextDecoder().decode(manifestBuf));
    console.log("[TaskLoader] 任务配置:", manifest.robot_id, "停靠点:", manifest.ordered_sp, "文件:", manifest.file_names);
    if (!manifest.file_names || manifest.file_names.length === 0) {
      throw new Error("任务配置中没有巡检点文件");
    }

    const allImages: TaskLoadedImage[] = [];
    let probedSize: { width: number; height: number } | null = null;
    for (const fileName of manifest.file_names) {
      const parts = fileName.split("_");
      const cpId = Math.abs(parseInt(parts[1])) || 0;
      const spDir = String(cpId);
      console.log(`[TaskLoader] 读取停靠点 SP${cpId}: ${deviceDir}/${spDir}/${fileName}`);
      const spBuf = await api.readLargeFile(pathJoin(pathJoin(deviceDir, spDir), fileName));
      const spConfig: TaskSPConfig = JSON.parse(new TextDecoder().decode(spBuf));
      const imageKeys = Object.keys(spConfig.images).sort();
      let loaded = 0;

      for (const key of imageKeys) {
        const cfg = spConfig.images[key] as TaskImageConfig;
        const side = cfg.pic_loc_flag === "right" ? "right" : "left";

        setState({ loading: true, progress: `解析 SP${spConfig.sp_id}: ${loaded + 1}/${imageKeys.length}` });

        const imgPath = pathJoin(pathJoin(deviceDir, spDir), cfg.vis_name);
        if (!probedSize) {
          try {
            const img = await loadImageElement(imgPath, cfg.vis_name);
            probedSize = { width: img.naturalWidth, height: img.naturalHeight };
          } catch (e) {
            console.warn("[TaskLoader] 探测首张图片尺寸失败:", e);
          }
        }
        allImages.push({
          imagePath: imgPath,
          naturalWidth: cfg.width || probedSize?.width,
          naturalHeight: cfg.width ? cfg.height : probedSize?.height,
          config: cfg, spId: spConfig.sp_id, spDir,
          col: cfg.pic_loc[0], row: cfg.pic_loc[1], side,
          x: 0, y: 0, w: THUMBNAIL_WIDTH, h: Math.round(THUMBNAIL_WIDTH / ((cfg.width && cfg.height) ? cfg.width / cfg.height : ((probedSize?.width && probedSize?.height) ? probedSize.width / probedSize.height : 4 / 3))),
        });
        loaded++;
      }
    }

    rawImagesRef.current = allImages;
    const firstImage = allImages[0];
    const ratio = firstImage?.naturalWidth && firstImage?.naturalHeight
      ? firstImage.naturalWidth / firstImage.naturalHeight
      : 4 / 3;
    const thumbW = THUMBNAIL_WIDTH;
    const thumbH = Math.round(thumbW / ratio);
    const items = computeLayout(allImages, thumbW, thumbH);
    console.log(`[TaskLoader] 加载完成: ${items.length} 张图片, 缩略图=${thumbW}x${thumbH} (比例=${ratio.toFixed(2)})`);
    setState({ loading: false, progress: "" });
    return { items, surveyDir, deviceDir };
  }, [resolveDeviceTaskDir]);

  /** 按指定云台侧重新计算布局 */
  const setSide = useCallback((side: "left" | "right") => {
    const firstImg = rawImagesRef.current[0];
    const thumbW = THUMBNAIL_WIDTH;
    const thumbH = firstImg?.naturalWidth && firstImg?.naturalHeight
      ? Math.round(thumbW / (firstImg.naturalWidth / firstImg.naturalHeight))
      : 150;
    const items = computeLayout(rawImagesRef.current, thumbW, thumbH, side);
    console.log(`[TaskLoader] 云台侧切换: ${side}, 图片数: ${items.length}`);
    return items;
  }, []);

  const loadFullImage = useCallback(async (item: ImageItem): Promise<ImageItem & { img: HTMLImageElement }> => {
    const img = item.img?.complete ? item.img : await loadImageElement(item.imagePath, item.visName);
    return {
      ...item,
      img,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
  }, [loadImageElement]);

  const clear = useCallback(() => { rawImagesRef.current = []; resolvedDeviceDirRef.current = ""; }, []);

  const getTotalCount = useCallback(() => rawImagesRef.current.length, []);

  const getResolvedDeviceDir = useCallback(() => resolvedDeviceDirRef.current, []);

  return { ...state, loadTask, setSide, clear, getTotalCount, getResolvedDeviceDir, loadFullImage };
}
