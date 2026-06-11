import { Splat } from '../splat';

export interface IntersectOptions { shape: string; mask?: boolean; selecting?: boolean }

export class Intersect {
  constructor(_splat: Splat) {}
}

export interface MaskOptions {}
export interface RectOptions extends IntersectOptions {}
export interface SphereOptions extends IntersectOptions {}
export interface BoxOptions extends IntersectOptions {}
