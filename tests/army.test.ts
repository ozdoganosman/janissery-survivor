import { describe, expect, it } from 'vitest';
import {
  armyCapacity,
  armyMen,
  barracksOf,
  disband,
  disbandKind,
  levyLimit,
  recruit,
  recruitMany,
  recruitOffer,
  recruitRoom,
} from '../src/sim/army';
import { buildBuilding, demolishBuilding, upgradeBuilding, type Building } from '../src/sim/buildings';
import { DAYS_PER_MONTH } from '../src/sim/calendar';
import type { CityState } from '../src/sim/city';
import { simulateDays, updateStats } from '../src/sim/economy';
import { restoreGame, saveGame } from '../src/sim/save';
import { insideWalls } from '../src/sim/walls';
import { balance, def, newCity, siteFor } from './helpers';

const units = balance.army.units;

/** A rich city with its barracks standing, outside the walls. */
function withBarracks(level = 1): { c: CityState; b: Building } {
  const c = newCity();
  c.treasury = 1e5;
  c.product = 1e4;
  if (level > 2) c.population = balance.levels[1].population + 500;
  updateStats(c);
  const b = buildBuilding(c, siteFor(c, 'kisla', [36, -20]))!;
  simulateDays(c, b.work!.daysLeft);
  for (let l = 2; l <= level; l++) {
    expect(upgradeBuilding(c, b.id)).toBe(true);
    simulateDays(c, b.work!.daysLeft);
  }
  return { c, b };
}

describe('the barracks', () => {
  it('stands outside the walls, and is large', () => {
    const { c, b } = withBarracks();
    const k = balance.buildings.kisla;
    expect(b.w * b.d).toBe(k.w * k.d);
    expect(b.w * b.d).toBeGreaterThanOrEqual(100);
    const { grid } = c;
    for (const i of b.tiles) {
      expect(insideWalls(c, grid.centre(i % grid.size), grid.centre(Math.floor(i / grid.size)))).toBe(false);
    }
    expect(barracksOf(c)).toBe(b);
  });

  it('quarters more men at every level', () => {
    const caps = balance.buildings.kisla.levels.map((l) => l.capacity ?? 0);
    expect(caps[0]).toBeGreaterThan(0);
    expect(caps[1]).toBeGreaterThan(caps[0]);
    expect(caps[2]).toBeGreaterThan(caps[1]);
    expect(armyCapacity(withBarracks(1).c)).toBe(caps[0]);
    expect(armyCapacity(withBarracks(3).c)).toBe(caps[2]);
  });
});

describe('raising soldiers', () => {
  it('needs a barracks, and a greater one for horsemen', () => {
    const c = newCity();
    expect(recruitOffer(c, 'mizrakci').blockedBy).toBe('barracks');
    const { c: d } = withBarracks(1);
    expect(recruitOffer(d, 'mizrakci').problem).toBeUndefined();
    expect(recruitOffer(d, 'atli_okcu').blockedBy).toBe('level');
    expect(recruitOffer(d, 'gulam').blockedBy).toBe('level');
  });

  it('takes the men from the town, drills them, then pays them every month', () => {
    const { c } = withBarracks(1);
    const people = c.population;
    const akce = c.treasury;
    const u = recruit(c, 'mizrakci')!;
    expect(u.men).toBe(units.mizrakci.men);
    expect(c.population).toBe(people - u.men);
    expect(c.treasury).toBe(akce - units.mizrakci.cost);
    expect(armyMen(c)).toBe(u.men);
    expect(armyMen(c, true)).toBe(0);
    updateStats(c);
    expect(c.stats.income.army).toBe(units.mizrakci.pay);
    simulateDays(c, units.mizrakci.months * DAYS_PER_MONTH);
    expect(u.drill).toBeNull();
    expect(armyMen(c, true)).toBe(u.men);
    expect(c.notices.some((n) => n.text.includes('talimini bitirdi'))).toBe(true);
  });

  it('keeps to what the barracks can quarter and what the town can spare', () => {
    const { c } = withBarracks(1);
    const room = armyCapacity(c);
    while (recruit(c, 'mizrakci') !== null);
    expect(armyMen(c)).toBeLessThanOrEqual(room);
    expect(recruitOffer(c, 'mizrakci').blockedBy).toBe('room');
    // A small town cannot spare many men, however large its barracks.
    const { c: big } = withBarracks(3);
    big.population = 20000;
    updateStats(big);
    while (recruit(big, 'mizrakci') !== null);
    expect(armyMen(big)).toBeLessThanOrEqual(levyLimit(big));
    expect(recruitOffer(big, 'mizrakci').blockedBy).toBe('levy');
  });

  it('raises many companies at once, as many as there is room, men and akçe for', () => {
    const { c } = withBarracks(1);
    const most = recruitRoom(c, 'mizrakci');
    expect(most).toBeGreaterThan(10);
    expect(recruitMany(c, 'mizrakci', 10)).toBe(10);
    expect(armyMen(c)).toBe(10 * units.mizrakci.men);
    expect(recruitRoom(c, 'mizrakci')).toBe(most - 10);
    expect(recruitMany(c, 'mizrakci', 1000)).toBe(most - 10);
    expect(recruitRoom(c, 'mizrakci')).toBe(0);
    // Sending one home frees room for one.
    expect(disbandKind(c, 'mizrakci')).toBe(true);
    expect(recruitRoom(c, 'mizrakci')).toBe(1);
    expect(disbandKind(c, 'okcu')).toBe(false);
  });

  it('feeds the soldiers from the city’s bread', () => {
    const { c } = withBarracks(1);
    updateStats(c);
    const before = c.stats.growth;
    const people = c.population;
    recruit(c, 'mizrakci');
    recruit(c, 'okcu');
    // The same mouths to feed: the town has fewer people, the army eats the rest.
    updateStats(c);
    expect(c.population + armyMen(c)).toBe(people);
    expect(c.stats.growth).toBeLessThan(before);
  });

  it('sends men home when a company is disbanded or the barracks comes down', () => {
    const { c, b } = withBarracks(1);
    const people = c.population;
    const u = recruit(c, 'mizrakci')!;
    recruit(c, 'okcu');
    expect(disband(c, u.id)).toBe(true);
    expect(c.population).toBe(people - units.okcu.men);
    demolishBuilding(c, b.id);
    expect(c.army.units).toHaveLength(0);
    expect(c.population).toBe(people);
  });

  it('gives a barracks saved at its old, smaller size the ground it needs now', () => {
    const { c, b } = withBarracks(2);
    const s = saveGame(c);
    const k = balance.buildings.kisla;
    const old = {
      ...s,
      buildings: s.buildings.map((x) =>
        x.id === b.id ? { ...x, x0: x.x0 + 4, z0: x.z0 + 4, w: 14, d: 10 } : x,
      ),
    };
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(old)));
    const r = back.buildings.get(b.id)!;
    expect(r.w * r.d).toBe(k.w * k.d);
    expect(r.level).toBe(2);
    expect(armyCapacity(back)).toBe(k.levels[1].capacity);
    const { grid } = back;
    for (const i of r.tiles) {
      expect(back.building[i]).toBe(b.id);
      expect(insideWalls(back, grid.centre(i % grid.size), grid.centre(Math.floor(i / grid.size)))).toBe(
        false,
      );
    }
  });

  it('comes back the same from a save', () => {
    const { c } = withBarracks(3);
    recruit(c, 'gulam');
    recruit(c, 'atli_okcu');
    simulateDays(c, 40);
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(back.army).toEqual(c.army);
    expect(back.population).toBe(c.population);
  });
});

describe('an army unpaid', () => {
  it('melts away a company a month, the dearest first, while the treasury is in debt', () => {
    const { c } = withBarracks(3);
    recruit(c, 'mizrakci');
    recruit(c, 'gulam');
    simulateDays(c, DAYS_PER_MONTH - (c.calendar.day % DAYS_PER_MONTH));
    c.treasury = -1e5;
    simulateDays(c, DAYS_PER_MONTH);
    expect(c.army.units.map((u) => u.kind)).toEqual(['mizrakci']);
    // A deficit too deep for one company sends as many home as it takes.
    recruitMany(c, 'gulam', 30);
    c.treasury = -1e5;
    updateStats(c);
    simulateDays(c, DAYS_PER_MONTH);
    expect(c.stats.income.total).toBeGreaterThanOrEqual(0);
    expect(c.notices.some((n) => n.text.includes('ulufesini alamadı'))).toBe(true);
  });
});
