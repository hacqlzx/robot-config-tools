import type { ViewDirection } from "../../types";
import type { SpaceInteractionMode } from "./SpaceInteractionCoordinator";
import type { DrawingItem, InspectionPointItem, NormalAnnotationItem, PathData } from "../../hooks/drawing/drawing-schema";

export type SpaceSceneLifecycleState = "detached" | "mounting" | "ready" | "failed";
export type SpaceViewLock = "none" | "top";

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

export type SpaceNormalAnnotation = NormalAnnotationItem;
export type SpaceInspectionPoint = InspectionPointItem;

export interface SpaceNormalAnnotationState {
  count: number;
  selectedId: string | null;
  active: boolean;
}

export interface SpaceNormalAnnotationCallbacks {
  onChange: (state: SpaceNormalAnnotationState) => void;
  onHistory?: SpaceDrawingHistoryCallback;
}

export interface SpaceInspectionPointState {
  count: number;
  selectedId: string | null;
  active: boolean;
}

export interface SpaceInspectionPointCallbacks {
  onChange: (state: SpaceInspectionPointState) => void;
  onHistory?: SpaceDrawingHistoryCallback;
  onAddBlocked?: () => void;
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
  selectedBoxName: string;
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

export interface SpaceClipBox {
  centerX: number;
  centerY: number;
  centerZ: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

export const SPACE_RENDER_DETAIL_LEVELS = [1, 2, 3, 4] as const;
export type SpaceRenderDetailLevel = (typeof SPACE_RENDER_DETAIL_LEVELS)[number];

export const SPACE_POINT_BUDGET_MIN = 100_000;
export const SPACE_POINT_BUDGET_MAX = 100_000_000;
export const SPACE_POINT_BUDGET_STEP = 100_000;
export const SPACE_POINT_BUDGET_ALL = "all" as const;
export type SpacePointBudget = number | typeof SPACE_POINT_BUDGET_ALL;
export const SPACE_COLOR_ADJUSTMENT_MIN = -1;
export const SPACE_COLOR_ADJUSTMENT_MAX = 1;
export const SPACE_COLOR_ADJUSTMENT_STEP = 0.01;
export const SPACE_GAMMA_MIN = 0.1;
export const SPACE_GAMMA_MAX = 4;
export const SPACE_GAMMA_STEP = 0.01;

export interface SpaceRenderSettings {
  detailLevel: SpaceRenderDetailLevel;
  pointBudget: SpacePointBudget;
  gamma: number;
  brightness: number;
  contrast: number;
}

export const DEFAULT_SPACE_RENDER_SETTINGS: SpaceRenderSettings = {
  detailLevel: 4,
  pointBudget: SPACE_POINT_BUDGET_ALL,
  gamma: 1,
  brightness: 0,
  contrast: 0,
};

const LEGACY_DEFAULT_SPACE_RENDER_SETTINGS: SpaceRenderSettings = {
  detailLevel: 2,
  pointBudget: 500_000,
  gamma: 1,
  brightness: 0,
  contrast: 0,
};

export type SpaceDrawingHistoryScope = "cabinet" | "charging" | "device-area" | "path" | "normal" | "inspection-point";
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
  const pointBudget = settings.pointBudget === SPACE_POINT_BUDGET_ALL
    ? SPACE_POINT_BUDGET_ALL
    : typeof settings.pointBudget !== "number" || !Number.isFinite(settings.pointBudget)
      ? DEFAULT_SPACE_RENDER_SETTINGS.pointBudget
      : Math.round(Math.min(
        SPACE_POINT_BUDGET_MAX,
        Math.max(SPACE_POINT_BUDGET_MIN, settings.pointBudget),
      ) / SPACE_POINT_BUDGET_STEP) * SPACE_POINT_BUDGET_STEP;
  const normalizeColorAdjustment = (value: unknown, fallback: number) => (
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(SPACE_COLOR_ADJUSTMENT_MAX, Math.max(SPACE_COLOR_ADJUSTMENT_MIN, value))
      : fallback
  );
  const gamma = typeof settings.gamma === "number" && Number.isFinite(settings.gamma)
    ? Math.min(SPACE_GAMMA_MAX, Math.max(SPACE_GAMMA_MIN, settings.gamma))
    : DEFAULT_SPACE_RENDER_SETTINGS.gamma;

  return {
    detailLevel,
    pointBudget,
    gamma,
    brightness: normalizeColorAdjustment(settings.brightness, DEFAULT_SPACE_RENDER_SETTINGS.brightness),
    contrast: normalizeColorAdjustment(settings.contrast, DEFAULT_SPACE_RENDER_SETTINGS.contrast),
  };
}

/** Migrate the previous implicit default without overwriting explicit user choices. */
export function migrateSpaceRenderSettings(settings: SpaceRenderSettings): SpaceRenderSettings {
  return settings.detailLevel === LEGACY_DEFAULT_SPACE_RENDER_SETTINGS.detailLevel
    && settings.pointBudget === LEGACY_DEFAULT_SPACE_RENDER_SETTINGS.pointBudget
    && settings.gamma === LEGACY_DEFAULT_SPACE_RENDER_SETTINGS.gamma
    && settings.brightness === LEGACY_DEFAULT_SPACE_RENDER_SETTINGS.brightness
    && settings.contrast === LEGACY_DEFAULT_SPACE_RENDER_SETTINGS.contrast
    ? { ...DEFAULT_SPACE_RENDER_SETTINGS }
    : settings;
}

/**
 * Minimal lifecycle boundary for a space-scene engine.
 * Each editing workflow adds only the adapter methods it needs while the legacy
 * PlayCanvas implementation remains available for the not-yet-migrated tools.
 */
export interface SpaceSceneAdapter {
  mount(host: HTMLElement): void | Promise<void>;
  setActive(active: boolean): void;
  setInteractionMode(mode: SpaceInteractionMode): void;
  loadModel(model: SpaceSceneModel): void | Promise<void>;
  pickPointAt(clientX: number, clientY: number): [number, number, number] | null;
  setCoordinateCorrectionMarker(point: [number, number, number] | null): void;
  setViewDirection(direction: ViewDirection): void;
  setViewLock(lock: SpaceViewLock): void;
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
  clearDeviceAreaSelection(): void;
  renameSelectedDeviceArea(name: string): void;
  bindSelectedDeviceAreaBay(bay: SpaceDeviceAreaBay): void;
  unbindSelectedDeviceAreaBay(): void;
  discardUnboundDeviceAreas(): void;
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
  clearPathDrawing(): void;
  startNormalAnnotationEditing(callbacks: SpaceNormalAnnotationCallbacks): boolean;
  setNormalAnnotationEnabled(enabled: boolean): void;
  setNormalAnnotations(items: SpaceNormalAnnotation[]): void;
  getNormalAnnotations(): SpaceNormalAnnotation[];
  selectNormalAnnotation(id: string | null): void;
  renameNormalAnnotation(id: string, name: string): void;
  bindNormalAnnotationPoint(id: string, point: { pointCode: string; pointName?: string }): void;
  unbindNormalAnnotationPoint(id: string): void;
  deleteNormalAnnotation(id: string): void;
  hasNormalAnnotationDraft(): boolean;
  clearNormalAnnotations(): void;
  undoNormalAnnotation(): void;
  redoNormalAnnotation(): void;
  setInspectionPointCallbacks(callbacks: SpaceInspectionPointCallbacks | null): void;
  startInspectionPointEditing(): boolean;
  setInspectionPointEnabled(enabled: boolean): void;
  setInspectionPointDefaultComponentType(componentType: string | undefined): void;
  setInspectionPoints(items: SpaceInspectionPoint[]): void;
  setVisibleInspectionPointIds(ids: string[]): void;
  setInspectionPointNamesVisible(visible: boolean): void;
  getInspectionPoints(): SpaceInspectionPoint[];
  selectInspectionPoint(id: string | null): void;
  renameInspectionPoint(id: string, name: string): void;
  setInspectionPointComponentType(id: string, componentType: string | undefined): void;
  setInspectionPointLength(id: string, length: number): void;
  bindInspectionPointPoint(id: string, point: { pointCode: string; pointName?: string; bayCode?: string; bayName?: string }): void;
  unbindInspectionPointPoint(id: string): void;
  deleteInspectionPoint(id: string): void;
  markInspectionPointsSaved(): void;
  hasInspectionPointDraft(): boolean;
  clearInspectionPoints(): void;
  undoInspectionPoint(): void;
  redoInspectionPoint(): void;
  startClipping(onBoxChange: (box: SpaceClipBox) => void, initialBox?: SpaceClipBox | null): SpaceClipBox | null;
  setClipRotationVisible(visible: boolean): void;
  setClipBox(box: SpaceClipBox): void;
  commitClipping(): SpaceClipBox | null;
  stopClipping(): void;
  clearModel(): void;
  resize(): void;
  dispose(): void | Promise<void>;
  restoreDrawingHistorySnapshot(scope: SpaceDrawingHistoryScope, snapshot: SpaceDrawingHistorySnapshot): void;
  focusAlongDirection(cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, extent: number): void;
}

export type SpaceSceneAdapterFactory = () => SpaceSceneAdapter;
