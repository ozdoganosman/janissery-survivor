/**
 * Seedable pseudo-random number generation.
 *
 * `Math.random()` cannot be seeded, which makes a bad run impossible to reproduce.
 * Every random decision in the simulation — spawn positions, level-up card offers,
 * critical hits, loot rolls — draws from a seeded generator instead, so a run can
 * be replayed exactly from its seed while investigating a balance or crash report.
 *
 * The algorithm is mulberry32: 32-bit state, a handful of integer ops, no
 * allocation per call. Statistical quality is far beyond what a game needs, and it
 * is fast enough to call thousands of times per simulation step.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). Returns 0 when the range is empty. */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform element from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with the given probability in [0, 1]. */
  chance(probability: number): boolean;
  /**
   * A new generator seeded from this one's next draw.
   *
   * Use this to give each system its own stream. If spawning and loot share one
   * generator, adding a single spawn roll shifts every later loot roll and makes
   * replays diverge; independent streams keep each subsystem reproducible on its own.
   */
  fork(): Rng;
}

export function createRng(seed: number): Rng {
  // Force the seed into an unsigned 32-bit integer; a float or negative seed would
  // otherwise silently produce a different stream than the same value round-tripped
  // through a URL parameter.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // >>> 0 keeps the xor result unsigned before scaling into [0, 1).
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => {
      if (items.length === 0) {
        throw new RangeError('Rng.pick requires a non-empty array');
      }
      return items[Math.floor(next() * items.length)];
    },
    chance: (probability) => next() < probability,
    fork: () => createRng(Math.floor(next() * 4294967296)),
  };

  return rng;
}

/**
 * Turns a human-typable seed (`"mehter"`) into a numeric seed, so shared runs can be
 * described by a word instead of a ten-digit number. FNV-1a: order-sensitive and
 * well distributed for short strings.
 */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
