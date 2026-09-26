import type { LevelDef } from './balance';
import { demolishRefund, kindName, upgradeOffer, type Building, type UpgradeOffer } from './buildings';
import { DAYS_PER_MONTH } from './calendar';
import { outerRadius, type CityState } from './city';
import { WALL, WALL_GATE } from './constants';

/** What the info panel says about a tile, and what it may do there. */
export interface TileInfo {
  title: string;
  rows: Array<[string, string]>;
  /** A building the panel can raise or pull down. */
  building?: BuildingSummary;
}

/**
 * Where a building stands on its way up:
 * - `ready`    it can be raised a level now;
 * - `waiting`  it could, but the akçe, the product or the builders are short;
 * - `locked`   the city must grow first;
 * - `building` work is under way;
 * - `top`      it is at its highest level.
 */
export type Readiness = 'ready' | 'waiting' | 'locked' | 'building' | 'top';

/** One level of a building, as the ladder in its panel shows it. */
export interface Rung {
  level: number;
  effect: string;
  price: string;
  months: number;
  /** `done` built; `work` being built; `next` the level to build next; `later` beyond that. */
  state: 'done' | 'work' | 'next' | 'later';
  /** The city rank this level waits for, if the city is not there yet. */
  need?: string;
}

/** Everything the panels and the map say about one building. */
export interface BuildingSummary {
  id: number;
  name: string;
  /** What kind of building it is, when its name does not say. */
  kind: string;
  level: number;
  levels: number;
  /** What it gives now, or null while it is first going up. */
  effect: string | null;
  work: { toLevel: number; monthsLeft: number; progress: number } | null;
  offer: UpgradeOffer | null;
  readiness: Readiness;
  rungs: Rung[];
  refund: number;
  /** Tile at its middle, to point the view at it. */
  tile: { x: number; z: number };
}

export function summarizeBuilding(city: CityState, b: Building): BuildingSummary {
  const levels = city.balance.buildings[b.kind].levels;
  const offer = upgradeOffer(city, b);
  const w = b.work;
  let readiness: Readiness;
  if (w !== null) readiness = 'building';
  else if (offer === null) readiness = 'top';
  else if (offer.blockedBy === undefined) readiness = 'ready';
  else readiness = offer.blockedBy === 'rank' ? 'locked' : 'waiting';
  const target = w?.toLevel ?? b.level;
  const maxLevel = city.balance.levels[city.stats.level].maxBuildingLevel;
  const rungs: Rung[] = levels.map((lv, k) => {
    const level = k + 1;
    const state: Rung['state'] =
      level <= b.level
        ? 'done'
        : level === target && w !== null
          ? 'work'
          : level === target + 1
            ? 'next'
            : 'later';
    const rung: Rung = {
      level,
      effect: effectText(city, lv),
      price: priceText(city, lv.cost, lv.material),
      months: lv.months,
      state,
    };
    if (level > maxLevel && state !== 'done' && state !== 'work') {
      rung.need = city.balance.levels.find((l) => l.maxBuildingLevel >= level)?.name ?? 'başka bir şehir';
    }
    return rung;
  });
  const kind = kindName(city, b.kind);
  return {
    id: b.id,
    name: b.name,
    kind: kind === b.name ? '' : kind,
    level: b.level,
    levels: levels.length,
    effect: b.level > 0 ? effectText(city, levels[b.level - 1]) : null,
    work:
      w === null
        ? null
        : {
            toLevel: w.toLevel,
            monthsLeft: Math.ceil(w.daysLeft / DAYS_PER_MONTH),
            progress: 1 - w.daysLeft / w.days,
          },
    offer,
    readiness,
    rungs,
    refund: demolishRefund(city, b),
    tile: { x: b.x0 + Math.floor(b.w / 2), z: b.z0 + Math.floor(b.d / 2) },
  };
}

const READINESS_ORDER: Record<Readiness, number> = { ready: 0, building: 1, waiting: 2, locked: 3, top: 4 };

/** Every building, those that can be raised now first. */
export function buildingRoster(city: CityState): BuildingSummary[] {
  return [...city.buildings.values()]
    .map((b) => summarizeBuilding(city, b))
    .sort(
      (a, b) =>
        READINESS_ORDER[a.readiness] - READINESS_ORDER[b.readiness] || a.name.localeCompare(b.name, 'tr'),
    );
}

const LANDMARK_NOTES: Record<string, string> = {
  cami: 'Sultanın camisi, şehrin kalbi',
  kumbet: 'Selçuklu sultanlarının türbesi',
  kosk: 'Sultanın köşkü',
  mescit: 'Mahalle mescidi',
  hamam: 'Mahalle hamamı',
};

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');
const pct = (n: number): string => `%${(n * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;

/** One level's gifts, in a line: "+50 akçe · +6 huzur". */
export function effectText(city: CityState, lv: LevelDef): string {
  const parts: string[] = [];
  if (lv.income !== undefined) parts.push(`+${fmt(lv.income)} akçe`);
  if (lv.incomePct !== undefined) parts.push(`vergi +${pct(lv.incomePct)}`);
  if (lv.product !== undefined) parts.push(`+${fmt(lv.product)} ${city.def.resource.good.toLowerCase()}`);
  if (lv.order !== undefined) parts.push(`+${fmt(lv.order)} huzur`);
  if (lv.growth !== undefined) parts.push(`büyüme +${pct(lv.growth)}`);
  return parts.join(' · ');
}

/** What a price comes to: "1.200 akçe + 40 taş". */
export function priceText(city: CityState, cost: number, material: number): string {
  const good = city.def.resource.good.toLowerCase();
  return material > 0 ? `${fmt(cost)} akçe + ${fmt(material)} ${good}` : `${fmt(cost)} akçe`;
}

export function inspectTile(city: CityState, x: number, z: number): TileInfo | null {
  const { grid, terrain, def } = city;
  if (!grid.inBounds(x, z)) return null;
  const i = grid.index(x, z);
  const bid = city.building[i];
  if (bid >= 0) {
    const b = city.buildings.get(bid);
    if (b !== undefined) {
      const summary = summarizeBuilding(city, b);
      const rows: Array<[string, string]> = [];
      if (summary.kind !== '') rows.push(['Yapı', summary.kind]);
      rows.push(['Seviye', b.level === 0 ? 'inşaatta' : `${b.level} / ${summary.levels}`]);
      if (summary.effect !== null) rows.push(['Getirisi', summary.effect]);
      if (summary.work !== null) {
        rows.push(['İnşaat', `${summary.work.toLevel}. seviye · ${summary.work.monthsLeft} ay kaldı`]);
      }
      return { title: b.name, rows, building: summary };
    }
  }
  const s = city.structure[i];
  if (s >= 0) {
    const l = city.landmarks[s];
    return { title: l.name, rows: [['', LANDMARK_NOTES[l.kind] ?? '']] };
  }
  if (city.wall[i] === WALL_GATE) {
    const gate = city.gates.find((g) => g.tiles.includes(i));
    return { title: gate?.name ?? 'Kapı', rows: [['', 'Şehrin kapılarından biri']] };
  }
  if (city.wall[i] === WALL) return { title: 'Sur', rows: [['', 'Şehri çeviren taş sur']] };
  if (terrain.water[i] === 1) {
    return { title: city.road[i] === 1 ? 'Köprü' : def.stream.name, rows: [] };
  }
  const inside = Math.hypot(grid.centre(x) - def.tepe.x, grid.centre(z) - def.tepe.z) < outerRadius(city);
  if (city.house[i] > 0) {
    const h = city.house[i];
    return {
      title: h === 3 ? 'Konak' : h === 2 ? 'İki katlı ev' : 'Ev',
      rows: [['Mahalle', inside ? 'Sur içi' : 'Varoş']],
    };
  }
  if (city.road[i] === 1) return { title: 'Sokak', rows: [] };
  const rows: Array<[string, string]> = [];
  const site = terrain.site[i];
  let title = inside ? 'Boş arsa' : 'Boş arazi';
  if (site > 0) {
    title = def.resource.sites[site - 1].name;
    rows.push(['', `${def.resource.building} buraya kurulur`]);
  } else if (city.field[i] >= 0) {
    const f = city.fields.get(city.field[i]);
    title = f?.kind === 'mera' ? 'Mera' : 'Tarla';
    rows.push(['', 'Üstüne yapı kurulursa tarla kalkar']);
  }
  if (terrain.slope[i] > city.balance.maxSlope) rows.push(['', 'Yapı için çok dik']);
  return { title, rows };
}
