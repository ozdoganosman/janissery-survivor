import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { hash2 } from '../core/rng';
import { barracksOf, type Unit } from '../sim/army';
import type { UnitKind } from '../sim/balance';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { barracksLayout, type Rect } from './barracks';
import { SoldierCrowd, type Anim, type Soldier } from './soldiers';
import { buildingFrame } from './works-view';

/**
 * The army in its barracks, man for man. Every company stands on the parade ground in
 * its ranks; those still drilling are at work: spearmen lunge rank after rank, archers
 * loose at the butts, horsemen ride round the ground. Only the look follows the
 * simulation; the drill itself is scenery and stops when the game is paused.
 */

/** Walking pace of time at each game speed; paused, the drill holds still. */
const PACE = [0, 1, 1.6, 2.2];

interface Formation {
  cols: number;
  file: number;
  rank: number;
}

const FORMATIONS: Record<UnitKind, Formation> = {
  mizrakci: { cols: 10, file: 0.15, rank: 0.16 },
  okcu: { cols: 10, file: 0.15, rank: 0.17 },
  atli_okcu: { cols: 10, file: 0.17, rank: 0.36 },
  gulam: { cols: 8, file: 0.18, rank: 0.38 },
};

/** Where each man belongs: his place in the ranks, or his lap round the ground. */
interface Post {
  lx: number;
  lz: number;
  /** Heading in the barracks' frame. */
  lh: number;
  /** For riders at drill: how far round the circuit, and the lane they keep. */
  lap: number | null;
  lane: number;
}

export class ArmyView {
  readonly group = new THREE.Group();
  private crowd: SoldierCrowd | null = null;
  private posts: Post[] = [];
  private key = '';
  private frame = { cx: 0, cz: 0, base: 0, rot: 0 };
  private circuit: Rect = { x0: 0, z0: 0, x1: 0, z1: 0 };
  private readonly sphere = new THREE.Sphere();
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private lastScale = -1;

  constructor(private readonly city: CityState) {
    this.sync();
  }

  /** Men drawn in the barracks, for the smoke test. */
  get count(): number {
    return this.crowd?.count ?? 0;
  }

  sync(): boolean {
    const c = this.city;
    const b = barracksOf(c);
    const key = `${c.revision.army}:${c.revision.buildings}:${b?.id ?? 0}:${b?.level ?? 0}`;
    if (key === this.key) return false;
    this.key = key;
    if (this.crowd !== null) {
      this.group.remove(this.crowd.group);
      this.crowd.dispose();
      this.crowd = null;
    }
    this.posts = [];
    this.lastScale = -1;
    if (b === undefined || b.level === 0 || c.army.units.length === 0) return true;
    const { cx, cz, base, rot, front, depth } = buildingFrame(c, b);
    this.frame = { cx, cz, base, rot };
    const lay = barracksLayout(front, depth, b.level);
    this.circuit = lay.circuit;
    this.sphere.set(new THREE.Vector3(cx, base, cz), Math.hypot(front, depth) / 2 + 1);
    const targets = lay.targets.map(([tx, tz]) => this.toWorld(tx - 0.05, tz, 0.4));

    const soldiers: Soldier[] = [];
    // Companies take their ground from the back of the parade ground forwards, row by row.
    // The companies keep off the edge of the ground, where the horsemen ride their laps.
    const edge = 0.5;
    const yard = {
      x0: lay.yard.x0 + edge,
      z0: lay.yard.z0 + edge,
      x1: lay.yard.x1 - edge,
      z1: lay.yard.z1 - edge,
    };
    const gap = 0.35;
    let x = yard.x0;
    let z = yard.z0;
    let rowDepth = 0;
    let lane = 0;
    for (const u of c.army.units) {
      const f = FORMATIONS[u.kind];
      const cols = Math.min(f.cols, u.men);
      const ranks = Math.ceil(u.men / cols);
      const w = cols * f.file;
      const d = ranks * f.rank;
      const riding = isRider(u) && u.drill !== null;
      if (!riding) {
        if (x + w > yard.x1 && x > yard.x0) {
          x = yard.x0;
          z += rowDepth + gap;
          rowDepth = 0;
        }
      }
      const drilling = u.drill !== null;
      const shooting = drilling && u.kind === 'okcu';
      const laneOf = riding ? lane++ : 0;
      for (let k = 0; k < u.men; k++) {
        const col = k % cols;
        const rank = Math.floor(k / cols);
        const seed = hash2(u.id, k, 17);
        const post: Post = {
          lx: x + (col + 0.5) * f.file + (seed - 0.5) * 0.02,
          lz: z + (rank + 0.5) * f.rank,
          // Facing the gate; archers at drill turn to the butts.
          lh: shooting ? Math.PI / 2 : 0,
          lap: riding ? (k / u.men + laneOf * 0.13) % 1 : null,
          lane: laneOf,
        };
        const anim: Anim = animFor(u, riding);
        const s: Soldier = {
          kind: u.kind,
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
          anim,
          // Drill goes in waves down the ranks; standing men fidget on their own time.
          t: drilling ? rank * 0.12 + seed * 0.05 : seed * 20,
          aim: null,
          seed,
        };
        if (shooting) s.aim = targets[Math.floor(seed * targets.length) % targets.length];
        this.posts.push(post);
        soldiers.push(s);
      }
      if (!riding) {
        x += w + gap;
        rowDepth = Math.max(rowDepth, d);
      }
    }
    this.crowd = new SoldierCrowd(soldiers);
    this.group.add(this.crowd.group);
    this.place(0);
    return true;
  }

  /** Moves the drill on and redraws the men, when the barracks is in sight. */
  update(dt: number, zoom: number, camera: THREE.Camera): void {
    const crowd = this.crowd;
    this.group.visible = crowd !== null && zoom < 48;
    if (crowd === null || !this.group.visible) return;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    if (!this.frustum.intersectsSphere(this.sphere)) return;
    const pace = PACE[this.city.calendar.speed] ?? 1;
    const step = Math.min(dt, 0.1) * pace;
    const scale = 1 + 0.3 * smoothstep(10, 34, zoom);
    if (step === 0 && Math.abs(scale - this.lastScale) < 1e-3) return;
    this.lastScale = scale;
    for (const s of crowd.soldiers) s.t += step;
    this.place(step);
    crowd.update(scale);
  }

  /** Sets every man where his post puts him: in the ranks, or on his lap. */
  private place(step: number): void {
    const crowd = this.crowd;
    if (crowd === null) return;
    const { base, rot } = this.frame;
    const ground = (x: number, z: number): number =>
      Math.max(base, sampleHeight(this.city.terrain, x, z)) + 0.045;
    crowd.soldiers.forEach((s, i) => {
      const p = this.posts[i];
      let lx = p.lx;
      let lz = p.lz;
      let lh = p.lh;
      if (p.lap !== null) {
        // Round the parade ground at a canter, each company in its own lane.
        p.lap = (p.lap + step * 0.035) % 1;
        const inset = p.lane * 0.3;
        const [px, pz, dir] = aroundRect(this.circuit, inset, p.lap);
        lx = px;
        lz = pz;
        lh = dir;
      }
      const w = this.toWorld(lx, lz, 0);
      s.x = w.x;
      s.z = w.z;
      s.y = ground(w.x, w.z);
      s.heading = lh + rot;
    });
  }

  private toWorld(lx: number, lz: number, y: number): THREE.Vector3 {
    const { cx, cz, base, rot } = this.frame;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return new THREE.Vector3(cx + lx * c + lz * s, base + y, cz - lx * s + lz * c);
  }
}

function isRider(u: Unit): boolean {
  return u.kind === 'atli_okcu' || u.kind === 'gulam';
}

function animFor(u: Unit, riding: boolean): Anim {
  const drilling = u.drill !== null;
  switch (u.kind) {
    case 'mizrakci':
      return drilling ? 'thrust' : 'idle';
    case 'okcu':
      return drilling ? 'shoot' : 'idle';
    case 'atli_okcu':
      return riding ? 'rideShoot' : 'stand';
    case 'gulam':
      return riding ? 'couch' : 'stand';
  }
}

/**
 * A point `t` (0..1) of the way round a rectangle shrunk by `inset`, going round
 * anticlockwise seen from above, and the heading there.
 */
function aroundRect(r: Rect, inset: number, t: number): [number, number, number] {
  const x0 = r.x0 + inset;
  const x1 = r.x1 - inset;
  const z0 = r.z0 + inset;
  const z1 = r.z1 - inset;
  const w = Math.max(0.1, x1 - x0);
  const d = Math.max(0.1, z1 - z0);
  let s = t * 2 * (w + d);
  if (s < w) return [x0 + s, z1, Math.PI / 2];
  s -= w;
  if (s < d) return [x1, z1 - s, Math.PI];
  s -= d;
  if (s < w) return [x1 - s, z0, -Math.PI / 2];
  s -= w;
  return [x0, z0 + s, 0];
}
