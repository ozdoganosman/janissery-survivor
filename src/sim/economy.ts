import { clamp01 } from '../core/geom';
import { nextRandom } from '../core/rng';
import { dateOf, DAYS_PER_MONTH, DAYS_PER_SECOND, formatDate } from './calendar';
import type { CityState, NoticeKind } from './city';
import { roadDistance } from './distance';
import { distanceFactor, harvestAll, sowAll, touchesRoad } from './fields';
import { DIRS4 } from './grid';

/**
 * The living city, one day at a time: people, work, food, houses and taxes.
 *
 * The loop the player steers:
 *   houses → people → workers and mouths
 *   fields → jobs and (at harvest) grain in the granary
 *   jobs and grain → housing demand → new houses on zoned land, or empty ones
 */

/** Most days simulated in one call; a long stall must not freeze the page catching up. */
const MAX_DAYS_PER_STEP = 30;

export function notify(city: CityState, text: string, kind: NoticeKind = 'info'): void {
  city.notices.push({ text, kind, day: city.calendar.day });
  if (city.notices.length > 20) city.notices.shift();
}

/** Advances game time by a slice of real time, simulating every day that begins. */
export function stepTime(city: CityState, realSeconds: number): number {
  const cal = city.calendar;
  if (!Number.isFinite(realSeconds) || realSeconds <= 0) return 0;
  const total = cal.fraction + realSeconds * DAYS_PER_SECOND[cal.speed];
  const whole = Math.floor(total);
  cal.fraction = total - whole;
  const days = Math.min(whole, MAX_DAYS_PER_STEP);
  for (let k = 0; k < days; k++) {
    cal.day++;
    simulateDay(city);
  }
  return days;
}

/** Runs `days` whole days, regardless of speed. For tests and headless balance runs. */
export function simulateDays(city: CityState, days: number): void {
  for (let k = 0; k < days; k++) {
    city.calendar.day++;
    simulateDay(city);
  }
}

export function simulateDay(city: CityState): void {
  const date = dateOf(city.calendar);
  const fb = city.balance.fields;
  if (date.day === 1) {
    if (date.month === fb.harvestMonth) {
      const total = harvestAll(city);
      city.stats.lastHarvest = total;
      notify(city, `Hasat kaldırıldı: ${total.toLocaleString('tr-TR')} kile zahire ambara girdi.`, 'good');
    }
    if (date.month === fb.sowMonths[0]) {
      const sown = sowAll(city);
      if (sown > 0) notify(city, `Ekim zamanı: ${sown} tarla ekildi.`);
    }
    monthStart(city);
  }

  updateStats(city);
  const s = city.stats;
  for (const f of city.fields.values()) {
    if (f.stage === 'ekili') {
      f.careSum += f.roadAccess ? s.staffing : 0;
      f.careDays++;
    }
  }

  const eaten = (s.population * city.balance.food.perPersonPerMonth) / DAYS_PER_MONTH;
  const hadFood = city.granary > 0;
  city.granary = Math.max(0, city.granary - eaten);
  if (hadFood && city.granary === 0) {
    notify(city, 'Ambar boşaldı! Kıtlık başladı, halk şehri terk ediyor.', 'bad');
  }
  growOrShrink(city);
}

function monthStart(city: CityState): void {
  const b = city.balance;
  let households = 0;
  for (let i = 0; i < city.house.length; i++) households += city.house[i];
  const income = households * b.tax.perHouseholdPerMonth;
  city.treasury += income;
  city.stats.incomeLastMonth = income;

  // A prosperous town builds upward: some single-storey houses gain a floor.
  if (city.stats.demand > 0.3) {
    let upgraded = 0;
    for (let i = 0; i < city.house.length; i++) {
      if (city.house[i] === 1 && nextRandom(city) < b.growth.upgradeChancePerMonth) {
        city.house[i] = 2;
        upgraded++;
      }
    }
    if (upgraded > 0) city.revision.houses++;
  }

  if (city.granary > 0 && city.stats.foodMonths < 2) {
    const months = Math.max(1, Math.floor(city.stats.foodMonths));
    notify(city, `Ambarda yalnızca ${months} aylık zahire kaldı. Yeni tarlalar açın.`, 'bad');
  }
}

interface Cache {
  roadsRev: number;
  roadDist: Uint8Array;
  distRev: string;
}
const caches = new WeakMap<CityState, Cache>();

function cacheFor(city: CityState): Cache {
  let c = caches.get(city);
  if (c === undefined || c.roadsRev !== city.revision.roads) {
    c = {
      roadsRev: city.revision.roads,
      roadDist: roadDistance(city, city.balance.zoning.roadReach),
      distRev: '',
    };
    caches.set(city, c);
    for (const f of city.fields.values()) f.roadAccess = touchesRoad(city, f);
  }
  return c;
}

/** Recomputes the daily figures: population, jobs, staffing, demand, free lots. */
export function updateStats(city: CityState): void {
  const b = city.balance;
  const cache = cacheFor(city);
  const { grid } = city;

  let households = 0;
  let freeLots = 0;
  const houses: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    const h = city.house[i];
    if (h > 0) {
      households += h;
      houses.push(i);
    } else if (city.zone[i] === 1 && cache.roadDist[i] <= b.zoning.roadReach) {
      freeLots++;
    }
  }
  const population = households * b.people.perStorey;
  const labor = population * b.people.laborShare;

  // Farm distance only changes when houses or fields do; recompute it only then.
  const distKey = `${city.revision.houses}:${city.revision.fields}`;
  if (cache.distRev !== distKey) {
    cache.distRev = distKey;
    for (const f of city.fields.values()) {
      const cx = grid.centre(f.x0) + (f.w - 1) / 2;
      const cz = grid.centre(f.z0) + (f.d - 1) / 2;
      let best = Infinity;
      for (const i of houses) {
        const d = (grid.centre(i % grid.size) - cx) ** 2 + (grid.centre(Math.floor(i / grid.size)) - cz) ** 2;
        if (d < best) best = d;
      }
      f.distanceFactor = distanceFactor(city, Math.sqrt(best));
    }
  }

  let fieldJobs = 0;
  for (const f of city.fields.values()) {
    const share = f.stage === 'nadas' ? b.fields.fallowWork : 1;
    f.jobs = f.roadAccess ? f.tiles.length * b.fields.workersPerTile * share : 0;
    fieldJobs += f.jobs;
  }
  let landmarkJobs = 0;
  for (const l of city.landmarks) landmarkJobs += b.people.landmarkJobs[l.kind] ?? 0;
  const otherJobs = population * b.people.serviceShare + landmarkJobs;

  // Food comes first: workers go to the fields before anything else.
  const staffing = fieldJobs > 0 ? clamp01(labor / fieldJobs) : 1;
  const unemployed = Math.max(0, labor - fieldJobs - otherJobs);
  const monthly = population * b.food.perPersonPerMonth;
  const foodMonths = monthly > 0 ? city.granary / monthly : 99;

  const dm = b.demand;
  const uRate = labor > 0 ? unemployed / labor : 0;
  const jobTerm = Math.max(-1, Math.min(1, (dm.targetUnemployment - uRate) / dm.unemploymentSpan));
  const foodTerm =
    city.granary <= 0 ? -1 : Math.max(-1, Math.min(1, (foodMonths - dm.comfortMonths) / dm.monthsSpan));
  const demand = Math.max(-1, Math.min(1, dm.jobWeight * jobTerm + dm.foodWeight * foodTerm));

  Object.assign(city.stats, {
    population,
    households,
    labor,
    fieldJobs,
    otherJobs,
    unemployed,
    staffing,
    demand,
    foodMonths,
    freeLots,
  });
}

/** Houses a lot can get: zoned, empty, dry, and within reach of a road. */
function buildableLots(city: CityState): number[] {
  const { roadDist } = cacheFor(city);
  const reach = city.balance.zoning.roadReach;
  const out: number[] = [];
  for (let i = 0; i < city.zone.length; i++) {
    if (city.zone[i] === 1 && city.house[i] === 0 && roadDist[i] <= reach && city.terrain.water[i] === 0) {
      out.push(i);
    }
  }
  return out;
}

function neighbourHouses(city: CityState, i: number): number {
  const { grid } = city;
  const x = i % grid.size;
  const z = Math.floor(i / grid.size);
  let n = 0;
  for (const [dx, dz] of DIRS4) {
    if (grid.inBounds(x + dx, z + dz) && city.house[grid.index(x + dx, z + dz)] > 0) n++;
  }
  return n;
}

/** Whole events from a fractional daily rate: 2.3 means 2, plus one more 30% of days. */
function eventsToday(city: CityState, rate: number): number {
  const whole = Math.floor(rate);
  return whole + (nextRandom(city) < rate - whole ? 1 : 0);
}

function growOrShrink(city: CityState): void {
  const g = city.balance.growth;
  const d = city.stats.demand;

  if (d > g.buildThreshold) {
    const n = eventsToday(city, d * g.housesPerDay);
    if (n > 0) {
      const lots = buildableLots(city);
      let built = 0;
      for (let k = 0; k < n && lots.length > 0; k++) {
        // Towns grow outward from what is already there: of a few random lots, take the
        // one with the most neighbours.
        let bestAt = Math.floor(nextRandom(city) * lots.length);
        let bestScore = neighbourHouses(city, lots[bestAt]);
        for (let t = 0; t < 5; t++) {
          const at = Math.floor(nextRandom(city) * lots.length);
          const score = neighbourHouses(city, lots[at]);
          if (score > bestScore) {
            bestAt = at;
            bestScore = score;
          }
        }
        city.house[lots[bestAt]] = 1;
        lots[bestAt] = lots[lots.length - 1];
        lots.pop();
        built++;
      }
      if (built > 0) city.revision.houses++;
    }
    return;
  }

  const famine = city.granary <= 0;
  let rate = d < -g.abandonThreshold ? (-d - g.abandonThreshold) * g.abandonPerDay : 0;
  if (famine) rate += g.famineAbandonPerDay;
  const n = eventsToday(city, rate);
  if (n === 0) return;
  const houses: number[] = [];
  for (let i = 0; i < city.house.length; i++) if (city.house[i] > 0) houses.push(i);
  let left = 0;
  for (let k = 0; k < n && houses.length > 0; k++) {
    // The first to leave are those at the ragged edge of town.
    let worstAt = Math.floor(nextRandom(city) * houses.length);
    let worstScore = neighbourHouses(city, houses[worstAt]);
    for (let t = 0; t < 5; t++) {
      const at = Math.floor(nextRandom(city) * houses.length);
      const score = neighbourHouses(city, houses[at]);
      if (score < worstScore) {
        worstAt = at;
        worstScore = score;
      }
    }
    const i = houses[worstAt];
    // A two-storey house loses a floor's family before it stands empty.
    city.house[i] -= 1;
    if (city.house[i] === 0) {
      houses[worstAt] = houses[houses.length - 1];
      houses.pop();
    }
    left++;
  }
  if (left > 0) city.revision.houses++;
}

/** A one-line summary for logs and headless balance runs. */
export function describe(city: CityState): string {
  const s = city.stats;
  return (
    `${formatDate(dateOf(city.calendar))}: nüfus ${Math.round(s.population)}, ambar ${Math.round(city.granary)} ` +
    `(${s.foodMonths.toFixed(1)} ay), işsiz ${Math.round(s.unemployed)}, talep ${s.demand.toFixed(2)}, ` +
    `hazine ${Math.round(city.treasury)}`
  );
}
