import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { Trade } from '../sim/balance';
import { FACING_DIRS, type Building } from '../sim/buildings';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, cone, cylinder, dome, PartBatch, type Frame } from './builder';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

/** Seconds per turn of a mill wheel. */
const WHEEL_PERIOD = 6;
/** Seconds for a smoke puff to rise and fade. */
const SMOKE_PERIOD = 4.5;
const PUFFS = 4;

interface Wheel {
  mesh: THREE.Mesh;
  /** Local axis the wheel turns about. */
  axis: THREE.Vector3;
  base: THREE.Quaternion;
}

interface Chimney {
  top: THREE.Vector3;
  puffs: THREE.Mesh[];
  seed: number;
}

/**
 * State workshops and bazaars, plus the ore seams they are dug into. Rebuilt when a
 * building is placed or a shop changes hands; mill wheels turn and foundry smoke rises
 * between rebuilds.
 */
export class WorksView {
  readonly group = new THREE.Group();
  private key = '';
  private wheels: Wheel[] = [];
  private chimneys: Chimney[] = [];
  private readonly wheelGeom = wheelGeometry();
  private readonly puffGeom = new THREE.IcosahedronGeometry(0.2, 1);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.building);
    this.sync();
  }

  sync(): boolean {
    const { revision } = this.city;
    const key = `${revision.buildings}:${revision.roads}`;
    if (key === this.key) return false;
    this.key = key;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (
        child instanceof THREE.Mesh &&
        child.geometry !== this.wheelGeom &&
        child.geometry !== this.puffGeom
      ) {
        (child.geometry as THREE.BufferGeometry).dispose();
      }
    }
    this.wheels = [];
    this.chimneys = [];
    const batch = new PartBatch();
    oreRocks(this.city, batch);
    for (const b of this.city.buildings.values()) this.buildOne(b, batch);
    batch.build(this.group, INK_CLASS.building);
    return true;
  }

  /** Turns the wheels and lifts the smoke. */
  update(seconds: number): void {
    const turn = new THREE.Quaternion();
    for (const w of this.wheels) {
      turn.setFromAxisAngle(w.axis, (seconds / WHEEL_PERIOD) * Math.PI * 2);
      w.mesh.quaternion.copy(w.base).multiply(turn);
    }
    for (const c of this.chimneys) {
      c.puffs.forEach((p, k) => {
        const t = (seconds / SMOKE_PERIOD + k / PUFFS + c.seed) % 1;
        p.position.set(c.top.x + t * 0.5, c.top.y + t * 1.6, c.top.z - t * 0.2);
        p.scale.setScalar(0.6 + t * 1.3);
        p.visible = t < 0.92;
      });
    }
  }

  private buildOne(b: Building, batch: PartBatch): void {
    const { terrain, grid } = this.city;
    const cx = grid.centre(b.x0) + (b.w - 1) / 2;
    const cz = grid.centre(b.z0) + (b.d - 1) / 2;
    let base = Infinity;
    for (const [dx, dz] of [
      [-b.w / 2, -b.d / 2],
      [b.w / 2, -b.d / 2],
      [-b.w / 2, b.d / 2],
      [b.w / 2, b.d / 2],
      [0, 0],
    ]) {
      base = Math.min(base, sampleHeight(terrain, cx + dx, cz + dz));
    }
    const [fx, fz] = FACING_DIRS[b.facing];
    const rot = Math.atan2(fx, fz);
    const f = batch.frame(cx, base, cz, rot);
    // In the local frame the front is +z; `front` runs along x, `depth` along z.
    const front = b.facing % 2 === 0 ? b.w : b.d;
    const depth = b.facing % 2 === 0 ? b.d : b.w;
    switch (b.kind) {
      case 'degirmen':
        this.mill(b, f, front, depth, base, rot);
        break;
      case 'boyahane':
        dyeworks(f, front, depth, b.id);
        break;
      case 'maden':
        mine(f, front, depth);
        break;
      case 'dokumhane':
        this.foundry(f, front, depth, base, cx, cz, rot, b.id);
        break;
      case 'arasta':
        bazaar(f, front, depth, b);
        break;
    }
  }

  private mill(b: Building, f: Frame, front: number, depth: number, base: number, rot: number): void {
    const w = front - 0.5;
    const d = depth - 0.55;
    f.part(box(w, 1.05 + 0.5, d), PAL.stone, 0, -0.5, -0.05);
    const roof = cone(Math.max(w, d) * 0.78, 0.55, 4);
    roof.rotateY(Math.PI / 4);
    roof.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
    f.part(roof, PAL.roofs[1], 0, 1.05, -0.05);
    f.part(arch(0.38, 0.62, 0.03), PAL.door, 0, 0, d / 2 - 0.04);
    f.part(box(0.2, 0.2, 0.03), PAL.door, w * 0.3, 0.55, d / 2 - 0.04);

    // The wheel hangs over the water on whichever side the stream runs.
    const side = this.waterSide(b);
    const rel = (side - b.facing + 4) % 4;
    const out: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    const [ox, oz] = out[rel];
    const reach = (rel % 2 === 0 ? d : w) / 2 + 0.22;
    const local = new THREE.Vector3(ox * reach, 0, oz * reach);
    const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const wheelY = Math.max(this.city.terrain.waterLevel + 0.52, base + 0.3);
    const mesh = new THREE.Mesh(this.wheelGeom, miniMaterial({ color: PAL.timber }));
    const cx = this.city.grid.centre(b.x0) + (b.w - 1) / 2;
    const cz = this.city.grid.centre(b.z0) + (b.d - 1) / 2;
    mesh.position.set(cx + world.x, wheelY, cz + world.z);
    // The wheel's axle is its local z; point it out of the wall.
    const axleWorld = new THREE.Vector3(ox, 0, oz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axleWorld);
    mesh.quaternion.copy(baseQ);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.wheels.push({ mesh, axis: new THREE.Vector3(0, 0, 1), base: baseQ });
  }

  /** The side (in `facing` numbering) with the most water next to it. */
  private waterSide(b: Building): number {
    const { grid, terrain } = this.city;
    const water = (x: number, z: number): number =>
      grid.inBounds(x, z) && terrain.water[grid.index(x, z)] === 1 ? 1 : 0;
    const count = [0, 0, 0, 0];
    for (let r = 1; r <= 2; r++) {
      for (let x = b.x0; x < b.x0 + b.w; x++) {
        count[0] += water(x, b.z0 + b.d - 1 + r);
        count[2] += water(x, b.z0 - r);
      }
      for (let z = b.z0; z < b.z0 + b.d; z++) {
        count[1] += water(b.x0 + b.w - 1 + r, z);
        count[3] += water(b.x0 - r, z);
      }
    }
    let best = 0;
    for (let k = 1; k < 4; k++) if (count[k] > count[best]) best = k;
    return best;
  }

  private foundry(
    f: Frame,
    front: number,
    depth: number,
    base: number,
    cx: number,
    cz: number,
    rot: number,
    id: number,
  ): void {
    const w = front - 0.6;
    const d = depth - 0.9;
    f.part(box(w, 1.15 + 0.5, d), PAL.brick, 0, -0.5, -0.35);
    f.part(box(w + 0.1, 0.1, d + 0.1), PAL.stoneDark, 0, 1.15, -0.35);
    f.part(arch(0.55, 0.8, 0.03), PAL.door, -w * 0.18, 0, d / 2 - 0.33);
    f.part(arch(0.36, 0.5, 0.04), PAL.ember, -w * 0.18, 0, d / 2 - 0.31);
    // The furnace, and its chimney.
    const chimX = w / 2 - 0.35;
    const chimZ = -d / 2 - 0.05;
    f.part(dome(0.5), PAL.stoneDark, chimX - 0.2, 1.15, chimZ + 0.5);
    f.part(cylinder(0.17, 0.22, 2.6), PAL.brick, chimX, 0, chimZ);
    f.part(cylinder(0.21, 0.21, 0.12), PAL.iron, chimX, 2.6, chimZ);
    // Bars of iron and a heap of ore in the yard.
    for (let k = 0; k < 4; k++)
      f.part(box(0.6, 0.07, 0.1), PAL.iron, w * 0.25, 0.02 + k * 0.07, depth / 2 - 0.55 + (k % 2) * 0.12);
    f.part(cone(0.32, 0.28, 7), PAL.ore, -w / 2 + 0.3, 0, depth / 2 - 0.45);

    const top = new THREE.Vector3(chimX, 2.85, chimZ)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      .add(new THREE.Vector3(cx, base, cz));
    const puffs: THREE.Mesh[] = [];
    for (let k = 0; k < PUFFS; k++) {
      const p = new THREE.Mesh(this.puffGeom, miniMaterial({ color: PAL.smoke }));
      p.position.copy(top);
      puffs.push(p);
      this.group.add(p);
    }
    this.chimneys.push({ top, puffs, seed: hash2(id, 3, 41) });
  }
}

function dyeworks(f: Frame, front: number, depth: number, id: number): void {
  const w = front - 0.4;
  const d = depth - 0.4;
  // The dye house at the back, vats and drying racks in the yard before it.
  f.part(box(w * 0.55, 0.85 + 0.5, d * 0.5), PAL.plaster, -w * 0.2, -0.5, -d * 0.25);
  f.part(box(w * 0.55 + 0.08, 0.06, d * 0.5 + 0.08), PAL.stoneDark, -w * 0.2, 0.85, -d * 0.25);
  f.part(arch(0.3, 0.5, 0.03), PAL.door, -w * 0.2, 0, 0.02);
  for (let k = 0; k < 3; k++) {
    const x = -w / 2 + 0.35 + k * 0.5;
    f.part(cylinder(0.2, 0.18, 0.28, 12), PAL.stoneDark, x, 0, d / 2 - 0.3);
    f.part(cylinder(0.16, 0.16, 0.02, 12), PAL.dyes[k], x, 0.28, d / 2 - 0.3);
  }
  // Two racks hung with freshly dyed skeins.
  for (const rz of [-0.25, 0.3]) {
    const x0 = w * 0.18;
    const len = w * 0.5;
    f.part(box(0.05, 0.75, 0.05), PAL.timber, x0 - len / 2, 0, rz);
    f.part(box(0.05, 0.75, 0.05), PAL.timber, x0 + len / 2, 0, rz);
    f.part(box(len + 0.1, 0.04, 0.04), PAL.timber, x0, 0.73, rz);
    const n = 4;
    for (let k = 0; k < n; k++) {
      const color = PAL.dyes[Math.floor(hash2(id, k + (rz > 0 ? 7 : 0), 43) * PAL.dyes.length)];
      f.part(box(len / n - 0.05, 0.4, 0.02), color, x0 - len / 2 + (k + 0.5) * (len / n), 0.33, rz);
    }
  }
}

function mine(f: Frame, front: number, depth: number): void {
  // A rocky knoll with the adit cut into its face, timbered, and the spoil tipped beside.
  const knoll = cone(Math.max(front, depth) * 0.62, 1.35, 7);
  f.part(knoll, PAL.rock, 0, -0.3, -0.35);
  const shoulder = cone(0.7, 0.8, 6);
  f.part(shoulder, PAL.rock, -0.55, -0.2, -0.1);
  f.part(box(0.8, 0.78, 0.4), PAL.rock, 0, 0, depth / 2 - 0.72);
  f.part(arch(0.5, 0.64, 0.04), PAL.door, 0, 0, depth / 2 - 0.5);
  f.part(box(0.09, 0.72, 0.09), PAL.timber, -0.3, 0, depth / 2 - 0.48);
  f.part(box(0.09, 0.72, 0.09), PAL.timber, 0.3, 0, depth / 2 - 0.48);
  f.part(box(0.78, 0.09, 0.12), PAL.timber, 0, 0.7, depth / 2 - 0.48);
  // Rails out of the adit to the spoil heap, and the heap of ore waiting to be carted.
  for (const x of [-0.12, 0.12]) f.part(box(0.035, 0.03, 0.62), PAL.timberDark, x, 0.02, depth / 2 - 0.1);
  f.part(cone(0.42, 0.36, 7), PAL.ore, front / 2 - 0.4, 0, depth / 2 - 0.35);
  f.part(cone(0.26, 0.24, 7), PAL.oreDark, front / 2 - 0.12, 0, depth / 2 - 0.7);
  f.part(box(0.26, 0.14, 0.18), PAL.timberDark, front / 2 - 0.62, 0.02, depth / 2 - 0.02);
  // A tool hut on the other side of the path.
  f.part(box(0.45, 0.42, 0.4), PAL.houses[3], -front / 2 + 0.35, 0, depth / 2 - 0.3);
  f.part(box(0.52, 0.05, 0.47), PAL.roofs[2], -front / 2 + 0.35, 0.42, depth / 2 - 0.3);
}

const SHOP_WARES: Record<Trade, (f: Frame, x: number, z: number) => void> = {
  firinci: (f, x, z) => {
    for (let k = 0; k < 3; k++) f.part(dome(0.07, 8), PAL.bread, x - 0.18 + k * 0.18, 0.3, z);
  },
  dokumaci: (f, x, z) => {
    for (let k = 0; k < 3; k++) {
      const bolt = cylinder(0.05, 0.05, 0.3, 8);
      bolt.rotateZ(Math.PI / 2);
      bolt.translate(0.15, 0, 0);
      f.part(bolt, PAL.dyes[k], x - 0.15, 0.33 + (k === 1 ? 0.07 : 0), z + (k - 1) * 0.06);
    }
  },
  demirci: (f, x, z) => {
    f.part(box(0.16, 0.12, 0.09), PAL.iron, x - 0.1, 0.3, z);
    f.part(box(0.05, 0.04, 0.28), PAL.iron, x + 0.14, 0.3, z);
    f.part(box(0.22, 0.03, 0.05), PAL.ember, x + 0.12, 0.34, z - 0.05);
  },
};

function bazaar(f: Frame, front: number, depth: number, b: Building): void {
  const w = front - 0.2;
  const d = depth - 0.6;
  const n = b.shops.length;
  const bay = w / n;
  f.part(box(w, 0.95 + 0.5, d), PAL.stone, 0, -0.5, -0.25);
  f.part(box(w + 0.1, 0.08, d + 0.1), PAL.stoneDark, 0, 0.95, -0.25);
  // A plinth course along the back and ends, so the blind side still reads as masonry.
  f.part(box(w + 0.06, 0.16, d + 0.06), PAL.stoneDark, 0, 0, -0.25);
  b.shops.forEach((shop, k) => {
    const x = -w / 2 + (k + 0.5) * bay;
    // Each bay under its own small dome, the way an arasta's shops are vaulted.
    f.part(cylinder(bay * 0.4, bay * 0.4, 0.1, 8), PAL.stoneDark, x, 1.03, -0.25);
    f.part(dome(bay * 0.36, 12), PAL.lead, x, 1.13, -0.25);
    // A small high window at the back of every shop.
    f.part(arch(0.16, 0.3, 0.02), PAL.door, x, 0.5, -0.25 - d / 2, Math.PI);
    const face = d / 2 - 0.25;
    if (shop.trade === null) {
      f.part(box(bay * 0.7, 0.6, 0.03), PAL.timberDark, x, 0, face + 0.02);
      return;
    }
    f.part(arch(bay * 0.72, 0.72, 0.03), PAL.door, x, 0, face + 0.01);
    const awning = box(bay * 0.86, 0.035, 0.42);
    awning.translate(0, 0, 0.21);
    awning.rotateX(0.4);
    f.part(awning, PAL.awning[shop.trade], x, 0.8, face);
    f.part(box(bay * 0.66, 0.26, 0.24), PAL.timber, x, 0, face + 0.2);
    SHOP_WARES[shop.trade](f, x, face + 0.2);
  });
}

/** Loose rocks on every open ore tile, so the seam shows before anyone digs. */
function oreRocks(city: CityState, batch: PartBatch): void {
  const { grid, terrain } = city;
  for (let i = 0; i < grid.count; i++) {
    if (terrain.ore[i] === 0 || city.building[i] >= 0 || city.road[i] === 1) continue;
    const tx = i % grid.size;
    const tz = Math.floor(i / grid.size);
    for (let k = 0; k < 2; k++) {
      if (hash2(tx, tz, 50 + k) < 0.35) continue;
      const x = grid.centre(tx) + (hash2(tx, tz, 52 + k) - 0.5) * 0.7;
      const z = grid.centre(tz) + (hash2(tx, tz, 54 + k) - 0.5) * 0.7;
      const s = 0.12 + hash2(tx, tz, 56 + k) * 0.12;
      const rock = box(s * 1.4, s, s);
      batch
        .frame(x, sampleHeight(terrain, x, z) - 0.03, z, hash2(tx, tz, 58 + k) * Math.PI)
        .part(rock, k === 0 ? PAL.oreDark : PAL.ore);
    }
  }
}

/** A paddle wheel in the xy plane, turning about z. */
function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(0.5, 0.045, 6, 20);
  parts.push(rim);
  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const spokes = 6;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI;
    const spoke = new THREE.BoxGeometry(1.0, 0.05, 0.05);
    spoke.rotateZ(a);
    parts.push(spoke);
  }
  const paddles = 12;
  for (let k = 0; k < paddles; k++) {
    const a = (k / paddles) * Math.PI * 2;
    const paddle = new THREE.BoxGeometry(0.2, 0.04, 0.22);
    paddle.rotateZ(a + Math.PI / 2);
    paddle.translate(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0);
    parts.push(paddle);
  }
  const clean = parts.map((g) => {
    const n = g.index !== null ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes))
      if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(clean, false);
  for (const g of parts) g.dispose();
  if (merged === null) throw new Error('wheel geometry did not merge');
  return merged;
}
