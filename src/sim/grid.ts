/**
 * Square tile grid. Tile (0, 0) is the north-west corner; world coordinates put the map
 * centre at the origin, x growing east and z growing south, one unit per tile.
 */
export class Grid {
  readonly half: number;

  constructor(readonly size: number) {
    this.half = size / 2;
  }

  get count(): number {
    return this.size * this.size;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.size && z < this.size;
  }

  index(x: number, z: number): number {
    return z * this.size + x;
  }

  /** World coordinate of a tile's centre along one axis. */
  centre(t: number): number {
    return t - this.half + 0.5;
  }

  /** Tile containing a world coordinate along one axis (may be out of bounds). */
  tileOf(w: number): number {
    return Math.floor(w + this.half);
  }

  /** Index of the grid corner (vertex) at the given corner coordinates, 0..size inclusive. */
  cornerIndex(cx: number, cz: number): number {
    return cz * (this.size + 1) + cx;
  }
}

/** The four edge-sharing neighbours, in a fixed order: east, south, west, north. */
export const DIRS4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
