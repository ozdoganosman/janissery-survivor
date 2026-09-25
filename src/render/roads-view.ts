import * as THREE from 'three';
import { chaikin, type Vec2 } from '../core/geom';
import type { CityState } from '../sim/city';
import { DIRS4 } from '../sim/grid';
import { sampleHeight } from '../sim/terrain';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';
import { ribbonGeometry } from './terrain-view';

/** Width of a drawn road, in tiles. Narrower than a tile, as old streets were. */
const ROAD_WIDTH = 0.6;

/**
 * Splits the road tiles into chains between junctions, as tile indices. A chain runs from
 * a junction or dead end to the next one; loops with no junction come out as closed chains.
 */
export function roadChains(road: Uint8Array, size: number): Array<{ tiles: number[]; closed: boolean }> {
  const neighbours = (i: number): number[] => {
    const x = i % size;
    const z = Math.floor(i / size);
    const out: number[] = [];
    for (const [dx, dz] of DIRS4) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (road[j] === 1) out.push(j);
    }
    return out;
  };
  const edgeKey = (a: number, b: number): number => (a < b ? a * size * size + b : b * size * size + a);
  const used = new Set<number>();
  const chains: Array<{ tiles: number[]; closed: boolean }> = [];

  const walk = (start: number, first: number): number[] => {
    const tiles = [start, first];
    used.add(edgeKey(start, first));
    let prev = start;
    let cur = first;
    for (;;) {
      const next = neighbours(cur);
      if (next.length !== 2) break;
      const step = next[0] === prev ? next[1] : next[0];
      if (used.has(edgeKey(cur, step))) break;
      used.add(edgeKey(cur, step));
      tiles.push(step);
      prev = cur;
      cur = step;
    }
    return tiles;
  };

  for (let i = 0; i < road.length; i++) {
    if (road[i] !== 1) continue;
    const nb = neighbours(i);
    if (nb.length === 0) chains.push({ tiles: [i], closed: false });
    if (nb.length === 2) continue;
    for (const j of nb) if (!used.has(edgeKey(i, j))) chains.push({ tiles: walk(i, j), closed: false });
  }
  // Whatever is left is made only of two-neighbour tiles: pure loops.
  for (let i = 0; i < road.length; i++) {
    if (road[i] !== 1) continue;
    for (const j of neighbours(i)) {
      if (used.has(edgeKey(i, j))) continue;
      const tiles = walk(i, j);
      const closed = tiles[tiles.length - 1] === i;
      if (closed) tiles.pop();
      chains.push({ tiles, closed });
    }
  }
  return chains;
}

/** Streets and roads, drawn as smooth ribbons, with a stone bridge wherever a road crosses water. */
export class RoadsView {
  readonly group = new THREE.Group();
  private revision = -1;

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.road);
    this.sync();
  }

  /** Rebuilds if the road layer changed since the last call. */
  sync(): boolean {
    if (this.revision === this.city.revision.roads) return false;
    this.revision = this.city.revision.roads;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
    }
    this.build();
    return true;
  }

  private build(): void {
    const { city } = this;
    const { grid, terrain } = city;
    const lift = (x: number, z: number): number =>
      Math.max(sampleHeight(terrain, x, z), terrain.waterLevel + 0.14) + 0.03;
    const isWater = (x: number, z: number): boolean => {
      const tx = grid.tileOf(x);
      const tz = grid.tileOf(z);
      return grid.inBounds(tx, tz) && terrain.water[grid.index(tx, tz)] === 1;
    };
    const roads: THREE.BufferGeometry[] = [];
    const bridges: THREE.BufferGeometry[] = [];
    for (const chain of roadChains(city.road, grid.size)) {
      let pts: Vec2[] = chain.tiles.map((i) => [
        grid.centre(i % grid.size),
        grid.centre(Math.floor(i / grid.size)),
      ]);
      if (pts.length === 1) {
        const [x, z] = pts[0];
        pts = [
          [x - 0.3, z],
          [x + 0.3, z],
        ];
      }
      const smooth = chaikin(straighten(pts, chain.closed), 2, chain.closed);
      if (chain.closed) smooth.push(smooth[0]);
      roads.push(ribbonGeometry(smooth, ROAD_WIDTH, lift));
      for (const run of waterRuns(smooth, isWater)) bridges.push(...bridgeGeometry(run, terrain.waterLevel));
    }
    roads.push(...thickSpotPatches(city.road, grid.size, (i) => grid.centre(i), lift));
    if (roads.length > 0) {
      const mesh = new THREE.Mesh(mergeGeometries(roads), miniMaterial({ color: PAL.road }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (bridges.length > 0) {
      const mesh = new THREE.Mesh(
        mergeGeometries(bridges),
        miniMaterial({ color: PAL.stone, side: THREE.DoubleSide }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      setInkClass(mesh, INK_CLASS.building);
      this.group.add(mesh);
    }
  }
}

/**
 * A player can lay roads side by side. The chains through such a block ring a hole in the
 * middle, so each fully paved 2x2 block gets a patch over its shared corner.
 */
function thickSpotPatches(
  road: Uint8Array,
  size: number,
  centre: (t: number) => number,
  lift: (x: number, z: number) => number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let z = 0; z < size - 1; z++) {
    for (let x = 0; x < size - 1; x++) {
      const i = z * size + x;
      if (road[i] !== 1 || road[i + 1] !== 1 || road[i + size] !== 1 || road[i + size + 1] !== 1) continue;
      const cx = centre(x) + 0.5;
      const cz = centre(z) + 0.5;
      out.push(
        ribbonGeometry(
          [
            [cx - 0.8, cz],
            [cx + 0.8, cz],
          ],
          1.6,
          lift,
        ),
      );
    }
  }
  return out;
}

/**
 * Stretches of a smoothed road that run over water, each grown by a couple of points so
 * the bridge lands on both banks.
 */
function waterRuns(path: readonly Vec2[], isWater: (x: number, z: number) => boolean): Vec2[][] {
  const runs: Vec2[][] = [];
  let start = -1;
  for (let i = 0; i <= path.length; i++) {
    const wet = i < path.length && isWater(path[i][0], path[i][1]);
    if (wet && start < 0) start = i;
    if (!wet && start >= 0) {
      const a = Math.max(0, start - 2);
      const b = Math.min(path.length - 1, i + 1);
      if (b > a) runs.push(path.slice(a, b + 1));
      start = -1;
    }
  }
  return runs;
}

/**
 * A stone bridge following the road's own curve: a flat deck and a wall down each side
 * that rises a little above the deck as a parapet.
 */
function bridgeGeometry(path: readonly Vec2[], waterLevel: number): THREE.BufferGeometry[] {
  const deckY = waterLevel + 0.26;
  const deck = ribbonGeometry(path, 0.86, () => deckY);
  const sides = [-0.43, 0.43].map((offset) => wallStrip(path, offset, waterLevel - 0.05, deckY + 0.1));
  return [deck, ...sides];
}

/** A vertical strip standing on a path, `offset` to one side of it. */
function wallStrip(path: readonly Vec2[], offset: number, y0: number, y1: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    const [ax, az] = path[Math.max(0, i - 1)];
    const [bx, bz] = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const px = x + (-(bz - az) / len) * offset;
    const pz = z + ((bx - ax) / len) * offset;
    positions.push(px, y0, pz, px, y1, pz);
    uvs.push(i, 0, i, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Moving average over a tile chain. A 4-connected staircase averages out to the straight
 * or gently curving line the player meant; end points stay put so chains still meet.
 */
export function straighten(pts: readonly Vec2[], closed: boolean, reach = 3): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const k = closed ? reach : Math.min(reach, i, n - 1 - i);
    let sx = 0;
    let sz = 0;
    for (let j = -k; j <= k; j++) {
      const p = pts[(((i + j) % n) + n) % n];
      sx += p[0];
      sz += p[1];
    }
    out.push([sx / (2 * k + 1), sz / (2 * k + 1)]);
  }
  return out;
}

/** Concatenates indexed geometries with the same attributes (position, uv, normal). */
function mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of geoms) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.getIndex()?.count ?? 0;
  }
  const pos = new Float32Array(vertexCount * 3);
  const nor = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const idx = new Uint32Array(indexCount);
  let v = 0;
  let k = 0;
  for (const g of geoms) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const t = g.getAttribute('uv') as THREE.BufferAttribute;
    pos.set(p.array, v * 3);
    nor.set(n.array, v * 3);
    uv.set(t.array, v * 2);
    const index = g.getIndex();
    if (index !== null) {
      for (let i = 0; i < index.count; i++) idx[k++] = index.getX(i) + v;
    }
    v += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
