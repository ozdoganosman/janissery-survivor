import { describe, expect, it } from 'vitest';
import {
  BEHAVIOUR,
  ELITE_EXPERIENCE_MULTIPLIER,
  ELITE_HEALTH_MULTIPLIER,
  ELITE_SCALE_MULTIPLIER,
  ENEMY_KIND_IDS,
  ENEMY_TYPES,
  enemyType,
  enemyTypeIndex,
  parseEnemyType,
} from '../src/sim/enemy-types';
import { MODEL_IDS } from '../src/render/voxel/models';
import { PLAYER_SPEED } from '../src/sim/player';

const VALID = {
  name: 'Test',
  model: 'karakoncolos',
  behaviour: 'chase',
  speed: 1,
  health: 10,
  radius: 0.5,
  scale: 1,
  experience: 1,
  contactDamage: 5,
};

describe('parseEnemyType', () => {
  it('accepts a complete entry', () => {
    const type = parseEnemyType('test', VALID);
    expect(type.behaviour).toBe(BEHAVIOUR.chase);
    expect(type.speed).toBe(1);
  });

  it('defaults the fields a behaviour does not use', () => {
    // A chaser has no shot cooldown, and a table that had to spell out every zero
    // would be unreadable long before the sixth creature.
    const type = parseEnemyType('test', VALID);
    expect(type.shotCooldown).toBe(0);
    expect(type.slamRadius).toBe(0);
    expect(type.waveAmplitude).toBe(0);
  });

  it('rejects anything that is not an object', () => {
    for (const raw of [null, undefined, 3, 'chase', []]) {
      expect(() => parseEnemyType('test', raw)).toThrow(/Invalid enemy/);
    }
  });

  it('rejects an unknown behaviour', () => {
    expect(() => parseEnemyType('test', { ...VALID, behaviour: 'teleport' })).toThrow(/behaviour/);
  });

  it('names the field that is wrong', () => {
    // A mistyped speed otherwise shows up as a creature that teleports, which says
    // nothing about where the mistake was.
    expect(() => parseEnemyType('test', { ...VALID, speed: 'fast' })).toThrow(/speed/);
    expect(() => parseEnemyType('test', { ...VALID, health: 0 })).toThrow(/health/);
    expect(() => parseEnemyType('test', { ...VALID, radius: -1 })).toThrow(/radius/);
    expect(() => parseEnemyType('test', { ...VALID, scale: Number.NaN })).toThrow(/scale/);
  });

  it('rejects a non-finite optional field rather than storing NaN', () => {
    expect(() => parseEnemyType('test', { ...VALID, shotSpeed: Number.POSITIVE_INFINITY })).toThrow(
      /shotSpeed/,
    );
  });

  it('rejects an empty name or model', () => {
    expect(() => parseEnemyType('test', { ...VALID, name: '' })).toThrow(/name/);
    expect(() => parseEnemyType('test', { ...VALID, model: '' })).toThrow(/model/);
  });
});

describe('the bestiary', () => {
  it('loads every declared kind', () => {
    expect(ENEMY_TYPES).toHaveLength(ENEMY_KIND_IDS.length);
    for (const id of ENEMY_KIND_IDS) expect(enemyType(id).id).toBe(id);
  });

  it('keeps the index order the pool depends on', () => {
    // The pool stores kinds as bytes, so the array order is the contract between the
    // table and every typed array that indexes into it.
    ENEMY_KIND_IDS.forEach((id, index) => {
      expect(enemyTypeIndex(id)).toBe(index);
      expect(ENEMY_TYPES[index].id).toBe(id);
    });
  });

  it('names a model that actually exists', () => {
    for (const type of ENEMY_TYPES) {
      expect(MODEL_IDS as readonly string[]).toContain(type.model);
    }
  });

  it('gives every weaving creature something to weave with', () => {
    for (const type of ENEMY_TYPES) {
      if (type.behaviour === BEHAVIOUR.zigzag || type.behaviour === BEHAVIOUR.serpentine) {
        expect(type.waveAmplitude).toBeGreaterThan(0);
        expect(type.waveFrequency).toBeGreaterThan(0);
      }
    }
  });

  it('gives every shooter a range, a rate and a shot worth dodging', () => {
    for (const type of ENEMY_TYPES) {
      if (type.behaviour !== BEHAVIOUR.ranged) continue;
      expect(type.keepDistance).toBeGreaterThan(0);
      expect(type.shotCooldown).toBeGreaterThan(0);
      expect(type.shotDamage).toBeGreaterThan(0);
      // A shot slower than its shooter can never land.
      expect(type.shotSpeed).toBeGreaterThan(type.speed);
    }
  });

  it('gives every boss a warning long enough to leave', () => {
    for (const type of ENEMY_TYPES) {
      if (type.behaviour !== BEHAVIOUR.boss) continue;
      expect(type.slamTelegraph).toBeGreaterThanOrEqual(0.5);
      expect(type.slamCooldown).toBeGreaterThan(type.slamTelegraph);
      expect(type.slamRadius).toBeGreaterThan(0);
      expect(type.slamDamage).toBeGreaterThan(0);
      // Slow enough that walking out of the ring is actually possible...
      expect(type.speed).toBeLessThan(PLAYER_SPEED * 0.5);
      // ...but able to close, or the fight can be skipped by walking away once.
      expect(type.pursuitSpeed).toBeGreaterThan(PLAYER_SPEED);
    }
  });

  it('rewards the harder creatures more', () => {
    // If a Gulyabani were worth what a Karakoncolos is, fighting through a wall would
    // never be better than walking round it.
    expect(enemyType('gulyabani').experience).toBeGreaterThan(enemyType('karakoncolos').experience);
    expect(enemyType('gulyabani').health).toBeGreaterThan(enemyType('karakoncolos').health);
  });

  it('makes the boss unmistakably a boss', () => {
    const boss = enemyType('gulyabaniAgasi');
    for (const type of ENEMY_TYPES) {
      if (type.behaviour === BEHAVIOUR.boss) continue;
      expect(boss.health).toBeGreaterThan(type.health * 10);
      expect(boss.scale).toBeGreaterThan(type.scale);
    }
  });

  it('has an elite bonus worth noticing on all three axes', () => {
    expect(ELITE_HEALTH_MULTIPLIER).toBeGreaterThan(1);
    expect(ELITE_SCALE_MULTIPLIER).toBeGreaterThan(1);
    // The reward has to beat the health, or an elite is only ever a waste of time.
    expect(ELITE_EXPERIENCE_MULTIPLIER).toBeGreaterThan(ELITE_HEALTH_MULTIPLIER);
  });

  it('has a distinct behaviour code per behaviour', () => {
    const codes = Object.values(BEHAVIOUR);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses every behaviour it defines', () => {
    // A behaviour with no creature is a case in the enemy step that nothing exercises.
    const used = new Set(ENEMY_TYPES.map((type) => type.behaviour));
    for (const code of Object.values(BEHAVIOUR)) expect(used).toContain(code);
  });
});
