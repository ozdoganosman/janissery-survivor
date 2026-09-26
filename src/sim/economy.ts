import { clamp01 } from '../core/geom';
import { nextRandom } from '../core/rng';
import { buildingTouchesRoad, smokeMap } from './buildings';
import { dateOf, DAYS_PER_SECOND, formatDate } from './calendar';
import type { CityState } from './city';
import { roadDistance } from './distance';
import { distanceFactor, harvestAll, shearAll, sowAll, touchesRoad } from './fields';
import { DIRS4 } from './grid';
import { notify } from './notices';
import { closeBooks, consumeDay, esnafMonth, produceDay, prosperity } from './production';

export { notify };

/**
 * The living city, one day at a time: people, work, food, goods, houses and taxes.
 *
 * The loop the player steers:
 *   houses → people → workers and mouths
 *   fields → jobs and (at harvest) grain in the granary
 *   workshops and shops → goods → bread, cloth and tools → prosperity
 *   jobs, food and prosperity → housing demand → new houses on zoned land, or empty ones
 */

/** Most days simulated in one call; a long stall must not freeze the page catching up. */
const MAX_DAYS_PER_STEP = 30;

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
    if (date.month === city.balance.pasture.shearMonth) {
      const wool = shearAll(city);
      city.stats.lastShearing = wool;
      if (wool > 0)
        notify(city, `Kırkım yapıldı: ${wool.toLocaleString('tr-TR')} batman yün depoya girdi.`, 'good');
    }
    monthStart(city);
  }

  updateStats(city);
  const s = city.stats;
  // Tools make the same hands go further in the fields.
  const tended = s.staffing * (1 + city.balance.tools.yieldBonus * city.needs.alet);
  for (const f of city.fields.values()) {
    if (f.stage === 'ekili') {
      f.careSum += f.roadAccess ? tended : 0;
      f.careDays++;
    } else if (f.kind === 'mera') {
      f.careSum += f.roadAccess ? s.staffing : 0;
      f.careDays++;
    }
  }

  produceDay(city);
  const wasHungry = city.hungry;
  city.hungry = consumeDay(city);
  if (city.hungry && !wasHungry) {
    notify(city, 'Ambar boşaldı! Kıtlık başladı, halk şehri terk ediyor.', 'bad');
  }
  growOrShrink(city);
}

function monthStart(city: CityState): void {
  const b = city.balance;
  let households = 0;
  for (let i = 0; i < city.house.length; i++) households += city.house[i];
  const tax = households * b.tax.perHouseholdPerMonth;
  city.treasury += tax;
  const closed = closeBooks(city);
  city.stats.income = { tax, sales: closed.sales, market: closed.market };
  city.stats.incomeLastMonth = tax + closed.sales + closed.market;
  esnafMonth(city);

  // A prosperous town builds upward: while people still want to come, well-supplied
  // households add a floor. Nobody builds higher under a foundry's smoke.
  if (city.stats.demand > 0) {
    const smoke = smokeMap(city);
    const chance = b.growth.upgradeChancePerMonth * prosperity(city);
    let upgraded = 0;
    for (let i = 0; i < city.house.length; i++) {
      if (city.house[i] === 1 && smoke[i] === 0 && nextRandom(city) < chance) {
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
  buildingsRev: number;
  roadDist: Uint8Array;
  distRev: string;
}
const caches = new WeakMap<CityState, Cache>();

function cacheFor(city: CityState): Cache {
  let c = caches.get(city);
  if (c === undefined || c.roadsRev !== city.revision.roads) {
    c = {
      roadsRev: city.revision.roads,
      buildingsRev: -1,
      roadDist: roadDistance(city, city.balance.zoning.roadReach),
      distRev: '',
    };
    caches.set(city, c);
    for (const f of city.fields.values()) f.roadAccess = touchesRoad(city, f);
  }
  if (c.buildingsRev !== city.revision.buildings) {
    c.buildingsRev = city.revision.buildings;
    for (const b of city.buildings.values()) b.roadAccess = buildingTouchesRoad(city, b);
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
    const perTile = f.kind === 'mera' ? b.pasture.workersPerTile : b.fields.workersPerTile;
    const share = f.stage === 'nadas' ? b.fields.fallowWork : 1;
    f.jobs = f.roadAccess ? f.tiles.length * perTile * share : 0;
    fieldJobs += f.jobs;
  }
  let industryJobs = 0;
  for (const w of city.buildings.values()) {
    if (!w.roadAccess) continue;
    industryJobs += b.works[w.kind].workers;
    for (const shop of w.shops) if (shop.trade !== null) industryJobs += b.trades[shop.trade].workers;
  }
  let landmarkJobs = 0;
  for (const l of city.landmarks) landmarkJobs += b.people.landmarkJobs[l.kind] ?? 0;
  const otherJobs = population * b.people.serviceShare + landmarkJobs;

  // Food comes first: workers go to the fields and flocks, then to workshops and shops.
  const staffing = fieldJobs > 0 ? clamp01(labor / fieldJobs) : 1;
  const afterFields = Math.max(0, labor - fieldJobs);
  const industryStaffing = industryJobs > 0 ? clamp01(afterFields / industryJobs) : 1;
  const unemployed = Math.max(0, afterFields - industryJobs - otherJobs);
  const monthly = population * b.food.perPersonPerMonth;
  const food =
    city.granary + city.goods.un * (b.goods.un.food ?? 0) + city.goods.ekmek * (b.goods.ekmek.food ?? 0);
  const foodMonths = monthly > 0 ? food / monthly : 99;
  const wellBeing = prosperity(city);

  const dm = b.demand;
  const uRate = labor > 0 ? unemployed / labor : 0;
  const jobTerm = Math.max(-1, Math.min(1, (dm.targetUnemployment - uRate) / dm.unemploymentSpan));
  const foodTerm =
    city.hungry || food <= 0
      ? -1
      : Math.max(-1, Math.min(1, (foodMonths - dm.comfortMonths) / dm.monthsSpan));
  const demand = Math.max(
    -1,
    Math.min(1, dm.jobWeight * jobTerm + dm.foodWeight * foodTerm + b.needs.demandBonus * wellBeing),
  );

  Object.assign(city.stats, {
    population,
    households,
    labor,
    fieldJobs,
    industryJobs,
    otherJobs,
    unemployed,
    staffing,
    industryStaffing,
    prosperity: wellBeing,
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

/** How much a lot draws settlers: neighbours help, a foundry's smoke drives them off. */
function lotScore(city: CityState, i: number, smoke: Uint8Array): number {
  return neighbourHouses(city, i) - smoke[i] * 4;
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
      const smoke = smokeMap(city);
      let built = 0;
      for (let k = 0; k < n && lots.length > 0; k++) {
        // Towns grow outward from what is already there: of a few random lots, take the
        // one with the most neighbours and the cleanest air.
        let bestAt = Math.floor(nextRandom(city) * lots.length);
        let bestScore = lotScore(city, lots[bestAt], smoke);
        for (let t = 0; t < 5; t++) {
          const at = Math.floor(nextRandom(city) * lots.length);
          const score = lotScore(city, lots[at], smoke);
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

  const famine = city.hungry;
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
