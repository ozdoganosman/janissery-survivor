import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { GEM_MAGNET_RADIUS, GEM_PICKUP_RADIUS, GemPool, stepGems } from '../src/sim/pickups';

function run(pool: GemPool, playerX: number, playerZ: number, steps: number): number {
  let total = 0;
  for (let i = 0; i < steps; i++) total += stepGems(pool, playerX, playerZ, TICK_SECONDS);
  return total;
}

describe('GemPool', () => {
  it('rejects an unusable capacity', () => {
    expect(() => new GemPool(0)).toThrow(RangeError);
    expect(() => new GemPool(1.5)).toThrow(RangeError);
  });

  it('refuses to overflow', () => {
    const pool = new GemPool(2);
    expect(pool.spawn(0, 0)).toBe(0);
    expect(pool.spawn(1, 1)).toBe(1);
    expect(pool.spawn(2, 2)).toBe(-1);
    expect(pool.count).toBe(2);
  });

  it('fills a hole with the last gem', () => {
    const pool = new GemPool(8);
    for (let i = 0; i < 4; i++) pool.spawn(i * 10, 0);
    pool.remove(1);
    expect(pool.count).toBe(3);
    expect(pool.x[1]).toBe(30);
  });

  it('ignores an out-of-range removal', () => {
    const pool = new GemPool(4);
    pool.spawn(1, 1);
    pool.remove(9);
    pool.remove(-2);
    expect(pool.count).toBe(1);
  });
});

describe('stepGems', () => {
  it('leaves a distant gem exactly where it fell', () => {
    // Gems staying put is what makes clearing ground a decision with a cost: coming
    // back for them means coming back into whatever has filled the space.
    const pool = new GemPool(8);
    pool.spawn(40, 40);
    run(pool, 0, 0, 240);
    expect(pool.x[0]).toBe(40);
    expect(pool.z[0]).toBe(40);
    expect(pool.count).toBe(1);
  });

  it('pulls a gem in once the player is close', () => {
    const pool = new GemPool(8);
    pool.spawn(GEM_MAGNET_RADIUS * 0.9, 0);
    const before = pool.x[0];
    run(pool, 0, 0, 5);
    expect(pool.x[0]).toBeLessThan(before);
  });

  it('collects a gem that reaches the player and reports its value', () => {
    const pool = new GemPool(8);
    pool.spawn(GEM_MAGNET_RADIUS * 0.9, 0, 3);
    const collected = run(pool, 0, 0, 120);
    expect(collected).toBe(3);
    expect(pool.count).toBe(0);
  });

  it('collects a gem dropped straight onto the player', () => {
    const pool = new GemPool(8);
    pool.spawn(0, 0, 1);
    expect(stepGems(pool, 0, 0, TICK_SECONDS)).toBe(1);
    expect(pool.count).toBe(0);
  });

  it('collects every gem in a heap without skipping any', () => {
    // Removal swaps the last gem into the vacated slot, so a loop that advanced
    // after a collection would step straight over roughly half the pile.
    const pool = new GemPool(64);
    for (let i = 0; i < 40; i++) pool.spawn(0, 0, 1);
    expect(stepGems(pool, 0, 0, TICK_SECONDS)).toBe(40);
    expect(pool.count).toBe(0);
  });

  it('honours a widened magnet radius', () => {
    // Pickup range is a planned passive upgrade, so it has to be a parameter rather
    // than a constant baked into the loop.
    const pool = new GemPool(8);
    pool.spawn(6, 0);
    run(pool, 0, 0, 4);
    expect(pool.x[0]).toBe(6);

    run(pool, 0, 0, 4);
    const withMagnet = new GemPool(8);
    withMagnet.spawn(6, 0);
    for (let i = 0; i < 4; i++) stepGems(withMagnet, 0, 0, TICK_SECONDS, 10);
    expect(withMagnet.x[0]).toBeLessThan(6);
  });

  it('stops a gem that leaves the magnet instead of letting it drift', () => {
    // A gem carrying momentum out of range would end up somewhere the player never
    // dropped it, and could drift indefinitely.
    const pool = new GemPool(8);
    pool.spawn(GEM_MAGNET_RADIUS * 0.9, 0);
    run(pool, 0, 0, 3);
    expect(pool.velocityX[0]).not.toBe(0);

    // Player teleports far away; the gem must halt rather than keep sailing.
    stepGems(pool, 500, 500, TICK_SECONDS);
    expect(pool.velocityX[0]).toBe(0);
    const restingX = pool.x[0];
    run(pool, 500, 500, 60);
    expect(pool.x[0]).toBe(restingX);
  });

  it('records the previous position for interpolation', () => {
    const pool = new GemPool(8);
    pool.spawn(GEM_MAGNET_RADIUS * 0.9, 0);
    const start = pool.x[0];
    run(pool, 0, 0, 3);
    expect(pool.previousX[0]).not.toBe(start);
    expect(pool.previousX[0]).not.toBe(pool.x[0]);
  });

  it('never overshoots past the player and orbits forever', () => {
    // A gem accelerating without a speed cap sails through the pickup radius between
    // steps and orbits, never being collected.
    const pool = new GemPool(8);
    pool.spawn(GEM_MAGNET_RADIUS * 0.99, 0);
    const collected = run(pool, 0, 0, 300);
    expect(collected).toBe(1);
  });

  it('keeps positions finite', () => {
    const pool = new GemPool(16);
    for (let i = 0; i < 10; i++) pool.spawn(0, 0);
    run(pool, 0, 0, 30);
    for (let i = 0; i < pool.count; i++) {
      expect(Number.isFinite(pool.x[i])).toBe(true);
    }
  });

  it('leaves a gem just outside pickup range uncollected', () => {
    const pool = new GemPool(8);
    pool.spawn(GEM_PICKUP_RADIUS * 1.5, 0);
    expect(stepGems(pool, 0, 0, TICK_SECONDS)).toBe(0);
    expect(pool.count).toBe(1);
  });
});
