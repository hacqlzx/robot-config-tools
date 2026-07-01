import { useState, useCallback, useRef } from "react";
import type { TaskManifest, TaskSPConfig, TaskLoadedImage, TaskImageConfig } from "@/views/image-edit/types/task";
import type { ImageItem } from "@/components/image-canvas/ImageCanvas";

interface TaskLoaderState {
  loading: boolean;
  progress: string;
}

/** 计算网格布局 */
function computeGrid(
  images: TaskLoadedImage[],
  containerW: number,
): ImageItem[] {
  if (images.length === 0) return [];
  const leftImgs = images.filter((x) => x.side === "left");
  const rightImgs = images.filter((x) => x.side === "right");
  const sideCount = rightImgs.length > 0 ? 2 : 1;

  const maxCol = Math.max(...images.map((x) => x.col), 0);
  const maxRow = Math.max(...images.map((x) => x.row), 0);
  const totalCols = maxCol + 1;
  const totalRows = maxRow + 1;

  const cellW = (containerW - (sideCount - 1) * 4) / (totalCols * sideCount);
  const cellH = cellW * 0.75;

  return images.map((img) => {
    const sideOff = img.side === "right" ? totalCols * cellW + 4 : 0;
    return {
      img: img.img,
      id: img.config.pic_loc[0] + img.config.pic_loc[1] * 100 + img.spId * 10000,
      x: sideOff + img.col * cellW,
      y: img.row * cellH,
      w: cellW,
      h: cellH,
    };
  });
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
      const spDir = fileName.replace(".json", "");
      console.log(`[TaskLoader] 读取停靠点: ${spDir}`);
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
          x: 0, y: 0, w: 0, h: 0,
        });
        loaded++;
      }
    }

    const containerW = window.innerWidth * 0.55;
    const items = computeGrid(allImages, containerW);
    console.log(`[TaskLoader] 加载完成: ${items.length} 张图片, 网格宽度=${containerW}, 缩略图=${items[0]?.w.toFixed(0)}x${items[0]?.h.toFixed(0)}`);
    imagesRef.current = items;
    setState({ loading: false, progress: "" });
    return items;
  }, []);

  /** 更新单图拖拽位置 */
  const updateImagePos = useCallback((id: number, x: number, y: number) => {
    const idx = imagesRef.current.findIndex((img) => img.id === id);
    if (idx === -1) return;
    imagesRef.current[idx] = { ...imagesRef.current[idx], x, y };
    return [...imagesRef.current];
  }, []);

  const clear = useCallback(() => {
    imagesRef.current = [];
  }, []);

  return { ...state, loadTask, updateImagePos, clear };
}
