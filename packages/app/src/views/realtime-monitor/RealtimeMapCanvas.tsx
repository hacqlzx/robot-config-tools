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
    regions.forEach((region) => {
      const points = parseRegionPoints(region?.pose || region?.coordinatePixel);
      if (points.length < 3) return;
      context.save();
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach((point) => context.lineTo(point[0], point[1]));
      context.closePath();
      const isChargingRegion = String(region?.type) === "4";
      const regionColor = isChargingRegion ? "rgba(255, 140, 0" : "rgba(30, 144, 255";
      context.fillStyle = `${regionColor}, 0.16)`;
      context.strokeStyle = `${regionColor}, 0.82)`;
      context.lineWidth = 1.5;
      context.fill();
      context.stroke();
      context.restore();

      const name = String(region?.name || region?.regionName || "").trim();
      if (name) {
        const minX = Math.min(...points.map((point) => point[0]));
        const minY = Math.min(...points.map((point) => point[1]));
        context.save();
        context.font = "13px Arial";
        context.lineWidth = 4 / Math.max(state.zoom, 0.05);
        context.strokeStyle = "rgba(0, 0, 0, 0.8)";
        context.fillStyle = "#dffefe";
        context.strokeText(name, minX + 8, minY + 8);
        context.fillText(name, minX + 8, minY + 8);
        context.restore();
      }
    });

    const roads = Array.isArray(mapData.roads) ? mapData.roads : [];
    roads.forEach((road) => {
      const startPoint = parseRoadPoint(road?.startIndex);
      const endPoint = parseRoadPoint(road?.endIndex);
      if (!startPoint || !endPoint) return;
      const controlPointA = parseRoadPoint(road?.controlPointA);
      const controlPointB = parseRoadPoint(road?.controlPointB);

      context.save();
      context.beginPath();
      context.moveTo(startPoint[0], startPoint[1]);
      if (controlPointA && controlPointB) {
        context.bezierCurveTo(controlPointA[0], controlPointA[1], controlPointB[0], controlPointB[1], endPoint[0], endPoint[1]);
      } else {
        context.lineTo(endPoint[0], endPoint[1]);
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

      const label = String(robot.name || "").trim();
      if (label) {
        context.save();
        context.font = "14px Arial";
        context.textAlign = "center";
        context.textBaseline = "top";
        context.lineWidth = 4 / Math.max(state.zoom, 0.05);
        context.strokeStyle = "rgba(0, 0, 0, 0.88)";
        context.fillStyle = "#8ecbff";
        context.strokeText(label, robotX, robotY + 24);
        context.fillText(label, robotX, robotY + 24);
        context.restore();
      }
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
