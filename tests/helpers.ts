import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import type { Balance, BuildingKind } from '../src/sim/balance';
import { proposeBuilding, type BuildingProposal } from '../src/sim/buildings';
import { createCity, type CityState } from '../src/sim/city';
import type { CityDef } from '../src/sim/city-def';
import { buildRoad, planRoad } from '../src/sim/roads';

/** Shared set-up for the simulation tests. */

export const def = konya as unknown as CityDef;
/** The balance as shipped, events and all. */
export const fullBalance = balanceJson as unknown as Balance;
/** The same with random events off, for tests of everything else. */
export const balance: Balance = { ...fullBalance, events: { ...fullBalance.events, enabled: false } };
export const newCity = (): CityState => createCity(def, balance);

export const usable = (p: BuildingProposal): boolean => p.problem === undefined;

/** The first spot, scanning outwards from `near` ring by ring, where `kind` may stand. */
export function siteFor(
  c: CityState,
  kind: BuildingKind,
  near: [number, number] = [0, 0],
  reach = 99,
): BuildingProposal {
  const { grid } = c;
  const cx = grid.tileOf(near[0]);
  const cz = grid.tileOf(near[1]);
  for (let r = 0; r <= reach; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !grid.inBounds(cx + dx, cz + dz)) continue;
        const p = proposeBuilding(c, kind, cx + dx, cz + dz);
        if (usable(p)) return p;
      }
    }
  }
  throw new Error(`no site for ${kind}`);
}

/** A straight road on open ground east of the walls; returns its first tile. */
export function openRoad(c: CityState, length = 10): { x: number; z: number } {
  const { grid } = c;
  for (let wz = -30; wz < 20; wz++) {
    for (let wx = 30; wx < 70; wx++) {
      const x = grid.tileOf(wx);
      const z = grid.tileOf(wz);
      let clear = true;
      for (let dz = -4; dz <= 4 && clear; dz++) {
        for (let dx = -1; dx <= length && clear; dx++) {
          const i = grid.index(x + dx, z + dz);
          clear = c.road[i] === 0 && c.field[i] < 0 && c.building[i] < 0 && c.terrain.slope[i] < 0.4;
        }
      }
      if (clear && buildRoad(c, planRoad(c, x, z, x + length - 1, z))) return { x, z };
    }
  }
  throw new Error('no open ground for a road');
}
