import type { ViewDirection } from "../../types";
import type { DrawingItem, PathData } from "../../hooks/drawing/drawing-schema";

export type SpaceSceneLifecycleState = "detached" | "mounting" | "ready" | "failed";

export interface SpaceSceneModel {
  name: string;
  metadataUrl: string;
  clipBounds?: SpaceClipBounds;
}

export interface SpaceDrawingLayer {
  areas?: DrawingItem[];
  path?: PathData | null;
  rays?: SpaceRayItem[];
}

export interface SpaceRayItem {
  id?: string | number;
  name?: string;
  origin: [number, number, number];
  direction: [number, number, number];
  length?: number;
}

export interface SpaceDrawingSelection {
  layerId: string;
  item: DrawingItem;
}

export interface SpaceDrawingInteractionCallbacks {
  onSelect: (selection: SpaceDrawingSelection | null) => void;
  onDelete: (selection: SpaceDrawingSelection) => void;
}

export interface SpaceChargingAreaState {
  pointCount: number;
  height: number;
  hasBox: boolean;
  selected: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SpaceChargingAreaCallbacks {
  onChange: (state: SpaceChargingAreaState) => void;
  onDelete: () => void;
  onHistory?: SpaceDrawingHistoryCallback;
}

export interface SpaceDeviceAreaBay {
  id: number;
  name: string;
  code: string;
}

export interface SpaceDeviceAreaBox {
  id: string;
  verts: number[][];
  height: number;
  bay: SpaceDeviceAreaBay | null;
  name?: string;
}

export interface SpaceDeviceAreaState {
  pointCount: number;
  boxCount: number;
  height: number;
  selectedBoxId: string | null;
  selectedBoxBay: SpaceDeviceAreaBay | null;
  boundBayIds: number[];
  hasDraft: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SpaceDeviceAreaCallbacks {
  onChange: (state: SpaceDeviceAreaState) => void;
  onDelete: () => void;
  onHistory?: SpaceDrawingHistoryCallback;
}

export interface SpaceCabinetState {
  cornerCount: number;
  cabinetCount: number;
  hasDraft: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SpaceCabinetCallbacks {
  onChange: (state: SpaceCabinetState) => void;
  onHistory?: SpaceDrawingHistoryCallback;
}

export interface SpacePathState {
  pointCount: number;
  connectionCount: number;
  active: boolean;
  selectedPointId: string | null;
  selectedPathId: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SpacePathCallbacks {
  onChange: (state: SpacePathState) => void;
  onHistory?: SpaceDrawingHistoryCallback;
}

export interface SpaceClipBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export const SPACE_RENDER_DETAIL_LEVELS = [1, 2, 3, 4] as const;
export type SpaceRenderDetailLevel = (typeof SPACE_RENDER_DETAIL_LEVELS)[number];

export const SPACE_POINT_BUDGET_MIN = 100_000;
export const SPACE_POINT_BUDGET_MAX = 100_000_000;
export const SPACE_POINT_BUDGET_STEP = 100_000;
export const SPACE_POINT_BUDGET_ALL = "all" as const;
export type SpacePointBudget = number | typeof SPACE_POINT_BUDGET_ALL;

export interface SpaceRenderSettings {
  detailLevel: SpaceRenderDetailLevel;
  pointBudget: SpacePointBudget;
}

export const DEFAULT_SPACE_RENDER_SETTINGS: SpaceRenderSettings = {
  detailLevel: 2,
  pointBudget: 500_000,
};

export type SpaceDrawingHistoryScope = "cabinet" | "charging" | "device-area" | "path";
export type SpaceDrawingHistorySnapshot = unknown;
export type SpaceDrawingHistoryCallback = (
  before: SpaceDrawingHistorySnapshot,
  after: SpaceDrawingHistorySnapshot,
  label: string,
) => void;

export function normalizeSpaceRenderSettings(settings: Partial<SpaceRenderSettings>): SpaceRenderSettings {
  const detailLevel = SPACE_RENDER_DETAIL_LEVELS.includes(settings.detailLevel as SpaceRenderDetailLevel)
    ? settings.detailLevel as SpaceRenderDetailLevel
    : DEFAULT_SPACE_RENDER_SETTINGS.detailLevel;
  if (settings.pointBudget === SPACE_POINT_BUDGET_ALL) {
    return { detailLevel, pointBudget: SPACE_POINT_BUDGET_ALL };
  }
  const fallbackBudget = typeof DEFAULT_SPACE_RENDER_SETTINGS.pointBudget === "number"
    ? DEFAULT_SPACE_RENDER_SETTINGS.pointBudget
    : 500_000;
  const requestedBudget = typeof settings.pointBudget === "number" && Number.isFinite(settings.pointBudget)
    ? settings.pointBudget
    : fallbackBudget;
  const pointBudget = Math.round(Math.min(
    SPACE_POINT_BUDGET_MAX,
    Math.max(SPACE_POINT_BUDGET_MIN, requestedBudget),
  ) / SPACE_POINT_BUDGET_STEP) * SPACE_POINT_BUDGET_STEP;

  return { detailLevel, pointBudget };
}

/**
 * Minimal lifecycle boundary for a space-scene engine.
 * Each editing workflow adds only the adapter methods it needs while the legacy
 * PlayCanvas implementation remains available for the not-yet-migrated tools.
 */
export interface SpaceSceneAdapter {
  mount(host: HTMLElement): void | Promise<void>;
  setActive(active: boolean): void;
  loadModel(model: SpaceSceneModel): void | Promise<void>;
  setViewDirection(direction: ViewDirection): void;
  getRenderSettings(): SpaceRenderSettings;
  setRenderSettings(settings: SpaceRenderSettings): void;
  setDrawingLayer(layerId: string, data: SpaceDrawingLayer): void;
  removeDrawingLayer(layerId: string): void;
  clearDrawingLayers(): void;
  setDrawingInteractionCallbacks(callbacks: SpaceDrawingInteractionCallbacks | null): void;
  startChargingAreaDrawing(callbacks: SpaceChargingAreaCallbacks): boolean;
  setChargingAreaDrawingEnabled(enabled: boolean): void;
  setChargingAreaHeight(height: number): void;
  getChargingAreaVerts(): number[][] | null;
  hasChargingAreaDraft(): boolean;
  undoChargingArea(): void;
  redoChargingArea(): void;
  clearChargingAreaDrawing(): void;
  startDeviceAreaDrawing(callbacks: SpaceDeviceAreaCallbacks): boolean;
  setDeviceAreaDrawingEnabled(enabled: boolean): void;
  setDeviceAreaHeight(height: number): void;
  getDeviceAreaBoxes(): SpaceDeviceAreaBox[];
  loadDeviceAreaBoxes(boxes: SpaceDeviceAreaBox[]): void;
  hasDeviceAreaDraft(): boolean;
  bindSelectedDeviceAreaBay(bay: SpaceDeviceAreaBay): void;
  unbindSelectedDeviceAreaBay(): void;
  undoDeviceArea(): void;
  redoDeviceArea(): void;
  clearDeviceAreaDrawing(): void;
  startCabinetDrawing(callbacks: SpaceCabinetCallbacks): boolean;
  setCabinetDrawingEnabled(enabled: boolean): void;
  setCabinetNames(names: string[]): void;
  getCabinetGeometry(): { verts: number[][]; splits: number[] } | null;
  hasCabinetDraft(): boolean;
  undoCabinet(): void;
  redoCabinet(): void;
  clearCabinetDrawing(): void;
  startPathDrawing(callbacks: SpacePathCallbacks): boolean;
  setPathDrawingEnabled(enabled: boolean): void;
  setPathDrawingActive(active: boolean): void;
  setEditablePathData(data: PathData | null): void;
  getPathData(): PathData | null;
  hasPathDraft(): boolean;
  undoPath(): void;
  redoPath(): void;
  clearPathDrawing(): void;
  startClipping(onBoundsChange: (bounds: SpaceClipBounds) => void): SpaceClipBounds | null;
  setClipBounds(bounds: SpaceClipBounds): void;
  stopClipping(): void;
  clearModel(): void;
  resize(): void;
  dispose(): void | Promise<void>;
  restoreDrawingHistorySnapshot(scope: SpaceDrawingHistoryScope, snapshot: SpaceDrawingHistorySnapshot): void;
  focusAlongDirection(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number): void;
}

export type SpaceSceneAdapterFactory = () => SpaceSceneAdapter;
