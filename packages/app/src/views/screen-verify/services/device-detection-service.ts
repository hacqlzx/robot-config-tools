import { requestRecognitionText } from "./recognition-request";
import type { RecognitionRequestOptions } from "./recognition-request";
import { getDefectDetectionIp } from "@/stores/appContextStore";

const DEFAULT_DEVICE_DETECTION_IP = "192.168.0.139:52002";
const DEVICE_DETECTION_TASK_IDS = [1];

/** 获取当前配置的设备检测服务地址 */
function getDeviceDetectionUrl(): string {
  const configuredIp = getDefectDetectionIp();
  const ip = configuredIp || DEFAULT_DEVICE_DETECTION_IP;
  // 确保 IP 格式正确，添加 http:// 前缀和 /api/imageDetection 后缀
  const baseUrl = ip.startsWith("http://") || ip.startsWith("https://") ? ip : `http://${ip}`;
  return `${baseUrl}/api/imageDetection`;
}

export interface DlBoundingRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DlPoint {
  x: number;
  y: number;
}

export interface DlResult {
  classid: string;
  labeldesc?: string;
  score: number;
  rect: DlBoundingRect;
  mask: { points: DlPoint[] };
}

export interface DeviceDetection {
  result: DlResult;
}

export interface DeviceDetectionResponse {
  detections: DeviceDetection[];
  issues: string[];
}

interface ImageDetectionApiBox {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface ImageDetectionApiResult {
  label?: string;
  labeldesc?: string;
  score?: number;
  box?: ImageDetectionApiBox;
  mask?: number[][];
}

interface ImageDetectionApiResponse {
  code?: number;
  message?: string;
  results?: ImageDetectionApiResult[];
}

/**
 * 调用算法服务识别整张屏柜图中的设备框。
 * 后续会在 recognition-workflow 中按用户框选的标准部件区域过滤结果。
 */
export async function detectCabinetDevices(
  imageDataUrl: string,
  options: RecognitionRequestOptions = {},
): Promise<DeviceDetectionResponse> {
  const detections: DeviceDetection[] = [];
  const issues: string[] = [];

  const results = await requestImageDetection(imageDataUrl, options);
  for (const result of results) {
    const normalized = normalizeDetectionResult(result);
    if (normalized) detections.push(normalized);
  }

  return { detections, issues };
}

/**
 * 算法接口要求 multipart/form-data：image 是整图，taskid 表示当前设备识别任务。
 */
async function requestImageDetection(
  imageDataUrl: string,
  options: RecognitionRequestOptions,
): Promise<ImageDetectionApiResult[]> {
  const blob = dataUrlToBlob(imageDataUrl);
  const formData = new FormData();
  formData.append("image", blob, `device-detection.${mimeToExt(blob.type)}`);
  for (const taskId of DEVICE_DETECTION_TASK_IDS) {
    formData.append("taskid", String(taskId));
  }

  const { response, text: payloadText } = await requestRecognitionText(
    getDeviceDetectionUrl(),
    {
      method: "POST",
      body: formData,
    },
    options,
  );
  const payload = parseJsonPayload(payloadText);
  if (!response.ok) {
    throw new Error(payload?.message || payloadText || `部件识别请求失败：${response.status}`);
  }
  if (payload?.code !== 1000) {
    throw new Error(payload?.message || `部件识别失败：${payload?.code ?? "未知错误"}`);
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

/**
 * 将算法接口的 x1/y1/x2/y2 坐标归一成画布内部使用的 x/y/w/h。
 */
function normalizeDetectionResult(result: ImageDetectionApiResult): DeviceDetection | null {
  const box = result.box;
  const x1 = Number(box?.x1);
  const y1 = Number(box?.y1);
  const x2 = Number(box?.x2);
  const y2 = Number(box?.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const right = Math.max(x1, x2);
  const bottom = Math.max(y1, y2);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return null;

  return {
    result: {
      classid: String(result.label || ""),
      labeldesc: String(result.labeldesc || ""),
      score: normalizeScore(result.score),
      rect: {
        x: Math.round(left),
        y: Math.round(top),
        w: Math.round(w),
        h: Math.round(h),
      },
      mask: {
        points: Array.isArray(result.mask)
          ? result.mask
            .map((point) => ({ x: Math.round(Number(point?.[0])), y: Math.round(Number(point?.[1])) }))
            .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          : [],
      },
    },
  };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("部件识别仅支持 data URI 图片");
  const mime = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function mimeToExt(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("bmp")) return "bmp";
  return "png";
}

function parseJsonPayload(text: string): ImageDetectionApiResponse | null {
  try {
    return JSON.parse(text) as ImageDetectionApiResponse;
  } catch {
    return null;
  }
}

function normalizeScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(1, score));
}
