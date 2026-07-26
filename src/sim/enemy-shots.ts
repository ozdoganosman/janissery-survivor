/**
 * What the enemies throw back.
 *
 * A separate pool from the player's projectiles, deliberately. They collide against
 * one target instead of hundreds, need no spatial grid, no piercing and no critical
 * roll — folding them into the weapon pool would mean every one of those branches
 * running for shots that can never use them, and a shared pool where a bug in one
 * side's collision silently affects the other.
 *
 * Ranged enemies are what make standing still a mistake. Until they existed the
 * optimal play against a slow crowd was to hold a cleared pocket and wait.
 */

export const ENEMY_SHOT_CAPACITY = 400;

/** Beyond this a shot has missed and is better recycled than tracked. */
const MAX_RANGE = 40;

export class EnemyShotPool {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly previousX: Float32Array;
  readonly previousZ: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityZ: Float32Array;
  readonly damage: Float32Array;
  readonly radius: Float32Array;
  /** Distance still available before the shot expires. */
  readonly range: Float32Array;

  constructor(capacity: number = ENEMY_SHOT_CAPACITY) {
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
    this.damage = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.range = new Float32Array(capacity);
  }

  /** Aims a shot from a point toward a target. Returns -1 when full. */
  fire(
    fromX: number,
    fromZ: number,
    towardX: number,
    towardZ: number,
    speed: number,
    damage: number,
    radius = 0.36,
  ): number {
    if (this.count >= this.capacity) return -1;

    const dx = towardX - fromX;
    const dz = towardZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (!(distance > 1e-6)) return -1;

    const index = this.count++;
    this.x[index] = fromX;
    this.z[index] = fromZ;
    this.previousX[index] = fromX;
    this.previousZ[index] = fromZ;
    this.velocityX[index] = (dx / distance) * speed;
    this.velocityZ[index] = (dz / distance) * speed;
    this.damage[index] = damage;
    this.radius[index] = radius;
    this.range[index] = MAX_RANGE;
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
    this.damage[index] = this.damage[last];
    this.radius[index] = this.radius[last];
    this.range[index] = this.range[last];
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * Moves every shot and reports the damage that reached the player.
 *
 * Returns a total rather than applying it, so the caller keeps sole ownership of the
 * player's health and of the immunity window that guards it.
 */
export function stepEnemyShots(
  pool: EnemyShotPool,
  playerX: number,
  playerZ: number,
  playerRadius: number,
  stepSeconds: number,
): number {
  let damage = 0;

  for (let i = 0; i < pool.count;) {
    pool.previousX[i] = pool.x[i];
    pool.previousZ[i] = pool.z[i];

    const stepX = pool.velocityX[i] * stepSeconds;
    const stepZ = pool.velocityZ[i] * stepSeconds;
    pool.x[i] += stepX;
    pool.z[i] += stepZ;
    pool.range[i] -= Math.hypot(stepX, stepZ);

    if (pool.range[i] <= 0) {
      pool.remove(i);
      // No increment: `remove` moved a different shot into this slot.
      continue;
    }

    const dx = pool.x[i] - playerX;
    const dz = pool.z[i] - playerZ;
    const reach = pool.radius[i] + playerRadius;
    if (dx * dx + dz * dz <= reach * reach) {
      damage += pool.damage[i];
      pool.remove(i);
      continue;
    }

    i++;
  }

  return damage;
}
