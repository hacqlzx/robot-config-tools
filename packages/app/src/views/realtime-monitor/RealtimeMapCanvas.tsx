import { useCallback, useEffect, useRef, useState } from "react";
import onlineRobotImage from "@/assets/img/onlineRobot.png";
import offOnlineRobotImage from "@/assets/img/offOnlineRobot.png";

export interface DirectMapData {
  imageSource?: string;
  mapFilePath?: string;
  width?: number | string;
  height?: number | string;
  mapWidth?: number | string;
  mapHeight?: number | string;
  regions?: any[];
  roads?: any[];
  stopNodes?: any[];
  [key: string]: any;
}

export interface RobotPosition {
  x?: number | string;
  y?: number | string;
  rotation?: number | string;
  name?: string;
  onlineState?: number | string;
  state?: string;
}

interface CanvasState {
  viewportWidth: number;
  viewportHeight: number;
  sceneWidth: number;
  sceneHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  image: HTMLImageElement | null;
  onlineRobot: HTMLImageElement | null;
  offOnlineRobot: HTMLImageElement | null;
  isDragging: boolean;
  dragStartX: number;
  dragStartY: number;
  dragOriginX: number;
  dragOriginY: number;
}

interface RegionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LabelCandidate {
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const REGION_COLOR_BY_TYPE: Record<string, string> = {
  "1": "rgba(34, 197, 94",
  "2": "rgba(34, 197, 94",
  "4": "rgba(255, 140, 0",
  "8": "rgba(30, 144, 255",
};

interface RegionColors {
  fill: string;
  stroke: string;
}

function getRegionColors(region: any): RegionColors {
  const regionType = String(region?.type || "");
  const regionText = [
    region?.name,
    region?.regionName,
    region?.areaName,
    region?.typeName,
    region?.regionTypeName,
    region?.code,
    region?.regionType,
    region?.type,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();

  if (regionType === "4" || regionText.includes("充电") || regionText.includes("charge")) {
    return {
      fill: "rgba(245, 158, 11, 0.22)",
      stroke: "rgba(245, 158, 11, 0.95)",
    };
  }

  const isCabinetRegion = ["1", "2"].includes(regionType)
    || regionText.includes("屏柜")
    || regionText.includes("柜排")
    || regionText.includes("cabinet");
  if (isCabinetRegion) {
    return {
      fill: "rgba(34, 197, 94, 0.22)",
      stroke: "rgba(34, 197, 94, 0.95)",
    };
  }

  const isBlueRegion = regionType === "8"
    || regionText.includes("设备")
    || regionText.includes("device");
  if (isBlueRegion) {
    return {
      fill: "rgba(30, 144, 255, 0.22)",
      stroke: "rgba(30, 144, 255, 0.95)",
    };
  }

  const fallbackColor = REGION_COLOR_BY_TYPE[regionType] || REGION_COLOR_BY_TYPE["2"];
  return {
    fill: `${fallbackColor}, 0.16)`,
    stroke: `${fallbackColor}, 0.82)`,
  };
}

function getRegionBounds(points: [number, number][]): RegionBounds {
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1])),
  };
}

function getLabelBox(
  context: CanvasRenderingContext2D,
  text: string,
  candidate: LabelCandidate,
  padding: number,
): LabelBox {
  const width = context.measureText(text).width;
  const fontSize = Number.parseFloat(context.font) || 13;
  const height = fontSize * 1.2;
  let left = candidate.x;
  let top = candidate.y;

  if (candidate.align === "center") left -= width / 2;
  if (candidate.align === "right" || candidate.align === "end") left -= width;
  if (candidate.baseline === "middle") top -= height / 2;
  if (candidate.baseline === "bottom" || candidate.baseline === "alphabetic") top -= height;

  return {
    left: left - padding,
    top: top - padding,
    right: left + width + padding,
    bottom: top + height + padding,
  };
}

function labelBoxesOverlap(first: LabelBox, second: LabelBox): boolean {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

function getRegionLabelCandidates(bounds: RegionBounds, type: string): LabelCandidate[] {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const gap = 10;
  const inset = 8;

  if (type === "1") {
    return [
      { x: centerX, y: bounds.minY - gap, align: "center", baseline: "bottom" },
      { x: centerX, y: bounds.maxY + gap, align: "center", baseline: "top" },
      { x: bounds.minX - gap, y: centerY, align: "right", baseline: "middle" },
      { x: bounds.maxX + gap, y: centerY, align: "left", baseline: "middle" },
      { x: bounds.minX + inset, y: bounds.minY + inset, align: "left", baseline: "top" },
    ];
  }

  if (type === "2") {
    return [
      { x: bounds.minX + inset, y: bounds.minY + inset, align: "left", baseline: "top" },
      { x: bounds.maxX - inset, y: bounds.minY + inset, align: "right", baseline: "top" },
      { x: centerX, y: bounds.minY + inset, align: "center", baseline: "top" },
      { x: bounds.minX + inset, y: bounds.maxY - inset, align: "left", baseline: "bottom" },
      { x: centerX, y: centerY, align: "center", baseline: "middle" },
    ];
  }

  return [
    { x: bounds.minX + inset, y: bounds.minY + inset, align: "left", baseline: "top" },
    { x: centerX, y: bounds.minY + inset, align: "center", baseline: "top" },
    { x: centerX, y: centerY, align: "center", baseline: "middle" },
  ];
}

function parseRoadPoint(value: unknown): [number, number] | null {
  if (Array.isArray(value)) {
    const point = value.slice(0, 2).map((coordinate) => Number(coordinate));
    return point.length === 2 && point.every(Number.isFinite) ? [point[0], point[1]] : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const point = value
    .trim()
    .split(/[,_]/)
    .slice(0, 2)
    .map((coordinate) => Number(coordinate));
  return point.length === 2 && point.every(Number.isFinite) ? [point[0], point[1]] : null;
}

function parseRegionPoints(value: unknown): [number, number][] {
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0])) {
      return value
        .map((point) => point.slice(0, 2).map((coordinate: unknown) => Number(coordinate)))
        .filter((point) => point.length === 2 && point.every(Number.isFinite))
        .map((point) => [point[0], point[1]]);
    }
    const points: [number, number][] = [];
    for (let index = 0; index < value.length - 1; index += 2) {
      const point: [number, number] = [Number(value[index]), Number(value[index + 1])];
      if (point.every(Number.isFinite)) points.push(point);
    }
    return points;
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(";")
    .map((item) => parseRoadPoint(item))
    .filter(Boolean) as [number, number][];
}

function getDirectMapSize(data: DirectMapData | null): { width: number; height: number } {
  const points: [number, number][] = [];
  const addPoint = (value: unknown) => {
    const point = parseRoadPoint(value);
    if (point) points.push(point);
  };
  (Array.isArray(data?.roads) ? data?.roads : []).forEach((road) => {
    addPoint(road?.startIndex);
    addPoint(road?.endIndex);
    addPoint(road?.controlPointA);
    addPoint(road?.controlPointB);
  });
  (Array.isArray(data?.stopNodes) ? data?.stopNodes : []).forEach((node) => {
    const x = Number(node?.poseX);
    const y = Number(node?.poseY);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
  });
  (Array.isArray(data?.regions) ? data?.regions : []).forEach((region) => {
    points.push(...parseRegionPoints(region?.pose || region?.coordinatePixel));
  });

  const maxX = points.length ? Math.max(...points.map((point) => point[0])) : 0;
  const maxY = points.length ? Math.max(...points.map((point) => point[1])) : 0;
  return {
    width: Number(data?.width || data?.mapWidth) || (points.length ? Math.max(maxX + 80, 1) : 0),
    height: Number(data?.height || data?.mapHeight) || (points.length ? Math.max(maxY + 80, 1) : 0),
  };
}

type MapCoordinateTransform = {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseWaypointPoint(value: unknown): [number, number] | null {
  if (Array.isArray(value)) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  if (value && typeof value === "object") {
    const point = value as Record<string, unknown>;
    const x = Number(point.x ?? point.poseX ?? point.pose_x);
    const y = Number(point.y ?? point.poseY ?? point.pose_y);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const numbers = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(/[,_\s]+/)
    .map((coordinate) => Number(coordinate))
    .filter(Number.isFinite);
  return numbers.length >= 2 ? [numbers[0], numbers[1]] : null;
}

function parseWaypoints(value: unknown): [number, number][] {
  if (Array.isArray(value)) {
    const firstValue = value[0];
    if (
      value.length > 0
      && (
        Array.isArray(firstValue)
        || (firstValue && typeof firstValue === "object")
        || (typeof firstValue === "string" && /[,;_\s]/.test(firstValue))
      )
    ) {
      return value
        .map((point) => parseWaypointPoint(point))
        .filter((point): point is [number, number] => point !== null);
    }
    const point = parseWaypointPoint(value);
    return point ? [point] : [];
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = record.points ?? record.waypoints ?? record.items ?? record.data;
    if (nested !== undefined) return parseWaypoints(nested);
    const point = parseWaypointPoint(value);
    return point ? [point] : [];
  }

  if (typeof value !== "string" || !value.trim()) return [];
  const text = value.trim();
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      return parseWaypoints(JSON.parse(text));
    } catch {
      // Fall through to the protocol's semicolon-delimited form.
    }
  }

  return text
    .split(";")
    .map((point) => parseWaypointPoint(point))
    .filter((point): point is [number, number] => point !== null);
}

function getRoadWaypoints(road: any): [number, number][] {
  return parseWaypoints(road?.waypoints ?? road?.waypoint ?? road?.wayPoints);
}

function distanceBetweenPoints(first: [number, number], second: [number, number]): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

/**
 * 从起止点和 waypoint 拟合局部米制坐标到地图像素坐标的转换。
 *
 * 实时监控地图是俯视图：waypoint 的 z 只属于三维高度，绘制时投影到 x/y 平面。
 * 地图像素 Y 轴向下，而机器人坐标 y 轴向上，所以 scaleY 必须为负值。
 */
function estimateCoordinateTransform(roads: any[]): MapCoordinateTransform {
  const scaleXs: number[] = [];
  const scaleYs: number[] = [];
  const xAnchors: Array<[number, number]> = [];
  const yAnchors: Array<[number, number]> = [];

  roads.forEach((road) => {
    const startPoint = parseRoadPoint(road?.startIndex);
    const endPoint = parseRoadPoint(road?.endIndex);
    const waypoints = getRoadWaypoints(road);
    if (!startPoint || !endPoint || !waypoints.length) return;

    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    const localDeltaX = last[0] - first[0];
    const localDeltaY = last[1] - first[1];
    const mapDeltaX = endPoint[0] - startPoint[0];
    const mapDeltaY = endPoint[1] - startPoint[1];

    if (Math.abs(localDeltaX) > 1e-6) {
      const scaleX = mapDeltaX / localDeltaX;
      if (Number.isFinite(scaleX) && Math.abs(scaleX) < 1000) scaleXs.push(scaleX);
    }
    if (Math.abs(localDeltaY) > 1e-6) {
      const scaleY = mapDeltaY / localDeltaY;
      if (Number.isFinite(scaleY) && Math.abs(scaleY) < 1000) scaleYs.push(scaleY);
    }

    xAnchors.push([startPoint[0], first[0]]);
    yAnchors.push([startPoint[1], first[1]]);
  });

  const scaleX = median(scaleXs) ?? 100;
  const scaleY = median(scaleYs) ?? -100;
  return {
    scaleX,
    scaleY,
    offsetX: median(xAnchors.map(([mapCoordinate, localCoordinate]) => mapCoordinate - localCoordinate * scaleX)) ?? 0,
    offsetY: median(yAnchors.map(([mapCoordinate, localCoordinate]) => mapCoordinate - localCoordinate * scaleY)) ?? 0,
  };
}

/**
 * 将 waypoint 投影到地图像素，并用路线端点做渐进式锚定。
 *
 * 个别后台路线的 waypoint 首尾会因采样或四舍五入与 startIndex/endIndex 相差几个像素。
 * 直接绘制会在路线开头或结尾产生短回折；按路径进度分摊误差可以保留中间曲线形状，
 * 同时保证路线准确接到地图上的两个端点。
 */
function getRoadWaypointPixels(
  road: any,
  transform: MapCoordinateTransform,
): [number, number][] {
  const waypoints = getRoadWaypoints(road);
  const startPoint = parseRoadPoint(road?.startIndex);
  const endPoint = parseRoadPoint(road?.endIndex);
  if (waypoints.length < 2 || !startPoint || !endPoint) {
    return waypoints.map((point) => [
      point[0] * transform.scaleX + transform.offsetX,
      point[1] * transform.scaleY + transform.offsetY,
    ] as [number, number]);
  }

  const mapped = waypoints.map((point) => [
    point[0] * transform.scaleX + transform.offsetX,
    point[1] * transform.scaleY + transform.offsetY,
  ] as [number, number]);
  const startCorrection: [number, number] = [
    startPoint[0] - mapped[0][0],
    startPoint[1] - mapped[0][1],
  ];
  const endCorrection: [number, number] = [
    endPoint[0] - mapped[mapped.length - 1][0],
    endPoint[1] - mapped[mapped.length - 1][1],
  ];

  const cumulativeDistances = [0];
  for (let index = 1; index < mapped.length; index += 1) {
    cumulativeDistances.push(
      cumulativeDistances[index - 1] + distanceBetweenPoints(mapped[index - 1], mapped[index]),
    );
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];

  return mapped.map((point, index) => {
    const progress = totalDistance > 1e-6
      ? cumulativeDistances[index] / totalDistance
      : index / (mapped.length - 1);
    return [
      point[0] + startCorrection[0] * (1 - progress) + endCorrection[0] * progress,
      point[1] + startCorrection[1] * (1 - progress) + endCorrection[1] * progress,
    ];
  });
}

export default function RealtimeMapCanvas({
  directMapData,
  robotPosition,
}: {
  directMapData: DirectMapData | null;
  robotPosition: RobotPosition;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const directMapDataRef = useRef<DirectMapData | null>(null);
  const robotPositionRef = useRef<RobotPosition>({});
  const stateRef = useRef<CanvasState>({
    viewportWidth: 0,
    viewportHeight: 0,
    sceneWidth: 0,
    sceneHeight: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    image: null,
    onlineRobot: null,
    offOnlineRobot: null,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
  });
  const [hasScene, setHasScene] = useState(false);

  const fitToViewport = useCallback(() => {
    const state = stateRef.current;
    if (!state.sceneWidth || !state.sceneHeight || !state.viewportWidth || !state.viewportHeight) return;
    const padding = 56;
    const widthRatio = (state.viewportWidth - padding) / state.sceneWidth;
    const heightRatio = (state.viewportHeight - padding) / state.sceneHeight;
    state.zoom = Math.max(0.05, Math.min(1.15, Math.min(widthRatio, heightRatio)));
    state.offsetX = (state.viewportWidth - state.sceneWidth * state.zoom) / 2;
    state.offsetY = (state.viewportHeight - state.sceneHeight * state.zoom) / 2;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const state = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, state.viewportWidth, state.viewportHeight);
    context.fillStyle = "#20271f";
    context.fillRect(0, 0, state.viewportWidth, state.viewportHeight);

    if (!state.sceneWidth || !state.sceneHeight) return;

    const mapData = directMapDataRef.current || {};
    context.save();
    context.translate(state.offsetX, state.offsetY);
    context.scale(state.zoom, state.zoom);

    if (state.image?.complete) {
      context.drawImage(state.image, 0, 0, state.sceneWidth, state.sceneHeight);
    } else {
      context.fillStyle = "rgba(128, 148, 136, 0.08)";
      context.fillRect(0, 0, state.sceneWidth, state.sceneHeight);
      context.strokeStyle = "rgba(173, 194, 177, 0.18)";
      context.lineWidth = 1;
      context.strokeRect(0, 0, state.sceneWidth, state.sceneHeight);
    }

    const regions = Array.isArray(mapData.regions) ? mapData.regions : [];
    const regionLabelItems = regions
      .map((region) => {
        const points = parseRegionPoints(region?.pose || region?.coordinatePixel);
        if (points.length < 3) return null;
        return {
          region,
          points,
          type: String(region?.type || ""),
          name: String(region?.name || region?.regionName || "").trim(),
          bounds: getRegionBounds(points),
        };
      })
      .filter(Boolean) as Array<{
        region: any;
        points: [number, number][];
        type: string;
        name: string;
        bounds: RegionBounds;
      }>;

    regionLabelItems.forEach(({ region, points }) => {
      context.save();
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
      context.closePath();
      const colors = getRegionColors(region);
      context.fillStyle = colors.fill;
      context.strokeStyle = colors.stroke;
      context.lineWidth = 1.5;
      context.fill();
      context.stroke();
      context.restore();
    });

    const placedRegionLabelBoxes: LabelBox[] = [];
    regionLabelItems
      .filter(({ name }) => Boolean(name))
      .sort((first, second) => (first.type === "2" ? -1 : 0) - (second.type === "2" ? -1 : 0))
      .forEach(({ name, type, bounds }) => {
        context.save();
        context.font = type === "1" ? "12px Arial" : "13px Arial";
        context.textAlign = "left";
        context.textBaseline = "top";

        const candidates = getRegionLabelCandidates(bounds, type);
        const scoredCandidates = candidates.map((candidate) => {
          const box = getLabelBox(context, name, candidate, 3);
          const overlapCount = placedRegionLabelBoxes.reduce(
            (count, placedBox) => count + (labelBoxesOverlap(box, placedBox) ? 1 : 0),
            0,
          );
          const outsideScene = box.left < 0 || box.top < 0 || box.right > state.sceneWidth || box.bottom > state.sceneHeight;
          return { candidate, box, score: overlapCount * 100 + (outsideScene ? 1 : 0) };
        });
        const selected = scoredCandidates.reduce((best, current) => current.score < best.score ? current : best);

        context.textAlign = selected.candidate.align;
        context.textBaseline = selected.candidate.baseline;
        context.lineWidth = 4 / Math.max(state.zoom, 0.05);
        context.strokeStyle = "rgba(0, 0, 0, 0.8)";
        context.fillStyle = "#dffefe";
        context.strokeText(name, selected.candidate.x, selected.candidate.y);
        context.fillText(name, selected.candidate.x, selected.candidate.y);
        context.restore();
        placedRegionLabelBoxes.push(selected.box);
      });

    const roads = Array.isArray(mapData.roads) ? mapData.roads : [];
    // 当前接口已直接返回地图二维坐标，暂时不做局部坐标到地图像素的换算。
    // 保留下面的转换逻辑，后续如果接口恢复返回局部米制坐标，可以直接恢复使用：
    // const transform = estimateCoordinateTransform(roads);

    roads.forEach((road) => {
      const startPoint = parseRoadPoint(road?.startIndex);
      const endPoint = parseRoadPoint(road?.endIndex);
      if (!startPoint || !endPoint) return;

      // 解析结果直接作为地图像素坐标使用；如果返回三维数据，parseWaypointPoint 只取 x/y。
      const waypointsList = getRoadWaypoints(road);
      // 旧的局部坐标换算入口暂时保留：
      // const waypointsList = getRoadWaypointPixels(road, estimateCoordinateTransform(roads));

      context.save();
      context.beginPath();
      context.moveTo(startPoint[0], startPoint[1]);

      if (waypointsList.length > 0) {
        // 使用 waypoints 绘制多段折线
        let lastPoint = startPoint;
        waypointsList.forEach((point) => {
          if (distanceBetweenPoints(lastPoint, point) < 0.01) return;
          context.lineTo(point[0], point[1]);
          lastPoint = point;
        });
        // 最后连接到终点
        if (distanceBetweenPoints(lastPoint, endPoint) >= 0.01) {
          context.lineTo(endPoint[0], endPoint[1]);
        }
      } else {
        // 回退到原有逻辑：贝塞尔曲线或直线
        const controlPointA = parseRoadPoint(road?.controlPointA);
        const controlPointB = parseRoadPoint(road?.controlPointB);
        if (controlPointA && controlPointB) {
          context.bezierCurveTo(controlPointA[0], controlPointA[1], controlPointB[0], controlPointB[1], endPoint[0], endPoint[1]);
        } else {
          context.lineTo(endPoint[0], endPoint[1]);
        }
      }

      context.strokeStyle = "#03e903";
      context.lineWidth = 4;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
      context.restore();
    });

    const stopNodes = Array.isArray(mapData.stopNodes) ? mapData.stopNodes : [];
    stopNodes.forEach((node) => {
      const x = Number(node?.poseX);
      const y = Number(node?.poseY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const text = String(node?.name || node?.nodeName || "").trim();

      context.save();
      context.translate(x, y);
      context.rotate((((Number(node?.poseYaw) || 0) + 90) * Math.PI) / 180);
      context.fillStyle = "rgba(0, 190, 255, 0.9)";
      context.strokeStyle = "rgba(0, 0, 0, 0.6)";
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(0, -6);
      context.lineTo(6, 6);
      context.lineTo(0, 3);
      context.lineTo(-6, 6);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();

      if (text) {
        context.save();
        context.font = "11px Arial";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.lineWidth = 3 / Math.max(state.zoom, 0.05);
        context.strokeStyle = "rgba(0, 0, 0, 0.9)";
        context.fillStyle = "#ffffff";
        context.strokeText(text, x, y - 9);
        context.fillText(text, x, y - 9);
        context.restore();
      }
    });

    const robot = robotPositionRef.current || {};
    const robotX = Number(robot.x);
    const robotY = Number(robot.y);
    if (Number.isFinite(robotX) && Number.isFinite(robotY)) {
      const rotation = Number(robot.rotation) || 0;
      const online = robot.onlineState === 1 || robot.onlineState === "1";
      const robotImage = online ? state.onlineRobot : state.offOnlineRobot;
      context.save();
      context.translate(robotX, robotY);
      context.rotate((rotation * Math.PI) / 180);
      if (robotImage?.complete) {
        context.drawImage(robotImage, -25.5, -15, 51, 30);
      }
      context.restore();

    }

    context.restore();
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    const loadRobotImage = (source: string, key: "onlineRobot" | "offOnlineRobot") => {
      const image = new Image();
      image.onload = () => {
        state[key] = image;
        draw();
      };
      image.src = source;
      state[key] = image;
    };

    loadRobotImage(onlineRobotImage, "onlineRobot");
    loadRobotImage(offOnlineRobotImage, "offOnlineRobot");
  }, [draw]);

  const updateViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const state = stateRef.current;
    state.viewportWidth = viewport.clientWidth;
    state.viewportHeight = viewport.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(state.viewportWidth * dpr));
    canvas.height = Math.max(1, Math.round(state.viewportHeight * dpr));
    canvas.style.width = `${state.viewportWidth}px`;
    canvas.style.height = `${state.viewportHeight}px`;
    fitToViewport();
    draw();
  }, [draw, fitToViewport]);

  useEffect(() => {
    directMapDataRef.current = directMapData;
    const state = stateRef.current;
    state.image = null;
    const fallbackSize = getDirectMapSize(directMapData);
    state.sceneWidth = fallbackSize.width;
    state.sceneHeight = fallbackSize.height;
    setHasScene(Boolean(state.sceneWidth && state.sceneHeight));

    let disposed = false;
    const source = directMapData?.imageSource || directMapData?.mapFilePath;
    if (source) {
      const image = new Image();
      image.onload = () => {
        if (disposed) return;
        state.image = image;
        state.sceneWidth = image.naturalWidth || image.width || fallbackSize.width;
        state.sceneHeight = image.naturalHeight || image.height || fallbackSize.height;
        setHasScene(Boolean(state.sceneWidth && state.sceneHeight));
        fitToViewport();
        draw();
      };
      image.onerror = () => {
        if (disposed) return;
        fitToViewport();
        draw();
      };
      image.src = source;
    }

    fitToViewport();
    draw();
    return () => {
      disposed = true;
    };
  }, [directMapData, draw, fitToViewport]);

  useEffect(() => {
    robotPositionRef.current = robotPosition || {};
    draw();
  }, [draw, robotPosition]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(viewport);

    const handleWheel = (event: WheelEvent) => {
      const state = stateRef.current;
      if (!state.sceneWidth || !state.sceneHeight) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointX = event.clientX - rect.left;
      const pointY = event.clientY - rect.top;
      const oldZoom = state.zoom;
      const nextZoom = Math.max(0.05, Math.min(8, oldZoom * Math.exp(-event.deltaY * 0.0015)));
      const logicalX = (pointX - state.offsetX) / oldZoom;
      const logicalY = (pointY - state.offsetY) / oldZoom;
      state.zoom = nextZoom;
      state.offsetX = pointX - logicalX * nextZoom;
      state.offsetY = pointY - logicalY * nextZoom;
      draw();
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const state = stateRef.current;
      state.isDragging = true;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.dragOriginX = state.offsetX;
      state.dragOriginY = state.offsetY;
      viewport.classList.add("is-dragging");
    };

    const handleMouseMove = (event: MouseEvent) => {
      const state = stateRef.current;
      if (!state.isDragging) return;
      state.offsetX = state.dragOriginX + event.clientX - state.dragStartX;
      state.offsetY = state.dragOriginY + event.clientY - state.dragStartY;
      draw();
    };

    const handleMouseUp = () => {
      const state = stateRef.current;
      state.isDragging = false;
      viewport.classList.remove("is-dragging");
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draw, updateViewport]);

  return (
    <div ref={viewportRef} className="realtime-map-canvas">
      <canvas ref={canvasRef} className="realtime-map-canvas__canvas" />
      {!hasScene && <div className="realtime-map-canvas__empty">暂无地图数据</div>}
    </div>
  );
}
