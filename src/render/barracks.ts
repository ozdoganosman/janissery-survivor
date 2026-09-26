import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { arch, box, cone, cylinder, dome, type Frame } from './builder';
import { minaret, tackapi } from './buildings-view';
import { PAL } from './palette';

/**
 * The barracks: a whole compound outside the walls, laid out on the building's frame
 * (front along x, depth along z, the gate facing +z). It grows with its level over the
 * ground claimed for it from the start: a fenced camp of one hall and felt tents, then a
 * walled quarter with stables, then a fortress (ribat) with a portal, an armoury and a
 * mescit. Where the soldiers stand, drill and shoot comes from the same layout.
 */

/** Something parts can be placed in: a building's frame, or the ground of a site. */
interface Parts {
  part(geom: THREE.BufferGeometry, color: string, x?: number, y?: number, z?: number, rotY?: number): unknown;
}

/**
 * The building's frame laid over uneven ground: every part stands on the ground where it
 * is, so a compound a hundred and forty metres across follows the lie of the land.
 */
class Site implements Parts {
  constructor(
    private readonly f: Frame,
    readonly lift: (x: number, z: number) => number,
  ) {}

  part(geom: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rotY = 0): this {
    this.f.part(geom, color, x, y + this.lift(x, z), z, rotY);
    return this;
  }

  sub(x: number, z: number, rotY = 0): Frame {
    return this.f.sub(x, this.lift(x, z), z, rotY);
  }

  /** Highest ground under a rectangle's corners, for things that must not be buried. */
  top(x0: number, z0: number, x1: number, z1: number): number {
    return Math.max(this.lift(x0, z0), this.lift(x1, z0), this.lift(x0, z1), this.lift(x1, z1));
  }
}

/** Splits a length into pieces no longer than `most`, giving each piece's middle and length. */
function pieces(from: number, to: number, most: number): Array<[number, number]> {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / most));
  const len = (to - from) / n;
  return Array.from({ length: n }, (_, k) => [from + len * (k + 0.5), Math.abs(len)]);
}

/** An axis-aligned rectangle in the building's frame. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface BarracksLayout {
  level: number;
  /** Inside of the enclosure wall. */
  wall: Rect;
  /** The parade ground: companies stand and drill here. */
  yard: Rect;
  /** Quarters along the back. */
  halls: Rect[];
  /** Felt tents (otağ) of a camp: x, z, radius. */
  tents: Array<[number, number, number]>;
  /** Stables along the left side, and the fenced ground before them. */
  stables: Rect[];
  paddock: Rect;
  /** Butts along the right side, and the lane the archers shoot down. */
  targets: Array<[number, number]>;
  range: Rect;
  towers: Array<[number, number]>;
  /** Path the horsemen ride round the parade ground while they drill. */
  circuit: Rect;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function barracksLayout(front: number, depth: number, level: number): BarracksLayout {
  const L = Math.max(1, Math.min(3, level)) - 1;
  const W = front * [0.56, 0.84, 0.97][L];
  const D = depth * [0.62, 0.86, 0.96][L];
  const wall: Rect = { x0: -W / 2, z0: -D / 2, x1: W / 2, z1: D / 2 };
  // Quarters along the back: a camp's band is deeper, for its rows of tents.
  const hallD = L === 0 ? D * 0.2 : Math.min(2.4, D * 0.12);
  const leftW = W * [0.14, 0.16, 0.16][L];
  const rightW = W * 0.12;
  const backZ = wall.z0 + hallD;
  const hallCount = [1, 3, 4][L];
  const hallX0 = wall.x0 + leftW;
  // A camp's single hall takes part of the back; tents take the rest. A fortress keeps the
  // back corner of the range for its armoury.
  const hallX1 = L === 0 ? lerp(hallX0, wall.x1, 0.4) : wall.x1 - (L === 2 ? rightW : 0);
  const halls: Rect[] = [];
  const gap = 0.3;
  const each = (hallX1 - hallX0 - gap * (hallCount - 1)) / hallCount;
  const hallDepth = L === 0 ? Math.min(1.6, hallD * 0.5) : hallD - 0.22;
  for (let k = 0; k < hallCount; k++) {
    const x0 = hallX0 + k * (each + gap);
    halls.push({ x0: x0 + 0.1, z0: wall.z0 + 0.12, x1: x0 + each - 0.1, z1: wall.z0 + 0.12 + hallDepth });
  }
  const tents: Array<[number, number, number]> = [];
  if (L === 0) {
    // Felt tents in rows behind the parade ground, and one row before the hall.
    const r = Math.min(0.42, hallD * 0.2);
    for (const row of [0.27, 0.73]) {
      for (let x = hallX1 + r + 0.25; x < wall.x1 - r - 0.15; x += r * 2.5) {
        tents.push([x, wall.z0 + hallD * row, r]);
      }
    }
    for (let x = hallX0 + r + 0.15; x < hallX1 - r; x += r * 2.5) {
      tents.push([x, wall.z0 + 0.12 + hallDepth + r + 0.3, r]);
    }
  }
  const stableD = L === 0 ? 0 : (D - hallD) * (L === 1 ? 0.5 : 0.6);
  const stables: Rect[] = [];
  if (L >= 1) {
    const n = L + 1;
    const each2 = (stableD - 0.25 * (n - 1)) / n;
    for (let k = 0; k < n; k++) {
      const z0 = wall.z0 + 0.12 + k * (each2 + 0.25);
      stables.push({ x0: wall.x0 + 0.12, z0, x1: wall.x0 + leftW * 0.5, z1: z0 + each2 });
    }
  }
  const paddock: Rect = {
    x0: wall.x0 + 0.15,
    z0: L === 0 ? backZ + 0.3 : wall.z0 + stableD + 0.35,
    x1: wall.x0 + leftW - 0.15,
    z1: wall.z1 - 0.45,
  };
  const range: Rect = { x0: wall.x1 - rightW, z0: backZ + 0.3, x1: wall.x1 - 0.12, z1: wall.z1 - 0.5 };
  const targets: Array<[number, number]> = [];
  const nt = [3, 5, 7][L];
  for (let k = 0; k < nt; k++)
    targets.push([wall.x1 - 0.3, lerp(range.z0 + 0.4, range.z1 - 0.4, (k + 0.5) / nt)]);
  const yard: Rect = {
    x0: wall.x0 + leftW + 0.25,
    z0: backZ + 0.35,
    x1: wall.x1 - rightW - 0.15,
    z1: wall.z1 - 0.45,
  };
  // Towers at the corners, and for a walled quarter along the walls too, clear of the gate.
  const towers: Array<[number, number]> = [
    [wall.x0, wall.z0],
    [wall.x1, wall.z0],
    [wall.x0, wall.z1],
    [wall.x1, wall.z1],
  ];
  if (L >= 1) {
    const spacing = L === 1 ? 7 : 5.5;
    const along = (ax: number, az: number, bx: number, bz: number): void => {
      const n = Math.floor(Math.hypot(bx - ax, bz - az) / spacing);
      for (let k = 1; k < n; k++) {
        const x = lerp(ax, bx, k / n);
        const z = lerp(az, bz, k / n);
        if (z === wall.z1 && Math.abs(x) < 2.2) continue;
        towers.push([x, z]);
      }
    };
    along(wall.x0, wall.z0, wall.x1, wall.z0);
    along(wall.x0, wall.z1, wall.x1, wall.z1);
    along(wall.x0, wall.z0, wall.x0, wall.z1);
    along(wall.x1, wall.z0, wall.x1, wall.z1);
  }
  const circuit: Rect = { x0: yard.x0 - 0.2, z0: yard.z0 - 0.1, x1: yard.x1 + 0.05, z1: yard.z1 + 0.2 };
  return { level: L + 1, wall, yard, halls, tents, stables, paddock, targets, range, towers, circuit };
}

/** Draws the whole compound for its level. */
export function drawBarracks(
  frame: Frame,
  front: number,
  depth: number,
  level: number,
  id: number,
  lift: (x: number, z: number) => number = () => 0,
): void {
  const f = new Site(frame, lift);
  const lay = barracksLayout(front, depth, level);
  const { wall } = lay;
  const L = lay.level;
  // The trodden ground of the compound, and the parade ground paved or rolled within it,
  // laid in small squares that each follow the ground.
  const y = lay.yard;
  const yardColor = L === 3 ? PAL.stoneLight : PAL.bank;
  const step = 0.5;
  for (let gx = wall.x0; gx < wall.x1 - 1e-6; gx += step) {
    for (let gz = wall.z0; gz < wall.z1 - 1e-6; gz += step) {
      const w = Math.min(step, wall.x1 - gx);
      const d = Math.min(step, wall.z1 - gz);
      const inYard = gx + w / 2 > y.x0 && gx + w / 2 < y.x1 && gz + d / 2 > y.z0 && gz + d / 2 < y.z1;
      const top = f.top(gx, gz, gx + w, gz + d);
      frame.part(box(w, 0.14, d), inYard ? yardColor : PAL.road, gx + w / 2, top - 0.1, gz + d / 2);
    }
  }

  if (L === 1) palisade(f, wall);
  else stoneWall(f, wall, L === 2 ? 0.72 : 1.0, L === 2 ? 0.16 : 0.22);
  towers(f, lay);
  gate(f, wall, L);

  lay.halls.forEach((h, k) => hall(f, h, L, hash2(id, k, 3)));
  for (const [x, z, r] of lay.tents) tent(f, x, z, r, hash2(id, Math.round(x * 10), 5));
  for (const s of lay.stables) stable(f, s);
  paddockFence(f, lay.paddock, L);
  for (const [x, z] of lay.targets) butt(f, x, z);
  // A line of pegs down the range, where the archers take their stand.
  for (let z = lay.range.z0; z <= lay.range.z1; z += 0.5) {
    f.part(box(0.03, 0.08, 0.03), PAL.timberDark, lay.range.x0 + 0.1, 0, z);
  }

  if (L >= 2) {
    // A well in the corner of the parade ground, and weapon racks by the halls.
    for (const wx of [y.x0 + 0.3, y.x1 - 0.3]) {
      f.part(cylinder(0.18, 0.2, 0.2, 10), PAL.stone, wx, 0, y.z0 + 0.25);
      f.part(cylinder(0.12, 0.12, 0.03, 10), PAL.water, wx, 0.19, y.z0 + 0.25);
    }
    for (const h of lay.halls) {
      for (const t of [0.3, 0.7]) rack(f, lerp(h.x0, h.x1, t), h.z1 + 0.12);
    }
  }
  if (L === 3) {
    // The armoury (cebehane) under a lead dome, and a mescit with its minaret.
    const ax = wall.x1 - 1.4;
    const az = wall.z0 + 1.2;
    f.part(box(2.2, 1.1, 2.0), PAL.stone, ax, 0, az);
    for (const dx of [-0.5, 0.5]) f.part(dome(0.48, 14), PAL.lead, ax + dx, 1.1, az);
    f.part(arch(0.45, 0.7, 0.03), PAL.door, ax, 0, az + 1.01);
    const mx = wall.x0 + 1.3;
    const mz = wall.z1 - 1.25;
    f.part(box(1.7, 0.95, 1.7), PAL.plaster, mx, 0, mz);
    f.part(dome(0.7, 16), PAL.turquoise, mx, 0.95, mz);
    f.part(arch(0.4, 0.62, 0.03), PAL.door, mx + 0.86, 0, mz, Math.PI / 2);
    minaret(f.sub(mx + 0.8, mz - 0.8), 0, 0, 2.2, 0.13);
  }
  banners(f, lay);
}

function palisade(f: Parts, r: Rect): void {
  const post = (x: number, z: number, h: number): void => {
    f.part(cylinder(0.035, 0.04, h, 5), PAL.timber, x, 0, z);
    f.part(cone(0.04, 0.06, 5), PAL.timberDark, x, h, z);
  };
  const step = 0.16;
  const gateHalf = 0.5;
  for (let x = r.x0; x <= r.x1 + 1e-6; x += step) {
    post(x, r.z0, 0.5);
    if (Math.abs(x) > gateHalf) post(x, r.z1, 0.5);
  }
  for (let z = r.z0 + step; z < r.z1; z += step) {
    post(r.x0, z, 0.5);
    post(r.x1, z, 0.5);
  }
  // Rails lashing the stakes together.
  for (const hy of [0.15, 0.38]) {
    for (const [x, len] of pieces(r.x0, r.x1, 0.6)) f.part(box(len, 0.03, 0.03), PAL.timberDark, x, hy, r.z0);
    for (const [z, len] of pieces(r.z0, r.z1, 0.6)) {
      f.part(box(0.03, 0.03, len), PAL.timberDark, r.x0, hy, z);
      f.part(box(0.03, 0.03, len), PAL.timberDark, r.x1, hy, z);
    }
    for (const [x, len] of [...pieces(r.x0, -gateHalf, 0.6), ...pieces(gateHalf, r.x1, 0.6)]) {
      f.part(box(len, 0.03, 0.03), PAL.timberDark, x, hy, r.z1);
    }
  }
}

function stoneWall(f: Parts, r: Rect, h: number, t: number): void {
  const gateHalf = 0.7;
  // Each run of wall goes up in short lengths, each on its own ground, sunk a little.
  const seg = (x: number, z: number, len: number, alongX: boolean): void => {
    const from = (alongX ? x : z) - len / 2;
    for (const [c, l] of pieces(from, from + len, 0.6)) {
      const px = alongX ? c : x;
      const pz = alongX ? z : c;
      f.part(box(alongX ? l + 0.01 : t, h + 0.15, alongX ? t : l + 0.01), PAL.stone, px, -0.15, pz);
      f.part(box(alongX ? l + 0.01 : t + 0.04, 0.05, alongX ? t + 0.04 : l + 0.01), PAL.stoneDark, px, h, pz);
      const n = Math.max(1, Math.round(l / 0.3));
      for (let k = 0; k < n; k++) {
        const u = -l / 2 + (k + 0.5) * (l / n);
        f.part(
          box(alongX ? 0.14 : 0.07, 0.12, alongX ? 0.07 : 0.14),
          PAL.stone,
          alongX ? px + u : px,
          h + 0.05,
          alongX ? pz : pz + u,
        );
      }
    }
  };
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  seg(0, r.z0, w, true);
  seg(r.x0, (r.z0 + r.z1) / 2, d, false);
  seg(r.x1, (r.z0 + r.z1) / 2, d, false);
  const side = w / 2 - gateHalf;
  for (const s of [-1, 1]) seg(s * (gateHalf + side / 2), r.z1, side, true);
}

function towers(f: Parts, lay: BarracksLayout): void {
  const L = lay.level;
  for (const [x, z] of lay.towers) {
    if (L === 1) {
      // A timber watchtower on four legs.
      for (const [dx, dz] of [
        [-0.18, -0.18],
        [0.18, -0.18],
        [-0.18, 0.18],
        [0.18, 0.18],
      ]) {
        f.part(box(0.05, 1.1, 0.05), PAL.timber, x + dx, 0, z + dz);
      }
      f.part(box(0.5, 0.06, 0.5), PAL.timberDark, x, 1.05, z);
      f.part(box(0.5, 0.18, 0.04), PAL.timber, x, 1.1, z + 0.23);
      f.part(box(0.5, 0.18, 0.04), PAL.timber, x, 1.1, z - 0.23);
      f.part(cone(0.42, 0.32, 4).rotateY(Math.PI / 4), PAL.roofs[3], x, 1.35, z);
      continue;
    }
    const s = L === 2 ? 0.5 : 0.62;
    const h = L === 2 ? 1.1 : 1.55;
    f.part(box(s, h, s), PAL.stone, x, 0, z);
    f.part(box(s + 0.08, 0.06, s + 0.08), PAL.stoneDark, x, h, z);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      f.part(box(0.12, 0.14, 0.12), PAL.stone, x + (dx * (s - 0.1)) / 2, h + 0.06, z + (dz * (s - 0.1)) / 2);
    }
    f.part(box(0.1, 0.18, 0.02), PAL.ink, x, h * 0.6, z + s / 2 + 0.005);
  }
}

function gate(f: Site, r: Rect, L: number): void {
  if (L === 1) {
    for (const s of [-1, 1]) f.part(box(0.1, 0.8, 0.1), PAL.timberDark, s * 0.5, 0, r.z1);
    f.part(box(1.15, 0.08, 0.1), PAL.timberDark, 0, 0.72, r.z1);
    f.part(box(0.5, 0.2, 0.02), PAL.banner, 0, 0.5, r.z1 + 0.06);
    return;
  }
  if (L === 2) {
    for (const s of [-1, 1]) f.part(box(0.4, 1.2, 0.45), PAL.stone, s * 0.72, 0, r.z1);
    f.part(box(1.85, 0.3, 0.4), PAL.stone, 0, 0.9, r.z1);
    f.part(arch(1.0, 0.95, 0.03), PAL.door, 0, 0, r.z1 + 0.2);
    return;
  }
  // The portal of a fortress: a tall pointed niche between two towers.
  tackapi(f.sub(0, r.z1 + 0.05), 1.8, 1.9);
  for (const s of [-1, 1]) {
    f.part(cylinder(0.3, 0.34, 1.7, 10), PAL.stone, s * 1.15, 0, r.z1);
    f.part(cylinder(0.36, 0.36, 0.08, 10), PAL.stoneDark, s * 1.15, 1.7, r.z1);
  }
}

function hall(f: Parts, h: Rect, L: number, seed: number): void {
  const w = h.x1 - h.x0;
  const d = h.z1 - h.z0;
  const x = (h.x0 + h.x1) / 2;
  const z = (h.z0 + h.z1) / 2;
  if (L === 1) {
    // A long timber hut with a gabled roof.
    f.part(box(w, 0.42, d), PAL.timber, x, 0, z);
    f.part(gable(w + 0.1, d + 0.12, 0.34), PAL.roofs[1], x, 0.42, z);
    for (let k = 0; k < 3; k++)
      f.part(box(0.16, 0.26, 0.02), PAL.door, x - w / 3 + (k * w) / 3, 0, h.z1 + 0.005);
    return;
  }
  const tall = L === 2 ? 0.6 : 0.85;
  f.part(box(w, tall, d), L === 2 ? PAL.stone : PAL.plaster, x, 0, z);
  f.part(box(w + 0.06, 0.06, d + 0.06), PAL.stoneDark, x, tall, z);
  const n = Math.max(2, Math.round(w / 0.55));
  for (let k = 0; k < n; k++) {
    const ax = h.x0 + (k + 0.5) * (w / n);
    f.part(arch(0.2, 0.34, 0.02), PAL.door, ax, 0, h.z1 + 0.005);
    if (L === 3) f.part(arch(0.14, 0.22, 0.02), PAL.door, ax, 0.48, h.z1 + 0.005);
  }
  if (L === 3) {
    // A row of small lead domes over the vaulted halls.
    const nd = Math.max(2, Math.round(w / 0.8));
    for (let k = 0; k < nd; k++) f.part(dome(0.22, 10), PAL.lead, h.x0 + (k + 0.5) * (w / nd), tall, z);
  } else if (seed < 0.5) {
    f.part(box(0.18, 0.28, 0.18), PAL.brick, h.x1 - 0.2, tall, h.z0 + 0.15);
  }
}

function tent(f: Parts, x: number, z: number, r: number, seed: number): void {
  // A Turkmen felt tent: round walls, a low cone of felt, a red band.
  f.part(cylinder(r, r, 0.2, 12), PAL.wool, x, 0, z);
  f.part(cylinder(r + 0.01, r + 0.01, 0.04, 12), seed < 0.5 ? PAL.banner : PAL.dyes[1], x, 0.15, z);
  f.part(cone(r * 1.06, 0.2, 12), PAL.wool, x, 0.2, z);
  f.part(box(0.12, 0.15, 0.02), PAL.door, x, 0, z + r);
}

function stable(f: Parts, s: Rect): void {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const x = (s.x0 + s.x1) / 2;
  const z = (s.z0 + s.z1) / 2;
  f.part(box(w, 0.45, d), PAL.timber, x, 0, z);
  f.part(gable(d + 0.1, w + 0.1, 0.3), PAL.roofs[0], x, 0.45, z, Math.PI / 2);
  const n = Math.max(2, Math.round(d / 0.35));
  for (let k = 0; k < n; k++)
    f.part(box(0.02, 0.28, 0.2), PAL.timberDark, s.x1 + 0.005, 0, s.z0 + (k + 0.5) * (d / n));
  // Hay stacked by the door.
  f.part(cylinder(0.12, 0.15, 0.18, 8), PAL.bread, s.x1 + 0.2, 0, s.z1 - 0.15);
}

function paddockFence(f: Parts, p: Rect, L: number): void {
  const x0 = p.x0;
  const x1 = p.x1;
  const rail = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.45));
    for (let k = 0; k <= n; k++)
      f.part(box(0.035, 0.24, 0.035), PAL.fence, ax + ((bx - ax) * k) / n, 0, az + ((bz - az) * k) / n);
    for (const hy of [0.1, 0.2]) {
      if (az === bz)
        for (const [x, l] of pieces(ax, bx, 0.6)) f.part(box(l, 0.025, 0.025), PAL.fence, x, hy, az);
      else for (const [z, l] of pieces(az, bz, 0.6)) f.part(box(0.025, 0.025, l), PAL.fence, ax, hy, z);
    }
  };
  rail(x1, p.z0, x1, p.z1 - 0.8);
  rail(x0, p.z0, x1, p.z0);
  // A trough and a tethering rail for the horses.
  f.part(box(0.12, 0.08, 0.6), PAL.timberDark, (x0 + x1) / 2, 0, p.z0 + 0.5);
  if (L === 1) f.part(box(x1 - x0 - 0.2, 0.03, 0.03), PAL.timberDark, (x0 + x1) / 2, 0.22, p.z1 - 0.2);
}

function butt(f: Parts, x: number, z: number): void {
  // A straw butt on legs, its painted face turned towards the archers.
  const face = cylinder(0.17, 0.17, 0.08, 14).rotateZ(Math.PI / 2);
  f.part(face, PAL.bread, x, 0.3, z);
  f.part(cylinder(0.11, 0.11, 0.09, 14).rotateZ(Math.PI / 2), PAL.plaster, x - 0.005, 0.36, z);
  f.part(cylinder(0.05, 0.05, 0.1, 10).rotateZ(Math.PI / 2), PAL.banner, x - 0.01, 0.42, z);
  for (const dz of [-0.1, 0.1]) f.part(box(0.03, 0.3, 0.03), PAL.timberDark, x + 0.05, 0, z + dz);
}

function rack(f: Parts, x: number, z: number): void {
  f.part(box(0.5, 0.03, 0.04), PAL.timberDark, x, 0.3, z);
  for (let k = 0; k < 5; k++) {
    f.part(cylinder(0.006, 0.006, 0.5, 4), PAL.timber, x - 0.2 + k * 0.1, 0, z);
    f.part(cone(0.012, 0.04, 4), PAL.iron, x - 0.2 + k * 0.1, 0.5, z);
  }
}

function banners(f: Parts, lay: BarracksLayout): void {
  const L = lay.level;
  const poles: Array<[number, number, number]> = lay.towers.map(([x, z]) => [
    x,
    z,
    L === 1 ? 1.45 : L === 2 ? 1.25 : 1.7,
  ]);
  if (L === 3) poles.push([-0.6, lay.wall.z1 + 0.05, 2.2], [0.6, lay.wall.z1 + 0.05, 2.2]);
  for (const [x, z, h] of poles) {
    f.part(cylinder(0.015, 0.015, 0.55, 5), PAL.timberDark, x, h, z);
    f.part(box(0.3, 0.18, 0.012), PAL.banner, x + 0.16, h + 0.35, z);
  }
}

/** A gabled roof `w` long with its ridge along x, `d` across and `h` high. */
function gable(w: number, d: number, h: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
