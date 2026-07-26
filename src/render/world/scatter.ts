import { createRng } from '../../core/rng';

/**
 * Deterministic scenery placement over an unbounded world.
 *
 * A fifteen-minute run at full speed covers several thousand world units, so the
 * scenery cannot be a fixed list. It also cannot be random per frame: the player must
 * be able to walk away from a ruined wall and find it still there on the way back.
 *
 * The world is therefore divided into cells, and each cell's contents are derived
 * from a hash of its coordinates and the run's seed. Nothing is stored — cell (17,-4)
 * yields the same three cypresses whenever it is asked, this run and every replay of
 * the same seed. Memory is bounded by what is on screen, not by where the player has
 * been.
 *
 * Free of any `three` import so the placement can be tested directly.
 */

/** Side length of one scenery cell, in world units. */
export const CELL_SIZE = 13;

/** Upper bound on props per cell. Fixes the renderer's instance capacity. */
export const MAX_PROPS_PER_CELL = 3;

export type PropKind = 'sur' | 'servi' | 'kandil';

export interface ScatteredProp {
  readonly kind: PropKind;
  readonly x: number;
  readonly z: number;
  /** Rotation about Y in radians. */
  readonly facing: number;
  readonly scale: number;
}

/**
 * Relative frequency of each prop kind.
 *
 * Ruined walls dominate because they are what names the map; lanterns are rare so
 * that spotting one still registers.
 */
const KIND_WEIGHTS: readonly (readonly [PropKind, number])[] = [
  ['sur', 0.5],
  ['servi', 0.36],
  ['kandil', 0.14],
];

/**
 * The murmur3 finalizer: spreads every input bit across all 32 output bits.
 *
 * Cell coordinates are small consecutive integers, which is the worst case for a
 * lazy hash — neighbouring cells differ in one low bit and stay neighbours in the
 * output unless something forces an avalanche.
 */
function finalize(hash: number): number {
  let h = hash | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hashes a cell coordinate and the world seed into a generator seed.
 *
 * Each coordinate is folded in and then fully avalanched before the next joins, and
 * that ordering is the whole trick. The first attempt combined both coordinates with
 * XOR and finalized once; measured over a 13x13 block it produced 46 collisions out
 * of 169 cells, because XOR-ing two small structured sets collides constantly. Since
 * a collision means two different cells growing the identical scenery, that would
 * have shown up as a landscape that visibly repeats. Avalanching between the two
 * gives zero collisions over 90 601 cells.
 */
export function cellSeed(worldSeed: number, cellX: number, cellZ: number): number {
  const base = finalize(worldSeed ^ 0x9e3779b9);
  const withX = finalize((base + Math.imul(cellX, 0x9e3779b1)) | 0);
  return finalize((withX + Math.imul(cellZ, 0x85ebca77)) | 0);
}

/** World coordinate to cell index. Floor, so it stays correct either side of zero. */
export function cellIndex(coordinate: number): number {
  return Math.floor(coordinate / CELL_SIZE);
}

/** The scenery in one cell. Pure: same inputs, same output, every time. */
export function propsInCell(worldSeed: number, cellX: number, cellZ: number): ScatteredProp[] {
  const rng = createRng(cellSeed(worldSeed, cellX, cellZ));

  // Roughly two thirds of cells hold something. Filling every cell reads as an
  // orchard rather than as ruins.
  const count = rng.chance(0.34) ? 0 : 1 + rng.int(MAX_PROPS_PER_CELL);

  const props: ScatteredProp[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    let kind: PropKind = 'sur';
    let cumulative = 0;
    for (const [candidate, weight] of KIND_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) {
        kind = candidate;
        break;
      }
    }

    // Inset from the cell edge so props from neighbouring cells do not intersect.
    const margin = CELL_SIZE * 0.16;
    props.push({
      kind,
      x: cellX * CELL_SIZE + rng.range(margin, CELL_SIZE - margin),
      z: cellZ * CELL_SIZE + rng.range(margin, CELL_SIZE - margin),
      facing: rng.range(0, Math.PI * 2),
      // Cypresses vary most; a stand of identical trees looks stamped.
      scale: kind === 'servi' ? rng.range(0.78, 1.3) : rng.range(0.85, 1.15),
    });
  }
  return props;
}

/**
 * Every prop within `radiusCells` of the cell containing the given position.
 *
 * Returned in a stable order so that two calls for the same cell produce the same
 * instance indices, which stops props swapping places as the window slides.
 */
export function propsAround(
  worldSeed: number,
  x: number,
  z: number,
  radiusCells: number,
): ScatteredProp[] {
  const centreX = cellIndex(x);
  const centreZ = cellIndex(z);
  const props: ScatteredProp[] = [];
  for (let cz = centreZ - radiusCells; cz <= centreZ + radiusCells; cz++) {
    for (let cx = centreX - radiusCells; cx <= centreX + radiusCells; cx++) {
      props.push(...propsInCell(worldSeed, cx, cz));
    }
  }
  return props;
}

/** Instance capacity a renderer must allocate to hold `propsAround` at this radius. */
export function propCapacity(radiusCells: number): number {
  const cells = (radiusCells * 2 + 1) ** 2;
  return cells * MAX_PROPS_PER_CELL;
}
