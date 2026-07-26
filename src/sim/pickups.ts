/**
 * Experience gems dropped by the dead.
 *
 * Same shape as the enemy pool and for the same reason: hundreds of these exist at
 * once late in a run, and they must not allocate.
 *
 * The collection rule is the one that shapes play. Gems sit where they fell until the
 * player comes within pickup range, then fly in — so clearing a patch of ground is a
 * decision with a cost, because walking back for the gems means walking back into
 * whatever has since filled the space.
 */

export const GEM_CAPACITY = 4000;

/** Distance at which a gem starts flying toward the player. */
export const GEM_MAGNET_RADIUS = 2.2;

/** Distance at which it is collected. */
export const GEM_PICKUP_RADIUS = 0.7;

/** How fast a magnetised gem accelerates, in units per second squared. */
const GEM_ACCELERATION = 26;

/** Terminal speed, so a gem cannot outrun the player it is chasing. */
const GEM_MAX_SPEED = 13;

export class GemPool {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly previousX: Float32Array;
  readonly previousZ: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityZ: Float32Array;
  readonly value: Float32Array;

  constructor(capacity: number = GEM_CAPACITY) {
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
    this.value = new Float32Array(capacity);
  }

  spawn(x: number, z: number, value = 1): number {
    if (this.count >= this.capacity) return -1;
    const index = this.count++;
    this.x[index] = x;
    this.z[index] = z;
    this.previousX[index] = x;
    this.previousZ[index] = z;
    this.velocityX[index] = 0;
    this.velocityZ[index] = 0;
    this.value[index] = value;
    return index;
  }

  /** Swap-remove, matching the enemy pool. */
  remove(index: number): void {
    if (index < 0 || index >= this.count) return;
    const last = --this.count;
    if (index !== last) {
      this.x[index] = this.x[last];
      this.z[index] = this.z[last];
      this.previousX[index] = this.previousX[last];
      this.previousZ[index] = this.previousZ[last];
      this.velocityX[index] = this.velocityX[last];
      this.velocityZ[index] = this.velocityZ[last];
      this.value[index] = this.value[last];
    }
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * Moves gems and collects the ones that reach the player.
 *
 * @param magnetRadius Overridable because a pickup-radius upgrade is one of the
 *   planned passive items, and balance data should drive it rather than a constant.
 * @returns Total value collected this step.
 */
export function stepGems(
  pool: GemPool,
  playerX: number,
  playerZ: number,
  stepSeconds: number,
  magnetRadius: number = GEM_MAGNET_RADIUS,
): number {
  const { x, z, previousX, previousZ, velocityX, velocityZ } = pool;
  const magnetSq = magnetRadius * magnetRadius;
  const pickupSq = GEM_PICKUP_RADIUS * GEM_PICKUP_RADIUS;
  let collected = 0;

  for (let i = 0; i < pool.count;) {
    previousX[i] = x[i];
    previousZ[i] = z[i];

    const dx = playerX - x[i];
    const dz = playerZ - z[i];
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq <= pickupSq) {
      collected += pool.value[i];
      pool.remove(i);
      // No increment: `remove` moved a different gem into this slot.
      continue;
    }

    if (distanceSq <= magnetSq) {
      const distance = Math.sqrt(distanceSq);
      velocityX[i] += (dx / distance) * GEM_ACCELERATION * stepSeconds;
      velocityZ[i] += (dz / distance) * GEM_ACCELERATION * stepSeconds;

      const speed = Math.hypot(velocityX[i], velocityZ[i]);
      if (speed > GEM_MAX_SPEED) {
        velocityX[i] = (velocityX[i] / speed) * GEM_MAX_SPEED;
        velocityZ[i] = (velocityZ[i] / speed) * GEM_MAX_SPEED;
      }

      x[i] += velocityX[i] * stepSeconds;
      z[i] += velocityZ[i] * stepSeconds;
    } else if (velocityX[i] !== 0 || velocityZ[i] !== 0) {
      // Left the magnet's reach — stop dead rather than drifting off, so a gem never
      // ends up somewhere the player did not drop it.
      velocityX[i] = 0;
      velocityZ[i] = 0;
    }

    i++;
  }

  return collected;
}
