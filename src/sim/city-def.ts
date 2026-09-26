import type { Vec2 } from '../core/geom';
import type { BuildingKind } from './balance';

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
  start: { year: number; month: number; day: number };
  tepe: { x: number; z: number; topRadius: number; footRadius: number; height: number };
  walls: { radius: number; height: number; towerSpacing: number };
  gates: GateDef[];
  stream: { name: string; width: number; points: Vec2[] };
  hills: { north: HillDef; west: HillDef };
  streets: { tepeRing: number; innerRing: number; alleys: number };
  /** Where houses may stand, and how many people the city starts with. */
  housing: { innerRadius: number; twoStorey: number; startPopulation: number };
  landmarks: LandmarkDef[];
  /** What the city makes of its own, and where it is dug or cut. */
  resource: ResourceDef;
  /** Buildings the city already has on day one. */
  buildings: StartBuildingDef[];
  /** New rings of walls the city can raise as it grows, innermost first. */
  expansions: ExpansionDef[];
  /** Streets that open outside the walls as the people spill out. */
  suburbs: SuburbsDef;
}

export interface ExpansionDef {
  name: string;
  /** Radius of the new ring of walls around the tepe. */
  radius: number;
  /** City rank (index into the balance's levels) the work needs. */
  rank: number;
  cost: number;
  material: number;
  months: number;
  /** Building slots and points of order the new walls add. */
  slots: number;
  order: number;
  /** Dead-end alleys laid off the new ring street. */
  alleys: number;
}

export interface SuburbsDef {
  /** Ring roads outside the first walls, as distances beyond them. */
  rings: number[];
  /** People more the city needs for each new street. */
  every: number;
  /** Lanes run out from each stretch of ring road. */
  alleys: number;
}

export interface ResourceDef {
  /** Name of the good, as the ledger shows it: Taş, Odun, Demir. */
  good: string;
  /** What it is counted in. */
  unit: string;
  /** Name of the building that brings it in: Taş Ocağı, Baltacı Ocağı, Maden. */
  building: string;
  sites: SiteDef[];
}

export interface SiteDef {
  name: string;
  x: number;
  z: number;
  radius: number;
}

export interface StartBuildingDef {
  kind: BuildingKind;
  name: string;
  level: number;
  /** Where to build, or as close to it as the rules allow. */
  near: Vec2;
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
  if (def.resource.sites.length === 0) problems.push('the city needs somewhere to get its product');
  for (const s of def.resource.sites) if (s.radius <= 0) problems.push(`site "${s.name}" has no size`);
  for (const b of def.buildings) if (b.level < 1) problems.push(`start building "${b.name}" has no level`);
  let last = def.walls.radius;
  for (const e of def.expansions) {
    if (e.radius <= last + 4) problems.push(`walls "${e.name}" must lie well outside the ring inside them`);
    last = e.radius;
  }
  if (last * 2 >= def.size) problems.push('the outer walls do not fit on the map');
  if (problems.length > 0) throw new Error(`Invalid city "${def.id}": ${problems.join('; ')}`);
  return def;
}
