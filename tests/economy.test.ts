import { describe, expect, it } from 'vitest';
import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import type { Balance } from '../src/sim/balance';
import { dateOf } from '../src/sim/calendar';
import { createCity, type CityState } from '../src/sim/city';
import type { CityDef } from '../src/sim/city-def';
import { simulateDay, simulateDays, updateStats } from '../src/sim/economy';
import { buildField, fertilityFactor, proposeField, setFieldPlan, touchesRoad } from '../src/sim/fields';
import { buildRoad, planRoad } from '../src/sim/roads';
import { inspectTile } from '../src/sim/inspect';
import { applyZone, clearArea, proposeZone } from '../src/sim/zoning';

const def = konya as unknown as CityDef;
const balance = balanceJson as unknown as Balance;
const newCity = (): CityState => createCity(def, balance);

/** Runs until the calendar reaches the given month (0-based), day 1. */
function runUntilMonth(c: CityState, month: number): void {
  for (let k = 0; k < 400; k++) {
    const d = dateOf(c.calendar);
    if (d.month === month && d.day === 1 && k > 0) return;
    c.calendar.day++;
    simulateDay(c);
  }
}

/** Open ground east of the walls, north of the Aksaray road, clear of the starting fields. */
function openPlot(c: CityState): { x: number; z: number } {
  const { grid } = c;
  for (let wz = -40; wz < 40; wz++) {
    for (let wx = 30; wx < 80; wx++) {
      const x = grid.tileOf(wx);
      const z = grid.tileOf(wz);
      const p = proposeField(c, x, z, x + 7, z + 5);
      if (p.problem === undefined && p.fertility > 0.3) return { x, z };
    }
  }
  throw new Error('no open plot');
}

describe('starting economy', () => {
  it('farms the planned area in fields that reach a road', () => {
    const c = newCity();
    let tiles = 0;
    for (const f of c.fields.values()) {
      tiles += f.tiles.length;
      expect(touchesRoad(c, f)).toBe(true);
      for (const i of f.tiles) {
        expect(c.road[i]).toBe(0);
        expect(c.house[i]).toBe(0);
        expect(c.zone[i]).toBe(0);
      }
    }
    expect(tiles).toBeGreaterThanOrEqual(balance.fields.startTiles * 0.9);
  });

  it('keeps an untouched city fed and housed for two years', () => {
    const c = newCity();
    const start = c.stats.population;
    for (let q = 0; q < 8; q++) {
      simulateDays(c, 90);
      expect(c.granary).toBeGreaterThan(0);
      expect(c.stats.population).toBeGreaterThan(start * 0.95);
    }
  });

  it('is deterministic', () => {
    const a = newCity();
    const b = newCity();
    simulateDays(a, 200);
    simulateDays(b, 200);
    expect(a.house).toEqual(b.house);
    expect(a.granary).toBe(b.granary);
    expect(a.rngState).toBe(b.rngState);
  });

  it('collects household taxes at the start of each month', () => {
    const c = newCity();
    simulateDays(c, 29); // the last day of Mart
    let households = 0;
    for (let i = 0; i < c.house.length; i++) households += c.house[i];
    const before = c.treasury;
    simulateDays(c, 1); // 1 Nisan
    expect(dateOf(c.calendar).day).toBe(1);
    expect(c.stats.incomeLastMonth).toBe(households * balance.tax.perHouseholdPerMonth);
    expect(c.treasury).toBe(before + c.stats.incomeLastMonth);
  });
});

describe('fields', () => {
  it('rejects bad ground and awkward shapes', () => {
    const c = newCity();
    const { grid } = c;
    const inTown = proposeField(c, grid.tileOf(5), grid.tileOf(5), grid.tileOf(8), grid.tileOf(8));
    expect(inTown.problem).toBeDefined();
    const { x, z } = openPlot(c);
    expect(proposeField(c, x, z, x, z + 5).problem).toContain('En az');
    expect(proposeField(c, x, z, x + 20, z + 3).problem).toContain('En çok');
    c.treasury = 10;
    expect(proposeField(c, x, z, x + 7, z + 5).problem).toBe('Hazine yetersiz');
  });

  it('favours wheat on rich soil and barley on poor soil', () => {
    const c = newCity();
    expect(fertilityFactor(c, 'arpa', 0.3)).toBeGreaterThan(fertilityFactor(c, 'bugday', 0.3));
    expect(fertilityFactor(c, 'bugday', 0.8)).toBeGreaterThan(fertilityFactor(c, 'arpa', 0.8));
  });

  it('sows in spring, harvests in August into the granary, and tires the soil', () => {
    const c = newCity();
    const f = [...c.fields.values()][0];
    expect(f.stage).toBe('ekili');
    runUntilMonth(c, balance.fields.harvestMonth);
    expect(f.stage).toBe('hasat');
    expect(f.lastYield).toBeGreaterThan(0);
    expect(c.stats.lastHarvest).toBeGreaterThan(0);
    expect(f.soil).toBeCloseTo(1 - balance.fields.soil.drain);
    expect(c.notices.some((n) => n.text.startsWith('Hasat'))).toBe(true);
  });

  it('rests a fallow field and restores its soil', () => {
    const c = newCity();
    const f = [...c.fields.values()][0];
    runUntilMonth(c, balance.fields.harvestMonth);
    setFieldPlan(c, f.id, 'nadas');
    runUntilMonth(c, balance.fields.sowMonths[0]);
    expect(f.stage).toBe('nadas');
    const tired = f.soil;
    runUntilMonth(c, balance.fields.harvestMonth);
    expect(f.lastYield).toBe(0);
    expect(f.soil).toBeGreaterThan(tired);
  });

  it('is sown at once in the sowing window and charges the treasury', () => {
    const c = newCity();
    const { x, z } = openPlot(c);
    const p = proposeField(c, x, z, x + 7, z + 5);
    const before = c.treasury;
    const f = buildField(c, p, 'bugday');
    expect(f).not.toBeNull();
    expect(f?.stage).toBe('ekili');
    expect(c.treasury).toBe(before - p.cost);
  });

  it('works only the fields a road runs along', () => {
    const c = newCity();
    const { x, z } = openPlot(c);
    expect(buildRoad(c, planRoad(c, x, z, x + 7, z))).toBe(true);
    expect(proposeField(c, x, z + 1, x + 5, z + 2).roadAccess).toBe(true);
    const away = proposeField(c, x + 1, z + 3, x + 6, z + 5);
    expect(away.roadAccess).toBe(false);
    const f = buildField(c, away, 'bugday');
    expect(f).not.toBeNull();
    expect(inspectTile(c, x + 2, z + 4)?.field?.expected).toBe(0);
    runUntilMonth(c, 8);
    expect(f?.stage).toBe('hasat');
    expect(f?.lastYield).toBe(0);
  });
});

describe('housing', () => {
  it('builds houses on zoned lots near a road while there is demand', () => {
    const c = newCity();
    const { x, z } = openPlot(c);
    expect(buildRoad(c, planRoad(c, x, z, x + 12, z))).toBe(true);
    const plan = proposeZone(c, x, z + 1, x + 12, z + 2);
    expect(plan.far).toBe(0);
    const added = applyZone(c, plan);
    expect(added).toBeGreaterThan(10);
    updateStats(c);
    expect(c.stats.demand).toBeGreaterThan(0);
    const housesBefore = c.stats.households;
    simulateDays(c, 60);
    let onLots = 0;
    for (let xx = x; xx <= x + 12; xx++) {
      for (let zz = z + 1; zz <= z + 2; zz++) if (c.house[c.grid.index(xx, zz)] > 0) onLots++;
    }
    expect(onLots).toBeGreaterThan(5);
    expect(c.stats.households).toBeGreaterThan(housesBefore);
  });

  it('never builds out of reach of a road', () => {
    const c = newCity();
    const { x, z } = openPlot(c);
    const plan = proposeZone(c, x + 3, z + 3, x + 5, z + 4);
    expect(plan.added).toBe(6);
    expect(plan.far).toBe(6);
    applyZone(c, plan);
    simulateDays(c, 60);
    for (let xx = x + 3; xx <= x + 5; xx++) {
      for (let zz = z + 3; zz <= z + 4; zz++) expect(c.house[c.grid.index(xx, zz)]).toBe(0);
    }
  });

  it('empties houses in a famine', () => {
    const c = newCity();
    const before = c.stats.population;
    c.granary = 100; // runs out on the first day
    simulateDays(c, 30);
    expect(c.stats.population).toBeLessThan(before);
    expect(c.notices.some((n) => n.kind === 'bad')).toBe(true);
  });
});

describe('clearing land', () => {
  it('removes roads, houses, zoning and whole fields, but not gate passages', () => {
    const c = newCity();
    const f = [...c.fields.values()][0];
    const fx = f.x0 + 1;
    const fz = f.z0 + 1;
    const cleared = clearArea(c, fx, fz, fx, fz);
    expect(cleared.fields).toBe(1);
    expect(c.fields.has(f.id)).toBe(false);
    for (const i of f.tiles) expect(c.field[i]).toBe(-1);

    const g = c.gates[0].tiles[0];
    const gx = g % c.grid.size;
    const gz = Math.floor(g / c.grid.size);
    clearArea(c, gx, gz, gx, gz);
    expect(c.road[g]).toBe(1);

    let house = -1;
    for (let i = 0; i < c.house.length && house < 0; i++) if (c.house[i] > 0) house = i;
    const hx = house % c.grid.size;
    const hz = Math.floor(house / c.grid.size);
    const r = clearArea(c, hx, hz, hx, hz);
    expect(r.houses).toBe(1);
    expect(c.house[house]).toBe(0);
    expect(c.zone[house]).toBe(0);
  });

  it('keeps roads off fields and takes zoning under a new road', () => {
    const c = newCity();
    const f = [...c.fields.values()][0];
    const plan = planRoad(c, f.x0, f.z0, f.x0 + 1, f.z0);
    expect(plan.problem).toBe('Tarla');
    const { x, z } = openPlot(c);
    applyZone(c, proposeZone(c, x, z, x + 4, z));
    buildRoad(c, planRoad(c, x, z, x + 4, z));
    expect(c.zone[c.grid.index(x + 2, z)]).toBe(0);
  });
});
