import type { Good, Recipe, Stock, Trade } from './balance';
import { GOODS, TRADES } from './balance';
import type { BuildingStatus } from './buildings';
import { emptyShop } from './buildings';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
import { notify } from './notices';

/**
 * Workshops, bazaars and what people buy there.
 *
 *   state workshops: input from the depot (or grain from the granary) → goods to the depot
 *   bazaar shops:    buy their input from the state → sell what they make to the people
 *   people:          eat bread before grain, buy cloth; fields wear out tools
 */

export interface Flows {
  made: Record<Stock, number>;
  used: Record<Stock, number>;
  /** Dirhems the state took selling its goods to shops. */
  sales: number;
  /** Dirhems of bazaar tax. */
  market: number;
}

export function emptyFlows(): Flows {
  const zero = (): Record<Stock, number> => ({
    zahire: 0,
    un: 0,
    ekmek: 0,
    yun: 0,
    iplik: 0,
    kumas: 0,
    cevher: 0,
    demir: 0,
    alet: 0,
  });
  return { made: zero(), used: zero(), sales: 0, market: 0 };
}

export function emptyGoods(): Record<Good, number> {
  const out = {} as Record<Good, number>;
  for (const g of GOODS) out[g] = 0;
  return out;
}

export function stockOf(city: CityState, s: Stock): number {
  return s === 'zahire' ? city.granary : city.goods[s];
}

function take(city: CityState, s: Stock, amount: number): void {
  if (s === 'zahire') city.granary = Math.max(0, city.granary - amount);
  else city.goods[s] = Math.max(0, city.goods[s] - amount);
  city.flows.current.used[s] += amount;
}

const entries = <K extends string>(r: Partial<Record<K, number>>): Array<[K, number]> =>
  Object.entries(r) as Array<[K, number]>;

/** The first good a recipe makes: what its output is counted in. */
export function mainOutput(r: Pick<Recipe, 'out'>): Good | null {
  return (Object.keys(r.out)[0] as Good | undefined) ?? null;
}

/**
 * One day of a recipe at the given staffing. `sell` charges the inputs to the buyer: the
 * treasury is paid for them. Returns the main output made and how the day went.
 */
function runRecipe(
  city: CityState,
  r: Recipe,
  staffing: number,
  sell: boolean,
): { made: number; status: BuildingStatus } {
  if (staffing <= 0) return { made: 0, status: 'iscisiz' };
  const goods = city.balance.goods;
  for (const [g] of entries(r.out)) {
    if (city.goods[g] >= goods[g].cap) return { made: 0, status: 'dolu' };
  }
  let share = staffing / DAYS_PER_MONTH;
  let short = false;
  for (const [s, amount] of entries(r.in)) {
    const have = stockOf(city, s);
    if (have < amount * share) {
      share = have / amount;
      short = true;
    }
  }
  if (share <= 1e-9) return { made: 0, status: 'girdisiz' };
  for (const [s, amount] of entries(r.in)) {
    take(city, s, amount * share);
    if (sell && s !== 'zahire') {
      const value = amount * share * goods[s].price;
      city.treasury += value;
      city.flows.current.sales += value;
    }
  }
  let made = 0;
  const main = mainOutput(r);
  for (const [g, amount] of entries(r.out)) {
    city.goods[g] += amount * share;
    city.flows.current.made[g] += amount * share;
    if (g === main) made = amount * share;
  }
  return { made, status: short ? 'girdisiz' : 'calisiyor' };
}

/** Workshops first, so what the mill grinds today the bakers can bake today. */
export function produceDay(city: CityState): void {
  const staffing = city.stats.industryStaffing;
  for (const b of city.buildings.values()) {
    if (b.kind === 'arasta') continue;
    if (!b.roadAccess) {
      b.status = 'yolsuz';
      continue;
    }
    const r = runRecipe(city, city.balance.works[b.kind], staffing, false);
    b.status = r.status;
    b.made += r.made;
  }
  for (const b of city.buildings.values()) {
    if (b.kind !== 'arasta') continue;
    for (const shop of b.shops) {
      if (shop.trade === null) {
        shop.status = 'bos';
        continue;
      }
      if (!b.roadAccess) {
        shop.status = 'yolsuz';
        continue;
      }
      const r = runRecipe(city, city.balance.trades[shop.trade], staffing, true);
      shop.status = r.status;
      shop.made += r.made;
      if (r.status === 'girdisiz') shop.shortDays++;
    }
  }
}

/** What the people want each month, in units of each craft's product. */
export function monthlyWants(city: CityState): Record<Trade, number> {
  const b = city.balance;
  const s = city.stats;
  let fieldTiles = 0;
  for (const f of city.fields.values())
    if (f.kind === 'tarla' && f.plan !== 'nadas') fieldTiles += f.tiles.length;
  return {
    firinci: (s.population * b.food.perPersonPerMonth * b.needs.breadShare) / (b.goods.ekmek.food ?? 1),
    dokumaci: s.households * b.needs.kumasPerHouseholdPerMonth,
    demirci: fieldTiles * b.tools.perTilePerMonth,
  };
}

/**
 * The people's day at the market: bread first, then grain from the granary, then flour if
 * nothing else is left; cloth; and tools for the fields being worked. Returns whether
 * anyone went hungry.
 */
export function consumeDay(city: CityState): boolean {
  const b = city.balance;
  const s = city.stats;
  const g = city.goods;
  const flows = city.flows.current;
  const breadFood = b.goods.ekmek.food ?? 1;
  const flourFood = b.goods.un.food ?? 1;
  const tax = b.needs.marketTax;

  const need = (s.population * b.food.perPersonPerMonth) / DAYS_PER_MONTH;
  const wantBread = (need * b.needs.breadShare) / breadFood;
  const bread = Math.min(g.ekmek, wantBread);
  let left = need - bread * breadFood;
  const grain = Math.min(city.granary, left);
  city.granary -= grain;
  left -= grain;
  // With the granary empty, people buy what bread is left and bake the depot's flour.
  const moreBread = Math.min(g.ekmek - bread, Math.max(0, left) / breadFood);
  left -= moreBread * breadFood;
  const flour = Math.min(g.un, Math.max(0, left) / flourFood);
  left -= flour * flourFood;
  g.ekmek -= bread + moreBread;
  g.un -= flour;
  flows.used.zahire += grain;
  flows.used.ekmek += bread + moreBread;
  flows.used.un += flour;

  const wantCloth = (s.households * b.needs.kumasPerHouseholdPerMonth) / DAYS_PER_MONTH;
  const cloth = Math.min(g.kumas, wantCloth);
  g.kumas -= cloth;
  flows.used.kumas += cloth;

  let tilesSown = 0;
  for (const f of city.fields.values()) if (f.stage === 'ekili') tilesSown += f.tiles.length;
  const wantTools = (tilesSown * b.tools.perTilePerMonth) / DAYS_PER_MONTH;
  const tools = Math.min(g.alet, wantTools);
  g.alet -= tools;
  flows.used.alet += tools;

  const market = ((bread + moreBread) * b.goods.ekmek.price + cloth * b.goods.kumas.price) * tax;
  city.treasury += market;
  flows.market += market;

  const k = 1 / Math.max(1, b.needs.smoothingDays);
  const ease = (from: number, to: number): number => from + (to - from) * k;
  city.needs.ekmek = ease(city.needs.ekmek, wantBread > 0 ? bread / wantBread : 1);
  city.needs.kumas = ease(city.needs.kumas, wantCloth > 0 ? cloth / wantCloth : 1);
  // Tools only count in the growing season; the last season's supply carries over.
  if (wantTools > 0) city.needs.alet = ease(city.needs.alet, tools / wantTools);
  return left > need * 0.01;
}

/** Prosperity, 0..1: how well bread and cloth needs are met. */
export function prosperity(city: CityState): number {
  const w = city.balance.needs.weights;
  return (w.ekmek * city.needs.ekmek + w.kumas * city.needs.kumas) / (w.ekmek + w.kumas);
}

/** A first guess at how well needs are met, so a new city does not start from nothing. */
export function estimateNeeds(city: CityState): void {
  const wants = monthlyWants(city);
  const open = tradeCapacity(city);
  const met = (t: Trade): number => (wants[t] > 0 ? Math.min(1, (open[t] * perShop(city, t)) / wants[t]) : 1);
  city.needs.ekmek = met('firinci');
  city.needs.kumas = met('dokumaci');
  city.needs.alet = met('demirci');
}

/** Open shops of each craft. */
function tradeCapacity(city: CityState): Record<Trade, number> {
  const out: Record<Trade, number> = { firinci: 0, dokumaci: 0, demirci: 0 };
  for (const b of city.buildings.values()) for (const s of b.shops) if (s.trade !== null) out[s.trade]++;
  return out;
}

function perShop(city: CityState, t: Trade): number {
  const r = city.balance.trades[t];
  const main = mainOutput(r);
  return main === null ? 0 : (r.out[main] ?? 0);
}

/**
 * The bazaar's month. Every bazaar makes at most one change: a shop that went without
 * its input too long closes; a craft with more shops than the city needs loses one; an
 * empty shop is taken by the craft whose goods are most wanted and whose input is in the
 * depot.
 */
export function esnafMonth(city: CityState): void {
  const e = city.balance.esnaf;
  const trades = city.balance.trades;
  for (const b of city.buildings.values()) {
    b.madeLastMonth = b.made;
    b.made = 0;
    for (const shop of b.shops) {
      shop.madeLastMonth = shop.made;
      shop.made = 0;
      shop.starvedMonths =
        shop.trade !== null && shop.shortDays >= e.starvedDays ? shop.starvedMonths + 1 : 0;
      shop.shortDays = 0;
    }
  }
  const wants = monthlyWants(city);
  const open = tradeCapacity(city);
  const bazaars = [...city.buildings.values()].filter((b) => b.kind === 'arasta' && b.roadAccess);
  let changed = false;
  // Input promised this month to shops opened a moment ago, so two bazaars do not both
  // count on the same spare flour.
  const promised: Partial<Record<Stock, number>> = {};
  for (const b of bazaars) {
    const starved = b.shops.findIndex((s) => s.trade !== null && s.starvedMonths >= e.closeAfterMonths);
    if (starved >= 0) {
      const t = b.shops[starved].trade as Trade;
      open[t]--;
      b.shops[starved] = emptyShop();
      changed = true;
      notify(city, `${b.name}: ${trades[t].name} ${inputName(city, t)} bulamadı, dükkânı kapattı.`, 'bad');
      continue;
    }
    const surplus = b.shops.findIndex((s) => {
      if (s.trade === null) return false;
      return (open[s.trade] - 1) * perShop(city, s.trade) >= wants[s.trade];
    });
    if (surplus >= 0) {
      const t = b.shops[surplus].trade as Trade;
      open[t]--;
      b.shops[surplus] = emptyShop();
      changed = true;
      notify(city, `${b.name}: müşterisi azalan bir ${trades[t].name.toLocaleLowerCase('tr-TR')} kapandı.`);
      continue;
    }
    const empty = b.shops.find((s) => s.trade === null);
    if (empty === undefined) continue;
    let best: Trade | null = null;
    let bestGap = 0.5;
    for (const t of TRADES) {
      const per = perShop(city, t);
      if (per <= 0) continue;
      const gap = (wants[t] - open[t] * per) / per;
      const stocked = entries(trades[t].in).every(([s, amount]) =>
        spareInput(city, s, amount, promised[s] ?? 0),
      );
      if (stocked && gap > bestGap) {
        best = t;
        bestGap = gap;
      }
    }
    if (best === null) continue;
    empty.trade = best;
    for (const [s, amount] of entries(trades[best].in)) promised[s] = (promised[s] ?? 0) + amount;
    empty.status = 'calisiyor';
    open[best]++;
    changed = true;
    notify(
      city,
      `${b.name}: yeni bir ${trades[best].name.toLocaleLowerCase('tr-TR')} dükkânı açıldı.`,
      'good',
    );
  }
  if (changed) city.revision.buildings++;
}

/**
 * Whether the depot can feed one more shop that uses `amount` of `s` a month: some must be
 * in store, and either last month left a surplus of it or a large stock has piled up.
 * Stock alone is not enough, or a mill's working float would tempt a baker it cannot feed.
 */
function spareInput(city: CityState, s: Stock, amount: number, promised: number): boolean {
  const e = city.balance.esnaf;
  const stock = stockOf(city, s) - promised;
  const surplus = city.flows.last.made[s] - city.flows.last.used[s] - promised;
  return (
    stock >= amount * e.openMinInputMonths &&
    (surplus >= amount * e.openMinInputMonths || stock >= amount * e.openStockMonths)
  );
}

function inputName(city: CityState, t: Trade): string {
  const s = Object.keys(city.balance.trades[t].in)[0] as Good | undefined;
  return s === undefined ? 'girdi' : city.balance.goods[s].name.toLocaleLowerCase('tr-TR');
}

/** Monthly rollover of the depot's books; returns the month just closed. */
export function closeBooks(city: CityState): Flows {
  const closed = city.flows.current;
  city.flows.last = closed;
  city.flows.current = emptyFlows();
  return closed;
}
