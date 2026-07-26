import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import { createRng } from '../src/core/rng';
import { EnemyPool } from '../src/sim/enemies';
import { NO_DEFENCE } from '../src/sim/damage';
import {
  createCombatReport,
  MOTION,
  ProjectilePool,
  resolveHits,
  stepProjectiles,
} from '../src/sim/projectiles';
import { SpatialGrid } from '../src/sim/spatial';
import {
  equip,
  nearestEnemy,
  parseWeaponStats,
  stepWeapons,
  WEAPON_IDS,
  weaponStats,
} from '../src/sim/weapons';

const ATTACK = { base: 0, multiplier: 1, criticalChance: 0, criticalMultiplier: 2 };

function noop(): void {
  /* nothing */
}

describe('the balance table', () => {
  it('defines every weapon the game lists', () => {
    for (const id of WEAPON_IDS) {
      const stats = weaponStats(id);
      expect(stats.name.length).toBeGreaterThan(0);
      expect(stats.cooldown).toBeGreaterThan(0);
      expect(stats.damage).toBeGreaterThan(0);
      expect(stats.duration).toBeGreaterThan(0);
    }
  });

  it('gives the six weapons six distinct motions between them', () => {
    const motions = new Set(WEAPON_IDS.map((id) => weaponStats(id).motion));
    expect(motions.size).toBe(6);
  });

  it('rejects a malformed entry with a message naming the field', () => {
    // The table is hand-edited during tuning; a typo must not surface later as a
    // weapon that silently never fires.
    expect(() => parseWeaponStats('x', null)).toThrow(/expected an object/);
    expect(() => parseWeaponStats('x', { name: '' })).toThrow(/name/);
    expect(() => parseWeaponStats('x', { name: 'a', motion: 'wobble' })).toThrow(/motion/);
    expect(() => parseWeaponStats('x', { name: 'a', motion: 'linear', cooldown: 0 })).toThrow(
      /cooldown/,
    );
    expect(() => parseWeaponStats('x', { name: 'a', motion: 'linear', cooldown: 'fast' })).toThrow(
      /cooldown must be a finite number/,
    );
  });

  it('allows zero speed and knockback, which some weapons genuinely have', () => {
    const stats = parseWeaponStats('x', {
      name: 'a',
      motion: 'aura',
      cooldown: 1,
      damage: 1,
      area: 1,
      speed: 0,
      amount: 1,
      pierce: 1,
      duration: 1,
      knockback: 0,
      hitInterval: 1,
    });
    expect(stats.speed).toBe(0);
    expect(stats.knockback).toBe(0);
  });
});

describe('stepWeapons', () => {
  it('fires each weapon on its own cooldown', () => {
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    const rng = createRng(1);
    const weapon = equip('tirkes');
    weapon.cooldownRemaining = 0;

    let fired = 0;
    const stats = weaponStats('tirkes');
    const steps = Math.round(stats.cooldown / TICK_SECONDS) * 3;
    for (let i = 0; i < steps; i++) {
      fired += stepWeapons([weapon], projectiles, enemies, 0, 0, 0, TICK_SECONDS, rng);
    }
    expect(fired).toBeGreaterThanOrEqual(3);
    expect(fired).toBeLessThanOrEqual(4);
  });

  it('staggers weapons so six do not discharge on the same frame', () => {
    const weapons = WEAPON_IDS.map(equip);
    const starts = new Set(weapons.map((w) => w.cooldownRemaining));
    expect(starts.size).toBe(WEAPON_IDS.length);
  });

  it('does not burst-fire to catch up after a long stall', () => {
    // A dropped frame must not become a damage spike; the cooldown resets rather than
    // accumulating several elapsed periods.
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    const weapon = equip('tirkes');
    weapon.cooldownRemaining = 0;
    const fired = stepWeapons([weapon], projectiles, enemies, 0, 0, 0, 10, createRng(2));
    expect(fired).toBe(1);
    expect(weapon.cooldownRemaining).toBeCloseTo(weaponStats('tirkes').cooldown, 6);
  });

  it('produces the amount the table asks for', () => {
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    const weapon = equip('nazar');
    weapon.cooldownRemaining = 0;
    stepWeapons([weapon], projectiles, enemies, 0, 0, 0, TICK_SECONDS, createRng(3));
    expect(projectiles.count).toBe(weaponStats('nazar').amount);
  });

  it('aims arrows at the nearest enemy', () => {
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    enemies.spawn(0, 12, 0); // far, straight ahead
    enemies.spawn(6, 0, 0); // near, to the right
    const weapon = equip('tirkes');
    weapon.cooldownRemaining = 0;
    stepWeapons([weapon], projectiles, enemies, 0, 0, 0, TICK_SECONDS, createRng(4));

    // Auto-aim is what makes an auto-firing weapon feel like help rather than noise.
    expect(projectiles.velocityX[0]).toBeGreaterThan(0);
    expect(Math.abs(projectiles.velocityZ[0])).toBeLessThan(Math.abs(projectiles.velocityX[0]));
  });

  it('still fires when the field is empty', () => {
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    const weapon = equip('tirkes');
    weapon.cooldownRemaining = 0;
    stepWeapons([weapon], projectiles, enemies, 0, 0, 1.2, TICK_SECONDS, createRng(5));
    expect(projectiles.count).toBe(1);
    expect(Number.isFinite(projectiles.velocityX[0])).toBe(true);
  });

  it('spaces orbiting beads evenly around the circle', () => {
    const projectiles = new ProjectilePool(200);
    const enemies = new EnemyPool(8);
    const weapon = equip('nazar');
    weapon.cooldownRemaining = 0;
    stepWeapons([weapon], projectiles, enemies, 0, 0, 0, TICK_SECONDS, createRng(6));

    const angles = Array.from(projectiles.angle.subarray(0, projectiles.count)).sort(
      (a, b) => a - b,
    );
    const step = (Math.PI * 2) / projectiles.count;
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(step, 5);
    }
  });

  it('stops cleanly when the projectile pool is full', () => {
    const projectiles = new ProjectilePool(2);
    const enemies = new EnemyPool(8);
    const weapon = equip('nazar');
    weapon.cooldownRemaining = 0;
    stepWeapons([weapon], projectiles, enemies, 0, 0, 0, TICK_SECONDS, createRng(7));
    expect(projectiles.count).toBe(2);
  });
});

describe('projectile motion', () => {
  it('carries a straight shot along its velocity', () => {
    const pool = new ProjectilePool(8);
    const index = pool.allocate();
    pool.motion[index] = MOTION.linear;
    pool.x[index] = 0;
    pool.z[index] = 0;
    pool.velocityX[index] = 10;
    pool.velocityZ[index] = 0;
    pool.life[index] = 1;
    pool.maxLife[index] = 1;
    pool.pierce[index] = 1;

    stepProjectiles(pool, 0, 0, 0.1);
    expect(pool.x[0]).toBeCloseTo(1, 6);
  });

  it('keeps an aura pinned to the player wherever they go', () => {
    const pool = new ProjectilePool(8);
    const index = pool.allocate();
    pool.motion[index] = MOTION.aura;
    pool.life[index] = 5;
    pool.maxLife[index] = 5;
    pool.pierce[index] = 999;

    stepProjectiles(pool, 12, -7, 0.1);
    expect(pool.x[0]).toBe(12);
    expect(pool.z[0]).toBe(-7);
  });

  it('grows a shockwave from nothing to its full radius', () => {
    const pool = new ProjectilePool(8);
    const index = pool.allocate();
    pool.motion[index] = MOTION.ring;
    pool.life[index] = 1;
    pool.maxLife[index] = 1;
    pool.targetRadius[index] = 8;
    pool.radius[index] = 0;
    pool.pierce[index] = 999;

    stepProjectiles(pool, 0, 0, 0.5);
    expect(pool.radius[0]).toBeCloseTo(4, 5);
    stepProjectiles(pool, 0, 0, 0.4);
    expect(pool.radius[0]).toBeGreaterThan(7);
  });

  it('holds an orbiting bead at a constant distance from the player', () => {
    const pool = new ProjectilePool(8);
    const index = pool.allocate();
    pool.motion[index] = MOTION.orbit;
    pool.life[index] = 10;
    pool.maxLife[index] = 10;
    pool.pierce[index] = 999;
    pool.angularSpeed[index] = 3;
    pool.anchorRadius[index] = 2;

    for (let i = 0; i < 60; i++) {
      stepProjectiles(pool, 5, 5, TICK_SECONDS);
      expect(Math.hypot(pool.x[0] - 5, pool.z[0] - 5)).toBeCloseTo(2, 5);
    }
  });

  it('retires a projectile when its life runs out', () => {
    const pool = new ProjectilePool(8);
    const index = pool.allocate();
    pool.motion[index] = MOTION.linear;
    pool.life[index] = 0.05;
    pool.maxLife[index] = 0.05;
    pool.pierce[index] = 1;
    stepProjectiles(pool, 0, 0, 0.1);
    expect(pool.count).toBe(0);
  });

  it('examines every slot even as removal shuffles them', () => {
    const pool = new ProjectilePool(64);
    for (let i = 0; i < 40; i++) {
      const index = pool.allocate();
      pool.motion[index] = MOTION.linear;
      pool.life[index] = 0.01;
      pool.maxLife[index] = 0.01;
      pool.pierce[index] = 1;
    }
    stepProjectiles(pool, 0, 0, 0.1);
    expect(pool.count).toBe(0);
  });
});

describe('resolveHits', () => {
  function setup(enemyCount: number) {
    const enemies = new EnemyPool(64);
    for (let i = 0; i < enemyCount; i++) enemies.spawn(i * 0.6, 0, 0, { speed: 1, health: 100 });
    const grid = new SpatialGrid(2, 64);
    grid.rebuild(enemies.count, enemies.x, enemies.z);
    return { enemies, grid, projectiles: new ProjectilePool(16), report: createCombatReport() };
  }

  function addHitbox(
    projectiles: ProjectilePool,
    x: number,
    radius: number,
    damage: number,
    pierce: number,
  ): number {
    const index = projectiles.allocate();
    projectiles.motion[index] = MOTION.linear;
    projectiles.x[index] = x;
    projectiles.z[index] = 0;
    projectiles.radius[index] = radius;
    projectiles.damage[index] = damage;
    projectiles.knockback[index] = 0;
    projectiles.pierce[index] = pierce;
    projectiles.life[index] = 1;
    projectiles.maxLife[index] = 1;
    projectiles.hitInterval[index] = 0.2;
    projectiles.hitCooldown[index] = 0;
    return index;
  }

  it('damages an overlapping enemy', () => {
    const { enemies, grid, projectiles, report } = setup(1);
    addHitbox(projectiles, 0, 0.5, 25, 1);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(enemies.health[0]).toBe(75);
    expect(report.hits).toBe(1);
  });

  it('leaves an enemy outside the radius alone', () => {
    const { enemies, grid, projectiles, report } = setup(1);
    addHitbox(projectiles, 20, 0.5, 25, 1);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(enemies.health[0]).toBe(100);
    expect(report.hits).toBe(0);
  });

  it('hits several enemies at once, up to its pierce', () => {
    // A piercing shot through a packed line must not be limited to one target per
    // step, or piercing would be worthless in exactly the crowd it exists for.
    const { enemies, grid, projectiles, report } = setup(6);
    addHitbox(projectiles, 1.2, 2, 10, 3);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(report.hits).toBe(3);
  });

  it('goes on cooldown after striking, so one pass is not billed every frame', () => {
    const { enemies, grid, projectiles, report } = setup(1);
    const index = addHitbox(projectiles, 0, 0.5, 10, 999);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(projectiles.hitCooldown[index]).toBeGreaterThan(0);

    const before = enemies.health[0];
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(enemies.health[0]).toBe(before);
  });

  it('does not go on cooldown when it hit nothing', () => {
    const { enemies, grid, projectiles } = setup(1);
    const index = addHitbox(projectiles, 30, 0.5, 10, 999);
    resolveHits(
      projectiles,
      enemies,
      grid,
      ATTACK,
      createCombatReport(),
      noop,
      noop,
      () => false,
      NO_DEFENCE,
    );
    expect(projectiles.hitCooldown[index]).toBe(0);
  });

  it('reports a kill and releases the slot', () => {
    const enemies = new EnemyPool(8);
    enemies.spawn(0, 0, 0, { speed: 1, health: 5 });
    const grid = new SpatialGrid(2, 8);
    grid.rebuild(enemies.count, enemies.x, enemies.z);
    const projectiles = new ProjectilePool(8);
    addHitbox(projectiles, 0, 0.5, 50, 1);

    const report = createCombatReport();
    let killed = 0;
    resolveHits(
      projectiles,
      enemies,
      grid,
      ATTACK,
      report,
      () => killed++,
      noop,
      () => false,
      NO_DEFENCE,
    );
    expect(killed).toBe(1);
    expect(report.kills).toBe(1);
    expect(enemies.count).toBe(0);
  });

  it('kills several enemies in one pass without skipping any', () => {
    // Swap-removal reorders the pool mid-loop; processing victims in descending order
    // is what stops a removal from moving a not-yet-damaged enemy out from under the
    // iteration.
    const enemies = new EnemyPool(64);
    for (let i = 0; i < 8; i++) enemies.spawn(i * 0.4, 0, 0, { speed: 1, health: 5 });
    const grid = new SpatialGrid(2, 64);
    grid.rebuild(enemies.count, enemies.x, enemies.z);
    const projectiles = new ProjectilePool(8);
    addHitbox(projectiles, 1.4, 4, 50, 999);

    const report = createCombatReport();
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(report.kills).toBe(8);
    expect(enemies.count).toBe(0);
  });

  it('applies knockback away from the hitbox', () => {
    const enemies = new EnemyPool(8);
    enemies.spawn(1, 0, 0, { speed: 1, health: 100 });
    const grid = new SpatialGrid(2, 8);
    grid.rebuild(enemies.count, enemies.x, enemies.z);
    const projectiles = new ProjectilePool(8);
    const index = addHitbox(projectiles, 0, 2, 5, 1);
    projectiles.knockback[index] = 6;

    resolveHits(
      projectiles,
      enemies,
      grid,
      ATTACK,
      createCombatReport(),
      noop,
      noop,
      () => false,
      NO_DEFENCE,
    );
    expect(enemies.knockX[0]).toBeGreaterThan(0);
  });

  it('marks a struck enemy for the hit flash', () => {
    const { enemies, grid, projectiles, report } = setup(1);
    addHitbox(projectiles, 0, 0.5, 5, 1);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(enemies.flash[0]).toBe(1);
  });

  it('reports criticals and the damage they added', () => {
    const { enemies, grid, projectiles, report } = setup(1);
    addHitbox(projectiles, 0, 0.5, 10, 1);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => true, NO_DEFENCE);
    expect(report.criticals).toBe(1);
    expect(report.damageDealt).toBe(20);
  });

  it('spends pierce and retires the projectile once exhausted', () => {
    const { enemies, grid, projectiles, report } = setup(4);
    const index = addHitbox(projectiles, 0.6, 2, 5, 2);
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(projectiles.pierce[index]).toBe(0);

    stepProjectiles(projectiles, 0, 0, 0.01);
    expect(projectiles.count).toBe(0);
  });

  it('does nothing when there is nothing to hit', () => {
    const enemies = new EnemyPool(8);
    const grid = new SpatialGrid(2, 8);
    grid.rebuild(0, enemies.x, enemies.z);
    const projectiles = new ProjectilePool(8);
    addHitbox(projectiles, 0, 5, 10, 999);
    const report = createCombatReport();
    resolveHits(projectiles, enemies, grid, ATTACK, report, noop, noop, () => false, NO_DEFENCE);
    expect(report.hits).toBe(0);
  });
});

describe('nearestEnemy', () => {
  it('finds the closest', () => {
    const enemies = new EnemyPool(8);
    enemies.spawn(10, 0, 0);
    enemies.spawn(2, 0, 0);
    enemies.spawn(-30, 0, 0);
    expect(nearestEnemy(enemies, 0, 0)).toBe(1);
  });

  it('returns -1 for an empty field', () => {
    expect(nearestEnemy(new EnemyPool(8), 0, 0)).toBe(-1);
  });
});
