import type { LandmarkKind } from './city-def';

export type Crop = 'bugday' | 'arpa';
/** What a field is set to do at the next sowing. A pasture's plan is always `mera`. */
export type FieldPlan = Crop | 'nadas' | 'mera';
/** What the Tarla tool lays out: a field of a crop, or a pasture. */
export type FieldChoice = Crop | 'mera';

/** Goods kept in the city's single depot. Grain is not among them: it lives in the granary. */
export type Good = 'un' | 'ekmek' | 'yun' | 'iplik' | 'kumas' | 'cevher' | 'demir' | 'alet';
/** Anything a recipe can take or give: a good, or grain from the granary. */
export type Stock = Good | 'zahire';
export type BuildingKind = 'degirmen' | 'boyahane' | 'maden' | 'dokumhane' | 'arasta';
/** The crafts that fill bazaar shops. */
export type Trade = 'firinci' | 'dokumaci' | 'demirci';

/** Monthly amounts at full staff. */
export interface Recipe {
  in: Partial<Record<Stock, number>>;
  out: Partial<Record<Good, number>>;
}

export interface WorkDef extends Recipe {
  name: string;
  /** Footprint in tiles, [w, d], before turning. */
  size: number[];
  cost: number;
  workers: number;
  /** Where it may stand: next to water, or on an ore deposit. */
  site?: 'water' | 'ore';
  /** For water sites: how many tiles away the water may be. */
  waterReach?: number;
  maxSlope: number;
  /** Radius in tiles of the smoke that keeps nearby houses from improving. */
  smoke?: number;
  /** Shop slots, for a bazaar. */
  shops?: number;
  hint: string;
}

export interface TradeDef extends Recipe {
  name: string;
  workers: number;
}

/**
 * Every tuning number of the economy, loaded from `data/balance.json`. Nothing here is
 * hard-coded in the rules, so balancing is a data edit and a headless test run.
 */
export interface Balance {
  people: {
    /** Residents per storey of a house (one household). */
    perStorey: number;
    /** Share of residents who can work. */
    laborShare: number;
    /** Non-farm jobs (bakers, porters, servants...) per resident. */
    serviceShare: number;
    landmarkJobs: Partial<Record<LandmarkKind, number>>;
  };
  food: { perPersonPerMonth: number; startGranary: number };
  tax: { perHouseholdPerMonth: number };
  zoning: { maxSlope: number; roadReach: number };
  fields: {
    costPerTile: number;
    minSide: number;
    maxSide: number;
    maxSlope: number;
    workersPerTile: number;
    /** Share of the usual work a fallow field still needs (ploughing, weeding). */
    fallowWork: number;
    /** Months (0-based) in which a field can be sown. */
    sowMonths: number[];
    harvestMonth: number;
    soil: { drain: number; regain: number; floor: number };
    /** Farmers walk out from the houses; distant fields lose some of their yield. */
    distance: { free: number; range: number; maxPenalty: number };
    crops: Record<Crop, { name: string; yield: number; fertilityWeight: number }>;
    /** Field tiles the city already farms on day one. */
    startTiles: number;
  };
  growth: {
    housesPerDay: number;
    abandonPerDay: number;
    famineAbandonPerDay: number;
    upgradeChancePerMonth: number;
    buildThreshold: number;
    abandonThreshold: number;
  };
  demand: {
    jobWeight: number;
    foodWeight: number;
    targetUnemployment: number;
    unemploymentSpan: number;
    comfortMonths: number;
    monthsSpan: number;
  };
  goods: Record<
    Good,
    {
      name: string;
      unit: string;
      /** Dirhems per unit: what shops pay the state for it, and what people pay shops. */
      price: number;
      /** Workshops stop making it once the depot holds this much. */
      cap: number;
      /** Kile of grain one unit replaces as food, if it is food. */
      food?: number;
    }
  >;
  works: Record<BuildingKind, WorkDef>;
  trades: Record<Trade, TradeDef>;
  needs: {
    /** Share of their food people want to buy as bread rather than cook from grain. */
    breadShare: number;
    kumasPerHouseholdPerMonth: number;
    /** How much each need counts towards prosperity. */
    weights: { ekmek: number; kumas: number };
    /** Share of every bazaar sale that goes to the treasury. */
    marketTax: number;
    /** Housing demand added by full prosperity. */
    demandBonus: number;
    /** Days over which need satisfaction is averaged. */
    smoothingDays: number;
  };
  tools: { perTilePerMonth: number; yieldBonus: number };
  pasture: {
    name: string;
    costPerTile: number;
    maxSlope: number;
    workersPerTile: number;
    /** Wool per tile from a flock that has grazed a whole year. */
    woolPerTile: number;
    shearMonth: number;
    /** Sheep drawn per tile. */
    sheepPerTile: number;
  };
  esnaf: {
    /** Months a shop may go without its input before it closes. */
    closeAfterMonths: number;
    /** Stock of input, in months of a shop's use, needed before a new shop opens. */
    openMinInputMonths: number;
    /** A stock this many months of a shop's use opens one even without last month's surplus. */
    openStockMonths: number;
    /** Days short of input within a month that count the month as starved. */
    starvedDays: number;
  };
}

export const CROPS: readonly Crop[] = ['bugday', 'arpa'];
export const GOODS: readonly Good[] = ['un', 'ekmek', 'yun', 'iplik', 'kumas', 'cevher', 'demir', 'alet'];
export const BUILDING_KINDS: readonly BuildingKind[] = [
  'degirmen',
  'boyahane',
  'maden',
  'dokumhane',
  'arasta',
];
export const TRADES: readonly Trade[] = ['firinci', 'dokumaci', 'demirci'];
