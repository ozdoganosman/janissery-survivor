import type { Rng } from '../core/rng';
import weaponBalance from '../../data/balance/weapons.json';
import type { EnemyPool } from './enemies';
import { MOTION, type MotionKind, type ProjectilePool } from './projectiles';

/**
 * The armoury.
 *
 * A weapon is data plus one small function that says where its hitboxes appear. All
 * six share the projectile pool, the collision pass and the damage pipeline, so the
 * difference between the sabre and the cannon is a motion constant and four numbers —
 * not a subsystem.
 *
 * The numbers live in `data/balance/weapons.json` rather than here on purpose.
 * Balancing is going to be the bulk of the remaining work, and every tuning pass that
 * requires editing TypeScript is a tuning pass that will not happen.
 */

export const WEAPON_IDS = ['yatagan', 'tirkes', 'mehter', 'nazar', 'sahi', 'kandil'] as const;

export type WeaponId = (typeof WEAPON_IDS)[number];

export interface WeaponStats {
  readonly name: string;
  readonly motion: MotionKind;
  /** Seconds between activations. */
  readonly cooldown: number;
  readonly damage: number;
  /** Hit radius, or reach for player-anchored shapes. */
  readonly area: number;
  /** Travel speed, or angular speed for orbiting shapes. */
  readonly speed: number;
  /** Hitboxes produced per activation. */
  readonly amount: number;
  /** Enemies a hitbox may pass through. */
  readonly pierce: number;
  /** How long a hitbox lives, in seconds. */
  readonly duration: number;
  readonly knockback: number;
  /** Minimum seconds between one hitbox damaging twice. */
  readonly hitInterval: number;
  /**
   * Additive stat deltas for levels 2 upward, one entry per level.
   *
   * Additive rather than multiplicative so the table reads as "level four adds five
   * damage" instead of asking whoever is tuning it to compound factors in their head.
   */
  readonly levels: readonly WeaponLevelDelta[];
}

export interface WeaponLevelDelta {
  readonly cooldown?: number;
  readonly damage?: number;
  readonly area?: number;
  readonly speed?: number;
  readonly amount?: number;
  readonly pierce?: number;
  readonly duration?: number;
}

const MOTION_BY_NAME: Readonly<Record<string, MotionKind>> = {
  linear: MOTION.linear,
  sweep: MOTION.sweep,
  ring: MOTION.ring,
  orbit: MOTION.orbit,
  lob: MOTION.lob,
  aura: MOTION.aura,
};

class WeaponError extends Error {
  constructor(id: string, detail: string) {
    super(`Invalid weapon "${id}": ${detail}`);
    this.name = 'WeaponError';
  }
}

/**
 * Validates the balance table.
 *
 * The file is hand-edited during tuning, and a typo there would otherwise surface as
 * a weapon that silently never fires or fires with `NaN` damage — a symptom that says
 * nothing about its cause.
 */
export function parseWeaponStats(id: string, raw: unknown): WeaponStats {
  if (typeof raw !== 'object' || raw === null) throw new WeaponError(id, 'expected an object');
  const record = raw as Record<string, unknown>;

  const name = record.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new WeaponError(id, 'name must be a non-empty string');
  }

  const motionName = record.motion;
  if (typeof motionName !== 'string' || !(motionName in MOTION_BY_NAME)) {
    throw new WeaponError(
      id,
      `motion must be one of ${Object.keys(MOTION_BY_NAME).join(', ')}, got ${String(motionName)}`,
    );
  }

  const number = (key: string, { allowZero = false } = {}): number => {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new WeaponError(id, `${key} must be a finite number, got ${String(value)}`);
    }
    if (value < 0 || (!allowZero && value === 0)) {
      throw new WeaponError(id, `${key} must be ${allowZero ? 'non-negative' : 'positive'}`);
    }
    return value;
  };

  const rawLevels = record.levels;
  const levels: WeaponLevelDelta[] = [];
  if (rawLevels !== undefined) {
    if (!Array.isArray(rawLevels)) throw new WeaponError(id, 'levels must be an array');
    rawLevels.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new WeaponError(id, `levels[${String(index)}] must be an object`);
      }
      const delta: Record<string, number> = {};
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new WeaponError(id, `levels[${String(index)}].${key} must be a finite number`);
        }
        delta[key] = value;
      }
      levels.push(delta);
    });
  }

  return {
    name,
    motion: MOTION_BY_NAME[motionName],
    levels,
    cooldown: number('cooldown'),
    damage: number('damage'),
    area: number('area'),
    speed: number('speed', { allowZero: true }),
    amount: number('amount'),
    pierce: number('pierce'),
    duration: number('duration'),
    knockback: number('knockback', { allowZero: true }),
    hitInterval: number('hitInterval'),
  };
}

const TABLE: Readonly<Record<WeaponId, WeaponStats>> = Object.fromEntries(
  WEAPON_IDS.map((id) => [
    id,
    parseWeaponStats(id, (weaponBalance as Record<string, unknown>)[id]),
  ]),
) as Record<WeaponId, WeaponStats>;

export function weaponStats(id: WeaponId): WeaponStats {
  return TABLE[id];
}

/** A weapon the player actually carries. */
export interface EquippedWeapon {
  readonly id: WeaponId;
  /** Seconds until it may fire again. */
  cooldownRemaining: number;
}

export function equip(id: WeaponId): EquippedWeapon {
  // Staggered by index rather than all zero, so six weapons do not all discharge on
  // the same frame every few seconds and leave silence in between.
  return { id, cooldownRemaining: WEAPON_IDS.indexOf(id) * 0.12 };
}

/**
 * Ticks every equipped weapon and fires the ones that are ready.
 *
 * @param resolve Supplies each weapon's stats *as the player currently has them* —
 *   its level plus every passive folded in. Passing a resolver rather than reading
 *   the base table means levelling a weapon or picking up a whetstone takes effect
 *   here with no change to this function.
 * @returns How many weapons fired, for the overlay.
 */
export function stepWeapons(
  weapons: readonly EquippedWeapon[],
  resolve: (id: WeaponId) => WeaponStats,
  projectiles: ProjectilePool,
  enemies: EnemyPool,
  playerX: number,
  playerZ: number,
  playerFacing: number,
  stepSeconds: number,
  rng: Rng,
): number {
  let fired = 0;
  for (const weapon of weapons) {
    weapon.cooldownRemaining -= stepSeconds;
    if (weapon.cooldownRemaining > 0) continue;

    const stats = resolve(weapon.id);
    weapon.cooldownRemaining += stats.cooldown;
    // A weapon whose cooldown elapsed several times during a stall fires once, not a
    // burst: catching up would turn a dropped frame into a damage spike.
    if (weapon.cooldownRemaining < 0) weapon.cooldownRemaining = stats.cooldown;

    fire(stats, weapon.id, projectiles, enemies, playerX, playerZ, playerFacing, rng);
    fired++;
  }
  return fired;
}

function fire(
  stats: WeaponStats,
  id: WeaponId,
  projectiles: ProjectilePool,
  enemies: EnemyPool,
  playerX: number,
  playerZ: number,
  playerFacing: number,
  rng: Rng,
): void {
  for (let n = 0; n < stats.amount; n++) {
    const index = projectiles.allocate();
    if (index === -1) return;

    projectiles.motion[index] = stats.motion;
    projectiles.source[index] = WEAPON_IDS.indexOf(id);
    projectiles.damage[index] = stats.damage;
    projectiles.knockback[index] = stats.knockback;
    projectiles.pierce[index] = stats.pierce;
    projectiles.life[index] = stats.duration;
    projectiles.maxLife[index] = stats.duration;
    projectiles.hitInterval[index] = stats.hitInterval;
    projectiles.hitCooldown[index] = 0;
    projectiles.radius[index] = stats.area;
    projectiles.targetRadius[index] = stats.area;
    projectiles.x[index] = playerX;
    projectiles.z[index] = playerZ;
    projectiles.previousX[index] = playerX;
    projectiles.previousZ[index] = playerZ;

    switch (stats.motion) {
      case MOTION.linear: {
        // Seeks the nearest enemy, which is what makes an auto-firing weapon feel
        // like it is helping rather than firing into empty ground.
        const target = nearestEnemy(enemies, playerX, playerZ);
        const angle = target === -1 ? playerFacing : angleTo(playerX, playerZ, enemies, target);
        // A slight spread so several arrows in one volley do not overlap exactly.
        const spread = stats.amount > 1 ? (n - (stats.amount - 1) / 2) * 0.16 : 0;
        projectiles.velocityX[index] = Math.sin(angle + spread) * stats.speed;
        projectiles.velocityZ[index] = Math.cos(angle + spread) * stats.speed;
        break;
      }

      case MOTION.lob: {
        const target = nearestEnemy(enemies, playerX, playerZ);
        const angle =
          target === -1 ? rng.next() * Math.PI * 2 : angleTo(playerX, playerZ, enemies, target);
        projectiles.velocityX[index] = Math.sin(angle) * stats.speed;
        projectiles.velocityZ[index] = Math.cos(angle) * stats.speed;
        break;
      }

      case MOTION.sweep: {
        // Starts behind the facing direction and sweeps forward through it, so the
        // arc reads as a swing rather than as a hitbox appearing.
        projectiles.angle[index] = playerFacing - 1.15;
        projectiles.angularSpeed[index] = 2.3 / stats.duration;
        projectiles.anchorRadius[index] = stats.area * 0.62;
        projectiles.radius[index] = stats.area * 0.5;
        break;
      }

      case MOTION.orbit: {
        projectiles.angle[index] = (n / stats.amount) * Math.PI * 2;
        projectiles.angularSpeed[index] = stats.speed;
        projectiles.anchorRadius[index] = 2.1;
        break;
      }

      case MOTION.ring: {
        projectiles.radius[index] = 0;
        break;
      }

      case MOTION.aura:
      default:
        break;
    }
  }
}

/** Index of the closest enemy, or -1 when the field is empty. */
export function nearestEnemy(enemies: EnemyPool, x: number, z: number): number {
  let best = -1;
  let bestSq = Infinity;
  for (let i = 0; i < enemies.count; i++) {
    const dx = enemies.x[i] - x;
    const dz = enemies.z[i] - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestSq) {
      bestSq = distanceSq;
      best = i;
    }
  }
  return best;
}

function angleTo(x: number, z: number, enemies: EnemyPool, target: number): number {
  // Models and headings use atan2(x, z) so that zero points along +Z.
  return Math.atan2(enemies.x[target] - x, enemies.z[target] - z);
}
