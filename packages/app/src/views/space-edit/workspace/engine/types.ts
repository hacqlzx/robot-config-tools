export type SpaceSceneLifecycleState = "detached" | "mounting" | "ready" | "failed";

export interface SpaceSceneModel {
  name: string;
  metadataUrl: string;
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
 * Model loading, drawing and clipping contracts will be added as each workflow is migrated.
 */
export interface SpaceSceneAdapter {
  mount(host: HTMLElement): void | Promise<void>;
  loadModel(model: SpaceSceneModel): void | Promise<void>;
  getRenderSettings(): SpaceRenderSettings;
  setRenderSettings(settings: SpaceRenderSettings): void;
  clearModel(): void;
  resize(): void;
  dispose(): void | Promise<void>;
}

export type SpaceSceneAdapterFactory = () => SpaceSceneAdapter;
