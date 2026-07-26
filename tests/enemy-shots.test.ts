import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { EnemyShotPool, stepEnemyShots } from '../src/sim/enemy-shots';
import { BEHAVIOUR, ENEMY_TYPES } from '../src/sim/enemy-types';

describe('EnemyShotPool', () => {
  it('rejects an unusable capacity', () => {
    expect(() => new EnemyShotPool(0)).toThrow(RangeError);
    expect(() => new EnemyShotPool(1.5)).toThrow(RangeError);
  });

  it('aims at the target', () => {
    const pool = new EnemyShotPool(8);
    pool.fire(0, 0, 10, 0, 5, 3);
    expect(pool.velocityX[0]).toBeCloseTo(5, 5);
    expect(pool.velocityZ[0]).toBeCloseTo(0, 5);
  });

  it('normalises the aim, so range does not change the speed', () => {
    const pool = new EnemyShotPool(8);
    pool.fire(0, 0, 3, 4, 10, 1);
    pool.fire(0, 0, 300, 400, 10, 1);
    expect(Math.hypot(pool.velocityX[0], pool.velocityZ[0])).toBeCloseTo(10, 4);
    expect(Math.hypot(pool.velocityX[1], pool.velocityZ[1])).toBeCloseTo(10, 4);
  });

  it('refuses a shot with nowhere to go', () => {
    // An enemy standing exactly on the player would otherwise divide by zero and put
    // a NaN shot in the pool, which can never hit and never expires.
    const pool = new EnemyShotPool(8);
    expect(pool.fire(5, 5, 5, 5, 10, 1)).toBe(-1);
    expect(pool.count).toBe(0);
  });

  it('degrades rather than overflowing when full', () => {
    const pool = new EnemyShotPool(2);
    expect(pool.fire(0, 0, 1, 0, 5, 1)).toBe(0);
    expect(pool.fire(0, 0, 1, 0, 5, 1)).toBe(1);
    expect(pool.fire(0, 0, 1, 0, 5, 1)).toBe(-1);
    expect(pool.count).toBe(2);
  });

  it('starts previous position equal to current, so the first frame does not streak', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(7, -3, 8, -3, 5, 1);
    expect(pool.previousX[0]).toBe(7);
    expect(pool.previousZ[0]).toBe(-3);
  });

  it('fills a hole with the last shot rather than leaving a gap', () => {
    const pool = new EnemyShotPool(8);
    pool.fire(0, 0, 1, 0, 5, 1);
    pool.fire(10, 0, 11, 0, 5, 2);
    pool.fire(20, 0, 21, 0, 5, 3);
    pool.remove(0);
    expect(pool.count).toBe(2);
    expect(pool.x[0]).toBe(20);
    expect(pool.damage[0]).toBe(3);
  });

  it('ignores an out-of-range removal', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 1, 0, 5, 1);
    pool.remove(9);
    pool.remove(-1);
    expect(pool.count).toBe(1);
  });
});

describe('stepEnemyShots', () => {
  it('travels at its stated speed', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 1, 0, 6, 1);
    stepEnemyShots(pool, 1000, 1000, 0.5, 0.5);
    expect(pool.x[0]).toBeCloseTo(3, 4);
  });

  it('reports damage instead of applying it', () => {
    // The caller owns the player's health and the immunity window that guards it, so
    // a shot that lands has to come back as a number rather than a side effect.
    const pool = new EnemyShotPool(4);
    pool.fire(2, 0, 0, 0, 8, 7);
    let damage = 0;
    for (let i = 0; i < 60 && pool.count > 0; i++) {
      damage += stepEnemyShots(pool, 0, 0, 0.55, TICK_SECONDS);
    }
    expect(damage).toBe(7);
    expect(pool.count).toBe(0);
  });

  it('adds up several shots landing in one step', () => {
    const pool = new EnemyShotPool(8);
    for (let i = 0; i < 3; i++) pool.fire(1, 0, 0, 0, 20, 4);
    expect(stepEnemyShots(pool, 0, 0, 0.55, TICK_SECONDS)).toBe(12);
    expect(pool.count).toBe(0);
  });

  it('misses when the player is not there', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 0, 10, 20, 5);
    expect(stepEnemyShots(pool, 30, 0, 0.55, 0.1)).toBe(0);
    expect(pool.count).toBe(1);
  });

  it('recycles a shot once it has flown far enough', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 1, 0, 20, 5);
    for (let i = 0; i < 200; i++) stepEnemyShots(pool, 1000, 0, 0.55, TICK_SECONDS);
    expect(pool.count).toBe(0);
  });

  it('examines every shot even as removal shuffles them', () => {
    // Removal moves the last shot into the freed slot; advancing past it would let
    // roughly half of a volley pass straight through the player.
    const pool = new EnemyShotPool(64);
    for (let i = 0; i < 20; i++) pool.fire(1, 0, 0, 0, 20, 1);
    expect(stepEnemyShots(pool, 0, 0, 0.55, TICK_SECONDS)).toBe(20);
    expect(pool.count).toBe(0);
  });

  it('records the previous position for interpolation', () => {
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 1, 0, 6, 1);
    stepEnemyShots(pool, 1000, 1000, 0.55, TICK_SECONDS);
    expect(pool.previousX[0]).toBe(0);
    expect(pool.x[0]).toBeGreaterThan(0);
  });

  it('does not tunnel through the player at a plausible speed', () => {
    // A fast shot stepped once per tick moves a fraction of a unit; if that ever
    // exceeds the hit radius the shot passes through and the enemy is harmless.
    const pool = new EnemyShotPool(4);
    pool.fire(0, 0, 1, 0, 14, 3);
    let damage = 0;
    for (let i = 0; i < 120 && pool.count > 0; i++) {
      damage += stepEnemyShots(pool, 5, 0, 0.55, TICK_SECONDS);
    }
    expect(damage).toBe(3);
  });

  it('leaves an empty pool alone', () => {
    const pool = new EnemyShotPool(4);
    expect(stepEnemyShots(pool, 0, 0, 0.55, TICK_SECONDS)).toBe(0);
  });

  it('keeps every shot in the table slow enough to be caught by a discrete step', () => {
    // Collision is a point test at each step rather than a swept one, so a shot that
    // travels further than the hit radius in a tick can pass straight through the
    // player. This is the balance table's side of that contract.
    const reach = 0.36 + 0.55;
    for (const type of ENEMY_TYPES) {
      if (type.behaviour !== BEHAVIOUR.ranged) continue;
      expect(type.shotSpeed * TICK_SECONDS).toBeLessThan(reach);
    }
  });
});
