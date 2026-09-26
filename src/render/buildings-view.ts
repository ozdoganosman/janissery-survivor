import * as THREE from 'three';
import type { CityState, Landmark } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, cone, cylinder, dome, PartBatch, type Frame } from './builder';
import { INK_CLASS, PAL } from './palette';

/** The city's named buildings: the mosque on the tepe, the tombs, the kiosk, the baths. */
export class BuildingsView {
  readonly group = new THREE.Group();

  constructor(city: CityState) {
    const batch = new PartBatch();
    for (const l of city.landmarks) buildLandmark(city, l, batch);
    batch.build(this.group, INK_CLASS.building);
  }
}

// ------------------------------------------------------------------ landmarks

/** Angle that turns a landmark's front (+z) towards the nearest road tile. */
export function faceNearestRoad(city: CityState, l: Landmark): number {
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
export function tackapi(f: Frame, w: number, h: number): void {
  f.part(box(w, h + 0.4, 0.4), PAL.stoneLight, 0, -0.4, 0);
  f.part(box(w + 0.1, 0.12, 0.46), PAL.stoneDark, 0, h - 0.06, 0);
  f.part(arch(w * 0.74, h * 0.84, 0.03), PAL.stone, 0, 0, 0.2);
  f.part(arch(w * 0.5, h * 0.68, 0.04), PAL.door, 0, 0, 0.22);
  for (const s of [-1, 1]) f.part(box(0.08, h * 0.9, 0.03), PAL.turquoise, s * w * 0.43, 0, 0.21);
}

export function minaret(f: Frame, x: number, z: number, h: number, r: number): void {
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
    case 'mescit':
      drawMescit(f, l.w, l.d);
      break;
    case 'hamam':
      drawHamam(f, l.w, l.d);
      break;
  }
}

/** A neighbourhood mescit: a domed cube, a portal on the front (+z) and a small minaret. */
export function drawMescit(f: Frame, w: number, d: number): void {
  const s = Math.min(w, d) - 0.6;
  f.part(box(s, 1.45 + 0.5, s), PAL.stone, 0, -0.5, 0);
  // The dome sits on an octagonal drum set in from the walls.
  f.part(cylinder(s * 0.44, s * 0.46, 0.25, 8), PAL.stoneDark, 0, 1.45, 0);
  f.part(dome(s * 0.39), PAL.lead, 0, 1.7, 0);
  tackapi(f.sub(0, 0, s / 2 + 0.05), 0.95, 1.7);
  minaret(f, s / 2 - 0.2, -s / 2 + 0.2, 3.3, 0.17);
}

/** A bath house: a long plastered block under a row of domes, the door on the front. */
export function drawHamam(f: Frame, w0: number, d0: number): void {
  const w = w0 - 0.5;
  const d = d0 - 0.5;
  f.part(box(w, 1.15 + 0.5, d), PAL.plaster, 0, -0.5, 0);
  for (const [x, r] of [
    [-w * 0.3, 0.55],
    [0, 0.7],
    [w * 0.3, 0.55],
  ] as const) {
    f.part(dome(r), PAL.plaster, x, 1.15, -0.1);
  }
  f.part(arch(0.45, 0.8, 0.03), PAL.door, 0, 0, d / 2);
}
