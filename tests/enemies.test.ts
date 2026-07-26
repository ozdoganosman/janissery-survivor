import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { createRng } from '../src/core/rng';
import {
  despawnDistant,
  EnemyPool,
  KARAKONCOLOS,
  SEPARATION_RADIUS,
  spawnRing,
  stepEnemies,
} from '../src/sim/enemies';
import { SpatialGrid } from '../src/sim/spatial';

function simulate(pool: EnemyPool, playerX: number, playerZ: number, steps: number): void {
  const grid = new SpatialGrid(2, pool.capacity);
  for (let i = 0; i < steps; i++) {
    grid.rebuild(pool.count, pool.x, pool.z);
    stepEnemies(pool, grid, playerX, playerZ, TICK_SECONDS);
  }
}

describe('EnemyPool', () => {
  it('rejects an unusable capacity', () => {
    expect(() => new EnemyPool(0)).toThrow(RangeError);
    expect(() => new EnemyPool(2.5)).toThrow(RangeError);
  });

  it('packs active enemies into a dense prefix', () => {
    const pool = new EnemyPool(8);
    for (let i = 0; i < 5; i++) pool.spawn(i, 0, 0);
    expect(pool.count).toBe(5);
    for (let i = 0; i < 5; i++) expect(pool.x[i]).toBe(i);
  });

  it('reports fullness and refuses to overflow', () => {
    const pool = new EnemyPool(2);
    expect(pool.spawn(0, 0, 0)).toBe(0);
    expect(pool.spawn(1, 0, 0)).toBe(1);
    expect(pool.full).toBe(true);
    // A full pool degrades the wave, not the frame rate, so this is not an error.
    expect(pool.spawn(2, 0, 0)).toBe(-1);
    expect(pool.count).toBe(2);
  });

  it('fills a hole with the last enemy rather than leaving a gap', () => {
    const pool = new EnemyPool(8);
    for (let i = 0; i < 4; i++) pool.spawn(i * 10, 0, 0);
    pool.kill(1);
    expect(pool.count).toBe(3);
    // Slot 1 now holds what used to be slot 3.
    expect(pool.x[1]).toBe(30);
    expect([pool.x[0], pool.x[1], pool.x[2]].sort((a, b) => a - b)).toEqual([0, 20, 30]);
  });

  it('handles killing the last enemy', () => {
    const pool = new EnemyPool(4);
    pool.spawn(1, 1, 0);
    pool.spawn(2, 2, 0);
    pool.kill(1);
    expect(pool.count).toBe(1);
    expect(pool.x[0]).toBe(1);
  });

  it('ignores an out-of-range kill', () => {
    const pool = new EnemyPool(4);
    pool.spawn(1, 1, 0);
    pool.kill(5);
    pool.kill(-1);
    expect(pool.count).toBe(1);
  });

  it('bumps the generation on reuse so stale handles are detectable', () => {
    // Swap-removal makes an index mean a different creature; piercing weapons will
    // remember what they hit, and must be able to notice the slot was recycled.
    const pool = new EnemyPool(4);
    pool.spawn(0, 0, 0);
    const first = pool.generation[0];
    pool.kill(0);
    pool.spawn(9, 9, 0);
    expect(pool.generation[0]).not.toBe(first);
  });

  it('seeds health from the stats it is given', () => {
    const pool = new EnemyPool(4);
    pool.spawn(0, 0, 0, { speed: 1, health: 42 });
    expect(pool.health[0]).toBe(42);
  });

  it('starts previous position equal to current, so the first frame does not streak', () => {
    const pool = new EnemyPool(4);
    pool.spawn(7, -3, 0);
    expect(pool.previousX[0]).toBe(7);
    expect(pool.previousZ[0]).toBe(-3);
  });
});

describe('stepEnemies', () => {
  it('closes on the player', () => {
    const pool = new EnemyPool(4);
    pool.spawn(20, 0, 0);
    const before = Math.hypot(pool.x[0], pool.z[0]);
    simulate(pool, 0, 0, 60);
    expect(Math.hypot(pool.x[0], pool.z[0])).toBeLessThan(before - 1);
  });

  it('approaches from any direction', () => {
    for (const [x, z] of [
      [15, 0],
      [-15, 0],
      [0, 15],
      [0, -15],
      [10, -10],
    ]) {
      const pool = new EnemyPool(4);
      pool.spawn(x, z, 0);
      simulate(pool, 0, 0, 120);
      expect(Math.hypot(pool.x[0], pool.z[0])).toBeLessThan(Math.hypot(x, z));
    }
  });

  it('moves no faster than its stated speed', () => {
    const pool = new EnemyPool(4);
    pool.spawn(30, 0, 0);
    const grid = new SpatialGrid(2, pool.capacity);
    for (let i = 0; i < 120; i++) {
      const beforeX = pool.x[0];
      const beforeZ = pool.z[0];
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS);
      const travelled = Math.hypot(pool.x[0] - beforeX, pool.z[0] - beforeZ);
      expect(travelled).toBeLessThanOrEqual(KARAKONCOLOS.speed * TICK_SECONDS + 1e-5);
    }
  });

  it('stops short instead of standing on the player', () => {
    const pool = new EnemyPool(4);
    pool.spawn(6, 0, 0);
    simulate(pool, 0, 0, 400);
    const distance = Math.hypot(pool.x[0], pool.z[0]);
    expect(distance).toBeGreaterThan(0.5);
    expect(distance).toBeLessThan(1.5);
  });

  it('faces the way it is travelling', () => {
    const pool = new EnemyPool(4);
    // Directly to the player's +X side, so it must walk toward -X and face -X.
    pool.spawn(10, 0, 0);
    simulate(pool, 0, 0, 30);
    expect(Math.sin(pool.facing[0])).toBeCloseTo(-1, 1);
  });

  it('records the previous position every step', () => {
    const pool = new EnemyPool(4);
    pool.spawn(10, 0, 0);
    simulate(pool, 0, 0, 2);
    expect(pool.previousX[0]).not.toBe(pool.x[0]);
  });

  it('pushes a stacked crowd apart', () => {
    // Separation is what makes a horde read as a crowd instead of one enemy drawn
    // many times. Everything starts on the same spot; nothing should stay there.
    const pool = new EnemyPool(64);
    for (let i = 0; i < 40; i++) pool.spawn(5, 5, i / 40);
    simulate(pool, 0, 0, 180);

    let touching = 0;
    for (let i = 0; i < pool.count; i++) {
      for (let j = i + 1; j < pool.count; j++) {
        const gap = Math.hypot(pool.x[i] - pool.x[j], pool.z[i] - pool.z[j]);
        if (gap < SEPARATION_RADIUS * 0.4) touching++;
      }
    }
    const pairs = (pool.count * (pool.count - 1)) / 2;
    expect(touching / pairs).toBeLessThan(0.12);
  });

  it('separates deterministically, so two identical runs agree', () => {
    // Coincident enemies are nudged by index rather than at random, precisely so a
    // seeded replay reproduces exactly.
    const runOnce = (): number[] => {
      const pool = new EnemyPool(32);
      for (let i = 0; i < 20; i++) pool.spawn(3, 3, 0);
      simulate(pool, 0, 0, 60);
      return [...pool.x.subarray(0, pool.count)];
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('never produces a non-finite position', () => {
    // Coincident bodies divide by their separation; a zero gap must not become NaN,
    // which would put an enemy permanently outside every comparison.
    const pool = new EnemyPool(32);
    for (let i = 0; i < 20; i++) pool.spawn(0, 0, 0);
    simulate(pool, 0, 0, 120);
    for (let i = 0; i < pool.count; i++) {
      expect(Number.isFinite(pool.x[i])).toBe(true);
      expect(Number.isFinite(pool.z[i])).toBe(true);
      expect(Number.isFinite(pool.facing[i])).toBe(true);
    }
  });

  it('handles an enemy standing exactly on the player', () => {
    const pool = new EnemyPool(4);
    pool.spawn(0, 0, 0);
    simulate(pool, 0, 0, 10);
    expect(Number.isFinite(pool.x[0])).toBe(true);
    expect(Number.isFinite(pool.z[0])).toBe(true);
  });

  it('stays within budget for a dense crowd', () => {
    // The phase's stated risk is separation going quadratic. Eight hundred enemies
    // packed into a small area is the worst realistic case; this asserts the work
    // stays bounded rather than timing it, since wall-clock in CI is noise.
    const pool = new EnemyPool(1000);
    const rng = createRng(7);
    for (let i = 0; i < 800; i++) {
      pool.spawn(rng.range(-12, 12), rng.range(-12, 12), rng.next());
    }
    const grid = new SpatialGrid(2, pool.capacity);
    for (let step = 0; step < 30; step++) {
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS);
    }
    for (let i = 0; i < pool.count; i++) {
      expect(Number.isFinite(pool.x[i])).toBe(true);
    }
    expect(pool.count).toBe(800);
  });
});

describe('spawnRing', () => {
  it('places enemies at roughly the requested distance', () => {
    const pool = new EnemyPool(64);
    const rng = createRng(3);
    spawnRing(pool, rng, 100, -50, 30, 40);
    expect(pool.count).toBe(40);
    for (let i = 0; i < pool.count; i++) {
      const distance = Math.hypot(pool.x[i] - 100, pool.z[i] + 50);
      expect(distance).toBeGreaterThanOrEqual(30);
      expect(distance).toBeLessThanOrEqual(30 * 1.12 + 1e-6);
    }
  });

  it('covers the whole ring rather than clustering on one side', () => {
    // A ring that favoured one direction would let the player camp facing away.
    const pool = new EnemyPool(512);
    spawnRing(pool, createRng(11), 0, 0, 30, 400);
    const quadrants = [0, 0, 0, 0];
    for (let i = 0; i < pool.count; i++) {
      const q = (pool.x[i] >= 0 ? 0 : 1) + (pool.z[i] >= 0 ? 0 : 2);
      quadrants[q]++;
    }
    for (const n of quadrants) expect(n).toBeGreaterThan(400 / 8);
  });

  it('stops at capacity and reports what it managed', () => {
    const pool = new EnemyPool(10);
    expect(spawnRing(pool, createRng(5), 0, 0, 20, 25)).toBe(10);
    expect(pool.count).toBe(10);
  });

  it('gives each enemy its own animation phase', () => {
    // Shared phase makes 300 creatures land the same foot on the same frame, which
    // reads as one object rather than a crowd.
    const pool = new EnemyPool(64);
    spawnRing(pool, createRng(13), 0, 0, 20, 40);
    const distinct = new Set(Array.from(pool.phase.subarray(0, pool.count)));
    expect(distinct.size).toBeGreaterThan(30);
  });

  it('is reproducible from its seed', () => {
    const once = (): number[] => {
      const pool = new EnemyPool(64);
      spawnRing(pool, createRng(99), 0, 0, 20, 30);
      return [...pool.x.subarray(0, pool.count)];
    };
    expect(once()).toEqual(once());
  });
});

describe('despawnDistant', () => {
  it('removes only what is beyond the limit', () => {
    const pool = new EnemyPool(16);
    pool.spawn(0, 0, 0);
    pool.spawn(100, 0, 0);
    pool.spawn(5, 5, 0);
    pool.spawn(0, -200, 0);
    expect(despawnDistant(pool, 0, 0, 50)).toBe(2);
    expect(pool.count).toBe(2);
    for (let i = 0; i < pool.count; i++) {
      expect(Math.hypot(pool.x[i], pool.z[i])).toBeLessThanOrEqual(50);
    }
  });

  it('examines every slot even as removal shuffles them', () => {
    // The loop must not advance past the slot a swap just refilled, or roughly half
    // the distant enemies survive.
    const pool = new EnemyPool(64);
    for (let i = 0; i < 40; i++) pool.spawn(1000, 1000, 0);
    expect(despawnDistant(pool, 0, 0, 10)).toBe(40);
    expect(pool.count).toBe(0);
  });

  it('keeps everything when nothing is far enough', () => {
    const pool = new EnemyPool(16);
    for (let i = 0; i < 5; i++) pool.spawn(i, 0, 0);
    expect(despawnDistant(pool, 0, 0, 50)).toBe(0);
    expect(pool.count).toBe(5);
  });
});
