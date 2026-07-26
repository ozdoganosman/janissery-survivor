/**
 * Experience and levels.
 *
 * The curve is the run's pacing dial. Early levels have to arrive quickly — the first
 * few upgrades are what turn a helpless start into a build — and then stretch out, so
 * that by the tenth minute a level is an event rather than an interruption. A linear
 * curve gives neither: it either floods the player with card screens at the end or
 * starves them at the beginning.
 */

/** Experience needed to reach level 2. */
const BASE_REQUIREMENT = 5;

/** Added to each subsequent level's requirement. */
const LINEAR_STEP = 4;

/** Extra growth that compounds, so late levels stretch without becoming unreachable. */
const QUADRATIC_STEP = 0.9;

export interface Progression {
  level: number;
  /** Experience banked toward the next level. */
  experience: number;
  /** Experience the current level requires. */
  required: number;
  /** Total collected this run, for the summary screen. */
  lifetime: number;
}

export function createProgression(): Progression {
  return { level: 1, experience: 0, required: experienceForLevel(1), lifetime: 0 };
}

/** Experience needed to go from `level` to `level + 1`. */
export function experienceForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return BASE_REQUIREMENT;
  const steps = level - 1;
  return Math.round(BASE_REQUIREMENT + steps * LINEAR_STEP + steps * steps * QUADRATIC_STEP);
}

/**
 * Banks experience and reports how many levels it bought.
 *
 * Returns a count rather than firing a callback because several levels can land in
 * one step — a chest, or walking into a field of gems — and the caller has to queue
 * that many card screens rather than losing all but the last.
 */
export function addExperience(progression: Progression, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  progression.experience += amount;
  progression.lifetime += amount;

  let gained = 0;
  // A loop, not a division: each level costs more than the last, so the requirement
  // has to be recomputed as it is consumed.
  while (progression.experience >= progression.required) {
    progression.experience -= progression.required;
    progression.level++;
    progression.required = experienceForLevel(progression.level);
    gained++;
  }
  return gained;
}

/** Fraction of the way to the next level, in [0, 1). */
export function levelProgress(progression: Progression): number {
  if (progression.required <= 0) return 0;
  return Math.min(1, progression.experience / progression.required);
}
