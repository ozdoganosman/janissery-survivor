import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import type { Balance, BuildingKind } from '../src/sim/balance';
import { proposeBuilding, type BuildingProposal } from '../src/sim/buildings';
import { createCity, type CityState } from '../src/sim/city';
import type { CityDef } from '../src/sim/city-def';

/** Shared set-up for the simulation tests. */

export const def = konya as unknown as CityDef;
export const balance = balanceJson as unknown as Balance;
export const newCity = (): CityState => createCity(def, balance);

/** The first spot, scanning outwards from `near` ring by ring, where `kind` may stand. */
export function siteFor(
  c: CityState,
  kind: BuildingKind,
  near: readonly [number, number] = [0, 0],
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
        if (p.problem === undefined) return p;
      }
    }
  }
  throw new Error(`no site for ${kind}`);
}
