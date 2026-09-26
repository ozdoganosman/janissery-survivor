import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { hash2 } from '../core/rng';
import { barracksOf, type Unit } from '../sim/army';
import { UNIT_KINDS, type UnitKind } from '../sim/balance';
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

/**
 * Seconds between redraws of the men at drill. Men standing at ease are redrawn a slice at
 * a time along with them, so that each is redrawn a few times a second.
 */
const LIVE_EVERY = 1 / 30;
const EASE_SLICES = 8;

/**
 * Beyond the first zoom the men are drawn with fewer sides; beyond the second the smallest
 * parts (arrows, quivers, pennants, tails) are left out too.
 */
const COARSE_ZOOM = 12;
const FINE_ZOOM = 24;

/** Companies of horsemen that ride laps at once; the rest wait their turn in the ranks. */
const MAX_LANES = 3;
const LANE_WIDTH = 0.22;

interface Formation {
  cols: number;
  file: number;
  rank: number;
}

/** Close order: a man to every metre and a quarter along the rank, a horse to three. */
const FORMATIONS: Record<UnitKind, Formation> = {
  mizrakci: { cols: 10, file: 0.125, rank: 0.14 },
  okcu: { cols: 10, file: 0.125, rank: 0.15 },
  atli_okcu: { cols: 10, file: 0.16, rank: 0.33 },
  gulam: { cols: 10, file: 0.17, rank: 0.34 },
};

/** Where each man belongs: his place in the ranks, or his lap round the ground. */
interface Post {
  /** For riders at drill: how far round the circuit, and the lane they keep; else null. */
  lap: number | null;
  lane: number;
}

/** A company's block on the parade ground, in the barracks' frame. */
interface Block {
  unit: Unit;
  x: number;
  z: number;
  /** How much the ranks are closed up to fit everyone in. */
  f: number;
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
  private sinceLive = 0;
  private slice = 0;

  constructor(private readonly city: CityState) {
    this.sync();
  }

  /** Men drawn in the barracks, for the smoke test. */
  get count(): number {
    return this.crowd?.count ?? 0;
  }

  /** Distinct poses in the last redraw, for tuning. */
  get poses(): number {
    return this.crowd?.poses ?? 0;
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

    // A few companies of horsemen at drill ride round the ground; the rest stand in their
    // blocks, kind by kind, from the back of the ground forwards.
    let lanes = 0;
    const riding = new Set<Unit>();
    for (const u of c.army.units) {
      if (isRider(u) && u.drill !== null && lanes < MAX_LANES) {
        riding.add(u);
        lanes++;
      }
    }
    const standing = UNIT_KINDS.flatMap((kind) =>
      c.army.units.filter((u) => u.kind === kind && !riding.has(u)),
    );
    const edge = 0.3 + MAX_LANES * LANE_WIDTH;
    const yard = {
      x0: lay.yard.x0 + edge,
      z0: lay.yard.z0 + edge,
      x1: lay.yard.x1 - edge,
      z1: lay.yard.z1 - edge,
    };
    const blocks = packBlocks(standing, yard);

    const live: Array<[Soldier, Post]> = [];
    const still: Array<[Soldier, Post]> = [];
    const ground = (x: number, z: number): number =>
      Math.max(base, sampleHeight(this.city.terrain, x, z)) + 0.045;
    let lane = 0;
    for (const u of riding) {
      const laneOf = lane++;
      for (let k = 0; k < u.men; k++) {
        const seed = hash2(u.id, k, 17);
        // Each horse at its own point of the gallop.
        const s = soldier(u.kind, animFor(u, true), seed, seed * 2);
        live.push([s, { lap: (k / u.men + laneOf * 0.13) % 1, lane: laneOf }]);
      }
    }
    for (const { unit: u, x, z, f } of blocks) {
      const form = FORMATIONS[u.kind];
      const cols = Math.min(form.cols, u.men);
      const drilling = u.drill !== null;
      const shooting = drilling && u.kind === 'okcu';
      const anim = animFor(u, false);
      for (let k = 0; k < u.men; k++) {
        const col = k % cols;
        const rank = Math.floor(k / cols);
        const seed = hash2(u.id, k, 17);
        const lx = x + (col + 0.5) * form.file * f + (seed - 0.5) * 0.02 * f;
        const lz = z + (rank + 0.5) * form.rank * f;
        const w = this.toWorld(lx, lz, 0);
        const s = soldier(u.kind, anim, seed, rankTime(u, rank, seed));
        s.x = w.x;
        s.z = w.z;
        s.y = ground(w.x, w.z);
        // Facing the gate; archers at drill turn to the butts.
        s.heading = (shooting ? Math.PI / 2 : 0) + rot;
        if (shooting) s.aim = targets[Math.floor(seed * targets.length) % targets.length];
        (isLive(anim) ? live : still).push([s, { lap: null, lane: 0 }]);
      }
    }
    const all = [...live, ...still];
    this.posts = all.map(([, p]) => p);
    this.crowd = new SoldierCrowd(
      all.map(([s]) => s),
      live.length,
    );
    this.group.add(this.crowd.group);
    this.place(0);
    this.crowd.update(1);
    return true;
  }

  /** Moves the drill on and redraws the men, when the barracks is in sight. */
  update(dt: number, zoom: number, camera: THREE.Camera): void {
    const crowd = this.crowd;
    this.group.visible = crowd !== null && zoom < 48;
    if (crowd === null || !this.group.visible) return;
    const pace = PACE[this.city.calendar.speed] ?? 1;
    const step = Math.min(dt, 0.1) * pace;
    for (const s of crowd.soldiers) s.t += step;
    this.sinceLive += dt;
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    if (!this.frustum.intersectsSphere(this.sphere)) return;
    crowd.setDetail(zoom < COARSE_ZOOM ? 0 : zoom < FINE_ZOOM ? 1 : 2);
    const scale = 1 + 0.3 * smoothstep(10, 34, zoom);
    const rescaled = Math.abs(scale - this.lastScale) > 1e-3;
    if (!rescaled && (pace === 0 || this.sinceLive < LIVE_EVERY)) return;
    this.lastScale = scale;
    this.place(this.sinceLive * pace);
    this.sinceLive = 0;
    if (rescaled) {
      crowd.update(scale);
      return;
    }
    // Everyone at drill, and one slice of the men at ease.
    const still = crowd.count - crowd.live;
    const size = Math.ceil(still / EASE_SLICES);
    this.slice = (this.slice + 1) % EASE_SLICES;
    const from = crowd.live + this.slice * size;
    crowd.update(scale, from, from + size);
  }

  /** Sets the riders at drill where their lap has brought them. */
  private place(step: number): void {
    const crowd = this.crowd;
    if (crowd === null) return;
    const { base, rot } = this.frame;
    const n = crowd.live;
    for (let i = 0; i < n; i++) {
      const p = this.posts[i];
      if (p.lap === null) continue;
      const s = crowd.soldiers[i];
      // Round the parade ground at a canter, each company in its own lane.
      p.lap = (p.lap + Math.min(step, 0.1) * 0.035) % 1;
      const [lx, lz, dir] = aroundRect(this.circuit, p.lane * LANE_WIDTH, p.lap);
      const w = this.toWorld(lx, lz, 0);
      s.x = w.x;
      s.z = w.z;
      s.y = Math.max(base, sampleHeight(this.city.terrain, w.x, w.z)) + 0.045;
      s.heading = dir + rot;
    }
  }

  private toWorld(lx: number, lz: number, y: number): THREE.Vector3 {
    const { cx, cz, base, rot } = this.frame;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return new THREE.Vector3(cx + lx * c + lz * s, base + y, cz - lx * s + lz * c);
  }
}

function soldier(kind: UnitKind, anim: Anim, seed: number, t: number): Soldier {
  return { kind, x: 0, y: 0, z: 0, heading: 0, anim, t, aim: null, seed };
}

/** Drill goes in waves down the ranks; men standing at ease fidget on their own time. */
function rankTime(u: Unit, rank: number, seed: number): number {
  return u.drill !== null ? rank * 0.12 + seed * 0.05 : seed * 20;
}

/** The animations that move enough to be redrawn every frame. */
function isLive(anim: Anim): boolean {
  return anim !== 'idle' && anim !== 'stand';
}

/**
 * Lays the companies out in rows across the ground, each in its block of ranks. When they
 * do not all fit, the ranks close up, down to little more than half their room.
 */
function packBlocks(units: Unit[], yard: Rect): Block[] {
  const gap = 0.3;
  const lay = (f: number): { blocks: Block[]; depth: number } => {
    const blocks: Block[] = [];
    let x = yard.x0;
    let z = yard.z0;
    let rowDepth = 0;
    for (const u of units) {
      const form = FORMATIONS[u.kind];
      const cols = Math.min(form.cols, u.men);
      const w = cols * form.file * f;
      const d = Math.ceil(u.men / cols) * form.rank * f;
      if (x + w > yard.x1 && x > yard.x0) {
        x = yard.x0;
        z += rowDepth + gap * f;
        rowDepth = 0;
      }
      blocks.push({ unit: u, x, z, f });
      x += w + gap * f;
      rowDepth = Math.max(rowDepth, d);
    }
    return { blocks, depth: z + rowDepth - yard.z0 };
  };
  let f = 1;
  let out = lay(f);
  while (out.depth > yard.z1 - yard.z0 && f > 0.55) {
    f *= 0.95;
    out = lay(f);
  }
  return out.blocks;
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
