import { supercoverLine } from '../core/geom';
import { WALL, type CityState } from './city';

/** Dirhems per new road tile on level ground. */
export const ROAD_COST = 10;
/** A road tile over water is a stone bridge, and costs accordingly. */
export const BRIDGE_COST = 80;
/** Corner-to-corner height difference beyond which a tile is too steep for a road. */
export const MAX_ROAD_SLOPE = 0.75;

export type RoadTileStatus = 'new' | 'bridge' | 'existing' | 'blocked';

export interface RoadTile {
  x: number;
  z: number;
  status: RoadTileStatus;
  cost: number;
  /** Why the tile is blocked, in words the player reads. */
  reason?: string;
}

export interface RoadPlan {
  tiles: RoadTile[];
  cost: number;
  /** The first reason the plan cannot be built, or undefined if it can. */
  problem?: string;
}

function blockReason(city: CityState, x: number, z: number): string | undefined {
  const { grid } = city;
  if (!grid.inBounds(x, z)) return 'Harita dışı';
  const i = grid.index(x, z);
  if (city.wall[i] === WALL) return 'Sur';
  if (city.structure[i] >= 0) return city.landmarks[city.structure[i]]?.name ?? 'Yapı';
  if (city.house[i] > 0) return 'Ev';
  if (city.road[i] === 1) return undefined;
  if (city.terrain.slope[i] > MAX_ROAD_SLOPE) return 'Çok dik';
  return undefined;
}

/**
 * A straight road between two tiles, as the player drags it. The line is 4-connected, so
 * a diagonal drag becomes a staircase in the data and a smooth diagonal on screen.
 */
export function planRoad(city: CityState, x0: number, z0: number, x1: number, z1: number): RoadPlan {
  const tiles: RoadTile[] = [];
  let cost = 0;
  let problem: string | undefined;
  for (const [x, z] of supercoverLine(x0, z0, x1, z1)) {
    const reason = blockReason(city, x, z);
    if (reason !== undefined) {
      tiles.push({ x, z, status: 'blocked', cost: 0, reason });
      problem ??= reason;
      continue;
    }
    const i = city.grid.index(x, z);
    if (city.road[i] === 1) {
      tiles.push({ x, z, status: 'existing', cost: 0 });
      continue;
    }
    const bridge = city.terrain.water[i] === 1;
    const slope = city.terrain.slope[i];
    const tileCost = bridge ? BRIDGE_COST : Math.round(ROAD_COST * (1 + 2 * slope));
    tiles.push({ x, z, status: bridge ? 'bridge' : 'new', cost: tileCost });
    cost += tileCost;
  }
  if (problem === undefined && cost > city.treasury) problem = 'Hazine yetersiz';
  return problem === undefined ? { tiles, cost } : { tiles, cost, problem };
}

/** Builds a plan if it is still valid and affordable. Returns false and changes nothing otherwise. */
export function buildRoad(city: CityState, plan: RoadPlan): boolean {
  // Re-plan from the same end points: the city may have changed since the preview was drawn.
  const first = plan.tiles[0];
  const last = plan.tiles[plan.tiles.length - 1];
  if (first === undefined || last === undefined) return false;
  const fresh = planRoad(city, first.x, first.z, last.x, last.z);
  if (fresh.problem !== undefined) return false;
  let added = 0;
  for (const t of fresh.tiles) {
    if (t.status === 'new' || t.status === 'bridge') {
      city.road[city.grid.index(t.x, t.z)] = 1;
      added++;
    }
  }
  city.treasury -= fresh.cost;
  if (added > 0) city.revision.roads++;
  return true;
}

/** Removes every removable road in the rectangle. Returns how many tiles were cleared. */
export function bulldoze(city: CityState, x0: number, z0: number, x1: number, z1: number): number {
  const { grid } = city;
  let removed = 0;
  for (let z = Math.max(0, Math.min(z0, z1)); z <= Math.min(grid.size - 1, Math.max(z0, z1)); z++) {
    for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(grid.size - 1, Math.max(x0, x1)); x++) {
      const i = grid.index(x, z);
      if (city.road[i] === 1 && city.roadLocked[i] === 0) {
        city.road[i] = 0;
        removed++;
      }
    }
  }
  if (removed > 0) city.revision.roads++;
  return removed;
}
