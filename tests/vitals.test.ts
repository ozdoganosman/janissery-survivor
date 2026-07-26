import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { EnemyPool } from '../src/sim/enemies';
import { SpatialGrid } from '../src/sim/spatial';
import { createVitals, heal, MAX_HEALTH, stepVitals } from '../src/sim/vitals';

function crowdAt(count: number, x: number, z: number) {
  const enemies = new EnemyPool(64);
  for (let i = 0; i < count; i++) enemies.spawn(x + i * 0.05, z, 0);
  const grid = new SpatialGrid(2, 64);
  grid.rebuild(enemies.count, enemies.x, enemies.z);
  return grid;
}

/** Runs long enough for several immunity windows to elapse. */
function endure(grid: SpatialGrid, seconds: number, armour = 0, regen = 0) {
  const vitals = createVitals();
  const steps = Math.round(seconds / TICK_SECONDS);
  let total = 0;
  for (let i = 0; i < steps; i++) {
    total += stepVitals(vitals, grid, 0, 0, TICK_SECONDS, armour, regen);
  }
  return { vitals, total };
}

describe('stepVitals', () => {
  it('leaves an untouched player alone', () => {
    const grid = crowdAt(3, 40, 40);
    const { vitals, total } = endure(grid, 3);
    expect(total).toBe(0);
    expect(vitals.health).toBe(MAX_HEALTH);
  });

  it('takes damage from a body in contact', () => {
    const grid = crowdAt(1, 0.4, 0);
    const { vitals, total } = endure(grid, 1);
    expect(total).toBeGreaterThan(0);
    expect(vitals.health).toBeLessThan(MAX_HEALTH);
  });

  it('grants immunity between hits so a crowd cannot delete the player', () => {
    // Without a window, sixty steps a second against a packed crowd is instant death
    // and nothing the player did beforehand mattered.
    const grid = crowdAt(6, 0.3, 0);
    const vitals = createVitals();
    const first = stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 0);
    const second = stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 0);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it('scales with the crowd, but less than linearly', () => {
    // Linear scaling makes the first moment of being surrounded instantly fatal.
    const alone = endure(crowdAt(1, 0.3, 0), 3).total;
    const swarmed = endure(crowdAt(6, 0.3, 0), 3).total;
    expect(swarmed).toBeGreaterThan(alone);
    expect(swarmed).toBeLessThan(alone * 6);
  });

  it('caps how many attackers can count', () => {
    const six = endure(crowdAt(6, 0.3, 0), 3).total;
    const forty = endure(crowdAt(40, 0.3, 0), 3).total;
    expect(forty).toBeCloseTo(six, 5);
  });

  it('reduces damage by armour but never below one', () => {
    const grid = crowdAt(1, 0.3, 0);
    const bare = endure(grid, 3, 0).total;
    const armoured = endure(grid, 3, 3).total;
    expect(armoured).toBeLessThan(bare);
    expect(armoured).toBeGreaterThan(0);

    // A weapon that visibly connects for nothing reads as broken rather than resisted.
    const plated = endure(grid, 3, 9999).total;
    expect(plated).toBeGreaterThan(0);
  });

  it('regenerates over time', () => {
    const grid = crowdAt(1, 40, 40);
    const vitals = createVitals();
    vitals.health = 50;
    for (let i = 0; i < 120; i++) stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 5);
    expect(vitals.health).toBeGreaterThan(50);
  });

  it('does not regenerate past full', () => {
    const grid = crowdAt(1, 40, 40);
    const vitals = createVitals();
    for (let i = 0; i < 240; i++) stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 50);
    expect(vitals.health).toBe(MAX_HEALTH);
  });

  it('dies when health runs out, exactly once', () => {
    const grid = crowdAt(6, 0.3, 0);
    const vitals = createVitals();
    vitals.health = 5;
    let steps = 0;
    while (!vitals.dead && steps < 6000) {
      stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 0);
      steps++;
    }
    expect(vitals.dead).toBe(true);
    expect(vitals.health).toBe(0);
    // A dead player takes no further damage, so the run cannot end twice.
    expect(stepVitals(vitals, grid, 0, 0, TICK_SECONDS, 0, 0)).toBe(0);
  });

  it('raises the hurt flash on damage and decays it once out of reach', () => {
    const contact = crowdAt(1, 0.3, 0);
    const vitals = createVitals();
    stepVitals(vitals, contact, 0, 0, TICK_SECONDS, 0, 0);
    expect(vitals.hurtFlash).toBe(1);

    // Stepping away: while still in contact the flash is renewed every immunity
    // window, so decay can only be observed once nothing is touching the player.
    const clear = crowdAt(1, 40, 40);
    for (let i = 0; i < 60; i++) stepVitals(vitals, clear, 0, 0, TICK_SECONDS, 0, 0);
    expect(vitals.hurtFlash).toBe(0);
  });

  it('never leaves health non-finite', () => {
    const grid = crowdAt(4, 0.3, 0);
    const { vitals } = endure(grid, 5, Number.NaN, Number.NaN);
    expect(Number.isFinite(vitals.health)).toBe(true);
  });
});

describe('heal', () => {
  it('restores up to the maximum', () => {
    const vitals = createVitals();
    vitals.health = 10;
    heal(vitals, 50);
    expect(vitals.health).toBe(60);
    heal(vitals, 500);
    expect(vitals.health).toBe(MAX_HEALTH);
  });

  it('ignores nonsense and does not revive the dead', () => {
    const vitals = createVitals();
    vitals.health = 10;
    heal(vitals, -5);
    heal(vitals, Number.NaN);
    expect(vitals.health).toBe(10);

    vitals.dead = true;
    heal(vitals, 50);
    expect(vitals.health).toBe(10);
  });
});
