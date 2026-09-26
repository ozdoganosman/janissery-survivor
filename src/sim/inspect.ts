import type { BuildingKind, FieldPlan, Good, Service, Trade } from './balance';
import { HOUSE_SERVICES } from './balance';
import { smokeMap, type BuildingStatus } from './buildings';
import type { CityState } from './city';
import { WALL, WALL_GATE } from './constants';
import { expectedYield, type FieldKind, type FieldStage } from './fields';
import { mainOutput } from './production';
import { coverage, missingFor, serves, supportedLevel } from './services';

export interface FieldInfo {
  id: number;
  kind: FieldKind;
  tiles: number;
  plan: FieldPlan;
  stage: FieldStage;
  /** Name of the crop growing or harvested this year, if any. */
  cropName: string | null;
  soil: number;
  fertility: number;
  roadAccess: boolean;
  /** Harvest (or, for a pasture, shearing) this field would give at today's care. */
  expected: number;
  lastYield: number;
  workers: number;
  /** Sheep on a pasture. */
  sheep: number;
}

export interface OutputInfo {
  good: Good;
  name: string;
  unit: string;
  /** Made last month, or this month so far if it is new. */
  made: number;
  /** At full staff and with input to spare. */
  capacity: number;
}

export interface ShopInfo {
  trade: Trade | null;
  name: string;
  status: BuildingStatus;
  output: OutputInfo | null;
}

export interface BuildingInfo {
  id: number;
  kind: BuildingKind;
  name: string;
  status: BuildingStatus;
  workers: number;
  jobs: number;
  /** What it takes in, as good names. */
  inputs: string[];
  output: OutputInfo | null;
  shops: ShopInfo[];
  /** What a public building gives, and how far. */
  service: Service | null;
  radius: number;
  upkeep: number;
  /** Founder, for a vakıf. */
  vakif: string | null;
}

export interface HouseInfo {
  level: number;
  /** The level its services and the city's prosperity can hold. */
  supported: number;
  /** What it lacks to rise one level, or to keep the one it has. */
  missing: string[];
}

export interface TileInfo {
  x: number;
  z: number;
  /** What the ground is, in the player's words. */
  land: string;
  /** What stands on it. */
  feature: string;
  height: number;
  /** 0..1, or null where farming makes no sense (water, inside the walls). */
  fertility: number | null;
  zoned: boolean;
  residents: number;
  field: FieldInfo | null;
  building: BuildingInfo | null;
  /** Name of the ore deposit under the tile. */
  ore: string | null;
  /** Under a foundry's smoke. */
  smoke: boolean;
  house: HouseInfo | null;
  /** The household services that reach this tile. */
  services: Service[];
}

export const LEVEL_NAMES = ['Boş', 'Ev', 'İki katlı ev', 'Konak'] as const;

export const SERVICE_NAMES: Record<Service, string> = {
  su: 'Su',
  ibadet: 'İbadet',
  temizlik: 'Temizlik',
  egitim: 'Eğitim',
  saglik: 'Sağlık',
  esnaf: 'Ahi teşkilatı',
  sulama: 'Sulama',
  asayis: 'Asayiş',
  imaret: 'İmaret',
};

export const STAGE_NAMES: Record<FieldStage, string> = {
  bos: 'Sürülmüş, ekim bekliyor',
  ekili: 'Ekili',
  hasat: 'Hasat edildi',
  nadas: 'Nadasta',
  otlak: 'Koyunlar otluyor',
};

export const STATUS_NAMES: Record<BuildingStatus, string> = {
  calisiyor: 'Çalışıyor',
  yolsuz: 'Yola bağlı değil',
  iscisiz: 'İşçi yok',
  girdisiz: 'Girdi bekliyor',
  dolu: 'Depo dolu, bekliyor',
  bos: 'Boş',
  maassiz: 'Maaş ödenemiyor',
};

function outputInfo(
  city: CityState,
  recipe: { out: Partial<Record<Good, number>> },
  made: number,
  last: number,
): OutputInfo | null {
  const good = mainOutput(recipe);
  if (good === null) return null;
  const g = city.balance.goods[good];
  return {
    good,
    name: g.name,
    unit: g.unit,
    made: Math.round(last > 0 ? last : made),
    capacity: recipe.out[good] ?? 0,
  };
}

function inspectBuilding(city: CityState, id: number): BuildingInfo | null {
  const b = city.buildings.get(id);
  if (b === undefined) return null;
  const bal = city.balance;
  const def = bal.works[b.kind];
  const staffing = b.roadAccess ? city.stats.industryStaffing : 0;
  let jobs = b.roadAccess ? def.workers : 0;
  const shops: ShopInfo[] = b.shops.map((s) => {
    if (s.trade === null) return { trade: null, name: 'Boş dükkân', status: 'bos', output: null };
    const t = bal.trades[s.trade];
    if (b.roadAccess) jobs += t.workers;
    return {
      trade: s.trade,
      name: t.name,
      status: s.status,
      output: outputInfo(city, t, s.made, s.madeLastMonth),
    };
  });
  // A public building's state follows the city's day to day; read it now, not at dawn.
  let status = b.status;
  if (def.service !== undefined) {
    status = serves(city, b)
      ? 'calisiyor'
      : !b.roadAccess
        ? 'yolsuz'
        : b.vakif === undefined && city.unpaid
          ? 'maassiz'
          : 'iscisiz';
  }
  return {
    id: b.id,
    kind: b.kind,
    name: b.name,
    status,
    workers: Math.round(jobs * staffing),
    jobs,
    inputs: Object.keys(def.in).map((s) => (s === 'zahire' ? 'Zahire' : bal.goods[s as Good].name)),
    output: outputInfo(city, def, b.made, b.madeLastMonth),
    shops,
    service: def.service ?? null,
    radius: def.radius ?? 0,
    upkeep: def.upkeep,
    vakif: b.vakif ?? null,
  };
}

/** Everything the info panel shows about one tile. */
export function inspectTile(city: CityState, x: number, z: number): TileInfo | null {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return null;
  const i = grid.index(x, z);
  const height = terrain.height[i];
  const slope = terrain.slope[i];
  const r = Math.hypot(grid.centre(x) - city.def.tepe.x, grid.centre(z) - city.def.tepe.z);
  const insideWalls = r < city.def.walls.radius;

  let land: string;
  if (terrain.water[i] === 1) land = city.def.stream.name;
  else if (r < city.def.tepe.footRadius) land = 'Alaeddin Tepesi';
  else if (insideWalls) land = 'Sur içi';
  else if (slope > 0.45) land = 'Yamaç';
  else if (height > 1.4) land = 'Tepelik';
  else land = 'Ova';

  const crops = city.balance.fields.crops;
  let field: FieldInfo | null = null;
  const fid = city.field[i];
  const f = fid >= 0 ? city.fields.get(fid) : undefined;
  if (f !== undefined) {
    field = {
      id: f.id,
      kind: f.kind,
      tiles: f.tiles.length,
      plan: f.plan,
      stage: f.stage,
      cropName: f.crop === null ? null : crops[f.crop].name,
      soil: f.soil,
      fertility: f.fertility,
      roadAccess: f.roadAccess,
      expected: Math.round(expectedYield(city, f, f.roadAccess ? city.stats.staffing : 0)),
      lastYield: f.lastYield,
      workers: Math.round(f.jobs * city.stats.staffing),
      sheep: f.kind === 'mera' ? Math.round(f.tiles.length * city.balance.pasture.sheepPerTile * 10) : 0,
    };
  }
  const building = city.building[i] >= 0 ? inspectBuilding(city, city.building[i]) : null;
  const oreIndex = terrain.ore[i];
  const ore = oreIndex > 0 ? (city.def.deposits[oreIndex - 1]?.name ?? 'Demir damarı') : null;

  const residents = city.house[i] * city.balance.people.perStorey;
  let feature = 'Boş';
  const s = city.structure[i];
  if (s >= 0) feature = city.landmarks[s]?.name ?? 'Yapı';
  else if (building !== null) feature = building.name;
  else if (city.wall[i] === WALL) feature = 'Sur';
  else if (city.wall[i] === WALL_GATE) {
    const gate = city.gates.find((g) => g.tiles.includes(i));
    feature = gate?.name ?? 'Kapı';
  } else if (city.road[i] === 1) feature = terrain.water[i] === 1 ? 'Köprü' : 'Yol';
  else if (city.house[i] > 0) feature = LEVEL_NAMES[Math.min(3, city.house[i])];
  else if (field !== null && field.kind === 'mera') feature = city.balance.pasture.name;
  else if (field !== null) feature = field.cropName !== null ? `${field.cropName} tarlası` : 'Tarla';
  else if (city.zone[i] === 1) feature = 'Konut arsası';
  else if (ore !== null) feature = ore;

  const farmable = terrain.water[i] === 0 && !insideWalls;
  return {
    x,
    z,
    land,
    feature,
    height,
    fertility: farmable ? terrain.fertility[i] : null,
    zoned: city.zone[i] === 1,
    residents,
    field,
    building,
    ore,
    smoke: smokeMap(city)[i] === 1,
    house: houseInfo(city, i),
    services: HOUSE_SERVICES.filter((sv) => coverage(city)[sv][i] === 1),
  };
}

function houseInfo(city: CityState, i: number): HouseInfo | null {
  const level = city.house[i];
  if (level === 0) return null;
  const supported = supportedLevel(city, i);
  // A house that cannot hold its level shows what it is losing; others what the next needs.
  const target = supported < level ? level : Math.min(3, level + 1);
  return { level, supported, missing: level === 3 && supported === 3 ? [] : missingFor(city, i, target) };
}
