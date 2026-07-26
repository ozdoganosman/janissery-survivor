import { describe, expect, it } from 'vitest';
import { createRng, seedFromString } from '../src/core/rng';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const drawsA = Array.from({ length: 50 }, () => a.next());
    const drawsB = Array.from({ length: 50 }, () => b.next());
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('normalises the seed so equivalent values give one stream', () => {
    // A seed round-tripped through a URL or a bitwise op must not change the run.
    expect(createRng(-1).next()).toBe(createRng(0xffffffff).next());
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(seedFromString('mehter'));
    for (let i = 0; i < 20000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('does not immediately repeat or stall', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 10000; i++) seen.add(rng.next());
    // A generator stuck in a short cycle would collapse to a handful of values.
    expect(seen.size).toBeGreaterThan(9900);
  });

  it('spreads draws roughly evenly across the unit interval', () => {
    const rng = createRng(99);
    const buckets = new Array<number>(10).fill(0);
    const draws = 100000;
    for (let i = 0; i < draws; i++) {
      buckets[Math.floor(rng.next() * 10)]++;
    }
    // Expect 10000 per bucket; allow generous slack so the test is not flaky while
    // still catching a genuinely skewed generator.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  describe('int', () => {
    it('stays in range', () => {
      const rng = createRng(3);
      for (let i = 0; i < 5000; i++) {
        const value = rng.int(6);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(6);
      }
    });

    it('reaches both ends of the range', () => {
      const rng = createRng(4);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) seen.add(rng.int(4));
      expect(seen).toEqual(new Set([0, 1, 2, 3]));
    });

    it('returns 0 for an empty range instead of NaN', () => {
      const rng = createRng(5);
      expect(rng.int(0)).toBe(0);
      expect(rng.int(-3)).toBe(0);
    });
  });

  describe('range', () => {
    it('stays within the requested bounds', () => {
      const rng = createRng(11);
      for (let i = 0; i < 5000; i++) {
        const value = rng.range(-4, 9);
        expect(value).toBeGreaterThanOrEqual(-4);
        expect(value).toBeLessThan(9);
      }
    });
  });

  describe('pick', () => {
    it('selects elements from the array', () => {
      const rng = createRng(21);
      const items = ['cin', 'gulyabani', 'karakoncolos'] as const;
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
      expect(seen).toEqual(new Set(items));
    });

    it('never returns undefined for a single-element array', () => {
      const rng = createRng(22);
      for (let i = 0; i < 100; i++) expect(rng.pick(['yatağan'])).toBe('yatağan');
    });

    it('throws on an empty array rather than yielding undefined', () => {
      expect(() => createRng(23).pick([])).toThrow(RangeError);
    });
  });

  describe('chance', () => {
    it('always fails at probability 0 and always succeeds at 1', () => {
      const rng = createRng(31);
      for (let i = 0; i < 500; i++) {
        expect(rng.chance(0)).toBe(false);
        expect(rng.chance(1)).toBe(true);
      }
    });

    it('approximates the requested probability', () => {
      const rng = createRng(32);
      let hits = 0;
      const trials = 100000;
      for (let i = 0; i < trials; i++) if (rng.chance(0.25)) hits++;
      expect(hits / trials).toBeCloseTo(0.25, 2);
    });
  });

  describe('fork', () => {
    it('gives an independent, still-reproducible stream', () => {
      const parentA = createRng(500);
      const parentB = createRng(500);
      const forkA = parentA.fork();
      const forkB = parentB.fork();
      expect(forkA.next()).toBe(forkB.next());
    });

    it('isolates subsystems so extra draws in one do not shift the other', () => {
      // The point of forking: adding a spawn roll must not change loot outcomes.
      const run1 = createRng(777);
      const spawns1 = run1.fork();
      const loot1 = run1.fork();
      spawns1.next();
      const lootFirst = loot1.next();

      const run2 = createRng(777);
      const spawns2 = run2.fork();
      const loot2 = run2.fork();
      // Draw far more from the spawn stream this time.
      for (let i = 0; i < 1000; i++) spawns2.next();

      expect(loot2.next()).toBe(lootFirst);
    });

    it('does not hand back the parent sequence', () => {
      const parent = createRng(900);
      const child = parent.fork();
      expect(child.next()).not.toBe(parent.next());
    });
  });
});

describe('seedFromString', () => {
  it('is stable and case sensitive', () => {
    expect(seedFromString('mehter')).toBe(seedFromString('mehter'));
    expect(seedFromString('mehter')).not.toBe(seedFromString('Mehter'));
  });

  it('is order sensitive', () => {
    expect(seedFromString('ab')).not.toBe(seedFromString('ba'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const text of ['', 'a', 'yeniçeri', 'şahmeran yavrusu', 'x'.repeat(500)]) {
      const seed = seedFromString(text);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('separates similar words', () => {
    const seeds = new Set(['cin', 'cins', 'icn', 'nic'].map(seedFromString));
    expect(seeds.size).toBe(4);
  });
});
