import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2 } from '../core/rng';
import type { Trade } from '../sim/balance';
import { FACING_DIRS, type Building } from '../sim/buildings';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, cone, cylinder, dome, PartBatch, type Frame } from './builder';
import { drawHamam, drawMescit, minaret, tackapi } from './buildings-view';
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
      case 'cesme':
        fountain(f);
        break;
      case 'mescit':
        drawMescit(f, front, depth);
        break;
      case 'hamam':
        drawHamam(f, front, depth);
        break;
      case 'medrese':
        medrese(f, front, depth);
        break;
      case 'darussifa':
        hospital(f, front, depth, b.id);
        break;
      case 'zaviye':
        lodge(f, front, depth);
        break;
      case 'dolap':
        this.noria(b, f, front, depth, base, rot);
        break;
      case 'subasi':
        guardPost(f, front, depth);
        break;
      case 'imaret':
        this.soupKitchen(f, front, depth, base, cx, cz, rot, b.id);
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

    this.wheel(b, w, d, base, rot, 1, 0.22);
  }

  /**
   * A paddle wheel over the water on whichever side the stream runs, turning with the
   * current. Returns the wheel's side in the building's local frame.
   */
  private wheel(
    b: Building,
    w: number,
    d: number,
    base: number,
    rot: number,
    scale: number,
    gap: number,
  ): [number, number] {
    const side = this.waterSide(b);
    const rel = (side - b.facing + 4) % 4;
    const out: Array<[number, number]> = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    const [ox, oz] = out[rel];
    const reach = (rel % 2 === 0 ? d : w) / 2 + gap;
    const local = new THREE.Vector3(ox * reach, 0, oz * reach);
    const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const wheelY = Math.max(this.city.terrain.waterLevel + 0.52 * scale, base + 0.3 * scale);
    const mesh = new THREE.Mesh(this.wheelGeom, miniMaterial({ color: PAL.timber }));
    const cx = this.city.grid.centre(b.x0) + (b.w - 1) / 2;
    const cz = this.city.grid.centre(b.z0) + (b.d - 1) / 2;
    mesh.position.set(cx + world.x, wheelY, cz + world.z);
    mesh.scale.setScalar(scale);
    // The wheel's axle is its local z; point it out of the wall.
    const axleWorld = new THREE.Vector3(ox, 0, oz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const baseQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axleWorld);
    mesh.quaternion.copy(baseQ);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.wheels.push({ mesh, axis: new THREE.Vector3(0, 0, 1), base: baseQ });
    return [ox, oz];
  }

  /**
   * A noria: a tall wheel lifting water from the stream into a raised trough that runs
   * inland to a stone basin, where the field channels begin.
   */
  private noria(b: Building, f: Frame, front: number, depth: number, base: number, rot: number): void {
    const w = front - 0.6;
    const d = depth - 0.6;
    const [ox, oz] = this.wheel(b, w, d, base, rot, 1.55, 0.05);
    // The trough runs from the wheel's top towards the far side of the plot.
    const len = (ox !== 0 ? w : d) + 0.4;
    const trough = ox !== 0 ? box(len, 0.1, 0.16) : box(0.16, 0.1, len);
    f.part(trough, PAL.timber, -ox * 0.1, 1.45, -oz * 0.1);
    for (const t of [-0.35, 0.35]) {
      f.part(box(0.08, 1.45, 0.08), PAL.timberDark, ox !== 0 ? t * len : 0, 0, oz !== 0 ? t * len : 0);
    }
    const bx = -ox * (len / 2 - 0.05);
    const bz = -oz * (len / 2 - 0.05);
    f.part(box(0.55, 0.3, 0.55), PAL.stone, bx, 0, bz);
    f.part(box(0.44, 0.02, 0.44), PAL.water, bx, 0.3, bz);
    // The first yards of the channel that carries the water off to the fields.
    const run = 0.9;
    f.part(
      ox !== 0 ? box(run, 0.02, 0.12) : box(0.12, 0.02, run),
      PAL.water,
      bx - ox * run * 0.6,
      0.02,
      bz - oz * run * 0.6,
    );
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

    this.smoke(new THREE.Vector3(chimX, 2.85, chimZ), base, cx, cz, rot, hash2(id, 3, 41));
  }

  /**
   * An imaret: a long vaulted kitchen with its chimneys smoking, a domed refectory at one
   * end, and the great cauldron in the yard before it where the soup is ladled out.
   */
  private soupKitchen(
    f: Frame,
    front: number,
    depth: number,
    base: number,
    cx: number,
    cz: number,
    rot: number,
    id: number,
  ): void {
    const w = front - 0.3;
    const d = depth - 0.3;
    const kd = d * 0.55;
    const kz = -d / 2 + kd / 2;
    const kw = w * 0.62;
    const kx = -w / 2 + kw / 2;
    f.part(box(kw, 1.0 + 0.5, kd), PAL.stone, kx, -0.5, kz);
    // A barrel vault along the kitchen, drawn as a half cylinder lying on its side.
    const vault = new THREE.CylinderGeometry(kd / 2, kd / 2, kw, 12);
    vault.rotateZ(Math.PI / 2);
    vault.scale(1, 0.55, 1);
    f.part(vault, PAL.lead, kx, 1.0, kz);
    for (let k = 0; k < 3; k++)
      f.part(arch(0.26, 0.42, 0.03), PAL.door, kx - kw / 3 + (k * kw) / 3, 0, kz + kd / 2);
    // The refectory: a square domed hall at the far end.
    const rw = w - kw - 0.1;
    const rx = w / 2 - rw / 2;
    f.part(box(rw, 1.2 + 0.5, kd), PAL.plaster, rx, -0.5, kz);
    f.part(cylinder(rw * 0.45, rw * 0.45, 0.15, 8), PAL.stoneDark, rx, 1.2, kz);
    f.part(dome(rw * 0.42), PAL.lead, rx, 1.35, kz);
    f.part(arch(0.34, 0.55, 0.03), PAL.door, rx, 0, kz + kd / 2);
    // Chimneys on the kitchen.
    const chims = [kx - kw * 0.25, kx + kw * 0.25];
    chims.forEach((x, k) => {
      f.part(box(0.2, 0.75, 0.2), PAL.brick, x, 1.0 + kd * 0.15, kz - kd * 0.15);
      f.part(cone(0.16, 0.14, 4), PAL.stoneDark, x, 1.75 + kd * 0.15, kz - kd * 0.15);
      this.smoke(new THREE.Vector3(x, 1.95 + kd * 0.15, kz - kd * 0.15), base, cx, cz, rot, hash2(id, k, 43));
    });
    // The yard: the great copper cauldron on its hearth, a woodpile, a low wall with a gate.
    const yz = kz + kd / 2 + (d - kd) / 2;
    f.part(cylinder(0.34, 0.38, 0.16, 10), PAL.stoneDark, -w * 0.12, 0, yz);
    const bowl = dome(0.3, 12);
    bowl.rotateX(Math.PI);
    f.part(bowl, PAL.copper, -w * 0.12, 0.46, yz);
    f.part(cylinder(0.27, 0.27, 0.02, 10), PAL.bread, -w * 0.12, 0.42, yz);
    for (let k = 0; k < 3; k++)
      f.part(box(0.5, 0.08, 0.08), PAL.timber, w * 0.28, 0.04 + k * 0.08, yz - 0.1 + (k % 2) * 0.1);
    const gz = d / 2 - 0.04;
    f.part(box(w / 2 - 0.3, 0.3, 0.07), PAL.stone, -w / 4 - 0.15, 0, gz);
    f.part(box(w / 2 - 0.3, 0.3, 0.07), PAL.stone, w / 4 + 0.15, 0, gz);
  }

  /** A chimney top in the building's frame that puffs smoke. */
  private smoke(local: THREE.Vector3, base: number, cx: number, cz: number, rot: number, seed: number): void {
    const top = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(cx, base, cz));
    const puffs: THREE.Mesh[] = [];
    for (let k = 0; k < PUFFS; k++) {
      const p = new THREE.Mesh(this.puffGeom, miniMaterial({ color: PAL.smoke }));
      p.position.copy(top);
      puffs.push(p);
      this.group.add(p);
    }
    this.chimneys.push({ top, puffs, seed });
  }
}

/**
 * The subaşı's post: a walled block with a crenellated parapet, a gate on the street, a
 * square watchtower at the back corner flying the red banner, and a tethered horse.
 */
function guardPost(f: Frame, front: number, depth: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  const h = 0.95;
  f.part(box(w, h + 0.5, d), PAL.stone, 0, -0.5, 0);
  f.part(box(w + 0.06, 0.07, d + 0.06), PAL.stoneDark, 0, h, 0);
  // Merlons round the parapet.
  const n = 5;
  for (let k = 0; k < n; k++) {
    const t = -w / 2 + 0.08 + (k * (w - 0.16)) / (n - 1);
    f.part(box(0.12, 0.14, 0.08), PAL.stone, t, h + 0.07, d / 2 - 0.02);
    f.part(box(0.12, 0.14, 0.08), PAL.stone, t, h + 0.07, -d / 2 + 0.02);
    f.part(box(0.08, 0.14, 0.12), PAL.stone, w / 2 - 0.02, h + 0.07, t * (d / w));
    f.part(box(0.08, 0.14, 0.12), PAL.stone, -w / 2 + 0.02, h + 0.07, t * (d / w));
  }
  f.part(arch(0.42, 0.66, 0.04), PAL.door, 0, 0, d / 2);
  f.part(box(0.5, 0.06, 0.05), PAL.stoneDark, 0, 0.72, d / 2 + 0.01);
  // The watchtower and its banner.
  const tx = w / 2 - 0.3;
  const tz = -d / 2 + 0.3;
  f.part(box(0.55, 1.9, 0.55), PAL.stone, tx, h, tz);
  f.part(box(0.63, 0.07, 0.63), PAL.stoneDark, tx, h + 1.9, tz);
  f.part(cone(0.42, 0.4, 4).rotateY(Math.PI / 4), PAL.roofs[3], tx, h + 1.97, tz);
  f.part(box(0.12, 0.2, 0.02), PAL.ink, tx, h + 1.2, tz + 0.28);
  f.part(cylinder(0.02, 0.02, 0.8, 5), PAL.timberDark, tx, h + 2.3, tz);
  f.part(box(0.4, 0.24, 0.015), PAL.banner, tx + 0.21, h + 2.82, tz);
  // A horse tied at the gate.
  const hx = -w * 0.3;
  const hz = d / 2 + 0.22;
  f.part(box(0.36, 0.16, 0.12), PAL.horse, hx, 0.2, hz);
  for (const lx of [-0.13, 0.13]) f.part(box(0.04, 0.2, 0.1), PAL.horse, hx + lx, 0, hz);
  f.part(box(0.1, 0.18, 0.08), PAL.horse, hx + 0.2, 0.3, hz);
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

/** A street fountain: a marble block with a niche over a trough, facing the road. */
function fountain(f: Frame): void {
  f.part(box(0.58, 0.74 + 0.3, 0.3), PAL.stoneLight, 0, -0.3, -0.12);
  f.part(box(0.66, 0.08, 0.38), PAL.stoneDark, 0, 0.74, -0.12);
  f.part(arch(0.3, 0.5, 0.02), PAL.lead, 0, 0.1, 0.03);
  f.part(box(0.44, 0.05, 0.02), PAL.turquoise, 0, 0.64, 0.035);
  f.part(box(0.54, 0.14, 0.22), PAL.stone, 0, 0, 0.16);
  f.part(box(0.44, 0.02, 0.14), PAL.water, 0, 0.13, 0.16);
}

/**
 * A Seljuk medrese: four ranges of cells round an open court with a pool, a domed hall at
 * the back, a tall portal on the front and a minaret at one corner.
 */
function medrese(f: Frame, front: number, depth: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  const t = 0.5;
  const h = 1.15;
  f.part(box(w, h + 0.5, t), PAL.stone, 0, -0.5, -d / 2 + t / 2);
  f.part(box(w, h + 0.5, t), PAL.stone, 0, -0.5, d / 2 - t / 2);
  f.part(box(t, h + 0.5, d - 2 * t), PAL.stone, -w / 2 + t / 2, -0.5, 0);
  f.part(box(t, h + 0.5, d - 2 * t), PAL.stone, w / 2 - t / 2, -0.5, 0);
  for (const z of [-d / 2 + t / 2, d / 2 - t / 2])
    f.part(box(w + 0.08, 0.08, t + 0.08), PAL.stoneDark, 0, h, z);
  for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
    f.part(box(t + 0.08, 0.08, d - 2 * t), PAL.stoneDark, x, h, 0);
  f.part(box(w - 2 * t, 0.03, d - 2 * t), PAL.stoneLight, 0, 0, 0);
  f.part(box(0.42, 0.05, 0.42), PAL.water, 0, 0.02, 0);
  // The domed lecture hall behind the court, and small domes on the cells at the corners.
  f.part(cylinder(0.62, 0.62, 0.22, 8), PAL.stoneDark, 0, h, -d / 2 + 0.5);
  f.part(dome(0.56), PAL.lead, 0, h + 0.22, -d / 2 + 0.5);
  for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
    f.part(dome(0.2, 10), PAL.lead, x, h + 0.08, -d / 2 + t / 2);
  tackapi(f.sub(0, 0, d / 2 + 0.05), 1.05, 2.0);
  minaret(f, w / 2 - 0.25, d / 2 - 0.25, 3.1, 0.15);
}

/** A darüşşifa: a domed hall on a turquoise drum, two side wards, and a walled garden before it. */
function hospital(f: Frame, front: number, depth: number, id: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  const hall = d * 0.66;
  const z0 = -d / 2 + hall / 2;
  f.part(box(w, 1.1 + 0.5, hall), PAL.plaster, 0, -0.5, z0);
  f.part(box(w + 0.08, 0.08, hall + 0.08), PAL.stoneDark, 0, 1.1, z0);
  f.part(cylinder(0.68, 0.68, 0.32, 12), PAL.turquoise, 0, 1.1, z0);
  f.part(dome(0.62, 16), PAL.lead, 0, 1.42, z0);
  for (const x of [-w * 0.34, w * 0.34]) f.part(dome(0.34, 12), PAL.plaster, x, 1.1, z0);
  tackapi(f.sub(0, 0, z0 + hall / 2 + 0.05), 0.95, 1.8);
  // Garden wall with a gap for the path, and cypresses for the sick to look at.
  const gz = d / 2 - 0.04;
  f.part(box(w / 2 - 0.35, 0.32, 0.07), PAL.stone, -w / 4 - 0.17, 0, gz);
  f.part(box(w / 2 - 0.35, 0.32, 0.07), PAL.stone, w / 4 + 0.17, 0, gz);
  for (const x of [-w * 0.34, w * 0.34]) {
    const h = 0.7 + hash2(id, x > 0 ? 1 : 2, 71) * 0.2;
    f.part(cylinder(0.03, 0.03, 0.12, 5), PAL.trunk, x, 0, gz - 0.35);
    f.part(cone(0.13, h, 7), PAL.servi, x, 0.1, gz - 0.35);
  }
}

/** An ahi lodge: a domed hall for the brotherhood's gatherings, a guest room and a walled yard. */
function lodge(f: Frame, front: number, depth: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  f.part(box(1.0, 1.0 + 0.5, 1.0), PAL.stone, -w / 2 + 0.55, -0.5, -d / 2 + 0.55);
  f.part(cylinder(0.46, 0.46, 0.14, 8), PAL.stoneDark, -w / 2 + 0.55, 1.0, -d / 2 + 0.55);
  f.part(dome(0.42), PAL.lead, -w / 2 + 0.55, 1.14, -d / 2 + 0.55);
  f.part(arch(0.3, 0.5, 0.03), PAL.door, -w / 2 + 0.55, 0, -d / 2 + 1.06);
  f.part(box(0.7, 0.7 + 0.5, 0.8), PAL.plaster, w / 2 - 0.4, -0.5, -d / 2 + 0.45);
  f.part(box(0.76, 0.05, 0.86), PAL.roofs[3], w / 2 - 0.4, 0.7, -d / 2 + 0.45);
  f.part(box(w, 0.3, 0.07), PAL.stone, 0, 0, d / 2 - 0.04);
  f.part(arch(0.36, 0.55, 0.08), PAL.stoneLight, 0, 0, d / 2 - 0.08);
  f.part(cylinder(0.04, 0.05, 0.3, 5), PAL.trunk, w / 2 - 0.35, 0, d / 2 - 0.45);
  f.part(dome(0.26, 10), PAL.fruit, w / 2 - 0.35, 0.3, d / 2 - 0.45);
}
