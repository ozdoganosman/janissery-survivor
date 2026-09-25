import { describe, expect, it } from 'vitest';
import { chaikin, smoothPath, supercoverLine } from '../src/core/geom';
import { fbm } from '../src/core/noise';
import { createRng, hash2 } from '../src/core/rng';

describe('rng', () => {
  it('repeats exactly for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in range', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
      expect(r.int(5)).toBeLessThan(5);
    }
  });

  it('hashes coordinates stably', () => {
    expect(hash2(3, 4)).toBe(hash2(3, 4));
    expect(hash2(3, 4)).not.toBe(hash2(4, 3));
  });
});

describe('noise', () => {
  it('fbm stays within [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = fbm(i * 0.37, i * 0.11, 4, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('supercoverLine', () => {
  const isFourConnected = (tiles: Array<[number, number]>): boolean =>
    tiles.every(
      (t, i) => i === 0 || Math.abs(t[0] - tiles[i - 1][0]) + Math.abs(t[1] - tiles[i - 1][1]) === 1,
    );

  it('includes both end points', () => {
    const line = supercoverLine(2, 3, 9, -4);
    expect(line[0]).toEqual([2, 3]);
    expect(line[line.length - 1]).toEqual([9, -4]);
  });

  it('never steps diagonally', () => {
    for (const [x1, z1] of [
      [7, 3],
      [-5, 8],
      [4, 4],
      [0, -6],
      [11, -2],
    ]) {
      expect(isFourConnected(supercoverLine(0, 0, x1, z1))).toBe(true);
    }
  });

  it('has exactly |dx| + |dz| + 1 tiles', () => {
    expect(supercoverLine(0, 0, 5, 3)).toHaveLength(9);
    expect(supercoverLine(0, 0, 0, 0)).toHaveLength(1);
  });
});

describe('paths', () => {
  it('smoothPath passes through its end points', () => {
    const p = smoothPath(
      [
        [0, 0],
        [10, 5],
        [20, 0],
      ],
      1,
    );
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([20, 0]);
  });

  it('chaikin keeps open end points', () => {
    const pts = chaikin(
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [2, 1],
      ],
      2,
    );
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([2, 1]);
    expect(pts.length).toBeGreaterThan(4);
  });
});
