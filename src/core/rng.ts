/**
 * Seedable random numbers.
 *
 * Every random choice in the city (street layout, which lots are built, house variations)
 * comes from a seeded stream, so the same seed always produces the same Konya. That makes
 * bugs reproducible and lets tests assert on concrete layouts.
 *
 * mulberry32: 32 bits of state, a few integer operations per draw.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/**
 * One draw from a generator whose state lives in plain data (a saved city, for example)
 * rather than in a closure. Advances `holder.rngState`.
 */
export function nextRandom(holder: { rngState: number }): number {
  holder.rngState = (holder.rngState + 0x6d2b79f5) >>> 0;
  let t = holder.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRng(seed: number): Rng {
  const holder = { rngState: seed >>> 0 };
  const next = (): number => nextRandom(holder);
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('pick() needs a non-empty array');
      return items[Math.floor(next() * items.length)];
    },
  };
}

/**
 * A stable pseudo-random value in [0, 1) for an integer pair, e.g. a tile coordinate.
 *
 * Used where a value must depend only on *where* something is rather than on how many
 * random draws came before it: a house keeps its look when an unrelated road is built.
 */
export function hash2(x: number, z: number, salt = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(salt | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
