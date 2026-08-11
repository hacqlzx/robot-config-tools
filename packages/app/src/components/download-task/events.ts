export const DOWNLOAD_TASK_FLY_EVENT = "download-task:fly";

export interface DownloadTaskFlyRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function startDownloadTaskFlyAnimation(source: HTMLElement | DOMRect | DownloadTaskFlyRect) {
  if (typeof window === "undefined") return;
  const rect = "getBoundingClientRect" in source ? source.getBoundingClientRect() : source;
  window.dispatchEvent(new CustomEvent(DOWNLOAD_TASK_FLY_EVENT, {
    detail: {
      from: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    },
  }));
}
