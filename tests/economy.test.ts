import { describe, expect, it } from 'vitest';
import type { BuildingKind } from '../src/sim/balance';
import {
  buildBuilding,
  demolishBuilding,
  proposeBuilding,
  startBlock,
  upgradeBuilding,
  upgradeOffer,
  type Building,
  type BuildingProposal,
} from '../src/sim/buildings';
import { DAYS_PER_MONTH } from '../src/sim/calendar';
import type { CityState } from '../src/sim/city';
import { foodCapacity, orderState, sellProduct, simulateDays, updateStats } from '../src/sim/economy';
import { housesWanted } from '../src/sim/housing';
import { restoreGame, saveGame } from '../src/sim/save';
import { balance, def, newCity, siteFor } from './helpers';

const houses = (c: CityState): number => c.house.reduce((n, h) => n + (h > 0 ? 1 : 0), 0);

/** Runs the calendar up to the next month's first day, closing exactly one month. */
function nextMonth(c: CityState): void {
  simulateDays(c, DAYS_PER_MONTH - (c.calendar.day % DAYS_PER_MONTH));
}

function finish(c: CityState, b: Building): void {
  simulateDays(c, b.work?.daysLeft ?? 0);
}

/** A proposal on the first spot near `near` where every tile is free, whatever else stops it. */
function openGround(c: CityState, kind: BuildingKind, near: [number, number]): BuildingProposal {
  for (let r = 0; r < 20; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const p = proposeBuilding(c, kind, c.grid.tileOf(near[0]) + dx, c.grid.tileOf(near[1]) + dz);
        if (p.tiles.every((t) => t.ok) && !(p.problem ?? '').includes('Sur dışına')) return p;
      }
    }
  }
  throw new Error(`no open ground for ${kind}`);
}

const carsi = (c: CityState): Building => [...c.buildings.values()].find((b) => b.kind === 'carsi')!;

describe('placing buildings', () => {
  it('pays for a building and raises it when its months of work are done', () => {
    const c = newCity();
    const p = siteFor(c, 'hamam', [6, 12]);
    const akce = c.treasury;
    const stone = c.product;
    const b = buildBuilding(c, p)!;
    expect(c.treasury).toBe(akce - balance.buildings.hamam.levels[0].cost);
    expect(c.product).toBe(stone - balance.buildings.hamam.levels[0].material);
    expect(b.level).toBe(0);
    expect(b.work?.daysLeft).toBe(balance.buildings.hamam.levels[0].months * DAYS_PER_MONTH);
    simulateDays(c, balance.buildings.hamam.levels[0].months * DAYS_PER_MONTH - 1);
    expect(b.level).toBe(0);
    simulateDays(c, 1);
    expect(b.level).toBe(1);
    expect(b.work).toBeNull();
    expect(c.notices.some((n) => n.text.includes('tamamlandı'))).toBe(true);
  });

  it('will not stand on water, walls, landmarks or streets', () => {
    const c = newCity();
    const { grid } = c;
    const at = (i: number) => proposeBuilding(c, 'ambar', i % grid.size, Math.floor(i / grid.size));
    const water = c.terrain.water.indexOf(1);
    expect(at(water).problem).toBeDefined();
    expect(at(c.landmarks[0].tiles[0]).problem).toBeDefined();
    expect(at(c.gates[0].tiles[0]).problem).toBeDefined();
    const street = c.road.indexOf(1);
    expect(at(street).tiles.some((t) => t.reason === 'Sokak')).toBe(true);
  });

  it('moves the families living where it goes up to other lots', () => {
    const c = newCity();
    let p = siteFor(c, 'cami', [4, 14]);
    for (let r = 0; p.clears === 0 && r < 20; r++) p = siteFor(c, 'cami', [4 + r, 14]);
    expect(p.clears).toBeGreaterThan(0);
    const b = buildBuilding(c, p)!;
    for (const i of b.tiles) expect(c.house[i]).toBe(0);
    expect(houses(c)).toBe(housesWanted(c));
  });

  it('puts the quarry only on the stone and the caravanserai only outside the walls', () => {
    const c = newCity();
    expect(proposeBuilding(c, 'ocak', c.grid.tileOf(4), c.grid.tileOf(12)).problem).toContain('ocak yerine');
    const site = c.def.resource.sites[0];
    expect(siteFor(c, 'ocak', [site.x, site.z], 8).problem).toBeUndefined();
    const inside = siteFor(c, 'cami', [4, 14]);
    const cx = inside.x0 + Math.floor(inside.w / 2);
    const cz = inside.z0 + Math.floor(inside.d / 2);
    expect(proposeBuilding(c, 'kervansaray', cx, cz).problem).toContain('Sur dışına kurulur');
    expect(siteFor(c, 'kervansaray', [34, 0]).problem).toBeUndefined();
  });

  it('asks for akçe and for the city’s own product', () => {
    const c = newCity();
    const spot = siteFor(c, 'cami', [4, 14]);
    const cx = spot.x0 + Math.floor(spot.w / 2);
    const cz = spot.z0 + Math.floor(spot.d / 2);
    c.product = 0;
    expect(proposeBuilding(c, 'cami', cx, cz).problem).toBe('Taş yetmiyor');
    c.treasury = 0;
    expect(proposeBuilding(c, 'cami', cx, cz).problem).toBe('Akçe yetmiyor');
  });

  it('runs only as many works at once as the city’s rank allows', () => {
    const c = newCity();
    const site = c.def.resource.sites[0];
    expect(buildBuilding(c, siteFor(c, 'hamam', [6, 12]))).not.toBeNull();
    expect(buildBuilding(c, siteFor(c, 'ocak', [site.x, site.z], 8))).not.toBeNull();
    expect(balance.levels[0].builders).toBe(2);
    expect(() => siteFor(c, 'ambar', [34, 4], 6)).toThrow();
    const p = proposeBuilding(c, 'ambar', c.grid.tileOf(34), c.grid.tileOf(4));
    expect(
      p.problem === undefined || p.problem.startsWith('Bütün ustalar') || p.tiles.some((t) => !t.ok),
    ).toBe(true);
  });

  it('keeps to the buildings the city’s rank allows, and to a few of each kind', () => {
    const c = newCity();
    c.treasury = 1e6;
    c.product = 1e5;
    const kinds = ['hamam', 'cami', 'medrese', 'darussifa', 'ambar'] as const;
    const spots: Array<[number, number]> = [
      [6, 12],
      [-10, 8],
      [10, -12],
      [-14, -4],
      [2, -16],
    ];
    kinds.forEach((kind, k) => {
      const b = buildBuilding(c, siteFor(c, kind, spots[k]))!;
      finish(c, b);
    });
    expect(c.buildings.size).toBe(balance.levels[0].slots);
    expect(() => siteFor(c, 'hamam', [12, 8], 6)).toThrow();
    expect(openGround(c, 'hamam', [12, 8]).problem).toContain('Yapı hakkı dolu');
    // A great city has more room, but still only one caravanserai.
    c.population = balance.levels[1].population + 100;
    updateStats(c);
    const first = buildBuilding(c, siteFor(c, 'kervansaray', [34, 0]))!;
    finish(c, first);
    expect(openGround(c, 'kervansaray', [-36, 2]).problem).toContain('En çok 1');
  });

  it('pulls a building down for a quarter of what it cost', () => {
    const c = newCity();
    const b = buildBuilding(c, siteFor(c, 'hamam', [6, 12]))!;
    const akce = c.treasury;
    const refund = demolishBuilding(c, b.id);
    expect(refund).toBe(Math.round(balance.buildings.hamam.levels[0].cost * balance.demolishRefund));
    expect(c.treasury).toBe(akce + refund);
    for (const i of b.tiles) expect(c.building[i]).toBe(-1);
    expect(c.buildings.has(b.id)).toBe(false);
  });
});

describe('levels', () => {
  it('keeps the old level working while the new one is built', () => {
    const c = newCity();
    const b = carsi(c);
    expect(b.level).toBe(1);
    const offer = upgradeOffer(c, b)!;
    expect(offer.toLevel).toBe(2);
    expect(offer.cost).toBe(balance.buildings.carsi.levels[1].cost);
    expect(offer.problem).toBeUndefined();
    expect(upgradeBuilding(c, b.id)).toBe(true);
    updateStats(c);
    expect(b.level).toBe(1);
    expect(c.stats.income.buildings).toBeGreaterThanOrEqual(balance.buildings.carsi.levels[0].income!);
    finish(c, b);
    expect(b.level).toBe(2);
  });

  it('keeps the top level for a great city', () => {
    const c = newCity();
    const b = carsi(c);
    upgradeBuilding(c, b.id);
    finish(c, b);
    c.treasury = 1e6;
    c.product = 1e4;
    expect(upgradeOffer(c, b)?.problem).toContain('Büyük Şehir');
    c.population = balance.levels[1].population + 100;
    updateStats(c);
    expect(upgradeOffer(c, b)?.problem).toBeUndefined();
    expect(upgradeBuilding(c, b.id)).toBe(true);
    finish(c, b);
    expect(b.level).toBe(3);
    expect(upgradeOffer(c, b)).toBeNull();
  });
});

describe('the month', () => {
  it('taxes the people and pays out the bazaars', () => {
    const c = newCity();
    nextMonth(c);
    const akce = c.treasury;
    const people = c.population;
    nextMonth(c);
    const rate = balance.tax.rates[c.policy.tax].perHead;
    // The bazaar pays; it and the granary cost their upkeep.
    const upkeep = balance.buildings.carsi.levels[0].upkeep + balance.buildings.ambar.levels[0].upkeep;
    const expected = Math.round(people * rate + balance.buildings.carsi.levels[0].income! - upkeep);
    expect(orderState(c)).toBe('sakin');
    expect(c.stats.last.income).toBe(expected);
    expect(c.treasury).toBe(akce + expected);
  });

  it('trades order for akçe with a heavier tax', () => {
    const c = newCity();
    const orta = { ...c.stats.income, order: c.stats.order };
    c.policy.tax = 'agir';
    updateStats(c);
    expect(c.stats.income.tax).toBeGreaterThan(orta.tax);
    expect(c.stats.order).toBeCloseTo(orta.order + balance.tax.rates.agir.order);
  });

  it('loses order to crowding and wins it back with mosques', () => {
    const c = newCity();
    c.population = 55000;
    updateStats(c);
    const crowded = c.stats.order;
    expect(c.stats.orderParts.crowding).toBeCloseTo(-10);
    expect(c.stats.orderParts.food).toBe(0);
    const b = buildBuilding(c, siteFor(c, 'cami', [4, 14]))!;
    finish(c, b);
    c.population = 55000;
    updateStats(c);
    expect(c.stats.order).toBeCloseTo(crowded + balance.buildings.cami.levels[0].order!);
  });

  it('falls into revolt under a heavy tax in a crowded city, and people leave', () => {
    const c = newCity();
    c.population = 120000;
    c.policy.tax = 'agir';
    updateStats(c);
    expect(orderState(c)).toBe('isyan');
    const people = c.population;
    nextMonth(c);
    expect(c.population).toBeLessThan(people);
    expect(c.notices.some((n) => n.text.includes('isyan'))).toBe(true);
  });

  it('feeds only so many: past the fields and granaries people go hungry and leave', () => {
    const c = newCity();
    updateStats(c);
    const cap = c.stats.food;
    expect(cap).toBeGreaterThan(c.population);
    c.population = Math.round(cap * 0.97);
    updateStats(c);
    const slow = c.stats.growth;
    c.population = Math.round(cap * 0.7);
    updateStats(c);
    expect(c.stats.growth / c.population).toBeGreaterThan(slow / (cap * 0.97));
    c.population = Math.round(cap * 1.2);
    updateStats(c);
    expect(c.stats.growth).toBeLessThan(0);
    expect(c.stats.orderParts.food).toBeLessThan(0);
  });

  it('pays upkeep every month, and a treasury in debt costs order', () => {
    const c = newCity();
    const b = buildBuilding(c, siteFor(c, 'hamam', [6, 12]))!;
    finish(c, b);
    updateStats(c);
    expect(c.stats.income.upkeep).toBe(
      balance.buildings.carsi.levels[0].upkeep +
        balance.buildings.ambar.levels[0].upkeep +
        balance.buildings.hamam.levels[0].upkeep,
    );
    const calm = c.stats.order;
    c.treasury = -10;
    updateStats(c);
    expect(c.stats.order).toBeCloseTo(calm + balance.debt.order);
  });

  it('grows faster with a granary', () => {
    const c = newCity();
    updateStats(c);
    const before = c.stats.growth;
    const b = buildBuilding(c, siteFor(c, 'ambar', [34, 4]))!;
    finish(c, b);
    updateStats(c);
    expect(c.stats.growth).toBeGreaterThan(before);
    const people = c.population;
    nextMonth(c);
    expect(c.population).toBeGreaterThan(people);
    expect(houses(c)).toBe(housesWanted(c));
  });

  it('fills the store from the quarry, and sells what is spare', () => {
    const c = newCity();
    const site = c.def.resource.sites[0];
    const q = buildBuilding(c, siteFor(c, 'ocak', [site.x, site.z], 8))!;
    finish(c, q);
    nextMonth(c);
    const stone = c.product;
    nextMonth(c);
    expect(c.product).toBe(stone + balance.product.base + balance.buildings.ocak.levels[0].product!);
    const akce = c.treasury;
    expect(sellProduct(c)).toBe(true);
    expect(c.treasury).toBe(akce + balance.product.sellLot * balance.product.price);
    c.product = 0;
    expect(sellProduct(c)).toBe(false);
  });

  it('raises the city’s rank as it grows', () => {
    const c = newCity();
    expect(c.stats.level).toBe(0);
    c.population = balance.levels[1].population;
    nextMonth(c);
    expect(c.stats.level).toBe(1);
    expect(c.notices.some((n) => n.text.includes(balance.levels[1].name))).toBe(true);
  });

  it('keeps a rank it reached until the people fall well below it', () => {
    const c = newCity();
    const great = balance.levels[1].population;
    c.population = great + 100;
    updateStats(c);
    expect(c.stats.level).toBe(1);
    // A thin month just under the line does not cost the rank, nor does loading the game.
    c.population = great * (1 - balance.rankSlack / 2);
    updateStats(c);
    expect(c.stats.level).toBe(1);
    nextMonth(c);
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(back.stats.level).toBe(1);
    // Falling well below it does.
    c.population = great * (1 - balance.rankSlack) - 50;
    updateStats(c);
    expect(c.stats.level).toBe(0);
    // A city that never reached the rank does not get it for being near it.
    const d = newCity();
    d.population = great - 100;
    updateStats(d);
    expect(d.stats.level).toBe(0);
  });

  it('says what stops a new building before a spot is chosen', () => {
    const c = newCity();
    expect(startBlock(c, 'hamam')).toBeNull();
    c.product = 0;
    expect(startBlock(c, 'hamam')?.by).toBe('urun');
    c.product = 1e4;
    c.treasury = 0;
    expect(startBlock(c, 'hamam')?.by).toBe('akce');
    c.treasury = 1e5;
    buildBuilding(c, siteFor(c, 'hamam', [6, 12]));
    buildBuilding(c, siteFor(c, 'cami', [-8, -10]));
    expect(startBlock(c, 'kisla')?.by).toBe('builders');
    // The spot's own problems come first, then the same reason.
    expect(openGround(c, 'kisla', [70, -30]).problem).toBe(startBlock(c, 'kisla')?.text);
  });

  it('lives the same history given the same choices', () => {
    const run = (): string => {
      const c = newCity();
      buildBuilding(c, siteFor(c, 'hamam', [6, 12]));
      simulateDays(c, 400);
      return JSON.stringify([c.treasury, c.product, c.population, Array.from(c.house)]);
    };
    expect(run()).toBe(run());
  });
});

describe('farmland', () => {
  it('says how much bread a building on the fields would cost, and costs that much', () => {
    const c = newCity();
    c.treasury = 1e6;
    c.product = 1e5;
    // A caravanserai out among the fields.
    const p = [...c.fields.values()]
      .map((f) => proposeBuilding(c, 'kervansaray', f.x0 + 1, f.z0 + 1))
      .find((q) => q.problem === undefined && q.fields > 0);
    expect(p).toBeDefined();
    const before = foodCapacity(c);
    buildBuilding(c, p!);
    expect(before - foodCapacity(c)).toBe(p!.foodLost);
  });
});
