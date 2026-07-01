import { useState, useCallback, useRef } from "react";
import type { TaskManifest, TaskSPConfig, TaskLoadedImage, TaskImageConfig } from "@/views/image-edit/types/task";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";

interface TaskLoaderState {
  loading: boolean;
  progress: string;
}

/** 竖排布局：按 spId 分组，组内按 row → col 排序，组间留间距 */
function computeLayout(images: TaskLoadedImage[], thumbW = 200): ImageItem[] {
  if (images.length === 0) return [];
  const thumbH = thumbW * 0.75;
  const gap = 6;
  const groupGap = 14;

  // 按 spId 分组，组内按 row, col 排序
  const groups = new Map<number, TaskLoadedImage[]>();
  for (const img of images) {
    if (!groups.has(img.spId)) groups.set(img.spId, []);
    groups.get(img.spId)!.push(img);
  }
  const sortedSps = [...groups.keys()].sort((a, b) => a - b);

  let yOff = 12;
  const items: ImageItem[] = [];

  for (const spId of sortedSps) {
    const group = groups.get(spId)!;
    group.sort((a, b) => a.row - b.row || a.col - b.col);

    for (const img of group) {
      items.push({
        img: img.img,
        id: img.config.pic_loc[0] + img.config.pic_loc[1] * 100 + spId * 10000,
        x: 12,
        y: yOff,
        w: thumbW,
        h: thumbH,
        side: img.side,
        spId,
      });
      yOff += thumbH + gap;
    }
    if (group.length > 0) yOff += groupGap; // 组间间距
  }
  return items;
}

export function useTaskLoader() {
  const [state, setState] = useState<TaskLoaderState>({ loading: false, progress: "" });
  const imagesRef = useRef<ImageItem[]>([]);

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

    const items = computeLayout(allImages, 200);
    console.log(`[TaskLoader] 加载完成: ${items.length} 张图片, 缩略图=200x150`);
    imagesRef.current = items;
    setState({ loading: false, progress: "" });
    return items;
  }, []);

  const clear = useCallback(() => { imagesRef.current = []; }, []);

  return { ...state, loadTask, clear };
}
