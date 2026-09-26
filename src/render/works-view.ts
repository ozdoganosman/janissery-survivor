import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { FACING_DIRS, type Building } from '../sim/buildings';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { arch, box, cone, cylinder, dome, PartBatch, type Frame } from './builder';
import { drawBarracks } from './barracks';
import { drawHamam, minaret, tackapi } from './buildings-view';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

/** Seconds for a smoke puff to rise and fade. */
const SMOKE_PERIOD = 4.5;
const PUFFS = 4;

interface Chimney {
  top: THREE.Vector3;
  puffs: THREE.Mesh[];
  seed: number;
}

/**
 * The buildings the player puts up, each drawn for its level: a bazaar gains stalls and a
 * domed bedesten, a mosque a portico and a second minaret. A building going up stands in
 * scaffolding, its walls rising with the work; one being raised a level has poles round it.
 * Rebuilt when a building changes or its work moves on; smoke rises between rebuilds.
 */
export class WorksView {
  readonly group = new THREE.Group();
  private key = '';
  private chimneys: Chimney[] = [];
  private readonly puffGeom = new THREE.IcosahedronGeometry(0.2, 1);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.building);
    this.sync();
  }

  sync(): boolean {
    const { revision } = this.city;
    // Works in progress redraw in quarter steps as their walls rise.
    let progress = '';
    for (const b of this.city.buildings.values()) {
      if (b.work !== null) progress += `${b.id}.${Math.floor((1 - b.work.daysLeft / b.work.days) * 4)},`;
    }
    const key = `${revision.buildings}:${revision.roads}:${progress}`;
    if (key === this.key) return false;
    this.key = key;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh && child.geometry !== this.puffGeom) {
        (child.geometry as THREE.BufferGeometry).dispose();
      }
    }
    this.chimneys = [];
    const batch = new PartBatch();
    siteRocks(this.city, batch);
    for (const b of this.city.buildings.values()) this.buildOne(b, batch);
    batch.build(this.group, INK_CLASS.building);
    return true;
  }

  /** Lifts the smoke from the bath furnaces. */
  update(seconds: number): void {
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
    const { cx, cz, base, rot, front, depth } = buildingFrame(this.city, b);
    const f = batch.frame(cx, base, cz, rot);
    if (b.level === 0) {
      const done = b.work === null ? 0 : 1 - b.work.daysLeft / b.work.days;
      scaffold(f, front, depth, done, b.id);
      return;
    }
    const level = b.level;
    switch (b.kind) {
      case 'carsi':
        bazaar(f, front, depth, level, b.id);
        break;
      case 'ocak':
        quarry(f, front, depth, level, b.id);
        break;
      case 'cami':
        mosque(f, front, depth, level);
        break;
      case 'hamam':
        drawHamam(f, front, depth);
        if (level >= 2)
          for (const x of [-0.45, 0.45]) f.part(dome(0.22, 10), PAL.plaster, x, 1.15, depth / 2 - 0.45);
        if (level >= 3) f.part(cylinder(0.3, 0.3, 0.12, 8), PAL.turquoise, 0, 1.15, -0.1);
        // Smoke from the furnace behind.
        f.part(box(0.2, 1.7, 0.2), PAL.brick, front / 2 - 0.4, 0, -depth / 2 + 0.3);
        this.smoke(
          new THREE.Vector3(front / 2 - 0.4, 1.8, -depth / 2 + 0.3),
          base,
          cx,
          cz,
          rot,
          hash2(b.id, 1, 41),
        );
        break;
      case 'kervansaray':
        caravanserai(f, front, depth, level);
        break;
      case 'ambar':
        granary(f, front, depth, level, b.id);
        break;
      case 'kisla': {
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const { terrain } = this.city;
        drawBarracks(f, front, depth, level, b.id, (lx, lz) =>
          Math.max(0, sampleHeight(terrain, cx + lx * cr + lz * sr, cz - lx * sr + lz * cr) - base),
        );
        break;
      }
      case 'medrese':
        medrese(f, front, depth, level);
        break;
      case 'darussifa':
        hospital(f, front, depth, b.id, level);
        break;
    }
    if (b.work !== null) scaffoldPoles(f, front - 0.2, depth - 0.2, 1.6);
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
 * Where a building's model stands: its centre, the ground it sits on (the lowest of its
 * corners), and its turn. In the local frame the front is +z; `front` runs along x,
 * `depth` along z.
 */
export function buildingFrame(
  city: CityState,
  b: Building,
): { cx: number; cz: number; base: number; rot: number; front: number; depth: number } {
  const { terrain, grid } = city;
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
  return {
    cx,
    cz,
    base,
    rot: Math.atan2(fx, fz),
    front: b.facing % 2 === 0 ? b.w : b.d,
    depth: b.facing % 2 === 0 ? b.d : b.w,
  };
}

/**
 * Building work: the walls rising course by course inside a timber scaffold, with cut
 * stone and planks stacked on the ground before it.
 */
function scaffold(f: Frame, front: number, depth: number, done: number, id: number): void {
  const w = front - 0.4;
  const d = depth - 0.4;
  const h = 0.12 + done * 0.95;
  f.part(box(w + 0.1, 0.06, d + 0.1), PAL.stoneDark, 0, 0, 0);
  // Four walls, open in the middle, up to the height the work has reached.
  const t = 0.16;
  f.part(box(w, h, t), PAL.stone, 0, 0.06, d / 2 - t / 2);
  f.part(box(w, h, t), PAL.stone, 0, 0.06, -d / 2 + t / 2);
  f.part(box(t, h, d - 2 * t), PAL.stone, w / 2 - t / 2, 0.06, 0);
  f.part(box(t, h, d - 2 * t), PAL.stone, -w / 2 + t / 2, 0.06, 0);
  scaffoldPoles(f, w + 0.2, d + 0.2, Math.max(0.7, h + 0.45));
  // Blocks and planks waiting in the yard.
  for (let k = 0; k < 3; k++) {
    const x = -w / 2 + 0.25 + k * 0.28;
    f.part(box(0.22, 0.14, 0.16), PAL.stoneLight, x, 0, d / 2 + 0.22);
    if (hash2(id, k, 88) < 0.6) f.part(box(0.22, 0.14, 0.16), PAL.stoneLight, x + 0.05, 0.14, d / 2 + 0.22);
  }
  for (let k = 0; k < 3; k++)
    f.part(box(0.7, 0.04, 0.09), PAL.timber, w / 2 - 0.45, k * 0.04, d / 2 + 0.2 + k * 0.02);
}

/** Timber poles round a rectangle, tied with two rows of ledgers. */
function scaffoldPoles(f: Frame, w: number, d: number, h: number): void {
  const along = (len: number): number[] => {
    const n = Math.max(1, Math.round(len / 0.6));
    return Array.from({ length: n + 1 }, (_, k) => -len / 2 + (k * len) / n);
  };
  for (const x of along(w)) {
    f.part(box(0.04, h, 0.04), PAL.timber, x, 0, d / 2);
    f.part(box(0.04, h, 0.04), PAL.timber, x, 0, -d / 2);
  }
  for (const z of along(d)) {
    f.part(box(0.04, h, 0.04), PAL.timber, w / 2, 0, z);
    f.part(box(0.04, h, 0.04), PAL.timber, -w / 2, 0, z);
  }
  for (const y of [h * 0.45, h * 0.9]) {
    f.part(box(w, 0.03, 0.03), PAL.timberDark, 0, y, d / 2);
    f.part(box(w, 0.03, 0.03), PAL.timberDark, 0, y, -d / 2);
    f.part(box(0.03, 0.03, d), PAL.timberDark, w / 2, y, 0);
    f.part(box(0.03, 0.03, d), PAL.timberDark, -w / 2, y, 0);
  }
}

/**
 * A bazaar street: a vaulted row of shops with awnings and wares; more, narrower shops at
 * each level, and from the second level a domed bedesten behind for the precious goods.
 */
function bazaar(f: Frame, front: number, depth: number, level: number, id: number): void {
  const w = front - 0.2;
  const d = depth - 0.6;
  const n = 2 + level;
  const bay = w / n;
  const z = level >= 2 ? -0.05 : -0.25;
  const dd = level >= 2 ? d * 0.6 : d;
  f.part(box(w, 0.95 + 0.5, dd), PAL.stone, 0, -0.5, z);
  f.part(box(w + 0.1, 0.08, dd + 0.1), PAL.stoneDark, 0, 0.95, z);
  f.part(box(w + 0.06, 0.16, dd + 0.06), PAL.stoneDark, 0, 0, z);
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (k + 0.5) * bay;
    f.part(cylinder(bay * 0.4, bay * 0.4, 0.1, 8), PAL.stoneDark, x, 1.03, z);
    f.part(dome(bay * 0.36, 12), PAL.lead, x, 1.13, z);
    const face = z + dd / 2;
    f.part(arch(bay * 0.72, 0.72, 0.03), PAL.door, x, 0, face + 0.01);
    const awning = box(bay * 0.86, 0.035, 0.42);
    awning.translate(0, 0, 0.21);
    awning.rotateX(0.4);
    const trade = Math.floor(hash2(id, k, 71) * WARES.length);
    f.part(awning, AWNINGS[trade], x, 0.8, face);
    f.part(box(bay * 0.66, 0.26, 0.24), PAL.timber, x, 0, face + 0.2);
    WARES[trade](f, x, face + 0.2);
  }
  if (level >= 2) {
    // The bedesten: a tall stone hall with a dome for each level above the first.
    const bz = z - dd / 2 - 0.45;
    f.part(box(w * 0.8, 1.35 + 0.5, 0.8), PAL.stoneLight, 0, -0.5, bz);
    for (let k = 0; k < level - 1; k++) {
      const x = level === 2 ? 0 : (k - 0.5) * w * 0.4;
      f.part(cylinder(0.36, 0.36, 0.12, 8), PAL.stoneDark, x, 1.35, bz);
      f.part(dome(0.33, 12), PAL.lead, x, 1.47, bz);
    }
  }
}

const AWNINGS = [PAL.awning.firinci, PAL.awning.dokumaci, PAL.awning.demirci];

/**
 * The city's quarry: a rock face cut back in steps, one more step at each level, blocks
 * squared and stacked for the carts, and from the second level a timber crane.
 */
function quarry(f: Frame, front: number, depth: number, level: number, id: number): void {
  const w = front - 0.2;
  const d = depth - 0.2;
  f.part(box(w, 1.2 + 0.4, d * 0.45), PAL.rock, 0, -0.4, -d / 2 + d * 0.225);
  for (let k = 0; k < level; k++) {
    const sw = w * (0.8 - k * 0.2);
    f.part(
      box(sw, 0.9 - k * 0.3 + 0.05, 0.18),
      PAL.siteGround,
      (k - 1) * 0.12,
      0,
      -d / 2 + d * 0.45 + 0.09 - k * 0.18,
    );
  }
  f.part(box(w, 0.04, d * 0.5), PAL.siteGround, 0, 0, d / 4);
  const blocks = 2 + level * 2;
  for (let k = 0; k < blocks; k++) {
    const x = -w / 2 + 0.2 + (k % 4) * 0.3;
    const y = Math.floor(k / 4) * 0.13;
    f.part(box(0.24, 0.13, 0.17), PAL.stoneLight, x, y, d / 2 - 0.3 - (hash2(id, k, 90) < 0.5 ? 0 : 0.2));
  }
  if (level >= 2) {
    // Sheer-legs crane over the face.
    const cx = w / 2 - 0.3;
    for (const s of [-1, 1]) {
      const leg = box(0.04, 1.5, 0.04);
      leg.rotateZ(s * 0.2);
      f.part(leg, PAL.timber, cx + s * 0.15, 0, 0);
    }
    const jib = box(0.04, 0.04, 0.9);
    f.part(jib, PAL.timberDark, cx, 1.45, -0.2);
    f.part(box(0.01, 0.5, 0.01), PAL.ink, cx, 0.95, -0.6);
  }
}

/**
 * A Friday mosque: a square prayer hall under a dome on a drum, a portal on the front and
 * a minaret; a domed portico from the second level and a second minaret at the third.
 */
function mosque(f: Frame, front: number, depth: number, level: number): void {
  const s = Math.min(front, depth) - 0.35;
  const hz = level >= 2 ? -0.2 : 0;
  const hs = level >= 2 ? s - 0.4 : s;
  f.part(box(hs, 1.35 + 0.5, hs), PAL.stone, 0, -0.5, hz);
  f.part(box(hs + 0.08, 0.08, hs + 0.08), PAL.stoneDark, 0, 1.35, hz);
  f.part(cylinder(hs * 0.42, hs * 0.44, 0.28, 8), PAL.stoneDark, 0, 1.35, hz);
  f.part(dome(hs * 0.38 + level * 0.03), PAL.lead, 0, 1.63, hz);
  tackapi(f.sub(0, 0, hz + hs / 2 + 0.05), 0.95, 1.75);
  if (level >= 2) {
    // A portico of three small domes before the door.
    const pz = hz + hs / 2 + 0.35;
    for (const x of [-hs * 0.33, hs * 0.33]) {
      f.part(box(0.08, 0.75, 0.08), PAL.stoneLight, x, 0, pz + 0.2);
      f.part(dome(0.2, 10), PAL.lead, x, 0.85, pz);
    }
    f.part(box(hs, 0.1, 0.5), PAL.stoneDark, 0, 0.75, pz);
  }
  minaret(f, hs / 2 + 0.05, hz - hs / 2 + 0.15, 3.2 + level * 0.3, 0.16);
  if (level >= 3) minaret(f, -hs / 2 - 0.05, hz - hs / 2 + 0.15, 3.6, 0.16);
}

/**
 * A Seljuk caravanserai: high blank walls with buttress towers, a great portal, and an
 * open court for the caravans; from the second level a raised mescit in the court, at the
 * third a vaulted winter hall behind.
 */
function caravanserai(f: Frame, front: number, depth: number, level: number): void {
  const w = front - 0.2;
  const d = depth - 0.2;
  const t = 0.35;
  const h = 1.25;
  f.part(box(w, h + 0.5, t), PAL.stone, 0, -0.5, d / 2 - t / 2);
  f.part(box(w, h + 0.5, t), PAL.stone, 0, -0.5, -d / 2 + t / 2);
  f.part(box(t, h + 0.5, d - 2 * t), PAL.stone, w / 2 - t / 2, -0.5, 0);
  f.part(box(t, h + 0.5, d - 2 * t), PAL.stone, -w / 2 + t / 2, -0.5, 0);
  for (const [x, z] of [
    [w / 2, d / 2],
    [-w / 2, d / 2],
    [w / 2, -d / 2],
    [-w / 2, -d / 2],
    [w / 2, 0],
    [-w / 2, 0],
  ] as const) {
    f.part(cylinder(0.17, 0.2, h + 0.15 + 0.5, 8), PAL.stoneDark, x, -0.5, z);
  }
  f.part(box(w - 2 * t, 0.03, d - 2 * t), PAL.road, 0, 0, 0);
  tackapi(f.sub(0, 0, d / 2 + 0.05), 1.1, 2.0);
  if (level >= 2) {
    // The köşk mescit: a little domed room raised on four arches in the middle of the court.
    for (const [x, z] of [
      [-0.2, -0.2],
      [0.2, -0.2],
      [-0.2, 0.2],
      [0.2, 0.2],
    ] as const) {
      f.part(box(0.08, 0.55, 0.08), PAL.stoneLight, x, 0, z);
    }
    f.part(box(0.5, 0.35, 0.5), PAL.stoneLight, 0, 0.55, 0);
    f.part(dome(0.2, 10), PAL.lead, 0, 0.9, 0);
  }
  if (level >= 3) {
    f.part(box(w - 2 * t, h + 0.25, 0.7), PAL.stone, 0, 0, -d / 2 + t + 0.35);
    for (const x of [-w * 0.2, w * 0.2]) f.part(dome(0.28, 10), PAL.lead, x, h + 0.25, -d / 2 + t + 0.35);
  }
}

/**
 * The granary: long storehouses under pitched roofs with sacks piled at the doors; a
 * second store at the second level, a round grain pit's dome at the third.
 */
function granary(f: Frame, front: number, depth: number, level: number, id: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  const stores = level >= 2 ? 2 : 1;
  for (let k = 0; k < stores; k++) {
    const sz = stores === 1 ? -0.1 : -d / 2 + 0.3 + k * 0.62;
    const sd = stores === 1 ? d * 0.6 : 0.5;
    f.part(box(w, 0.75 + 0.5, sd), PAL.plaster, 0, -0.5, sz);
    const roof = box(w + 0.06, 0.05, sd * 0.62);
    roof.rotateX(0.55);
    f.part(roof, PAL.roofs[2], 0, 0.9, sz + sd * 0.25);
    const back = box(w + 0.06, 0.05, sd * 0.62);
    back.rotateX(-0.55);
    f.part(back, PAL.roofs[2], 0, 0.9, sz - sd * 0.25);
    f.part(arch(0.26, 0.45, 0.03), PAL.door, 0, 0, sz + sd / 2);
  }
  for (let k = 0; k < 4 + level; k++) {
    const x = -w / 2 + 0.15 + (k % 4) * 0.22;
    f.part(
      box(0.16, 0.13, 0.12),
      PAL.bread,
      x,
      Math.floor(k / 4) * 0.13,
      d / 2 - 0.12 - hash2(id, k, 91) * 0.08,
    );
  }
  if (level >= 3) f.part(dome(0.3, 12), PAL.plaster, w / 2 - 0.3, 0, d / 2 - 0.35);
}

/** What each stall sets out: bread, bolts of cloth, iron tools. */
const WARES: Array<(f: Frame, x: number, z: number) => void> = [
  (f, x, z) => {
    for (let k = 0; k < 3; k++) f.part(dome(0.07, 8), PAL.bread, x - 0.18 + k * 0.18, 0.3, z);
  },
  (f, x, z) => {
    for (let k = 0; k < 3; k++) {
      const bolt = cylinder(0.05, 0.05, 0.3, 8);
      bolt.rotateZ(Math.PI / 2);
      bolt.translate(0.15, 0, 0);
      f.part(bolt, PAL.dyes[k], x - 0.15, 0.33 + (k === 1 ? 0.07 : 0), z + (k - 1) * 0.06);
    }
  },
  (f, x, z) => {
    f.part(box(0.16, 0.12, 0.09), PAL.iron, x - 0.1, 0.3, z);
    f.part(box(0.05, 0.04, 0.28), PAL.iron, x + 0.14, 0.3, z);
    f.part(box(0.22, 0.03, 0.05), PAL.ember, x + 0.12, 0.34, z - 0.05);
  },
];

/**
 * A Seljuk medrese: four ranges of cells round an open court with a pool, a domed hall at
 * the back and a tall portal on the front.
 */
function medrese(f: Frame, front: number, depth: number, level: number): void {
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
  // A minaret from the second level; twin minarets over the portal at the third.
  if (level >= 2) minaret(f, w / 2 - 0.25, d / 2 - 0.25, 3.1, 0.15);
  if (level >= 3) minaret(f, -w / 2 + 0.25, d / 2 - 0.25, 3.1, 0.15);
}

/** A darüşşifa: a domed hall on a turquoise drum, two side wards, and a walled garden before it. */
function hospital(f: Frame, front: number, depth: number, id: number, level: number): void {
  const w = front - 0.3;
  const d = depth - 0.3;
  const hall = d * 0.66;
  const z0 = -d / 2 + hall / 2;
  f.part(box(w, 1.1 + 0.5, hall), PAL.plaster, 0, -0.5, z0);
  f.part(box(w + 0.08, 0.08, hall + 0.08), PAL.stoneDark, 0, 1.1, z0);
  f.part(cylinder(0.68, 0.68, 0.32, 12), PAL.turquoise, 0, 1.1, z0);
  f.part(dome(0.62, 16), PAL.lead, 0, 1.42, z0);
  // The side wards get their own domes as the hospital grows.
  if (level >= 2) for (const x of [-w * 0.34, w * 0.34]) f.part(dome(0.34, 12), PAL.plaster, x, 1.1, z0);
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

/**
 * A barracks: a walled block with a crenellated parapet, a gate on the street, square
 * watchtowers flying the red banner (one more at each level), and a tethered horse.
 */
/** Loose rocks over the city's resource sites, so the seam shows before anyone cuts it. */
function siteRocks(city: CityState, batch: PartBatch): void {
  const { grid, terrain } = city;
  for (let i = 0; i < grid.count; i++) {
    if (terrain.site[i] === 0 || city.building[i] >= 0 || city.road[i] === 1) continue;
    const tx = i % grid.size;
    const tz = Math.floor(i / grid.size);
    for (let k = 0; k < 2; k++) {
      if (hash2(tx, tz, 50 + k) < 0.72) continue;
      const x = grid.centre(tx) + (hash2(tx, tz, 52 + k) - 0.5) * 0.7;
      const z = grid.centre(tz) + (hash2(tx, tz, 54 + k) - 0.5) * 0.7;
      const s = 0.08 + hash2(tx, tz, 56 + k) * 0.1;
      const rock = box(s * 1.4, s, s);
      batch
        .frame(x, sampleHeight(terrain, x, z) - 0.03, z, hash2(tx, tz, 58 + k) * Math.PI)
        .part(rock, k === 0 ? PAL.rock : PAL.stoneDark);
    }
  }
}
