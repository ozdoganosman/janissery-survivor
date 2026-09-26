import { describe, expect, it } from 'vitest';
import { buildBuilding, proposeBuilding } from '../src/sim/buildings';
import { dateOf } from '../src/sim/calendar';
import { createCity, type CityState } from '../src/sim/city';
import { simulateDays, stepTime } from '../src/sim/economy';
import {
  defenceStrength,
  maxGarrison,
  modifierSum,
  repairWalls,
  resolveEvent,
  setGarrison,
  soldiersNeeded,
  triggerEvent,
  wallRepairCost,
} from '../src/sim/events';
import { coverage } from '../src/sim/services';
import { applyZone, proposeZone } from '../src/sim/zoning';
import { balance, def, fullBalance, newCity, openRoad } from './helpers';

/** The day number of the first of a month (0-based) in a year. */
function dayOf(c: CityState, year: number, month: number): number {
  return (year - c.calendar.startYear) * 360 + month * 30;
}

function households(c: CityState): number {
  let n = 0;
  for (let i = 0; i < c.house.length; i++) n += c.house[i];
  return n;
}

/** Runs to the first day of the next month. */
function nextMonth(c: CityState): void {
  do simulateDays(c, 1);
  while (dateOf(c.calendar).day !== 1);
}

describe('events', () => {
  it('stop the clock until the governor chooses', () => {
    const c = newCity();
    c.calendar.speed = 3;
    expect(triggerEvent(c, 'kervan')).toBe(true);
    const day = c.calendar.day;
    expect(stepTime(c, 5)).toBe(0);
    expect(c.calendar.day).toBe(day);
    expect(resolveEvent(c, 'gumruk')).toBe(true);
    expect(c.events.pendingEvent).toBeNull();
    expect(stepTime(c, 1)).toBeGreaterThan(0);
    expect(c.events.chronicle.map((e) => e.title)).toEqual(['Kervan geldi']);
  });

  it('refuse a choice the treasury cannot pay for', () => {
    const c = newCity();
    triggerEvent(c, 'elci');
    c.treasury = 100;
    expect(resolveEvent(c, 'hediye')).toBe(false);
    expect(c.events.pendingEvent).not.toBeNull();
    expect(resolveEvent(c, 'oyala')).toBe(true);
  });

  it('come from the city’s own random stream', () => {
    const run = (): string[] => {
      const c = createCity(def, fullBalance);
      for (let d = 0; d < 720; d++) {
        simulateDays(c, 1);
        const e = c.events.pendingEvent;
        if (e !== null) resolveEvent(c, e.choices.find((ch) => ch.cost <= c.treasury)!.id);
      }
      return c.events.chronicle.map((e) => `${e.day}:${e.title}`);
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toEqual(a);
  });
});

describe('fire', () => {
  it('spreads through the houses and leaves ashes', () => {
    const c = newCity();
    const before = households(c);
    triggerEvent(c, 'yangin');
    resolveEvent(c, 'birak');
    simulateDays(c, 40);
    expect(c.events.blaze.active).toBe(false);
    expect(c.events.blaze.burned).toBeGreaterThan(0);
    expect(households(c)).toBeLessThan(before);
    let ashes = 0;
    for (let i = 0; i < c.grid.count; i++) if (c.events.ash[i] > 0) ashes++;
    expect(ashes).toBe(c.events.blaze.burned);
    // Ashes are cleared in time and the lots can be built on again.
    simulateDays(c, balance.events.yangin.ashDays);
    for (let i = 0; i < c.grid.count; i++) expect(c.events.ash[i]).toBe(0);
  });

  it('does not jump to houses by a fountain when water stops it', () => {
    const c = newCity();
    c.balance = {
      ...balance,
      events: {
        ...balance.events,
        yangin: { ...balance.events.yangin, spread: 1, waterFactor: 0, guardFactor: 1 },
      },
    };
    const water = coverage(c).su;
    triggerEvent(c, 'yangin');
    const first = c.events.pendingEvent!.tiles[0];
    resolveEvent(c, 'birak');
    const burnt = new Set<number>();
    for (let d = 0; d < 30; d++) {
      for (let i = 0; i < c.grid.count; i++) if (c.events.fire[i] > 0) burnt.add(i);
      simulateDays(c, 1);
    }
    for (const i of burnt) if (i !== first) expect(water[i]).toBe(0);
  });

  it('stops at once when the neighbours are pulled down', () => {
    const c = newCity();
    triggerEvent(c, 'yangin');
    resolveEvent(c, 'yik');
    for (let i = 0; i < c.grid.count; i++) expect(c.events.fire[i]).toBe(0);
    simulateDays(c, 1);
    expect(c.events.blaze.active).toBe(false);
    expect(c.events.chronicle[0].outcome).toContain('ateş kesildi');
  });

  it('slows when the subaşı’s men are sent', () => {
    const c = newCity();
    const before = c.treasury;
    triggerEvent(c, 'yangin');
    resolveEvent(c, 'subasi');
    expect(c.treasury).toBe(before - balance.events.yangin.sendCost);
    expect(c.events.blaze.factor).toBe(balance.events.yangin.sendFactor);
  });
});

describe('plague', () => {
  it('takes households for months, and quarantine halves the bazaar’s takings', () => {
    const open = newCity();
    const shut = newCity();
    const before = households(open);
    triggerEvent(open, 'salgin');
    triggerEvent(shut, 'salgin');
    resolveEvent(open, 'dua');
    resolveEvent(shut, 'karantina');
    simulateDays(open, 20);
    simulateDays(shut, 20);
    expect(households(open)).toBeLessThan(before);
    expect(households(shut)).toBeGreaterThanOrEqual(households(open));
    expect(shut.flows.current.market).toBeLessThan(open.flows.current.market * 0.6);
    expect(open.stats.demand).toBeLessThan(0.6);
    simulateDays(open, balance.events.salgin.maxDays);
    expect(open.events.plague).toBeNull();
  });
});

describe('famine', () => {
  it('can be met with the sultan’s grain, for a larger due', () => {
    const c = newCity();
    c.granary = 1000;
    simulateDays(c, 1);
    triggerEvent(c, 'kitlik');
    const granary = c.granary;
    resolveEvent(c, 'sultan');
    const monthly = c.stats.population * balance.food.perPersonPerMonth;
    expect(c.granary - granary).toBeCloseTo(monthly * balance.events.kitlik.sultanMonths, -1);
    expect(modifierSum(c, 'tribute')).toBeCloseTo(balance.events.kitlik.sultanTributeExtra, 6);
    nextMonth(c);
    const share = c.stats.expenses.tribute / c.stats.incomeLastMonth;
    expect(share).toBeCloseTo(balance.tax.tributeShare + balance.events.kitlik.sultanTributeExtra, 6);
  });

  it('can be met by buying grain from the notables', () => {
    const c = newCity();
    triggerEvent(c, 'kitlik');
    const [treasury, granary] = [c.treasury, c.granary];
    resolveEvent(c, 'satin');
    const bought = c.granary - granary;
    expect(bought).toBeGreaterThan(0);
    expect(treasury - c.treasury).toBeCloseTo(bought * balance.events.kitlik.grainPrice, 6);
  });

  it('spares the quarter an imaret feeds', () => {
    const c = newCity();
    const { x, z } = openRoad(c, 16);
    applyZone(c, proposeZone(c, x, z + 1, x + 15, z + 2));
    const fed: number[] = [];
    for (let xx = x + 2; xx <= x + 12; xx++) {
      const i = c.grid.index(xx, z + 1);
      c.house[i] = 1;
      fed.push(i);
    }
    c.revision.houses++;
    expect(buildBuilding(c, proposeBuilding(c, 'imaret', x + 7, z - 2))).not.toBeNull();
    for (const i of fed) expect(coverage(c).imaret[i]).toBe(1);
    const before = households(c);
    c.granary = 0;
    c.goods.un = 0;
    c.goods.ekmek = 0;
    simulateDays(c, 30);
    expect(c.hungry).toBe(true);
    expect(households(c)).toBeLessThan(before);
    for (const i of fed) expect(c.house[i]).toBe(1);
  });
});

describe('earthquake', () => {
  it('cracks houses and walls; the treasury can rebuild the houses', () => {
    const c = newCity();
    const [houses, walls] = [households(c), c.events.defense.walls];
    triggerEvent(c, 'deprem');
    const e = c.events.pendingEvent!;
    expect(households(c)).toBe(houses - e.tiles.length);
    expect(c.events.defense.walls).toBeCloseTo(walls - balance.events.deprem.wallDamage, 6);
    const treasury = c.treasury;
    resolveEvent(c, 'onar');
    expect(households(c)).toBe(houses);
    expect(c.treasury).toBe(treasury - e.tiles.length * balance.events.deprem.repairPerHouse);
  });
});

describe('the Mongols', () => {
  it('draw nearer every year from 1236, and envoys can be soothed or angered', () => {
    const c = newCity();
    c.calendar.day = dayOf(c, 1236, 0);
    simulateDays(c, 360);
    expect(c.events.defense.threat).toBeCloseTo(balance.defense.threatPerYear, 2);
    const t = c.events.defense.threat;
    triggerEvent(c, 'elci');
    resolveEvent(c, 'hediye');
    expect(c.events.defense.threat).toBeCloseTo(Math.max(0, t + balance.events.elci.giftThreat), 6);
    triggerEvent(c, 'elci');
    resolveEvent(c, 'kov');
    expect(c.events.defense.threat).toBeGreaterThan(t);
  });

  it('arrive after Kösedağ in 1243; surrender brings the Ilkhans’ tax', () => {
    const c = newCity();
    c.calendar.day = dayOf(c, 1243, 5) - 1;
    simulateDays(c, 1);
    expect(c.events.pendingEvent?.kind).toBe('kosedag');
    resolveEvent(c, 'teslim');
    expect(c.events.defense.kosedag).toBe('teslim');
    nextMonth(c);
    expect(c.stats.expenses.ilkhan / c.stats.incomeLastMonth).toBeCloseTo(
      balance.events.kosedag.tributeShare,
      6,
    );
  });

  it('are held off by strong walls and a full garrison', () => {
    const c = newCity();
    c.calendar.day = dayOf(c, 1243, 5) - 1;
    c.events.defense.walls = 1;
    c.policy.garrison = soldiersNeeded(c) + 200;
    expect(defenceStrength(c)).toBe(1);
    simulateDays(c, 1);
    resolveEvent(c, 'diren');
    expect(c.events.defense.kosedag).toBe('direndi');
    nextMonth(c);
    expect(c.stats.expenses.ilkhan).toBe(0);
  });

  it('sack a city whose walls are in ruins', () => {
    const c = newCity();
    c.calendar.day = dayOf(c, 1243, 5) - 1;
    c.events.defense.walls = 0;
    simulateDays(c, 1);
    const [treasury, granary] = [c.treasury, c.granary];
    resolveEvent(c, 'diren');
    expect(c.events.defense.kosedag).toBe('yagma');
    expect(c.treasury).toBeCloseTo(treasury * (1 - balance.events.kosedag.plunderShare), 6);
    expect(c.granary).toBeCloseTo(granary * (1 - balance.events.kosedag.plunderShare), 6);
    expect(c.events.blaze.active).toBe(true);
  });
});

describe('defence', () => {
  it('pays the garrison, takes it from the workforce and caps it', () => {
    const c = newCity();
    const labor = c.stats.labor;
    setGarrison(c, 10_000);
    expect(c.policy.garrison).toBe(maxGarrison(c));
    setGarrison(c, 300);
    simulateDays(c, 1);
    expect(c.stats.labor).toBeCloseTo(labor - (300 - balance.defense.startGarrison), 0);
    nextMonth(c);
    expect(c.stats.expenses.garrison).toBe(300 * balance.defense.payPerSoldier);
  });

  it('lets the walls weather and mends them for a price', () => {
    const c = newCity();
    const walls = c.events.defense.walls;
    simulateDays(c, 360);
    expect(c.events.defense.walls).toBeCloseTo(walls - balance.defense.wallDecayPerYear, 3);
    const cost = wallRepairCost(c);
    const treasury = c.treasury;
    expect(repairWalls(c)).toBe(true);
    expect(c.events.defense.walls).toBe(1);
    expect(c.treasury).toBe(treasury - cost);
  });
});

describe('unrest, caravans and learning', () => {
  it('ahis close shops if put down without enough soldiers', () => {
    const c = newCity();
    c.policy.garrison = 50;
    triggerEvent(c, 'ahi');
    resolveEvent(c, 'bastir');
    const open = [...c.buildings.values()].flatMap((b) => b.shops).filter((s) => s.trade !== null);
    expect(open.length).toBe(0);
    triggerEvent(c, 'ahi');
    resolveEvent(c, 'hafiflet');
    expect(c.policy.tax).toBe('hafif');
  });

  it('a caravan buys half the cloth in store at a good price', () => {
    const c = newCity();
    c.goods.kumas = 100;
    triggerEvent(c, 'kervan');
    const treasury = c.treasury;
    resolveEvent(c, 'sat');
    expect(c.goods.kumas).toBe(50);
    expect(c.treasury).toBeCloseTo(
      treasury + 50 * balance.goods.kumas.price * balance.events.kervan.priceFactor,
      6,
    );
  });

  it('honouring Mevlânâ lifts the city for good', () => {
    const c = newCity();
    triggerEvent(c, 'mevlana');
    resolveEvent(c, 'vakfet');
    expect(modifierSum(c, 'demand')).toBeCloseTo(balance.events.mevlana.demandBonus, 6);
    c.calendar.day += 5000;
    expect(modifierSum(c, 'prosperity')).toBeCloseTo(balance.events.mevlana.prosperityBonus, 6);
  });
});
