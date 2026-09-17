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

type InteractionListener = () => void;

/**
 * Shared interaction ownership for one scene adapter. Editors still own their
 * local gesture state, while this object provides the cross-editor boundary.
 */
export class SpaceInteractionCoordinator {
  private mode: SpaceInteractionMode = "idle";
  private readonly claims = new Set<SpaceInteractionClaim>();
  private readonly listeners = new Set<InteractionListener>();

  getMode(): SpaceInteractionMode {
    return this.mode;
  }

  setMode(mode: SpaceInteractionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.claims.clear();
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

  reset(): void {
    const changed = this.mode !== "idle" || this.claims.size > 0;
    this.mode = "idle";
    this.claims.clear();
    if (changed) this.emitChange();
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener());
  }
}
