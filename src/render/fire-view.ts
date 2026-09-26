import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { box, cone, PartBatch } from './builder';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

/** At most this many houses are drawn burning at once; a fire rarely gets near it. */
const MAX_BURNING = 240;
const FLAMES = 3;
const CORES = 2;
const PUFFS = 4;
/** Seconds for a puff of smoke to climb and thin out. */
const SMOKE_PERIOD = 3.2;
/** Height of one storey of a house, as the houses view builds them. */
const STOREY = 0.36;

interface Blaze {
  x: number;
  y: number;
  z: number;
  seed: number;
}

/**
 * The fire the simulation says is burning: tongues of flame over each burning house and a
 * column of smoke above it, and, where houses have burned down, blackened plots with charred
 * beams until the ashes are cleared. Rebuilt when `revision.fire` changes; flames flicker
 * between rebuilds.
 */
export class FireView {
  readonly group = new THREE.Group();
  private key = -1;
  private blazes: Blaze[] = [];
  private flames: THREE.InstancedMesh | null = null;
  private cores: THREE.InstancedMesh | null = null;
  private smoke: THREE.InstancedMesh | null = null;
  private ruins: THREE.Group | null = null;
  private readonly flameGeom = cone(0.2, 0.62, 7);
  private readonly coreGeom = cone(0.12, 0.42, 6);
  private readonly puffGeom = new THREE.IcosahedronGeometry(0.22, 1);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.building);
    this.sync();
  }

  /** How many houses are burning, for the smoke test. */
  get burning(): number {
    return this.blazes.length;
  }

  sync(): boolean {
    const rev = this.city.revision.fire;
    if (rev === this.key) return false;
    this.key = rev;
    this.clear();
    const { grid, terrain, house, events } = this.city;
    const batch = new PartBatch();
    let ruins = 0;
    for (let i = 0; i < grid.count; i++) {
      const tx = i % grid.size;
      const tz = Math.floor(i / grid.size);
      const x = grid.centre(tx);
      const z = grid.centre(tz);
      if (events.fire[i] > 0 && this.blazes.length < MAX_BURNING) {
        const storeys = house[i] === 1 ? 1 : 2;
        this.blazes.push({
          x,
          y: sampleHeight(terrain, x, z) + storeys * STOREY,
          z,
          seed: hash2(tx, tz, 61),
        });
      } else if (events.ash[i] > 0 && house[i] === 0) {
        ruins++;
        const f = batch.frame(x, sampleHeight(terrain, x, z), z, hash2(tx, tz, 62) * Math.PI);
        f.part(box(0.78, 0.04, 0.74), PAL.ash);
        // A stump of wall, and beams fallen across the plot.
        f.part(box(0.5, 0.16 + hash2(tx, tz, 63) * 0.12, 0.08), PAL.charred, -0.1, 0, -0.3);
        f.part(box(0.08, 0.1, 0.36), PAL.charred, 0.3, 0, -0.1);
        const beam = box(0.66, 0.05, 0.05);
        beam.rotateY(0.5 + hash2(tx, tz, 64));
        f.part(beam, PAL.timberDark, 0, 0.04, 0.05);
        f.part(cone(0.16, 0.09, 6), PAL.charred, 0.18, 0.04, 0.22);
      }
    }
    if (ruins > 0) {
      this.ruins = new THREE.Group();
      batch.build(this.ruins, INK_CLASS.building);
      this.group.add(this.ruins);
    }
    if (this.blazes.length > 0) {
      const n = this.blazes.length;
      this.flames = this.instanced(this.flameGeom, PAL.ember, n * FLAMES);
      this.cores = this.instanced(this.coreGeom, PAL.flame, n * CORES);
      this.smoke = this.instanced(this.puffGeom, PAL.soot, n * PUFFS);
    }
    return true;
  }

  /** Flames lick and sway, smoke climbs and drifts with the wind. */
  update(seconds: number): void {
    const { flames, cores, smoke } = this;
    if (flames === null || cores === null || smoke === null) return;
    this.blazes.forEach((b, k) => {
      for (let j = 0; j < FLAMES; j++) {
        const a = b.seed * 40 + j * 2.1;
        const lick = 0.75 + 0.35 * Math.sin(seconds * 9 + a) + 0.15 * Math.sin(seconds * 23 + a * 3);
        const ox = Math.cos(a) * 0.2;
        const oz = Math.sin(a) * 0.2;
        this.put(
          flames,
          k * FLAMES + j,
          b.x + ox,
          b.y - 0.05,
          b.z + oz,
          1,
          lick,
          Math.sin(seconds * 5 + a) * 0.18,
        );
      }
      for (let j = 0; j < CORES; j++) {
        const a = b.seed * 50 + j * 3.3;
        const lick = 0.8 + 0.3 * Math.sin(seconds * 11 + a);
        const ox = Math.cos(a) * 0.12;
        const oz = Math.sin(a) * 0.12;
        this.put(cores, k * CORES + j, b.x + ox, b.y, b.z + oz, 1, lick, Math.sin(seconds * 6 + a) * 0.15);
      }
      for (let j = 0; j < PUFFS; j++) {
        const t = (seconds / SMOKE_PERIOD + j / PUFFS + b.seed) % 1;
        const size = 0.8 + t * 2.2;
        this.put(smoke, k * PUFFS + j, b.x + t * 0.9, b.y + 0.5 + t * 3.2, b.z - t * 0.4, size, size, 0);
      }
    });
    flames.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
    smoke.instanceMatrix.needsUpdate = true;
  }

  private put(
    mesh: THREE.InstancedMesh,
    slot: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    lean: number,
  ): void {
    this.e.set(lean, 0, lean * 0.6);
    this.q.setFromEuler(this.e);
    this.v.set(x, y, z);
    this.s.set(width, height, width);
    this.m.compose(this.v, this.q, this.s);
    mesh.setMatrixAt(slot, this.m);
  }

  private instanced(geom: THREE.BufferGeometry, color: string, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geom, miniMaterial({ color }), count);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  private clear(): void {
    for (const mesh of [this.flames, this.cores, this.smoke]) {
      if (mesh === null) continue;
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.flames = null;
    this.cores = null;
    this.smoke = null;
    if (this.ruins !== null) {
      this.group.remove(this.ruins);
      for (const child of this.ruins.children) {
        if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
      }
      this.ruins = null;
    }
    this.blazes = [];
  }
}
