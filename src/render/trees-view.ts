import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { WALL_NONE, type CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

type Kind = 'kavak' | 'servi' | 'fruit';

interface Tree {
  kind: Kind;
  x: number;
  z: number;
  scale: number;
  /** Tile the tree stands on: a road or house built there clears it. */
  tile: number;
}

/**
 * Decorative trees: poplars along the stream, the Meram orchards on the western slopes,
 * fruit trees in courtyards, cypresses by the tombs. They are scenery, not simulation, so
 * they only need to get out of the way when something is built on their tile.
 */
export class TreesView {
  readonly group = new THREE.Group();
  private readonly trees: Tree[];
  private revision = '';
  private readonly crowns: Record<Kind, THREE.BufferGeometry>;
  private readonly trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.42, 5).translate(0, 0.21, 0);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.tree);
    const kavak = new THREE.IcosahedronGeometry(1, 1).scale(0.26, 0.95, 0.26).translate(0, 1.2, 0);
    const fruit = new THREE.IcosahedronGeometry(1, 1).scale(0.42, 0.34, 0.42).translate(0, 0.66, 0);
    const servi = new THREE.LatheGeometry(
      [
        [0.01, 0],
        [0.17, 0.2],
        [0.23, 0.55],
        [0.2, 0.95],
        [0.12, 1.3],
        [0.01, 1.62],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      9,
    ).translate(0, 0.22, 0);
    this.crowns = { kavak, fruit, servi };
    this.trees = placeTrees(city);
    this.sync();
  }

  sync(): boolean {
    const { revision } = this.city;
    const rev = `${revision.roads}:${revision.houses}:${revision.fields}:${revision.buildings}`;
    if (rev === this.revision) return false;
    this.revision = rev;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
    const { road, house, field, building } = this.city;
    // A tree gives way to anything built or ploughed on its tile.
    const standing = this.trees.filter(
      (t) => road[t.tile] === 0 && house[t.tile] === 0 && field[t.tile] < 0 && building[t.tile] < 0,
    );
    const tint = { kavak: PAL.kavak, servi: PAL.servi, fruit: PAL.fruit };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const trunks = new THREE.InstancedMesh(this.trunk, miniMaterial({ color: PAL.trunk }), standing.length);
    standing.forEach((t, k) => {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(t.x, sampleHeight(this.city.terrain, t.x, t.z) - 0.04, t.z),
        q.setFromAxisAngle(up, t.scale * 17),
        new THREE.Vector3(t.scale, t.scale, t.scale),
      );
      trunks.setMatrixAt(k, m);
    });
    trunks.castShadow = true;
    this.group.add(trunks);
    for (const kind of ['kavak', 'servi', 'fruit'] as const) {
      const list = standing.filter((t) => t.kind === kind);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(this.crowns[kind], miniMaterial(), list.length);
      list.forEach((t, k) => {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(t.x, sampleHeight(this.city.terrain, t.x, t.z) - 0.04, t.z),
          q.setFromAxisAngle(up, t.scale * 17),
          new THREE.Vector3(t.scale, t.scale, t.scale),
        );
        mesh.setMatrixAt(k, m);
        // Each tree a shade apart, as a painter would vary them.
        color.set(tint[kind]).offsetHSL((hash2(t.tile, 1) - 0.5) * 0.03, 0, (hash2(t.tile, 2) - 0.5) * 0.1);
        mesh.setColorAt(k, color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return true;
  }
}

function placeTrees(city: CityState): Tree[] {
  const { grid, terrain, def } = city;
  const out: Tree[] = [];
  const add = (kind: Kind, x: number, z: number, scale: number): void => {
    const tx = grid.tileOf(x);
    const tz = grid.tileOf(z);
    if (!grid.inBounds(tx, tz)) return;
    const tile = grid.index(tx, tz);
    if (terrain.water[tile] === 1 || city.wall[tile] !== WALL_NONE || city.structure[tile] >= 0) return;
    // Nothing grows on bare ore; the seam should be visible from afar.
    if (terrain.ore[tile] > 0) return;
    out.push({ kind, x, z, scale, tile });
  };

  // Poplars in lines along both banks.
  const path = terrain.streamPath;
  let travelled = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az);
    travelled += len;
    if (travelled < 1.5) continue;
    travelled = 0;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    for (const side of [-1, 1]) {
      const h = hash2(i, side + 5, 11);
      if (h > 0.7) continue;
      const off = def.stream.width / 2 + 1.25 + h * 0.5;
      add('kavak', bx + nx * side * off, bz + nz * side * off, 0.85 + h * 0.4);
    }
  }

  const R = def.walls.radius;
  for (let tz = 0; tz < grid.size; tz++) {
    for (let tx = 0; tx < grid.size; tx++) {
      const x = grid.centre(tx);
      const z = grid.centre(tz);
      const i = grid.index(tx, tz);
      const h = terrain.height[i];
      const r = Math.hypot(x - def.tepe.x, z - def.tepe.z);
      const jitterX = (hash2(tx, tz, 21) - 0.5) * 0.4;
      const jitterZ = (hash2(tx, tz, 22) - 0.5) * 0.4;
      // The Meram orchards: rows of fruit trees up the western slopes.
      if (x < -30 && h > 0.45 && h < 4.8 && terrain.slope[i] < 0.6 && tx % 2 === 0 && tz % 2 === 0) {
        if (hash2(tx, tz, 23) < 0.82) add('fruit', x + jitterX, z + jitterZ, 0.8 + hash2(tx, tz, 24) * 0.3);
        continue;
      }
      // Courtyard gardens inside the walls, wherever no house was built.
      if (r > def.housing.innerRadius && r < R - 1.3 && city.house[i] === 0 && city.road[i] === 0) {
        if (hash2(tx, tz, 25) < 0.45) add('fruit', x + jitterX, z + jitterZ, 0.75 + hash2(tx, tz, 26) * 0.25);
        continue;
      }
      // A few lone trees across the plain.
      if (r > R + 3 && terrain.fertility[i] > 0.35 && hash2(tx, tz, 27) < 0.012) {
        add(hash2(tx, tz, 28) < 0.5 ? 'fruit' : 'kavak', x + jitterX, z + jitterZ, 0.9);
      }
    }
  }

  // Cypresses around the tombs.
  for (const l of city.landmarks.filter((q) => q.kind === 'kumbet')) {
    for (let k = 0; k < 7; k++) {
      const a = Math.PI * 0.35 + k * 0.42;
      add('servi', l.x + Math.cos(a) * 1.7, l.z + Math.sin(a) * 1.7, 0.9 + hash2(k, 3, 29) * 0.25);
    }
  }
  return out;
}
