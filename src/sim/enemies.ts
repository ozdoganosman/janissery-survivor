import type { Rng } from '../core/rng';
import { QUERY_DONE, type SpatialGrid } from './spatial';

/**
 * The horde.
 *
 * Enemies are not objects. Every field is a slot in a preallocated typed array, and
 * the active ones are kept packed in `[0, count)`. Eight hundred short-lived class
 * instances churning sixty times a second is precisely the allocation pattern that
 * produces the periodic garbage-collection hitch the performance budget rules out —
 * and a hitch in this genre is a death, because the crowd does not pause with you.
 *
 * Removal is swap-with-last rather than tombstoning, so iteration stays a dense loop
 * and the render layer can map instance slots straight onto array indices.
 *
 * ## Identity
 *
 * Swap-removal means an index is only valid within the step that produced it: kill
 * enemy 5 and the enemy formerly at the end now answers to 5. Nothing yet holds a
 * reference across steps, but weapons that pierce or burn will want to remember what
 * they already hit, so every slot also carries a `generation` that increments on
 * reuse. A remembered `(index, generation)` pair can then be checked instead of
 * silently addressing a different creature.
 */

export const ENEMY_CAPACITY = 2000;

/** Physical radius, used for crowding and later for hit tests. */
export const ENEMY_RADIUS = 0.55;

/** How far apart the crowd tries to stay. Slightly over twice the radius. */
export const SEPARATION_RADIUS = 1.25;

/**
 * Neighbours examined per enemy per step.
 *
 * The separation force is what makes a crowd read as a crowd rather than as one
 * enemy drawn many times, but it is also the phase's biggest performance risk: done
 * naively it is quadratic. The grid already limits candidates to nearby cells; this
 * caps the pathological case where hundreds of enemies pile into one cell. Eight is
 * ample — a body can only touch so many others — and the ones examined are the ones
 * the grid happens to reach first, which for a shove is indistinguishable from the
 * nearest.
 */
export const MAX_SEPARATION_NEIGHBOURS = 8;

/** How hard crowding pushes, relative to the pull toward the player. */
const SEPARATION_STRENGTH = 1.35;

/** Enemies stop closing once this near the player, so they surround rather than stack. */
const CONTACT_DISTANCE = 0.85;

export interface EnemyStats {
  readonly speed: number;
  readonly health: number;
}

export const KARAKONCOLOS: EnemyStats = { speed: 2.45, health: 10 };

export class EnemyPool {
  readonly capacity: number;

  /** Active enemies occupy `[0, count)`. */
  count = 0;

  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Position at the end of the previous step, for render interpolation. */
  readonly previousX: Float32Array;
  readonly previousZ: Float32Array;
  readonly facing: Float32Array;
  readonly health: Float32Array;
  /** Walk-cycle offset, so the crowd does not step in unison. */
  readonly phase: Float32Array;
  /** Speed actually achieved last step, for driving the walk animation. */
  readonly speed: Float32Array;
  readonly generation: Uint32Array;

  constructor(capacity: number = ENEMY_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.previousX = new Float32Array(capacity);
    this.previousZ = new Float32Array(capacity);
    this.facing = new Float32Array(capacity);
    this.health = new Float32Array(capacity);
    this.phase = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.generation = new Uint32Array(capacity);
  }

  get full(): boolean {
    return this.count >= this.capacity;
  }

  /**
   * Adds an enemy. Returns its index, or -1 when the pool is full.
   *
   * A full pool is not an error: the spawner is allowed to ask for more than the
   * budget allows and simply gets nothing, which degrades the wave rather than the
   * frame rate.
   */
  spawn(x: number, z: number, phase: number, stats: EnemyStats = KARAKONCOLOS): number {
    if (this.count >= this.capacity) return -1;
    const index = this.count++;
    this.x[index] = x;
    this.z[index] = z;
    this.previousX[index] = x;
    this.previousZ[index] = z;
    this.facing[index] = 0;
    this.health[index] = stats.health;
    this.phase[index] = phase;
    this.speed[index] = 0;
    this.generation[index]++;
    return index;
  }

  /**
   * Removes an enemy by moving the last active one into its slot.
   *
   * The caller must not advance its loop counter after killing, since a new enemy now
   * occupies the current index.
   */
  kill(index: number): void {
    if (index < 0 || index >= this.count) return;
    const last = --this.count;
    if (index !== last) {
      this.x[index] = this.x[last];
      this.z[index] = this.z[last];
      this.previousX[index] = this.previousX[last];
      this.previousZ[index] = this.previousZ[last];
      this.facing[index] = this.facing[last];
      this.health[index] = this.health[last];
      this.phase[index] = this.phase[last];
      this.speed[index] = this.speed[last];
      this.generation[index] = this.generation[last];
    }
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * Advances every enemy one step: pull toward the player, push away from neighbours.
 *
 * The grid must already be rebuilt from this pool's positions.
 */
export function stepEnemies(
  pool: EnemyPool,
  grid: SpatialGrid,
  playerX: number,
  playerZ: number,
  stepSeconds: number,
  stats: EnemyStats = KARAKONCOLOS,
): void {
  const { x, z, previousX, previousZ, facing, speed, count } = pool;

  for (let i = 0; i < count; i++) {
    previousX[i] = x[i];
    previousZ[i] = z[i];

    const toPlayerX = playerX - x[i];
    const toPlayerZ = playerZ - z[i];
    const distance = Math.hypot(toPlayerX, toPlayerZ);

    // Steer toward the player, or hold position once close enough to press against
    // them; without this the whole crowd converges onto one point and overlaps.
    let dirX = 0;
    let dirZ = 0;
    if (distance > CONTACT_DISTANCE && distance > 1e-6) {
      dirX = toPlayerX / distance;
      dirZ = toPlayerZ / distance;
    }

    let pushX = 0;
    let pushZ = 0;
    let examined = 0;

    grid.beginQuery(x[i], z[i], SEPARATION_RADIUS);
    for (;;) {
      const other = grid.next();
      if (other === QUERY_DONE) break;
      if (other === i) continue;

      const dx = x[i] - x[other];
      const dz = z[i] - z[other];
      const gap = Math.hypot(dx, dz);
      if (gap > 1e-6) {
        // Falls off linearly to nothing at the separation radius, so distant
        // neighbours do not tug and touching ones shove hard.
        const strength = 1 - gap / SEPARATION_RADIUS;
        pushX += (dx / gap) * strength;
        pushZ += (dz / gap) * strength;
      } else {
        // Exactly coincident: nudge deterministically by index so the pair does not
        // sit fused forever, and so replays stay identical.
        pushX += other < i ? 0.5 : -0.5;
      }

      if (++examined >= MAX_SEPARATION_NEIGHBOURS) {
        grid.endQuery();
        break;
      }
    }

    let moveX = dirX + pushX * SEPARATION_STRENGTH;
    let moveZ = dirZ + pushZ * SEPARATION_STRENGTH;
    const magnitude = Math.hypot(moveX, moveZ);

    if (magnitude > 1e-6) {
      moveX /= magnitude;
      moveZ /= magnitude;
      x[i] += moveX * stats.speed * stepSeconds;
      z[i] += moveZ * stats.speed * stepSeconds;
      speed[i] = stats.speed;
      // Models face +Z, so a heading of zero must mean "along +Z".
      facing[i] = Math.atan2(moveX, moveZ);
    } else {
      speed[i] = 0;
    }
  }
}

/**
 * Spawns enemies on a ring outside the player's view.
 *
 * A ring rather than a rectangle: the view is wider than it is tall, and spawning on
 * the screen rectangle would put enemies far closer above and below than at the
 * sides. A circle whose radius clears the screen corner gives every direction the
 * same warning time, matching the camera rule that sight distance is equal all round.
 */
export function spawnRing(
  pool: EnemyPool,
  rng: Rng,
  playerX: number,
  playerZ: number,
  radius: number,
  amount: number,
  stats: EnemyStats = KARAKONCOLOS,
): number {
  let spawned = 0;
  for (let i = 0; i < amount; i++) {
    if (pool.full) break;
    const angle = rng.next() * Math.PI * 2;
    // A little radial jitter stops arrivals forming a visible perfect circle.
    const distance = radius * rng.range(1, 1.12);
    pool.spawn(
      playerX + Math.sin(angle) * distance,
      playerZ + Math.cos(angle) * distance,
      rng.next(),
      stats,
    );
    spawned++;
  }
  return spawned;
}

/**
 * Removes enemies that have fallen far behind the player.
 *
 * Without this the pool fills with creatures the player outran minutes ago, and the
 * budget for enemies that can actually threaten them shrinks to nothing.
 */
export function despawnDistant(
  pool: EnemyPool,
  playerX: number,
  playerZ: number,
  maxDistance: number,
): number {
  const limitSq = maxDistance * maxDistance;
  let removed = 0;
  for (let i = 0; i < pool.count;) {
    const dx = pool.x[i] - playerX;
    const dz = pool.z[i] - playerZ;
    if (dx * dx + dz * dz > limitSq) {
      pool.kill(i);
      removed++;
      // No increment: `kill` moved a different enemy into this slot.
    } else {
      i++;
    }
  }
  return removed;
}
