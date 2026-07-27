import { computeDamage, type AttackProfile, type DefenceProfile, NO_DEFENCE } from './damage';
import type { EnemyPool } from './enemies';
import { QUERY_DONE, type SpatialGrid } from './spatial';

/**
 * Everything a weapon puts into the world.
 *
 * One pool, one loop, for all six weapons. They differ only in how their hitbox
 * moves, so the alternative — a system per weapon — would mean six pools, six
 * collision passes and six places for a rounding bug to hide, in exchange for nothing.
 * Adding a seventh weapon should mean adding a motion case, not a subsystem.
 *
 * Same rules as the enemy pool: preallocated typed arrays, active entries packed into
 * `[0, count)`, swap-removal, no allocation in the step.
 */

export const PROJECTILE_CAPACITY = 600;

export const MOTION = {
  /** Travels in a straight line. Arrows. */
  linear: 0,
  /** Sweeps an arc around the player. The sabre. */
  sweep: 1,
  /** Ring whose radius grows over its lifetime. The drum's shockwave. */
  ring: 2,
  /** Circles the player at a fixed radius. The beads. */
  orbit: 3,
  /** Flies to a point and bursts. The cannon. */
  lob: 4,
  /** Sits on the player. The lantern's flame. */
  aura: 5,
} as const;

export type MotionKind = (typeof MOTION)[keyof typeof MOTION];

export class ProjectilePool {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly previousX: Float32Array;
  readonly previousZ: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityZ: Float32Array;
  /** Current hit radius. `ring` grows it as it expands. */
  readonly radius: Float32Array;
  /** Radius the shape is heading toward, for motions that grow. */
  readonly targetRadius: Float32Array;
  readonly damage: Float32Array;
  readonly knockback: Float32Array;
  /** Enemies this may still pass through before expiring. */
  readonly pierce: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly motion: Uint8Array;
  /** Orbit and sweep angle, in radians. */
  readonly angle: Float32Array;
  readonly angularSpeed: Float32Array;
  /** Distance from the player for player-anchored motions. */
  readonly anchorRadius: Float32Array;
  /** Seconds until this may damage again, so one pass is not counted every frame. */
  readonly hitCooldown: Float32Array;
  readonly hitInterval: Float32Array;
  /** Which weapon fired it, for effects and for the overlay. */
  readonly source: Uint8Array;

  constructor(capacity: number = PROJECTILE_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.velocityX = new Float32Array(capacity);
    this.velocityZ = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.targetRadius = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.knockback = new Float32Array(capacity);
    this.pierce = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.motion = new Uint8Array(capacity);
    this.angle = new Float32Array(capacity);
    this.angularSpeed = new Float32Array(capacity);
    this.anchorRadius = new Float32Array(capacity);
    this.hitCooldown = new Float32Array(capacity);
    this.hitInterval = new Float32Array(capacity);
    this.source = new Uint8Array(capacity);
  }

  get full(): boolean {
    return this.count >= this.capacity;
  }

  /** Reserves a slot with defaults cleared. Returns -1 when full. */
  allocate(): number {
    if (this.count >= this.capacity) return -1;
    const index = this.count++;
    this.velocityX[index] = 0;
    this.velocityZ[index] = 0;
    this.angle[index] = 0;
    this.angularSpeed[index] = 0;
    this.anchorRadius[index] = 0;
    this.hitCooldown[index] = 0;
    this.targetRadius[index] = 0;
    return index;
  }

  remove(index: number): void {
    if (index < 0 || index >= this.count) return;
    const last = --this.count;
    if (index === last) return;
    this.x[index] = this.x[last];
    this.z[index] = this.z[last];
    this.previousX[index] = this.previousX[last];
    this.previousZ[index] = this.previousZ[last];
    this.velocityX[index] = this.velocityX[last];
    this.velocityZ[index] = this.velocityZ[last];
    this.radius[index] = this.radius[last];
    this.targetRadius[index] = this.targetRadius[last];
    this.damage[index] = this.damage[last];
    this.knockback[index] = this.knockback[last];
    this.pierce[index] = this.pierce[last];
    this.life[index] = this.life[last];
    this.maxLife[index] = this.maxLife[last];
    this.motion[index] = this.motion[last];
    this.angle[index] = this.angle[last];
    this.angularSpeed[index] = this.angularSpeed[last];
    this.anchorRadius[index] = this.anchorRadius[last];
    this.hitCooldown[index] = this.hitCooldown[last];
    this.hitInterval[index] = this.hitInterval[last];
    this.source[index] = this.source[last];
  }

  clear(): void {
    this.count = 0;
  }
}

/** What a step of collisions produced, for feedback effects to consume. */
export interface CombatReport {
  hits: number;
  kills: number;
  criticals: number;
  damageDealt: number;
}

export function createCombatReport(): CombatReport {
  return { hits: 0, kills: 0, criticals: 0, damageDealt: 0 };
}

export function resetCombatReport(report: CombatReport): void {
  report.hits = 0;
  report.kills = 0;
  report.criticals = 0;
  report.damageDealt = 0;
}

/**
 * Moves every projectile one step.
 *
 * Player-anchored motions are given the player's position rather than reading it from
 * a captured reference, so the pool has no idea what a player is and stays testable
 * on its own.
 */
export function stepProjectiles(
  pool: ProjectilePool,
  playerX: number,
  playerZ: number,
  stepSeconds: number,
): void {
  for (let i = 0; i < pool.count;) {
    pool.life[i] -= stepSeconds;
    if (pool.life[i] <= 0 || pool.pierce[i] <= 0) {
      pool.remove(i);
      // No increment: `remove` moved a different projectile into this slot.
      continue;
    }

    pool.previousX[i] = pool.x[i];
    pool.previousZ[i] = pool.z[i];
    if (pool.hitCooldown[i] > 0) pool.hitCooldown[i] -= stepSeconds;

    switch (pool.motion[i]) {
      case MOTION.linear:
      case MOTION.lob:
        pool.x[i] += pool.velocityX[i] * stepSeconds;
        pool.z[i] += pool.velocityZ[i] * stepSeconds;
        break;

      case MOTION.sweep: {
        pool.angle[i] += pool.angularSpeed[i] * stepSeconds;
        pool.x[i] = playerX + Math.sin(pool.angle[i]) * pool.anchorRadius[i];
        pool.z[i] = playerZ + Math.cos(pool.angle[i]) * pool.anchorRadius[i];
        break;
      }

      case MOTION.orbit: {
        pool.angle[i] += pool.angularSpeed[i] * stepSeconds;
        pool.x[i] = playerX + Math.sin(pool.angle[i]) * pool.anchorRadius[i];
        pool.z[i] = playerZ + Math.cos(pool.angle[i]) * pool.anchorRadius[i];
        break;
      }

      case MOTION.ring: {
        // Expands from nothing to its full radius across its lifetime, so the
        // shockwave reaches distant enemies later than near ones.
        const progress = 1 - pool.life[i] / pool.maxLife[i];
        pool.radius[i] = pool.targetRadius[i] * progress;
        pool.x[i] = playerX;
        pool.z[i] = playerZ;
        break;
      }

      case MOTION.aura:
        pool.x[i] = playerX;
        pool.z[i] = playerZ;
        break;

      default:
        break;
    }

    i++;
  }
}

/**
 * Applies every overlap between projectiles and enemies.
 *
 * Iterates projectiles rather than enemies because there are far fewer of them, and
 * because the grid is built over enemies — so each projectile costs one query instead
 * of every enemy costing a scan of all projectiles.
 *
 * A projectile damages everything it overlaps in a single step, then goes on cooldown.
 * Handling only one target per step would neuter piercing weapons through a packed
 * crowd; skipping the cooldown would instead let a slow projectile bill the same
 * enemy on all sixty frames it touches them.
 */
export function resolveHits(
  projectiles: ProjectilePool,
  enemies: EnemyPool,
  grid: SpatialGrid,
  attack: AttackProfile,
  report: CombatReport,
  /**
   * Called with the dying enemy's slot, before it is removed.
   *
   * The index is passed as well as the position so a caller can read anything else it
   * needs from the pool — the renderer wants the creature's kind, facing and size to
   * play a death out of. It is only valid for the duration of the call: the very next
   * statement recycles the slot.
   */
  onKill: (index: number, x: number, z: number, experience: number) => void,
  onHit: (x: number, z: number, amount: number, critical: boolean) => void,
  rollCritical: () => boolean,
  defence: DefenceProfile = NO_DEFENCE,
  enemyRadius = 0.55,
): void {
  for (let p = 0; p < projectiles.count; p++) {
    if (projectiles.hitCooldown[p] > 0) continue;
    if (projectiles.pierce[p] <= 0) continue;

    const reach = projectiles.radius[p] + enemyRadius;
    let struckAnything = false;

    // Collect first, damage after: killing inside the query would swap enemies
    // between slots while the grid still describes the old arrangement.
    grid.beginQuery(projectiles.x[p], projectiles.z[p], reach);
    let victims = 0;
    for (;;) {
      const enemy = grid.next();
      if (enemy === QUERY_DONE) break;
      if (victims >= VICTIM_BUFFER.length) {
        grid.endQuery();
        break;
      }
      VICTIM_BUFFER[victims++] = enemy;
      if (victims >= projectiles.pierce[p]) {
        grid.endQuery();
        break;
      }
    }

    // Descending order, so a swap-removal never moves a not-yet-processed victim.
    sortDescending(VICTIM_BUFFER, victims);

    for (let v = 0; v < victims; v++) {
      const enemy = VICTIM_BUFFER[v];
      if (enemy >= enemies.count) continue;

      const critical = rollCritical();
      const amount = computeDamage({ ...attack, base: projectiles.damage[p] }, defence, critical);

      enemies.health[enemy] -= amount;
      enemies.flash[enemy] = 1;
      onHit(enemies.x[enemy], enemies.z[enemy], amount, critical);
      report.hits++;
      report.damageDealt += amount;
      if (critical) report.criticals++;
      struckAnything = true;

      const knock = projectiles.knockback[p];
      if (knock > 0) {
        const dx = enemies.x[enemy] - projectiles.x[p];
        const dz = enemies.z[enemy] - projectiles.z[p];
        const distance = Math.hypot(dx, dz);
        if (distance > 1e-6) {
          enemies.knockX[enemy] += (dx / distance) * knock;
          enemies.knockZ[enemy] += (dz / distance) * knock;
        }
      }

      projectiles.pierce[p] -= 1;

      if (enemies.health[enemy] <= 0) {
        // Read before the kill: swap-removal overwrites the slot, so asking
        // afterwards would report whichever enemy was moved into it.
        onKill(enemy, enemies.x[enemy], enemies.z[enemy], enemies.experienceOf(enemy));
        report.kills++;
        enemies.kill(enemy);
      }

      if (projectiles.pierce[p] <= 0) break;
    }

    if (struckAnything) {
      projectiles.hitCooldown[p] = projectiles.hitInterval[p];
    }
  }
}

/**
 * Scratch space for one projectile's victims.
 *
 * Module-level and fixed-size so the collision loop allocates nothing. Sized well
 * above what any single hitbox can plausibly overlap; a projectile that finds more
 * targets than this simply hits the first batch, which is invisible in play.
 */
const VICTIM_BUFFER = new Int32Array(64);

/** Insertion sort, descending. Faster than `Array.sort` at these sizes, and no allocation. */
function sortDescending(buffer: Int32Array, length: number): void {
  for (let i = 1; i < length; i++) {
    const value = buffer[i];
    let j = i - 1;
    while (j >= 0 && buffer[j] < value) {
      buffer[j + 1] = buffer[j];
      j--;
    }
    buffer[j + 1] = value;
  }
}
