import * as THREE from 'three';
import { angleDelta } from '../core/geom';
import type { CityState, Landmark } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, cone, cylinder, dome, PartBatch, type Frame } from './builder';
import { INK_CLASS, PAL } from './palette';

/** Walls, gates and the city's named buildings: everything that is authored, not zoned. */
export class BuildingsView {
  readonly group = new THREE.Group();

  constructor(city: CityState) {
    const batch = new PartBatch();
    buildWalls(city, batch);
    for (const l of city.landmarks) buildLandmark(city, l, batch);
    batch.build(this.group, INK_CLASS.building);
  }
}

// ------------------------------------------------------------------ walls

const WALL_THICK = 0.62;
const MERLON_STEP = 0.52;

function buildWalls(city: CityState, batch: PartBatch): void {
  const { def, terrain } = city;
  const R = def.walls.radius;
  const H = def.walls.height;
  const cx = def.tepe.x;
  const cz = def.tepe.z;
  const at = (a: number, r = R): [number, number] => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  const ground = (x: number, z: number): number => sampleHeight(terrain, x, z);

  // Posts: ordinary towers at a steady spacing, plus a pair flanking every gate.
  type Post = { a: number; kind: 'tower' | 'gate' };
  const posts: Post[] = [];
  const gateHalf = 1.55 / R;
  const count = Math.max(8, Math.round((2 * Math.PI * R) / def.walls.towerSpacing));
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    if (city.gates.some((g) => Math.abs(angleDelta(a, g.angle)) < gateHalf + 2.2 / R)) continue;
    posts.push({ a, kind: 'tower' });
  }
  for (const g of city.gates) {
    posts.push({ a: g.angle - gateHalf, kind: 'gate' }, { a: g.angle + gateHalf, kind: 'gate' });
  }
  posts.sort((p, q) => p.a - q.a);

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const q = posts[(i + 1) % posts.length];
    const [px, pz] = at(p.a);
    const tangent = p.a + Math.PI / 2;
    const size = p.kind === 'tower' ? 1.25 : 1.45;
    const height = p.kind === 'tower' ? H + 0.5 : H + 0.8;
    const tower = batch.frame(px, ground(px, pz) - 0.6, pz, -tangent);
    tower.part(box(size, height + 0.6, size), PAL.wall);
    merlonRing(tower, size, height + 0.6);

    const span = angleDelta(q.a, p.a) < 0 ? angleDelta(q.a, p.a) + Math.PI * 2 : angleDelta(q.a, p.a);
    const isGate = p.kind === 'gate' && q.kind === 'gate' && span < gateHalf * 2 + 1e-6;
    if (isGate) {
      buildGate(batch, at, ground, p.a + span / 2, span * R, H);
      continue;
    }
    // Wall run between the posts, split into short chords so it follows the circle.
    const pieces = Math.max(1, Math.ceil((span * R) / 1.8));
    for (let k = 0; k < pieces; k++) {
      const a0 = p.a + (span * k) / pieces;
      const a1 = p.a + (span * (k + 1)) / pieces;
      const [x0, z0] = at(a0);
      const [x1, z1] = at(a1);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
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

// ------------------------------------------------------------------ landmarks

/** Angle that turns a landmark's front (+z) towards the nearest road tile. */
function faceNearestRoad(city: CityState, l: Landmark): number {
  const { grid } = city;
  let best = Infinity;
  let angle = l.rot;
  const cx = grid.tileOf(l.x);
  const cz = grid.tileOf(l.z);
  const reach = Math.max(l.w, l.d) + 3;
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = cx + dx;
      const z = cz + dz;
      if (!grid.inBounds(x, z) || city.road[grid.index(x, z)] !== 1) continue;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        // Snap to the four sides so footprints stay aligned with the tile grid.
        const raw = Math.atan2(grid.centre(x) - l.x, grid.centre(z) - l.z);
        angle = Math.round(raw / (Math.PI / 2)) * (Math.PI / 2);
      }
    }
  }
  return angle;
}

/**
 * A Seljuk portal: a tall block standing proud of the façade, a pale framing arch, a dark
 * niche and two turquoise bands. Faces +z of the frame.
 */
function tackapi(f: Frame, w: number, h: number): void {
  f.part(box(w, h + 0.4, 0.4), PAL.stoneLight, 0, -0.4, 0);
  f.part(box(w + 0.1, 0.12, 0.46), PAL.stoneDark, 0, h - 0.06, 0);
  f.part(arch(w * 0.74, h * 0.84, 0.03), PAL.stone, 0, 0, 0.2);
  f.part(arch(w * 0.5, h * 0.68, 0.04), PAL.door, 0, 0, 0.22);
  for (const s of [-1, 1]) f.part(box(0.08, h * 0.9, 0.03), PAL.turquoise, s * w * 0.43, 0, 0.21);
}

function minaret(f: Frame, x: number, z: number, h: number, r: number): void {
  f.part(box(r * 2.6, h * 0.3 + 0.4, r * 2.6), PAL.brick, x, -0.4, z);
  f.part(cylinder(r, r * 1.12, h * 0.7), PAL.brick, x, h * 0.3, z);
  for (const t of [0.55, 0.78]) f.part(cylinder(r * 1.18, r * 1.18, 0.12), PAL.turquoise, x, h * t, z);
  f.part(cylinder(r * 1.6, r * 1.15, 0.14), PAL.stoneLight, x, h, z);
  f.part(cylinder(r * 0.78, r * 0.85, h * 0.12), PAL.brick, x, h + 0.14, z);
  f.part(cone(r * 0.95, h * 0.12), PAL.lead, x, h + 0.14 + h * 0.12, z);
}

function buildLandmark(city: CityState, l: Landmark, batch: PartBatch): void {
  const { terrain } = city;
  // Sit on the lowest corner and sink a little, so nothing floats on a slope.
  let base = Infinity;
  for (const [dx, dz] of [
    [-l.w / 2, -l.d / 2],
    [l.w / 2, -l.d / 2],
    [-l.w / 2, l.d / 2],
    [l.w / 2, l.d / 2],
    [0, 0],
  ]) {
    base = Math.min(base, sampleHeight(terrain, l.x + dx, l.z + dz));
  }
  const rot = l.kind === 'mescit' || l.kind === 'hamam' ? faceNearestRoad(city, l) : l.rot;
  const f = batch.frame(l.x, base, l.z, rot);

  switch (l.kind) {
    case 'cami': {
      // Alaeddin Camii: a long flat-roofed hall, a dome over the mihrab bay, a portal and
      // a brick minaret.
      const w = l.w - 0.4;
      const d = l.d - 0.4;
      f.part(box(w, 1.65 + 0.5, d), PAL.stone, 0, -0.5, 0);
      f.part(box(w + 0.14, 0.12, d + 0.14), PAL.stoneDark, 0, 1.65, 0);
      f.part(cylinder(1.15, 1.15, 0.36, 8), PAL.stone, 0.9, 1.77, 0.5);
      f.part(cylinder(1.02, 1.02, 0.26, 18), PAL.stoneDark, 0.9, 2.13, 0.5);
      f.part(dome(1.02), PAL.lead, 0.9, 2.39, 0.5);
      for (let i = 0; i < 6; i++)
        f.part(arch(0.26, 0.55, 0.02), PAL.door, -w / 2 + 0.8 + i * ((w - 1.6) / 5), 0.35, d / 2);
      tackapi(f.sub(w / 2 + 0.05, 0, -0.5, Math.PI / 2), 1.45, 2.45);
      minaret(f, w / 2 - 0.55, -d / 2 + 0.55, 5.2, 0.27);
      break;
    }
    case 'kumbet': {
      // A ten-sided tomb tower under a turquoise cone.
      f.part(cylinder(0.84, 0.88, 2.4 + 0.4, 10), PAL.stone, 0, -0.4, 0);
      f.part(cylinder(0.96, 0.96, 0.14, 10), PAL.stoneDark, 0, 2.4, 0);
      f.part(cone(0.98, 1.55, 10), PAL.turquoise, 0, 2.54, 0);
      f.part(arch(0.36, 0.8, 0.03), PAL.door, 0, 0.1, 0.84);
      break;
    }
    case 'kosk': {
      // The palace pavilion: a tall block with a balcony looking over the city.
      f.part(box(1.8, 3.1 + 0.5, 1.6), PAL.stoneLight, 0, -0.5, 0);
      f.part(box(2.05, 0.12, 1.85), PAL.stoneDark, 0, 3.1, 0);
      const roof = cone(1.35, 0.75, 4);
      roof.rotateY(Math.PI / 4);
      f.part(roof, PAL.lead, 0, 3.22, 0);
      f.part(box(0.6, 0.1, 1.4), PAL.stoneDark, 1.2, 1.95, 0);
      for (const x of [-0.45, 0.45]) f.part(arch(0.3, 0.6, 0.02), PAL.door, x, 2.05, 0.8);
      break;
    }
    case 'mescit': {
      const s = Math.min(l.w, l.d) - 0.6;
      f.part(box(s, 1.45 + 0.5, s), PAL.stone, 0, -0.5, 0);
      f.part(cylinder(s * 0.55, s * 0.55, 0.25, 8), PAL.stoneDark, 0, 1.45, 0);
      f.part(dome(s * 0.46), PAL.lead, 0, 1.7, 0);
      tackapi(f.sub(0, 0, s / 2 + 0.05), 0.95, 1.7);
      minaret(f, s / 2 - 0.2, -s / 2 + 0.2, 3.3, 0.17);
      break;
    }
    case 'hamam': {
      const w = l.w - 0.5;
      const d = l.d - 0.5;
      f.part(box(w, 1.15 + 0.5, d), PAL.plaster, 0, -0.5, 0);
      for (const [x, r] of [
        [-w * 0.3, 0.55],
        [0, 0.7],
        [w * 0.3, 0.55],
      ] as const) {
        f.part(dome(r), PAL.plaster, x, 1.15, -0.1);
      }
      f.part(arch(0.45, 0.8, 0.03), PAL.door, 0, 0, d / 2);
      break;
    }
  }
}
