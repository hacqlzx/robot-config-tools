export interface CabinetOcrResult {
  rawText: string;
  regions: CabinetOcrRegionResult[];
  labels: CabinetOcrDetectedLabel[];
}

export interface CabinetNameOcrResult {
  rawText: string;
  name: string;
  confidence: number;
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

export const CABINET_FACADE_LABEL_OCR_PROMPT = [
  "你是屏柜验证图像的外观框标签识别助手。",
  "外观框场景中，一个外观框只对应一个设备，一个设备只对应一个设备标签。",
  "请只识别 ROI 内这个外观设备对应的标签名称。",
  "每个 ROI 最多输出一条 labels 数据，禁止把同一个标签拆成多条。",
  "如果同一个标签包含编号、名称、多行文字或左右分段文字，必须按阅读顺序合并成一个完整 text。",
  "如果 ROI 内出现多个相关文字片段，优先选择最像设备标签或设备名称的内容，并合并为一条。",
  "过滤外观框内的部件状态、表计读数、按钮文字、厂家、日期、水印和无关铭牌。",
  "如果无法识别，labels 输出空数组。",
  "confidence 为 0 到 1 的文字识别置信度，无法精确判断时给合理估计。",
  "只输出严格 JSON，不要输出 Markdown、解释或额外说明。",
  "JSON 格式：{\"regions\":[{\"regionId\":\"region_1\",\"labels\":[{\"text\":\"外观设备标签\",\"confidence\":0.9}]}]}。",
].join("\n");

export const CABINET_NAME_OCR_PROMPT = [
  "你是屏柜验证图像的屏柜名称识别助手。",
  "请只识别图片 ROI 内最像屏柜、柜体、主设备名称的文字。",
  "如果同一名称被换行、分段或分隔显示，请合并成一个完整名称。",
  "过滤编号、日期、厂家、页眉页脚、水印和明显不是屏柜名称的文字。",
  "如果无法识别，name 输出空字符串。",
  "confidence 为 0 到 1 的文字识别置信度，无法精确判断时给合理估计。",
  "只输出严格 JSON，不要输出 Markdown、解释或额外说明。",
  "JSON 格式：{\"name\":\"屏柜名称\",\"confidence\":0.9}。",
].join("\n");

export async function recognizeCabinetLabels(sources: CabinetOcrImageSource | CabinetOcrImageSource[]): Promise<CabinetOcrResult> {
  return recognizeCabinetLabelsWithPrompt(sources, CABINET_LABEL_OCR_PROMPT);
}

export async function recognizeCabinetFacadeLabels(sources: CabinetOcrImageSource | CabinetOcrImageSource[]): Promise<CabinetOcrResult> {
  return recognizeCabinetLabelsWithPrompt(sources, CABINET_FACADE_LABEL_OCR_PROMPT, { mergeLabelsPerRegion: true });
}

async function recognizeCabinetLabelsWithPrompt(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  prompt: string,
  options: { mergeLabelsPerRegion?: boolean } = {},
): Promise<CabinetOcrResult> {
  const imageSources = Array.isArray(sources) ? sources : [sources];
  if (!imageSources.length) throw new Error("图片为空，无法识别");
  for (const source of imageSources) {
    if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");
  }

  let response: Response;
  try {
    response = await fetch(`${DASH_SCOPE_BASE_URL}/chat/completions`, {
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
            content: buildCabinetOcrContent(imageSources, prompt),
          },
        ],
      }),
    });
  } catch {
    throw new Error("网络异常");
  }

  const payloadText = await response.text();
  const payload = parseJsonPayload(payloadText);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payloadText || `识别请求失败：${response.status}`);
  }

  const rawText = extractCompletionText(payload);
  return normalizeCabinetOcrResult(rawText, imageSources, options);
}

export async function recognizeCabinetName(source: CabinetOcrImageSource): Promise<CabinetNameOcrResult> {
  if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");

  let response: Response;
  try {
    response = await fetch(`${DASH_SCOPE_BASE_URL}/chat/completions`, {
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
            content: buildCabinetNameOcrContent(source),
          },
        ],
      }),
    });
  } catch {
    throw new Error("网络异常");
  }

  const payloadText = await response.text();
  const payload = parseJsonPayload(payloadText);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payloadText || `识别请求失败：${response.status}`);
  }

  const rawText = extractCompletionText(payload);
  return normalizeCabinetNameOcrResult(rawText);
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

function buildCabinetOcrContent(sources: CabinetOcrImageSource[], prompt: string) {
  if (shouldUseSingleImageRoiPrompt(sources)) {
    return buildSingleImageRoiContent(sources, prompt);
  }

  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
    {
      type: "text",
      text: [
        prompt,
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

function buildCabinetNameOcrContent(source: CabinetOcrImageSource) {
  return [
    {
      type: "text" as const,
      text: [
        CABINET_NAME_OCR_PROMPT,
        "",
        `regionId=${source.regionId}，title=${source.title}`,
      ].join("\n"),
    },
    {
      type: "image_url" as const,
      image_url: { url: source.dataUrl },
    },
  ];
}

function shouldUseSingleImageRoiPrompt(sources: CabinetOcrImageSource[]): boolean {
  if (!sources.length) return false;
  const firstUrl = sources[0].dataUrl;
  return sources.every((source) => source.dataUrl === firstUrl && source.roi);
}

function buildSingleImageRoiContent(sources: CabinetOcrImageSource[], prompt: string) {
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
        prompt,
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

function normalizeCabinetOcrResult(
  rawText: string,
  sources: CabinetOcrImageSource[],
  options: { mergeLabelsPerRegion?: boolean } = {},
): CabinetOcrResult {
  const parsed = parseJsonPayload(extractJsonText(rawText));
  const regions = normalizeRegions(parsed, sources);
  const normalizedRegions = options.mergeLabelsPerRegion
    ? regions.map((region) => ({ ...region, labels: mergeDetectedLabels(region.regionId, region.labels) }))
    : regions;
  return {
    rawText,
    regions: normalizedRegions,
    labels: normalizedRegions.flatMap((region) => region.labels),
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

function normalizeCabinetNameOcrResult(rawText: string): CabinetNameOcrResult {
  const payload = parseJsonPayload(extractJsonText(rawText));
  const name = String(payload?.name || payload?.text || payload?.label || "").trim();
  return {
    rawText,
    name,
    confidence: clampConfidence(payload?.confidence ?? payload?.score ?? payload?.probability),
  };
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

function mergeDetectedLabels(regionId: string, labels: CabinetOcrDetectedLabel[]): CabinetOcrDetectedLabel[] {
  const validLabels = labels.filter((label) => label.text.trim());
  if (validLabels.length <= 1) return validLabels;
  return [{
    regionId,
    text: validLabels.map((label) => label.text.trim()).join(" "),
    confidence: validLabels.reduce((sum, label) => sum + label.confidence, 0) / validLabels.length,
  }];
}

function clampConfidence(value: any): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.5;
  return Math.min(1, Math.max(0, numberValue));
}
