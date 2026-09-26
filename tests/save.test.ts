import { describe, expect, it } from 'vitest';
import { buildBuilding, upgradeBuilding } from '../src/sim/buildings';
import type { CityState } from '../src/sim/city';
import { simulateDays } from '../src/sim/economy';
import { replaceCity, restoreGame, saveGame, SaveError } from '../src/sim/save';
import { balance, def, newCity, siteFor } from './helpers';

/** Everything play can change, in one comparable string. */
function state(c: CityState): string {
  return JSON.stringify({
    day: c.calendar.day,
    treasury: c.treasury,
    product: c.product,
    population: c.population,
    tax: c.policy.tax,
    buildings: [...c.buildings.values()],
    fields: [...c.fields.keys()],
    houses: Array.from(c.house),
    building: Array.from(c.building),
    stats: c.stats,
  });
}

/** A city some years into play, with works standing and under way. */
function played(): CityState {
  const c = newCity();
  const site = c.def.resource.sites[0];
  buildBuilding(c, siteFor(c, 'ocak', [site.x, site.z], 8));
  buildBuilding(c, siteFor(c, 'hamam', [6, 12]));
  simulateDays(c, 200);
  const bazaar = [...c.buildings.values()].find((b) => b.kind === 'carsi')!;
  upgradeBuilding(c, bazaar.id);
  c.policy.tax = 'hafif';
  simulateDays(c, 45);
  return c;
}

describe('saving', () => {
  it('brings back the same city through JSON', () => {
    const c = played();
    const text = JSON.stringify(saveGame(c));
    const back = restoreGame(def, balance, JSON.parse(text));
    expect(state(back)).toBe(state(c));
    expect(text.length).toBeLessThan(20_000);
  });

  it('lives on the same after loading as if never saved', () => {
    const c = played();
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    simulateDays(c, 400);
    simulateDays(back, 400);
    expect(state(back)).toBe(state(c));
  });

  it('refuses another city, another version and junk', () => {
    const s = saveGame(newCity());
    expect(() => restoreGame(def, balance, { ...s, city: 'kayseri' })).toThrow(SaveError);
    expect(() => restoreGame(def, balance, { ...s, version: 99 })).toThrow(SaveError);
    expect(() => restoreGame(def, balance, { ...s, treasury: 'çok' })).toThrow(SaveError);
    expect(() => restoreGame(def, balance, null)).toThrow(SaveError);
    expect(() =>
      restoreGame(def, balance, { ...s, buildings: [{ ...s.buildings[0], kind: 'saray' }] }),
    ).toThrow(SaveError);
  });

  it('counts a save from before the tenfold city ten times larger', () => {
    const c = played();
    const s = saveGame(c);
    const old = {
      ...s,
      version: 1,
      treasury: s.treasury / 10,
      product: s.product / 10,
      population: s.population / 10,
      buildings: s.buildings.map((b) => ({ ...b, spent: b.spent / 10 })),
    };
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(old)));
    expect(back.treasury).toBeCloseTo(c.treasury);
    expect(back.population).toBeCloseTo(c.population);
    expect(back.streetsLaid).toBe(c.streetsLaid);
    expect(Array.from(back.house)).toEqual(Array.from(c.house));
  });

  it('swaps a city in place and moves every revision on', () => {
    const c = newCity();
    const rev = { ...c.revision };
    const other = played();
    replaceCity(c, other);
    expect(c.treasury).toBe(other.treasury);
    expect(c.buildings).toBe(other.buildings);
    for (const k of Object.keys(rev) as Array<keyof typeof rev>)
      expect(c.revision[k]).toBeGreaterThan(rev[k]);
  });
});
