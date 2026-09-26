/**
 * Typed view of `data/balance.json`: every number that tunes the game. Code reads these;
 * it never hard-codes a cost, a rate or an effect.
 */

export type BuildingKind =
  'carsi' | 'ocak' | 'cami' | 'hamam' | 'kervansaray' | 'ambar' | 'kisla' | 'medrese' | 'darussifa';

/** In the order the build bar shows them. */
export const BUILDING_KINDS: readonly BuildingKind[] = [
  'carsi',
  'ocak',
  'kervansaray',
  'cami',
  'hamam',
  'ambar',
  'darussifa',
  'medrese',
  'kisla',
];

export type UnitKind = 'mizrakci' | 'okcu' | 'atli_okcu' | 'gulam';

/** In the order the barracks offers them. */
export const UNIT_KINDS: readonly UnitKind[] = ['mizrakci', 'okcu', 'atli_okcu', 'gulam'];

/**
 * One company (bölük) of soldiers as the barracks raises it. The fighting figures are kept
 * for the battles to come; the city only pays, feeds and quarters the men.
 */
export interface UnitDef {
  name: string;
  hint: string;
  /** Men in a company. */
  men: number;
  /** Akçe to raise and arm it. */
  cost: number;
  /** Months of drill before it is ready. */
  months: number;
  /** Akçe a month for the whole company. */
  pay: number;
  /** Level of barracks it needs. */
  barracks: number;
  horse: boolean;
  weapon: 'spear' | 'bow' | 'lance' | 'sword';
  melee: number;
  defense: number;
  missile: number;
  speed: number;
  morale: number;
  /** Room a man takes in the ranks, in tiles: along the rank, and from rank to rank. */
  file: number;
  rank: number;
  /** Marching pace on the map, in tiles a second at normal speed. */
  march: number;
}

export type FormationKind = 'saf' | 'kare' | 'kol';
export const FORMATION_KINDS: readonly FormationKind[] = ['saf', 'kare', 'kol'];

/** How a company stands in the field: how many men abreast. */
export interface FormationDef {
  name: string;
  hint: string;
  cols: number;
}

export type TaxRate = 'hafif' | 'orta' | 'agir';
export const TAX_RATES: readonly TaxRate[] = ['hafif', 'orta', 'agir'];

/** What one level of a building costs, how long it takes, and what it gives each month. */
export interface LevelDef {
  /** Akçe. */
  cost: number;
  /** The city's own product, as building material. */
  material: number;
  /** Months of work. */
  months: number;
  /** Akçe a month to keep it standing and staffed. */
  upkeep: number;
  /** People more the city can feed. */
  food?: number;
  /** Akçe a month. */
  income?: number;
  /** Share added to the household tax. */
  incomePct?: number;
  /** Product a month. */
  product?: number;
  /** Points of public order. */
  order?: number;
  /** Added to the monthly growth rate. */
  growth?: number;
  /** Soldiers the building can quarter: the barracks. */
  capacity?: number;
}

export interface BuildingDef {
  name: string;
  hint: string;
  /** Footprint in tiles, front along `w`. */
  w: number;
  d: number;
  /** Must stand on the city's resource site. */
  site?: boolean;
  /** Must stand outside the walls. */
  outside?: boolean;
  /** Most of this kind one city may have. */
  max: number;
  levels: LevelDef[];
}

export interface CityLevelDef {
  name: string;
  /** Population from which the city holds this rank. */
  population: number;
  /** Highest level a building may be raised to. */
  maxBuildingLevel: number;
  /** Building works that may run at once. */
  builders: number;
  /** People to a house: houses grow larger as the city does. */
  peoplePerHouse: number;
  /** Buildings the city may have in all, standing or going up. */
  slots: number;
}

export interface Balance {
  start: { treasury: number; product: number };
  tax: {
    start: TaxRate;
    rates: Record<TaxRate, { name: string; perHead: number; order: number }>;
  };
  order: {
    base: number;
    crowdingFrom: number;
    crowdingPer1000: number;
    /** Thresholds, highest first. */
    calm: number;
    unrest: number;
    revolt: number;
    calmGrowth: number;
    unrestIncome: number;
    revoltIncome: number;
    /** Share of the people who leave each month of revolt. */
    revoltLoss: number;
  };
  growth: { base: number };
  /**
   * How many the city can feed: a base, the fields round it (fewer as the suburbs spread
   * over them) and its granaries. Past that people go hungry and leave, and order suffers.
   */
  food: { base: number; perFieldTile: number; starve: number; orderPer10Pct: number };
  /** Order lost while the treasury is in debt and salaries go unpaid. */
  debt: { order: number };
  product: { base: number; price: number; sellLot: number };
  levels: CityLevelDef[];
  /**
   * A rank once reached is kept until the people fall this share below its threshold, so
   * a city hovering at the line does not gain and lose it month after month.
   */
  rankSlack: number;
  demolishRefund: number;
  maxSlope: number;
  army: {
    /** Share of the townspeople that may be under arms at once. */
    levy: number;
    formations: Record<FormationKind, FormationDef>;
    units: Record<UnitKind, UnitDef>;
  };
  buildings: Record<BuildingKind, BuildingDef>;
}
