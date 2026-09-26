import type { LevelDef } from './balance';
import { demolishRefund, kindName, upgradeOffer, type UpgradeOffer } from './buildings';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
import { WALL, WALL_GATE } from './constants';

/** What the info panel says about a tile, and what it may do there. */
export interface TileInfo {
  title: string;
  rows: Array<[string, string]>;
  /** A building the panel can raise or pull down. */
  building?: {
    id: number;
    level: number;
    /** Share of the running work done, or null when nothing is being built. */
    progress: number | null;
    offer: UpgradeOffer | null;
    refund: number;
  };
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
      const levels = city.balance.buildings[b.kind].levels;
      const rows: Array<[string, string]> = [];
      const kind = kindName(city, b.kind);
      if (kind !== b.name) rows.push(['Yapı', kind]);
      rows.push(['Seviye', b.level === 0 ? 'inşaatta' : `${b.level} / ${levels.length}`]);
      if (b.level > 0) rows.push(['Getirisi', effectText(city, levels[b.level - 1])]);
      const w = b.work;
      if (w !== null) {
        const months = Math.ceil(w.daysLeft / DAYS_PER_MONTH);
        rows.push(['İnşaat', `${w.toLevel}. seviye · ${months} ay kaldı`]);
        rows.push(['Olunca', effectText(city, levels[w.toLevel - 1])]);
      }
      const offer = upgradeOffer(city, b);
      if (offer !== null && w === null)
        rows.push([`${offer.toLevel}. seviye`, effectText(city, levels[offer.toLevel - 1])]);
      return {
        title: b.name,
        rows,
        building: {
          id: b.id,
          level: b.level,
          progress: w === null ? null : 1 - w.daysLeft / w.days,
          offer,
          refund: demolishRefund(city, b),
        },
      };
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
  const inside = Math.hypot(grid.centre(x) - def.tepe.x, grid.centre(z) - def.tepe.z) < def.walls.radius;
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
