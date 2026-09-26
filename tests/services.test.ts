import { describe, expect, it } from 'vitest';
import type { BuildingKind } from '../src/sim/balance';
import { buildBuilding, proposeBuilding, type Building } from '../src/sim/buildings';
import { dateOf } from '../src/sim/calendar';
import type { CityState } from '../src/sim/city';
import { simulateDays } from '../src/sim/economy';
import { buildField, harvestAll, proposeField, type FieldProposal } from '../src/sim/fields';
import { coverage, coveredAt, supportedLevel, vakifFounders } from '../src/sim/services';
import { applyZone, clearArea, proposeZone } from '../src/sim/zoning';
import { balance, newCity, openRoad, siteFor } from './helpers';

/** Runs to the first day of the next month. */
function nextMonth(c: CityState): void {
  do simulateDays(c, 1);
  while (dateOf(c.calendar).day !== 1);
}

/**
 * A new quarter east of the walls: a road with houses along both sides, and a lot kept
 * free on the north side at (x + 7, z - 1) for a fountain.
 */
function quarter(c: CityState, level: number): { x: number; z: number; houses: number[] } {
  const { x, z } = openRoad(c, 16);
  applyZone(c, proposeZone(c, x, z - 2, x + 15, z - 1));
  applyZone(c, proposeZone(c, x, z + 1, x + 15, z + 2));
  const houses: number[] = [];
  for (let xx = x + 4; xx <= x + 10; xx++) {
    for (const zz of [z - 1, z + 1]) {
      if (xx === x + 7 && zz === z - 1) continue;
      const i = c.grid.index(xx, zz);
      c.house[i] = level;
      houses.push(i);
    }
  }
  c.revision.houses++;
  return { x, z, houses };
}

function build(c: CityState, kind: BuildingKind, x: number, z: number, vakif = false): Building {
  const b = buildBuilding(c, proposeBuilding(c, kind, x, z, { vakif }));
  if (b === null) throw new Error(`could not build ${kind} at ${x}, ${z}`);
  return b;
}

/** Makes every level change certain and the city content, so a month shows the rule. */
function eager(c: CityState): void {
  c.balance = {
    ...balance,
    growth: { ...balance.growth, upgradeChancePerMonth: 1 },
    housing: { ...balance.housing, downgradeChancePerMonth: 1 },
  };
  // Bread and cloth enough for everyone, all month.
  c.goods.ekmek = 500_000;
  c.goods.kumas = 5_000;
  c.needs.ekmek = 1;
  c.needs.kumas = 1;
}

describe('the old town', () => {
  it('starts with fountains, and with nearly every house served for its level', () => {
    const c = newCity();
    expect([...c.buildings.values()].filter((b) => b.kind === 'cesme')).toHaveLength(12);
    let houses = 0;
    let served = 0;
    for (let i = 0; i < c.grid.count; i++) {
      if (c.house[i] === 0) continue;
      houses++;
      if (c.house[i] <= supportedLevel(c, i)) served++;
    }
    expect(served / houses).toBeGreaterThan(0.97);
    // Alaeddin Camii's call reaches every house inside the walls.
    const { ibadet } = coverage(c);
    for (let i = 0; i < c.grid.count; i++) if (c.house[i] > 0) expect(ibadet[i]).toBe(1);
  });
});

describe('house levels', () => {
  it('gains a floor with water and a mescit, and not without', () => {
    const bare = newCity();
    const q0 = quarter(bare, 1);
    eager(bare);
    nextMonth(bare);
    expect(q0.houses.every((i) => bare.house[i] === 1)).toBe(true);

    const c = newCity();
    const { x, z, houses } = quarter(c, 1);
    build(c, 'cesme', x + 7, z - 1);
    build(c, 'mescit', x + 13, z - 2);
    expect(houses.every((i) => supportedLevel(c, i) >= 2)).toBe(true);
    eager(c);
    nextMonth(c);
    expect(houses.every((i) => c.house[i] === 2)).toBe(true);
  });

  it('becomes a konak with a bath, a medrese and prosperity', () => {
    const c = newCity();
    const { x, z, houses } = quarter(c, 2);
    build(c, 'cesme', x + 7, z - 1);
    build(c, 'mescit', x + 13, z - 2);
    build(c, 'hamam', x + 1, z + 2);
    expect(houses.every((i) => supportedLevel(c, i) === 2)).toBe(true);
    build(c, 'medrese', x + 14, z + 2);
    eager(c);
    simulateDays(c, 1);
    expect(houses.every((i) => supportedLevel(c, i) === 3)).toBe(true);
    nextMonth(c);
    expect(houses.every((i) => c.house[i] === 3)).toBe(true);
  });

  it('loses a floor when its fountain is pulled down', () => {
    const c = newCity();
    const { x, z, houses } = quarter(c, 2);
    const fountain = build(c, 'cesme', x + 7, z - 1);
    build(c, 'mescit', x + 13, z - 2);
    eager(c);
    nextMonth(c);
    expect(houses.every((i) => c.house[i] === 2)).toBe(true);
    clearArea(c, fountain.x0, fountain.z0, fountain.x0, fountain.z0);
    nextMonth(c);
    expect(houses.every((i) => c.house[i] === 1)).toBe(true);
  });
});

describe('the budget', () => {
  it('charges upkeep and the sultan’s due, and taxes by the chosen rate', () => {
    const light = newCity();
    const heavy = newCity();
    heavy.policy.tax = 'agir';
    light.policy.tax = 'hafif';
    nextMonth(light);
    nextMonth(heavy);
    expect(heavy.stats.income.tax / light.stats.income.tax).toBeCloseTo(
      balance.tax.rates.agir / balance.tax.rates.hafif,
      1,
    );
    expect(heavy.stats.expenses.upkeep).toBeGreaterThan(0);
    // Heavy tax keeps settlers away.
    expect(heavy.stats.demand).toBeLessThan(light.stats.demand - 0.1);
  });

  it('stops paid public services while the treasury is in debt, but not a vakıf’s', () => {
    const c = newCity();
    const { x, z } = quarter(c, 1);
    const paid = build(c, 'mescit', x + 13, z - 2);
    const endowed = build(c, 'cesme', x + 7, z - 1, true);
    expect(endowed.vakif).toBeDefined();
    c.treasury = -5000;
    nextMonth(c);
    expect(c.unpaid).toBe(true);
    simulateDays(c, 1);
    expect(paid.status).toBe('maassiz');
    expect(coveredAt(c, 'ibadet', paid)).toBe(false);
    expect(coveredAt(c, 'su', endowed)).toBe(true);
    expect(c.notices.some((n) => n.text.startsWith('Hazine borçta'))).toBe(true);
  });
});

describe('vakıf', () => {
  it('builds for free, keeps its own upkeep and takes a share every month', () => {
    const c = newCity();
    const { x, z } = quarter(c, 1);
    expect(vakifFounders(c)).toBe(1);
    const before = c.treasury;
    const p = proposeBuilding(c, 'mescit', x + 13, z - 2, { vakif: true });
    expect(p.problem).toBeUndefined();
    expect(p.cost).toBe(0);
    const b = buildBuilding(c, p)!;
    expect(b.vakif).toBe(balance.vakif.founders[0]);
    expect(c.treasury).toBe(before);
    expect(vakifFounders(c)).toBe(0);
    expect(proposeBuilding(c, 'cesme', x + 7, z - 1, { vakif: true }).problem).toBe(
      'Vakıf yaptıracak eşraf yok',
    );
    // Workshops are never endowed: the flag is ignored for them.
    expect(proposeBuilding(c, 'arasta', x + 8, z + 1, { vakif: true }).vakif).toBe(false);
    nextMonth(c);
    expect(c.stats.expenses.vakif).toBeCloseTo(balance.works.mescit.cost * balance.vakif.share, 6);
    let upkeep = 0;
    for (const w of c.buildings.values()) if (w.vakif === undefined) upkeep += balance.works[w.kind].upkeep;
    expect(c.stats.expenses.upkeep).toBe(upkeep);
  });
});

describe('narh', () => {
  it('lifts prosperity and lowers the bazaar tax', () => {
    const free = newCity();
    const fixed = newCity();
    fixed.policy.narh = true;
    simulateDays(free, 20);
    simulateDays(fixed, 20);
    expect(fixed.stats.prosperity).toBeCloseTo(free.stats.prosperity + balance.narh.prosperityBonus, 2);
    expect(fixed.flows.current.market).toBeCloseTo(
      free.flows.current.market * (1 - balance.narh.priceCut),
      1,
    );
  });
});

describe('guilds and water wheels', () => {
  it('lets an ahi lodge’s bazaars make more bread from the same flour', () => {
    const plain = newCity();
    const guild = newCity();
    const bazaar = [...guild.buildings.values()].find((b) => b.kind === 'arasta')!;
    const near: [number, number] = [guild.grid.centre(bazaar.x0) + 2, guild.grid.centre(bazaar.z0) + 5];
    const lodge = buildBuilding(guild, siteFor(guild, 'zaviye', near, 12));
    expect(lodge).not.toBeNull();
    expect(coveredAt(guild, 'esnaf', bazaar)).toBe(true);
    simulateDays(plain, 20);
    simulateDays(guild, 20);
    const ratio = guild.flows.current.made.ekmek / guild.flows.current.used.un;
    const base = plain.flows.current.made.ekmek / plain.flows.current.used.un;
    expect(ratio).toBeCloseTo(base * (1 + balance.serviceEffects.esnafOutputBonus), 3);
  });

  it('waters the fields around a water wheel', () => {
    const dry = newCity();
    const wet = newCity();
    // A wheel on the bank by the Larende bridge, and a new wheat field within its reach.
    const wheel = buildBuilding(wet, siteFor(wet, 'dolap', [15, 31], 15))!;
    const reach = balance.works.dolap.radius! - 2;
    const cx = wheel.x0 + 1;
    const cz = wheel.z0 + 1;
    let plot: FieldProposal | null = null;
    for (let dz = -reach; dz <= reach && plot === null; dz++) {
      for (let dx = -reach; dx <= reach && plot === null; dx++) {
        const p = proposeField(wet, cx + dx - 2, cz + dz - 2, cx + dx + 1, cz + dz + 1);
        if (p.problem === undefined && p.roadAccess) plot = p;
      }
    }
    expect(plot).not.toBeNull();
    const ids = [dry, wet].map((c) => buildField(c, plot!, 'bugday')!.id);
    const target = wet.fields.get(ids[1])!;
    expect(coverage(wet).sulama[target.tiles[Math.floor(target.tiles.length / 2)]]).toBe(1);
    for (const c of [dry, wet]) simulateDays(c, 60);
    const yieldOf = (c: CityState, id: number): number => {
      harvestAll(c);
      return c.fields.get(id)!.lastYield;
    };
    expect(yieldOf(wet, ids[1])).toBeGreaterThan(yieldOf(dry, ids[0]) * 1.2);
  });
});
