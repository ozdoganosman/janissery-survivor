import * as THREE from 'three';
import type { Vec2 } from '../core/geom';
import { WALL_NONE, type CityState, type Gate } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { planRing, type WallRing, type WallRun } from '../sim/walls';
import { arch, box, PartBatch, type Frame } from './builder';
import { INK_CLASS, PAL } from './palette';

const WALL_THICK = 0.62;
const MERLON_STEP = 0.52;
/** Half the width of a gate passage, along the wall. */
const GATE_HALF = 1.55;

/**
 * Every ring of walls round the tepe, with its towers and gates. A ring still being raised
 * stands as far round as the work has come, with gaps where the streets will pass. Where a
 * building interrupts a ring, the wall stops and starts again beyond it; where the stream
 * turned a ring aside, the wall follows the bank and ends in a tower.
 */
export class WallsView {
  readonly group = new THREE.Group();
  private key = '';

  constructor(private readonly city: CityState) {
    this.sync();
  }

  sync(): boolean {
    const { revision, expansion } = this.city;
    const w = expansion.work;
    const progress = w === null ? -1 : Math.floor((1 - w.daysLeft / w.days) * 24);
    const key = `${revision.walls}:${revision.buildings}:${progress}`;
    if (key === this.key) return false;
    this.key = key;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
    }
    const batch = new PartBatch();
    this.city.rings.forEach((ring, k) => {
      buildRing(
        this.city,
        batch,
        ring,
        this.city.gates.filter((g) => g.ring === k),
        1,
      );
    });
    if (w !== null) {
      // The ring going up: as far round as the months of work have carried it.
      buildRing(this.city, batch, planRing(this.city, expansion.built), [], 1 - w.daysLeft / w.days);
    }
    batch.build(this.group, INK_CLASS.building);
    return true;
  }
}

/** A line of wall measured along its length. */
class Line {
  private readonly pts: Vec2[];
  private readonly s: number[] = [0];
  private readonly closed: boolean;
  readonly length: number;

  constructor(run: WallRun) {
    this.closed = run.closed;
    this.pts = run.closed ? [...run.points, run.points[0]] : run.points;
    for (let i = 1; i < this.pts.length; i++) {
      const [ax, az] = this.pts[i - 1];
      const [bx, bz] = this.pts[i];
      this.s.push(this.s[i - 1] + Math.hypot(bx - ax, bz - az));
    }
    this.length = this.s[this.s.length - 1];
  }

  /** The point `s` along the line, and the direction the line runs there. */
  at(s: number): { x: number; z: number; dir: number } {
    const L = this.length;
    // A closed line goes on round; an open one stops at its ends.
    const t = this.closed ? s - Math.floor(s / L) * L : Math.min(L, Math.max(0, s));
    let lo = 0;
    let hi = this.s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.s[mid] <= t) lo = mid;
      else hi = mid;
    }
    const [ax, az] = this.pts[lo];
    const [bx, bz] = this.pts[hi];
    const seg = this.s[hi] - this.s[lo];
    const f = seg > 0 ? (t - this.s[lo]) / seg : 0;
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, dir: Math.atan2(bz - az, bx - ax) };
  }

  /** How far along the line its nearest point to (x, z) lies, and how far off that is. */
  nearest(x: number, z: number): { s: number; d: number } {
    let best = { s: 0, d: Infinity };
    for (let i = 0; i < this.pts.length - 1; i++) {
      const [ax, az] = this.pts[i];
      const [bx, bz] = this.pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const f = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const d = Math.hypot(ax + dx * f - x, az + dz * f - z);
      if (d < best.d) best = { s: this.s[i] + (this.s[i + 1] - this.s[i]) * f, d };
    }
    return best;
  }
}

/**
 * One ring: every line of its wall, with towers at a steady spacing and at the ends, a pair
 * flanking every gate, and the wall between them in short chords. `done` is how far round
 * (0..1) a ring going up stands.
 */
function buildRing(city: CityState, batch: PartBatch, ring: WallRing, gates: Gate[], done: number): void {
  const { def, terrain, grid } = city;
  const cx = def.tepe.x;
  const cz = def.tepe.z;
  const ground = (x: number, z: number): number => sampleHeight(terrain, x, z);
  const finished = done >= 1;
  const reach = done * Math.PI * 2;
  const risen = (x: number, z: number): boolean => finished || angleOf(Math.atan2(z - cz, x - cx)) <= reach;
  /** Whether wall may stand at a point. */
  const solid = (x: number, z: number): boolean => {
    const tx = grid.tileOf(x);
    const tz = grid.tileOf(z);
    if (!grid.inBounds(tx, tz)) return false;
    const i = grid.index(tx, tz);
    // A standing ring has its tiles; one still going up avoids what it will go round.
    if (finished) return city.wall[i] !== WALL_NONE;
    return terrain.water[i] === 0 && city.structure[i] < 0 && city.building[i] < 0 && city.road[i] === 0;
  };
  const gateCentres = gates.map((g): Vec2 => {
    let x = 0;
    let z = 0;
    for (const i of g.tiles) {
      x += grid.centre(i % grid.size);
      z += grid.centre(Math.floor(i / grid.size));
    }
    return [x / g.tiles.length, z / g.tiles.length];
  });
  const H = ring.height;

  for (const run of ring.runs) {
    const line = new Line(run);
    const L = line.length;
    if (L < 0.5) continue;
    const gatesHere: number[] = [];
    for (const [gx, gz] of gateCentres) {
      const hit = line.nearest(gx, gz);
      if (hit.d < 1.6) gatesHere.push(hit.s);
    }
    const nearGate = (s: number, gap: number): boolean =>
      gatesHere.some((g) => {
        const d = Math.abs(g - s);
        return (run.closed ? Math.min(d, L - d) : d) < gap;
      });

    type Post = { s: number; kind: 'tower' | 'gate' };
    const posts: Post[] = [];
    const count = Math.max(run.closed ? 8 : 1, Math.round(L / def.walls.towerSpacing));
    const last = run.closed ? count - 1 : run.spur ? count - 1 : count;
    for (let k = 0; k <= last; k++) {
      const s = (k / count) * L;
      if (!nearGate(s, GATE_HALF + 2.2)) posts.push({ s, kind: 'tower' });
    }
    // A spur's outer end meets the end tower of the stretch it closes; it keeps its own end
    // as a plain piece of wall.
    if (run.spur && !nearGate(L, GATE_HALF + 2.2)) posts.push({ s: L, kind: 'tower' });
    for (const g of gatesHere) {
      posts.push({ s: g - GATE_HALF, kind: 'gate' }, { s: g + GATE_HALF, kind: 'gate' });
    }
    posts.sort((p, q) => p.s - q.s);

    posts.forEach((p, i) => {
      const at = line.at(p.s);
      const endOfSpur = run.spur && p.kind === 'tower' && p.s >= L - 1e-6;
      if (!endOfSpur && risen(at.x, at.z) && (p.kind === 'gate' || solid(at.x, at.z))) {
        const size = p.kind === 'tower' ? 1.25 : 1.45;
        const height = p.kind === 'tower' ? H + 0.5 : H + 0.8;
        const tower = batch.frame(at.x, ground(at.x, at.z) - 0.6, at.z, -at.dir);
        tower.part(box(size, height + 0.6, size), PAL.wall);
        merlonRing(tower, size, height + 0.6);
      }
      if (!run.closed && i === posts.length - 1) return;
      const q = posts[(i + 1) % posts.length];
      const qs = q.s + (i + 1 === posts.length ? L : 0);
      const span = qs - p.s;
      if (p.kind === 'gate' && q.kind === 'gate' && span < GATE_HALF * 2 + 1e-6) {
        const mid = line.at(p.s + span / 2);
        buildGate(batch, mid.x, mid.z, mid.dir, span, H, ground);
        return;
      }
      const pieces = Math.max(1, Math.ceil(span / 1.8));
      for (let k = 0; k < pieces; k++) {
        const a0 = line.at(p.s + (span * k) / pieces);
        const a1 = line.at(p.s + (span * (k + 1)) / pieces);
        if (!risen(a1.x, a1.z)) continue;
        const mx = (a0.x + a1.x) / 2;
        const mz = (a0.z + a1.z) / 2;
        if (!solid(mx, mz)) continue;
        const len = Math.hypot(a1.x - a0.x, a1.z - a0.z) + 0.05;
        const rot = -Math.atan2(a1.z - a0.z, a1.x - a0.x);
        const base = Math.min(ground(a0.x, a0.z), ground(a1.x, a1.z)) - 0.6;
        const f = batch.frame(mx, base, mz, rot);
        f.part(box(len, H + 0.6, WALL_THICK), PAL.wall);
        // Crenellations on the outer edge; +z in this frame points away from the city.
        const outward = Math.sin(rot) * (mx - cx) + Math.cos(rot) * (mz - cz) > 0 ? 1 : -1;
        const n = Math.floor(len / MERLON_STEP);
        for (let m = 0; m < n; m++) {
          const lx = -len / 2 + (m + 0.5) * (len / n);
          f.part(box(0.26, 0.2, 0.16), PAL.wall, lx, H + 0.6, outward * (WALL_THICK / 2 - 0.08));
        }
      }
    });
  }
}

/** An angle folded into 0..2π, the order the work goes round in. */
function angleOf(a: number): number {
  return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function merlonRing(f: Frame, size: number, top: number): void {
  const n = 3;
  for (let k = 0; k < n; k++) {
    const t = -size / 2 + (k + 0.5) * (size / n);
    f.part(box(0.24, 0.2, 0.14), PAL.wall, t, top, size / 2 - 0.07);
    f.part(box(0.24, 0.2, 0.14), PAL.wall, t, top, -size / 2 + 0.07);
    f.part(box(0.14, 0.2, 0.24), PAL.wall, size / 2 - 0.07, top, t);
    f.part(box(0.14, 0.2, 0.24), PAL.wall, -size / 2 + 0.07, top, t);
  }
}

function buildGate(
  batch: PartBatch,
  x: number,
  z: number,
  dir: number,
  width: number,
  H: number,
  ground: (x: number, z: number) => number,
): void {
  // The frame's x axis runs along the wall; the opening faces out along z.
  const f = batch.frame(x, ground(x, z) - 0.02, z, -dir);
  const shape = new THREE.Shape();
  const w = width + 0.2;
  const h = H + 0.35;
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, h);
  shape.lineTo(-w / 2, h);
  shape.lineTo(-w / 2, 0);
  const hole = new THREE.Shape();
  hole.copy(archShapeOf(0.95, 1.2));
  shape.holes.push(new THREE.Path(hole.getPoints(12)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
  body.translate(0, 0, -0.5);
  f.part(body, PAL.wall);
  f.part(box(w + 0.1, 0.12, 1.1), PAL.stoneDark, 0, h, 0);
  // A dark band around the opening, the way a miniature marks a gate.
  f.part(arch(1.25, 1.42, 0.02), PAL.stoneDark, 0, 0, 0.5);
  f.part(arch(1.25, 1.42, 0.02), PAL.stoneDark, 0, 0, -0.52);
}

function archShapeOf(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const spring = h - w * 0.72;
  s.moveTo(-hw, 0);
  s.lineTo(-hw, spring);
  s.quadraticCurveTo(-hw, spring + w * 0.5, 0, h);
  s.quadraticCurveTo(hw, spring + w * 0.5, hw, spring);
  s.lineTo(hw, 0);
  s.lineTo(-hw, 0);
  return s;
}
