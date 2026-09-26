import type { Vec2 } from '../core/geom';
import type { CityState } from './city';
import type { Grid } from './grid';
import type { Terrain } from './terrain';

/**
 * The shape of a ring of walls. A new ring is planned as a circle round the tepe, but it
 * keeps to the town's side of the stream: where the water comes inside the circle the wall
 * follows the near bank instead, so the stream becomes its moat. Where the stream runs so
 * close to the older wall that there is no room for another, no wall is raised at all; the
 * new wall ends there and turns in to meet the old one.
 */

/** Angular steps round the circle at which a ring's shape is kept. */
export const RING_STEPS = 720;
/** Nearest the middle of a wall may come to the stream's centre line, in tiles. */
const STREAM_CLEARANCE = 2.8;
/** Least room between two rings for the outer one to be worth building. */
const RING_GAP = 4.5;
/** A stretch of wall shorter than this many steps is not built. */
const MIN_RUN = 8;

/** One line of wall: a stretch along the ring, or a short spur joining it to the ring inside. */
export interface WallRun {
  points: Vec2[];
  closed: boolean;
  spur: boolean;
}

export interface WallRing {
  name: string;
  /** The radius the ring was planned at, where nothing turned it aside. */
  radius: number;
  height: number;
  /**
   * How far the ring encloses the town, from the tepe, at each of RING_STEPS angles: out to
   * its wall where it has one, back to the ring inside it where the stream left no room.
   */
  bound: Float32Array;
  /** Whether wall stands at each angle. */
  walled: Uint8Array;
  runs: WallRun[];
}

const stepAngle = (k: number): number => (k / RING_STEPS) * Math.PI * 2;

/** Index of the angular step nearest an angle. */
export function stepOf(angle: number): number {
  const turns = angle / (Math.PI * 2);
  const k = Math.round((turns - Math.floor(turns)) * RING_STEPS);
  return k % RING_STEPS;
}

/** A plain circle of walls, as the old town has. */
export function circleRing(name: string, cx: number, cz: number, radius: number, height: number): WallRing {
  const points: Vec2[] = [];
  for (let k = 0; k < RING_STEPS; k++) {
    const a = stepAngle(k);
    points.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
  }
  return {
    name,
    radius,
    height,
    bound: new Float32Array(RING_STEPS).fill(radius),
    walled: new Uint8Array(RING_STEPS).fill(1),
    runs: [{ points, closed: true, spur: false }],
  };
}

/** How far a ring encloses the town, from the tepe in the direction of `angle`. */
export function boundAt(ring: WallRing, angle: number): number {
  const t = ((angle / (Math.PI * 2)) % 1) + 1;
  const f = (t % 1) * RING_STEPS;
  const k = Math.floor(f);
  const a = ring.bound[k % RING_STEPS];
  const b = ring.bound[(k + 1) % RING_STEPS];
  return a + (b - a) * (f - k);
}

/** How far the walled town reaches, from the tepe towards the point (x, z). */
export function wallReach(city: CityState, x: number, z: number): number {
  const { tepe } = city.def;
  return boundAt(city.rings[city.rings.length - 1], Math.atan2(z - tepe.z, x - tepe.x));
}

/** Whether a point lies within the outermost walls, give or take `margin` tiles. */
export function insideWalls(city: CityState, x: number, z: number, margin = 0): boolean {
  const { tepe } = city.def;
  return Math.hypot(x - tepe.x, z - tepe.z) < wallReach(city, x, z) + margin;
}

/** Whether a point lies within one ring. */
export function insideRing(city: CityState, ring: WallRing, x: number, z: number): boolean {
  const { tepe } = city.def;
  return Math.hypot(x - tepe.x, z - tepe.z) < boundAt(ring, Math.atan2(z - tepe.z, x - tepe.x));
}

/** How many rings of walls stand round a point. */
export function wallDepth(city: CityState, x: number, z: number): number {
  let n = 0;
  for (const ring of city.rings) if (insideRing(city, ring, x, z)) n++;
  return n;
}

/** A per-tile field sampled between tile centres. */
function sampleField(grid: Grid, field: Float32Array, x: number, z: number): number {
  const fx = Math.min(grid.size - 1.001, Math.max(0, x + grid.half - 0.5));
  const fz = Math.min(grid.size - 1.001, Math.max(0, z + grid.half - 0.5));
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const at = (dx: number, dz: number): number => field[grid.index(x0 + dx, z0 + dz)];
  return (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - tz) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * tz;
}

/** The first distance along a ray from the tepe at which the stream is too near for a wall. */
function streamStop(
  terrain: Terrain,
  cx: number,
  cz: number,
  angle: number,
  from: number,
  to: number,
): number {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const clear = (d: number): number =>
    sampleField(terrain.grid, terrain.waterDistance, cx + ca * d, cz + sa * d) - STREAM_CLEARANCE;
  const step = 0.25;
  let prev = clear(from);
  if (prev < 0) return from;
  for (let d = from + step; d <= to + 1e-6; d += step) {
    const now = clear(d);
    if (now < 0) return d - step * (now / (now - prev));
    prev = now;
  }
  return to;
}

const plans = new WeakMap<Terrain, Map<string, WallRing>>();

/**
 * Plans the city's expansion `stage` round the ring standing inside it: the circle it was
 * drawn as, pulled back to the near bank wherever the stream comes inside it.
 */
export function planRing(city: CityState, stage: number): WallRing {
  const def = city.def.expansions[stage];
  const inner = city.rings[stage];
  const { tepe } = city.def;
  const key = `${stage}:${def.radius}:${inner.radius}`;
  let cache = plans.get(city.terrain);
  if (cache === undefined) {
    cache = new Map();
    plans.set(city.terrain, cache);
  }
  const known = cache.get(key);
  if (known !== undefined) return known;

  const R = def.radius;
  const reach = new Float32Array(RING_STEPS);
  const walled = new Uint8Array(RING_STEPS);
  for (let k = 0; k < RING_STEPS; k++) {
    const within = inner.bound[k];
    reach[k] = Math.max(within, streamStop(city.terrain, tepe.x, tepe.z, stepAngle(k), within + 0.5, R));
    walled[k] = reach[k] >= within + RING_GAP ? 1 : 0;
  }
  // A few steps of wall between two gaps are not worth raising.
  const runs = walledRuns(walled);
  for (const [k0, len] of runs) {
    if (len >= MIN_RUN || len === RING_STEPS) continue;
    for (let j = 0; j < len; j++) walled[(k0 + j) % RING_STEPS] = 0;
  }
  const at = (k: number, r: number): Vec2 => [
    tepe.x + Math.cos(stepAngle(k)) * r,
    tepe.z + Math.sin(stepAngle(k)) * r,
  ];
  const lines: WallRun[] = [];
  for (const [k0, len] of walledRuns(walled)) {
    const points: Vec2[] = [];
    for (let j = 0; j < len; j++) {
      const k = (k0 + j) % RING_STEPS;
      points.push(at(k, reach[k]));
    }
    if (len === RING_STEPS) {
      lines.push({ points, closed: true, spur: false });
      continue;
    }
    lines.push({ points, closed: false, spur: false });
    // Each broken end turns in to meet the ring inside, closing the way along the bank.
    for (const k of [k0, (k0 + len - 1) % RING_STEPS]) {
      lines.push({ points: [at(k, inner.bound[k]), at(k, reach[k])], closed: false, spur: true });
    }
  }
  const bound = new Float32Array(RING_STEPS);
  for (let k = 0; k < RING_STEPS; k++) bound[k] = walled[k] === 1 ? reach[k] : inner.bound[k];
  const ring: WallRing = {
    name: def.name,
    radius: R,
    height: city.def.walls.height * 1.1,
    bound,
    walled,
    runs: lines,
  };
  cache.set(key, ring);
  return ring;
}

/** Stretches of consecutive walled steps round the circle, as [first step, length]. */
function walledRuns(walled: Uint8Array): Array<[number, number]> {
  const n = walled.length;
  // Count from a gap, so that no stretch is split across step zero.
  const start = walled.indexOf(0);
  if (start < 0) return [[0, n]];
  const out: Array<[number, number]> = [];
  let k0 = -1;
  for (let j = 1; j <= n; j++) {
    const k = (start + j) % n;
    if (walled[k] === 1 && k0 < 0) k0 = j;
    if (walled[k] === 0 && k0 >= 0) {
      out.push([(start + k0) % n, j - k0]);
      k0 = -1;
    }
  }
  return out;
}

/** Distance from a point to a line of wall. */
export function runDistance(run: WallRun, x: number, z: number): number {
  const pts = run.points;
  const n = run.closed ? pts.length : pts.length - 1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % pts.length];
    best = Math.min(best, segmentDistance(x, z, ax, az, bx, bz));
  }
  return best;
}

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  return Math.hypot(ax + dx * t - x, az + dz * t - z);
}

/** Tiles whose centres lie within `width` of any of a ring's lines of wall. */
export function ringBand(grid: Grid, ring: WallRing, width: number): Uint8Array {
  const out = new Uint8Array(grid.count);
  for (const run of ring.runs) {
    const pts = run.points;
    const n = run.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const x0 = grid.tileOf(Math.min(ax, bx) - width);
      const x1 = grid.tileOf(Math.max(ax, bx) + width);
      const z0 = grid.tileOf(Math.min(az, bz) - width);
      const z1 = grid.tileOf(Math.max(az, bz) + width);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!grid.inBounds(x, z)) continue;
          const i2 = grid.index(x, z);
          if (out[i2] === 1) continue;
          if (segmentDistance(grid.centre(x), grid.centre(z), ax, az, bx, bz) < width) out[i2] = 1;
        }
      }
    }
  }
  return out;
}
