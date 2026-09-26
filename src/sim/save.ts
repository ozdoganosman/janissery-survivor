import type { Balance, BuildingKind, TaxRate, UnitKind } from './balance';
import { TAX_RATES, UNIT_KINDS } from './balance';
import type { Building, Work } from './buildings';
import type { Speed } from './calendar';
import { createCity, type CityState } from './city';
import type { CityDef } from './city-def';
import { removeField } from './countryside';
import { updateStats, type OrderState } from './economy';
import { replayGrowth } from './growth';
import { syncHouses } from './housing';

/**
 * Saving and loading. A save holds only what play has changed: the date, the treasury and
 * the store, the people, the tax, the buildings and which fields are left. Everything else
 * (the land, the walls, the streets, the lots) is generated again from the city's seed, so
 * a save stays small and survives changes to how the city is drawn.
 */

export const SAVE_VERSION = 1;

export interface SavedBuilding {
  id: number;
  kind: BuildingKind;
  name: string;
  x0: number;
  z0: number;
  w: number;
  d: number;
  facing: number;
  level: number;
  work: Work | null;
  spent: number;
}

export interface SaveGame {
  version: number;
  /** The city definition it belongs to, and its seed. */
  city: string;
  seed: number;
  day: number;
  fraction: number;
  speed: Speed;
  treasury: number;
  product: number;
  population: number;
  tax: TaxRate;
  buildings: SavedBuilding[];
  nextBuildingId: number;
  /** Ids of the fields still standing. */
  fields: number[];
  announced: { level: number; order: OrderState };
  last: { income: number; product: number; growth: number };
  /** Rings of walls raised, the one going up, and the suburb streets opened. */
  expansion: { built: number; work: { days: number; daysLeft: number } | null };
  streetsLaid: number;
  /** The companies under arms. Older saves have none. */
  army?: { units: SavedUnit[]; nextId: number };
}

export interface SavedUnit {
  id: number;
  kind: UnitKind;
  men: number;
  drill: { days: number; daysLeft: number } | null;
}

export function saveGame(city: CityState): SaveGame {
  return {
    version: SAVE_VERSION,
    city: city.def.id,
    seed: city.def.seed,
    day: city.calendar.day,
    fraction: city.calendar.fraction,
    speed: city.calendar.speed,
    treasury: city.treasury,
    product: city.product,
    population: city.population,
    tax: city.policy.tax,
    buildings: [...city.buildings.values()].map((b) => ({
      id: b.id,
      kind: b.kind,
      name: b.name,
      x0: b.x0,
      z0: b.z0,
      w: b.w,
      d: b.d,
      facing: b.facing,
      level: b.level,
      work: b.work === null ? null : { ...b.work },
      spent: b.spent,
    })),
    nextBuildingId: city.nextBuildingId,
    fields: [...city.fields.keys()],
    announced: { ...city.announced },
    expansion: {
      built: city.expansion.built,
      work: city.expansion.work === null ? null : { ...city.expansion.work },
    },
    streetsLaid: city.streetsLaid,
    last: { ...city.stats.last },
    army: {
      units: city.army.units.map((u) => ({ ...u, drill: u.drill === null ? null : { ...u.drill } })),
      nextId: city.army.nextId,
    },
  };
}

/** Why a save cannot be loaded, in words for the player. */
export class SaveError extends Error {}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Builds the city a save describes. Throws a SaveError, in Turkish, for a save of another
 * city or version, or one that does not fit the map.
 */
export function restoreGame(def: CityDef, balance: Balance, data: unknown): CityState {
  const s = data as Partial<SaveGame> | null;
  if (s === null || typeof s !== 'object') throw new SaveError('Kayıt okunamadı.');
  if (s.version !== SAVE_VERSION) throw new SaveError('Bu kayıt oyunun başka bir sürümünden.');
  if (s.city !== def.id || s.seed !== def.seed)
    throw new SaveError(`Bu kayıt ${def.name} şehrine ait değil.`);
  const numbers = [s.day, s.fraction, s.treasury, s.product, s.population, s.nextBuildingId];
  if (!numbers.every(finite) || !Array.isArray(s.buildings) || !Array.isArray(s.fields)) {
    throw new SaveError('Kayıt bozuk.');
  }
  if (s.tax === undefined || !TAX_RATES.includes(s.tax)) throw new SaveError('Kayıt bozuk.');
  const city = createCity(def, balance);
  const { grid } = city;
  // The city as generated has its starting buildings; the save says what stands now.
  for (const b of city.buildings.values()) for (const i of b.tiles) city.building[i] = -1;
  city.buildings.clear();
  for (const sb of s.buildings) {
    const kind = balance.buildings[sb.kind] as Balance['buildings'][BuildingKind] | undefined;
    if (kind === undefined) throw new SaveError('Kayıtta bilinmeyen bir yapı var.');
    const tiles: number[] = [];
    for (let z = sb.z0; z < sb.z0 + sb.d; z++) {
      for (let x = sb.x0; x < sb.x0 + sb.w; x++) {
        if (!grid.inBounds(x, z)) throw new SaveError('Kayıttaki bir yapı haritanın dışında.');
        tiles.push(grid.index(x, z));
      }
    }
    const b: Building = {
      id: sb.id,
      kind: sb.kind,
      name: sb.name,
      x0: sb.x0,
      z0: sb.z0,
      w: sb.w,
      d: sb.d,
      tiles,
      facing: sb.facing,
      level: Math.max(0, Math.min(kind.levels.length, sb.level)),
      work: sb.work === null ? null : { ...sb.work },
      spent: sb.spent,
    };
    for (const i of tiles) city.building[i] = b.id;
    city.buildings.set(b.id, b);
  }
  for (const u of s.army?.units ?? []) {
    if (!UNIT_KINDS.includes(u.kind) || !finite(u.men) || u.men <= 0) throw new SaveError('Kayıt bozuk.');
    city.army.units.push({
      id: u.id,
      kind: u.kind,
      men: u.men,
      drill: u.drill === null ? null : { ...u.drill },
    });
  }
  city.army.nextId = s.army?.nextId ?? city.army.units.reduce((n, u) => Math.max(n, u.id + 1), 1);
  const keep = new Set(s.fields);
  for (const id of [...city.fields.keys()]) if (!keep.has(id)) removeField(city, id);
  city.calendar.day = s.day!;
  city.calendar.fraction = s.fraction!;
  city.calendar.speed = s.speed ?? 1;
  city.treasury = s.treasury!;
  city.product = s.product!;
  city.population = s.population!;
  city.policy.tax = s.tax;
  city.nextBuildingId = s.nextBuildingId!;
  // The rank the city held carries over, so it is not lost to a thin month on loading.
  city.stats.level = Math.max(0, Math.min(balance.levels.length - 1, s.announced?.level ?? 0));
  updateStats(city);
  if (s.last !== undefined) city.stats.last = { ...s.last };
  city.announced = s.announced !== undefined ? { ...s.announced } : city.announced;
  // Walls and streets are laid again from the plan, up to where the save had them.
  replayGrowth(city, s.expansion?.built ?? 0, s.streetsLaid ?? 0);
  city.expansion.work = s.expansion?.work != null ? { ...s.expansion.work } : null;
  updateStats(city);
  syncHouses(city);
  city.revision.buildings++;
  return city;
}

/**
 * Makes `city` into `next` in place, so that everything holding the city (the views, the
 * HUD) carries on with the new one. Every revision moves on, so every view rebuilds.
 */
export function replaceCity(city: CityState, next: CityState): void {
  const rev = city.revision;
  Object.assign(city, next);
  city.revision = {
    roads: rev.roads + 1,
    houses: rev.houses + 1,
    buildings: rev.buildings + 1,
    fields: rev.fields + 1,
    walls: rev.walls + 1,
    army: rev.army + 1,
  };
}
