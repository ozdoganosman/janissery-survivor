import { armyCapacity, armyDay, armyMen, armyPay, disband } from './army';
import { buildDay, builders, levelEffects } from './buildings';
import { expansionDay, growStreets, wallGifts } from './growth';
import { DAYS_PER_MONTH, DAYS_PER_SECOND } from './calendar';
import type { CityState } from './city';
import { syncHouses } from './housing';
import { notify } from './notices';

export { notify };

/**
 * The city's month, which is its turn: taxes come in, the quarries and the bazaars pay,
 * the people grow or leave. Days in between only move the building works along.
 *
 *   people × tax rate ─┐
 *   bazaars, caravans ─┴→ akçe ─┐
 *   quarry ──────────────→ product ─┴→ buildings and their levels → order, growth, income
 *   order ← tax, buildings, crowding: it scales the income and the growth
 */

/** Most days simulated in one call; a long stall must not freeze the page catching up. */
const MAX_DAYS_PER_STEP = 30;

export type OrderState = 'huzurlu' | 'sakin' | 'huzursuz' | 'isyan';

export const ORDER_NAMES: Record<OrderState, string> = {
  huzurlu: 'Huzurlu',
  sakin: 'Sakin',
  huzursuz: 'Huzursuz',
  isyan: 'İsyan',
};

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
  buildDay(city);
  armyDay(city);
  expansionDay(city);
  if (city.calendar.day % DAYS_PER_MONTH === 0) closeMonth(city);
  updateStats(city);
}

export function orderState(city: CityState, order = city.stats.order): OrderState {
  const o = city.balance.order;
  if (order >= o.calm) return 'huzurlu';
  if (order >= o.unrest) return 'sakin';
  if (order >= o.revolt) return 'huzursuz';
  return 'isyan';
}

/** People the city can feed: the base, the fields still farmed round it, and its granaries. */
export function foodCapacity(city: CityState): number {
  const f = city.balance.food;
  let tiles = 0;
  for (const field of city.fields.values()) tiles += field.tiles.length;
  let granaries = 0;
  for (const b of city.buildings.values()) granaries += levelEffects(city, b)?.food ?? 0;
  return f.base + tiles * f.perFieldTile + granaries;
}

/** The month's accounts, at today's figures: what the HUD shows and what the month pays. */
export function updateStats(city: CityState): void {
  const b = city.balance;
  const s = city.stats;
  let income = 0;
  let incomePct = 0;
  let upkeep = 0;
  let product = b.product.base;
  let orderFromBuildings = 0;
  let growthRate = b.growth.base;
  for (const building of city.buildings.values()) {
    const e = levelEffects(city, building);
    if (e === null) continue;
    income += e.income ?? 0;
    incomePct += e.incomePct ?? 0;
    upkeep += e.upkeep;
    product += e.product ?? 0;
    orderFromBuildings += e.order ?? 0;
    growthRate += e.growth ?? 0;
  }
  s.food = foodCapacity(city);
  const soldiers = armyMen(city);
  // Soldiers eat the city's bread like everyone else.
  const fullness = (city.population + soldiers) / Math.max(1, s.food);
  const rate = b.tax.rates[city.policy.tax];
  const crowding = (-Math.max(0, city.population - b.order.crowdingFrom) / 1000) * b.order.crowdingPer1000;
  // Hunger costs order for every tenth the city is over what it can feed.
  const hunger = fullness > 1 ? ((fullness - 1) / 0.1) * b.food.orderPer10Pct : 0;
  const debt = city.treasury < 0 ? b.debt.order : 0;
  const walls = wallGifts(city).order;
  s.orderParts = {
    base: b.order.base,
    tax: rate.order,
    buildings: orderFromBuildings,
    walls,
    crowding,
    food: hunger,
    debt,
  };
  s.order = Math.max(
    0,
    Math.min(100, b.order.base + rate.order + orderFromBuildings + walls + crowding + hunger + debt),
  );
  const state = orderState(city);
  const incomeFactor =
    state === 'isyan' ? b.order.revoltIncome : state === 'huzursuz' ? b.order.unrestIncome : 1;
  const tax = city.population * rate.perHead * (1 + incomePct);
  const pay = armyPay(city);
  s.income = {
    tax: Math.round(tax * incomeFactor),
    buildings: Math.round(income * incomeFactor),
    upkeep: Math.round(upkeep),
    army: pay,
    total: Math.round((tax + income) * incomeFactor - upkeep - pay),
  };
  s.product = Math.round(product * (state === 'isyan' ? b.order.revoltIncome : 1));
  if (fullness > 1) {
    // More mouths than bread: people go hungry and leave.
    s.growth = -city.population * Math.min(1, fullness - 1) * b.food.starve;
  } else if (state === 'isyan') {
    s.growth = -city.population * b.order.revoltLoss;
  } else if (state === 'huzursuz') {
    s.growth = 0;
  } else {
    // Growth slows as the city nears what its fields and granaries can feed.
    const room = 1 - fullness;
    s.growth =
      city.population * growthRate * (state === 'huzurlu' ? b.order.calmGrowth : 1) * Math.min(1, room * 4);
  }
  s.works = builders(city).busy;
  s.army = { men: soldiers, ready: armyMen(city, true), room: armyCapacity(city) };
  s.level = cityRank(city, s.level);
}

/**
 * The city's rank: the highest its people reach. A rank it `held` is kept until the people
 * fall well below it, so a famine that trims the city by a few families does not cost it.
 */
export function cityRank(city: CityState, held: number): number {
  const { levels, rankSlack } = city.balance;
  // The garrison is part of the city it holds.
  const people = city.population + armyMen(city);
  let level = 0;
  levels.forEach((l, k) => {
    if (people >= l.population) level = k;
  });
  for (let k = Math.min(held, levels.length - 1); k > level; k--) {
    if (people >= levels[k].population * (1 - rankSlack)) return k;
  }
  return level;
}

/** Population below which the city loses the rank it holds; 0 for the lowest rank. */
export function rankFloor(city: CityState): number {
  const level = city.stats.level;
  return level === 0 ? 0 : Math.ceil(city.balance.levels[level].population * (1 - city.balance.rankSlack));
}

/** The first day of a month: the month that ended pays, and the people come or go. */
function closeMonth(city: CityState): void {
  updateStats(city);
  const s = city.stats;
  city.treasury += s.income.total;
  city.product += s.product;
  // An army left unpaid melts away, the dearest company first.
  if (city.treasury < 0) desert(city);
  city.population = Math.max(0, city.population + s.growth);
  s.last = { income: s.income.total, product: s.product, growth: s.growth };
  updateStats(city);
  announce(city);
  // The people have come or gone: streets open where the suburbs reach, houses follow.
  if (!growStreets(city)) syncHouses(city);
}

/**
 * A month without pay: the dearest company goes home, and as many more, dearest first, as
 * it takes for the month's accounts to stop running into debt.
 */
function desert(city: CityState): void {
  const units = city.balance.army.units;
  let deficit = -city.stats.income.total;
  do {
    let worst: { id: number; pay: number } | null = null;
    for (const u of city.army.units) {
      const pay = units[u.kind].pay;
      if (worst === null || pay > worst.pay) worst = { id: u.id, pay };
    }
    if (worst === null) return;
    const u = city.army.units.find((x) => x.id === worst.id)!;
    disband(
      city,
      u.id,
      `${units[u.kind].name} bölüğü ulufesini alamadı ve dağıldı; ${u.men} kişi evine döndü.`,
    );
    deficit -= worst.pay;
  } while (deficit > 0);
}

/** Tells the player when the city's rank or mood has changed since it was last told. */
function announce(city: CityState): void {
  const told = city.announced;
  const level = city.stats.level;
  const levels = city.balance.levels;
  if (level > told.level) notify(city, `${city.def.name} artık bir ${levels[level].name}!`, 'good', 'rank');
  else if (level < told.level)
    notify(city, `${city.def.name} ${levels[level].name} düzeyine geriledi.`, 'bad', 'rank');
  const order = orderState(city);
  if (order !== told.order) {
    if (order === 'isyan') notify(city, 'Şehirde isyan var: gelir düştü, halk göçüyor.', 'bad', 'order');
    else if (order === 'huzursuz')
      notify(city, 'Halk huzursuz: nüfus artmıyor, gelir düştü.', 'bad', 'order');
    else if (order === 'huzurlu') notify(city, 'Şehir huzurlu; nüfus hızla artıyor.', 'good', 'order');
    else notify(city, 'Şehir yatıştı.', 'info', 'order');
  }
  city.announced = { level, order };
}

/** Sells a lot of the city's product in the bazaar. False when there is not enough. */
export function sellProduct(city: CityState): boolean {
  const { sellLot, price } = city.balance.product;
  if (city.product < sellLot) return false;
  city.product -= sellLot;
  city.treasury += sellLot * price;
  return true;
}
