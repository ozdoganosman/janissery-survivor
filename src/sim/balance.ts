import type { LandmarkKind } from './city-def';

export type Crop = 'bugday' | 'arpa';
/** What a field is set to do at the next sowing. */
export type FieldPlan = Crop | 'nadas';

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
}

export const CROPS: readonly Crop[] = ['bugday', 'arpa'];
