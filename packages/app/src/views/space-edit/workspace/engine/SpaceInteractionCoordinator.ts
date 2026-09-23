export type SpaceInteractionMode =
  | "idle"
  | "busy"
  | "clip"
  | "correction"
  | "cabinet"
  | "charging"
  | "device-area"
  | "path"
  | "normal"
  | "inspection-point";

export type SpaceInteractionClaim =
  | "drawing-drag"
  | "drawing-selection"
  | "path-selection";

export type SpaceSelectionOwner =
  | "drawing"
  | "charging-area"
  | "device-area"
  | "path"
  | "inspection-point";

interface SpaceSelectionTarget {
  hitDistance: (event: MouseEvent) => number | null;
  clearSelection?: () => void;
  priority: number;
}

type InteractionListener = () => void;

/**
 * Shared interaction ownership for one scene adapter. Editors still own their
 * local gesture state, while this object provides the cross-editor boundary.
 */
export class SpaceInteractionCoordinator {
  private mode: SpaceInteractionMode = "idle";
  private readonly claims = new Set<SpaceInteractionClaim>();
  private readonly listeners = new Set<InteractionListener>();
  private readonly selectionTargets = new Map<SpaceSelectionOwner, SpaceSelectionTarget>();
  private selectionWinners = new WeakMap<MouseEvent, SpaceSelectionOwner | null>();

  getMode(): SpaceInteractionMode {
    return this.mode;
  }

  setMode(mode: SpaceInteractionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.claims.clear();
    this.selectionWinners = new WeakMap();
    this.emitChange();
  }

  isMode(...allowedModes: SpaceInteractionMode[]): boolean {
    return allowedModes.includes(this.mode);
  }

  setClaim(claim: SpaceInteractionClaim, active: boolean): void {
    const changed = active ? !this.claims.has(claim) : this.claims.has(claim);
    if (!changed) return;
    if (active) this.claims.add(claim);
    else this.claims.delete(claim);
    this.emitChange();
  }

  hasClaim(claim: SpaceInteractionClaim): boolean {
    return this.claims.has(claim);
  }

  hasAnyClaim(...claims: SpaceInteractionClaim[]): boolean {
    return claims.some((claim) => this.claims.has(claim));
  }

  subscribe(listener: InteractionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerSelectionTarget(
    owner: SpaceSelectionOwner,
    target: Omit<SpaceSelectionTarget, "priority"> & { priority?: number },
  ): () => void {
    this.selectionTargets.set(owner, { ...target, priority: target.priority ?? 0 });
    this.selectionWinners = new WeakMap();
    return () => {
      this.selectionTargets.delete(owner);
      this.selectionWinners = new WeakMap();
    };
  }

  getSelectionWinner(event: MouseEvent): SpaceSelectionOwner | null {
    const cached = this.selectionWinners.get(event);
    if (cached !== undefined) return cached;

    let winner: { owner: SpaceSelectionOwner; distance: number; priority: number } | null = null;
    this.selectionTargets.forEach((target, owner) => {
      const distance = target.hitDistance(event);
      if (distance === null || !Number.isFinite(distance) || distance < 0) return;
      if (!winner
        || distance < winner.distance - 1e-6
        || (Math.abs(distance - winner.distance) <= 1e-6 && target.priority > winner.priority)) {
        winner = { owner, distance, priority: target.priority };
      }
    });
    const owner = winner?.owner ?? null;
    this.selectionWinners.set(event, owner);
    return owner;
  }

  activateSelection(owner: SpaceSelectionOwner): void {
    this.selectionTargets.forEach((target, candidate) => {
      if (candidate !== owner) target.clearSelection?.();
    });
  }

  reset(): void {
    const changed = this.mode !== "idle" || this.claims.size > 0;
    this.mode = "idle";
    this.claims.clear();
    this.selectionWinners = new WeakMap();
    if (changed) this.emitChange();
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}
