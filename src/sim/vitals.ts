import { QUERY_DONE, type SpatialGrid } from './spatial';

/**
 * The player's health, and the crowd's ability to take it.
 *
 * Nothing before this phase could hurt the player, which made the run unloseable and
 * left half the passives — armour, regeneration, the healing pickup — describing
 * effects on a quantity that did not exist. A survival game in which survival is
 * guaranteed is a screensaver.
 *
 * Contact damage rather than attacks: these enemies have no wind-up and no reach, so
 * the threat is simply being touched. That is what makes the genre's movement matter —
 * every point of health lost is a place the player should not have stood.
 */

/** Starting health. */
export const MAX_HEALTH = 100;

/** Damage per second from being in contact with the crowd. */
const CONTACT_DAMAGE_PER_SECOND = 14;

/**
 * How much a second, third, fourth attacker adds.
 *
 * Damage does not scale linearly with the number of enemies touching the player: in a
 * game whose entire late phase is being surrounded, linear scaling means the first
 * moment of being enclosed is instantly fatal, and nothing the player did before it
 * mattered. Each extra body adds progressively less.
 */
const CROWD_FALLOFF = 0.45;

/** Bodies beyond this add nothing, capping the worst case. */
const MAX_ATTACKERS = 6;

/** Distance at which an enemy counts as touching. */
const CONTACT_RADIUS = 1.05;

/** Seconds of immunity after taking a hit, so a crowd cannot delete the player. */
const INVULNERABLE_SECONDS = 0.42;

export interface Vitals {
  health: number;
  maxHealth: number;
  /** Seconds of remaining immunity. */
  invulnerable: number;
  /** Set the moment health reaches zero, so the caller can end the run once. */
  dead: boolean;
  /** Rises to 1 when hit and decays, for the screen's red flash. */
  hurtFlash: number;
}

export function createVitals(maxHealth = MAX_HEALTH): Vitals {
  return { health: maxHealth, maxHealth, invulnerable: 0, dead: false, hurtFlash: 0 };
}

export function heal(vitals: Vitals, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0 || vitals.dead) return;
  vitals.health = Math.min(vitals.maxHealth, vitals.health + amount);
}

/**
 * Applies contact damage, regeneration and the immunity clock for one step.
 *
 * @param armour Flat reduction per damage event, from the Kalkan passive.
 * @param regenPerSecond From the Şerbet passive.
 * @returns Damage actually taken, for feedback effects.
 */
export function stepVitals(
  vitals: Vitals,
  grid: SpatialGrid,
  playerX: number,
  playerZ: number,
  stepSeconds: number,
  armour: number,
  regenPerSecond: number,
): number {
  if (vitals.dead) return 0;

  if (vitals.hurtFlash > 0) {
    vitals.hurtFlash = Math.max(0, vitals.hurtFlash - stepSeconds / 0.4);
  }

  if (regenPerSecond > 0) heal(vitals, regenPerSecond * stepSeconds);

  if (vitals.invulnerable > 0) {
    vitals.invulnerable -= stepSeconds;
    return 0;
  }

  let attackers = 0;
  grid.beginQuery(playerX, playerZ, CONTACT_RADIUS);
  for (;;) {
    const enemy = grid.next();
    if (enemy === QUERY_DONE) break;
    if (++attackers >= MAX_ATTACKERS) {
      grid.endQuery();
      break;
    }
  }
  if (attackers === 0) return 0;

  // The first attacker deals full damage, each further one a diminishing share.
  let scale = 0;
  for (let i = 0; i < attackers; i++) scale += Math.pow(CROWD_FALLOFF, i);

  const raw = CONTACT_DAMAGE_PER_SECOND * scale * INVULNERABLE_SECONDS;
  // `Math.max(0, NaN)` is NaN rather than 0, so a malformed armour value would turn
  // health into NaN — and NaN health can never reach zero, so the player becomes
  // both unkillable and unable to see a working health bar. The same trap was
  // already found once in the damage pipeline; guarding it needs to be deliberate
  // at every boundary, not remembered.
  const safeArmour = Number.isFinite(armour) ? Math.max(0, armour) : 0;
  const taken = Math.max(1, raw - safeArmour);

  vitals.health -= taken;
  vitals.invulnerable = INVULNERABLE_SECONDS;
  vitals.hurtFlash = 1;

  if (vitals.health <= 0) {
    vitals.health = 0;
    vitals.dead = true;
  }
  return taken;
}
