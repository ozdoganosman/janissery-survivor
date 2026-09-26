import { hash2 } from '../core/rng';
import { outerRadius, type CityState } from './city';
import { WALL_NONE } from './constants';
import { removeField } from './countryside';
import { roadDistance } from './distance';

/**
 * Houses are not built by the player: they follow the population. Every lot along the
 * streets gets a place in a queue once, when the city is made; however many houses the
 * people need take the first free lots in it. The queue fills the walled town first,
 * near the tepe and on the street front before the back lots, then spills out along the
 * gate roads as suburbs. Hashed jitter keeps the edge of the built-up area ragged.
 */

/** How far beyond the walls the suburbs may reach, in tiles. */
const SUBURB_REACH = 40;

export function layLots(city: CityState): void {
  const { grid, def, terrain } = city;
  const R = outerRadius(city);
  const depth = roadDistance(city, 3);
  const scored: Array<[number, number]> = [];
  for (let z = 0; z < grid.size; z++) {
    for (let x = 0; x < grid.size; x++) {
      const i = grid.index(x, z);
      const d = depth[i];
      if (d < 1 || d > 3) continue;
      if (city.wall[i] !== WALL_NONE || city.structure[i] >= 0 || terrain.water[i] === 1) continue;
      if (terrain.slope[i] > city.balance.maxSlope) continue;
      const r = Math.hypot(grid.centre(x) - def.tepe.x, grid.centre(z) - def.tepe.z);
      // The walled town builds two lots deep from its streets; the suburbs, on open
      // ground, three deep along their roads.
      const inside = r >= def.housing.innerRadius && r <= R - 1.2 && d <= 2;
      const suburb = r >= R + 1.5 && r <= R + SUBURB_REACH;
      if (!inside && !suburb) continue;
      const spread = inside ? (r / R) * 0.5 : 1.2 + ((r - R) / SUBURB_REACH) * 2.4;
      scored.push([i, spread + (d - 1) * 0.35 + hash2(x, z, 7) * 0.6]);
    }
  }
  scored.sort((a, b) => a[1] - b[1]);
  city.lots = Int32Array.from(scored, ([i]) => i);
}

/** Houses the people need. */
export function housesWanted(city: CityState): number {
  return Math.round(city.population / city.balance.levels[city.stats.level].peoplePerHouse);
}

/**
 * Puts the houses the population needs on the first free lots, and takes them off
 * anywhere else. A lot under a building is skipped; a field in the way of the growing
 * suburbs is built over. A house keeps its height from its tile's hash and the city's
 * rank, so the same lot always shows the same house.
 */
export function syncHouses(city: CityState): void {
  const { grid } = city;
  const next = new Uint8Array(grid.count);
  const want = housesWanted(city);
  const rank = city.stats.level;
  const twoStorey = city.def.housing.twoStorey + 0.12 * rank;
  const R = outerRadius(city);
  let placed = 0;
  for (const i of city.lots) {
    if (placed >= want) break;
    if (city.building[i] >= 0) continue;
    if (city.field[i] >= 0) removeField(city, city.field[i]);
    const x = i % grid.size;
    const z = Math.floor(i / grid.size);
    const h = hash2(x, z, 4);
    const inside = Math.hypot(grid.centre(x) - city.def.tepe.x, grid.centre(z) - city.def.tepe.z) < R;
    // A great city has konaks in the old town; the suburbs stay low.
    next[i] = inside && h < 0.035 * rank ? 3 : h < (inside ? twoStorey : twoStorey * 0.5) ? 2 : 1;
    placed++;
  }
  let changed = false;
  for (let i = 0; i < grid.count; i++) {
    if (next[i] !== city.house[i]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  city.house.set(next);
  city.revision.houses++;
}
