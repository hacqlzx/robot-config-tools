import { useState, useCallback, useRef } from "react";
import type { TaskManifest, TaskSPConfig, TaskLoadedImage, TaskImageConfig } from "@/views/image-edit/types/task";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";

interface TaskLoaderState {
  loading: boolean;
  progress: string;
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

    let yOff = 12;
    for (const img of group) {
      items.push({
        img: img.img,
        id: img.config.pic_loc[0] + img.config.pic_loc[1] * 100 + img.spId * 10000 + (img.side === "right" ? 5000 : 0),
        x: xOff,
        y: yOff,
        w: thumbW,
        h: thumbH,
        side: img.side,
        spId: img.spId,
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

  const loadTask = useCallback(async (taskDir: string): Promise<ImageItem[]> => {
    setState({ loading: true, progress: "读取任务配置..." });
    const api = window.electronAPI!;

    const manifestBuf = await api.readLargeFile(`${taskDir}/json_list.json`);
    const manifest: TaskManifest = JSON.parse(new TextDecoder().decode(manifestBuf));
    console.log("[TaskLoader] 任务配置:", manifest.robot_id, "停靠点:", manifest.ordered_sp, "文件:", manifest.file_names);
    if (!manifest.file_names || manifest.file_names.length === 0) {
      throw new Error("任务配置中没有巡检点文件");
    }

    const allImages: TaskLoadedImage[] = [];
    for (const fileName of manifest.file_names) {
      const parts = fileName.split("_");
      const cpId = Math.abs(parseInt(parts[1])) || 0;
      const spDir = String(cpId);
      console.log(`[TaskLoader] 读取停靠点 SP${cpId}: ${taskDir}/${spDir}/${fileName}`);
      const spBuf = await api.readLargeFile(`${taskDir}/${spDir}/${fileName}`);
      const spConfig: TaskSPConfig = JSON.parse(new TextDecoder().decode(spBuf));
      const imageKeys = Object.keys(spConfig.images).sort();
      let loaded = 0;

      for (const key of imageKeys) {
        const cfg = spConfig.images[key] as TaskImageConfig;
        const side = cfg.pic_loc_flag === "right" ? "right" : "left";
        if (side === "right" && spConfig.layout.right[1] === 0) continue;

        setState({ loading: true, progress: `SP${spConfig.sp_id}: ${loaded + 1}/${imageKeys.length}` });

        const imgPath = `${taskDir}/${spDir}/${cfg.vis_name}`;
        const imgBuf = await api.readLargeFile(imgPath);
        const blob = new Blob([imgBuf]);
        const url = URL.createObjectURL(blob);

        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error(`图片加载失败: ${cfg.vis_name}`));
          el.src = url;
        });

        URL.revokeObjectURL(url);
        allImages.push({
          img, config: cfg, spId: spConfig.sp_id, spDir,
          col: cfg.pic_loc[0], row: cfg.pic_loc[1], side,
          x: 0, y: 0, w: 200, h: 150,
        });
        loaded++;
      }
    }

    rawImagesRef.current = allImages;
    // 读取第一张图的比例作为缩略图比例
    const firstImg = allImages[0]?.img;
    const ratio = firstImg ? firstImg.naturalWidth / firstImg.naturalHeight : 4 / 3;
    const thumbW = 200;
    const thumbH = Math.round(thumbW / ratio);
    const items = computeLayout(allImages, thumbW, thumbH);
    console.log(`[TaskLoader] 加载完成: ${items.length} 张图片, 缩略图=${thumbW}x${thumbH} (比例=${ratio.toFixed(2)})`);
    setState({ loading: false, progress: "" });
    return items;
  }, []);

  /** 按指定云台侧重新计算布局 */
  const setSide = useCallback((side: "left" | "right") => {
    const firstImg = rawImagesRef.current[0]?.img;
    const thumbW = 200;
    const thumbH = firstImg
      ? Math.round(thumbW / (firstImg.naturalWidth / firstImg.naturalHeight))
      : 150;
    const items = computeLayout(rawImagesRef.current, thumbW, thumbH, side);
    console.log(`[TaskLoader] 云台侧切换: ${side}, 图片数: ${items.length}`);
    return items;
  }, []);

  const clear = useCallback(() => { rawImagesRef.current = []; }, []);

  const getTotalCount = useCallback(() => rawImagesRef.current.length, []);

  return { ...state, loadTask, setSide, clear, getTotalCount };
}
