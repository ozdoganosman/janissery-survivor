/**
 * Uniform spatial hash for broad-phase proximity queries.
 *
 * With eight hundred enemies, asking "who is near me" by testing every pair is
 * 320 000 comparisons per step and the whole design collapses. The world is instead
 * cut into fixed-size cells and each query touches only the handful of cells its
 * radius overlaps.
 *
 * ## Why hashing rather than an array of cells
 *
 * The world is unbounded — the player walks thousands of units from the origin — so
 * there is no rectangle to allocate cells for. Cell coordinates are hashed into a
 * fixed table instead. Two distant cells can land in the same bucket; that costs a
 * few extra candidates, never a wrong answer, because every candidate carries its
 * real cell coordinates and is rejected if they do not match the cell being scanned.
 * That check also stops the same entity being visited twice when two cells in one
 * query collide, which would otherwise let a single neighbour push twice as hard.
 *
 * ## Why the query API is a cursor rather than a callback
 *
 * `forEachNear(x, z, r, callback)` reads better, but a callback that captures loop
 * variables allocates a closure on every call, and this is called once per enemy per
 * step. Allocating 800 closures 60 times a second is exactly the sawtooth the
 * project's performance budget forbids. The cursor form allocates nothing.
 *
 * Only one query can be in flight at a time: the cursor is state on the grid. Nested
 * queries would silently corrupt each other, so `beginQuery` asserts against it.
 */

/** Entity index returned when a query is exhausted. */
export const QUERY_DONE = -1;

export class SpatialGrid {
  readonly cellSize: number;
  readonly capacity: number;

  /** Power of two, so the hash reduces with a mask rather than a modulo. */
  private readonly tableSize: number;
  private readonly mask: number;

  /** Start offset of each bucket within `items`; one extra entry holds the total. */
  private readonly bucketStart: Int32Array;
  private readonly bucketCursor: Int32Array;
  /** Entity indices grouped by bucket. */
  private readonly items: Int32Array;
  /** Real cell of each entry in `items`, used to reject hash collisions. */
  private readonly itemCellX: Int32Array;
  private readonly itemCellZ: Int32Array;
  /** Bucket of each entity, cached so `rebuild` hashes once instead of twice. */
  private readonly entityBucket: Int32Array;
  private readonly entityCellX: Int32Array;
  private readonly entityCellZ: Int32Array;

  private activeCount = 0;

  // Cursor state for the in-flight query.
  private querying = false;
  private queryX = 0;
  private queryZ = 0;
  private queryRadiusSq = 0;
  private queryMinCellX = 0;
  private queryMaxCellX = 0;
  private queryMaxCellZ = 0;
  private cursorCellX = 0;
  private cursorCellZ = 0;
  private cursorItem = 0;
  private cursorItemEnd = 0;
  private cursorXs: Float32Array | null = null;
  private cursorZs: Float32Array | null = null;

  constructor(cellSize: number, capacity: number) {
    if (!(cellSize > 0)) throw new RangeError(`cellSize must be positive, got ${cellSize}`);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }

    this.cellSize = cellSize;
    this.capacity = capacity;

    // Roughly two buckets per entity keeps collisions rare without wasting memory.
    let size = 1;
    while (size < capacity * 2) size *= 2;
    this.tableSize = size;
    this.mask = size - 1;

    this.bucketStart = new Int32Array(size + 1);
    this.bucketCursor = new Int32Array(size);
    this.items = new Int32Array(capacity);
    this.itemCellX = new Int32Array(capacity);
    this.itemCellZ = new Int32Array(capacity);
    this.entityBucket = new Int32Array(capacity);
    this.entityCellX = new Int32Array(capacity);
    this.entityCellZ = new Int32Array(capacity);
  }

  /** World coordinate to cell index. Floor, so it stays correct either side of zero. */
  cellOf(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }

  /**
   * Hashes a cell to a bucket.
   *
   * Each coordinate is multiplied by a large odd constant before being combined, so
   * that neighbouring cells — which differ in a single low bit — land far apart.
   */
  private bucketOf(cellX: number, cellZ: number): number {
    return (Math.imul(cellX, 0x9e3779b1) ^ Math.imul(cellZ, 0x85ebca77)) & this.mask;
  }

  /**
   * Indexes the first `count` entries of the given position arrays.
   *
   * Called once per simulation step. Rebuilding wholesale is cheaper and far simpler
   * than incrementally maintaining the structure while everything moves every step.
   */
  rebuild(count: number, xs: Float32Array, zs: Float32Array): void {
    if (count > this.capacity) {
      throw new RangeError(`count ${count} exceeds grid capacity ${this.capacity}`);
    }
    this.activeCount = count;
    this.cursorXs = xs;
    this.cursorZs = zs;

    const { bucketStart, bucketCursor, items, itemCellX, itemCellZ } = this;
    const { entityBucket, entityCellX, entityCellZ, tableSize } = this;

    bucketStart.fill(0);

    for (let i = 0; i < count; i++) {
      const cx = this.cellOf(xs[i]);
      const cz = this.cellOf(zs[i]);
      const bucket = this.bucketOf(cx, cz);
      entityCellX[i] = cx;
      entityCellZ[i] = cz;
      entityBucket[i] = bucket;
      // Offset by one so the prefix sum below turns counts directly into starts.
      bucketStart[bucket + 1]++;
    }

    for (let b = 0; b < tableSize; b++) {
      bucketStart[b + 1] += bucketStart[b];
      bucketCursor[b] = bucketStart[b];
    }

    for (let i = 0; i < count; i++) {
      const slot = bucketCursor[entityBucket[i]]++;
      items[slot] = i;
      itemCellX[slot] = entityCellX[i];
      itemCellZ[slot] = entityCellZ[i];
    }
  }

  /**
   * Starts a query for entities within `radius` of a point.
   *
   * Follow with repeated `next()` calls until it returns `QUERY_DONE`. Results are
   * already distance-filtered, so the caller does not repeat the test.
   */
  beginQuery(x: number, z: number, radius: number): void {
    if (this.querying) {
      throw new Error('a spatial query is already in progress; queries cannot nest');
    }
    this.querying = true;
    this.queryX = x;
    this.queryZ = z;
    this.queryRadiusSq = radius * radius;

    this.queryMinCellX = this.cellOf(x - radius);
    this.queryMaxCellX = this.cellOf(x + radius);
    this.queryMaxCellZ = this.cellOf(z + radius);

    this.cursorCellX = this.queryMinCellX;
    this.cursorCellZ = this.cellOf(z - radius);
    this.openCell();
  }

  private openCell(): void {
    const bucket = this.bucketOf(this.cursorCellX, this.cursorCellZ);
    this.cursorItem = this.bucketStart[bucket];
    this.cursorItemEnd = this.bucketStart[bucket + 1];
  }

  /** Next entity index within the query radius, or `QUERY_DONE`. */
  next(): number {
    const xs = this.cursorXs;
    const zs = this.cursorZs;
    if (xs === null || zs === null) return QUERY_DONE;

    for (;;) {
      while (this.cursorItem < this.cursorItemEnd) {
        const slot = this.cursorItem++;
        // Reject entries that only share a bucket by hash collision, and entries
        // from a cell this query will scan separately — visiting one twice would
        // let a single neighbour count double.
        if (this.itemCellX[slot] !== this.cursorCellX) continue;
        if (this.itemCellZ[slot] !== this.cursorCellZ) continue;

        const index = this.items[slot];
        const dx = xs[index] - this.queryX;
        const dz = zs[index] - this.queryZ;
        if (dx * dx + dz * dz > this.queryRadiusSq) continue;
        return index;
      }

      this.cursorCellX++;
      if (this.cursorCellX > this.queryMaxCellX) {
        this.cursorCellX = this.queryMinCellX;
        this.cursorCellZ++;
        if (this.cursorCellZ > this.queryMaxCellZ) {
          this.querying = false;
          return QUERY_DONE;
        }
      }
      this.openCell();
    }
  }

  /** Abandons an unfinished query. Safe to call when none is running. */
  endQuery(): void {
    this.querying = false;
    this.cursorItem = 0;
    this.cursorItemEnd = 0;
  }

  /** Entities currently indexed. */
  get indexedCount(): number {
    return this.activeCount;
  }
}
