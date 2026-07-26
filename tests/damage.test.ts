import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  computeDamage,
  damageOverTime,
  MINIMUM_DAMAGE,
  NO_DEFENCE,
  rollDamage,
  type AttackProfile,
} from '../src/sim/damage';

const PLAIN: AttackProfile = {
  base: 10,
  multiplier: 1,
  criticalChance: 0,
  criticalMultiplier: 2,
};

describe('computeDamage', () => {
  it('passes base damage through unmodified', () => {
    expect(computeDamage(PLAIN, NO_DEFENCE, false)).toBe(10);
  });

  it('applies the multiplier', () => {
    expect(computeDamage({ ...PLAIN, multiplier: 2.5 }, NO_DEFENCE, false)).toBe(25);
  });

  it('applies the critical multiplier on top of the multiplier', () => {
    expect(
      computeDamage({ ...PLAIN, multiplier: 2, criticalMultiplier: 3 }, NO_DEFENCE, true),
    ).toBe(60);
  });

  it('subtracts flat reduction after scaling', () => {
    expect(
      computeDamage({ ...PLAIN, multiplier: 2 }, { flatReduction: 5, percentReduction: 0 }, false),
    ).toBe(15);
  });

  it('applies percent reduction before flat', () => {
    // 10 * 1 = 10, minus half = 5, minus 2 = 3. Reversing the order would give 4.
    expect(computeDamage(PLAIN, { flatReduction: 2, percentReduction: 0.5 }, false)).toBe(3);
  });

  it('crits before reduction, so armour does not scale with luck', () => {
    // Reducing first would make the critical multiply the *reduced* number, so a
    // tough target would resist a lucky hit harder than an ordinary one.
    const armoured = { flatReduction: 4, percentReduction: 0 };
    const normal = computeDamage(PLAIN, armoured, false);
    const critical = computeDamage(PLAIN, armoured, true);
    expect(normal).toBe(6);
    expect(critical).toBe(16);
    // 16, not 12: the crit doubled the full 10 and then lost 4.
    expect(critical).not.toBe(normal * 2);
  });

  it('never falls below the floor, so a connecting hit is never a visible zero', () => {
    const result = computeDamage(PLAIN, { flatReduction: 999, percentReduction: 0.9 }, false);
    expect(result).toBe(MINIMUM_DAMAGE);
  });

  it('caps percent reduction so nothing becomes immune', () => {
    const result = computeDamage(
      { ...PLAIN, base: 1000 },
      { flatReduction: 0, percentReduction: 1 },
      false,
    );
    // Capped at 95%, so 1000 becomes 50 rather than 0.
    expect(result).toBeCloseTo(50, 6);
  });

  it('treats a critical multiplier below 1 as no bonus rather than a penalty', () => {
    expect(computeDamage({ ...PLAIN, criticalMultiplier: 0.5 }, NO_DEFENCE, true)).toBe(10);
  });

  it('returns zero for a weapon with no damage', () => {
    expect(computeDamage({ ...PLAIN, base: 0 }, NO_DEFENCE, false)).toBe(0);
    expect(computeDamage({ ...PLAIN, base: -5 }, NO_DEFENCE, false)).toBe(0);
  });

  it('survives nonsense inputs instead of producing NaN damage', () => {
    // NaN health is unrecoverable: every later comparison against it is false, so the
    // enemy can neither die nor be hit again.
    expect(computeDamage({ ...PLAIN, base: Number.NaN }, NO_DEFENCE, false)).toBe(0);
    expect(
      Number.isFinite(computeDamage({ ...PLAIN, multiplier: Number.NaN }, NO_DEFENCE, false)),
    ).toBe(true);
    expect(
      Number.isFinite(
        computeDamage(PLAIN, { flatReduction: Number.NaN, percentReduction: Number.NaN }, false),
      ),
    ).toBe(true);
  });

  it('treats a negative multiplier as zero rather than healing the target', () => {
    expect(computeDamage({ ...PLAIN, multiplier: -3 }, NO_DEFENCE, false)).toBe(MINIMUM_DAMAGE);
  });
});

describe('rollDamage', () => {
  it('never crits at zero chance', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      expect(rollDamage(PLAIN, NO_DEFENCE, rng).critical).toBe(false);
    }
  });

  it('always crits at full chance', () => {
    const rng = createRng(2);
    const profile = { ...PLAIN, criticalChance: 1 };
    for (let i = 0; i < 200; i++) {
      expect(rollDamage(profile, NO_DEFENCE, rng).critical).toBe(true);
    }
  });

  it('approximates the stated critical rate', () => {
    const rng = createRng(3);
    const profile = { ...PLAIN, criticalChance: 0.25 };
    let crits = 0;
    const trials = 20000;
    for (let i = 0; i < trials; i++) {
      if (rollDamage(profile, NO_DEFENCE, rng).critical) crits++;
    }
    expect(crits / trials).toBeCloseTo(0.25, 2);
  });

  it('reproduces the same hits from the same seed', () => {
    // Whether a hit crits is part of the run, so a replay must land the same ones.
    const once = (): string =>
      Array.from({ length: 40 }, () => {
        const rng = createRng(77);
        return rollDamage({ ...PLAIN, criticalChance: 0.3 }, NO_DEFENCE, rng).critical;
      }).join(',');
    expect(once()).toBe(once());
  });

  it('reports the damage matching its own critical flag', () => {
    const rng = createRng(5);
    const profile = { ...PLAIN, criticalChance: 0.5 };
    for (let i = 0; i < 200; i++) {
      const roll = rollDamage(profile, NO_DEFENCE, rng);
      expect(roll.amount).toBe(computeDamage(profile, NO_DEFENCE, roll.critical));
    }
  });
});

describe('damageOverTime', () => {
  it('scales by the step length so the tick rate does not change the total', () => {
    const perSecond = 30;
    const coarse = damageOverTime(perSecond, 1 / 60) * 60;
    const fine = damageOverTime(perSecond, 1 / 240) * 240;
    expect(coarse).toBeCloseTo(fine, 9);
    expect(coarse).toBeCloseTo(perSecond, 9);
  });

  it('never returns a negative or non-finite amount', () => {
    expect(damageOverTime(-5, 1)).toBe(0);
    expect(damageOverTime(10, -1)).toBe(0);
    expect(damageOverTime(Number.NaN, 1)).toBe(0);
    expect(damageOverTime(10, Number.NaN)).toBe(0);
  });
});
