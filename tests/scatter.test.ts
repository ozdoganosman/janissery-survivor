import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  cellIndex,
  cellSeed,
  MAX_PROPS_PER_CELL,
  propCapacity,
  propsAround,
  propsInCell,
} from '../src/render/world/scatter';

describe('cellIndex', () => {
  it('maps a coordinate to the cell containing it', () => {
    expect(cellIndex(0)).toBe(0);
    expect(cellIndex(CELL_SIZE - 0.01)).toBe(0);
    expect(cellIndex(CELL_SIZE)).toBe(1);
  });

  it('floors rather than truncates, so it stays correct below zero', () => {
    // Truncation would put -0.5 and +0.5 in the same cell, producing a double-width
    // strip of scenery along each axis.
    expect(cellIndex(-0.01)).toBe(-1);
    expect(cellIndex(-CELL_SIZE)).toBe(-1);
    expect(cellIndex(-CELL_SIZE - 0.01)).toBe(-2);
  });
});

describe('cellSeed', () => {
  it('is stable for the same cell', () => {
    expect(cellSeed(7, 3, -4)).toBe(cellSeed(7, 3, -4));
  });

  it('distinguishes cells on the same anti-diagonal', () => {
    // A seed built by adding the coordinates gives every cell where x+z is equal the
    // same contents, and the resulting diagonal stripes across the map are obvious.
    expect(cellSeed(1, 0, 6)).not.toBe(cellSeed(1, 6, 0));
    expect(cellSeed(1, 2, 4)).not.toBe(cellSeed(1, 4, 2));
    expect(cellSeed(1, 1, 5)).not.toBe(cellSeed(1, 3, 3));
  });

  it('distinguishes neighbouring cells', () => {
    const seeds = new Set<number>();
    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) seeds.add(cellSeed(99, x, z));
    }
    // 169 distinct cells hashed into a 32-bit space should collide essentially
    // never. The first implementation managed only 123, which would have grown the
    // same ruins in 46 different places.
    expect(seeds.size).toBe(169);
  });

  it('changes with the world seed', () => {
    expect(cellSeed(1, 4, 4)).not.toBe(cellSeed(2, 4, 4));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const [x, z] of [
      [0, 0],
      [-1000, 1000],
      [123456, -654321],
    ]) {
      const seed = cellSeed(5, x, z);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('propsInCell', () => {
  it('returns the same scenery every time it is asked', () => {
    // The point of the whole scheme: walk away from a ruin and it is still there.
    const first = propsInCell(42, 3, -7);
    const second = propsInCell(42, 3, -7);
    expect(second).toEqual(first);
  });

  it('never exceeds the declared maximum', () => {
    for (let x = -30; x <= 30; x++) {
      for (let z = -30; z <= 30; z++) {
        expect(propsInCell(11, x, z).length).toBeLessThanOrEqual(MAX_PROPS_PER_CELL);
      }
    }
  });

  it('keeps every prop inside its own cell', () => {
    // Props that spill over a boundary would appear and disappear as the loaded
    // window slides, since the neighbouring cell is not always resident.
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) {
        for (const prop of propsInCell(23, x, z)) {
          expect(prop.x).toBeGreaterThanOrEqual(x * CELL_SIZE);
          expect(prop.x).toBeLessThan((x + 1) * CELL_SIZE);
          expect(prop.z).toBeGreaterThanOrEqual(z * CELL_SIZE);
          expect(prop.z).toBeLessThan((z + 1) * CELL_SIZE);
        }
      }
    }
  });

  it('leaves some cells empty and fills others', () => {
    let empty = 0;
    let populated = 0;
    for (let x = -20; x <= 20; x++) {
      for (let z = -20; z <= 20; z++) {
        if (propsInCell(3, x, z).length === 0) empty++;
        else populated++;
      }
    }
    // Filling every cell reads as an orchard; filling none is an empty plain.
    expect(empty).toBeGreaterThan(0);
    expect(populated).toBeGreaterThan(empty);
  });

  it('produces all three kinds across a region', () => {
    const kinds = new Set<string>();
    for (let x = -20; x <= 20; x++) {
      for (let z = -20; z <= 20; z++) {
        for (const prop of propsInCell(8, x, z)) kinds.add(prop.kind);
      }
    }
    expect(kinds).toEqual(new Set(['sur', 'servi', 'kandil']));
  });

  it('gives every prop a sane facing and scale', () => {
    for (let x = -15; x <= 15; x++) {
      for (let z = -15; z <= 15; z++) {
        for (const prop of propsInCell(17, x, z)) {
          expect(prop.facing).toBeGreaterThanOrEqual(0);
          expect(prop.facing).toBeLessThan(Math.PI * 2);
          expect(prop.scale).toBeGreaterThan(0.5);
          expect(prop.scale).toBeLessThan(2);
        }
      }
    }
  });

  it('lays out a different world for a different seed', () => {
    const a = JSON.stringify(Array.from({ length: 20 }, (_, i) => propsInCell(1, i, 0)));
    const b = JSON.stringify(Array.from({ length: 20 }, (_, i) => propsInCell(2, i, 0)));
    expect(a).not.toBe(b);
  });
});

describe('propsAround', () => {
  it('covers the full square of cells at the given radius', () => {
    const props = propsAround(5, 0, 0, 2);
    const expected = [];
    for (let z = -2; z <= 2; z++) {
      for (let x = -2; x <= 2; x++) expected.push(...propsInCell(5, x, z));
    }
    expect(props).toEqual(expected);
  });

  it('is centred on the cell containing the position, not the origin', () => {
    const far = propsAround(5, 100, 100, 1);
    for (const prop of far) {
      expect(Math.hypot(prop.x - 100, prop.z - 100)).toBeLessThan(CELL_SIZE * 3);
    }
  });

  it('never returns more than the renderer has room for', () => {
    // The renderer preallocates from propCapacity; overflowing it would silently drop
    // scenery, which looks like the world thinning out for no reason.
    for (const radius of [1, 2, 3, 4]) {
      const capacity = propCapacity(radius);
      for (let i = 0; i < 40; i++) {
        const props = propsAround(31, i * 37, i * -53, radius);
        expect(props.length).toBeLessThanOrEqual(capacity);
      }
    }
  });

  it('keeps overlapping cells identical as the window slides', () => {
    // Two positions one cell apart must agree about the cells they share, otherwise
    // scenery jitters whenever the player crosses a boundary.
    const left = propsAround(64, 0, 0, 2);
    const right = propsAround(64, CELL_SIZE, 0, 2);
    const leftKeys = new Set(left.map((p) => `${p.kind}:${p.x}:${p.z}`));
    const shared = right.filter((p) => cellIndex(p.x) >= -1 && cellIndex(p.x) <= 2);
    for (const prop of shared) {
      expect(leftKeys.has(`${prop.kind}:${prop.x}:${prop.z}`)).toBe(true);
    }
  });
});

describe('propCapacity', () => {
  it('accounts for every cell in the square', () => {
    expect(propCapacity(0)).toBe(MAX_PROPS_PER_CELL);
    expect(propCapacity(1)).toBe(9 * MAX_PROPS_PER_CELL);
    expect(propCapacity(3)).toBe(49 * MAX_PROPS_PER_CELL);
  });
});
