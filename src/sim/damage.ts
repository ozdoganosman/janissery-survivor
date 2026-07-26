import type { Rng } from '../core/rng';

/**
 * How a hit becomes a number.
 *
 * Every weapon in the game funnels through here, which is the point: when the player
 * asks why one build shreds and another stalls, the answer has to live in one
 * readable function rather than being spread across six weapons that each learned to
 * multiply slightly differently.
 *
 * The order is fixed and deliberate — base, then multipliers, then the critical roll,
 * then the target's reduction. Applying reduction before the critical would make
 * armour scale *with* crits, so a tough enemy would resist a lucky hit more than an
 * ordinary one, which nobody expects.
 */

export interface DamageRoll {
  readonly amount: number;
  readonly critical: boolean;
}

/** What the attacker brings. Passives and weapon levels feed this. */
export interface AttackProfile {
  /** Weapon damage before any scaling. */
  readonly base: number;
  /** Product of every damage-increasing effect. 1 means unmodified. */
  readonly multiplier: number;
  /** Probability in [0, 1]. */
  readonly criticalChance: number;
  /** Damage factor on a critical. */
  readonly criticalMultiplier: number;
}

/** What the target resists with. Bosses use it; ordinary enemies leave it at zero. */
export interface DefenceProfile {
  /** Subtracted after scaling. */
  readonly flatReduction: number;
  /** Fraction removed, in [0, 1). */
  readonly percentReduction: number;
}

export const NO_DEFENCE: DefenceProfile = { flatReduction: 0, percentReduction: 0 };

/**
 * Minimum damage a connecting hit deals.
 *
 * Without a floor, a well-armoured target reduces some weapons to exactly zero, and a
 * weapon that visibly hits for nothing reads as broken rather than as ineffective.
 */
export const MINIMUM_DAMAGE = 1;

/**
 * Resolves one hit.
 *
 * Takes an `Rng` rather than calling a global, so a run replays identically from its
 * seed — including which hits happened to be critical.
 */
export function rollDamage(attack: AttackProfile, defence: DefenceProfile, rng: Rng): DamageRoll {
  const critical = attack.criticalChance > 0 && rng.chance(attack.criticalChance);
  return {
    amount: computeDamage(attack, defence, critical),
    critical,
  };
}

/**
 * The arithmetic, split out from the dice.
 *
 * Separating them means the numbers can be tested exhaustively without threading a
 * generator through every case, and a balance spreadsheet can call the same function
 * the game does.
 */
export function computeDamage(
  attack: AttackProfile,
  defence: DefenceProfile,
  critical: boolean,
): number {
  if (!Number.isFinite(attack.base) || attack.base <= 0) return 0;

  const multiplier = Number.isFinite(attack.multiplier) ? Math.max(0, attack.multiplier) : 1;
  let amount = attack.base * multiplier;

  if (critical) {
    const criticalMultiplier = Number.isFinite(attack.criticalMultiplier)
      ? Math.max(1, attack.criticalMultiplier)
      : 1;
    amount *= criticalMultiplier;
  }

  const percent = clamp(defence.percentReduction, 0, 0.95);
  amount *= 1 - percent;
  // `Math.max(0, NaN)` is NaN, not 0, so a malformed armour value would sail through
  // here and become NaN health — and NaN health is unrecoverable, since every later
  // comparison against it is false and the enemy can neither die nor be hit again.
  amount -= clamp(defence.flatReduction, 0, Number.MAX_VALUE);

  return Math.max(MINIMUM_DAMAGE, amount);
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return value < low ? low : value > high ? high : value;
}

/**
 * Damage dealt over a slice of time.
 *
 * Continuous sources — the Kandil's flame, burning — are authored as damage per
 * second and must not depend on the tick rate. Anything that multiplies a per-second
 * figure by the step length belongs here rather than in the weapon.
 */
export function damageOverTime(damagePerSecond: number, stepSeconds: number): number {
  if (!Number.isFinite(damagePerSecond) || !Number.isFinite(stepSeconds)) return 0;
  return Math.max(0, damagePerSecond) * Math.max(0, stepSeconds);
}
