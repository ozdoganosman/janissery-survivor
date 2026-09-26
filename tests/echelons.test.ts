import { describe, expect, it } from 'vitest';
import { disband, recruitMany, type Unit } from '../src/sim/army';
import { buildBuilding } from '../src/sim/buildings';
import type { CityState } from '../src/sim/city';
import { simulateDays } from '../src/sim/economy';
import {
  chainOf,
  echelonKind,
  echelonName,
  echelonOf,
  exactEchelon,
  formEchelon,
  formProblem,
  orderByEchelon,
  organize,
  taburs,
  widen,
} from '../src/sim/echelons';
import { axes, planMarch } from '../src/sim/field';
import { restoreGame, saveGame, type SaveGame } from '../src/sim/save';
import { balance, def, newCity, siteFor } from './helpers';

const holds = balance.army.echelons;

/** A city with a barracks and `n` drilled taburs of spearmen. */
function withArmy(n: number): CityState {
  const c = newCity();
  c.treasury = 1e6;
  c.product = 1e5;
  const b = buildBuilding(c, siteFor(c, 'kisla', [36, -20]))!;
  simulateDays(c, b.work!.daysLeft);
  recruitMany(c, 'mizrakci', n);
  simulateDays(c, balance.army.units.mizrakci.months * 30);
  return c;
}

const ids = (units: Unit[]): number[] => units.map((u) => u.id);

describe('the chain of command', () => {
  it('gathers new taburs into tugays, tugays into kolordus and kolordus into ordus', () => {
    const c = withArmy(20);
    const levels = (level: string): number => c.army.echelons.filter((e) => e.level === level).length;
    expect(levels('tugay')).toBe(Math.ceil(20 / holds.tugay.holds));
    expect(levels('kolordu')).toBe(Math.ceil(levels('tugay') / holds.kolordu.holds));
    expect(levels('ordu')).toBe(Math.ceil(levels('kolordu') / holds.ordu.holds));
    for (const u of c.army.units) {
      expect(chainOf(c, u).map((e) => e.level)).toEqual(['tugay', 'kolordu', 'ordu']);
    }
    for (const e of c.army.echelons) {
      const under =
        e.level === 'tugay'
          ? c.army.units.filter((u) => u.tugay === e.id).length
          : c.army.echelons.filter((x) => x.parent === e.id).length;
      expect(under).toBeGreaterThan(0);
      expect(under).toBeLessThanOrEqual(holds[e.level].holds);
    }
    // Numbered in turn: 1. Tugay, 2. Tugay...
    const tugays = c.army.echelons.filter((e) => e.level === 'tugay').map((e) => echelonName(c, e));
    expect(tugays).toContain('1. Tugay');
    expect(tugays).toContain('5. Tugay');
  });

  it('keeps each kind in tugays of its own, and strikes off echelons left empty', () => {
    const c = withArmy(2);
    recruitMany(c, 'okcu', 3);
    const archers = c.army.units.filter((u) => u.kind === 'okcu');
    const t = echelonOf(c, archers[0], 'tugay')!;
    expect(archers.every((u) => u.tugay === t.id)).toBe(true);
    expect(echelonKind(c, t.id)).toBe('okcu');
    // The archers' tugay serves beside the spearmen's in one kolordu.
    const spear = c.army.units.find((u) => u.kind === 'mizrakci')!;
    expect(echelonOf(c, spear, 'kolordu')!.id).toBe(t.parent);
    for (const u of archers) disband(c, u.id);
    expect(c.army.echelons.some((e) => e.id === t.id)).toBe(false);
    expect(c.army.echelons.filter((e) => e.level === 'tugay')).toHaveLength(1);
  });

  it('widens a choice from a tabur to its tugay, kolordu and ordu', () => {
    const c = withArmy(20);
    const first = c.army.units[0];
    const tugay = widen(c, [first.id]);
    expect(tugay).toHaveLength(holds.tugay.holds);
    expect(exactEchelon(c, tugay)?.level).toBe('tugay');
    const kolordu = widen(c, tugay);
    expect(kolordu).toHaveLength(holds.tugay.holds * holds.kolordu.holds);
    expect(exactEchelon(c, kolordu)?.level).toBe('kolordu');
    const ordu = widen(c, kolordu);
    expect(ordu).toHaveLength(16);
    expect(exactEchelon(c, ordu)?.level).toBe('ordu');
    // Whole ordus stay as they are.
    expect(widen(c, ordu)).toHaveLength(16);
  });

  it('forms a new tugay from chosen taburs, within its limit', () => {
    // Tugays of 4, 4 and 2: the first two in one kolordu, the third in another.
    const c = withArmy(10);
    const [a, , b] = c.army.echelons.filter((e) => e.level === 'tugay');
    const home = b.parent;
    const pick = [...taburs(c, b.id), ...taburs(c, a.id).slice(0, 2)];
    const r = formEchelon(c, 'tugay', ids(pick));
    expect(r.problem).toBeUndefined();
    const t = r.echelon!;
    expect(pick.every((u) => u.tugay === t.id)).toBe(true);
    expect(taburs(c, a.id)).toHaveLength(2);
    // The tugay emptied is struck off, and the new one takes its place in its kolordu.
    expect(c.army.echelons.some((e) => e.id === b.id)).toBe(false);
    expect(t.parent).toBe(home);
    // Too many for one, or already one.
    expect(formProblem(c, 'tugay', ids(c.army.units.slice(0, 5)))).toMatch(/en çok 4 tabur/);
    expect(formProblem(c, 'tugay', ids(pick))).toMatch(/zaten/);
    expect(formProblem(c, 'kolordu', ids(c.army.units))).toMatch(/en çok 2 tugay/);
  });

  it('forms a kolordu of the tugays of the chosen taburs', () => {
    const c = withArmy(12);
    const tugays = c.army.echelons.filter((e) => e.level === 'tugay');
    // The first tugay's first tabur and the last tugay's: two tugays of two kolordus.
    const first = taburs(c, tugays[0].id)[0];
    const last = taburs(c, tugays[2].id)[0];
    const r = formEchelon(c, 'kolordu', [first.id, last.id]);
    expect(r.problem).toBeUndefined();
    expect(tugays[0].parent).toBe(r.echelon!.id);
    expect(tugays[2].parent).toBe(r.echelon!.id);
    organize(c);
    expect(c.army.units.every((u) => chainOf(c, u).length === 3)).toBe(true);
  });

  it('orders taburs so that each tugay stands together', () => {
    const c = withArmy(8);
    // Two tugays mixed up along the line: the order keeps each together.
    const all = c.army.units;
    const place = new Map(all.map((u, k) => [u.id, k % 2 === 0 ? k : 100 - k]));
    const order = orderByEchelon(c, ids(all), (id) => place.get(id)!);
    const tugayAt = order.map((id) => all.find((u) => u.id === id)!.tugay);
    const changes = tugayAt.filter((t, k) => k > 0 && t !== tugayAt[k - 1]).length;
    expect(changes).toBe(1);
  });

  it('marches each tugay together, with more room between tugays', () => {
    const c = withArmy(8);
    const order = ids(c.army.units);
    const groups = new Map(c.army.units.map((u) => [u.id, u.tugay!]));
    const plan = planMarch(c, order, 60, 8, 0, { width: 20, groups }).plan;
    const a = axes(0);
    const across = plan.map((p) => p.x * a.rx + p.z * a.rz).sort((p, q) => p - q);
    const gaps = across.slice(1).map((v, k) => v - across[k]);
    // Seven gaps: the widest is the one between the two tugays.
    const widest = Math.max(...gaps);
    expect(gaps.indexOf(widest)).toBe(3);
    expect(widest).toBeGreaterThan(Math.min(...gaps));
  });

  it('comes back from a save as it was, and organizes an army saved without one', () => {
    const c = withArmy(9);
    formEchelon(c, 'tugay', ids(c.army.units.slice(0, 2)));
    const again = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(again.army.echelons).toEqual(c.army.echelons);
    expect(again.army.units.map((u) => u.tugay)).toEqual(c.army.units.map((u) => u.tugay));
    const old = JSON.parse(JSON.stringify(saveGame(c))) as SaveGame;
    delete old.army!.echelons;
    delete old.army!.nextEchelon;
    for (const u of old.army!.units) delete u.tugay;
    const organized = restoreGame(def, balance, old);
    expect(organized.army.units.every((u) => chainOf(organized, u).length === 3)).toBe(true);
  });
});
