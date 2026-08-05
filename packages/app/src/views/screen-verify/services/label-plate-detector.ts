export interface LabelPlatePixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface IndexedRect {
  index: number;
  rect: LabelPlatePixelRect;
}

interface EdgeCandidate {
  position: number;
  score: number;
}

const EDGE_SAMPLE_OFFSET = 2;
const EDGE_CANDIDATE_COUNT = 8;
const EDGE_NON_MAX_DISTANCE = 3;
const MIN_TEXT_MARGIN = 2;

/**
 * 将 Qwen OCR 返回的“文字框”扩展为图片中的“物理标签牌框”。
 *
 * 算法步骤：
 * 1. 根据文字框的纵向中心先分行，避免上下两排标签互相干扰。
 * 2. 使用同一排文字框的中位高度、上下边界和水平间距，估算标签牌的常规尺寸。
 * 3. 在每个文字框四周搜索颜色变化明显的像素边缘，作为标签牌边缘候选。
 * 4. 同时考虑边缘强度、预期尺寸和中心偏移，选择最合理的一对左右边/上下边。
 * 5. 找不到可信边缘时回退到同排统计值，最后把结果限制在图片范围内。
 */
export async function detectLabelPlateRects(
  imageDataUrl: string,
  textRects: LabelPlatePixelRect[],
): Promise<LabelPlatePixelRect[]> {
  if (!textRects.length) return [];
  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建标签边缘检测画布");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const inputs = textRects.map((rect, index) => ({
    index,
    rect: clampRect(rect, canvas.width, canvas.height),
  }));
  const detected = new Array<LabelPlatePixelRect>(inputs.length);

  for (const row of splitIntoRows(inputs)) {
    const sortedRow = [...row].sort((left, right) => getCenterX(left.rect) - getCenterX(right.rect));
    // 同一排标签通常尺寸和间距接近，中位数不容易被某个超长文字框或漏检框带偏。
    const centerDistances = sortedRow.slice(1).map((item, index) => (
      getCenterX(item.rect) - getCenterX(sortedRow[index].rect)
    ));
    const rowSpacing = median(centerDistances.filter((distance) => distance > 0));
    const rowTextHeight = median(sortedRow.map((item) => item.rect.h));
    const rowTextTop = median(sortedRow.map((item) => item.rect.y));
    const rowTextBottom = median(sortedRow.map((item) => item.rect.y + item.rect.h));
    // 上下边只在文字附近估算。下方扩展量刻意较小，防止吸附到标签下面的指示灯或阴影。
    const rowPlateTop = Math.max(0, rowTextTop - Math.max(6, rowTextHeight * 0.45));
    const rowPlateBottom = Math.min(
      imageData.height,
      rowTextBottom + Math.max(5, rowTextHeight * 0.18),
    );

    sortedRow.forEach((item, rowIndex) => {
      const previous = sortedRow[rowIndex - 1]?.rect;
      const next = sortedRow[rowIndex + 1]?.rect;
      detected[item.index] = detectSinglePlateRect(
        imageData,
        item.rect,
        previous,
        next,
        rowSpacing,
        rowTextHeight,
        rowPlateTop,
        rowPlateBottom,
      );
    });
  }

  return detected;
}

function detectSinglePlateRect(
  imageData: ImageData,
  textRect: LabelPlatePixelRect,
  previousTextRect: LabelPlatePixelRect | undefined,
  nextTextRect: LabelPlatePixelRect | undefined,
  rowSpacing: number,
  rowTextHeight: number,
  rowPlateTop: number,
  rowPlateBottom: number,
): LabelPlatePixelRect {
  const imageWidth = imageData.width;
  const imageHeight = imageData.height;
  const textCenterX = getCenterX(textRect);
  // 有相邻标签时优先用中心间距推算牌宽；孤立标签则按文字宽高给出保守估值。
  const expectedWidth = rowSpacing > 0
    ? clampNumber(rowSpacing * 0.86, textRect.w + MIN_TEXT_MARGIN * 2, rowSpacing * 0.96)
    : clampNumber(Math.max(textRect.w * 1.6, textRect.h * 3.5), textRect.w + 8, imageWidth * 0.9);
  const expectedHeight = Math.max(textRect.h + MIN_TEXT_MARGIN * 2, rowPlateBottom - rowPlateTop);

  // 搜索范围最多到相邻两个标签中心的中点，防止当前框抢到隔壁标签的边缘。
  const leftLimit = previousTextRect
    ? Math.ceil((getCenterX(previousTextRect) + textCenterX) / 2)
    : Math.floor(Math.max(0, textCenterX - expectedWidth * 0.75));
  const rightLimit = nextTextRect
    ? Math.floor((textCenterX + getCenterX(nextTextRect)) / 2)
    : Math.ceil(Math.min(imageWidth - 1, textCenterX + expectedWidth * 0.75));
  const verticalStart = Math.max(EDGE_SAMPLE_OFFSET, Math.floor(textRect.y - expectedHeight * 0.45));
  const verticalEnd = Math.min(
    imageHeight - EDGE_SAMPLE_OFFSET - 1,
    Math.ceil(textRect.y + textRect.h + expectedHeight * 0.45),
  );

  // 先分别寻找左右高对比边缘，再联合评分；候选边必须完整包住 OCR 文字框。
  const leftCandidates = findEdgeCandidates(
    Math.max(EDGE_SAMPLE_OFFSET, leftLimit),
    Math.floor(textRect.x - MIN_TEXT_MARGIN),
    (position) => scoreVerticalEdge(imageData, position, verticalStart, verticalEnd),
  );
  const rightCandidates = findEdgeCandidates(
    Math.ceil(textRect.x + textRect.w + MIN_TEXT_MARGIN),
    Math.min(imageWidth - EDGE_SAMPLE_OFFSET - 1, rightLimit),
    (position) => scoreVerticalEdge(imageData, position, verticalStart, verticalEnd),
  );
  const horizontalPair = chooseEdgePair(
    leftCandidates,
    rightCandidates,
    expectedWidth,
    textCenterX,
    textRect.x,
    textRect.x + textRect.w,
  );
  const left = horizontalPair?.start ?? clampNumber(textCenterX - expectedWidth / 2, leftLimit, textRect.x - MIN_TEXT_MARGIN);
  const right = horizontalPair?.end ?? clampNumber(textCenterX + expectedWidth / 2, textRect.x + textRect.w + MIN_TEXT_MARGIN, rightLimit);

  // 上下边只允许在同排统计边界附近吸附，不在整块区域内盲搜，避免框到阴影或指示灯。
  const verticalSnapRange = Math.max(4, rowTextHeight * 0.22);
  const topCandidates = findEdgeCandidates(
    Math.max(EDGE_SAMPLE_OFFSET, Math.floor(rowPlateTop - verticalSnapRange)),
    Math.min(Math.floor(textRect.y - MIN_TEXT_MARGIN), Math.ceil(rowPlateTop + verticalSnapRange)),
    (position) => scoreHorizontalEdge(imageData, position, left, right),
  );
  const bottomCandidates = findEdgeCandidates(
    Math.max(Math.ceil(textRect.y + textRect.h + MIN_TEXT_MARGIN), Math.floor(rowPlateBottom - verticalSnapRange)),
    Math.min(imageHeight - EDGE_SAMPLE_OFFSET - 1, Math.ceil(rowPlateBottom + verticalSnapRange)),
    (position) => scoreHorizontalEdge(imageData, position, left, right),
  );
  const verticalPair = chooseEdgePair(
    topCandidates,
    bottomCandidates,
    expectedHeight,
    (rowPlateTop + rowPlateBottom) / 2,
    textRect.y,
    textRect.y + textRect.h,
  );
  const top = verticalPair?.start ?? rowPlateTop;
  const bottom = verticalPair?.end ?? rowPlateBottom;

  return clampRect({
    x: Math.floor(left),
    y: Math.floor(top),
    w: Math.ceil(right - left),
    h: Math.ceil(bottom - top),
  }, imageWidth, imageHeight);
}

function findEdgeCandidates(
  start: number,
  end: number,
  scoreAt: (position: number) => number,
): EdgeCandidate[] {
  if (end < start) return [];
  const candidates: EdgeCandidate[] = [];
  for (let position = Math.ceil(start); position <= Math.floor(end); position++) {
    candidates.push({ position, score: scoreAt(position) });
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: EdgeCandidate[] = [];
  for (const candidate of candidates) {
    // 非极大值抑制：相邻像素通常属于同一条粗边，只保留其中最强的一个位置。
    if (selected.some((item) => Math.abs(item.position - candidate.position) < EDGE_NON_MAX_DISTANCE)) continue;
    selected.push(candidate);
    if (selected.length >= EDGE_CANDIDATE_COUNT) break;
  }
  return selected;
}

function chooseEdgePair(
  startCandidates: EdgeCandidate[],
  endCandidates: EdgeCandidate[],
  expectedSize: number,
  expectedCenter: number,
  contentStart: number,
  contentEnd: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number; score: number } | null = null;
  for (const start of startCandidates) {
    for (const end of endCandidates) {
      const size = end.position - start.position;
      if (size <= 0 || start.position > contentStart - MIN_TEXT_MARGIN || end.position < contentEnd + MIN_TEXT_MARGIN) continue;
      const center = (start.position + end.position) / 2;
      const sizePenalty = Math.abs(size - expectedSize) / Math.max(1, expectedSize);
      const centerPenalty = Math.abs(center - expectedCenter) / Math.max(1, expectedSize);
      // 强边优先，但尺寸明显异常或中心偏离文字太远的边缘对会被降分。
      const score = start.score + end.score - sizePenalty * 45 - centerPenalty * 24;
      if (!best || score > best.score) best = { start: start.position, end: end.position, score };
    }
  }
  return best;
}

function scoreVerticalEdge(imageData: ImageData, x: number, startY: number, endY: number): number {
  const samples: number[] = [];
  for (let y = startY; y <= endY; y++) {
    samples.push(getPixelDifference(imageData, x - EDGE_SAMPLE_OFFSET, y, x + EDGE_SAMPLE_OFFSET, y));
  }
  return summarizeEdgeSamples(samples);
}

function scoreHorizontalEdge(imageData: ImageData, y: number, startX: number, endX: number): number {
  const samples: number[] = [];
  for (let x = Math.ceil(startX); x <= Math.floor(endX); x++) {
    samples.push(getPixelDifference(imageData, x, y - EDGE_SAMPLE_OFFSET, x, y + EDGE_SAMPLE_OFFSET));
  }
  return summarizeEdgeSamples(samples);
}

function getPixelDifference(imageData: ImageData, leftX: number, leftY: number, rightX: number, rightY: number): number {
  const leftOffset = (leftY * imageData.width + leftX) * 4;
  const rightOffset = (rightY * imageData.width + rightX) * 4;
  return (
    Math.abs(imageData.data[leftOffset] - imageData.data[rightOffset])
    + Math.abs(imageData.data[leftOffset + 1] - imageData.data[rightOffset + 1])
    + Math.abs(imageData.data[leftOffset + 2] - imageData.data[rightOffset + 2])
  ) / 3;
}

function summarizeEdgeSamples(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const upperQuartile = sorted[Math.floor((sorted.length - 1) * 0.75)] || 0;
  // 均值反映整条边是否连续，上四分位数保留透明卡槽、反光等局部强边的信息。
  return average * 0.65 + upperQuartile * 0.35;
}

function splitIntoRows(items: IndexedRect[]): IndexedRect[][] {
  const rows: IndexedRect[][] = [];
  // 以纵向中心距离聚类；阈值跟随文字高度，兼容不同分辨率和字号。
  for (const item of [...items].sort((left, right) => getCenterY(left.rect) - getCenterY(right.rect))) {
    const row = rows.find((candidate) => {
      const rowCenter = median(candidate.map((entry) => getCenterY(entry.rect)));
      const rowHeight = median(candidate.map((entry) => entry.rect.h));
      return Math.abs(getCenterY(item.rect) - rowCenter) <= Math.max(rowHeight, item.rect.h) * 1.5;
    });
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows;
}

function clampRect(rect: LabelPlatePixelRect, imageWidth: number, imageHeight: number): LabelPlatePixelRect {
  const left = clampNumber(rect.x, 0, imageWidth);
  const top = clampNumber(rect.y, 0, imageHeight);
  const right = clampNumber(rect.x + rect.w, left, imageWidth);
  const bottom = clampNumber(rect.y + rect.h, top, imageHeight);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function getCenterX(rect: LabelPlatePixelRect): number {
  return rect.x + rect.w / 2;
}

function getCenterY(rect: LabelPlatePixelRect): number {
  return rect.y + rect.h / 2;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadImage(imageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("标签边缘检测图片加载失败"));
    image.src = imageDataUrl;
  });
}
