import * as THREE from 'three';
import type { Vec2 } from '../core/geom';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';
import { chainPath, roadChains } from './road-paths';
import { ribbonGeometry } from './terrain-view';

/** Width of a drawn road, in tiles. Narrower than a tile, as old streets were. */
const ROAD_WIDTH = 0.6;

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
      const smooth = chainPath(grid, chain);
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
