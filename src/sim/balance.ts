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
 * One company (a tabur) of soldiers as the barracks raises it. The fighting figures are kept
 * for the battles to come; the city only pays, feeds and quarters the men.
 */
export interface UnitDef extends FighterDef {
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
}

/** What a fighting company is, on either side: its men, its arms and its worth in battle. */
export interface FighterDef {
  name: string;
  hint: string;
  men: number;
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

export type EnemyKind = 'mogol_okcu' | 'mogol_agir' | 'harezm_yaya';
export const ENEMY_KINDS: readonly EnemyKind[] = ['mogol_okcu', 'mogol_agir', 'harezm_yaya'];

export interface EnemyDef extends FighterDef {
  formation: FormationKind;
}

/** A kind of raid: who comes, from which way, and in what mix. */
export interface RaidKindDef {
  name: string;
  /** Who they are, for the notices: "Moğollar". */
  people: string;
  /** The bearing they come from, in degrees from east towards south: [least, most]. */
  from: [number, number];
  /** Taburs of each kind in every step of its size. */
  mix: Partial<Record<EnemyKind, number>>;
}

export type TestRaid = 'kucuk' | 'orta' | 'buyuk';
export const TEST_RAIDS: readonly TestRaid[] = ['kucuk', 'orta', 'buyuk'];

export interface WarDef {
  /** While a battle is on, the city's days pass at this share of their pace. */
  cityPace: number;
  enemies: Record<EnemyKind, EnemyDef>;
  raids: {
    /** Months from the start to the first raid, and between one and the next. */
    first: number;
    every: [number, number];
    /** Months of warning. */
    warn: number;
    /** Taburs in the first raid, and how much larger each one after is. */
    base: number;
    grow: number;
    kinds: RaidKindDef[];
    /** Taburs sent by the player's trial raids. */
    tests: Record<TestRaid, number>;
  };
  combat: {
    /** Men a man of missile 1 fells a second, and a man of melee 1, before the foe's defence. */
    missile: number;
    melee: number;
    /** Arrows striking the shields of footmen from the front do this share of their harm. */
    shield: number;
    /** Each point of defence divides losses by (1 + defense × this). */
    defense: number;
    /** Most men of a tabur fighting at once hand to hand. */
    front: number;
    /** A charge's blow, and how long it lasts (seconds). */
    charge: number;
    chargeSeconds: number;
    spearVsHorse: number;
    flank: number;
    rear: number;
    /** A routed tabur caught takes this many times its losses. */
    routed: number;
    range: { foot: number; horse: number };
    /** How near a foe must be to be seen, to be met by men at ease, and to make riders fall back. */
    aware: number;
    guard: number;
    kite: number;
    chargeSpeed: number;
    routSpeed: number;
    /** A tabur down to fewer men is broken for good. */
    destroyed: number;
  };
  morale: {
    base: number;
    perPoint: number;
    rout: number;
    loss: number;
    shot: number;
    flank: number;
    charged: number;
    nearbyRout: number;
    recover: number;
    rally: number;
  };
  /** Raiders at the walls: seconds they stay, share of the treasury and people lost a second
   * for every hundred of them. */
  pillage: { seconds: number; treasury: number; people: number };
  /** Akçe taken from every raider killed. */
  loot: number;
}

export type FormationKind = 'saf' | 'kare' | 'kol';
export const FORMATION_KINDS: readonly FormationKind[] = ['saf', 'kare', 'kol'];

/** The echelons taburs are gathered into, lowest first: a tugay, a kolordu, an ordu. */
export type EchelonLevel = 'tugay' | 'kolordu' | 'ordu';
export const ECHELON_LEVELS: readonly EchelonLevel[] = ['tugay', 'kolordu', 'ordu'];

export interface EchelonDef {
  name: string;
  /** Its name on its flag. */
  short: string;
  /** Most it holds of the level below: taburs for a tugay, tugays for a kolordu, and so on. */
  holds: number;
  hint: string;
}

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
    echelons: Record<EchelonLevel, EchelonDef>;
    formations: Record<FormationKind, FormationDef>;
    units: Record<UnitKind, UnitDef>;
    war: WarDef;
  };
  buildings: Record<BuildingKind, BuildingDef>;
}
