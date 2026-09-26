import { chaikin, type Vec2 } from '../core/geom';
import type { Grid } from '../sim/grid';
import { DIRS4 } from '../sim/grid';

/**
 * The shape of the streets as drawn: tile chains between junctions, smoothed into the
 * lines the player meant. Shared by the road ribbons and by the people walking on them,
 * and free of three.js so it can be tested headless.
 */

export interface RoadChain {
  tiles: number[];
  closed: boolean;
}

/**
 * Splits the road tiles into chains between junctions, as tile indices. A chain runs from
 * a junction or dead end to the next one; loops with no junction come out as closed chains.
 */
export function roadChains(road: Uint8Array, size: number): RoadChain[] {
  const neighbours = (i: number): number[] => {
    const x = i % size;
    const z = Math.floor(i / size);
    const out: number[] = [];
    for (const [dx, dz] of DIRS4) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (road[j] === 1) out.push(j);
    }
    return out;
  };
  const edgeKey = (a: number, b: number): number => (a < b ? a * size * size + b : b * size * size + a);
  const used = new Set<number>();
  const chains: RoadChain[] = [];

  const walk = (start: number, first: number): number[] => {
    const tiles = [start, first];
    used.add(edgeKey(start, first));
    let prev = start;
    let cur = first;
    for (;;) {
      const next = neighbours(cur);
      if (next.length !== 2) break;
      const step = next[0] === prev ? next[1] : next[0];
      if (used.has(edgeKey(cur, step))) break;
      used.add(edgeKey(cur, step));
      tiles.push(step);
      prev = cur;
      cur = step;
    }
    return tiles;
  };

  for (let i = 0; i < road.length; i++) {
    if (road[i] !== 1) continue;
    const nb = neighbours(i);
    if (nb.length === 0) chains.push({ tiles: [i], closed: false });
    if (nb.length === 2) continue;
    for (const j of nb) if (!used.has(edgeKey(i, j))) chains.push({ tiles: walk(i, j), closed: false });
  }
  // Whatever is left is made only of two-neighbour tiles: pure loops.
  for (let i = 0; i < road.length; i++) {
    if (road[i] !== 1) continue;
    for (const j of neighbours(i)) {
      if (used.has(edgeKey(i, j))) continue;
      const tiles = walk(i, j);
      const closed = tiles[tiles.length - 1] === i;
      if (closed) tiles.pop();
      chains.push({ tiles, closed });
    }
  }
  return chains;
}

/**
 * Moving average over a tile chain. A 4-connected staircase averages out to the straight
 * or gently curving line the player meant; end points stay put so chains still meet.
 */
export function straighten(pts: readonly Vec2[], closed: boolean, reach = 3): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const k = closed ? reach : Math.min(reach, i, n - 1 - i);
    let sx = 0;
    let sz = 0;
    for (let j = -k; j <= k; j++) {
      const p = pts[(((i + j) % n) + n) % n];
      sx += p[0];
      sz += p[1];
    }
    out.push([sx / (2 * k + 1), sz / (2 * k + 1)]);
  }
  return out;
}

/**
 * A chain's drawn centre line. It starts and ends on the centres of its end tiles, so
 * chains meeting at a junction meet exactly; a closed chain repeats its first point last.
 */
export function chainPath(grid: Grid, chain: RoadChain): Vec2[] {
  let pts: Vec2[] = chain.tiles.map((i) => [
    grid.centre(i % grid.size),
    grid.centre(Math.floor(i / grid.size)),
  ]);
  if (pts.length === 1) {
    const [x, z] = pts[0];
    pts = [
      [x - 0.3, z],
      [x + 0.3, z],
    ];
  }
  const smooth = chaikin(straighten(pts, chain.closed), 2, chain.closed);
  if (chain.closed) smooth.push(smooth[0]);
  return smooth;
}
