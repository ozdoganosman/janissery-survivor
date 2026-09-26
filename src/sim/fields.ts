import { clamp01, lerp } from '../core/geom';
import type { Rng } from '../core/rng';
import type { Crop, FieldPlan } from './balance';
import type { CityState } from './city';
import { WALL_NONE } from './constants';
import { dateOf } from './calendar';
import { DIRS4 } from './grid';

/**
 * Where a field is in its year:
 * - `bos`   ploughed, waiting for the next sowing;
 * - `ekili` sown and growing;
 * - `hasat` harvested, stubble until the next sowing;
 * - `nadas` left fallow this year to rest the soil.
 */
export type FieldStage = 'bos' | 'ekili' | 'hasat' | 'nadas';

export interface Field {
  id: number;
  /** Tile rectangle. */
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: number[];
  /** What to do at the next sowing. The player changes this; the season applies it. */
  plan: FieldPlan;
  stage: FieldStage;
  /** Crop growing, or harvested, this year. */
  crop: Crop | null;
  /** Soil strength, `soil.floor`..1. Drained by every harvest, restored by a fallow year. */
  soil: number;
  /** Mean fertility of the tiles. */
  fertility: number;
  /** Sum of daily staffing while growing, and the number of days summed. */
  careSum: number;
  careDays: number;
  lastYield: number;
  // Refreshed by the daily economy step:
  roadAccess: boolean;
  /** 1 near the houses, lower for fields the farmers must walk far to. */
  distanceFactor: number;
  jobs: number;
}

export type FieldTileStatus = 'ok' | 'blocked';

export interface FieldProposal {
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: Array<{ x: number; z: number; status: FieldTileStatus; reason?: string }>;
  cost: number;
  fertility: number;
  /** Whether a road runs along it; a field without one is never worked. */
  roadAccess: boolean;
  problem?: string;
}

function tileReason(city: CityState, x: number, z: number): string | undefined {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return 'Harita dışı';
  const i = grid.index(x, z);
  if (terrain.water[i] === 1) return 'Su';
  if (city.wall[i] !== WALL_NONE) return 'Sur';
  if (city.structure[i] >= 0) return 'Yapı';
  if (city.road[i] === 1) return 'Yol';
  if (city.house[i] > 0) return 'Ev';
  if (city.zone[i] === 1) return 'İmar alanı';
  if (city.field[i] >= 0) return 'Başka tarla';
  if (terrain.fertility[i] <= 0) return 'Ekilemez';
  if (terrain.slope[i] > city.balance.fields.maxSlope) return 'Çok dik';
  return undefined;
}

/** A field over the rectangle between two dragged corners, checked tile by tile. */
export function proposeField(city: CityState, ax: number, az: number, bx: number, bz: number): FieldProposal {
  const b = city.balance.fields;
  const x0 = Math.min(ax, bx);
  const z0 = Math.min(az, bz);
  const w = Math.abs(bx - ax) + 1;
  const d = Math.abs(bz - az) + 1;
  const tiles: FieldProposal['tiles'] = [];
  let problem: string | undefined;
  let fert = 0;
  let roadAccess = false;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      const reason = tileReason(city, x, z);
      if (reason === undefined) {
        tiles.push({ x, z, status: 'ok' });
        fert += city.terrain.fertility[city.grid.index(x, z)];
        roadAccess ||= nextToRoad(city, x, z);
      } else {
        tiles.push({ x, z, status: 'blocked', reason });
        problem ??= reason;
      }
    }
  }
  if (problem === undefined && Math.min(w, d) < b.minSide) problem = `En az ${b.minSide}×${b.minSide} karo`;
  if (problem === undefined && Math.max(w, d) > b.maxSide) problem = `En çok ${b.maxSide} karo`;
  const cost = w * d * b.costPerTile;
  if (problem === undefined && cost > city.treasury) problem = 'Hazine yetersiz';
  const proposal: FieldProposal = { x0, z0, w, d, tiles, cost, fertility: fert / (w * d), roadAccess };
  if (problem !== undefined) proposal.problem = problem;
  return proposal;
}

/** How much a crop makes of a given soil, as a multiplier on its base yield. */
export function fertilityFactor(city: CityState, crop: Crop, fertility: number): number {
  const w = city.balance.fields.crops[crop].fertilityWeight;
  // Wheat follows the soil closely; barley shrugs off poor ground but gains less from rich.
  return lerp(0.55, 1.25 * fertility, w);
}

/**
 * Lays out a proposal. Charges the treasury unless `free` (the fields the city starts with).
 * Returns null, changing nothing, if the proposal is no longer valid.
 */
export function buildField(city: CityState, p: FieldProposal, plan: FieldPlan, free = false): Field | null {
  const fresh = proposeField(city, p.x0, p.z0, p.x0 + p.w - 1, p.z0 + p.d - 1);
  if (fresh.problem !== undefined && !(free && fresh.problem === 'Hazine yetersiz')) return null;
  const { grid } = city;
  const id = city.nextFieldId++;
  const tiles = fresh.tiles.map((t) => grid.index(t.x, t.z));
  const field: Field = {
    id,
    x0: fresh.x0,
    z0: fresh.z0,
    w: fresh.w,
    d: fresh.d,
    tiles,
    plan,
    stage: 'bos',
    crop: null,
    soil: 1,
    fertility: fresh.fertility,
    careSum: 0,
    careDays: 0,
    lastYield: 0,
    roadAccess: false,
    distanceFactor: 1,
    jobs: 0,
  };
  for (const i of tiles) city.field[i] = id;
  city.fields.set(id, field);
  if (!free) city.treasury -= fresh.cost;
  // Inside the sowing window a new field goes straight into the ground.
  if (city.balance.fields.sowMonths.includes(dateOf(city.calendar).month)) sow(field);
  field.roadAccess = touchesRoad(city, field);
  city.revision.fields++;
  return field;
}

export function removeField(city: CityState, id: number): boolean {
  const field = city.fields.get(id);
  if (field === undefined) return false;
  for (const i of field.tiles) city.field[i] = -1;
  city.fields.delete(id);
  city.revision.fields++;
  return true;
}

/** Sets what the field does at the next sowing. The current season is not disturbed. */
export function setFieldPlan(city: CityState, id: number, plan: FieldPlan): void {
  const field = city.fields.get(id);
  if (field === undefined || field.plan === plan) return;
  field.plan = plan;
  city.revision.fields++;
}

/** A field needs a road along one of its sides, or the farmers cannot reach it. */
export function touchesRoad(city: CityState, field: Field): boolean {
  const { grid } = city;
  return field.tiles.some((i) => nextToRoad(city, i % grid.size, Math.floor(i / grid.size)));
}

function nextToRoad(city: CityState, x: number, z: number): boolean {
  const { grid } = city;
  for (const [dx, dz] of DIRS4) {
    if (grid.inBounds(x + dx, z + dz) && city.road[grid.index(x + dx, z + dz)] === 1) return true;
  }
  return false;
}

function sow(field: Field): void {
  field.careSum = 0;
  field.careDays = 0;
  if (field.plan === 'nadas') {
    field.stage = 'nadas';
    field.crop = null;
  } else {
    field.stage = 'ekili';
    field.crop = field.plan;
  }
}

/** Sowing day: every field takes up its plan for the year. Returns how many were sown. */
export function sowAll(city: CityState): number {
  let sown = 0;
  for (const f of city.fields.values()) {
    sow(f);
    if (f.stage === 'ekili') sown++;
  }
  city.revision.fields++;
  return sown;
}

/** The harvest a growing field would give if it were cut today. */
export function expectedYield(city: CityState, f: Field, staffingToday = 1): number {
  if (f.crop === null || f.stage !== 'ekili') return 0;
  const crop = city.balance.fields.crops[f.crop];
  const care = f.careDays > 0 ? f.careSum / f.careDays : staffingToday;
  return (
    f.tiles.length *
    crop.yield *
    fertilityFactor(city, f.crop, f.fertility) *
    f.soil *
    f.distanceFactor *
    care
  );
}

/** Harvest day. Grain goes to the granary; soils are drained or rested. Returns the total. */
export function harvestAll(city: CityState): number {
  const soil = city.balance.fields.soil;
  let total = 0;
  for (const f of city.fields.values()) {
    if (f.stage === 'ekili') {
      const y = Math.round(expectedYield(city, f));
      f.lastYield = y;
      total += y;
      f.stage = 'hasat';
      f.soil = Math.max(soil.floor, f.soil - soil.drain);
    } else if (f.stage === 'nadas') {
      f.lastYield = 0;
      f.soil = Math.min(1, f.soil + soil.regain);
    }
  }
  city.granary += total;
  city.revision.fields++;
  return total;
}

/** Distance penalty for a field whose nearest house is `distance` tiles away. */
export function distanceFactor(city: CityState, distance: number): number {
  const d = city.balance.fields.distance;
  return 1 - d.maxPenalty * clamp01((distance - d.free) / d.range);
}

/**
 * The fields the city already farms on day one: strips along the roads outside the walls.
 * Every road tile offers a few candidate rectangles beside it; the most fertile go first,
 * wheat on good bottom land and barley on poorer ground.
 */
export function seedStartingFields(city: CityState, rng: Rng): void {
  const { grid, def } = city;
  const target = city.balance.fields.startTiles;
  const candidates: Array<{ p: FieldProposal; score: number }> = [];
  for (let i = 0; i < grid.count; i++) {
    if (city.road[i] !== 1 || city.terrain.water[i] === 1) continue;
    const rx = i % grid.size;
    const rz = Math.floor(i / grid.size);
    const r = Math.hypot(grid.centre(rx) - def.tepe.x, grid.centre(rz) - def.tepe.z);
    if (r < def.walls.radius + 3 || r > def.walls.radius + 55) continue;
    if (!rng.chance(0.3)) continue;
    const w = 5 + rng.int(5);
    const d = 4 + rng.int(4);
    for (const [dx, dz] of DIRS4) {
      const x0 = dx > 0 ? rx + 1 : dx < 0 ? rx - w : rx - Math.floor(w / 2);
      const z0 = dz > 0 ? rz + 1 : dz < 0 ? rz - d : rz - Math.floor(d / 2);
      const p = proposeField(city, x0, z0, x0 + w - 1, z0 + d - 1);
      if (p.problem !== undefined && p.problem !== 'Hazine yetersiz') continue;
      // Rich soil first, and nearer the gates a little before farther out.
      candidates.push({ p, score: p.fertility - r * 0.004 + rng.next() * 0.02 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  let placed = 0;
  for (const { p } of candidates) {
    if (placed >= target) break;
    const field = buildField(city, p, p.fertility >= 0.5 ? 'bugday' : 'arpa', true);
    if (field !== null) placed += field.tiles.length;
  }
}
