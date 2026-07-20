export interface CabinetOcrResult {
  rawText: string;
  regions: CabinetOcrRegionResult[];
  labels: CabinetOcrDetectedLabel[];
}

export interface CabinetOcrCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CabinetOcrImageSource {
  regionId: string;
  title: string;
  dataUrl: string;
  roi?: CabinetOcrCropRect;
}

export interface CabinetOcrRegionResult {
  regionId: string;
  labels: CabinetOcrDetectedLabel[];
}

export interface CabinetOcrDetectedLabel {
  regionId: string;
  text: string;
  confidence: number;
}

export interface CabinetOcrCropResult {
  dataUrl: string;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
  error?: {
    message?: string;
  };
}

const DASH_SCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASH_SCOPE_MODEL = "qwen3-vl-plus";
const DASH_SCOPE_API_KEY = import.meta.env.VITE_DASHSCOPE_API_KEY || "sk-84dbc87f36d84977b4164e165a73687b";

export const CABINET_LABEL_OCR_PROMPT = [
  "你是屏柜验证图像的标签识别助手。",
  "请识别 ROI 内的设备标签、部件标签和铭牌标签。",
  "同一个标签内如果同时存在编号和名称，必须合并为一条，例如“编号+名称”。",
  "每个独立标签必须单独输出一项，不要把同一排多个标签合并。",
  "如果提供 ROI 列表，只识别 ROI 内的标签，禁止输出 ROI 外的内容。",
  "不需要输出坐标、bbox 或任何几何信息。",
  "confidence 为 0 到 1 的文字识别置信度，无法精确判断时给合理估计。",
  "过滤明显不是标签的文字、页眉页脚、水印、日期时间和重复结果。",
  "只输出严格 JSON，不要输出 Markdown、解释或额外说明。",
  "JSON 格式：{\"regions\":[{\"regionId\":\"region_1\",\"labels\":[{\"text\":\"标签文本1\",\"confidence\":0.9},{\"text\":\"标签文本2\",\"confidence\":0.8}]}]}。",
  "如果某个区域无法识别，labels 输出空数组。",
].join("\n");

export async function recognizeCabinetLabels(sources: CabinetOcrImageSource | CabinetOcrImageSource[]): Promise<CabinetOcrResult> {
  const imageSources = Array.isArray(sources) ? sources : [sources];
  if (!imageSources.length) throw new Error("图片为空，无法识别");
  for (const source of imageSources) {
    if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");
  }

  const response = await fetch(`${DASH_SCOPE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DASH_SCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DASH_SCOPE_MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: buildCabinetOcrContent(imageSources),
        },
      ],
    }),
  });

  const payloadText = await response.text();
  const payload = parseJsonPayload(payloadText);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payloadText || `识别请求失败：${response.status}`);
  }

  const rawText = extractCompletionText(payload);
  return normalizeCabinetOcrResult(rawText, imageSources);
}

export async function cropCabinetOcrImage(imageDataUrl: string, rect: CabinetOcrCropRect, padding = 0): Promise<CabinetOcrCropResult> {
  const image = await loadImage(imageDataUrl);
  const x = Math.max(0, Math.floor(rect.x - padding));
  const y = Math.max(0, Math.floor(rect.y - padding));
  const right = Math.min(image.naturalWidth, Math.ceil(rect.x + rect.w + padding));
  const bottom = Math.min(image.naturalHeight, Math.ceil(rect.y + rect.h + padding));
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) throw new Error("选中框无有效图片区域");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建图片裁剪画布");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
  return {
    dataUrl: canvas.toDataURL("image/png"),
    originX: x,
    originY: y,
    width: w,
    height: h,
  };
}

function buildCabinetOcrContent(sources: CabinetOcrImageSource[]) {
  if (shouldUseSingleImageRoiPrompt(sources)) {
    return buildSingleImageRoiContent(sources);
  }

  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
    {
      type: "text",
      text: [
        CABINET_LABEL_OCR_PROMPT,
        "",
        "下面按顺序提供待识别区域图片。输出 JSON 中必须使用对应 regionId：",
        ...sources.map((source) => `${source.regionId}: ${source.title}`),
      ].join("\n"),
    },
  ];

  for (const source of sources) {
    content.push({ type: "text", text: `regionId=${source.regionId}，title=${source.title}` });
    content.push({ type: "image_url", image_url: { url: source.dataUrl } });
  }
  return content;
}

function shouldUseSingleImageRoiPrompt(sources: CabinetOcrImageSource[]): boolean {
  if (!sources.length) return false;
  const firstUrl = sources[0].dataUrl;
  return sources.every((source) => source.dataUrl === firstUrl && source.roi);
}

function buildSingleImageRoiContent(sources: CabinetOcrImageSource[]) {
  const roiList = sources.map((source) => {
    const roi = source.roi!;
    return {
      regionId: source.regionId,
      title: source.title,
      bbox: [
        Math.round(roi.x),
        Math.round(roi.y),
        Math.round(roi.x + roi.w),
        Math.round(roi.y + roi.h),
      ],
    };
  });

  return [
    {
      type: "text" as const,
      text: [
        CABINET_LABEL_OCR_PROMPT,
        "",
        "下面只提供一张原图。请严格只识别 ROI 列表内的标签。",
        "ROI 列表坐标只用于限定识别范围，不要输出坐标。",
        `ROI_LIST=${JSON.stringify(roiList)}`,
      ].join("\n"),
    },
    {
      type: "image_url" as const,
      image_url: { url: sources[0].dataUrl },
    },
  ];
}

function parseJsonPayload(text: string): ChatCompletionResponse | null {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    return null;
  }
}

function extractCompletionText(payload: ChatCompletionResponse | null): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => item.text || "").filter(Boolean).join("\n");
  }
  return "";
}

function loadImage(imageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片裁剪前加载失败"));
    image.src = imageDataUrl;
  });
}

function normalizeCabinetOcrResult(rawText: string, sources: CabinetOcrImageSource[]): CabinetOcrResult {
  const parsed = parseJsonPayload(extractJsonText(rawText));
  const regions = normalizeRegions(parsed, sources);
  return {
    rawText,
    regions,
    labels: regions.flatMap((region) => region.labels),
  };
}

function extractJsonText(rawText: string): string {
  const trimmed = rawText.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeRegions(payload: any, sources: CabinetOcrImageSource[]): CabinetOcrRegionResult[] {
  const sourceIds = new Set(sources.map((source) => source.regionId));
  const rawRegions = Array.isArray(payload?.regions) ? payload.regions : [];
  const byRegion = new Map<string, CabinetOcrDetectedLabel[]>();

  for (const region of rawRegions) {
    const regionId = String(region?.regionId || "").trim();
    if (!sourceIds.has(regionId)) continue;
    const labels = Array.isArray(region?.labels) ? region.labels : [];
    byRegion.set(regionId, labels.map((label) => normalizeDetectedLabel(regionId, label)).filter(Boolean) as CabinetOcrDetectedLabel[]);
  }

  return sources.map((source) => ({
    regionId: source.regionId,
    labels: byRegion.get(source.regionId) || [],
  }));
}

function normalizeDetectedLabel(regionId: string, value: any): CabinetOcrDetectedLabel | null {
  const text = typeof value === "string" ? value.trim() : String(value?.text || value?.label || "").trim();
  if (!text) return null;
  return {
    regionId,
    text,
    confidence: typeof value === "string" ? 0.5 : clampConfidence(value?.confidence ?? value?.score ?? value?.probability),
  };
}

function clampConfidence(value: any): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.5;
  return Math.min(1, Math.max(0, numberValue));
}
