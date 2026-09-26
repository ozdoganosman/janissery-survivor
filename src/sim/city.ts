import { smoothPath, supercoverLine, type Vec2 } from '../core/geom';
import { valueNoise } from '../core/noise';
import { createRng, type Rng } from '../core/rng';
import type { Balance, TaxRate } from './balance';
import { placeStartBuildings, type Building } from './buildings';
import { createCalendar, type Calendar } from './calendar';
import { validateCityDef, type CityDef, type LandmarkDef, type LandmarkKind } from './city-def';
import { seedCountryside, type Field } from './countryside';
import { orderState, updateStats, type OrderState } from './economy';
import type { Grid } from './grid';
import { DIRS4 } from './grid';
import { layLots, syncHouses } from './housing';
import { generateTerrain, type Terrain } from './terrain';

import { WALL, WALL_GATE, WALL_NONE } from './constants';

export { WALL, WALL_GATE, WALL_NONE };

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  /** World position of the footprint centre. */
  x: number;
  z: number;
  /** Footprint in tiles. */
  w: number;
  d: number;
  rot: number;
  tiles: number[];
}

export interface Gate {
  name: string;
  /** Radians, from +x towards +z. */
  angle: number;
  /** Tiles of the passage through the wall. */
  tiles: number[];
}

/**
 * The whole mutable state of one city. Plain data in typed arrays so it can be saved,
 * copied into tests and later run headless on the campaign map.
 *
 * The streets, walls and landmarks are the city as it was handed over; the player adds
 * buildings. Houses follow the population on their own.
 */
export interface CityState {
  def: CityDef;
  grid: Grid;
  terrain: Terrain;
  /** WALL_NONE, WALL or WALL_GATE per tile. */
  wall: Uint8Array;
  /** 1 where a street runs. A street on a water tile is a bridge. */
  road: Uint8Array;
  /** Index into `landmarks`, or -1. */
  structure: Int16Array;
  /** 0 = empty, otherwise 1 or 2 storeys, 3 for a konak. */
  house: Uint8Array;
  /** Lots in the order houses take them as the city grows. */
  lots: Int32Array;
  /** Id of the building covering the tile, or -1. */
  building: Int32Array;
  buildings: Map<number, Building>;
  nextBuildingId: number;
  /** Id of the field covering the tile, or -1. The fields are scenery. */
  field: Int32Array;
  fields: Map<number, Field>;
  landmarks: Landmark[];
  gates: Gate[];
  balance: Balance;
  /** Akçe in the treasury. */
  treasury: number;
  /** The city's own product in store: stone, wood or iron. */
  product: number;
  /** People, fractional so that slow growth still adds up. */
  population: number;
  policy: { tax: TaxRate };
  calendar: Calendar;
  /** Figures recomputed every day; the HUD reads them, nothing else writes them. */
  stats: CityStats;
  /** Messages for the player, oldest first; the UI drains this queue. */
  notices: Notice[];
  /** The rank and the mood last told to the player, so each change is told once. */
  announced: { level: number; order: OrderState };
  /** Bumped whenever a layer changes, so views know to rebuild. */
  revision: { roads: number; houses: number; buildings: number; fields: number };
}

export interface CityStats {
  /** Public order, 0..100, and where it comes from. */
  order: number;
  orderParts: { base: number; tax: number; buildings: number; crowding: number };
  /** Index into `balance.levels`. */
  level: number;
  /** What a month brings at today's figures. */
  income: { tax: number; buildings: number; total: number };
  product: number;
  growth: number;
  /** What the last month really brought. */
  last: { income: number; product: number; growth: number };
  /** Building works under way. */
  works: number;
}

export type NoticeKind = 'info' | 'good' | 'bad';
export interface Notice {
  text: string;
  kind: NoticeKind;
  day: number;
}

const DEG = Math.PI / 180;
const polar = (cx: number, cz: number, angle: number, r: number): Vec2 => [
  cx + Math.cos(angle) * r,
  cz + Math.sin(angle) * r,
];

export function createCity(rawDef: CityDef, balance: Balance): CityState {
  const def = validateCityDef(rawDef);
  const terrain = generateTerrain(def);
  const grid = terrain.grid;
  const city: CityState = {
    def,
    grid,
    terrain,
    wall: new Uint8Array(grid.count),
    road: new Uint8Array(grid.count),
    structure: new Int16Array(grid.count).fill(-1),
    house: new Uint8Array(grid.count),
    lots: new Int32Array(0),
    building: new Int32Array(grid.count).fill(-1),
    buildings: new Map(),
    nextBuildingId: 1,
    field: new Int32Array(grid.count).fill(-1),
    fields: new Map(),
    landmarks: [],
    gates: [],
    balance,
    treasury: balance.start.treasury,
    product: balance.start.product,
    population: def.housing.startPopulation,
    policy: { tax: balance.tax.start },
    calendar: createCalendar(def.start),
    stats: {
      order: 0,
      orderParts: { base: 0, tax: 0, buildings: 0, crowding: 0 },
      level: 0,
      income: { tax: 0, buildings: 0, total: 0 },
      product: 0,
      growth: 0,
      last: { income: 0, product: 0, growth: 0 },
      works: 0,
    },
    notices: [],
    announced: { level: 0, order: 'sakin' },
    revision: { roads: 0, houses: 0, buildings: 0, fields: 0 },
  };
  const rng = createRng(def.seed);
  // Gate passages and the streets are generated once; nothing in play removes them.
  const locked = new Uint8Array(grid.count);
  buildWalls(city, locked);
  placeLandmarks(city);
  const reserved = landmarkReserve(city, 1);
  layStreets(city, rng, reserved);
  connectLandmarks(city);
  layOutsideRoads(city);
  thinRoads(city, locked);
  pruneRoadFragments(city, locked, 4);
  city.revision.roads++;
  placeStartBuildings(city);
  layLots(city);
  seedCountryside(city, rng);
  updateStats(city);
  syncHouses(city);
  city.announced = { level: city.stats.level, order: orderState(city) };
  return city;
}

/** Tiles covered by a path, as one 4-connected chain. */
export function rasterizePath(grid: Grid, path: readonly Vec2[], step = 0.3): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let prev: [number, number] | null = null;
  const pushTile = (x: number, z: number): void => {
    if (prev === null) {
      out.push([x, z]);
      prev = [x, z];
      return;
    }
    if (prev[0] === x && prev[1] === z) return;
    const run = supercoverLine(prev[0], prev[1], x, z);
    for (let i = 1; i < run.length; i++) out.push(run[i]);
    prev = [x, z];
  };
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      pushTile(grid.tileOf(ax + (bx - ax) * t), grid.tileOf(az + (bz - az) * t));
    }
  }
  const last = path[path.length - 1];
  if (last !== undefined) pushTile(grid.tileOf(last[0]), grid.tileOf(last[1]));
  return out;
}

function distFromTepe(city: CityState, x: number, z: number): number {
  const { tepe } = city.def;
  return Math.hypot(city.grid.centre(x) - tepe.x, city.grid.centre(z) - tepe.z);
}

function buildWalls(city: CityState, locked: Uint8Array): void {
  const { grid, def } = city;
  const R = def.walls.radius;
  for (let z = 0; z < grid.size; z++) {
    for (let x = 0; x < grid.size; x++) {
      // A ring this thick is 8-connected all the way round, which is exactly what stops a
      // 4-connected road from slipping between two diagonal wall tiles.
      if (Math.abs(distFromTepe(city, x, z) - R) < 0.8) city.wall[grid.index(x, z)] = WALL;
    }
  }
  for (const g of def.gates) {
    const a = g.angle * DEG;
    const inner = polar(def.tepe.x, def.tepe.z, a, R - 2.2);
    const outer = polar(def.tepe.x, def.tepe.z, a, R + 2.2);
    const tiles: number[] = [];
    for (const [x, z] of rasterizePath(grid, [inner, outer])) {
      const i = grid.index(x, z);
      if (city.wall[i] === WALL) {
        city.wall[i] = WALL_GATE;
        tiles.push(i);
      }
      city.road[i] = 1;
      locked[i] = 1;
    }
    city.gates.push({ name: g.name, angle: a, tiles });
  }
}

function landmarkCentre(city: CityState, l: LandmarkDef): Vec2 {
  const { tepe } = city.def;
  if (l.x !== undefined && l.z !== undefined) return [l.x, l.z];
  return polar(tepe.x, tepe.z, (l.angle ?? 0) * DEG, l.radius ?? 0);
}

function placeLandmarks(city: CityState): void {
  const { grid } = city;
  city.def.landmarks.forEach((l, index) => {
    const [cx, cz] = landmarkCentre(city, l);
    const x0 = grid.tileOf(cx - l.w / 2 + 0.5);
    const z0 = grid.tileOf(cz - l.d / 2 + 0.5);
    const tiles: number[] = [];
    for (let z = z0; z < z0 + l.d; z++) {
      for (let x = x0; x < x0 + l.w; x++) {
        if (!grid.inBounds(x, z)) continue;
        const i = grid.index(x, z);
        city.structure[i] = index;
        tiles.push(i);
      }
    }
    // Snap the footprint centre to the tiles actually claimed, so drawing and data agree.
    city.landmarks.push({
      kind: l.kind,
      name: l.name,
      x: grid.centre(x0) + (l.w - 1) / 2,
      z: grid.centre(z0) + (l.d - 1) / 2,
      w: l.w,
      d: l.d,
      rot: l.rot ?? 0,
      tiles,
    });
  });
}

/** Landmark tiles grown by `margin`: streets route around them instead of brushing their walls. */
function landmarkReserve(city: CityState, margin: number): Uint8Array {
  const { grid } = city;
  const out = new Uint8Array(grid.count);
  for (const l of city.landmarks) {
    for (const i of l.tiles) {
      const x = i % grid.size;
      const z = Math.floor(i / grid.size);
      for (let dz = -margin; dz <= margin; dz++) {
        for (let dx = -margin; dx <= margin; dx++) {
          if (grid.inBounds(x + dx, z + dz)) out[grid.index(x + dx, z + dz)] = 1;
        }
      }
    }
  }
  return out;
}

function paintRoad(
  city: CityState,
  tiles: ReadonlyArray<readonly [number, number]>,
  reserved: Uint8Array,
): void {
  for (const [x, z] of tiles) {
    if (!city.grid.inBounds(x, z)) continue;
    const i = city.grid.index(x, z);
    if (city.wall[i] === WALL || reserved[i] === 1 || city.structure[i] >= 0) continue;
    city.road[i] = 1;
  }
}

function ringPath(cx: number, cz: number, r: number, wobble: number, salt: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let a = 0; a <= Math.PI * 2 + 1e-6; a += 0.05) {
    const rr = r + (valueNoise(a * 2.2 + salt, salt) - 0.5) * 2 * wobble;
    pts.push(polar(cx, cz, a, rr));
  }
  return pts;
}

function layStreets(city: CityState, rng: Rng, reserved: Uint8Array): void {
  const { def, grid } = city;
  const { tepe } = def;
  const R = def.walls.radius;
  const { tepeRing, innerRing } = def.streets;

  for (const g of city.gates) {
    const a = g.angle;
    const path = smoothPath(
      [
        polar(tepe.x, tepe.z, a, R - 1.5),
        polar(tepe.x, tepe.z, a + rng.range(-0.06, 0.06), (R + innerRing) / 2),
        polar(tepe.x, tepe.z, a + rng.range(-0.08, 0.08), innerRing),
        polar(tepe.x, tepe.z, a + rng.range(-0.05, 0.05), tepeRing),
      ],
      0.5,
    );
    paintRoad(city, rasterizePath(grid, path), reserved);
  }
  paintRoad(city, rasterizePath(grid, ringPath(tepe.x, tepe.z, tepeRing, 0.25, def.seed % 97)), reserved);
  paintRoad(city, rasterizePath(grid, ringPath(tepe.x, tepe.z, innerRing, 0.9, def.seed % 89)), reserved);

  // Dead-end alleys (çıkmaz sokak) off the inner ring, the grain of an old Anatolian town.
  for (let k = 0; k < def.streets.alleys; k++) {
    const a = rng.range(0, Math.PI * 2);
    const outward = rng.chance(0.55);
    const r1 = outward ? rng.range(R - 4, R - 2) : rng.range(tepeRing + 1.5, tepeRing + 3);
    const path = smoothPath(
      [
        polar(tepe.x, tepe.z, a, innerRing),
        polar(tepe.x, tepe.z, a + rng.range(-0.12, 0.12), (innerRing + r1) / 2),
        polar(tepe.x, tepe.z, a + rng.range(-0.18, 0.18), r1),
      ],
      0.5,
    );
    const tiles = rasterizePath(grid, path);
    if (tiles.some(([x, z]) => reserved[grid.index(x, z)] === 1)) continue;
    paintRoad(city, tiles, reserved);
  }
}

/**
 * A footpath from each landmark to the nearest street, so nothing stands cut off; on the
 * tepe these become the lanes that climb to the mosque.
 */
function connectLandmarks(city: CityState): void {
  const { grid } = city;
  city.landmarks.forEach((l, index) => {
    const prev = new Int32Array(grid.count).fill(-2);
    const queue: number[] = [];
    for (const i of l.tiles) {
      prev[i] = -1;
      queue.push(i);
    }
    let found = -1;
    for (let head = 0; head < queue.length && found < 0; head++) {
      const i = queue[head];
      const x = i % grid.size;
      const z = Math.floor(i / grid.size);
      for (const [dx, dz] of DIRS4) {
        if (!grid.inBounds(x + dx, z + dz)) continue;
        const j = grid.index(x + dx, z + dz);
        if (prev[j] !== -2) continue;
        if (city.wall[j] !== WALL_NONE || (city.structure[j] >= 0 && city.structure[j] !== index)) continue;
        prev[j] = i;
        if (city.road[j] === 1) {
          found = j;
          break;
        }
        queue.push(j);
      }
    }
    // Walk back from the street to the landmark, paving everything outside the footprint.
    for (let i = found >= 0 ? prev[found] : -1; i >= 0 && city.structure[i] !== index; i = prev[i]) {
      city.road[i] = 1;
    }
  });
}

function layOutsideRoads(city: CityState): void {
  const { def, grid } = city;
  def.gates.forEach((g) => {
    const a = g.angle * DEG;
    const start = polar(def.tepe.x, def.tepe.z, a, def.walls.radius + 2);
    const path = smoothPath([start, ...g.road], 0.5);
    const none = new Uint8Array(grid.count);
    paintRoad(city, rasterizePath(grid, path), none);
  });
}

/**
 * Where rasterised streets overlap they leave blocks two tiles thick. Old Konya's streets
 * were one lane wide, so each thick spot loses a tile, but only a tile whose removal keeps
 * every neighbouring piece of road connected.
 */
function thinRoads(city: CityState, locked: Uint8Array): void {
  const { grid, road } = city;
  const isRoad = (x: number, z: number): boolean => grid.inBounds(x, z) && road[grid.index(x, z)] === 1;
  const inThickBlock = (x: number, z: number): boolean =>
    [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ].some(
      ([ox, oz]) =>
        isRoad(x + ox, z + oz) &&
        isRoad(x + ox + 1, z + oz) &&
        isRoad(x + ox, z + oz + 1) &&
        isRoad(x + ox + 1, z + oz + 1),
    );
  /** Removing (x, z) leaves its road neighbours connected through the surrounding ring. */
  const isSimple = (x: number, z: number): boolean => {
    const ring: Array<[number, number]> = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if ((dx !== 0 || dz !== 0) && isRoad(x + dx, z + dz)) ring.push([dx, dz]);
    const needed = ring.filter(([dx, dz]) => Math.abs(dx) + Math.abs(dz) === 1);
    if (needed.length === 0) return false;
    const reached = new Set<string>([`${needed[0][0]},${needed[0][1]}`]);
    const stack = [needed[0]];
    while (stack.length > 0) {
      const [cx, cz] = stack.pop() as [number, number];
      for (const [dx, dz] of DIRS4) {
        const nx = cx + dx;
        const nz = cz + dz;
        const key = `${nx},${nz}`;
        if (reached.has(key) || !ring.some(([rx, rz]) => rx === nx && rz === nz)) continue;
        reached.add(key);
        stack.push([nx, nz]);
      }
    }
    return needed.every(([dx, dz]) => reached.has(`${dx},${dz}`));
  };
  for (let pass = 0; pass < 6; pass++) {
    let removed = 0;
    for (let z = 0; z < grid.size; z++) {
      for (let x = 0; x < grid.size; x++) {
        const i = grid.index(x, z);
        if (road[i] !== 1 || locked[i] === 1) continue;
        if (!inThickBlock(x, z) || !isSimple(x, z)) continue;
        road[i] = 0;
        removed++;
      }
    }
    if (removed === 0) break;
  }
}

/**
 * Drops stray road pieces smaller than `minTiles`. Streets clipped around landmarks can
 * leave a tile or two behind that lead nowhere; the gate passages are never touched.
 */
function pruneRoadFragments(city: CityState, locked: Uint8Array, minTiles: number): void {
  const { grid } = city;
  const seen = new Uint8Array(grid.count);
  for (let start = 0; start < grid.count; start++) {
    if (city.road[start] !== 1 || seen[start] === 1) continue;
    const component: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      component.push(i);
      const x = i % grid.size;
      const z = Math.floor(i / grid.size);
      for (const [dx, dz] of DIRS4) {
        if (!grid.inBounds(x + dx, z + dz)) continue;
        const j = grid.index(x + dx, z + dz);
        if (city.road[j] === 1 && seen[j] === 0) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (component.length >= minTiles || component.some((i) => locked[i] === 1)) continue;
    for (const i of component) city.road[i] = 0;
  }
}
