import type { Rng } from '../core/rng';
import { hash2 } from '../core/rng';
import type { CityState } from './city';
import { WALL_NONE } from './constants';
import { DIRS4 } from './grid';

/**
 * The fields and pastures round the city. They are scenery: they turn with the seasons
 * and give way to anything the player builds on them, but the city's income does not
 * depend on them.
 */

export type FieldKind = 'tarla' | 'mera';
export type Crop = 'bugday' | 'arpa';

export interface Field {
  id: number;
  kind: FieldKind;
  crop: Crop;
  /** Resting this year: ploughed but unsown. */
  fallow: boolean;
  /** Tile rectangle. */
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: number[];
}

/** Fields begin this far beyond the walls, clear of the suburbs. */
const FIELDS_FROM = 16;
const FIELDS_TO = 58;
const TARGET_TILES = 900;

function freeTile(city: CityState, x: number, z: number): boolean {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return false;
  const i = grid.index(x, z);
  return (
    terrain.water[i] === 0 &&
    city.wall[i] === WALL_NONE &&
    city.structure[i] < 0 &&
    city.building[i] < 0 &&
    city.road[i] === 0 &&
    city.field[i] < 0 &&
    terrain.site[i] === 0 &&
    terrain.slope[i] < 0.35
  );
}

/** Lays fields along the roads leaving the gates, the best soil first. */
export function seedCountryside(city: CityState, rng: Rng): void {
  const { grid, def, terrain } = city;
  const R = def.walls.radius;
  const candidates: Array<{
    x0: number;
    z0: number;
    w: number;
    d: number;
    fertility: number;
    score: number;
  }> = [];
  for (let i = 0; i < grid.count; i++) {
    if (city.road[i] !== 1 || terrain.water[i] === 1) continue;
    const rx = i % grid.size;
    const rz = Math.floor(i / grid.size);
    const r = Math.hypot(grid.centre(rx) - def.tepe.x, grid.centre(rz) - def.tepe.z);
    if (r < R + FIELDS_FROM || r > R + FIELDS_TO) continue;
    if (!rng.chance(0.3)) continue;
    const w = 5 + rng.int(5);
    const d = 4 + rng.int(4);
    for (const [dx, dz] of DIRS4) {
      const x0 = dx > 0 ? rx + 1 : dx < 0 ? rx - w : rx - Math.floor(w / 2);
      const z0 = dz > 0 ? rz + 1 : dz < 0 ? rz - d : rz - Math.floor(d / 2);
      let fertility = 0;
      let ok = true;
      for (let z = z0; z < z0 + d && ok; z++)
        for (let x = x0; x < x0 + w && ok; x++) {
          ok = freeTile(city, x, z);
          if (ok) fertility += terrain.fertility[grid.index(x, z)];
        }
      if (!ok) continue;
      fertility /= w * d;
      candidates.push({ x0, z0, w, d, fertility, score: fertility - r * 0.004 + rng.next() * 0.02 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  let placed = 0;
  for (const c of candidates) {
    if (placed >= TARGET_TILES) break;
    const tiles: number[] = [];
    let ok = true;
    for (let z = c.z0; z < c.z0 + c.d && ok; z++)
      for (let x = c.x0; x < c.x0 + c.w && ok; x++) {
        ok = freeTile(city, x, z);
        tiles.push(grid.index(x, z));
      }
    if (!ok) continue;
    const id = city.fields.size + 1;
    const kind = c.fertility >= 0.35 ? 'tarla' : 'mera';
    city.fields.set(id, {
      id,
      kind,
      crop: c.fertility >= 0.55 ? 'bugday' : 'arpa',
      fallow: kind === 'tarla' && hash2(c.x0, c.z0, 31) < 0.18,
      x0: c.x0,
      z0: c.z0,
      w: c.w,
      d: c.d,
      tiles,
    });
    for (const i of tiles) city.field[i] = id;
    placed += tiles.length;
  }
  city.revision.fields++;
}

/** Ploughs a field under, for a building to stand where it was. */
export function removeField(city: CityState, id: number): void {
  const f = city.fields.get(id);
  if (f === undefined) return;
  for (const i of f.tiles) city.field[i] = -1;
  city.fields.delete(id);
  city.revision.fields++;
}
