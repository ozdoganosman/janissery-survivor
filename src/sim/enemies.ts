import type { Rng } from '../core/rng';
import {
  BEHAVIOUR,
  ELITE_EXPERIENCE_MULTIPLIER,
  ELITE_HEALTH_MULTIPLIER,
  ELITE_SCALE_MULTIPLIER,
  ENEMY_TYPES,
  type EnemyType,
} from './enemy-types';
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

/** How fast a shove bleeds off, per second. */
const KNOCKBACK_DECAY = 9;

/** How long the white hit flash lasts. Long enough to register, short enough not to smear. */
const FLASH_SECONDS = 0.14;

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
  /** Index into `ENEMY_TYPES`. Numeric, so the pool stays a set of typed arrays. */
  readonly kind: Uint8Array;
  /** Rendered size: the type's own scale, times the elite bonus. */
  readonly scale: Float32Array;
  /** 1 for elites. Multiplies health, size and reward. */
  readonly elite: Uint8Array;
  /** Seconds until this may shoot or slam again. */
  readonly attackCooldown: Float32Array;
  /**
   * Seconds left on a telegraphed attack, counting down to the blow.
   *
   * A boss that simply damages everything nearby is unfair in a way the player
   * cannot learn from; the wind-up is what turns it into a decision.
   */
  readonly telegraph: Float32Array;
  /**
   * Hit flash, 1 at the moment of impact and decaying to 0.
   *
   * With hundreds of enemies overlapping, a hit that changes only a health number the
   * player cannot see is indistinguishable from a miss. The flash is the receipt.
   */
  readonly flash: Float32Array;
  /** Knockback velocity, decaying. Separate from steering so a shove overrides intent. */
  readonly knockX: Float32Array;
  readonly knockZ: Float32Array;
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
    this.kind = new Uint8Array(capacity);
    this.scale = new Float32Array(capacity);
    this.elite = new Uint8Array(capacity);
    this.attackCooldown = new Float32Array(capacity);
    this.telegraph = new Float32Array(capacity);
    this.flash = new Float32Array(capacity);
    this.knockX = new Float32Array(capacity);
    this.knockZ = new Float32Array(capacity);
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
  spawn(x: number, z: number, phase: number, kind = 0, elite = false, healthScale = 1): number {
    if (this.count >= this.capacity) return -1;
    const type = ENEMY_TYPES[kind] ?? ENEMY_TYPES[0];
    const index = this.count++;
    this.x[index] = x;
    this.z[index] = z;
    this.previousX[index] = x;
    this.previousZ[index] = z;
    this.facing[index] = 0;
    this.health[index] = type.health * healthScale * (elite ? ELITE_HEALTH_MULTIPLIER : 1);
    this.phase[index] = phase;
    this.speed[index] = 0;
    this.kind[index] = kind;
    this.elite[index] = elite ? 1 : 0;
    this.scale[index] = type.scale * (elite ? ELITE_SCALE_MULTIPLIER : 1);
    // Staggered, so a wave that arrives together does not fire together.
    this.attackCooldown[index] = phase * Math.max(type.shotCooldown, type.slamCooldown);
    this.telegraph[index] = 0;
    this.flash[index] = 0;
    this.knockX[index] = 0;
    this.knockZ[index] = 0;
    this.generation[index]++;
    return index;
  }

  /** Experience this enemy is worth, including its elite bonus. */
  experienceOf(index: number): number {
    const type = ENEMY_TYPES[this.kind[index]] ?? ENEMY_TYPES[0];
    return type.experience * (this.elite[index] === 1 ? ELITE_EXPERIENCE_MULTIPLIER : 1);
  }

  typeOf(index: number): EnemyType {
    return ENEMY_TYPES[this.kind[index]] ?? ENEMY_TYPES[0];
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
      this.kind[index] = this.kind[last];
      this.scale[index] = this.scale[last];
      this.elite[index] = this.elite[last];
      this.attackCooldown[index] = this.attackCooldown[last];
      this.telegraph[index] = this.telegraph[last];
      this.flash[index] = this.flash[last];
      this.knockX[index] = this.knockX[last];
      this.knockZ[index] = this.knockZ[last];
      this.generation[index] = this.generation[last];
    }
  }

  clear(): void {
    this.count = 0;
  }
}

/**
 * What a step of enemy behaviour produced, for the caller to act on.
 *
 * Ranged shots and boss slams are *requested* here rather than resolved, because the
 * pool knows nothing about the player's health or about projectiles. Keeping the
 * decision here and the consequence outside is what lets the whole roster be tested
 * without a player, a renderer or a projectile pool in the room.
 */
export interface EnemyIntents {
  /** Indices that want to fire at the player this step. */
  readonly shooters: Int32Array;
  shooterCount: number;
  /** Indices whose telegraphed slam just landed. */
  readonly slammers: Int32Array;
  slammerCount: number;
}

export function createEnemyIntents(capacity = 128): EnemyIntents {
  return {
    shooters: new Int32Array(capacity),
    shooterCount: 0,
    slammers: new Int32Array(capacity),
    slammerCount: 0,
  };
}

/**
 * Advances every enemy one step: pull toward the player, push away from neighbours,
 * and weave, hold or wind up according to what the creature is.
 *
 * The grid must already be rebuilt from this pool's positions. `elapsed` drives the
 * weaving patterns, and is passed in rather than accumulated internally so that two
 * runs of the same seed stay identical.
 */
export function stepEnemies(
  pool: EnemyPool,
  grid: SpatialGrid,
  playerX: number,
  playerZ: number,
  stepSeconds: number,
  elapsed: number,
  intents: EnemyIntents,
): void {
  const { x, z, previousX, previousZ, facing, speed, flash, knockX, knockZ, count } = pool;
  intents.shooterCount = 0;
  intents.slammerCount = 0;

  for (let i = 0; i < count; i++) {
    previousX[i] = x[i];
    previousZ[i] = z[i];

    const type = pool.typeOf(i);
    const toPlayerX = playerX - x[i];
    const toPlayerZ = playerZ - z[i];
    const distance = Math.hypot(toPlayerX, toPlayerZ);
    const towardX = distance > 1e-6 ? toPlayerX / distance : 0;
    const towardZ = distance > 1e-6 ? toPlayerZ / distance : 0;

    // Contact distance scales with the creature: a Gulyabani presses in from further
    // out than a Cin simply because it is larger.
    const contact = CONTACT_DISTANCE + type.radius;

    let dirX = 0;
    let dirZ = 0;
    // Almost always the type's own speed; only a pursuing boss raises it.
    let moveSpeed = type.speed;

    switch (type.behaviour) {
      case BEHAVIOUR.zigzag:
      case BEHAVIOUR.serpentine: {
        if (distance > contact) {
          // The weave is a rotation of the approach vector, not an offset added to
          // it: adding sideways motion would let a weaving enemy drift past the
          // player entirely instead of spiralling in.
          const wave =
            Math.sin(elapsed * type.waveFrequency + pool.phase[i] * Math.PI * 2) *
            type.waveAmplitude;
          const cos = Math.cos(wave);
          const sin = Math.sin(wave);
          dirX = towardX * cos - towardZ * sin;
          dirZ = towardX * sin + towardZ * cos;
        }
        break;
      }

      case BEHAVIOUR.ranged: {
        if (pool.attackCooldown[i] > 0) pool.attackCooldown[i] -= stepSeconds;

        // Close to its preferred range, then hold. Standing still is what makes a
        // ranged enemy a reason to keep moving rather than a slower chaser.
        if (distance > type.keepDistance * 1.05) {
          dirX = towardX;
          dirZ = towardZ;
        } else if (distance < type.keepDistance * 0.7) {
          dirX = -towardX;
          dirZ = -towardZ;
        }

        if (pool.attackCooldown[i] <= 0 && distance <= type.keepDistance * 1.4) {
          pool.attackCooldown[i] = type.shotCooldown;
          if (intents.shooterCount < intents.shooters.length) {
            intents.shooters[intents.shooterCount++] = i;
          }
        }
        break;
      }

      case BEHAVIOUR.boss: {
        if (pool.telegraph[i] > 0) {
          // Rooted through the wind-up, so the warning marks a place the player can
          // actually leave rather than one that follows them.
          pool.telegraph[i] -= stepSeconds;
          if (pool.telegraph[i] <= 0) {
            pool.telegraph[i] = 0;
            if (intents.slammerCount < intents.slammers.length) {
              intents.slammers[intents.slammerCount++] = i;
            }
          }
          break;
        }

        if (pool.attackCooldown[i] > 0) pool.attackCooldown[i] -= stepSeconds;
        if (distance > contact) {
          dirX = towardX;
          dirZ = towardZ;
          moveSpeed = pursuitSpeedAt(type, distance);
        }
        if (pool.attackCooldown[i] <= 0 && distance <= type.slamRadius) {
          // Phase by health: a wounded boss winds up faster, so the fight tightens
          // as it goes rather than becoming a formality once the damage is flowing.
          const phase = bossPhase(pool, i);
          pool.attackCooldown[i] = type.slamCooldown * (phase === 3 ? 0.6 : phase === 2 ? 0.8 : 1);
          pool.telegraph[i] = type.slamTelegraph * (phase === 3 ? 0.7 : 1);
        }
        break;
      }

      case BEHAVIOUR.chase:
      default: {
        if (distance > contact) {
          dirX = towardX;
          dirZ = towardZ;
        }
        break;
      }
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

    // A boss shoves its way through rather than being jostled by the crowd it leads.
    const separation = type.behaviour === BEHAVIOUR.boss ? 0.15 : SEPARATION_STRENGTH;
    let moveX = dirX + pushX * separation;
    let moveZ = dirZ + pushZ * separation;
    const magnitude = Math.hypot(moveX, moveZ);

    if (magnitude > 1e-6) {
      moveX /= magnitude;
      moveZ /= magnitude;
      x[i] += moveX * moveSpeed * stepSeconds;
      z[i] += moveZ * moveSpeed * stepSeconds;
      speed[i] = moveSpeed;
      facing[i] = Math.atan2(moveX, moveZ);
    } else {
      speed[i] = 0;
      // A ranged enemy holding its ground still faces its target, or it would appear
      // to have lost interest while shooting.
      if (distance > 1e-6) facing[i] = Math.atan2(towardX, towardZ);
    }

    // Knockback is applied on top of, not instead of, steering: a shoved enemy keeps
    // trying to close, which reads as staggering rather than as being switched off.
    if (knockX[i] !== 0 || knockZ[i] !== 0) {
      x[i] += knockX[i] * stepSeconds;
      z[i] += knockZ[i] * stepSeconds;
      const decay = Math.exp(-KNOCKBACK_DECAY * stepSeconds);
      knockX[i] *= decay;
      knockZ[i] *= decay;
      if (Math.abs(knockX[i]) < 0.01) knockX[i] = 0;
      if (Math.abs(knockZ[i]) < 0.01) knockZ[i] = 0;
    }

    if (flash[i] > 0) {
      flash[i] -= stepSeconds / FLASH_SECONDS;
      if (flash[i] < 0) flash[i] = 0;
    }
  }
}

/**
 * How fast a boss travels at a given distance from the player.
 *
 * Close in it moves at its own speed, which is half of what makes the telegraphed slam
 * something the player can walk out of — the other half is that it is rooted through
 * the wind-up. Further out it ramps to `pursuitSpeed`, because a creature three times
 * slower than the player would otherwise arrive only if invited.
 *
 * The band matters more than it looks. A player fleeing at full speed settles wherever
 * the ramp happens to equal their own speed, so a ramp that reaches full pursuit only
 * at spawn distance parks the boss out there forever, harmless and unreachable. Ending
 * the taper at *half* the slam radius puts that equilibrium inside the range where the
 * boss starts winding up, which is the whole point of releasing one.
 *
 * Exported for the tests that pin both ends.
 */
export function pursuitSpeedAt(type: EnemyType, distance: number): number {
  if (type.pursuitSpeed <= type.speed) return type.speed;
  const near = Math.max(type.slamRadius, 1) * 0.5;
  const far = near * 2;
  if (distance <= near) return type.speed;
  const t = Math.min((distance - near) / (far - near), 1);
  return type.speed + (type.pursuitSpeed - type.speed) * t;
}

/** Which third of its health a boss is in: 1, 2 or 3. */
export function bossPhase(pool: EnemyPool, index: number): 1 | 2 | 3 {
  const type = pool.typeOf(index);
  const fraction = type.health <= 0 ? 1 : pool.health[index] / type.health;
  if (fraction > 0.66) return 1;
  if (fraction > 0.33) return 2;
  return 3;
}

/** How a batch of arrivals is arranged. */
export const FORMATION = {
  /** Evenly around the player. The default pressure. */
  ring: 0,
  /**
   * A dense line advancing from one side.
   *
   * Turns a wave into a direction the player must not be caught against, which is a
   * different problem from being surrounded and keeps the later minutes from feeling
   * like more of the same.
   */
  wall: 1,
  /** A steady trickle from one bearing, drifting slowly around it. */
  stream: 2,
} as const;

export type FormationKind = (typeof FORMATION)[keyof typeof FORMATION];

/**
 * Places a batch of arrivals just outside the player's view.
 *
 * A ring rather than a screen rectangle: the view is wider than it is tall, so
 * spawning on the rectangle would put enemies far closer above and below than at the
 * sides. A circle clearing the screen corner gives every direction the same warning,
 * matching the camera rule that sight distance is equal all round.
 *
 * @param bearing Direction the wall and stream formations come from, in radians.
 * @returns How many were actually placed.
 */
export function spawnFormation(
  pool: EnemyPool,
  rng: Rng,
  playerX: number,
  playerZ: number,
  radius: number,
  amount: number,
  kind = 0,
  eliteChance = 0,
  formation: FormationKind = FORMATION.ring,
  bearing = 0,
  healthScale = 1,
): number {
  let spawned = 0;
  for (let i = 0; i < amount; i++) {
    if (pool.full) break;

    let angle: number;
    switch (formation) {
      case FORMATION.wall:
        // A narrow arc, so the batch arrives as a front rather than a scatter.
        angle = bearing + rng.range(-0.42, 0.42);
        break;
      case FORMATION.stream:
        angle = bearing + rng.range(-0.16, 0.16);
        break;
      case FORMATION.ring:
      default:
        angle = rng.next() * Math.PI * 2;
        break;
    }

    // A little radial jitter stops arrivals forming a visible perfect circle.
    const distance = radius * rng.range(1, 1.12);
    pool.spawn(
      playerX + Math.sin(angle) * distance,
      playerZ + Math.cos(angle) * distance,
      rng.next(),
      kind,
      eliteChance > 0 && rng.chance(eliteChance),
      healthScale,
    );
    spawned++;
  }
  return spawned;
}

/** Places a batch evenly around the player. Thin wrapper kept for readability. */
export function spawnRing(
  pool: EnemyPool,
  rng: Rng,
  playerX: number,
  playerZ: number,
  radius: number,
  amount: number,
  kind = 0,
  eliteChance = 0,
): number {
  return spawnFormation(
    pool,
    rng,
    playerX,
    playerZ,
    radius,
    amount,
    kind,
    eliteChance,
    FORMATION.ring,
  );
}

/**
 * Removes enemies that have fallen far behind the player.
 *
 * Without this the pool fills with creatures the player outran minutes ago, and the
 * budget for enemies that can actually threaten them shrinks to nothing.
 *
 * Bosses are exempt. A boss is slower than the player and released exactly once, so
 * the ordinary rule would let anyone delete the fight by walking away from it — and
 * because the release is recorded as done, it would never come back.
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
    if (dx * dx + dz * dz > limitSq && pool.typeOf(i).behaviour !== BEHAVIOUR.boss) {
      pool.kill(i);
      removed++;
      // No increment: `kill` moved a different enemy into this slot.
    } else {
      i++;
    }
  }
  return removed;
}

/** How many bosses are alive. A scan, so callers should not run it in the hot loop. */
export function countBosses(pool: EnemyPool): number {
  let bosses = 0;
  for (let i = 0; i < pool.count; i++) {
    if (pool.typeOf(i).behaviour === BEHAVIOUR.boss) bosses++;
  }
  return bosses;
}

/** How many elites are alive. */
export function countElites(pool: EnemyPool): number {
  let elites = 0;
  for (let i = 0; i < pool.count; i++) elites += pool.elite[i];
  return elites;
}

/** What is on the field, in one pass. For the debug readout, not the hot loop. */
export interface HordeCensus {
  elites: number;
  bosses: number;
  /** Enemies mid wind-up, so a telegraph that never appears is visible as a zero. */
  telegraphing: number;
}

export function censusOf(pool: EnemyPool, into: HordeCensus): HordeCensus {
  into.elites = 0;
  into.bosses = 0;
  into.telegraphing = 0;
  for (let i = 0; i < pool.count; i++) {
    into.elites += pool.elite[i];
    if (pool.typeOf(i).behaviour === BEHAVIOUR.boss) into.bosses++;
    if (pool.telegraph[i] > 0) into.telegraphing++;
  }
  return into;
}
