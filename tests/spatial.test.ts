import { describe, expect, it } from 'vitest';
import { QUERY_DONE, SpatialGrid } from '../src/sim/spatial';

/** Collects a query's results. Test-only: the hot loop uses the cursor directly. */
function near(grid: SpatialGrid, x: number, z: number, radius: number): number[] {
  const found: number[] = [];
  grid.beginQuery(x, z, radius);
  for (;;) {
    const index = grid.next();
    if (index === QUERY_DONE) break;
    found.push(index);
  }
  return found.sort((a, b) => a - b);
}

function gridOf(points: [number, number][], cellSize = 2): SpatialGrid {
  const xs = new Float32Array(points.map((p) => p[0]));
  const zs = new Float32Array(points.map((p) => p[1]));
  const grid = new SpatialGrid(cellSize, Math.max(1, points.length));
  grid.rebuild(points.length, xs, zs);
  return grid;
}

describe('SpatialGrid construction', () => {
  it('rejects an unusable configuration', () => {
    expect(() => new SpatialGrid(0, 10)).toThrow(RangeError);
    expect(() => new SpatialGrid(-1, 10)).toThrow(RangeError);
    expect(() => new SpatialGrid(2, 0)).toThrow(RangeError);
    expect(() => new SpatialGrid(2, 1.5)).toThrow(RangeError);
  });

  it('refuses to index more than its capacity', () => {
    const grid = new SpatialGrid(2, 4);
    expect(() => grid.rebuild(5, new Float32Array(5), new Float32Array(5))).toThrow(RangeError);
  });
});

describe('cellOf', () => {
  it('floors, so it stays correct either side of zero', () => {
    const grid = new SpatialGrid(2, 1);
    expect(grid.cellOf(0)).toBe(0);
    expect(grid.cellOf(1.9)).toBe(0);
    expect(grid.cellOf(2)).toBe(1);
    // Truncation would merge -1..1 into one double-width cell.
    expect(grid.cellOf(-0.1)).toBe(-1);
    expect(grid.cellOf(-2)).toBe(-1);
    expect(grid.cellOf(-2.1)).toBe(-2);
  });
});

describe('queries', () => {
  it('finds a point at the query centre', () => {
    const grid = gridOf([[5, 5]]);
    expect(near(grid, 5, 5, 1)).toEqual([0]);
  });

  it('excludes points beyond the radius', () => {
    const grid = gridOf([
      [0, 0],
      [10, 0],
    ]);
    expect(near(grid, 0, 0, 1)).toEqual([0]);
  });

  it('filters by true distance, not by cell', () => {
    // Corner of a diagonal cell is inside the 3x3 block but outside the circle; a
    // grid that returned whole cells would wrongly include it.
    const grid = gridOf([[1.9, 1.9]], 2);
    expect(near(grid, 0, 0, 1)).toEqual([]);
    expect(near(grid, 0, 0, 3)).toEqual([0]);
  });

  it('spans cell boundaries in every direction', () => {
    const grid = gridOf([
      [-3, 0],
      [3, 0],
      [0, -3],
      [0, 3],
      [0, 0],
    ]);
    expect(near(grid, 0, 0, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('works far from the origin, where a fixed cell array could not reach', () => {
    const grid = gridOf([
      [10_000, -8_000],
      [10_001, -8_000],
      [0, 0],
    ]);
    expect(near(grid, 10_000, -8_000, 2)).toEqual([0, 1]);
  });

  it('never returns the same entity twice', () => {
    // Two cells inside one query can hash to the same bucket. Without the cell-match
    // check that entity would be visited once per colliding cell, and a single
    // neighbour would shove twice as hard as it should.
    const points: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      points.push([(i % 20) * 0.9 - 9, Math.floor(i / 20) * 0.9 - 9]);
    }
    const grid = gridOf(points);
    for (const [x, z] of points) {
      const found = near(grid, x, z, 3);
      expect(new Set(found).size).toBe(found.length);
    }
  });

  it('agrees with brute force over a random cloud', () => {
    // The grid is an optimisation; the only thing that matters is that it returns
    // exactly what an all-pairs scan would.
    const points: [number, number][] = [];
    let state = 12345;
    const random = (): number => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = 0; i < 500; i++) points.push([random() * 60 - 30, random() * 60 - 30]);

    const grid = gridOf(points);
    for (const radius of [0.5, 1.5, 4]) {
      for (let trial = 0; trial < 40; trial++) {
        const qx = random() * 60 - 30;
        const qz = random() * 60 - 30;
        const expected = points
          .map((p, index) => ({ p, index }))
          .filter(({ p }) => Math.hypot(p[0] - qx, p[1] - qz) <= radius)
          .map(({ index }) => index)
          .sort((a, b) => a - b);
        expect(near(grid, qx, qz, radius)).toEqual(expected);
      }
    }
  });

  it('handles many entities sharing one position', () => {
    const points: [number, number][] = Array.from({ length: 50 }, () => [3, 3]);
    const grid = gridOf(points);
    expect(near(grid, 3, 3, 0.1)).toHaveLength(50);
  });

  it('returns nothing when the grid is empty', () => {
    const grid = new SpatialGrid(2, 4);
    grid.rebuild(0, new Float32Array(4), new Float32Array(4));
    expect(near(grid, 0, 0, 10)).toEqual([]);
  });

  it('reflects the latest rebuild only', () => {
    const grid = new SpatialGrid(2, 4);
    const xs = new Float32Array([0, 50, 0, 0]);
    const zs = new Float32Array([0, 50, 0, 0]);
    grid.rebuild(2, xs, zs);
    expect(near(grid, 0, 0, 1)).toEqual([0]);

    xs[0] = 50;
    zs[0] = 50;
    grid.rebuild(2, xs, zs);
    expect(near(grid, 0, 0, 1)).toEqual([]);
    expect(near(grid, 50, 50, 1)).toEqual([0, 1]);
  });

  it('reports how many entities it indexed', () => {
    const grid = gridOf([
      [0, 0],
      [1, 1],
    ]);
    expect(grid.indexedCount).toBe(2);
  });
});

describe('cursor discipline', () => {
  it('refuses to nest queries', () => {
    // Nested queries would share one cursor and silently corrupt each other, which
    // is far worse than failing loudly.
    const grid = gridOf([[0, 0]]);
    grid.beginQuery(0, 0, 1);
    expect(() => grid.beginQuery(1, 1, 1)).toThrow(/cannot nest/);
    grid.endQuery();
  });

  it('allows a new query after the previous one is exhausted', () => {
    const grid = gridOf([
      [0, 0],
      [1, 0],
    ]);
    expect(near(grid, 0, 0, 5)).toEqual([0, 1]);
    expect(near(grid, 0, 0, 5)).toEqual([0, 1]);
  });

  it('allows a new query after an abandoned one', () => {
    // The separation loop stops early once it has enough neighbours, so abandoning
    // mid-query is the normal path, not an error case.
    const grid = gridOf([
      [0, 0],
      [0.5, 0],
      [1, 0],
    ]);
    grid.beginQuery(0, 0, 5);
    expect(grid.next()).toBeGreaterThanOrEqual(0);
    grid.endQuery();
    expect(near(grid, 0, 0, 5)).toEqual([0, 1, 2]);
  });

  it('keeps returning DONE once exhausted', () => {
    const grid = gridOf([[0, 0]]);
    grid.beginQuery(20, 20, 1);
    expect(grid.next()).toBe(QUERY_DONE);
    expect(grid.next()).toBe(QUERY_DONE);
  });
});
