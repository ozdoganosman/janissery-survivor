import { buildDay, builders, levelEffects } from './buildings';
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

/** The month's accounts, at today's figures: what the HUD shows and what the month pays. */
export function updateStats(city: CityState): void {
  const b = city.balance;
  const s = city.stats;
  let income = 0;
  let incomePct = 0;
  let product = b.product.base;
  let orderFromBuildings = 0;
  let growthRate = b.growth.base;
  for (const building of city.buildings.values()) {
    const e = levelEffects(city, building);
    if (e === null) continue;
    income += e.income ?? 0;
    incomePct += e.incomePct ?? 0;
    product += e.product ?? 0;
    orderFromBuildings += e.order ?? 0;
    growthRate += e.growth ?? 0;
  }
  const rate = b.tax.rates[city.policy.tax];
  const crowding = (-Math.max(0, city.population - b.order.crowdingFrom) / 1000) * b.order.crowdingPer1000;
  s.orderParts = { base: b.order.base, tax: rate.order, buildings: orderFromBuildings, crowding };
  s.order = Math.max(0, Math.min(100, b.order.base + rate.order + orderFromBuildings + crowding));
  const state = orderState(city);
  const incomeFactor =
    state === 'isyan' ? b.order.revoltIncome : state === 'huzursuz' ? b.order.unrestIncome : 1;
  const tax = city.population * rate.perHead * (1 + incomePct);
  s.income = {
    tax: Math.round(tax * incomeFactor),
    buildings: Math.round(income * incomeFactor),
    total: Math.round((tax + income) * incomeFactor),
  };
  s.product = Math.round(product * (state === 'isyan' ? b.order.revoltIncome : 1));
  if (state === 'isyan') s.growth = -city.population * b.order.revoltLoss;
  else if (state === 'huzursuz') s.growth = 0;
  else s.growth = city.population * growthRate * (state === 'huzurlu' ? b.order.calmGrowth : 1);
  s.works = builders(city).busy;
  let level = 0;
  b.levels.forEach((l, k) => {
    if (city.population >= l.population) level = k;
  });
  s.level = level;
}

/** The first day of a month: the month that ended pays, and the people come or go. */
function closeMonth(city: CityState): void {
  updateStats(city);
  const s = city.stats;
  city.treasury += s.income.total;
  city.product += s.product;
  city.population = Math.max(0, city.population + s.growth);
  s.last = { income: s.income.total, product: s.product, growth: s.growth };
  updateStats(city);
  announce(city);
  syncHouses(city);
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
