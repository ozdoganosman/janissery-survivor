import type { Service } from './balance';
import { SERVICES } from './balance';
import type { Building } from './buildings';
import { smokeMap } from './buildings';
import type { CityState } from './city';

/**
 * Public buildings and what they reach. Every service spreads over a disc around the
 * building that gives it; a house's level depends on which discs it stands in.
 */

export type Coverage = Record<Service, Uint8Array>;

/** Whether a public building is giving its service today. */
export function serves(city: CityState, b: Building): boolean {
  const def = city.balance.works[b.kind];
  if (def.service === undefined || !b.roadAccess) return false;
  // Unpaid staff stay home; a vakıf pays its own.
  if (b.vakif === undefined && city.unpaid) return false;
  return def.workers === 0 || city.stats.industryStaffing >= city.balance.serviceEffects.minStaffing;
}

const cache = new WeakMap<CityState, { key: string; coverage: Coverage }>();

/** Tiles each service reaches today. Cached until a building changes or stops serving. */
export function coverage(city: CityState): Coverage {
  let key = String(city.revision.buildings);
  for (const b of city.buildings.values()) {
    if (city.balance.works[b.kind].service !== undefined) key += serves(city, b) ? '1' : '0';
  }
  const hit = cache.get(city);
  if (hit !== undefined && hit.key === key) return hit.coverage;

  const { grid } = city;
  const out = {} as Coverage;
  for (const s of SERVICES) out[s] = new Uint8Array(grid.count);
  const disc = (map: Uint8Array, cx: number, cz: number, r: number): void => {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (grid.inBounds(x, z) && Math.hypot(x - cx, z - cz) <= r) map[grid.index(x, z)] = 1;
      }
    }
  };
  // The city's own monuments serve their quarters.
  for (const l of city.landmarks) {
    const given = city.balance.landmarkServices[l.kind] ?? {};
    for (const [service, r] of Object.entries(given) as Array<[Service, number]>) {
      disc(out[service], l.x + grid.half - 0.5, l.z + grid.half - 0.5, r);
    }
  }
  for (const b of city.buildings.values()) {
    const def = city.balance.works[b.kind];
    if (def.service === undefined || !serves(city, b)) continue;
    disc(out[def.service], b.x0 + (b.w - 1) / 2, b.z0 + (b.d - 1) / 2, def.radius ?? 0);
  }
  cache.set(city, { key, coverage: out });
  return out;
}

/**
 * The level a house on tile `i` can hold: 1 (one household) always; 2 with water and a
 * place of worship; 3, a konak, when it also has a bath, a school or a hospital, clean air
 * and a prosperous city.
 */
export function supportedLevel(city: CityState, i: number): number {
  const c = coverage(city);
  if (c.su[i] === 0 || c.ibadet[i] === 0) return 1;
  if (c.temizlik[i] === 0 || (c.egitim[i] === 0 && c.saglik[i] === 0)) return 2;
  if (smokeMap(city)[i] === 1 || city.stats.prosperity < city.balance.housing.konakProsperity) return 2;
  return 3;
}

/** What a house on tile `i` still lacks for `level`, in the player's words. */
export function missingFor(city: CityState, i: number, level: number): string[] {
  const c = coverage(city);
  const out: string[] = [];
  if (level >= 2) {
    if (c.su[i] === 0) out.push('su');
    if (c.ibadet[i] === 0) out.push('mescit');
  }
  if (level >= 3) {
    if (c.temizlik[i] === 0) out.push('hamam');
    if (c.egitim[i] === 0 && c.saglik[i] === 0) out.push('medrese ya da darüşşifa');
    if (smokeMap(city)[i] === 1) out.push('temiz hava');
    if (city.stats.prosperity < city.balance.housing.konakProsperity) out.push('refah');
  }
  return out;
}

/** Whether the tile at a field's or building's centre is reached by `service`. */
export function coveredAt(
  city: CityState,
  service: Service,
  r: { x0: number; z0: number; w: number; d: number },
): boolean {
  const i = city.grid.index(r.x0 + Math.floor(r.w / 2), r.z0 + Math.floor(r.d / 2));
  return coverage(city)[service][i] === 1;
}

/** Notables ready to endow a vakıf now: more come with people and with konaks. */
export function vakifFounders(city: CityState): number {
  const v = city.balance.vakif;
  let konaks = 0;
  for (let i = 0; i < city.house.length; i++) if (city.house[i] === 3) konaks++;
  let taken = 0;
  for (const b of city.buildings.values()) if (b.vakif !== undefined) taken++;
  const all =
    Math.floor(city.stats.population / v.peoplePerFounder) + Math.floor(konaks / v.konaksPerFounder);
  return Math.max(0, all - taken);
}
