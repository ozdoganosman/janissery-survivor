import * as THREE from 'three';
import { angleDelta } from '../core/geom';
import { WALL_NONE, type CityState, type Gate } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, PartBatch, type Frame } from './builder';
import { INK_CLASS, PAL } from './palette';

const WALL_THICK = 0.62;
const MERLON_STEP = 0.52;

/**
 * Every ring of walls round the tepe, with its towers and gates. A ring still being raised
 * stands as far round as the work has come, with gaps where the streets will pass. Where a
 * stream or a building interrupts a ring, the wall stops and starts again beyond it.
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
    for (const ring of this.city.rings) {
      const gates = this.city.gates.filter((g) => Math.abs(g.radius - ring.radius) < 0.01);
      buildRing(this.city, batch, ring.radius, ring.height, gates, 1);
    }
    if (w !== null) {
      // The ring going up: as far round as the months of work have carried it.
      const next = this.city.def.expansions[expansion.built];
      buildRing(this.city, batch, next.radius, this.city.def.walls.height * 1.1, [], 1 - w.daysLeft / w.days);
    }
    batch.build(this.group, INK_CLASS.building);
    return true;
  }
}

/**
 * One ring: towers at a steady spacing, a pair flanking every gate, and the wall between
 * them in short chords that follow the circle. `done` is how far round (0..1) it stands.
 */
function buildRing(
  city: CityState,
  batch: PartBatch,
  R: number,
  H: number,
  gates: Gate[],
  done: number,
): void {
  const { def, terrain, grid } = city;
  const cx = def.tepe.x;
  const cz = def.tepe.z;
  const at = (a: number, r = R): [number, number] => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  const ground = (x: number, z: number): number => sampleHeight(terrain, x, z);
  const finished = done >= 1;
  const reach = done * Math.PI * 2;
  /** Whether wall may stand at a point of the ring. */
  const solid = (x: number, z: number): boolean => {
    const tx = grid.tileOf(x);
    const tz = grid.tileOf(z);
    if (!grid.inBounds(tx, tz)) return false;
    const i = grid.index(tx, tz);
    // A standing ring has its tiles; one still going up avoids what it will go round.
    if (finished) return city.wall[i] !== WALL_NONE;
    return terrain.water[i] === 0 && city.structure[i] < 0 && city.building[i] < 0 && city.road[i] === 0;
  };

  type Post = { a: number; kind: 'tower' | 'gate' };
  const posts: Post[] = [];
  const gateHalf = 1.55 / R;
  const count = Math.max(8, Math.round((2 * Math.PI * R) / def.walls.towerSpacing));
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    if (gates.some((g) => Math.abs(angleDelta(a, g.angle)) < gateHalf + 2.2 / R)) continue;
    posts.push({ a, kind: 'tower' });
  }
  for (const g of gates) {
    posts.push({ a: g.angle - gateHalf, kind: 'gate' }, { a: g.angle + gateHalf, kind: 'gate' });
  }
  posts.sort((p, q) => angleOf(p.a) - angleOf(q.a));

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const q = posts[(i + 1) % posts.length];
    const [px, pz] = at(p.a);
    const span = angleDelta(q.a, p.a) < 0 ? angleDelta(q.a, p.a) + Math.PI * 2 : angleDelta(q.a, p.a);
    const isGate = p.kind === 'gate' && q.kind === 'gate' && span < gateHalf * 2 + 1e-6;
    if (angleOf(p.a) <= reach && (p.kind === 'gate' || solid(px, pz))) {
      const tangent = p.a + Math.PI / 2;
      const size = p.kind === 'tower' ? 1.25 : 1.45;
      const height = p.kind === 'tower' ? H + 0.5 : H + 0.8;
      const tower = batch.frame(px, ground(px, pz) - 0.6, pz, -tangent);
      tower.part(box(size, height + 0.6, size), PAL.wall);
      merlonRing(tower, size, height + 0.6);
    }
    if (isGate) {
      buildGate(batch, at, ground, p.a + span / 2, span * R, H);
      continue;
    }
    const pieces = Math.max(1, Math.ceil((span * R) / 1.8));
    for (let k = 0; k < pieces; k++) {
      const a0 = p.a + (span * k) / pieces;
      const a1 = p.a + (span * (k + 1)) / pieces;
      if (angleOf(a1) > reach && !finished) continue;
      const [x0, z0] = at(a0);
      const [x1, z1] = at(a1);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      if (!solid(mx, mz)) continue;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.05;
      const rot = -Math.atan2(z1 - z0, x1 - x0);
      const base = Math.min(ground(x0, z0), ground(x1, z1)) - 0.6;
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
  at: (a: number, r?: number) => [number, number],
  ground: (x: number, z: number) => number,
  angle: number,
  width: number,
  H: number,
): void {
  const [x, z] = at(angle);
  // The frame's x axis runs along the wall; the opening faces out along z.
  const f = batch.frame(x, ground(x, z) - 0.02, z, -(angle + Math.PI / 2));
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
