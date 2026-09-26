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
export type BuildingKind =
  | 'degirmen'
  | 'boyahane'
  | 'maden'
  | 'dokumhane'
  | 'arasta'
  | 'cesme'
  | 'mescit'
  | 'hamam'
  | 'medrese'
  | 'darussifa'
  | 'zaviye'
  | 'dolap'
  | 'subasi'
  | 'imaret';
/** Where a building sits in the build menu. */
export type BuildingCategory = 'imalat' | 'carsi' | 'hizmet' | 'tarim';
/**
 * What a public building spreads over its radius. The first five are what houses need;
 * `esnaf` makes bazaars more productive and `sulama` waters fields.
 */
export type Service =
  'su' | 'ibadet' | 'temizlik' | 'egitim' | 'saglik' | 'esnaf' | 'sulama' | 'asayis' | 'imaret';
export type TaxRate = 'hafif' | 'orta' | 'agir';
/** The crafts that fill bazaar shops. */
export type Trade = 'firinci' | 'dokumaci' | 'demirci';

/** Monthly amounts at full staff. */
export interface Recipe {
  in: Partial<Record<Stock, number>>;
  out: Partial<Record<Good, number>>;
}

export interface WorkDef extends Recipe {
  name: string;
  category: BuildingCategory;
  /** Dirhems a month, paid by the treasury unless a vakıf keeps it. */
  upkeep: number;
  /** For a public building: what it provides, and how far. */
  service?: Service;
  radius?: number;
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
  tax: {
    /** Dirhems a household pays each month at each rate. */
    rates: Record<TaxRate, number>;
    /** Housing demand added (or taken) by each rate. */
    demand: Record<TaxRate, number>;
    start: TaxRate;
    /** A konak household pays this much more. */
    konakFactor: number;
    /** Share of the month's income sent to the sultan. */
    tributeShare: number;
  };
  housing: {
    /** Prosperity a konak needs, on top of its services. */
    konakProsperity: number;
    /** Monthly chance that a house its services no longer support loses a floor. */
    downgradeChancePerMonth: number;
  };
  /** Services the authored landmarks give, with their radius. */
  landmarkServices: Partial<Record<LandmarkKind, Partial<Record<Service, number>>>>;
  narh: {
    /** How much the price ceiling takes off bread and cloth. */
    priceCut: number;
    prosperityBonus: number;
    /** Shops of unmet demand a craft needs before a new shop opens under narh. */
    openGap: number;
  };
  vakif: {
    /** Share of the building's cost the vakıf takes from the treasury every month, forever. */
    share: number;
    peoplePerFounder: number;
    konaksPerFounder: number;
    founders: string[];
  };
  events: EventsBalance;
  defense: {
    startGarrison: number;
    payPerSoldier: number;
    garrisonStep: number;
    /** Largest share of the people who can be under arms. */
    maxGarrisonShare: number;
    startWalls: number;
    wallDecayPerYear: number;
    /** Dirhems to bring ruined walls back to full strength. */
    repairCostFull: number;
    threatFromYear: number;
    threatPerYear: number;
    /** Soldiers needed to hold the walls against the Mongols, at no threat and per unit of it. */
    requiredBase: number;
    requiredPerThreat: number;
  };
  serviceEffects: {
    /** Extra output an ahi lodge's bazaars get from the same input. */
    esnafOutputBonus: number;
    irrigationYieldBonus: number;
    /** Staffing below which a public building gives no service. */
    minStaffing: number;
  };
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
  'zaviye',
  'cesme',
  'mescit',
  'hamam',
  'medrese',
  'darussifa',
  'subasi',
  'imaret',
  'dolap',
];
/** Services houses need, in the order they are asked for. */
export const HOUSE_SERVICES: readonly Service[] = ['su', 'ibadet', 'temizlik', 'egitim', 'saglik'];
export const SERVICES: readonly Service[] = [...HOUSE_SERVICES, 'esnaf', 'sulama', 'asayis', 'imaret'];
export const TAX_RATES: readonly TaxRate[] = ['hafif', 'orta', 'agir'];
export const TRADES: readonly Trade[] = ['firinci', 'dokumaci', 'demirci'];

/** Tuning of the city's events; every chance is per day. */
export interface EventsBalance {
  enabled: boolean;
  /** Quiet days at the start of a game before anything can happen. */
  graceDays: number;
  yangin: {
    chancePerDay: number;
    summerFactor: number;
    /** Chance a burning house sets a neighbour alight each day. */
    spread: number;
    burnDays: number;
    ashDays: number;
    /** Spread multipliers near a fountain and near a subaşı. */
    waterFactor: number;
    guardFactor: number;
    sendCost: number;
    sendFactor: number;
    breakRadius: number;
    cooldownDays: number;
  };
  salgin: {
    chancePerDay: number;
    /** Population at which the city counts as crowded. */
    crowdPop: number;
    minDays: number;
    maxDays: number;
    /** Share of households lost each day at full severity. */
    lossPerDay: number;
    /** Chance a house under a hospital's or a bath's care is spared. */
    healthFactor: number;
    quarantineFactor: number;
    physicianCost: number;
    physicianFactor: number;
    demandPenalty: number;
    cooldownDays: number;
  };
  kitlik: {
    belowMonths: number;
    sultanMonths: number;
    sultanTributeExtra: number;
    sultanDays: number;
    grainPrice: number;
    buyMonths: number;
    cooldownDays: number;
  };
  deprem: {
    chancePerDay: number;
    houseShare: number;
    wallDamage: number;
    repairPerHouse: number;
    cooldownDays: number;
  };
  mevlana: {
    fromYear: number;
    chancePerDay: number;
    demandBonus: number;
    prosperityBonus: number;
    listenDays: number;
    honourCost: number;
  };
  ahi: {
    chancePerDay: number;
    heavyTaxMonths: number;
    lowProsperity: number;
    lowMonths: number;
    dealCost: number;
    garrisonNeeded: number;
    prosperityPenalty: number;
    penaltyDays: number;
    shopsClosed: number;
    cooldownDays: number;
  };
  kervan: {
    chancePerDay: number;
    priceFactor: number;
    sellShare: number;
    silkCost: number;
    silkBonus: number;
    silkDays: number;
    toll: number;
    cooldownDays: number;
  };
  elci: {
    fromYear: number;
    chancePerDay: number;
    giftCost: number;
    giftThreat: number;
    stallThreat: number;
    expelThreat: number;
    cooldownDays: number;
  };
  kosedag: {
    year: number;
    month: number;
    tributeShare: number;
    failTributeShare: number;
    graceYears: number;
    laterShare: number;
    plunderShare: number;
    burnRadius: number;
    fires: number;
  };
}
