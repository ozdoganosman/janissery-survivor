import type { BuildingKind, Trade } from './balance';
import type { CityState } from './city';
import { WALL_NONE } from './constants';

/**
 * State workshops and bazaars: rectangles of tiles the player places whole, each with a
 * front that faces the road it stands on.
 */

/**
 * - `calisiyor` working;
 * - `yolsuz`    no road reaches it, so nobody can work there;
 * - `iscisiz`   no free hands in the city;
 * - `girdisiz`  waiting for its input;
 * - `dolu`      the depot is full of what it makes;
 * - `bos`       an empty shop.
 */
export type BuildingStatus = 'calisiyor' | 'yolsuz' | 'iscisiz' | 'girdisiz' | 'dolu' | 'bos';

export interface Shop {
  trade: Trade | null;
  status: BuildingStatus;
  /** Output made this month, and last month. */
  made: number;
  madeLastMonth: number;
  /** Days this month the shop stood idle for want of its input. */
  shortDays: number;
  /** Months in a row it went short. */
  starvedMonths: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: number[];
  /** Side facing the road: 0 south (+z), 1 east (+x), 2 north (-z), 3 west (-x). */
  facing: number;
  roadAccess: boolean;
  status: BuildingStatus;
  made: number;
  madeLastMonth: number;
  /** Bazaar shops; empty for a workshop. */
  shops: Shop[];
}

export interface BuildingProposal {
  kind: BuildingKind;
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: Array<{ x: number; z: number; ok: boolean; reason?: string }>;
  facing: number;
  cost: number;
  problem?: string;
}

/** Unit steps out of each side, in `facing` order. */
export const FACING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

function tileReason(city: CityState, x: number, z: number, maxSlope: number): string | undefined {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return 'Harita dışı';
  const i = grid.index(x, z);
  if (terrain.water[i] === 1) return 'Su';
  if (city.wall[i] !== WALL_NONE) return 'Sur';
  if (city.structure[i] >= 0 || city.building[i] >= 0) return 'Yapı';
  if (city.road[i] === 1) return 'Yol';
  if (city.house[i] > 0) return 'Ev';
  if (city.field[i] >= 0) return city.fields.get(city.field[i])?.kind === 'mera' ? 'Mera' : 'Tarla';
  if (terrain.slope[i] > maxSlope) return 'Çok dik';
  return undefined;
}

/** Road tiles touching each side of a rectangle, in `facing` order. */
function roadContacts(city: CityState, x0: number, z0: number, w: number, d: number): number[] {
  const { grid } = city;
  const road = (x: number, z: number): number =>
    grid.inBounds(x, z) && city.road[grid.index(x, z)] === 1 ? 1 : 0;
  const out = [0, 0, 0, 0];
  for (let x = x0; x < x0 + w; x++) {
    out[0] += road(x, z0 + d);
    out[2] += road(x, z0 - 1);
  }
  for (let z = z0; z < z0 + d; z++) {
    out[1] += road(x0 + w, z);
    out[3] += road(x0 - 1, z);
  }
  return out;
}

function waterWithin(city: CityState, x0: number, z0: number, w: number, d: number, reach: number): boolean {
  const { grid } = city;
  for (let z = z0 - reach; z < z0 + d + reach; z++) {
    for (let x = x0 - reach; x < x0 + w + reach; x++) {
      if (grid.inBounds(x, z) && city.terrain.water[grid.index(x, z)] === 1) return true;
    }
  }
  return false;
}

/** The proposal for one exact rectangle. */
function proposeAt(
  city: CityState,
  kind: BuildingKind,
  x0: number,
  z0: number,
  w: number,
  d: number,
): BuildingProposal {
  const def = city.balance.works[kind];
  const tiles: BuildingProposal['tiles'] = [];
  let problem: string | undefined;
  let ore = 0;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      const reason = tileReason(city, x, z, def.maxSlope);
      tiles.push(reason === undefined ? { x, z, ok: true } : { x, z, ok: false, reason });
      problem ??= reason;
      if (reason === undefined && city.terrain.ore[city.grid.index(x, z)] > 0) ore++;
    }
  }
  const contacts = roadContacts(city, x0, z0, w, d);
  // Face the side with the most road along it; on a tie, the longer side.
  let facing = 0;
  for (let k = 1; k < 4; k++) {
    const len = (s: number): number => (s % 2 === 0 ? w : d);
    if (contacts[k] > contacts[facing] || (contacts[k] === contacts[facing] && len(k) > len(facing)))
      facing = k;
  }
  if (
    problem === undefined &&
    def.site === 'water' &&
    !waterWithin(city, x0, z0, w, d, def.waterReach ?? 1)
  ) {
    problem = (def.waterReach ?? 1) <= 1 ? 'Suya bitişik olmalı' : 'Suya yakın olmalı';
  }
  if (problem === undefined && def.site === 'ore' && ore * 2 < w * d)
    problem = 'Demir damarı üstüne kurulmalı';
  if (problem === undefined && contacts[facing] === 0) problem = 'Yola bitişik olmalı';
  if (problem === undefined && def.cost > city.treasury) problem = 'Hazine yetersiz';
  const p: BuildingProposal = { kind, x0, z0, w, d, tiles, facing, cost: def.cost };
  if (problem !== undefined) p.problem = problem;
  return p;
}

/**
 * A building of `kind` centred on a tile. Both turns of the footprint are tried; the one
 * that fits wins, preferring the turn that puts the long side on the road.
 */
export function proposeBuilding(
  city: CityState,
  kind: BuildingKind,
  cx: number,
  cz: number,
): BuildingProposal {
  const [a, b] = city.balance.works[kind].size;
  const shapes: Array<[number, number]> =
    a === b
      ? [[a, b]]
      : [
          [a, b],
          [b, a],
        ];
  const usable = (p: BuildingProposal): boolean => p.problem === undefined || p.problem === 'Hazine yetersiz';
  let best: BuildingProposal | null = null;
  for (const [w, d] of shapes) {
    const p = proposeAt(city, kind, cx - Math.floor((w - 1) / 2), cz - Math.floor((d - 1) / 2), w, d);
    if (best === null) {
      best = p;
      continue;
    }
    const frontage = (q: BuildingProposal): number => (q.facing % 2 === 0 ? q.w : q.d);
    if ((usable(p) && !usable(best)) || (usable(p) === usable(best) && frontage(p) > frontage(best)))
      best = p;
  }
  return best as BuildingProposal;
}

/**
 * Builds a proposal, charging the treasury unless `free`. Returns null, changing nothing,
 * if the ground is no longer clear.
 */
export function buildBuilding(
  city: CityState,
  p: BuildingProposal,
  opts: { free?: boolean; name?: string } = {},
): Building | null {
  const fresh = proposeAt(city, p.kind, p.x0, p.z0, p.w, p.d);
  if (fresh.problem !== undefined && !(opts.free === true && fresh.problem === 'Hazine yetersiz'))
    return null;
  const def = city.balance.works[p.kind];
  const id = city.nextBuildingId++;
  const tiles = fresh.tiles.map((t) => city.grid.index(t.x, t.z));
  const b: Building = {
    id,
    kind: p.kind,
    name: opts.name ?? def.name,
    x0: fresh.x0,
    z0: fresh.z0,
    w: fresh.w,
    d: fresh.d,
    tiles,
    facing: fresh.facing,
    roadAccess: true,
    status: p.kind === 'arasta' ? 'calisiyor' : 'iscisiz',
    made: 0,
    madeLastMonth: 0,
    shops: Array.from({ length: def.shops ?? 0 }, () => emptyShop()),
  };
  let unzoned = false;
  for (const i of tiles) {
    city.building[i] = id;
    if (city.zone[i] === 1) {
      city.zone[i] = 0;
      unzoned = true;
    }
  }
  city.buildings.set(id, b);
  if (opts.free !== true) city.treasury -= fresh.cost;
  city.revision.buildings++;
  if (unzoned) city.revision.zones++;
  return b;
}

export function emptyShop(): Shop {
  return { trade: null, status: 'bos', made: 0, madeLastMonth: 0, shortDays: 0, starvedMonths: 0 };
}

export function removeBuilding(city: CityState, id: number): boolean {
  const b = city.buildings.get(id);
  if (b === undefined) return false;
  for (const i of b.tiles) city.building[i] = -1;
  city.buildings.delete(id);
  city.revision.buildings++;
  return true;
}

export function buildingTouchesRoad(city: CityState, b: Building): boolean {
  return roadContacts(city, b.x0, b.z0, b.w, b.d).some((n) => n > 0);
}

const smokeCache = new WeakMap<CityState, { rev: number; map: Uint8Array }>();

/** 1 on every tile within reach of a smoking chimney. */
export function smokeMap(city: CityState): Uint8Array {
  const cached = smokeCache.get(city);
  if (cached !== undefined && cached.rev === city.revision.buildings) return cached.map;
  const { grid } = city;
  const map = new Uint8Array(grid.count);
  for (const b of city.buildings.values()) {
    const r = city.balance.works[b.kind].smoke ?? 0;
    if (r <= 0) continue;
    const cx = b.x0 + (b.w - 1) / 2;
    const cz = b.z0 + (b.d - 1) / 2;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (grid.inBounds(x, z) && Math.hypot(x - cx, z - cz) <= r) map[grid.index(x, z)] = 1;
      }
    }
  }
  smokeCache.set(city, { rev: city.revision.buildings, map });
  return map;
}

/**
 * The workshops and bazaars the city starts with. Each goes at the nearest spot to its
 * authored position where the ordinary building rules allow it.
 */
export function placeStartBuildings(city: CityState): void {
  const { grid } = city;
  for (const w of city.def.works) {
    const cx = grid.tileOf(w.near[0]);
    const cz = grid.tileOf(w.near[1]);
    let built: Building | null = null;
    for (let r = 0; r <= 12 && built === null; r++) {
      for (let dz = -r; dz <= r && built === null; dz++) {
        for (let dx = -r; dx <= r && built === null; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const p = proposeBuilding(city, w.kind, cx + dx, cz + dz);
          if (p.problem === undefined || p.problem === 'Hazine yetersiz') {
            built = buildBuilding(city, p, { free: true, name: w.name });
          }
        }
      }
    }
    if (built === null) throw new Error(`No room for "${w.name}" near ${w.near.join(', ')}`);
    (w.shops ?? []).forEach((trade, k) => {
      const shop = built?.shops[k];
      if (shop !== undefined) {
        shop.trade = trade;
        shop.status = 'calisiyor';
      }
    });
  }
}
