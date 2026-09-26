import { describe, expect, it } from 'vitest';
import { proposeBuilding, slots } from '../src/sim/buildings';
import { DAYS_PER_MONTH } from '../src/sim/calendar';
import { WALL, WALL_GATE, type CityState } from '../src/sim/city';
import { simulateDays, updateStats } from '../src/sim/economy';
import { expansionOffer, growStreets, outerRadius, startExpansion, streetPlan } from '../src/sim/growth';
import { restoreGame, saveGame } from '../src/sim/save';
import { balance, def, newCity } from './helpers';

const count = (a: ArrayLike<number>, v: number): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === v) n++;
  return n;
};

/** Runs to the next month's first day, so the month closes once. */
function nextMonth(c: CityState): void {
  simulateDays(c, DAYS_PER_MONTH - (c.calendar.day % DAYS_PER_MONTH));
}

/** A city grown to a great one, rich enough for its walls. */
function greatCity(): CityState {
  const c = newCity();
  c.population = balance.levels[1].population + 200;
  c.treasury = 1e5;
  c.product = 1e4;
  updateStats(c);
  return c;
}

describe('streets as the city grows', () => {
  it('opens ring roads and lanes outside the walls as the people spill out', () => {
    const c = newCity();
    const roads = count(c.road, 1);
    const lots = c.lots.length;
    const plan = streetPlan(c);
    expect(plan.length).toBeGreaterThan(8);
    c.population = plan[3].threshold + 10;
    expect(growStreets(c)).toBe(true);
    expect(c.streetsLaid).toBe(4);
    expect(count(c.road, 1)).toBeGreaterThan(roads);
    expect(c.lots.length).toBeGreaterThan(lots);
    expect(c.notices.some((n) => n.text.includes('yeni sokaklar'))).toBe(true);
  });

  it('keeps the streets it opened when the people leave again', () => {
    const c = newCity();
    c.population = streetPlan(c)[1].threshold + 10;
    nextMonth(c);
    const laid = c.streetsLaid;
    expect(laid).toBeGreaterThan(0);
    c.population = 3000;
    nextMonth(c);
    expect(c.streetsLaid).toBe(laid);
  });
});

describe('new walls', () => {
  it('waits for a great city, and for the akçe and the stone', () => {
    const c = newCity();
    expect(expansionOffer(c)?.blockedBy).toBe('rank');
    expect(startExpansion(c)).toBe(false);
    const g = greatCity();
    g.product = 0;
    expect(expansionOffer(g)?.blockedBy).toBe('urun');
  });

  it('raises a ring of walls with gates, new streets and more room to build', () => {
    const c = greatCity();
    const before = { slots: slots(c).max, order: c.stats.order, roads: count(c.road, 1) };
    const first = def.expansions[0];
    const akce = c.treasury;
    expect(startExpansion(c)).toBe(true);
    expect(c.treasury).toBe(akce - first.cost);
    simulateDays(c, first.months * DAYS_PER_MONTH - 1);
    expect(c.rings).toHaveLength(1);
    simulateDays(c, 1);
    expect(c.rings).toHaveLength(2);
    expect(outerRadius(c)).toBe(first.radius);
    expect(count(c.wall, WALL)).toBeGreaterThan(200);
    const outer = c.gates.filter((g) => g.radius === first.radius);
    expect(outer.length).toBeGreaterThanOrEqual(def.gates.length);
    expect(outer.some((g) => g.name.includes('Dış'))).toBe(true);
    for (const g of outer) for (const i of g.tiles) expect(c.wall[i]).toBe(WALL_GATE);
    expect(count(c.road, 1)).toBeGreaterThan(before.roads);
    updateStats(c);
    expect(slots(c).max).toBe(before.slots + first.slots);
    expect(c.stats.orderParts.walls).toBe(first.order);
    // The caravanserai must now stand outside the new walls.
    const inside = proposeBuilding(c, 'kervansaray', c.grid.tileOf(28), c.grid.tileOf(0));
    expect(inside.problem === 'Sur dışına kurulur' || inside.tiles.some((t) => !t.ok)).toBe(true);
    expect(expansionOffer(c)?.stage).toBe(1);
  });

  it('comes back the same from a save', () => {
    const c = greatCity();
    startExpansion(c);
    simulateDays(c, def.expansions[0].months * DAYS_PER_MONTH + 40);
    c.population = streetPlan(c)[5].threshold + 10;
    nextMonth(c);
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(back.rings.map((r) => r.radius)).toEqual(c.rings.map((r) => r.radius));
    expect(back.streetsLaid).toBe(c.streetsLaid);
    expect(Array.from(back.wall)).toEqual(Array.from(c.wall));
    expect(back.gates.map((g) => g.name).sort()).toEqual(c.gates.map((g) => g.name).sort());
    expect(count(back.road, 1)).toBe(count(c.road, 1));
  });
});
