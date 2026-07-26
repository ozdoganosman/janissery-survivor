import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  addExperience,
  createProgression,
  experienceForLevel,
  levelProgress,
} from '../src/sim/progression';
import {
  applyCard,
  createLoadout,
  derivedStats,
  effectiveWeapon,
  MAX_PASSIVES,
  MAX_WEAPON_LEVEL,
  MAX_WEAPONS,
  offerCards,
  PASSIVE_IDS,
  passiveDefinition,
  type Card,
} from '../src/sim/loadout';
import { WEAPON_IDS, weaponStats } from '../src/sim/weapons';

describe('experienceForLevel', () => {
  it('rises with every level', () => {
    for (let level = 1; level < 40; level++) {
      expect(experienceForLevel(level + 1)).toBeGreaterThan(experienceForLevel(level));
    }
  });

  it('starts cheap, so the first upgrades arrive quickly', () => {
    // The opening minutes are where a run has nothing; slow early levels make them
    // feel like nothing is happening.
    expect(experienceForLevel(1)).toBeLessThanOrEqual(6);
  });

  it('grows faster than linearly, so late levels become events', () => {
    const early = experienceForLevel(3) - experienceForLevel(2);
    const late = experienceForLevel(30) - experienceForLevel(29);
    expect(late).toBeGreaterThan(early * 3);
  });

  it('survives nonsense levels', () => {
    expect(Number.isFinite(experienceForLevel(0))).toBe(true);
    expect(Number.isFinite(experienceForLevel(-5))).toBe(true);
    expect(Number.isFinite(experienceForLevel(Number.NaN))).toBe(true);
  });
});

describe('addExperience', () => {
  it('banks without levelling when short of the requirement', () => {
    const progression = createProgression();
    expect(addExperience(progression, 1)).toBe(0);
    expect(progression.level).toBe(1);
    expect(progression.experience).toBe(1);
  });

  it('levels once when the requirement is met', () => {
    const progression = createProgression();
    expect(addExperience(progression, progression.required)).toBe(1);
    expect(progression.level).toBe(2);
    expect(progression.experience).toBe(0);
  });

  it('reports every level a single windfall buys', () => {
    // Several levels can land in one step — walking into a heap of gems — and each
    // is owed a card screen, so the count has to come back rather than a flag.
    const progression = createProgression();
    const gained = addExperience(progression, 500);
    expect(gained).toBeGreaterThan(2);
    expect(progression.level).toBe(1 + gained);
  });

  it('recomputes the requirement as it consumes it', () => {
    // Dividing by a fixed cost would over-award, because each level costs more than
    // the one before.
    const progression = createProgression();
    addExperience(progression, 1000);
    expect(progression.experience).toBeLessThan(progression.required);
  });

  it('tracks a lifetime total separate from the banked amount', () => {
    const progression = createProgression();
    addExperience(progression, 50);
    expect(progression.lifetime).toBe(50);
    expect(progression.experience).toBeLessThan(50);
  });

  it('ignores nonsense amounts', () => {
    const progression = createProgression();
    expect(addExperience(progression, 0)).toBe(0);
    expect(addExperience(progression, -10)).toBe(0);
    expect(addExperience(progression, Number.NaN)).toBe(0);
    expect(progression.level).toBe(1);
  });
});

describe('levelProgress', () => {
  it('runs from zero toward one within a level', () => {
    const progression = createProgression();
    expect(levelProgress(progression)).toBe(0);
    addExperience(progression, progression.required - 1);
    expect(levelProgress(progression)).toBeGreaterThan(0.5);
    expect(levelProgress(progression)).toBeLessThan(1);
  });
});

describe('derivedStats', () => {
  it('is neutral with no passives', () => {
    const stats = derivedStats(createLoadout());
    expect(stats.damageMultiplier).toBe(1);
    expect(stats.cooldownMultiplier).toBe(1);
    expect(stats.amountBonus).toBe(0);
    expect(stats.armour).toBe(0);
  });

  it('accumulates a passive by level', () => {
    const loadout = createLoadout();
    const definition = passiveDefinition('bileyiTasi');
    loadout.passives.set('bileyiTasi', 3);
    const stats = derivedStats(loadout);
    expect(stats.damageMultiplier).toBeCloseTo(1 + definition.perLevel * 3, 9);
  });

  it('floors the cooldown multiplier', () => {
    // At or below zero every weapon would fire every step; the floor is a
    // correctness guard, not a balance decision.
    const loadout = createLoadout();
    loadout.passives.set('muska', 99);
    expect(derivedStats(loadout).cooldownMultiplier).toBeGreaterThan(0);
  });

  it('covers every passive the table declares', () => {
    for (const id of PASSIVE_IDS) {
      const loadout = createLoadout();
      loadout.passives.set(id, 1);
      const stats = derivedStats(loadout);
      const definition = passiveDefinition(id);
      expect(Number.isFinite(stats[definition.stat])).toBe(true);
    }
  });
});

describe('effectiveWeapon', () => {
  const neutral = derivedStats(createLoadout());

  it('matches the base table at level one', () => {
    const base = weaponStats('tirkes');
    const effective = effectiveWeapon('tirkes', 1, neutral);
    expect(effective.damage).toBe(base.damage);
    expect(effective.cooldown).toBeCloseTo(base.cooldown, 9);
  });

  it('applies level deltas cumulatively', () => {
    const base = weaponStats('tirkes');
    const level3 = effectiveWeapon('tirkes', 3, neutral);
    const expected = base.damage + (base.levels[0].damage ?? 0) + (base.levels[1].damage ?? 0);
    expect(level3.damage).toBeCloseTo(expected, 9);
  });

  it('grows monotonically in damage across all eight levels', () => {
    for (const id of WEAPON_IDS) {
      let previous = -Infinity;
      for (let level = 1; level <= MAX_WEAPON_LEVEL; level++) {
        const damage = effectiveWeapon(id, level, neutral).damage;
        expect(damage).toBeGreaterThanOrEqual(previous);
        previous = damage;
      }
    }
  });

  it('clamps a level past the maximum instead of running off the table', () => {
    const capped = effectiveWeapon('yatagan', MAX_WEAPON_LEVEL, neutral);
    expect(effectiveWeapon('yatagan', 99, neutral).damage).toBe(capped.damage);
  });

  it('folds passives in on top of the level', () => {
    const loadout = createLoadout();
    loadout.passives.set('bileyiTasi', 5);
    loadout.passives.set('tilsim', 2);
    const stats = derivedStats(loadout);

    const plain = effectiveWeapon('tirkes', 4, neutral);
    const buffed = effectiveWeapon('tirkes', 4, stats);
    expect(buffed.damage).toBeGreaterThan(plain.damage);
    expect(buffed.amount).toBe(plain.amount + 2);
  });

  it('never produces a cooldown that would fire every step', () => {
    const loadout = createLoadout();
    loadout.passives.set('muska', 5);
    const stats = derivedStats(loadout);
    for (const id of WEAPON_IDS) {
      expect(effectiveWeapon(id, MAX_WEAPON_LEVEL, stats).cooldown).toBeGreaterThan(0.04);
    }
  });
});

describe('offerCards', () => {
  it('offers the requested number of choices', () => {
    expect(offerCards(createLoadout(), createRng(1), 3)).toHaveLength(3);
  });

  it('never repeats an option on one screen', () => {
    // Two identical cards is a choice between the same thing twice.
    for (let seed = 0; seed < 60; seed++) {
      const cards = offerCards(createLoadout(), createRng(seed), 3);
      const keys = cards.map((card) => `${card.kind}:${'id' in card ? card.id : 'heal'}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('offers the next level for a carried weapon, not level one again', () => {
    const loadout = createLoadout('yatagan');
    loadout.weapons.set('yatagan', 4);
    for (let seed = 0; seed < 40; seed++) {
      for (const card of offerCards(loadout, createRng(seed), 3)) {
        if (card.kind === 'weapon' && card.id === 'yatagan') expect(card.level).toBe(5);
      }
    }
  });

  it('stops offering a maxed weapon', () => {
    const loadout = createLoadout('yatagan');
    loadout.weapons.set('yatagan', MAX_WEAPON_LEVEL);
    for (let seed = 0; seed < 60; seed++) {
      for (const card of offerCards(loadout, createRng(seed), 3)) {
        if (card.kind === 'weapon') expect(card.id).not.toBe('yatagan');
      }
    }
  });

  it('stops offering new weapons once the slots are full', () => {
    // An unbounded loadout means every run converges on the same maximal set, and
    // the choice stops being a choice.
    const loadout = createLoadout();
    loadout.weapons.clear();
    for (const id of WEAPON_IDS.slice(0, MAX_WEAPONS)) loadout.weapons.set(id, 2);
    for (let seed = 0; seed < 40; seed++) {
      for (const card of offerCards(loadout, createRng(seed), 3)) {
        if (card.kind === 'weapon') expect(loadout.weapons.has(card.id)).toBe(true);
      }
    }
  });

  it('stops offering new passives once the slots are full', () => {
    const loadout = createLoadout();
    for (const id of PASSIVE_IDS.slice(0, MAX_PASSIVES)) loadout.passives.set(id, 1);
    for (let seed = 0; seed < 40; seed++) {
      for (const card of offerCards(loadout, createRng(seed), 3)) {
        if (card.kind === 'passive') expect(loadout.passives.has(card.id)).toBe(true);
      }
    }
  });

  it('falls back to a heal when nothing is left to give', () => {
    // An empty screen would leave the run unable to continue, since the card screen
    // holds the simulation until something is chosen.
    const loadout = createLoadout();
    loadout.weapons.clear();
    for (const id of WEAPON_IDS) loadout.weapons.set(id, MAX_WEAPON_LEVEL);
    for (const id of PASSIVE_IDS.slice(0, MAX_PASSIVES)) {
      loadout.passives.set(id, passiveDefinition(id).maxLevel);
    }
    const cards = offerCards(loadout, createRng(9), 3);
    expect(cards).toHaveLength(3);
    expect(cards.every((card) => card.kind === 'heal')).toBe(true);
  });

  it('is reproducible from its seed', () => {
    const once = () => JSON.stringify(offerCards(createLoadout(), createRng(404), 3));
    expect(once()).toBe(once());
  });

  it('favours breadth before depth early on', () => {
    // A screen offering only "+damage" three times has technically given a choice and
    // actually given nothing, so acquisitions outweigh upgrades.
    let acquisitions = 0;
    let upgrades = 0;
    for (let seed = 0; seed < 400; seed++) {
      for (const card of offerCards(createLoadout('yatagan'), createRng(seed), 3)) {
        if (card.kind === 'heal') continue;
        if (card.kind === 'weapon' && card.level === 1) acquisitions++;
        else if (card.kind === 'passive' && card.level === 1) acquisitions++;
        else upgrades++;
      }
    }
    expect(acquisitions).toBeGreaterThan(upgrades);
  });
});

describe('applyCard', () => {
  it('adds a weapon at the offered level', () => {
    const loadout = createLoadout();
    const card: Card = {
      kind: 'weapon',
      id: 'tirkes',
      level: 1,
      name: 'Tirkeş',
      describe: '',
    };
    expect(applyCard(loadout, card)).toBe(false);
    expect(loadout.weapons.get('tirkes')).toBe(1);
  });

  it('raises a carried weapon', () => {
    const loadout = createLoadout('yatagan');
    applyCard(loadout, { kind: 'weapon', id: 'yatagan', level: 2, name: '', describe: '' });
    expect(loadout.weapons.get('yatagan')).toBe(2);
    expect(loadout.weapons.size).toBe(1);
  });

  it('adds and raises passives', () => {
    const loadout = createLoadout();
    applyCard(loadout, { kind: 'passive', id: 'kalkan', level: 1, name: '', describe: '' });
    applyCard(loadout, { kind: 'passive', id: 'kalkan', level: 2, name: '', describe: '' });
    expect(loadout.passives.get('kalkan')).toBe(2);
  });

  it('reports a heal so the caller can restore health instead of changing the build', () => {
    const loadout = createLoadout();
    expect(applyCard(loadout, { kind: 'heal', name: '', describe: '' })).toBe(true);
    expect(loadout.weapons.size).toBe(1);
    expect(loadout.passives.size).toBe(0);
  });
});
