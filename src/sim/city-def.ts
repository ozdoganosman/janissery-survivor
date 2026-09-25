import type { Vec2 } from '../core/geom';

/**
 * The authored description of a city: what the player inherits on day one.
 *
 * Positions are in world units with the origin at the map centre; one tile is one unit.
 * Anything not listed here (individual houses, alleys) is generated from `seed`.
 */
export interface CityDef {
  id: string;
  name: string;
  title: string;
  seed: number;
  /** Tiles per side of the square map. */
  size: number;
  start: { year: number; month: number; day: number; treasury: number };
  tepe: { x: number; z: number; topRadius: number; footRadius: number; height: number };
  walls: { radius: number; height: number; towerSpacing: number };
  gates: GateDef[];
  stream: { name: string; width: number; points: Vec2[] };
  hills: { north: HillDef; west: HillDef };
  streets: { tepeRing: number; innerRing: number; alleys: number };
  housing: { innerRadius: number; frontFill: number; backFill: number; twoStorey: number };
  landmarks: LandmarkDef[];
}

export interface GateDef {
  name: string;
  /** Degrees, measured from +x towards +z (east towards south). */
  angle: number;
  /** Control points of the road leaving the gate, from near the wall outwards. */
  road: Vec2[];
}

export interface HillDef {
  /** Coordinate where the slope starts rising... */
  from: number;
  /** ...and where it reaches full height. */
  to: number;
  height: number;
}

export type LandmarkKind = 'cami' | 'kumbet' | 'kosk' | 'mescit' | 'hamam';

export interface LandmarkDef {
  kind: LandmarkKind;
  name: string;
  /** Either an explicit position... */
  x?: number;
  z?: number;
  /** ...or a polar one around the tepe, which keeps ring-street layouts readable. */
  angle?: number;
  radius?: number;
  /** Footprint in tiles. */
  w: number;
  d: number;
  rot?: number;
}

/** Fails loudly on a malformed city file instead of producing a half-built map. */
export function validateCityDef(def: CityDef): CityDef {
  const problems: string[] = [];
  if (!Number.isInteger(def.size) || def.size < 32) problems.push('size must be an integer >= 32');
  if (def.walls.radius * 2 >= def.size) problems.push('walls do not fit on the map');
  if (def.gates.length === 0) problems.push('a walled city needs at least one gate');
  if (def.stream.points.length < 2) problems.push('stream needs at least two points');
  for (const l of def.landmarks) {
    const explicit = l.x !== undefined && l.z !== undefined;
    const polar = l.angle !== undefined && l.radius !== undefined;
    if (!explicit && !polar) problems.push(`landmark "${l.name}" has no position`);
    if (l.w < 1 || l.d < 1) problems.push(`landmark "${l.name}" has an empty footprint`);
  }
  if (problems.length > 0) throw new Error(`Invalid city "${def.id}": ${problems.join('; ')}`);
  return def;
}
