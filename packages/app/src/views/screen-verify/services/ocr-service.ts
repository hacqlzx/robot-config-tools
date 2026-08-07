import { requestRecognitionText } from "./recognition-request";
import type { RecognitionRequestOptions } from "./recognition-request";
import { detectLabelPlateRects } from "./label-plate-detector";
import type { LabelPlatePixelRect } from "./label-plate-detector";

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
  width?: number;
  height?: number;
  coordinateMode?: "original" | "crop-local";
}

export interface CabinetOcrRegionResult {
  regionId: string;
  labels: CabinetOcrDetectedLabel[];
}

export interface CabinetOcrDetectedLabel {
  regionId: string;
  text: string;
  confidence: number;
  bbox?: CabinetOcrCropRect;
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

interface DashScopeOcrWord {
  text?: unknown;
  location?: unknown;
  rotate_rect?: unknown;
}

interface DashScopeOcrResponse {
  output?: {
    choices?: {
      message?: {
        content?: {
          text?: string;
          ocr_result?: {
            words_info?: DashScopeOcrWord[];
          };
        }[];
      };
    }[];
  };
  request_id?: string;
  code?: string;
  message?: string;
}

interface StructuredOcrLine {
  text: string;
  bbox: CabinetOcrCropRect;
}

interface CabinetOcrJsonPayload {
  regions?: {
    regionId?: unknown;
    labels?: unknown[];
    label_boxes?: unknown[];
    labelBoxes?: unknown[];
    boxes?: unknown[];
  }[];
  name?: unknown;
  text?: unknown;
  label?: unknown;
  confidence?: unknown;
  score?: unknown;
  probability?: unknown;
}

const DASH_SCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DASH_SCOPE_OCR_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DASH_SCOPE_MODEL = import.meta.env.VITE_DASHSCOPE_MODEL || "qwen3.7-plus";
const DASH_SCOPE_OCR_MODEL = import.meta.env.VITE_DASHSCOPE_OCR_MODEL || "qwen3.5-ocr";
const DASH_SCOPE_API_KEY = import.meta.env.VITE_DASHSCOPE_API_KEY || "sk-84dbc87f36d84977b4164e165a73687b";
export const CABINET_OCR_NORMALIZED_COORDINATE_MAX = 999;

export const CABINET_LABEL_OCR_PROMPT = [
  "你是屏柜验证图像的标签文字识别助手。",
  "只读取指定区域图片中的独立设备标签或铭牌文字，不输出任何坐标。",
  "同一个标签内的编号、名称和多行文字合并为一个字符串，不要合并相邻的多个标签。",
  "按从上到下、从左到右的阅读顺序输出。",
  "过滤按钮、开关、指示灯、表计读数、厂家、水印、日期和页眉页脚。",
  "只输出严格 JSON：{\"regions\":[{\"regionId\":\"region_1\",\"labels\":[\"标签文本\"]}]}。",
  "无法识别时 labels 输出空数组。",
].join("\n");

export const CABINET_FACADE_LABEL_OCR_PROMPT = [
  "你是屏柜验证图像的外观设备名称识别助手。",
  "只读取指定区域图片中最像设备名称标签的文字，不输出任何坐标。",
  "同一个标签内的编号、名称和多行文字按阅读顺序合并为一个字符串。",
  "过滤状态、读数、按钮文字、厂家、日期、水印和无关铭牌。",
  "每个 regionId 最多输出一个标签。",
  "只输出严格 JSON：{\"regions\":[{\"regionId\":\"region_1\",\"labels\":[\"外观设备标签\"]}]}。",
  "无法识别时 labels 输出空数组。",
].join("\n");

export const CABINET_LABEL_TEXT_OCR_PROMPT = [
  "你是屏柜标签文字识别助手。",
  "输入是一个或多个用户手工框选出来的标签小图。",
  "每张图最多输出一个标签名称，只识别标签牌上的文字。",
  "同一个标签内的编号、名称和多行文字按阅读顺序合并为一个字符串。",
  "不要输出坐标、bbox、置信度或解释。",
  "只输出严格 JSON：{\"regions\":[{\"regionId\":\"region_1\",\"labels\":[\"标签文本\"]}]}。",
  "无法识别时 labels 输出空数组。",
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

/**
 * 识别普通设备标签。
 * 优先使用 Qwen-OCR 获取文字和位置，必要时再用通用视觉模型补文本。
 */
export async function recognizeCabinetLabels(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  requestOptions: RecognitionRequestOptions = {},
): Promise<CabinetOcrResult> {
  return recognizeCabinetLabelsWithStructuredLocations(
    sources,
    CABINET_LABEL_OCR_PROMPT,
    {},
    requestOptions,
  );
}

/**
 * 识别外观框对应的设备名称。
 * 外观场景通常一个 ROI 只需要一个名称，因此结果会按 region 合并。
 */
export async function recognizeCabinetFacadeLabels(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  requestOptions: RecognitionRequestOptions = {},
): Promise<CabinetOcrResult> {
  return recognizeCabinetLabelsWithStructuredLocations(
    sources,
    CABINET_FACADE_LABEL_OCR_PROMPT,
    { mergeLabelsPerRegion: true },
    requestOptions,
  );
}

/**
 * 对人工后补的标签小框做纯文字识别。
 * 该入口不依赖坐标，主要服务一键排序前的补充标签名称。
 */
export async function recognizeCabinetLabelTexts(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  requestOptions: RecognitionRequestOptions = {},
): Promise<CabinetOcrResult> {
  return recognizeCabinetLabelsWithPrompt(
    sources,
    CABINET_LABEL_TEXT_OCR_PROMPT,
    { mergeLabelsPerRegion: true },
    requestOptions,
  );
}

/**
 * 带位置的标签识别入口。
 * Qwen-OCR 提供更稳定的 bbox，文本质量异常时再调用 Qwen3.7-Plus 只修正文案。
 */
async function recognizeCabinetLabelsWithStructuredLocations(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  textPrompt: string,
  options: { mergeLabelsPerRegion?: boolean },
  requestOptions: RecognitionRequestOptions,
): Promise<CabinetOcrResult> {
  const imageSources = Array.isArray(sources) ? sources : [sources];
  const locatedResult = await recognizeCabinetLabelsWithQwenOcr(imageSources, options, requestOptions);
  const fallbackReason = getOcrTextFallbackReason(locatedResult);
  if (!fallbackReason) return locatedResult;

  console.info("[screen-verify] Qwen 3.7 text fallback triggered", { reason: fallbackReason });
  const textResult = await recognizeCabinetLabelsWithPrompt(
    imageSources,
    textPrompt,
    options,
    requestOptions,
  ).catch((error) => {
    if (requestOptions.signal?.aborted) throw error;
    console.warn("[screen-verify] label text refinement failed, using Qwen-OCR text", error);
    return null;
  });
  return textResult ? mergeLocatedAndRecognizedOcrResults(locatedResult, textResult) : locatedResult;
}

/**
 * 调用 DashScope Qwen-OCR，按 ROI 把结构化 words_info 重新分配到每个标签区域。
 */
async function recognizeCabinetLabelsWithQwenOcr(
  sources: CabinetOcrImageSource[],
  options: { mergeLabelsPerRegion?: boolean },
  requestOptions: RecognitionRequestOptions,
): Promise<CabinetOcrResult> {
  if (!sources.length) throw new Error("图片为空，无法识别");
  const resolvedSources = await Promise.all(sources.map(async (source) => {
    if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");
    return resolveOcrImageSourceDimensions(source);
  }));
  // 多个 ROI 共享同一张裁剪图时按 dataUrl 合组，每组只向 qwen3.5-ocr 发起一次请求。
  const sourceGroups = groupOcrSourcesByImage(resolvedSources);
  const results = await Promise.all(sourceGroups.map(async (sourceGroup) => {
    const requestSource = sourceGroup[0];
    const { response, text: payloadText } = await requestRecognitionText(
      DASH_SCOPE_OCR_URL,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${DASH_SCOPE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DASH_SCOPE_OCR_MODEL,
          input: {
            messages: [
              {
                role: "user",
                content: [
                  {
                    image: requestSource.dataUrl,
                    enable_rotate: false,
                    min_pixels: 32 * 32 * 3,
                    max_pixels: 32 * 32 * 8192,
                  },
                ],
              },
            ],
          },
          parameters: {
            ocr_options: { task: "advanced_recognition" },
          },
        }),
      },
      requestOptions,
    );
    const payload = parseJsonPayload<DashScopeOcrResponse>(payloadText);
    if (!response.ok || payload?.code) {
      throw new Error(payload?.message || payloadText || `OCR 请求失败：${response.status}`);
    }

    const words = extractStructuredOcrWords(payload);
    // OCR 返回的是共享图片坐标，先按文字框中心点分回各 ROI，再分别做多行合并和标签牌边缘检测。
    const wordsByRegion = assignStructuredOcrWordsToSources(sourceGroup, words);
    const regions = await Promise.all(sourceGroup.map(async (source) => {
      let labels = groupStructuredOcrWords(source, wordsByRegion.get(source.regionId) || []);
      labels = await replaceTextBboxesWithPlateBboxes(source, labels);
      if (options.mergeLabelsPerRegion) {
        labels = mergeDetectedLabels(source.regionId, labels);
      }
      return { regionId: source.regionId, labels } satisfies CabinetOcrRegionResult;
    }));
    return {
      rawText: payloadText,
      regions,
    };
  }));

  const regionMap = new Map(results.flatMap((result) => result.regions).map((region) => [region.regionId, region]));
  const regions = resolvedSources.map((source) => (
    regionMap.get(source.regionId) || { regionId: source.regionId, labels: [] }
  ));
  return {
    rawText: JSON.stringify({
      model: DASH_SCOPE_OCR_MODEL,
      requestCount: results.length,
      responses: results.map((result) => parseJsonPayload(result.rawText) || result.rawText),
    }),
    regions,
    labels: regions.flatMap((region) => region.labels),
  };
}

function groupOcrSourcesByImage<T extends CabinetOcrImageSource>(sources: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const source of sources) {
    const group = groups.get(source.dataUrl) || [];
    group.push(source);
    groups.set(source.dataUrl, group);
  }
  return [...groups.values()];
}

/**
 * 多个 ROI 共享一张原图时，按文字框中心点把 OCR words_info 分配回对应 ROI。
 */
function assignStructuredOcrWordsToSources(
  sources: (CabinetOcrImageSource & { width: number; height: number })[],
  words: DashScopeOcrWord[],
): Map<string, DashScopeOcrWord[]> {
  const wordsByRegion = new Map(sources.map((source) => [source.regionId, [] as DashScopeOcrWord[]]));
  if (sources.length === 1 || !sources.every((source) => source.roi)) {
    wordsByRegion.set(sources[0].regionId, words);
    return wordsByRegion;
  }

  for (const word of words) {
    const bbox = normalizeStructuredOcrLocation(word.location);
    if (!bbox) continue;
    const centerX = bbox.x + bbox.w / 2;
    const centerY = bbox.y + bbox.h / 2;
    // ROI 重叠时选择面积更小的区域，优先归属到用户框选得更精确的标签范围。
    const matchedSource = sources
      .filter((source) => isPointInCropRect(centerX, centerY, source.roi as CabinetOcrCropRect))
      .sort((left, right) => getCropRectArea(left.roi as CabinetOcrCropRect) - getCropRectArea(right.roi as CabinetOcrCropRect))[0];
    if (!matchedSource) continue;
    wordsByRegion.get(matchedSource.regionId)?.push(word);
  }
  return wordsByRegion;
}

function isPointInCropRect(x: number, y: number, rect: CabinetOcrCropRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function getCropRectArea(rect: CabinetOcrCropRect): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

/**
 * 通用视觉模型兜底识别，只要求模型返回标签文字，不依赖返回坐标。
 */
async function recognizeCabinetLabelsWithPrompt(
  sources: CabinetOcrImageSource | CabinetOcrImageSource[],
  prompt: string,
  options: { mergeLabelsPerRegion?: boolean } = {},
  requestOptions: RecognitionRequestOptions = {},
): Promise<CabinetOcrResult> {
  const imageSources = Array.isArray(sources) ? sources : [sources];
  if (!imageSources.length) throw new Error("图片为空，无法识别");
  for (const source of imageSources) {
    if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");
  }

  const { response, text: payloadText } = await requestRecognitionText(
    `${DASH_SCOPE_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DASH_SCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DASH_SCOPE_MODEL,
        temperature: 0,
        enable_thinking: false,
        messages: [
          {
            role: "user",
            content: buildCabinetOcrContent(imageSources, prompt),
          },
        ],
      }),
    },
    requestOptions,
  );
  const payload = parseJsonPayload<ChatCompletionResponse>(payloadText);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payloadText || `识别请求失败：${response.status}`);
  }

  const rawText = extractCompletionText(payload);
  return normalizeCabinetOcrResult(rawText, imageSources, options);
}

async function resolveOcrImageSourceDimensions(source: CabinetOcrImageSource): Promise<CabinetOcrImageSource & { width: number; height: number }> {
  const width = Number(source.width);
  const height = Number(source.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { ...source, width, height };
  }
  const image = await loadImage(source.dataUrl);
  return {
    ...source,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function extractStructuredOcrWords(payload: DashScopeOcrResponse | null): DashScopeOcrWord[] {
  const contents = payload?.output?.choices?.flatMap((choice) => choice.message?.content || []) || [];
  return contents.flatMap((content) => content.ocr_result?.words_info || []);
}

/**
 * 把 Qwen-OCR 的单字/短词结果按行合并成业务标签。
 */
function groupStructuredOcrWords(
  source: CabinetOcrImageSource & { width: number; height: number },
  words: DashScopeOcrWord[],
): CabinetOcrDetectedLabel[] {
  const lines = words.flatMap((word) => {
    const text = String(word.text || "").trim();
    if (isAuxiliaryStructuredOcrText(text)) return [];
    const bbox = clampPixelBbox(normalizeStructuredOcrLocation(word.location), source.width, source.height);
    return text && bbox ? [{ text, bbox } satisfies StructuredOcrLine] : [];
  });
  if (!lines.length) return [];

  // Qwen 按文字行返回坐标。使用并查集把同一标签内的编号、名称和续行合成一个标签对象。
  const parents = lines.map((_, index) => index);
  const findRoot = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (leftIndex: number, rightIndex: number) => {
    const leftRoot = findRoot(leftIndex);
    const rightRoot = findRoot(rightIndex);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let leftIndex = 0; leftIndex < lines.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < lines.length; rightIndex++) {
      if (shouldMergeStructuredOcrLines(lines[leftIndex], lines[rightIndex])) {
        union(leftIndex, rightIndex);
      }
    }
  }

  const groups = new Map<number, StructuredOcrLine[]>();
  lines.forEach((line, index) => {
    const root = findRoot(index);
    groups.set(root, [...(groups.get(root) || []), line]);
  });

  return [...groups.values()]
    .map((group) => {
      const sortedLines = [...group].sort(compareStructuredOcrLines);
      const pixelBbox = mergeCropRects(sortedLines.map((line) => line.bbox));
      return {
        regionId: source.regionId,
        text: sortedLines.map((line) => line.text).join(" "),
        confidence: 0.5,
        bbox: toNormalizedOcrBbox(pixelBbox, source.width, source.height),
      } satisfies CabinetOcrDetectedLabel;
    })
    .sort((left, right) => compareOcrLabelsByPosition(left, right));
}

function isAuxiliaryStructuredOcrText(text: string): boolean {
  const normalizedText = text.replace(/\s+/g, "").trim();
  if (!normalizedText) return true;
  if (/未经审批|严禁|APT|®/u.test(normalizedText)) return true;
  if (/^([①②③④⑤⑥⑦⑧⑨⑩\d]+[开停合断亮灭])+$/u.test(normalizedText)) return true;
  if (/^(A相|B相|C相|阀门|开启|停止|关闭|解锁|闭锁)$/u.test(normalizedText)) return true;
  if (/^(阀门开启|阀门停止|阀门关闭|关闭阀门|停止停止|关闭关闭)$/u.test(normalizedText)) return true;
  // Q139、LP1 等字母数字组合通常是标签牌编号，需与同牌的名称文字合并保留。
  return false;
}

function normalizeStructuredOcrLocation(value: unknown): CabinetOcrCropRect | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: number[][] = [];
  if (value.length >= 8 && value.every((coordinate) => Number.isFinite(Number(coordinate)))) {
    for (let index = 0; index + 1 < value.length; index += 2) {
      points.push([Number(value[index]), Number(value[index + 1])]);
    }
  } else {
    for (const point of value) {
      if (!Array.isArray(point) || point.length < 2) continue;
      points.push([Number(point[0]), Number(point[1])]);
    }
  }
  return normalizeBboxPoints(points);
}

function clampPixelBbox(
  bbox: CabinetOcrCropRect | undefined,
  imageWidth: number,
  imageHeight: number,
): CabinetOcrCropRect | undefined {
  if (!bbox) return undefined;
  const left = Math.max(0, Math.min(imageWidth, bbox.x));
  const top = Math.max(0, Math.min(imageHeight, bbox.y));
  const right = Math.max(0, Math.min(imageWidth, bbox.x + bbox.w));
  const bottom = Math.max(0, Math.min(imageHeight, bbox.y + bbox.h));
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function shouldMergeStructuredOcrLines(left: StructuredOcrLine, right: StructuredOcrLine): boolean {
  const horizontalOverlap = getAxisOverlap(
    left.bbox.x,
    left.bbox.x + left.bbox.w,
    right.bbox.x,
    right.bbox.x + right.bbox.w,
  );
  const verticalOverlap = getAxisOverlap(
    left.bbox.y,
    left.bbox.y + left.bbox.h,
    right.bbox.y,
    right.bbox.y + right.bbox.h,
  );
  const minWidth = Math.max(1, Math.min(left.bbox.w, right.bbox.w));
  const minHeight = Math.max(1, Math.min(left.bbox.h, right.bbox.h));
  const horizontalGap = getAxisGap(
    left.bbox.x,
    left.bbox.x + left.bbox.w,
    right.bbox.x,
    right.bbox.x + right.bbox.w,
  );
  if (verticalOverlap / minHeight >= 0.45) {
    return horizontalGap <= Math.max(4, Math.max(left.bbox.h, right.bbox.h) * 1.5);
  }

  const verticalGap = getAxisGap(
    left.bbox.y,
    left.bbox.y + left.bbox.h,
    right.bbox.y,
    right.bbox.y + right.bbox.h,
  );
  if (verticalGap > Math.max(4, Math.max(left.bbox.h, right.bbox.h) * 2.5)) return false;

  const leftCenterX = left.bbox.x + left.bbox.w / 2;
  const rightCenterX = right.bbox.x + right.bbox.w / 2;
  const centerDistanceX = Math.abs(leftCenterX - rightCenterX);
  return horizontalOverlap / minWidth >= 0.45
    || centerDistanceX <= Math.max(left.bbox.w, right.bbox.w) * 0.3;
}

function compareStructuredOcrLines(left: StructuredOcrLine, right: StructuredOcrLine): number {
  const centerYDifference = (left.bbox.y + left.bbox.h / 2) - (right.bbox.y + right.bbox.h / 2);
  if (Math.abs(centerYDifference) <= Math.max(left.bbox.h, right.bbox.h) * 0.5) {
    return left.bbox.x - right.bbox.x;
  }
  return centerYDifference;
}

function compareOcrLabelsByPosition(left: CabinetOcrDetectedLabel, right: CabinetOcrDetectedLabel): number {
  if (!left.bbox || !right.bbox) return 0;
  const centerYDifference = (left.bbox.y + left.bbox.h / 2) - (right.bbox.y + right.bbox.h / 2);
  if (Math.abs(centerYDifference) <= Math.max(left.bbox.h, right.bbox.h)) {
    return left.bbox.x - right.bbox.x;
  }
  return centerYDifference;
}

function mergeCropRects(rects: CabinetOcrCropRect[]): CabinetOcrCropRect {
  const left = Math.min(...rects.map((bbox) => bbox.x));
  const top = Math.min(...rects.map((bbox) => bbox.y));
  const right = Math.max(...rects.map((bbox) => bbox.x + bbox.w));
  const bottom = Math.max(...rects.map((bbox) => bbox.y + bbox.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function toNormalizedOcrBbox(
  bbox: CabinetOcrCropRect,
  imageWidth: number,
  imageHeight: number,
): CabinetOcrCropRect {
  return {
    x: (bbox.x / imageWidth) * CABINET_OCR_NORMALIZED_COORDINATE_MAX,
    y: (bbox.y / imageHeight) * CABINET_OCR_NORMALIZED_COORDINATE_MAX,
    w: (bbox.w / imageWidth) * CABINET_OCR_NORMALIZED_COORDINATE_MAX,
    h: (bbox.h / imageHeight) * CABINET_OCR_NORMALIZED_COORDINATE_MAX,
  };
}

/**
 * Qwen-OCR 返回的 bbox 多数是文字框，这里用像素边缘把它扩展成物理标签牌框。
 * 如果边缘检测失败，保留原文字框，保证识别流程不中断。
 */
async function replaceTextBboxesWithPlateBboxes(
  source: CabinetOcrImageSource & { width: number; height: number },
  labels: CabinetOcrDetectedLabel[],
): Promise<CabinetOcrDetectedLabel[]> {
  const locatedLabels = labels
    .map((label, index) => ({ label, index }))
    .filter((item) => item.label.bbox);
  if (!locatedLabels.length) return labels;

  const textRects = locatedLabels.map((item) => fromNormalizedOcrBbox(
    item.label.bbox as CabinetOcrCropRect,
    source.width,
    source.height,
  ));
  try {
    const plateRects = await detectLabelPlateRects(source.dataUrl, textRects);
    const plateRectByLabelIndex = new Map<number, LabelPlatePixelRect>();
    locatedLabels.forEach((item, index) => {
      const plateRect = plateRects[index];
      if (plateRect) plateRectByLabelIndex.set(item.index, plateRect);
    });
    return labels.map((label, index) => {
      const plateRect = plateRectByLabelIndex.get(index);
      return plateRect
        ? { ...label, bbox: toNormalizedOcrBbox(plateRect, source.width, source.height) }
        : label;
    });
  } catch (error) {
    console.warn("[screen-verify] label plate edge detection failed, using text bbox", error);
    return labels;
  }
}

function fromNormalizedOcrBbox(
  bbox: CabinetOcrCropRect,
  imageWidth: number,
  imageHeight: number,
): LabelPlatePixelRect {
  return {
    x: (bbox.x / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageWidth,
    y: (bbox.y / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageHeight,
    w: (bbox.w / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageWidth,
    h: (bbox.h / CABINET_OCR_NORMALIZED_COORDINATE_MAX) * imageHeight,
  };
}

/**
 * 位置模型负责 bbox，文本模型只替换文字内容。
 * 两边数量不一致时不强行合并，避免坐标和文字错配。
 */
function mergeLocatedAndRecognizedOcrResults(
  locatedResult: CabinetOcrResult,
  textResult: CabinetOcrResult,
): CabinetOcrResult {
  const textRegions = new Map(textResult.regions.map((region) => [region.regionId, region]));
  const regions = locatedResult.regions.map((locatedRegion) => {
    const recognizedLabels = textRegions.get(locatedRegion.regionId)?.labels || [];
    if (!recognizedLabels.length || recognizedLabels.length !== locatedRegion.labels.length) {
      return locatedRegion;
    }
    return {
      ...locatedRegion,
      labels: locatedRegion.labels.map((label, index) => ({
        ...label,
        text: recognizedLabels[index].text || label.text,
      })),
    };
  });
  return {
    rawText: JSON.stringify({
      locationModel: DASH_SCOPE_OCR_MODEL,
      textModel: DASH_SCOPE_MODEL,
      locationResponse: parseJsonPayload(locatedResult.rawText) || locatedResult.rawText,
      textResponse: parseJsonPayload(textResult.rawText) || textResult.rawText,
    }),
    regions,
    labels: regions.flatMap((region) => region.labels),
  };
}

function getOcrTextFallbackReason(result: CabinetOcrResult): string | null {
  const suspiciousLabel = result.labels.find((label) => isSuspiciousOcrText(label.text));
  if (suspiciousLabel) return `疑似异常文字：${suspiciousLabel.text}`;
  return null;
}

function isSuspiciousOcrText(text: string): boolean {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) return true;
  if (/\uFFFD|[?？]{2,}|[□■]{2,}/u.test(normalizedText)) return true;
  if (/(无法识别|未识别|看不清|unknown|n\/?a)/iu.test(normalizedText)) return true;
  return !/[\p{L}\p{N}]/u.test(normalizedText);
}

function getAxisOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function getAxisGap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return Math.max(0, Math.max(leftStart, rightStart) - Math.min(leftEnd, rightEnd));
}

/**
 * 识别屏柜/主设备名称，用于框选名称后同步更新左侧主设备名称。
 */
export async function recognizeCabinetName(
  source: CabinetOcrImageSource,
  requestOptions: RecognitionRequestOptions = {},
): Promise<CabinetNameOcrResult> {
  if (!source.dataUrl.startsWith("data:image/")) throw new Error("仅支持 data URI 图片识别");

  const { response, text: payloadText } = await requestRecognitionText(
    `${DASH_SCOPE_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DASH_SCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DASH_SCOPE_MODEL,
        temperature: 0,
        enable_thinking: false,
        messages: [
          {
            role: "user",
            content: buildCabinetNameOcrContent(source),
          },
        ],
      }),
    },
    requestOptions,
  );
  const payload = parseJsonPayload<ChatCompletionResponse>(payloadText);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payloadText || `识别请求失败：${response.status}`);
  }

  const rawText = extractCompletionText(payload);
  return normalizeCabinetNameOcrResult(rawText);
}

/**
 * 按原图坐标裁剪 ROI，并返回裁剪图相对原图的偏移量。
 */
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

/**
 * 组装视觉模型请求内容。
 * 多个 ROI 来自同一原图时优先只上传一张图，减少请求体和模型干扰。
 */
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
        "每张区域图片已经裁剪到待识别范围，只返回标签文字，不要返回 bbox、坐标或置信度。",
        ...sources.map((source) => `${source.regionId}: ${source.title}`),
      ].join("\n"),
    },
  ];

  for (const source of sources) {
    content.push({ type: "text", text: `${buildCabinetOcrSourceText(source)}\n区域图：` });
    content.push({ type: "image_url", image_url: { url: source.dataUrl } });
  }
  return content;
}

function buildCabinetOcrSourceText(source: CabinetOcrImageSource): string {
  const parts = [`regionId=${source.regionId}`, `title=${source.title}`];
  if (source.width && source.height) {
    parts.push(`imageSize=${Math.round(source.width)}x${Math.round(source.height)}`);
  }
  if (source.roi) {
    parts.push(`roi=[${Math.round(source.roi.x)},${Math.round(source.roi.y)},${Math.round(source.roi.x + source.roi.w)},${Math.round(source.roi.y + source.roi.h)}]`);
  }
  return parts.join("，");
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
  if (sources.some((source) => source.coordinateMode === "crop-local")) return false;
  const firstUrl = sources[0].dataUrl;
  return sources.every((source) => source.dataUrl === firstUrl && source.roi);
}

function buildSingleImageRoiContent(sources: CabinetOcrImageSource[], prompt: string) {
  const firstSource = sources[0];
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
  const imageSizeText = firstSource.width && firstSource.height
    ? `原图尺寸=${Math.round(firstSource.width)}x${Math.round(firstSource.height)}。`
    : "";

  return [
    {
      type: "text" as const,
      text: [
        prompt,
        "",
        `下面只提供一张原图。${imageSizeText}请严格只识别 ROI_LIST 内的标签牌。`,
        "ROI_LIST 仅用于限定识别范围；只返回标签文字，不要返回 bbox、坐标或置信度。",
        `ROI_LIST=${JSON.stringify(roiList)}`,
      ].join("\n"),
    },
    {
      type: "image_url" as const,
      image_url: { url: sources[0].dataUrl },
    },
  ];
}

function parseJsonPayload<T = CabinetOcrJsonPayload>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
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

/**
 * 兼容模型可能返回的 Markdown 包裹、labels、label_boxes 等不同 JSON 字段。
 */
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

function normalizeRegions(payload: CabinetOcrJsonPayload | null, sources: CabinetOcrImageSource[]): CabinetOcrRegionResult[] {
  const sourceIds = new Set(sources.map((source) => source.regionId));
  const rawRegions = Array.isArray(payload?.regions) ? payload.regions : [];
  const byRegion = new Map<string, CabinetOcrDetectedLabel[]>();

  for (const region of rawRegions) {
    const regionId = String(region?.regionId || "").trim();
    if (!sourceIds.has(regionId)) continue;
    byRegion.set(regionId, normalizeRegionDetectedLabels(regionId, region));
  }

  return sources.map((source) => ({
    regionId: source.regionId,
    labels: byRegion.get(source.regionId) || [],
  }));
}

function normalizeRegionDetectedLabels(regionId: string, region: NonNullable<CabinetOcrJsonPayload["regions"]>[number]): CabinetOcrDetectedLabel[] {
  const rawLabels = Array.isArray(region?.labels) ? region.labels : [];
  const rawBoxLabels = readRegionBoxLabels(region);
  const labels = rawLabels
    .map((label: unknown) => normalizeDetectedLabel(regionId, label))
    .filter(Boolean) as CabinetOcrDetectedLabel[];
  const boxLabels = rawBoxLabels
    .map((label: unknown) => normalizeDetectedLabel(regionId, label))
    .filter(Boolean) as CabinetOcrDetectedLabel[];

  if (!labels.length) return boxLabels;
  if (!boxLabels.length) return labels;
  return labels.map((label, index) => {
    const boxLabel = boxLabels[index];
    if (!boxLabel || label.bbox) return label;
    return { ...label, bbox: boxLabel.bbox };
  });
}

function readRegionBoxLabels(region: NonNullable<CabinetOcrJsonPayload["regions"]>[number]): unknown[] {
  if (Array.isArray(region?.label_boxes)) return region.label_boxes;
  if (Array.isArray(region?.labelBoxes)) return region.labelBoxes;
  if (Array.isArray(region?.boxes)) return region.boxes;
  return [];
}

function normalizeCabinetNameOcrResult(rawText: string): CabinetNameOcrResult {
  const payload = parseJsonPayload<CabinetOcrJsonPayload>(extractJsonText(rawText));
  const name = String(payload?.name || payload?.text || payload?.label || "").trim();
  return {
    rawText,
    name,
    confidence: clampConfidence(payload?.confidence ?? payload?.score ?? payload?.probability),
  };
}

/**
 * 把字符串或对象形式的标签结果统一成内部结构。
 */
function normalizeDetectedLabel(regionId: string, value: any): CabinetOcrDetectedLabel | null {
  const text = typeof value === "string"
    ? value.trim()
    : String(value?.text ?? value?.label ?? value?.name ?? value?.content ?? value?.value ?? value?.title ?? value?.label_text ?? value?.labelText ?? "").trim();
  const bbox = typeof value === "string" ? undefined : normalizeDetectedLabelBbox(readDetectedLabelBboxValue(value));
  if (!text && !bbox) return null;
  return {
    regionId,
    text,
    confidence: typeof value === "string" ? 0.5 : clampConfidence(value?.confidence ?? value?.score ?? value?.probability),
    bbox,
  };
}

function mergeDetectedLabels(regionId: string, labels: CabinetOcrDetectedLabel[]): CabinetOcrDetectedLabel[] {
  const validLabels = labels.filter((label) => label.text.trim());
  if (!validLabels.length) return labels.slice(0, 1);
  if (validLabels.length <= 1) return validLabels;
  return [{
    regionId,
    text: validLabels.map((label) => label.text.trim()).join(" "),
    confidence: validLabels.reduce((sum, label) => sum + label.confidence, 0) / validLabels.length,
    bbox: mergeDetectedLabelBboxes(validLabels),
  }];
}

function readDetectedLabelBboxValue(value: any): any {
  if (!value || typeof value !== "object") return undefined;
  return value.plate_bbox
    ?? value.plateBbox
    ?? value.plate_rect
    ?? value.plateRect
    ?? value.physical_bbox
    ?? value.physicalBbox
    ?? value.physical_rect
    ?? value.physicalRect
    ?? value.label_bbox
    ?? value.labelBbox
    ?? value.label_rect
    ?? value.labelRect
    ?? value.bbox
    ?? value.text_bbox
    ?? value.textBbox
    ?? value.text_box
    ?? value.textBox
    ?? value.bbox_2d
    ?? value.bbox2d
    ?? value.box
    ?? value.box_2d
    ?? value.box2d
    ?? value.rect
    ?? value.position
    ?? value.coordinate
    ?? value.coordinates
    ?? value.points;
}

function normalizeDetectedLabelBbox(value: any): CabinetOcrCropRect | undefined {
  if (Array.isArray(value)) {
    if (value.length >= 2 && Array.isArray(value[0])) return normalizeBboxPoints(value);
    const [x1, y1, x2, y2] = value.map(Number);
    return normalizeBboxValues(x1, y1, x2, y2);
  }

  if (value && typeof value === "object") {
    const x = Number(value.x ?? value.left);
    const y = Number(value.y ?? value.top);
    const w = Number(value.w ?? value.width);
    const h = Number(value.h ?? value.height);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { x, y, w, h };

    const x1 = Number(value.x1 ?? value.xmin ?? value.x_min ?? value.left);
    const y1 = Number(value.y1 ?? value.ymin ?? value.y_min ?? value.top);
    const x2 = Number(value.x2 ?? value.xmax ?? value.x_max ?? value.right);
    const y2 = Number(value.y2 ?? value.ymax ?? value.y_max ?? value.bottom);
    return normalizeBboxValues(x1, y1, x2, y2);
  }

  return undefined;
}

function normalizeBboxPoints(points: any[]): CabinetOcrCropRect | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  if (!xs.length || !ys.length) return undefined;
  return normalizeBboxValues(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

function normalizeBboxValues(x1: number, y1: number, x2: number, y2: number): CabinetOcrCropRect | undefined {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

function mergeDetectedLabelBboxes(labels: CabinetOcrDetectedLabel[]): CabinetOcrCropRect | undefined {
  const bboxes = labels.map((label) => label.bbox).filter(Boolean) as CabinetOcrCropRect[];
  if (!bboxes.length) return undefined;
  const left = Math.min(...bboxes.map((bbox) => bbox.x));
  const top = Math.min(...bboxes.map((bbox) => bbox.y));
  const right = Math.max(...bboxes.map((bbox) => bbox.x + bbox.w));
  const bottom = Math.max(...bboxes.map((bbox) => bbox.y + bbox.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function clampConfidence(value: any): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0.5;
  return Math.min(1, Math.max(0, numberValue));
}
