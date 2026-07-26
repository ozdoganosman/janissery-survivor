import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { createRng } from '../src/core/rng';
import {
  BOSS_ENTRIES,
  createDirector,
  effectiveTarget,
  pickKind,
  stageAt,
  stepDirector,
  WAVE_STAGES,
  type WaveStage,
} from '../src/sim/director';
import { countBosses, countElites, despawnDistant, EnemyPool } from '../src/sim/enemies';
import { BEHAVIOUR, ENEMY_TYPES } from '../src/sim/enemy-types';

const SPAWN_RADIUS = 34;

/** Runs the director for a stretch of time, holding the player still. */
function run(
  seconds: number,
  options: { from?: number; target?: number; cap?: number; pool?: EnemyPool } = {},
): { pool: EnemyPool; spawned: number } {
  const pool = options.pool ?? new EnemyPool(2000);
  const director = createDirector();
  const rng = createRng(19);
  let elapsed = options.from ?? 0;
  let spawned = 0;
  for (let i = 0; i < seconds / TICK_SECONDS; i++) {
    elapsed += TICK_SECONDS;
    spawned += stepDirector(
      director,
      pool,
      rng,
      0,
      0,
      SPAWN_RADIUS,
      elapsed,
      TICK_SECONDS,
      options.target ?? 0,
      options.cap ?? 0,
    );
  }
  return { pool, spawned };
}

describe('the wave table', () => {
  it('parses into at least one stage and one boss', () => {
    expect(WAVE_STAGES.length).toBeGreaterThan(0);
    expect(BOSS_ENTRIES.length).toBeGreaterThan(0);
  });

  it('starts at zero, so there is always a stage in force', () => {
    expect(WAVE_STAGES[0].at).toBe(0);
  });

  it('is sorted by time', () => {
    for (let i = 1; i < WAVE_STAGES.length; i++) {
      expect(WAVE_STAGES[i].at).toBeGreaterThan(WAVE_STAGES[i - 1].at);
    }
  });

  it('never reduces the crowd as the run goes on', () => {
    for (let i = 1; i < WAVE_STAGES.length; i++) {
      expect(WAVE_STAGES[i].target).toBeGreaterThanOrEqual(WAVE_STAGES[i - 1].target);
    }
  });

  it('keeps the crowd inside the enemy pool', () => {
    for (const stage of WAVE_STAGES) expect(stage.target).toBeLessThanOrEqual(2000);
  });

  it('keeps every elite chance a probability', () => {
    for (const stage of WAVE_STAGES) {
      expect(stage.eliteChance).toBeGreaterThanOrEqual(0);
      expect(stage.eliteChance).toBeLessThanOrEqual(1);
    }
  });

  it('never lists an enemy the bestiary does not have', () => {
    for (const stage of WAVE_STAGES) {
      for (const entry of stage.weights) {
        expect(ENEMY_TYPES[entry.kind]).toBeDefined();
      }
    }
  });

  it('never puts a boss in the ordinary crowd', () => {
    // A boss arriving sixty at a time is not a difficulty curve.
    for (const stage of WAVE_STAGES) {
      for (const entry of stage.weights) {
        expect(ENEMY_TYPES[entry.kind].behaviour).not.toBe(BEHAVIOUR.boss);
      }
    }
  });

  it('only ever sends a boss as a boss', () => {
    for (const entry of BOSS_ENTRIES) {
      expect(ENEMY_TYPES[entry.kind].behaviour).toBe(BEHAVIOUR.boss);
      expect(entry.healthScale).toBeGreaterThan(0);
    }
  });

  it('introduces the whole roster before the run ends', () => {
    const introduced = new Set<number>();
    for (const stage of WAVE_STAGES) {
      for (const entry of stage.weights) introduced.add(entry.kind);
    }
    for (const entry of BOSS_ENTRIES) introduced.add(entry.kind);
    expect(introduced.size).toBe(ENEMY_TYPES.length);
  });
});

describe('stageAt', () => {
  it('returns the first stage before anything has happened', () => {
    expect(stageAt(0)).toBe(WAVE_STAGES[0]);
    expect(stageAt(-5)).toBe(WAVE_STAGES[0]);
  });

  it('switches the instant a stage time passes', () => {
    const second = WAVE_STAGES[1];
    expect(stageAt(second.at - 0.001)).toBe(WAVE_STAGES[0]);
    expect(stageAt(second.at)).toBe(second);
  });

  it('holds the last stage forever', () => {
    const last = WAVE_STAGES[WAVE_STAGES.length - 1];
    expect(stageAt(last.at + 10_000)).toBe(last);
  });
});

describe('pickKind', () => {
  const stage = (weights: { kind: number; weight: number }[]): WaveStage => ({
    at: 0,
    target: 10,
    eliteChance: 0,
    formation: 0,
    weights,
  });

  it('always returns a kind that is actually listed', () => {
    const listed = stage([
      { kind: 0, weight: 1 },
      { kind: 2, weight: 3 },
    ]);
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) expect([0, 2]).toContain(pickKind(listed, rng));
  });

  it('respects the weights', () => {
    const listed = stage([
      { kind: 0, weight: 9 },
      { kind: 1, weight: 1 },
    ]);
    const rng = createRng(31);
    let ones = 0;
    for (let i = 0; i < 4000; i++) if (pickKind(listed, rng) === 1) ones++;
    expect(ones / 4000).toBeGreaterThan(0.06);
    expect(ones / 4000).toBeLessThan(0.14);
  });

  it('handles a single entry', () => {
    const rng = createRng(1);
    expect(pickKind(stage([{ kind: 4, weight: 1 }]), rng)).toBe(4);
  });
});

describe('effectiveTarget', () => {
  const stage = WAVE_STAGES[0];

  it('uses the stage when nothing else is asked for', () => {
    expect(effectiveTarget(stage)).toBe(stage.target);
  });

  it('lets an override replace the stage in either direction', () => {
    expect(effectiveTarget(stage, 600)).toBe(600);
    expect(effectiveTarget(stage, 10)).toBe(10);
  });

  it('only ever removes enemies with a cap', () => {
    // The bug this exists to prevent: a cap treated as a target made the *lowest*
    // quality tier raise the opening minute from 55 bodies to 140.
    expect(effectiveTarget(stage, 0, 140)).toBe(Math.min(stage.target, 140));
    expect(effectiveTarget(stage, 0, 140)).toBeLessThanOrEqual(stage.target);
    const late = WAVE_STAGES[WAVE_STAGES.length - 1];
    expect(effectiveTarget(late, 0, 140)).toBe(140);
  });

  it('applies the cap to an override too', () => {
    expect(effectiveTarget(stage, 600, 140)).toBe(140);
  });

  it('treats zero as "not set" for both', () => {
    expect(effectiveTarget(stage, 0, 0)).toBe(stage.target);
  });
});

describe('stepDirector', () => {
  it('never exceeds a quality cap, at any point in the run', () => {
    for (const from of [0, 300, 700]) {
      const { pool } = run(60, { from, cap: 90 });
      expect(pool.count).toBeLessThanOrEqual(90);
    }
  });

  it('does not let a cap inflate an early stage', () => {
    const uncapped = run(45).pool.count;
    const capped = run(45, { cap: 140 }).pool.count;
    expect(capped).toBeLessThanOrEqual(uncapped);
  });

  it('fills the crowd up to the stage target and then stops', () => {
    const { pool } = run(60);
    expect(pool.count).toBe(WAVE_STAGES[0].target);
  });

  it('honours a target override, for measuring the frame budget', () => {
    const { pool } = run(30, { target: 25 });
    expect(pool.count).toBe(25);
  });

  it('does not bank a backlog while at capacity', () => {
    // Credit accumulated at capacity would arrive all at once the moment a gap opens,
    // which is a wall of a hundred enemies rather than a wave.
    const pool = new EnemyPool(2000);
    run(120, { pool });
    const target = pool.count;

    // Clear most of the crowd, then let a single step run.
    while (pool.count > 5) pool.kill(pool.count - 1);
    const { spawned } = run(TICK_SECONDS * 1.5, { pool, from: 60 });
    expect(spawned).toBeLessThan(target / 2);
  });

  it('refills after the crowd is cleared', () => {
    const pool = new EnemyPool(2000);
    run(60, { pool });
    while (pool.count > 0) pool.kill(pool.count - 1);
    run(30, { pool, from: 60 });
    expect(pool.count).toBeGreaterThan(WAVE_STAGES[0].target * 0.8);
  });

  it('grows the crowd as the run goes on', () => {
    const early = run(60).pool.count;
    const late = run(60, { from: 600 }).pool.count;
    expect(late).toBeGreaterThan(early);
  });

  it('spawns clear of the screen, so nothing appears on top of the player', () => {
    const { pool } = run(60);
    for (let i = 0; i < pool.count; i++) {
      expect(Math.hypot(pool.x[i], pool.z[i])).toBeGreaterThanOrEqual(SPAWN_RADIUS);
    }
  });

  it('releases each boss exactly once, on time', () => {
    const first = BOSS_ENTRIES[0];
    const pool = new EnemyPool(2000);
    const director = createDirector();
    const rng = createRng(2);

    let elapsed = first.at - 1;
    let bosses = 0;
    for (let i = 0; i < 30 / TICK_SECONDS; i++) {
      elapsed += TICK_SECONDS;
      stepDirector(director, pool, rng, 0, 0, SPAWN_RADIUS, elapsed, TICK_SECONDS);
      bosses = Math.max(bosses, countBosses(pool));
    }
    expect(bosses).toBe(1);
    expect(countBosses(pool)).toBe(1);
  });

  it('does not re-release a boss that has been killed', () => {
    const first = BOSS_ENTRIES[0];
    const pool = new EnemyPool(2000);
    const director = createDirector();
    const rng = createRng(2);

    let elapsed = first.at;
    for (let i = 0; i < 5 / TICK_SECONDS; i++) {
      elapsed += TICK_SECONDS;
      stepDirector(director, pool, rng, 0, 0, SPAWN_RADIUS, elapsed, TICK_SECONDS);
    }
    for (let i = 0; i < pool.count; i++) {
      if (pool.typeOf(i).behaviour === BEHAVIOUR.boss) {
        pool.kill(i);
        break;
      }
    }
    for (let i = 0; i < 60 / TICK_SECONDS; i++) {
      elapsed += TICK_SECONDS;
      stepDirector(director, pool, rng, 0, 0, SPAWN_RADIUS, elapsed, TICK_SECONDS);
    }
    expect(countBosses(pool)).toBe(0);
  });

  it('releases a boss even when the crowd is already at capacity', () => {
    // The boss is spawned before the top-up, so a full field cannot swallow the
    // fight the run is built around.
    const first = BOSS_ENTRIES[0];
    const pool = new EnemyPool(2000);
    run(first.at - 5, { pool });
    const before = pool.count;
    run(10, { pool, from: first.at - 5 });
    expect(countBosses(pool)).toBe(1);
    expect(pool.count).toBeGreaterThanOrEqual(before);
  });

  it('produces no elites in the opening minute', () => {
    expect(WAVE_STAGES[0].eliteChance).toBe(0);
    expect(countElites(run(60).pool)).toBe(0);
  });

  it('produces elites once the table allows them', () => {
    const { pool } = run(120, { from: 700 });
    expect(countElites(pool)).toBeGreaterThan(0);
  });

  it('brings more than one creature by the late stages', () => {
    const { pool } = run(180, { from: 600 });
    const kinds = new Set(Array.from(pool.kind.subarray(0, pool.count)));
    expect(kinds.size).toBeGreaterThan(2);
  });

  it('drifts the arrival bearing rather than pinning it', () => {
    // A stream that came from one fixed direction forever would let the player simply
    // walk the other way for fifteen minutes.
    const director = createDirector();
    const pool = new EnemyPool(2000);
    const rng = createRng(8);
    for (let i = 0; i < 60 / TICK_SECONDS; i++) {
      stepDirector(director, pool, rng, 0, 0, SPAWN_RADIUS, i * TICK_SECONDS, TICK_SECONDS);
    }
    expect(director.bearing).toBeGreaterThan(1);
  });

  it('is reproducible from its seed', () => {
    const once = (): number[] => {
      const { pool } = run(90, { from: 400 });
      return [...pool.x.subarray(0, pool.count), ...pool.kind.subarray(0, pool.count)];
    };
    expect(once()).toEqual(once());
  });

  it('leaves the boss standing when the player runs away from it', () => {
    // The despawn rule and the once-only release would otherwise combine into a way
    // to delete the fight by walking.
    const first = BOSS_ENTRIES[0];
    const pool = new EnemyPool(2000);
    run(10, { pool, from: first.at });
    expect(countBosses(pool)).toBe(1);
    despawnDistant(pool, 900, 900, 52);
    expect(countBosses(pool)).toBe(1);
  });
});
