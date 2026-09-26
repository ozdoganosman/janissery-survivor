import type { Vec2 } from '../core/geom';
import type { Rng } from '../core/rng';
import type { CityState } from '../sim/city';
import { chainPath, roadChains } from './road-paths';

/**
 * Where people walk: the drawn centre lines of the streets, joined at their junctions.
 * Pure data and arithmetic, no three.js, so it is tested headless.
 */

export interface WalkEdge {
  /** Tiles at the two ends; the same tile for a closed loop. */
  a: number;
  b: number;
  pts: Vec2[];
  /** Distance along the line at each point. */
  cum: number[];
  length: number;
  closed: boolean;
  /** The road tiles the street is made of. */
  tiles: number[];
  /** How busy the street is: its length times how many people live along it. */
  weight: number;
}

export interface WalkNetwork {
  edges: WalkEdge[];
  /** Edges meeting at each junction or dead-end tile. */
  byNode: Map<number, number[]>;
  /** Running total of edge weights, for picking a busy street at random. */
  cumWeight: number[];
}

/** One person on the streets: which line, how far along it, and which way. */
export interface Walk {
  edge: number;
  s: number;
  dir: 1 | -1;
}

/** Streets with the people who use them: `busy` says how crowded each tile's surroundings are. */
export function buildWalkNetwork(city: CityState, busy: (tile: number) => number): WalkNetwork {
  const { grid } = city;
  const edges: WalkEdge[] = [];
  for (const chain of roadChains(city.road, grid.size)) {
    if (chain.tiles.length < 2) continue;
    const pts = chainPath(grid, chain);
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    }
    const length = cum[cum.length - 1];
    if (length <= 0) continue;
    edges.push({
      a: chain.tiles[0],
      b: chain.closed ? chain.tiles[0] : chain.tiles[chain.tiles.length - 1],
      pts,
      cum,
      length,
      closed: chain.closed,
      tiles: chain.tiles,
      weight: 0,
    });
  }
  const byNode = new Map<number, number[]>();
  const link = (node: number, e: number): void => {
    const list = byNode.get(node) ?? [];
    list.push(e);
    byNode.set(node, list);
  };
  edges.forEach((e, k) => {
    if (e.closed) return;
    link(e.a, k);
    link(e.b, k);
  });
  const net = { edges, byNode, cumWeight: [] };
  reweigh(net, busy);
  return net;
}

/** New weights for the same streets, when the houses along them change. */
export function reweigh(net: WalkNetwork, busy: (tile: number) => number): void {
  net.cumWeight = [];
  let total = 0;
  for (const e of net.edges) {
    let crowd = 0;
    for (const t of e.tiles) crowd += busy(t);
    e.weight = (e.length * crowd) / e.tiles.length;
    total += e.weight;
    net.cumWeight.push(total);
  }
}

/** A random spot on a street, busier streets more likely. Null when there are no streets. */
export function spawnWalk(net: WalkNetwork, rng: Rng): Walk | null {
  const total = net.cumWeight[net.cumWeight.length - 1] ?? 0;
  if (total <= 0) return null;
  const r = rng.next() * total;
  let lo = 0;
  let hi = net.cumWeight.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (net.cumWeight[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  const e = net.edges[lo];
  return { edge: lo, s: rng.next() * e.length, dir: rng.chance(0.5) ? 1 : -1 };
}

/**
 * Moves a walker `dist` along the streets. At a junction it takes another street, rarely
 * the one it came by; at a dead end it turns back.
 */
export function advanceWalk(net: WalkNetwork, w: Walk, dist: number, rng: Rng): void {
  let left = dist;
  for (let guard = 0; guard < 8 && left > 0; guard++) {
    const e = net.edges[w.edge];
    const room = w.dir === 1 ? e.length - w.s : w.s;
    if (left < room) {
      w.s += w.dir * left;
      return;
    }
    left -= room;
    if (e.closed) {
      w.s = w.dir === 1 ? 0 : e.length;
      continue;
    }
    const node = w.dir === 1 ? e.b : e.a;
    const options = (net.byNode.get(node) ?? []).filter((k) => k !== w.edge);
    const next = options.length > 0 ? options[Math.floor(rng.next() * options.length)] : w.edge;
    const ne = net.edges[next];
    // Leave the junction along the new street, whichever end of it the junction is.
    if (ne.a === node) {
      w.edge = next;
      w.dir = 1;
      w.s = 0;
    } else {
      w.edge = next;
      w.dir = -1;
      w.s = ne.length;
    }
  }
  w.s = Math.min(Math.max(w.s, 0), net.edges[w.edge].length);
}

/** Position and heading (unit vector, in the walking direction) of a walker. */
export function walkPoint(net: WalkNetwork, w: Walk): [number, number, number, number] {
  const e = net.edges[w.edge];
  const s = Math.min(Math.max(w.s, 0), e.length);
  let lo = 0;
  let hi = e.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (e.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const [ax, az] = e.pts[lo];
  const [bx, bz] = e.pts[hi];
  const seg = e.cum[hi] - e.cum[lo] || 1;
  const t = (s - e.cum[lo]) / seg;
  const dx = ((bx - ax) / seg) * w.dir;
  const dz = ((bz - az) / seg) * w.dir;
  return [ax + (bx - ax) * t, az + (bz - az) * t, dx, dz];
}
