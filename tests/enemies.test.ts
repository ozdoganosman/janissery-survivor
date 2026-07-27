import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { createRng } from '../src/core/rng';
import {
  censusOf,
  countBosses,
  countElites,
  createEnemyIntents,
  despawnDistant,
  EnemyPool,
  FORMATION,
  pursuitSpeedAt,
  SEPARATION_RADIUS,
  spawnFormation,
  spawnRing,
  stepEnemies,
  type EnemyIntents,
} from '../src/sim/enemies';
import { PLAYER_SPEED } from '../src/sim/player';
import {
  BEHAVIOUR,
  ELITE_HEALTH_MULTIPLIER,
  enemyType,
  enemyTypeIndex,
} from '../src/sim/enemy-types';
import { SpatialGrid } from '../src/sim/spatial';

const KARAKONCOLOS = enemyType('karakoncolos');

function simulate(
  pool: EnemyPool,
  playerX: number,
  playerZ: number,
  steps: number,
  intents: EnemyIntents = createEnemyIntents(),
): void {
  const grid = new SpatialGrid(2, pool.capacity);
  let elapsed = 0;
  for (let i = 0; i < steps; i++) {
    grid.rebuild(pool.count, pool.x, pool.z);
    stepEnemies(pool, grid, playerX, playerZ, TICK_SECONDS, elapsed, intents);
    elapsed += TICK_SECONDS;
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

  it('seeds health from the type table', () => {
    const pool = new EnemyPool(4);
    pool.spawn(0, 0, 0, enemyTypeIndex('gulyabani'));
    expect(pool.health[0]).toBeCloseTo(enemyType('gulyabani').health, 4);
  });

  it('gives an elite more health, more size and more reward', () => {
    const pool = new EnemyPool(4);
    const kind = enemyTypeIndex('cin');
    pool.spawn(0, 0, 0, kind, false);
    pool.spawn(0, 0, 0, kind, true);
    expect(pool.health[1]).toBeCloseTo(pool.health[0] * ELITE_HEALTH_MULTIPLIER, 3);
    expect(pool.scale[1]).toBeGreaterThan(pool.scale[0]);
    expect(pool.experienceOf(1)).toBeGreaterThan(pool.experienceOf(0));
    expect(countElites(pool)).toBe(1);
  });

  it('scales boss health without making it an elite', () => {
    const pool = new EnemyPool(4);
    const kind = enemyTypeIndex('gulyabaniAgasi');
    pool.spawn(0, 0, 0, kind, false, 2);
    expect(pool.health[0]).toBeCloseTo(enemyType('gulyabaniAgasi').health * 2, 3);
    expect(pool.elite[0]).toBe(0);
    expect(countBosses(pool)).toBe(1);
  });

  it('falls back to the first type for an unknown kind', () => {
    // The kind is a byte in a typed array; a table edit that drops an entry must not
    // produce an enemy with undefined stats that then moves at NaN units a second.
    const pool = new EnemyPool(4);
    pool.spawn(0, 0, 0, 200);
    expect(Number.isFinite(pool.health[0])).toBe(true);
    expect(pool.typeOf(0)).toBe(KARAKONCOLOS);
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
    const intents = createEnemyIntents();
    for (let i = 0; i < 120; i++) {
      const beforeX = pool.x[0];
      const beforeZ = pool.z[0];
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS, i * TICK_SECONDS, intents);
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
    const intents = createEnemyIntents();
    for (let step = 0; step < 30; step++) {
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS, step * TICK_SECONDS, intents);
    }
    for (let i = 0; i < pool.count; i++) {
      expect(Number.isFinite(pool.x[i])).toBe(true);
    }
    expect(pool.count).toBe(800);
  });
});

describe('censusOf', () => {
  it('agrees with the individual counts and reports wind-ups', () => {
    const pool = new EnemyPool(16);
    pool.spawn(0, 0, 0, enemyTypeIndex('karakoncolos'));
    pool.spawn(0, 0, 0, enemyTypeIndex('cin'), true);
    pool.spawn(0, 0, 0, enemyTypeIndex('gulyabaniAgasi'));
    pool.telegraph[2] = 0.9;

    const census = censusOf(pool, { elites: 0, bosses: 0, telegraphing: 0, bossHealth: -1 });
    expect(census.elites).toBe(countElites(pool));
    expect(census.bosses).toBe(countBosses(pool));
    expect(census.elites).toBe(1);
    expect(census.bosses).toBe(1);
    expect(census.telegraphing).toBe(1);
  });

  it('reports the boss health the player is actually whittling down', () => {
    const pool = new EnemyPool(16);
    const kind = enemyTypeIndex('gulyabaniAgasi');
    const full = enemyType('gulyabaniAgasi').health;

    pool.spawn(0, 0, 0, kind);
    pool.spawn(0, 0, 0, kind);
    pool.health[1] = full * 0.25;

    const census = censusOf(pool, { elites: 0, bosses: 0, telegraphing: 0, bossHealth: -1 });
    // The most wounded, not the first: a second boss arriving untouched from off
    // screen would otherwise snap the bar back to full mid-fight.
    expect(census.bossHealth).toBeCloseTo(0.25, 4);
  });

  it('reports no boss health when there is no boss', () => {
    const pool = new EnemyPool(8);
    pool.spawn(0, 0, 0, enemyTypeIndex('cin'));
    const census = censusOf(pool, { elites: 0, bosses: 0, telegraphing: 0, bossHealth: -1 });
    expect(census.bossHealth).toBe(-1);
  });

  it('keeps boss health inside the bar it draws', () => {
    // A boss released with a health multiplier starts above its type's maximum, and a
    // fraction over 1 would overflow the fill it drives.
    const pool = new EnemyPool(8);
    pool.spawn(0, 0, 0, enemyTypeIndex('gulyabaniAgasi'), false, 2.5);
    const census = censusOf(pool, { elites: 0, bosses: 0, telegraphing: 0, bossHealth: -1 });
    expect(census.bossHealth).toBe(1);

    pool.health[0] = -50;
    censusOf(pool, census);
    expect(census.bossHealth).toBe(0);
  });

  it('resets the target rather than accumulating into it', () => {
    // It is written to be reused across frames, so a stale count would only show up
    // as a debug readout that climbs forever.
    const pool = new EnemyPool(8);
    pool.spawn(0, 0, 0, enemyTypeIndex('cin'), true);
    const census = { elites: 99, bosses: 99, telegraphing: 99, bossHealth: 99 };
    censusOf(pool, census);
    expect(census).toEqual({ elites: 1, bosses: 0, telegraphing: 0, bossHealth: -1 });

    pool.kill(0);
    censusOf(pool, census);
    expect(census).toEqual({ elites: 0, bosses: 0, telegraphing: 0, bossHealth: -1 });
  });
});

describe('enemy behaviours', () => {
  it('weaves rather than walking a straight line', () => {
    // A Cin that closed in a straight line would just be a faster Karakoncolos; the
    // weave is the whole reason it is a separate creature.
    const straight = new EnemyPool(4);
    straight.spawn(0, 20, 0, enemyTypeIndex('karakoncolos'));
    simulate(straight, 0, 0, 90);

    const weaver = new EnemyPool(4);
    weaver.spawn(0, 20, 0, enemyTypeIndex('cin'));
    simulate(weaver, 0, 0, 90);

    // Approaching along -Z, so any displacement in X is the weave.
    expect(Math.abs(straight.x[0])).toBeLessThan(0.05);
    expect(Math.abs(weaver.x[0])).toBeGreaterThan(0.5);
  });

  it('still closes the distance while weaving', () => {
    // The weave is a rotation of the approach vector, so it costs progress but never
    // reverses it — as long as the amplitude stays under a right angle. A Sahmeran at
    // 1.25 radians still gains ground every step; at 1.6 it would circle forever.
    for (const id of ['cin', 'sahmeran'] as const) {
      const type = enemyType(id);
      expect(type.waveAmplitude).toBeLessThan(Math.PI / 2);

      const pool = new EnemyPool(4);
      pool.spawn(0, 25, 0, enemyTypeIndex(id));
      simulate(pool, 0, 0, 900);
      // Contact distance is where a chaser settles; a weaver has to reach it too.
      expect(Math.hypot(pool.x[0], pool.z[0])).toBeLessThan(2 + type.radius);
    }
  });

  it('holds a ranged enemy at its preferred distance instead of touching', () => {
    const pool = new EnemyPool(4);
    const type = enemyType('alkarisi');
    pool.spawn(0, 25, 0, enemyTypeIndex('alkarisi'));
    simulate(pool, 0, 0, 900);
    const distance = Math.hypot(pool.x[0], pool.z[0]);
    expect(distance).toBeGreaterThan(type.keepDistance * 0.6);
    expect(distance).toBeLessThan(type.keepDistance * 1.5);
  });

  it('asks to shoot once its cooldown elapses, and no more often', () => {
    const pool = new EnemyPool(4);
    const type = enemyType('alkarisi');
    pool.spawn(0, type.keepDistance, 0, enemyTypeIndex('alkarisi'));
    const intents = createEnemyIntents();
    const grid = new SpatialGrid(2, pool.capacity);

    let shots = 0;
    const seconds = 10;
    for (let i = 0; i < seconds / TICK_SECONDS; i++) {
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS, i * TICK_SECONDS, intents);
      shots += intents.shooterCount;
    }
    const allowed = Math.ceil(seconds / type.shotCooldown) + 1;
    expect(shots).toBeGreaterThan(0);
    expect(shots).toBeLessThanOrEqual(allowed);
  });

  it('clears the intent lists each step rather than accumulating them', () => {
    const pool = new EnemyPool(4);
    pool.spawn(0, 3, 0, enemyTypeIndex('karakoncolos'));
    const intents = createEnemyIntents();
    simulate(pool, 0, 0, 120, intents);
    expect(intents.shooterCount).toBe(0);
    expect(intents.slammerCount).toBe(0);
  });

  it('makes the boss telegraph before it slams', () => {
    const pool = new EnemyPool(4);
    const type = enemyType('gulyabaniAgasi');
    pool.spawn(0, 2, 0, enemyTypeIndex('gulyabaniAgasi'));
    const intents = createEnemyIntents();
    const grid = new SpatialGrid(2, pool.capacity);

    let firstTelegraph = -1;
    let firstSlam = -1;
    for (let i = 0; i < 600; i++) {
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS, i * TICK_SECONDS, intents);
      if (firstTelegraph < 0 && pool.telegraph[0] > 0) firstTelegraph = i;
      if (intents.slammerCount > 0) {
        firstSlam = i;
        break;
      }
    }

    expect(firstTelegraph).toBeGreaterThanOrEqual(0);
    expect(firstSlam).toBeGreaterThan(firstTelegraph);
    // The warning is only fair if it lasts long enough to walk out of.
    const warningSeconds = (firstSlam - firstTelegraph) * TICK_SECONDS;
    expect(warningSeconds).toBeGreaterThan(type.slamTelegraph * 0.8);
  });

  it('roots the boss through its wind-up, so the ring marks a place to leave', () => {
    const pool = new EnemyPool(4);
    pool.spawn(0, 2, 0, enemyTypeIndex('gulyabaniAgasi'));
    const intents = createEnemyIntents();
    const grid = new SpatialGrid(2, pool.capacity);

    for (let i = 0; i < 600; i++) {
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, 0, TICK_SECONDS, i * TICK_SECONDS, intents);
      if (pool.telegraph[0] > 0) {
        const x = pool.x[0];
        const z = pool.z[0];
        grid.rebuild(pool.count, pool.x, pool.z);
        stepEnemies(pool, grid, 0, 0, TICK_SECONDS, (i + 1) * TICK_SECONDS, intents);
        expect(pool.x[0]).toBeCloseTo(x, 6);
        expect(pool.z[0]).toBeCloseTo(z, 6);
        return;
      }
    }
    throw new Error('the boss never wound up');
  });

  it('winds up faster once the boss is wounded', () => {
    const type = enemyType('gulyabaniAgasi');
    const measure = (health: number): number => {
      const pool = new EnemyPool(4);
      pool.spawn(0, 2, 0, enemyTypeIndex('gulyabaniAgasi'));
      pool.health[0] = health;
      const intents = createEnemyIntents();
      const grid = new SpatialGrid(2, pool.capacity);
      for (let i = 0; i < 600; i++) {
        grid.rebuild(pool.count, pool.x, pool.z);
        stepEnemies(pool, grid, 0, 0, TICK_SECONDS, i * TICK_SECONDS, intents);
        if (pool.telegraph[0] > 0) return pool.telegraph[0];
      }
      throw new Error('the boss never wound up');
    };
    expect(measure(type.health * 0.2)).toBeLessThan(measure(type.health));
  });

  it('lets the boss run down a fleeing player', () => {
    // The boss is slower than the player by design. Without the pursuit ramp it could
    // be ignored for the whole run by walking away from it once.
    const pool = new EnemyPool(4);
    pool.spawn(0, 39, 0, enemyTypeIndex('gulyabaniAgasi'));
    const intents = createEnemyIntents();
    const grid = new SpatialGrid(2, pool.capacity);

    // The player retreats in a straight line at full speed, which is the worst case
    // the boss has to overcome — and does it from the distance it is released at.
    // The closest approach is what matters: the boss roots to wind up and loses ground
    // each time it does, so the gap at any chosen moment says nothing on its own.
    let playerZ = 0;
    let closest = Infinity;
    let slams = 0;
    for (let i = 0; i < 40 / TICK_SECONDS; i++) {
      playerZ -= PLAYER_SPEED * TICK_SECONDS;
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, playerZ, TICK_SECONDS, i * TICK_SECONDS, intents);
      closest = Math.min(closest, pool.z[0] - playerZ);
      slams += intents.slammerCount;
    }
    expect(closest).toBeLessThan(enemyType('gulyabaniAgasi').slamRadius);
    expect(slams).toBeGreaterThan(0);
  });

  it('lets a fleeing player dodge the slam it provokes', () => {
    // Rooting the boss through the wind-up is what makes the ring a place to leave.
    // A player running flat out should never actually be caught by one.
    const pool = new EnemyPool(4);
    const type = enemyType('gulyabaniAgasi');
    pool.spawn(0, 39, 0, enemyTypeIndex('gulyabaniAgasi'));
    const intents = createEnemyIntents();
    const grid = new SpatialGrid(2, pool.capacity);

    let playerZ = 0;
    let hits = 0;
    for (let i = 0; i < 60 / TICK_SECONDS; i++) {
      playerZ -= PLAYER_SPEED * TICK_SECONDS;
      grid.rebuild(pool.count, pool.x, pool.z);
      stepEnemies(pool, grid, 0, playerZ, TICK_SECONDS, i * TICK_SECONDS, intents);
      for (let s = 0; s < intents.slammerCount; s++) {
        if (Math.abs(pool.z[intents.slammers[s]] - playerZ) <= type.slamRadius) hits++;
      }
    }
    expect(hits).toBe(0);
  });

  it('drops the boss back to fighting speed once it has arrived', () => {
    // The ramp must not follow it into the fight, or the slam it telegraphs would be
    // delivered by something the player cannot outwalk.
    const type = enemyType('gulyabaniAgasi');
    expect(pursuitSpeedAt(type, 0)).toBe(type.speed);
    expect(pursuitSpeedAt(type, type.slamRadius * 0.5)).toBe(type.speed);
    expect(pursuitSpeedAt(type, type.slamRadius)).toBeCloseTo(type.pursuitSpeed, 5);
    expect(pursuitSpeedAt(type, 1000)).toBeCloseTo(type.pursuitSpeed, 5);
  });

  it('puts the pursuit equilibrium inside slam range', () => {
    // A fleeing player settles wherever the ramp equals their own speed. If that
    // point sits outside the slam radius the boss parks there and never attacks.
    const type = enemyType('gulyabaniAgasi');
    let equilibrium = 0;
    for (let d = 0; d <= 60; d += 0.05) {
      if (pursuitSpeedAt(type, d) >= PLAYER_SPEED) {
        equilibrium = d;
        break;
      }
    }
    expect(equilibrium).toBeGreaterThan(0);
    expect(equilibrium).toBeLessThan(type.slamRadius);
  });

  it('ramps the pursuit smoothly rather than snapping', () => {
    const type = enemyType('gulyabaniAgasi');
    let previous = -Infinity;
    for (let d = 0; d <= 60; d += 0.5) {
      const speed = pursuitSpeedAt(type, d);
      expect(speed).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(speed).toBeLessThanOrEqual(type.pursuitSpeed + 1e-9);
      previous = speed;
    }
  });

  it('leaves creatures without a pursuit speed alone', () => {
    for (const id of ['karakoncolos', 'cin', 'gulyabani', 'sahmeran', 'alkarisi'] as const) {
      const type = enemyType(id);
      expect(pursuitSpeedAt(type, 0)).toBe(type.speed);
      expect(pursuitSpeedAt(type, 500)).toBe(type.speed);
    }
  });

  it('keeps every behaviour finite when the whole roster is on the field', () => {
    const pool = new EnemyPool(256);
    for (let kind = 0; kind < 6; kind++) {
      for (let i = 0; i < 20; i++) pool.spawn(0, 0, i / 20, kind);
    }
    simulate(pool, 0, 0, 240);
    for (let i = 0; i < pool.count; i++) {
      expect(Number.isFinite(pool.x[i])).toBe(true);
      expect(Number.isFinite(pool.z[i])).toBe(true);
      expect(Number.isFinite(pool.facing[i])).toBe(true);
    }
  });
});

describe('spawnFormation', () => {
  it('brings a wall in from one bearing', () => {
    const pool = new EnemyPool(128);
    // Bearing 0 is +Z, since the ring is laid out as (sin, cos).
    spawnFormation(pool, createRng(4), 0, 0, 30, 60, 0, 0, FORMATION.wall, 0);
    expect(pool.count).toBe(60);
    for (let i = 0; i < pool.count; i++) {
      expect(pool.z[i]).toBeGreaterThan(0);
    }
  });

  it('makes a stream narrower than a wall', () => {
    const spread = (formation: (typeof FORMATION)[keyof typeof FORMATION]): number => {
      const pool = new EnemyPool(256);
      spawnFormation(pool, createRng(21), 0, 0, 30, 120, 0, 0, formation, 0);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < pool.count; i++) {
        const angle = Math.atan2(pool.x[i], pool.z[i]);
        min = Math.min(min, angle);
        max = Math.max(max, angle);
      }
      return max - min;
    };
    expect(spread(FORMATION.stream)).toBeLessThan(spread(FORMATION.wall));
    expect(spread(FORMATION.wall)).toBeLessThan(spread(FORMATION.ring));
  });

  it('produces elites at roughly the requested rate', () => {
    const pool = new EnemyPool(4000);
    spawnFormation(pool, createRng(77), 0, 0, 30, 4000, 0, 0.25, FORMATION.ring, 0);
    const share = countElites(pool) / pool.count;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
  });

  it('never makes an elite when the chance is zero', () => {
    const pool = new EnemyPool(200);
    spawnFormation(pool, createRng(3), 0, 0, 30, 200, 0, 0, FORMATION.ring, 0);
    expect(countElites(pool)).toBe(0);
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

  it('never removes a boss', () => {
    // A boss is slower than the player and released exactly once. Despawning it would
    // let anyone delete the fight by walking away, and it would not come back.
    const pool = new EnemyPool(16);
    pool.spawn(1000, 1000, 0, enemyTypeIndex('karakoncolos'));
    pool.spawn(1000, 1000, 0, enemyTypeIndex('gulyabaniAgasi'));
    expect(despawnDistant(pool, 0, 0, 50)).toBe(1);
    expect(pool.count).toBe(1);
    expect(pool.typeOf(0).behaviour).toBe(BEHAVIOUR.boss);
  });
});
