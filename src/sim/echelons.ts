import { ECHELON_LEVELS, type EchelonLevel, type UnitKind } from './balance';
import type { Unit } from './army';
import type { CityState } from './city';

/**
 * The chain of command over the taburs. Four taburs make a tugay, two tugays a kolordu and
 * two kolordus an ordu (the numbers are in `balance.json`), so a large army is ordered a
 * few echelons at a time instead of a hundred taburs. A new tabur joins a tugay of its own
 * kind that has room, and a new tugay a kolordu, and so on up; echelons left empty are
 * struck off. The player may also gather chosen taburs into echelons of their own.
 */

export interface Echelon {
  id: number;
  level: EchelonLevel;
  /** Its number among the echelons of its level: the 3 of "3. Tugay". */
  no: number;
  /** The echelon one level up it serves in; null for an ordu. */
  parent: number | null;
}

const INDEX: Record<EchelonLevel, number> = { tugay: 0, kolordu: 1, ordu: 2 };

/** The level above, or null over an ordu. */
function up(level: EchelonLevel): EchelonLevel | null {
  return ECHELON_LEVELS[INDEX[level] + 1] ?? null;
}

export function echelonName(city: CityState, e: Echelon): string {
  return `${e.no}. ${city.balance.army.echelons[e.level].name}`;
}

export function echelonById(city: CityState, id: number): Echelon | undefined {
  return city.army.echelons.find((e) => e.id === id);
}

/** The tugay, kolordu and ordu a tabur serves in, lowest first, as far as the chain goes. */
export function chainOf(city: CityState, u: Unit): Echelon[] {
  const out: Echelon[] = [];
  let e = u.tugay === null ? undefined : echelonById(city, u.tugay);
  while (e !== undefined) {
    out.push(e);
    e = e.parent === null ? undefined : echelonById(city, e.parent);
  }
  return out;
}

/** The echelon of `level` a tabur serves in, if any. */
export function echelonOf(city: CityState, u: Unit, level: EchelonLevel): Echelon | undefined {
  return chainOf(city, u).find((e) => e.level === level);
}

/** Every tabur under an echelon, in the order they were raised. */
export function taburs(city: CityState, id: number): Unit[] {
  const under = new Set([id]);
  // Parents come before their children in no particular order, so widen until it holds.
  for (let grew = true; grew;) {
    grew = false;
    for (const e of city.army.echelons) {
      if (e.parent !== null && under.has(e.parent) && !under.has(e.id)) {
        under.add(e.id);
        grew = true;
      }
    }
  }
  return city.army.units.filter((u) => u.tugay !== null && under.has(u.tugay));
}

/** The kind of every tabur under an echelon, if they are all of one kind. */
export function echelonKind(city: CityState, id: number): UnitKind | null {
  const kinds = new Set(taburs(city, id).map((u) => u.kind));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** How many it holds of the level below: taburs in a tugay, tugays in a kolordu. */
function held(city: CityState, e: Echelon): number {
  if (e.level === 'tugay') return city.army.units.filter((u) => u.tugay === e.id).length;
  return city.army.echelons.filter((c) => c.parent === e.id).length;
}

function create(city: CityState, level: EchelonLevel): Echelon {
  const taken = new Set(city.army.echelons.filter((e) => e.level === level).map((e) => e.no));
  let no = 1;
  while (taken.has(no)) no++;
  const e: Echelon = { id: city.army.nextEchelon++, level, no, parent: null };
  city.army.echelons.push(e);
  return e;
}

/**
 * Strikes off links to echelons that are gone and echelons left with no one under them.
 * Returns whether anything changed.
 */
function prune(city: CityState): boolean {
  const army = city.army;
  let changed = false;
  const byId = new Map(army.echelons.map((e) => [e.id, e]));
  for (const u of army.units) {
    if (u.tugay !== null && byId.get(u.tugay)?.level !== 'tugay') {
      u.tugay = null;
      changed = true;
    }
  }
  for (const e of army.echelons) {
    const above = up(e.level);
    if (e.parent !== null && (above === null || byId.get(e.parent)?.level !== above)) {
      e.parent = null;
      changed = true;
    }
  }
  // From the bottom up, so a kolordu whose tugays all went goes too.
  for (const level of ECHELON_LEVELS) {
    const keep = army.echelons.filter((e) => e.level !== level || held(city, e) > 0);
    if (keep.length === army.echelons.length) continue;
    const gone = new Set(army.echelons.filter((e) => !keep.includes(e)).map((e) => e.id));
    army.echelons = keep;
    for (const e of keep) if (e.parent !== null && gone.has(e.parent)) e.parent = null;
    changed = true;
  }
  return changed;
}

/**
 * Puts every tabur without a tugay into one of its kind with room, or a new one, and every
 * echelon without a place one level up into one with room, rather one of its own kind.
 * Returns whether anything changed.
 */
function assign(city: CityState): boolean {
  const army = city.army;
  const holds = (level: EchelonLevel): number => city.balance.army.echelons[level].holds;
  let changed = false;
  for (const u of army.units) {
    if (u.tugay !== null) continue;
    const room = army.echelons
      .filter(
        (e) => e.level === 'tugay' && held(city, e) < holds('tugay') && echelonKind(city, e.id) === u.kind,
      )
      .sort((p, q) => p.no - q.no);
    u.tugay = (room[0] ?? create(city, 'tugay')).id;
    changed = true;
  }
  for (const level of ECHELON_LEVELS) {
    const above = up(level);
    if (above === null) break;
    const loose = army.echelons
      .filter((e) => e.level === level && e.parent === null)
      .sort((p, q) => p.no - q.no);
    for (const e of loose) {
      const kind = echelonKind(city, e.id);
      const room = army.echelons
        .filter((p) => p.level === above && held(city, p) < holds(above))
        .map((p) => ({ p, same: kind !== null && echelonKind(city, p.id) === kind }))
        .sort((a, b) => Number(b.same) - Number(a.same) || a.p.no - b.p.no);
      e.parent = (room[0]?.p ?? create(city, above)).id;
      changed = true;
    }
  }
  return changed;
}

/**
 * Brings the chain of command up to date with the army: every tabur in a tugay, every
 * tugay in a kolordu, every kolordu in an ordu, and no echelon empty.
 */
export function organize(city: CityState): void {
  const pruned = prune(city);
  const assigned = assign(city);
  if (pruned || assigned) city.revision.army++;
}

export interface FormResult {
  echelon?: Echelon;
  problem?: string;
}

/** What a new echelon would take in, one level down, and where each part serves now. */
interface FormPlan {
  parts: Array<{ parent: number | null; set: (id: number) => void }>;
  problem?: string;
}

function planForm(city: CityState, level: EchelonLevel, ids: readonly number[]): FormPlan {
  const set = new Set(ids);
  const units = city.army.units.filter((u) => set.has(u.id));
  const defs = city.balance.army.echelons;
  const def = defs[level];
  const parts: FormPlan['parts'] = [];
  if (units.length === 0) return { parts, problem: 'Önce tabur seç.' };
  const below = ECHELON_LEVELS[INDEX[level] - 1] as EchelonLevel | undefined;
  if (below === undefined) {
    for (const u of units) parts.push({ parent: u.tugay, set: (id) => (u.tugay = id) });
  } else {
    const seen = new Map<number, Echelon>();
    for (const u of units) {
      const e = echelonOf(city, u, below);
      if (e !== undefined) seen.set(e.id, e);
    }
    for (const e of seen.values()) parts.push({ parent: e.parent, set: (id) => (e.parent = id) });
  }
  const lower = (name: string): string => name.toLocaleLowerCase('tr-TR');
  const what = below === undefined ? 'tabur' : lower(defs[below].name);
  if (parts.length > def.holds) {
    return { parts, problem: `Bir ${lower(def.name)} en çok ${def.holds} ${what} alır.` };
  }
  const first = parts[0].parent;
  if (first !== null && parts.every((p) => p.parent === first)) {
    const old = echelonById(city, first);
    if (old !== undefined && held(city, old) === parts.length) {
      return { parts, problem: `Bunlar zaten ${echelonName(city, old)}.` };
    }
  }
  return { parts };
}

/** Why the chosen taburs cannot be gathered into a new echelon of `level`, or null. */
export function formProblem(city: CityState, level: EchelonLevel, ids: readonly number[]): string | null {
  return planForm(city, level, ids).problem ?? null;
}

/**
 * Gathers the chosen taburs into a new echelon of `level`: for a tugay, the taburs
 * themselves; for a kolordu, the tugays they serve in; for an ordu, their kolordus. The new
 * echelon stays where most of what it took served before, if there is room there.
 */
export function formEchelon(city: CityState, level: EchelonLevel, ids: readonly number[]): FormResult {
  const { parts, problem } = planForm(city, level, ids);
  if (problem !== undefined) return { problem };
  const defs = city.balance.army.echelons;
  // The echelons one level up where its parts served, those where most served first.
  const count = new Map<number, number>();
  for (const p of parts) {
    const at = p.parent === null ? null : (echelonById(city, p.parent)?.parent ?? null);
    if (at !== null) count.set(at, (count.get(at) ?? 0) + 1);
  }
  const homes = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const e = create(city, level);
  for (const p of parts) p.set(e.id);
  const above = up(level);
  // The new echelon stays in the first of those with room for it, counting only what
  // still has taburs under it: the rest is about to be struck off.
  for (const id of above === null ? [] : homes) {
    const h = echelonById(city, id);
    if (h === undefined || h.level !== above) continue;
    const live = city.army.echelons.filter(
      (c) => c.parent === h.id && c.id !== e.id && taburs(city, c.id).length > 0,
    ).length;
    if (live < defs[h.level].holds) {
      e.parent = h.id;
      break;
    }
  }
  prune(city);
  assign(city);
  city.revision.army++;
  return { echelon: e };
}

/**
 * The taburs of the echelons one level up from a choice: a tabur's tugay, a tugay's
 * kolordu, a kolordu's ordu. The choice as it is when it is already whole ordus.
 */
export function widen(city: CityState, ids: readonly number[]): number[] {
  const set = new Set(ids);
  const units = city.army.units.filter((u) => set.has(u.id));
  for (const level of ECHELON_LEVELS) {
    const all = new Set<number>();
    for (const u of units) {
      const e = echelonOf(city, u, level);
      if (e === undefined) all.add(u.id);
      else for (const t of taburs(city, e.id)) all.add(t.id);
    }
    if (all.size > units.length) return [...all];
  }
  return units.map((u) => u.id);
}

/** The lowest echelon whose taburs are exactly those chosen, if there is one. */
export function exactEchelon(city: CityState, ids: readonly number[]): Echelon | null {
  const set = new Set(ids);
  const units = city.army.units.filter((u) => set.has(u.id));
  if (units.length === 0) return null;
  for (const e of chainOf(city, units[0])) {
    const under = taburs(city, e.id);
    if (under.length === units.length && under.every((u) => set.has(u.id))) return e;
  }
  return null;
}

/**
 * Orders taburs so that each echelon's stand together: ordus, then kolordus, then tugays by
 * where their taburs are on average along `key`, and taburs by their own place in it.
 */
export function orderByEchelon(
  city: CityState,
  ids: readonly number[],
  key: (id: number) => number,
): number[] {
  const set = new Set(ids);
  const units = city.army.units.filter((u) => set.has(u.id));
  const sum = new Map<number, { s: number; n: number }>();
  const chains = new Map<number, Echelon[]>();
  for (const u of units) {
    const chain = chainOf(city, u);
    chains.set(u.id, chain);
    const k = key(u.id);
    for (const e of chain) {
      const row = sum.get(e.id) ?? { s: 0, n: 0 };
      row.s += k;
      row.n++;
      sum.set(e.id, row);
    }
  }
  const mean = (id: number): number => {
    const row = sum.get(id)!;
    return row.s / row.n;
  };
  /** From the ordu down: [mean along the key, id] of each echelon, then the tabur's own. */
  const sortKey = (u: Unit): number[] => {
    const out: number[] = [];
    const chain = chains.get(u.id)!;
    for (let l = ECHELON_LEVELS.length - 1; l >= 0; l--) {
      const e = chain.find((c) => c.level === ECHELON_LEVELS[l]);
      out.push(e === undefined ? key(u.id) : mean(e.id), e?.id ?? -1);
    }
    out.push(key(u.id), u.id);
    return out;
  };
  const keys = new Map(units.map((u) => [u.id, sortKey(u)]));
  units.sort((p, q) => {
    const a = keys.get(p.id)!;
    const b = keys.get(q.id)!;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  return units.map((u) => u.id);
}
