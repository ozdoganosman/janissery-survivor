import type { BuildingDef, BuildingKind, LevelDef } from './balance';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
import { WALL_NONE } from './constants';
import { removeField } from './countryside';
import { syncHouses } from './housing';
import { notify } from './notices';
import { insideWalls } from './walls';
import { disbandAll } from './army';

/**
 * The buildings the player puts up: anywhere in the city that is free, each with three
 * levels. A new building or a new level costs akçe and usually some of the city's own
 * product, and takes months of work; until the work is done a building keeps giving what
 * its old level gave.
 */

export interface Work {
  /** Level the building will have when the work is done. */
  toLevel: number;
  days: number;
  daysLeft: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  name: string;
  /** Tile rectangle. */
  x0: number;
  z0: number;
  w: number;
  d: number;
  tiles: number[];
  /** Side the front faces: 0 south (+z), 1 east (+x), 2 north (-z), 3 west (-x). */
  facing: number;
  /** 0 while it is first going up. */
  level: number;
  work: Work | null;
  /** Akçe spent on it so far, for the refund when it is pulled down. */
  spent: number;
}

export interface BuildingProposal {
  kind: BuildingKind;
  x0: number;
  z0: number;
  w: number;
  d: number;
  facing: number;
  tiles: Array<{ x: number; z: number; ok: boolean; reason?: string }>;
  cost: number;
  material: number;
  months: number;
  /** Houses that would make way for it. */
  clears: number;
  problem?: string;
}

/** What raising a building one level would take, or why it cannot be raised now. */
export interface UpgradeOffer {
  toLevel: number;
  cost: number;
  material: number;
  months: number;
  problem?: string;
  /** What stands in the way, when something does. */
  blockedBy?: Blocker;
}

/**
 * - `work`     the building is already being worked on;
 * - `rank`     the city must grow before this level can be built;
 * - `akce`     not enough akçe;
 * - `urun`     not enough of the city's product;
 * - `builders` every builder is busy elsewhere.
 */
export type Blocker = 'work' | 'rank' | 'akce' | 'urun' | 'builders';

/** Unit steps out of each side, in `facing` order. */
export const FACING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** Display name of a kind in this city: the resource building takes the city's own name. */
export function kindName(city: CityState, kind: BuildingKind): string {
  return kind === 'ocak' ? city.def.resource.building : city.balance.buildings[kind].name;
}

/** What one level gives; nothing at level 0. */
export function levelEffects(city: CityState, b: Building): LevelDef | null {
  return b.level >= 1 ? city.balance.buildings[b.kind].levels[b.level - 1] : null;
}

/** Buildings standing or going up, and how many the city's rank allows in all. */
export function slots(city: CityState): { used: number; max: number } {
  let walls = 0;
  for (const e of city.def.expansions.slice(0, city.expansion.built)) walls += e.slots;
  return { used: city.buildings.size, max: city.balance.levels[city.stats.level].slots + walls };
}

/** How many of a kind the city has, and the most it may have. */
export function kindCount(city: CityState, kind: BuildingKind): { count: number; max: number } {
  let count = 0;
  for (const b of city.buildings.values()) if (b.kind === kind) count++;
  return { count, max: city.balance.buildings[kind].max };
}

/** Works under way, and how many the city's rank allows at once. */
export function builders(city: CityState): { busy: number; max: number } {
  let busy = 0;
  for (const b of city.buildings.values()) if (b.work !== null) busy++;
  return { busy, max: city.balance.levels[city.stats.level].builders };
}

function tileReason(city: CityState, x: number, z: number): string | undefined {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return 'Harita dışı';
  const i = grid.index(x, z);
  if (terrain.water[i] === 1) return 'Su';
  if (city.wall[i] !== WALL_NONE) return 'Sur';
  if (city.structure[i] >= 0) return 'Anıt';
  if (city.building[i] >= 0) return 'Yapı';
  if (city.road[i] === 1) return 'Sokak';
  if (terrain.slope[i] > city.balance.maxSlope) return 'Çok dik';
  return undefined;
}

/** Footprint of a building of `def` centred on a tile and facing `facing`. */
function footprint(
  def: BuildingDef,
  cx: number,
  cz: number,
  facing: number,
): [number, number, number, number] {
  const across = facing % 2 === 0;
  const w = across ? def.w : def.d;
  const d = across ? def.d : def.w;
  return [cx - Math.floor(w / 2), cz - Math.floor(d / 2), w, d];
}

/**
 * Faces the street it touches most; with no street beside it, faces the tepe, the heart
 * of the city.
 */
function chooseFacing(city: CityState, def: BuildingDef, cx: number, cz: number): number {
  const { grid } = city;
  const road = (x: number, z: number): number =>
    grid.inBounds(x, z) && city.road[grid.index(x, z)] === 1 ? 1 : 0;
  let best = 0;
  let bestScore = -1;
  const toX = city.def.tepe.x - grid.centre(cx);
  const toZ = city.def.tepe.z - grid.centre(cz);
  for (let f = 0; f < 4; f++) {
    const [x0, z0, w, d] = footprint(def, cx, cz, f);
    let contact = 0;
    if (f === 0) for (let x = x0; x < x0 + w; x++) contact += road(x, z0 + d);
    if (f === 2) for (let x = x0; x < x0 + w; x++) contact += road(x, z0 - 1);
    if (f === 1) for (let z = z0; z < z0 + d; z++) contact += road(x0 + w, z);
    if (f === 3) for (let z = z0; z < z0 + d; z++) contact += road(x0 - 1, z);
    const [fx, fz] = FACING_DIRS[f];
    const toward = (fx * toX + fz * toZ) / (Math.hypot(toX, toZ) || 1);
    const score = contact + toward * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

/**
 * Where a building of `kind` would stand if placed at the tile, what it would cost and
 * what stops it. `free` skips the cost and the builders, for the city's starting set.
 */
export function proposeBuilding(
  city: CityState,
  kind: BuildingKind,
  cx: number,
  cz: number,
  free = false,
): BuildingProposal {
  const def = city.balance.buildings[kind];
  const { grid, terrain } = city;
  const facing = chooseFacing(city, def, cx, cz);
  const [x0, z0, w, d] = footprint(def, cx, cz, facing);
  const first = def.levels[0];
  const tiles: BuildingProposal['tiles'] = [];
  let problem: string | undefined;
  let onSite = 0;
  let inside = 0;
  let clears = 0;
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      const reason = tileReason(city, x, z);
      tiles.push(reason === undefined ? { x, z, ok: true } : { x, z, ok: false, reason });
      problem ??= reason;
      if (!grid.inBounds(x, z)) continue;
      const i = grid.index(x, z);
      if (terrain.site[i] > 0) onSite++;
      if (city.house[i] > 0) clears++;
      if (insideWalls(city, grid.centre(x), grid.centre(z), 1)) inside++;
    }
  }
  const p: BuildingProposal = {
    kind,
    x0,
    z0,
    w,
    d,
    facing,
    tiles,
    cost: first.cost,
    material: first.material,
    months: first.months,
    clears,
  };
  if (problem === undefined && def.site === true && onSite * 2 < w * d) {
    problem = `${kindName(city, kind)} yalnız ocak yerine kurulur`;
  }
  if (problem === undefined && def.outside === true && inside > 0) problem = 'Sur dışına kurulur';
  if (problem === undefined && !free) problem = startBlock(city, kind)?.text;
  if (problem !== undefined) p.problem = problem;
  return p;
}

/** Why a new building of a kind cannot be begun anywhere just now. */
export interface StartBlock {
  by: 'kind' | 'slots' | 'akce' | 'urun' | 'builders';
  text: string;
}

/**
 * What stops a new building of `kind` being begun, wherever it would stand: the most of its
 * kind, the city's room for buildings, the akçe and the product, and free builders. Null
 * when only the spot is left to choose.
 */
export function startBlock(city: CityState, kind: BuildingKind): StartBlock | null {
  const first = city.balance.buildings[kind].levels[0];
  const k = kindCount(city, kind);
  if (k.count >= k.max) return { by: 'kind', text: `En çok ${k.max} ${kindName(city, kind)} kurulabilir` };
  const s = slots(city);
  if (s.used >= s.max) {
    return { by: 'slots', text: `Yapı hakkı dolu (${s.used}/${s.max}); şehir büyüyünce artar` };
  }
  if (city.treasury < first.cost) return { by: 'akce', text: 'Akçe yetmiyor' };
  if (city.product < first.material) return { by: 'urun', text: `${city.def.resource.good} yetmiyor` };
  const b = builders(city);
  if (b.busy >= b.max) return { by: 'builders', text: `Bütün ustalar işte (${b.busy}/${b.max})` };
  return null;
}

/** Pays for the building and sets the work going. Null when the proposal has a problem. */
export function buildBuilding(city: CityState, p: BuildingProposal, name?: string): Building | null {
  if (p.problem !== undefined) return null;
  city.treasury -= p.cost;
  city.product -= p.material;
  const b = place(city, p, name ?? kindName(city, p.kind));
  const days = p.months * DAYS_PER_MONTH;
  b.work = { toLevel: 1, days, daysLeft: days };
  b.spent = p.cost;
  return b;
}

function place(city: CityState, p: BuildingProposal, name: string): Building {
  const { grid } = city;
  const id = city.nextBuildingId++;
  const tiles = p.tiles.map((t) => grid.index(t.x, t.z));
  const b: Building = {
    id,
    kind: p.kind,
    name,
    x0: p.x0,
    z0: p.z0,
    w: p.w,
    d: p.d,
    tiles,
    facing: p.facing,
    level: 0,
    work: null,
    spent: 0,
  };
  for (const i of tiles) {
    city.building[i] = id;
    city.house[i] = 0;
    if (city.field[i] >= 0) removeField(city, city.field[i]);
  }
  city.buildings.set(id, b);
  city.revision.buildings++;
  // The families living there move to the next free lots.
  syncHouses(city);
  return b;
}

/** What the next level would take, or null at the top. */
export function upgradeOffer(city: CityState, b: Building): UpgradeOffer | null {
  const def = city.balance.buildings[b.kind];
  const target = (b.work?.toLevel ?? b.level) + 1;
  if (target > def.levels.length) return null;
  const lv = def.levels[target - 1];
  const offer: UpgradeOffer = { toLevel: target, cost: lv.cost, material: lv.material, months: lv.months };
  const rank = city.balance.levels[city.stats.level];
  const block = (by: Blocker, problem: string): UpgradeOffer => ({ ...offer, blockedBy: by, problem });
  if (b.work !== null) return block('work', 'İnşaat sürüyor');
  if (target > rank.maxBuildingLevel) {
    const needed = city.balance.levels.find((l) => l.maxBuildingLevel >= target);
    return block('rank', needed === undefined ? 'Bu şehirde olmaz' : `Şehir ${needed.name} olunca`);
  }
  if (city.treasury < lv.cost) return block('akce', 'Akçe yetmiyor');
  if (city.product < lv.material) return block('urun', `${city.def.resource.good} yetmiyor`);
  const w = builders(city);
  if (w.busy >= w.max) return block('builders', `Bütün ustalar işte (${w.busy}/${w.max})`);
  return offer;
}

/** Starts raising a building one level. False, changing nothing, when it cannot be done. */
export function upgradeBuilding(city: CityState, id: number): boolean {
  const b = city.buildings.get(id);
  if (b === undefined) return false;
  const offer = upgradeOffer(city, b);
  if (offer === null || offer.problem !== undefined) return false;
  city.treasury -= offer.cost;
  city.product -= offer.material;
  b.spent += offer.cost;
  const days = offer.months * DAYS_PER_MONTH;
  b.work = { toLevel: offer.toLevel, days, daysLeft: days };
  city.revision.buildings++;
  return true;
}

/** Akçe that pulling a building down gives back. */
export function demolishRefund(city: CityState, b: Building): number {
  return Math.round(b.spent * city.balance.demolishRefund);
}

/** Pulls a building down. Returns the refund, or -1 when there is no such building. */
export function demolishBuilding(city: CityState, id: number): number {
  const b = city.buildings.get(id);
  if (b === undefined) return -1;
  const refund = demolishRefund(city, b);
  city.treasury += refund;
  if (b.kind === 'kisla') disbandAll(city);
  for (const i of b.tiles) city.building[i] = -1;
  city.buildings.delete(id);
  city.revision.buildings++;
  syncHouses(city);
  notify(city, `${b.name} yıkıldı; ${refund.toLocaleString('tr-TR')} akçe geri geldi.`);
  return refund;
}

/** A day of building work; completed works raise their building a level. */
export function buildDay(city: CityState): void {
  for (const b of city.buildings.values()) {
    const w = b.work;
    if (w === null) continue;
    w.daysLeft--;
    if (w.daysLeft > 0) continue;
    b.level = w.toLevel;
    b.work = null;
    city.revision.buildings++;
    notify(
      city,
      b.level === 1 ? `${b.name} tamamlandı.` : `${b.name} ${b.level}. seviyeye çıktı.`,
      'good',
      'works',
    );
  }
}

/** The buildings the city already has: placed as near their spot as the rules allow, already standing. */
export function placeStartBuildings(city: CityState): void {
  const { grid } = city;
  for (const s of city.def.buildings) {
    const cx = grid.tileOf(s.near[0]);
    const cz = grid.tileOf(s.near[1]);
    let found: BuildingProposal | null = null;
    for (let r = 0; r <= 12 && found === null; r++) {
      for (let dz = -r; dz <= r && found === null; dz++) {
        for (let dx = -r; dx <= r && found === null; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const p = proposeBuilding(city, s.kind, cx + dx, cz + dz, true);
          if (p.problem === undefined) found = p;
        }
      }
    }
    if (found === null) continue;
    const b = place(city, found, s.name);
    const levels = city.balance.buildings[s.kind].levels;
    b.level = Math.min(s.level, levels.length);
    b.spent = levels.slice(0, b.level).reduce((sum, l) => sum + l.cost, 0);
  }
}
