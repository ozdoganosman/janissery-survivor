import type { CityState } from './city';
import { WALL_NONE } from './constants';
import { removeBuilding } from './buildings';
import { removeField } from './fields';

export type ZoneTileStatus = 'new' | 'existing' | 'blocked';

export interface ZoneProposal {
  /** `far` marks a lot with no road within reach: it is zoned, but nothing rises on it yet. */
  tiles: Array<{ x: number; z: number; status: ZoneTileStatus; reason?: string; far?: boolean }>;
  /** Tiles that would become zoned. */
  added: number;
  /** How many of those are too far from a road to be built on. */
  far: number;
}

function rect(ax: number, az: number, bx: number, bz: number): [number, number, number, number] {
  return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
}

function zoneReason(city: CityState, x: number, z: number): string | undefined {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return 'Harita dışı';
  const i = grid.index(x, z);
  if (terrain.water[i] === 1) return 'Su';
  if (city.wall[i] !== WALL_NONE) return 'Sur';
  if (city.structure[i] >= 0 || city.building[i] >= 0) return 'Yapı';
  if (city.road[i] === 1) return 'Yol';
  if (city.field[i] >= 0) return city.fields.get(city.field[i])?.kind === 'mera' ? 'Mera' : 'Tarla';
  if (terrain.slope[i] > city.balance.zoning.maxSlope) return 'Çok dik';
  return undefined;
}

/**
 * Residential zoning over a dragged rectangle. Zoning is free and only marks land: houses
 * rise on it by themselves while there is demand and a road within reach.
 */
export function proposeZone(city: CityState, ax: number, az: number, bx: number, bz: number): ZoneProposal {
  const [x0, z0, x1, z1] = rect(ax, az, bx, bz);
  const tiles: ZoneProposal['tiles'] = [];
  let added = 0;
  let far = 0;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const reason = zoneReason(city, x, z);
      if (reason !== undefined) {
        tiles.push({ x, z, status: 'blocked', reason });
      } else if (city.zone[city.grid.index(x, z)] === 1) {
        tiles.push({ x, z, status: 'existing' });
      } else if (roadWithin(city, x, z, city.balance.zoning.roadReach)) {
        tiles.push({ x, z, status: 'new' });
        added++;
      } else {
        tiles.push({ x, z, status: 'new', far: true });
        added++;
        far++;
      }
    }
  }
  return { tiles, added, far };
}

/** Whether a road lies within `reach` steps; on an open grid that is the Manhattan distance. */
function roadWithin(city: CityState, x: number, z: number, reach: number): boolean {
  const { grid } = city;
  for (let dz = -reach; dz <= reach; dz++) {
    const span = reach - Math.abs(dz);
    for (let dx = -span; dx <= span; dx++) {
      if (grid.inBounds(x + dx, z + dz) && city.road[grid.index(x + dx, z + dz)] === 1) return true;
    }
  }
  return false;
}

export function applyZone(city: CityState, p: ZoneProposal): number {
  let added = 0;
  for (const t of p.tiles) {
    if (t.status !== 'new' || zoneReason(city, t.x, t.z) !== undefined) continue;
    const i = city.grid.index(t.x, t.z);
    if (city.zone[i] === 0) {
      city.zone[i] = 1;
      added++;
    }
  }
  if (added > 0) city.revision.zones++;
  return added;
}

export interface Clearance {
  roads: number;
  houses: number;
  zones: number;
  fields: number;
  buildings: number;
}

/** What clearing a rectangle would remove, without removing it. */
export function surveyClear(city: CityState, ax: number, az: number, bx: number, bz: number): Clearance {
  return clearImpl(city, ax, az, bx, bz, false);
}

/**
 * Clears a rectangle: roads (except gate passages), houses, zoning, and every field,
 * workshop and bazaar that reaches into it. Landmarks and walls stay.
 */
export function clearArea(city: CityState, ax: number, az: number, bx: number, bz: number): Clearance {
  return clearImpl(city, ax, az, bx, bz, true);
}

function clearImpl(
  city: CityState,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  apply: boolean,
): Clearance {
  const { grid } = city;
  const [x0, z0, x1, z1] = rect(ax, az, bx, bz);
  const out: Clearance = { roads: 0, houses: 0, zones: 0, fields: 0, buildings: 0 };
  const fields = new Set<number>();
  const buildings = new Set<number>();
  for (let z = Math.max(0, z0); z <= Math.min(grid.size - 1, z1); z++) {
    for (let x = Math.max(0, x0); x <= Math.min(grid.size - 1, x1); x++) {
      const i = grid.index(x, z);
      if (city.road[i] === 1 && city.roadLocked[i] === 0) {
        out.roads++;
        if (apply) city.road[i] = 0;
      }
      if (city.house[i] > 0) {
        out.houses++;
        if (apply) city.house[i] = 0;
      }
      if (city.zone[i] === 1) {
        out.zones++;
        if (apply) city.zone[i] = 0;
      }
      if (city.field[i] >= 0) fields.add(city.field[i]);
      if (city.building[i] >= 0) buildings.add(city.building[i]);
    }
  }
  out.fields = fields.size;
  out.buildings = buildings.size;
  if (apply) {
    for (const id of fields) removeField(city, id);
    for (const id of buildings) removeBuilding(city, id);
    if (out.roads > 0) city.revision.roads++;
    if (out.houses > 0) city.revision.houses++;
    if (out.zones > 0) city.revision.zones++;
  }
  return out;
}
