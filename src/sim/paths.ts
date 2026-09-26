import type { CityState } from './city';
import { WALL } from './constants';

/**
 * Ways across the map for troops on the march. A company keeps to the streets and the open
 * country: it does not walk through houses, buildings (its own barracks included, which it
 * leaves and enters by the gate) or monuments, crosses a wall only at a gate and the stream
 * only where a road bridges it. A company is a block of men a tile or more across, so the
 * way keeps a couple of tiles clear of all of these wherever the land allows. The ground a
 * march starts and ends on is always allowed.
 */

/** What stepping onto a tile costs, or Infinity where troops cannot go. */
export function marchCost(city: CityState, i: number): number {
  if (city.road[i] === 1) return 1;
  if (city.terrain.water[i] === 1) return Infinity;
  if (city.wall[i] === WALL) return Infinity;
  if (city.structure[i] >= 0) return Infinity;
  if (city.building[i] >= 0) return Infinity;
  if (city.house[i] > 0) return Infinity;
  return city.field[i] >= 0 ? 1.6 : 1.3;
}

/** Whether troops may step on a tile at all. */
function passable(city: CityState, i: number): boolean {
  return marchCost(city, i) < Infinity;
}

/** Whether a company may stand on a tile: open ground or a street, not in any building. */
export function standGround(city: CityState, i: number): boolean {
  return city.building[i] < 0 && passable(city, i);
}

/** Tiles from each tile to the nearest one troops cannot cross, counted up to this many. */
const CLEAR_MAX = 4;
/** The clearance a march keeps where it can, and what each tile short of it costs. */
const CLEAR_WANT = 2.5;
const CLEAR_COST = 1.5;

const clearances = new WeakMap<CityState, { key: string; field: Uint8Array }>();

/**
 * For every tile, how many tiles away the nearest ground troops cannot cross is (1 beside
 * it), up to CLEAR_MAX. Worked out again whenever the city's buildings, houses, roads or
 * walls change.
 */
export function clearance(city: CityState): Uint8Array {
  const r = city.revision;
  const key = `${r.buildings}:${r.houses}:${r.roads}:${r.walls}`;
  const known = clearances.get(city);
  if (known !== undefined && known.key === key) return known.field;
  const n = city.grid.size;
  const field = new Uint8Array(n * n).fill(CLEAR_MAX);
  let front: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (!passable(city, i)) {
      field[i] = 0;
      front.push(i);
    }
  }
  for (let d = 1; d < CLEAR_MAX && front.length > 0; d++) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % n;
      const z = Math.floor(i / n);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const j = nz * n + nx;
          if (field[j] <= d) continue;
          field[j] = d;
          next.push(j);
        }
      }
    }
    front = next;
  }
  clearances.set(city, { key, field });
  return field;
}

/** Extra cost of a tile too close to something a block of men cannot pass. */
function crowding(clear: Uint8Array, i: number): number {
  return Math.max(0, CLEAR_WANT - clear[i]) * CLEAR_COST;
}

/**
 * How far a company would walk from a point to every tile within `radius` tiles of it, by
 * the ways troops may take; Infinity where it cannot get to, or beyond the radius.
 */
export function reachFrom(city: CityState, x: number, z: number, radius: number): Float32Array {
  const { grid } = city;
  const n = grid.size;
  const out = new Float32Array(n * n).fill(Infinity);
  const sx = Math.max(0, Math.min(n - 1, grid.tileOf(x)));
  const sz = Math.max(0, Math.min(n - 1, grid.tileOf(z)));
  const start = sz * n + sx;
  if (!passable(city, start)) return out;
  const heap = new MinHeap();
  out[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const i = heap.pop();
    const cx = i % n;
    const cz = Math.floor(i / n);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        if (Math.abs(nx - sx) > radius || Math.abs(nz - sz) > radius) continue;
        const j = nz * n + nx;
        if (!passable(city, j)) continue;
        if (dx !== 0 && dz !== 0 && (!passable(city, cz * n + nx) || !passable(city, nz * n + cx))) continue;
        const d = out[i] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (d >= out[j]) continue;
        out[j] = d;
        heap.push(j, d);
      }
    }
  }
  return out;
}

/**
 * The way from one point of the map to another, as world points: the start, the turns,
 * the end. Null when there is none (the end is walled in, or across water with no bridge).
 */
export function findPath(
  city: CityState,
  from: { x: number; z: number },
  to: { x: number; z: number },
): Array<[number, number]> | null {
  const { grid } = city;
  const n = grid.size;
  const clampTile = (v: number): number => Math.max(0, Math.min(n - 1, grid.tileOf(v)));
  const sx = clampTile(from.x);
  const sz = clampTile(from.z);
  const tx = clampTile(to.x);
  const tz = clampTile(to.z);
  const start = sz * n + sx;
  const goal = tz * n + tx;
  const clear = clearance(city);
  const cost = (i: number): number =>
    i === start || i === goal ? 1 : marchCost(city, i) + crowding(clear, i);
  if (start === goal)
    return [
      [from.x, from.z],
      [to.x, to.z],
    ];

  const g = new Float32Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = new MinHeap();
  const h = (i: number): number => {
    const dx = Math.abs((i % n) - tx);
    const dz = Math.abs(Math.floor(i / n) - tz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  g[start] = 0;
  heap.push(start, h(start));
  while (heap.size > 0) {
    const i = heap.pop();
    if (i === goal) break;
    if (closed[i] === 1) continue;
    closed[i] = 1;
    const x = i % n;
    const z = Math.floor(i / n);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const j = nz * n + nx;
        if (closed[j] === 1) continue;
        const c = cost(j);
        if (c === Infinity) continue;
        // No cutting a corner between two tiles that cannot be crossed.
        if (dx !== 0 && dz !== 0 && (cost(z * n + nx) === Infinity || cost(nz * n + x) === Infinity))
          continue;
        const ng = g[i] + c * (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (ng >= g[j]) continue;
        g[j] = ng;
        came[j] = i;
        heap.push(j, ng + h(j));
      }
    }
  }
  if (came[goal] === -1) return null;
  const tiles: number[] = [];
  for (let i = goal; i !== -1; i = came[i]) tiles.push(i);
  tiles.reverse();
  const pts: Array<[number, number]> = tiles.map((i) => [grid.centre(i % n), grid.centre(Math.floor(i / n))]);
  pts[0] = [from.x, from.z];
  pts[pts.length - 1] = [to.x, to.z];
  return simplify(city, pts);
}

/**
 * Drops the turns a straight walk would not need: string-pulling, but only along ground at
 * least as clear of obstacles as the way it replaces (up to a couple of tiles), so a
 * straightened march does not scrape along walls the search took care to keep off.
 */
function simplify(city: CityState, pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const { grid } = city;
  const field = clearance(city);
  const room = pts.map(([x, z]) => field[grid.index(grid.tileOf(x), grid.tileOf(z))]);
  const out: Array<[number, number]> = [pts[0]];
  let k = 0;
  while (k < pts.length - 1) {
    let far = k + 1;
    for (let j = pts.length - 1; j > k + 1; j--) {
      let need = 2;
      for (let m = k + 1; m < j; m++) need = Math.min(need, room[m]);
      if (clear(city, field, pts[k], pts[j], need)) {
        far = j;
        break;
      }
    }
    out.push(pts[far]);
    k = far;
  }
  return out;
}

/** Whether a straight walk between two points keeps at least `need` tiles clear of obstacles. */
function clear(
  city: CityState,
  field: Uint8Array,
  a: [number, number],
  b: [number, number],
  need: number,
): boolean {
  const { grid } = city;
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.35);
  const first = grid.index(grid.tileOf(a[0]), grid.tileOf(a[1]));
  const last = grid.index(grid.tileOf(b[0]), grid.tileOf(b[1]));
  for (let s = 1; s < steps; s++) {
    const x = grid.tileOf(a[0] + ((b[0] - a[0]) * s) / steps);
    const z = grid.tileOf(a[1] + ((b[1] - a[1]) * s) / steps);
    if (!grid.inBounds(x, z)) return false;
    const i = grid.index(x, z);
    if (i === first || i === last) continue;
    if (field[i] < need) return false;
  }
  return true;
}

/** A binary heap of tile indices by priority. */
class MinHeap {
  private readonly items: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, key: number): void {
    const { items, keys } = this;
    let k = items.length;
    items.push(item);
    keys.push(key);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (keys[p] <= key) break;
      items[k] = items[p];
      keys[k] = keys[p];
      k = p;
    }
    items[k] = item;
    keys[k] = key;
  }

  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const item = items.pop()!;
    const key = keys.pop()!;
    const n = items.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        items[k] = items[c];
        keys[k] = keys[c];
        k = c;
      }
      items[k] = item;
      keys[k] = key;
    }
    return top;
  }
}
