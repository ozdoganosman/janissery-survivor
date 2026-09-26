import { describe, expect, it } from 'vitest';
import { recruitMany, replenish, replenishOffer } from '../src/sim/army';
import { buildBuilding } from '../src/sim/buildings';
import type { CityState } from '../src/sim/city';
import { simulateDays, stepTime } from '../src/sim/economy';
import { marchOrder } from '../src/sim/field';
import { restoreGame, saveGame } from '../src/sim/save';
import { wallDepth } from '../src/sim/walls';
import { attackOrder, foeAt, foeGround, sendRaid, warStep, type War, type Whereabouts } from '../src/sim/war';
import { balance, def, newCity, siteFor } from './helpers';

const war = balance.army.war;

/** Our taburs out in the field stand where they were sent: as if every march were over. */
function where(c: CityState): Map<number, Whereabouts> {
  const m = new Map<number, Whereabouts>();
  for (const u of c.army.units) {
    if (u.field !== null)
      m.set(u.id, { x: u.field.x, z: u.field.z, heading: u.field.heading, moving: false });
  }
  return m;
}

/** Fights on for up to `seconds`, checking every raider stays outside the walls. */
function fight(c: CityState, seconds: number, each?: (c: CityState) => void): void {
  for (let t = 0; t < seconds && c.war !== null; t += 0.1) {
    warStep(c, 0.1, where(c));
    for (const f of c.war?.foes ?? []) expect(wallDepth(c, f.x, f.z)).toBe(0);
    each?.(c);
  }
}

function raid(c: CityState, taburs: number, kind = 0, bearing = 0): War {
  const w = sendRaid(c, taburs, { kind, bearing, trial: true });
  if (typeof w === 'string') throw new Error(w);
  return w;
}

/** A city with a barracks and drilled taburs of the given kinds. */
function withArmy(kinds: Partial<Record<'mizrakci' | 'okcu' | 'atli_okcu', number>>): CityState {
  const c = newCity();
  c.treasury = 1e6;
  c.product = 1e5;
  const b = buildBuilding(c, siteFor(c, 'kisla', [36, -20]))!;
  simulateDays(c, b.work!.daysLeft);
  b.level = 2;
  for (const [kind, n] of Object.entries(kinds)) recruitMany(c, kind as 'mizrakci', n);
  simulateDays(c, 120);
  return c;
}

describe('raids', () => {
  it('gather at the edge of the map, on land, and make for the nearest gate', () => {
    const c = newCity();
    const w = raid(c, 8, 0, 0);
    expect(w.foes).toHaveLength(8);
    const { half } = c.grid;
    for (const f of w.foes) {
      expect(foeGround(c, f.x, f.z)).toBe(true);
      expect(Math.max(Math.abs(f.x), Math.abs(f.z))).toBeGreaterThan(half * 0.6);
    }
    // They come from the east, for a gate on the east side.
    const gate = c.gates.find((g) => g.name === w.gate)!;
    expect(Math.cos(gate.angle)).toBeGreaterThan(0.3);
    expect(sendRaid(c, 4)).toBe('Zaten bir akın sürüyor.');
    expect(c.notices.some((n) => n.text.includes('geliyor'))).toBe(true);
  });

  it('come when due, after the city has heard of them, and slow the city while they are on', () => {
    const c = newCity();
    const due = c.raids.next;
    simulateDays(c, due - c.calendar.day - war.raids.warn * 30 - 1);
    expect(c.notices.some((n) => n.text.startsWith('Casuslar'))).toBe(false);
    simulateDays(c, 2);
    expect(c.notices.some((n) => n.text.startsWith('Casuslar'))).toBe(true);
    simulateDays(c, due - c.calendar.day);
    warStep(c, 0.1, new Map());
    expect(c.war).not.toBeNull();
    expect(c.raids.count).toBe(1);
    expect(c.raids.next).toBeGreaterThan(due);
    // A second of battle is a sliver of a day.
    const day = c.calendar.day;
    c.calendar.speed = 1;
    stepTime(c, 1);
    expect(c.calendar.day - day + c.calendar.fraction).toBeLessThan(0.2);
  });

  it('pillage the suburbs of an undefended city and leave with the plunder', () => {
    const c = newCity();
    const akce = c.treasury;
    const people = c.population;
    raid(c, 4);
    fight(c, 600);
    expect(c.war).toBeNull();
    expect(c.treasury).toBeLessThan(akce * 0.9);
    expect(c.population).toBeLessThan(people);
    expect(c.notices.some((n) => n.text.includes('yağmayla çekildi'))).toBe(true);
  });
});

describe('battle', () => {
  it('is won by an army standing before the gate: the raiders fall or flee, and both sides lose men', () => {
    const c = withArmy({ mizrakci: 8, okcu: 4 });
    const akce = c.treasury;
    const w = raid(c, 4);
    const face = Math.atan2(w.exit.x - w.target.x, w.exit.z - w.target.z);
    marchOrder(
      c,
      c.army.units.map((u) => u.id),
      w.target.x,
      w.target.z,
      face,
    );
    fight(c, 900);
    expect(c.war).toBeNull();
    expect(c.notices.some((n) => n.text.startsWith('Zafer'))).toBe(true);
    // Nothing plundered; the loot of the fallen taken.
    expect(c.treasury).toBeGreaterThan(akce);
    const men = c.army.units.reduce((s, u) => s + u.men, 0);
    expect(men).toBeLessThan(1200);
  });

  it('sends taburs against a raider, and they march out to meet it', () => {
    const c = withArmy({ mizrakci: 4 });
    const w = raid(c, 2);
    // Let the raiders come some way first.
    fight(c, 20);
    const foe = w.foes[0];
    const ids = c.army.units.map((u) => u.id);
    expect(attackOrder(c, ids, foe.id)).toBe(4);
    // From the barracks, straight out towards it.
    expect(c.army.units.every((u) => u.field !== null)).toBe(true);
    warStep(c, 0.1, where(c));
    const near = c.army.units.map((u) => Math.hypot(u.field!.x - foe.x, u.field!.z - foe.z));
    expect(Math.min(...near)).toBeLessThan(8);
    expect(foeAt(c, foe.x, foe.z, 0.1)?.id).toBe(foe.id);
  });

  it('moves taburs near their foe itself, step by step, without new marches, until they are at blows', () => {
    const c = withArmy({ mizrakci: 2 });
    const w = raid(c, 1, 1, 0);
    fight(c, 20);
    const foe = w.foes[0];
    const ids = c.army.units.map((u) => u.id);
    attackOrder(c, ids, foe.id);
    // Out of the barracks, near it: taken in hand.
    warStep(c, 0.1, where(c));
    expect(ids.every((id) => c.war!.fighters[id].pos !== null)).toBe(true);
    const revision = c.revision.army;
    let met = false;
    fight(c, 30, (city) => {
      if (ids.some((id) => city.war?.fighters[id]?.state === 'fight')) met = true;
    });
    expect(met).toBe(true);
    // No march was ordered for each step of the way: only a few changes of state.
    expect(c.revision.army - revision).toBeLessThan(6);
    // Held where the battle has them: the post in the field follows.
    const u = c.army.units[0];
    const f = c.war?.fighters[u.id];
    if (f?.pos != null) expect(Math.hypot(u.field!.x - f.pos.x, u.field!.z - f.pos.z)).toBeLessThan(1e-6);
  });

  it('breaks the morale of the outnumbered, who run for the barracks', () => {
    const c = withArmy({ mizrakci: 1 });
    const w = raid(c, 8, 1, 0);
    const u = c.army.units[0];
    // One tabur alone in the raiders' way.
    marchOrder(c, [u.id], w.target.x, w.target.z, 0);
    let ran = false;
    fight(c, 300, (city) => {
      if (city.war?.fighters[u.id]?.state === 'rout') ran = true;
    });
    const still = c.army.units.find((x) => x.id === u.id);
    expect(ran || still === undefined).toBe(true);
    if (still !== undefined) expect(still.field).toBeNull();
    expect(c.notices.some((n) => n.text.includes('bozguna') || n.text.includes('kırıldı'))).toBe(true);
  });

  it('comes back from a save in the middle of the fighting', () => {
    const c = withArmy({ mizrakci: 2 });
    raid(c, 3);
    fight(c, 15);
    const again = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(again.war).not.toBeNull();
    expect(again.war!.foes.map((f) => [f.kind, f.men])).toEqual(c.war!.foes.map((f) => [f.kind, f.men]));
    expect(again.raids).toEqual(c.raids);
    fight(again, 600);
    expect(again.war).toBeNull();
  });

  it('makes the depleted taburs in the barracks whole again, for akçe and men', () => {
    const c = withArmy({ mizrakci: 2 });
    for (const u of c.army.units) u.men -= 30;
    const offer = replenishOffer(c, 'mizrakci');
    expect(offer.men).toBe(60);
    const akce = c.treasury;
    const people = c.population;
    expect(replenish(c, 'mizrakci')).toBe(60);
    expect(c.army.units.every((u) => u.men === balance.army.units.mizrakci.men)).toBe(true);
    expect(akce - c.treasury).toBeCloseTo(offer.cost, 0);
    expect(people - c.population).toBe(60);
  });
});
