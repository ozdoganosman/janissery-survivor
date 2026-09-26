import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { hash2 } from '../core/rng';
import { barracksOf, type Unit } from '../sim/army';
import { UNIT_KINDS, type UnitDef } from '../sim/balance';
import type { CityState } from '../sim/city';
import { axes, companySize, fieldPoint, formationCols, slotOf } from '../sim/field';
import { findPath } from '../sim/paths';
import { sampleHeight } from '../sim/terrain';
import { barracksLayout, type BarracksLayout, type Rect } from './barracks';
import { SoldierCrowd, type Anim, type Soldier } from './soldiers';
import { buildingFrame } from './works-view';

/**
 * The army, man for man: in the barracks and out on the map. In the barracks every company
 * stands on the parade ground in its ranks; those still drilling are at work: spearmen
 * lunge rank after rank, archers loose at the butts, horsemen ride round the ground.
 * Ordered out, a company falls into a column four abreast, marches out of the gate and
 * along the streets and the open country, and draws up in its formation where it was sent;
 * called home, it marches back the same way. Only where each company is bound follows the
 * simulation; the march itself is scenery, and stops when the game is paused.
 */

/** Walking pace of time at each game speed; paused, the drill holds still. */
const PACE = [0, 1, 1.6, 2.2];

/**
 * Seconds between redraws of the men at drill or on the march. Men standing at ease are
 * redrawn a slice at a time along with them, so that each is redrawn a few times a second.
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

/** Men abreast in the barracks' blocks. */
const BLOCK_COLS = 10;

/** Seconds a company takes to turn about, and how far ahead it looks to follow the road. */
const TURN = 1.2;
const LOOK = 0.6;
/** Room left between companies filing through the barracks gate (tiles), and the longest
 * any company waits its turn (seconds). */
const GATE_ROOM = 0.3;
const MAX_WAIT = 60;

/** A company's block on the parade ground, in the barracks' frame. */
interface Block {
  unit: Unit;
  x: number;
  z: number;
  /** How much the ranks are closed up to fit everyone in. */
  f: number;
}

/** Where a company is bound: every man's place in the world and the way he faces there. */
interface Station {
  /** Changes whenever the place does, so a new order is noticed. */
  key: string;
  xs: Float32Array;
  zs: Float32Array;
  headings: Float32Array;
  x: number;
  z: number;
  heading: number;
  /** Front and depth of the company there, for the selection's outline. */
  w: number;
  d: number;
  home: boolean;
}

/** A company's footprint on the ground: centre, facing, front and depth. */
export interface Footprint {
  x: number;
  z: number;
  heading: number;
  w: number;
  d: number;
}

/** A company as the crowd draws it: its men's slots and what it is doing. */
interface Company {
  unit: Unit;
  def: UnitDef;
  /** First soldier of the company in the crowd; its men follow one another. */
  start: number;
  station: Station;
  march: March | null;
  /** Lane of its lap round the ground, for horsemen at drill. */
  lane: number | null;
  rest: Anim;
}

export class ArmyView {
  readonly group = new THREE.Group();
  private crowd: SoldierCrowd | null = null;
  private companies: Company[] = [];
  private readonly byId = new Map<number, Company>();
  /** Where each company was last bound, and the marches under way; kept across rebuilds. */
  private readonly stations = new Map<number, Station>();
  private readonly marches = new Map<number, March>();
  /** Laps of the riders at drill, per soldier. */
  private laps = new Float32Array(0);
  private key = '';
  private frame = { cx: 0, cz: 0, base: 0, rot: 0 };
  private lay: BarracksLayout | null = null;
  private barracksId = -1;
  private readonly sphere = new THREE.Sphere();
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private lastScale = -1;
  private sinceLive = 0;
  private slice = 0;

  constructor(private readonly city: CityState) {
    this.sync();
  }

  /** Men drawn, for the smoke test. */
  get count(): number {
    return this.crowd?.count ?? 0;
  }

  /** Distinct poses in the last redraw, for tuning. */
  get poses(): number {
    return this.crowd?.poses ?? 0;
  }

  /** Companies on the march now. */
  get marching(): number {
    return this.marches.size;
  }

  sync(): boolean {
    const c = this.city;
    const b = barracksOf(c);
    const key = `${c.revision.army}:${c.revision.buildings}:${b?.id ?? 0}:${b?.level ?? 0}`;
    if (key === this.key) return false;
    this.key = key;
    // Where everyone stands now, for those about to set off from there.
    const now = new Map<number, { xs: Float32Array; zs: Float32Array }>();
    if (this.crowd !== null) {
      for (const co of this.companies) {
        const xs = new Float32Array(co.unit.men);
        const zs = new Float32Array(co.unit.men);
        for (let k = 0; k < co.unit.men; k++) {
          const s = this.crowd.soldiers[co.start + k];
          xs[k] = s.x;
          zs[k] = s.z;
        }
        now.set(co.unit.id, { xs, zs });
      }
      this.group.remove(this.crowd.group);
      this.crowd.dispose();
      this.crowd = null;
    }
    this.companies = [];
    this.byId.clear();
    this.lastScale = -1;
    if (b === undefined || b.level === 0 || c.army.units.length === 0) {
      this.stations.clear();
      this.marches.clear();
      this.lay = null;
      return true;
    }
    const { cx, cz, base, rot, front, depth } = buildingFrame(c, b);
    this.frame = { cx, cz, base, rot };
    this.barracksId = b.id;
    const lay = barracksLayout(front, depth, b.level);
    this.lay = lay;
    const targets = lay.targets.map(([tx, tz]) => this.toWorld(tx - 0.05, tz, 0.4));

    // A few companies of horsemen at drill ride round the ground; the rest have their blocks
    // on it, kind by kind, from the back of the ground forwards. Companies out in the field
    // keep their blocks, to come back to.
    const riders: Unit[] = [];
    for (const u of c.army.units) {
      if (u.field === null && isRider(u) && u.drill !== null && riders.length < MAX_LANES) riders.push(u);
    }
    const standing = UNIT_KINDS.flatMap((kind) =>
      c.army.units.filter((u) => u.kind === kind && !riders.includes(u)),
    );
    const edge = 0.3 + riders.length * LANE_WIDTH;
    const inset = (r: Rect, by: number): Rect => ({
      x0: r.x0 + by,
      z0: r.z0 + by,
      x1: r.x1 - by,
      z1: r.z1 - by,
    });
    const blocks = packBlocks(c, standing, [
      inset(lay.yard, edge),
      // Clear of the butts at the far end of the range.
      { ...inset(lay.range, 0.3), x1: lay.range.x1 - 0.7 },
      inset(lay.paddock, 0.3),
    ]);
    const blockOf = new Map(blocks.map((bl) => [bl.unit.id, bl]));

    // Each company's station; a new one sets it marching from where it stands.
    const seen = new Set<number>();
    type Entry = { co: Company; live: boolean };
    const entries: Entry[] = [];
    const fresh: March[] = [];
    for (const u of c.army.units) {
      seen.add(u.id);
      const def = c.balance.army.units[u.kind];
      const lane = riders.indexOf(u);
      const station =
        u.field !== null
          ? this.fieldStation(u, def)
          : lane >= 0
            ? this.lapStation(u, def)
            : this.blockStation(u, def, blockOf.get(u.id)!);
      const before = this.stations.get(u.id);
      let march = this.marches.get(u.id) ?? null;
      if (before !== undefined && before.key !== station.key) {
        const from = now.get(u.id) ?? { xs: before.xs, zs: before.zs };
        // It sets off facing the way it faces now, even if it was on the march.
        const facing = march !== null && !march.done ? march.heading() : before.heading;
        march = this.plan(u, def, from, facing, station);
        this.marches.set(u.id, march);
        if (march.path !== null) fresh.push(march);
      }
      this.stations.set(u.id, station);
      const drilling = u.field === null && u.drill !== null;
      const rest = restAnim(u, lane >= 0);
      const co: Company = { unit: u, def, start: 0, station, march, lane: lane >= 0 ? lane : null, rest };
      entries.push({ co, live: march !== null || lane >= 0 || (drilling && isLive(rest)) });
    }
    for (const id of [...this.stations.keys()]) {
      if (!seen.has(id)) {
        this.stations.delete(id);
        this.marches.delete(id);
      }
    }
    // Companies sent off together march at the pace of the slowest, and so keep together.
    const pace = Math.min(...fresh.map((m) => m.pace));
    for (const m of fresh) m.setSpeed(pace);
    // Through the barracks gate they go one after another, the nearest first.
    // Each waits for the one before to clear the gate: its depth, and a little room.
    const queue = fresh.filter((m) => m.gated).sort((p, q) => p.toGate - q.toGate);
    let wait = 0;
    for (const m of queue) {
      m.t = -Math.min(wait, MAX_WAIT);
      wait += (m.depth + GATE_ROOM) / pace;
    }

    // The men who move come first: they are redrawn every time.
    entries.sort((p, q) => Number(q.live) - Number(p.live));
    const soldiers: Soldier[] = [];
    let live = 0;
    for (const { co, live: isLiveCo } of entries) {
      const u = co.unit;
      co.start = soldiers.length;
      const cols = Math.min(BLOCK_COLS, u.men);
      const shooting = co.rest === 'shoot';
      for (let k = 0; k < u.men; k++) {
        const seed = hash2(u.id, k, 17);
        const rank = Math.floor(k / cols);
        const t = co.lane !== null ? seed * 2 : rankTime(u, rank, seed);
        const s: Soldier = {
          kind: u.kind,
          x: co.station.xs[k],
          y: 0,
          z: co.station.zs[k],
          heading: co.station.headings[k],
          anim: co.rest,
          t,
          aim: shooting ? targets[Math.floor(seed * targets.length) % targets.length] : null,
          seed,
        };
        s.y = this.groundY(s.x, s.z);
        soldiers.push(s);
      }
      if (isLiveCo) live = soldiers.length;
      this.companies.push(co);
      this.byId.set(u.id, co);
    }
    this.laps = new Float32Array(soldiers.length);
    for (const co of this.companies) {
      if (co.lane === null) continue;
      for (let k = 0; k < co.unit.men; k++) this.laps[co.start + k] = (k / co.unit.men + co.lane * 0.13) % 1;
    }
    this.crowd = new SoldierCrowd(soldiers, live);
    this.group.add(this.crowd.group);
    this.fitSphere();
    this.place(0);
    this.crowd.update(1);
    return true;
  }

  /** Moves the drill and the marches on and redraws the men, when they are in sight. */
  update(dt: number, zoom: number, camera: THREE.Camera): void {
    const crowd = this.crowd;
    const pace = PACE[this.city.calendar.speed] ?? 1;
    const step = Math.min(dt, 0.1) * pace;
    // Marches go on whether or not anyone is looking.
    for (const [id, m] of this.marches) {
      m.t += step;
      if (m.done) {
        this.marches.delete(id);
        // Arrived: the company stands at ease and need not be redrawn every frame.
        this.key = '';
      }
    }
    this.group.visible = crowd !== null && zoom < 48;
    if (crowd === null || !this.group.visible) return;
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
    // Everyone who moves, and one slice of the men at ease.
    const still = crowd.count - crowd.live;
    const size = Math.ceil(still / EASE_SLICES);
    this.slice = (this.slice + 1) % EASE_SLICES;
    const from = crowd.live + this.slice * size;
    crowd.update(scale, from, from + size);
  }

  // ---------------------------------------------------------------- for the commander

  /** Where a company is now: the middle of its men and the way it faces. */
  anchor(id: number): { x: number; z: number; heading: number } | null {
    const co = this.byId.get(id);
    const crowd = this.crowd;
    if (co === undefined || crowd === null) return null;
    let x = 0;
    let z = 0;
    for (let k = 0; k < co.unit.men; k++) {
      const s = crowd.soldiers[co.start + k];
      x += s.x;
      z += s.z;
    }
    const n = co.unit.men;
    const heading = co.march !== null && !co.march.done ? co.march.heading() : co.station.heading;
    return { x: x / n, z: z / n, heading };
  }

  /** The company a man standing near a point belongs to, if any. */
  companyAt(x: number, z: number, reach = 0.3): number | null {
    const crowd = this.crowd;
    if (crowd === null) return null;
    let best = reach * reach;
    let found: number | null = null;
    for (const co of this.companies) {
      for (let k = 0; k < co.unit.men; k++) {
        const s = crowd.soldiers[co.start + k];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < best) {
          best = d;
          found = co.unit.id;
        }
      }
    }
    return found;
  }

  /** The ground a company covers now, square to the way it faces. */
  footprint(id: number): Footprint | null {
    const co = this.byId.get(id);
    const crowd = this.crowd;
    const at = this.anchor(id);
    if (co === undefined || crowd === null || at === null) return null;
    const a = axes(at.heading);
    let r0 = Infinity;
    let r1 = -Infinity;
    let f0 = Infinity;
    let f1 = -Infinity;
    for (let k = 0; k < co.unit.men; k++) {
      const s = crowd.soldiers[co.start + k];
      const r = (s.x - at.x) * a.rx + (s.z - at.z) * a.rz;
      const f = (s.x - at.x) * a.fx + (s.z - at.z) * a.fz;
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
      f0 = Math.min(f0, f);
      f1 = Math.max(f1, f);
    }
    const pad = 0.12;
    return {
      x: at.x + a.rx * (r0 + r1) * 0.5 + a.fx * (f0 + f1) * 0.5,
      z: at.z + a.rz * (r0 + r1) * 0.5 + a.fz * (f0 + f1) * 0.5,
      heading: at.heading,
      w: r1 - r0 + pad * 2,
      d: f1 - f0 + pad * 2,
    };
  }

  /** Where a company on the march is bound, or null if it is not marching. */
  destination(id: number): Footprint | null {
    const co = this.byId.get(id);
    if (co === undefined || co.march === null || co.march.done) return null;
    const st = co.station;
    return { x: st.x, z: st.z, heading: st.heading, w: st.w + 0.24, d: st.d + 0.24 };
  }

  /** Every company's id, in the barracks and out. */
  ids(): number[] {
    return this.companies.map((co) => co.unit.id);
  }

  // ---------------------------------------------------------------- stations

  private blockStation(u: Unit, def: UnitDef, bl: Block): Station {
    const cols = Math.min(BLOCK_COLS, u.men);
    const shooting = u.drill !== null && u.kind === 'okcu';
    const { rot } = this.frame;
    const heading = (shooting ? Math.PI / 2 : 0) + rot;
    const xs = new Float32Array(u.men);
    const zs = new Float32Array(u.men);
    const headings = new Float32Array(u.men).fill(heading);
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < u.men; k++) {
      const seed = hash2(u.id, k, 17);
      const lx = bl.x + ((k % cols) + 0.5) * def.file * bl.f + (seed - 0.5) * 0.02 * bl.f;
      const lz = bl.z + (Math.floor(k / cols) + 0.5) * def.rank * bl.f;
      const w = this.toWorld(lx, lz, 0);
      xs[k] = w.x;
      zs[k] = w.z;
      sx += w.x;
      sz += w.z;
    }
    const size = companySize(def, u.men, cols);
    return {
      key: `b:${bl.x.toFixed(3)}:${bl.z.toFixed(3)}:${bl.f.toFixed(3)}:${heading.toFixed(3)}`,
      xs,
      zs,
      headings,
      x: sx / u.men,
      z: sz / u.men,
      heading: rot,
      w: size.w * bl.f,
      d: size.d * bl.f,
      home: true,
    };
  }

  /** Riders at drill: their station is the start of their lap; the lap moves them on. */
  private lapStation(u: Unit, def: UnitDef): Station {
    const xs = new Float32Array(u.men);
    const zs = new Float32Array(u.men);
    const headings = new Float32Array(u.men);
    const c = this.lay!.circuit;
    const w = this.toWorld((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, 0);
    xs.fill(w.x);
    zs.fill(w.z);
    headings.fill(this.frame.rot);
    const size = companySize(def, u.men, BLOCK_COLS);
    return { key: 'lap', xs, zs, headings, x: w.x, z: w.z, heading: this.frame.rot, ...size, home: true };
  }

  private fieldStation(u: Unit, def: UnitDef): Station {
    const post = u.field!;
    const cols = formationCols(this.city, post.formation, u.men);
    const xs = new Float32Array(u.men);
    const zs = new Float32Array(u.men);
    const headings = new Float32Array(u.men).fill(post.heading);
    for (let k = 0; k < u.men; k++) {
      const [r, f] = slotOf(def, u.men, cols, k);
      const seed = hash2(u.id, k, 17);
      const [x, z] = fieldPoint(post, r + (seed - 0.5) * 0.02, f);
      xs[k] = x;
      zs[k] = z;
    }
    const size = companySize(def, u.men, cols);
    return {
      key: `f:${post.x.toFixed(3)}:${post.z.toFixed(3)}:${post.heading.toFixed(3)}:${post.formation}`,
      xs,
      zs,
      headings,
      x: post.x,
      z: post.z,
      heading: post.heading,
      ...size,
      home: false,
    };
  }

  /**
   * The march from where the men stand to a new station: out of the gate and along the way
   * the land allows, or just across the parade ground from one block to another.
   */
  private plan(
    u: Unit,
    def: UnitDef,
    from: { xs: Float32Array; zs: Float32Array },
    facing: number,
    to: Station,
  ): March {
    let fx = 0;
    let fz = 0;
    for (let k = 0; k < u.men; k++) {
      fx += from.xs[k];
      fz += from.zs[k];
    }
    fx /= u.men;
    fz /= u.men;
    // Home is where it stands, not where it was last bound: a company halted on its way
    // back is out in the field.
    const fromHome = this.inBarracks(fx, fz);
    if (fromHome && to.home) return new March(def, u.men, from, facing, to, null, def.march);
    const lay = this.lay!;
    const gateIn = this.toWorld(0, lay.wall.z1 - 0.8, 0);
    const gateOut = this.toWorld(0, lay.wall.z1 + 1.4, 0);
    const way = (a: [number, number], b: [number, number]): Array<[number, number]> =>
      findPath(this.city, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) ?? [a, b];
    let pts: Array<[number, number]>;
    let toGate = 0;
    if (fromHome) {
      pts = [[fx, fz], [gateIn.x, gateIn.z], ...way([gateOut.x, gateOut.z], [to.x, to.z])];
      toGate = Math.hypot(gateIn.x - fx, gateIn.z - fz);
    } else if (to.home) {
      const out = way([fx, fz], [gateOut.x, gateOut.z]);
      pts = [...out, [gateIn.x, gateIn.z], [to.x, to.z]];
      toGate = new Path(out).length;
    } else {
      pts = way([fx, fz], [to.x, to.z]);
    }
    const m = new March(def, u.men, from, facing, to, new Path(pts), def.march);
    m.gated = fromHome || to.home;
    m.toGate = toGate;
    return m;
  }

  /** Whether a point is on the barracks' own ground. */
  private inBarracks(x: number, z: number): boolean {
    const { grid } = this.city;
    const tx = grid.tileOf(x);
    const tz = grid.tileOf(z);
    return grid.inBounds(tx, tz) && this.city.building[grid.index(tx, tz)] === this.barracksId;
  }

  // ---------------------------------------------------------------- drawing

  /** Sets every man who moves where his march or his lap has brought him. */
  private place(step: number): void {
    const crowd = this.crowd;
    if (crowd === null) return;
    const { rot } = this.frame;
    const circuit = this.lay?.circuit;
    const out = { x: 0, z: 0, heading: 0, anim: 'idle' as Anim };
    for (const co of this.companies) {
      if (co.start >= crowd.live) continue;
      const m = co.march;
      for (let k = 0; k < co.unit.men; k++) {
        const i = co.start + k;
        const s = crowd.soldiers[i];
        if (m !== null) {
          m.at(k, co.station, co.rest, out);
          s.x = out.x;
          s.z = out.z;
          s.heading = out.heading;
          s.anim = out.anim;
          s.y = this.groundY(s.x, s.z);
        } else if (co.lane !== null && circuit !== undefined) {
          // Round the parade ground at a canter, each company in its own lane.
          this.laps[i] = (this.laps[i] + Math.min(step, 0.1) * 0.035) % 1;
          const [lx, lz, dir] = aroundRect(circuit, co.lane * LANE_WIDTH, this.laps[i]);
          const w = this.toWorld(lx, lz, 0);
          s.x = w.x;
          s.z = w.z;
          s.y = this.groundY(s.x, s.z);
          s.heading = dir + rot;
        }
      }
    }
  }

  /** The ground a man stands on: the compound's floor within the barracks, else the land. */
  private groundY(x: number, z: number): number {
    const h = sampleHeight(this.city.terrain, x, z);
    return (this.inBarracks(x, z) ? Math.max(this.frame.base, h) : h) + 0.045;
  }

  /** A sphere round the barracks and everywhere the army stands or marches, for culling. */
  private fitSphere(): void {
    const box = new THREE.Box3();
    const { cx, cz, base } = this.frame;
    box.expandByPoint(new THREE.Vector3(cx - 14, base, cz - 14));
    box.expandByPoint(new THREE.Vector3(cx + 14, base + 2, cz + 14));
    for (const co of this.companies) {
      box.expandByPoint(new THREE.Vector3(co.station.x, base, co.station.z));
      co.march?.path?.points.forEach(([x, z]) => box.expandByPoint(new THREE.Vector3(x, base, z)));
    }
    box.getBoundingSphere(this.sphere);
    this.sphere.radius += 4;
  }

  private toWorld(lx: number, lz: number, y: number): THREE.Vector3 {
    const { cx, cz, base, rot } = this.frame;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return new THREE.Vector3(cx + lx * c + lz * s, base + y, cz - lx * s + lz * c);
  }
}

// ------------------------------------------------------------------ marching

/** A polyline with its length measured, walked by distance. */
class Path {
  readonly lengths: number[] = [0];

  constructor(readonly points: Array<[number, number]>) {
    const pts = points.filter(
      (p, k) => k === 0 || Math.hypot(p[0] - points[k - 1][0], p[1] - points[k - 1][1]) > 1e-3,
    );
    if (pts.length < 2) pts.push([pts[0][0] + 1e-3, pts[0][1]]);
    this.points = pts;
    for (let k = 1; k < pts.length; k++) {
      this.lengths.push(
        this.lengths[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]),
      );
    }
  }

  get length(): number {
    return this.lengths[this.lengths.length - 1];
  }

  /**
   * The point `d` along the way and the heading there. Before the start and past the end
   * the way runs on straight, so a column can stretch out behind and beyond it.
   */
  at(d: number, out: { x: number; z: number; heading: number }): void {
    const pts = this.points;
    const L = this.lengths;
    let k = 1;
    if (d >= L[L.length - 1]) k = pts.length - 1;
    else if (d > 0) {
      let lo = 1;
      let hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (L[mid] < d) lo = mid + 1;
        else hi = mid;
      }
      k = lo;
    }
    const [ax, az] = pts[k - 1];
    const [bx, bz] = pts[k];
    const len = L[k] - L[k - 1];
    const u = (d - L[k - 1]) / len;
    out.x = ax + (bx - ax) * u;
    out.z = az + (bz - az) * u;
    out.heading = Math.atan2(bx - ax, bz - az);
  }
}

/**
 * One company's march, as a body: it turns to face the way and takes the shape of its new
 * formation while it does, marches along the way in its ranks, turning with the road, and
 * at the end turns to face where it was told to. Between blocks of the same parade ground
 * it simply crosses over.
 */
class March {
  t = 0;
  /** It goes through the barracks gate, and how far it has to go to reach it. */
  gated = false;
  toGate = 0;

  /** How deep the company is on the march, front to back. */
  get depth(): number {
    return this.to.d;
  }
  private speed = 1;
  private turnOut = TURN;
  private marchTime = 0;
  private readonly fromX: number;
  private readonly fromZ: number;
  /** Each man's place about the company's middle, before and after: [right, forward]. */
  private readonly startOff: Float32Array;
  private readonly endOff: Float32Array;
  private readonly p = { x: 0, z: 0, heading: 0 };
  private readonly q = { x: 0, z: 0, heading: 0 };

  constructor(
    private readonly def: UnitDef,
    private readonly men: number,
    private readonly from: { xs: Float32Array; zs: Float32Array },
    private readonly fromHeading: number,
    private readonly to: Station,
    readonly path: Path | null,
    /** Its own marching pace, before it is matched to its fellows'. */
    readonly pace: number,
  ) {
    let fx = 0;
    let fz = 0;
    for (let k = 0; k < men; k++) {
      fx += from.xs[k];
      fz += from.zs[k];
    }
    this.fromX = fx / men;
    this.fromZ = fz / men;
    this.startOff = new Float32Array(men * 2);
    this.endOff = new Float32Array(men * 2);
    const a = axes(fromHeading);
    const b = axes(to.heading);
    for (let k = 0; k < men; k++) {
      const dx = from.xs[k] - this.fromX;
      const dz = from.zs[k] - this.fromZ;
      this.startOff[k * 2] = dx * a.rx + dz * a.rz;
      this.startOff[k * 2 + 1] = dx * a.fx + dz * a.fz;
      const ex = to.xs[k] - to.x;
      const ez = to.zs[k] - to.z;
      this.endOff[k * 2] = ex * b.rx + ez * b.rz;
      this.endOff[k * 2 + 1] = ex * b.fx + ez * b.fz;
    }
    this.setSpeed(pace);
  }

  /** Marches at `speed` tiles a second: companies sent together keep together. */
  setSpeed(speed: number): void {
    this.speed = speed;
    if (this.path !== null) {
      // A big turn takes longer than a small one.
      this.tangent(0, this.p);
      const turn = Math.abs(angleBetween(this.fromHeading, this.p.heading));
      this.turnOut = TURN * (0.5 + turn / Math.PI);
      this.marchTime = this.path.length / speed;
    } else {
      // Across the parade ground: as long as the furthest man takes at a walk.
      let far = 0;
      for (let k = 0; k < this.men; k++) {
        far = Math.max(far, Math.hypot(this.to.xs[k] - this.from.xs[k], this.to.zs[k] - this.from.zs[k]));
      }
      this.marchTime = Math.max(0.6, far / (speed * 0.7));
    }
  }

  get done(): boolean {
    return this.path === null ? this.t >= this.marchTime : this.t >= this.turnOut + this.marchTime + TURN;
  }

  /** The way the company faces now. */
  heading(): number {
    this.pose();
    return this.q.heading;
  }

  /**
   * Where the company's middle is now and the way it faces, in `q`; returns how far its
   * men have taken their new places (0..1) and whether it is on the move.
   */
  private pose(): { shape: number; moving: boolean } {
    const path = this.path!;
    const t = this.t;
    const q = this.q;
    if (t < this.turnOut) {
      const e = ease01(t / this.turnOut);
      this.tangent(0, this.p);
      q.x = this.fromX + (path.points[0][0] - this.fromX) * e;
      q.z = this.fromZ + (path.points[0][1] - this.fromZ) * e;
      q.heading = lerpAngle(this.fromHeading, this.p.heading, e);
      return { shape: e, moving: true };
    }
    if (t < this.turnOut + this.marchTime) {
      const s = (t - this.turnOut) * this.speed;
      path.at(s, q);
      this.tangent(s, this.p);
      q.heading = this.p.heading;
      return { shape: 1, moving: true };
    }
    const e = ease01((t - this.turnOut - this.marchTime) / TURN);
    this.tangent(path.length, this.p);
    q.x = this.to.x;
    q.z = this.to.z;
    q.heading = lerpAngle(this.p.heading, this.to.heading, e);
    return { shape: 1, moving: e < 1 };
  }

  /** The way along the road at `s`, looking a little ahead and behind so turns are gentle. */
  private tangent(s: number, out: { x: number; z: number; heading: number }): void {
    const path = this.path!;
    path.at(Math.max(0, s - LOOK), this.p);
    const ax = this.p.x;
    const az = this.p.z;
    path.at(Math.min(path.length, s + LOOK), this.p);
    const dx = this.p.x - ax;
    const dz = this.p.z - az;
    out.heading = Math.hypot(dx, dz) > 1e-4 ? Math.atan2(dx, dz) : this.to.heading;
  }

  /** Where man `k` is now, the way he faces and what he is doing. */
  at(k: number, st: Station, rest: Anim, out: { x: number; z: number; heading: number; anim: Anim }): void {
    const horse = this.def.horse;
    const walk: Anim = horse ? 'ride' : 'march';
    if (this.path === null) {
      const e = ease01(this.t / this.marchTime);
      const fx = this.from.xs[k];
      const fz = this.from.zs[k];
      const tx = st.xs[k];
      const tz = st.zs[k];
      out.x = fx + (tx - fx) * e;
      out.z = fz + (tz - fz) * e;
      const moving = Math.hypot(tx - fx, tz - fz) > 0.02 && e < 1;
      const dir = moving ? Math.atan2(tx - fx, tz - fz) : st.headings[k];
      out.heading = lerpAngle(dir, st.headings[k], smoothstep(0.6, 1, e));
      out.anim = moving ? walk : rest;
      return;
    }
    if (this.t < 0) {
      // Waiting its turn at the gate.
      out.x = this.from.xs[k];
      out.z = this.from.zs[k];
      out.heading = this.fromHeading;
      out.anim = horse ? 'stand' : 'idle';
      return;
    }
    const { shape, moving } = this.pose();
    const q = this.q;
    const r = this.startOff[k * 2] + (this.endOff[k * 2] - this.startOff[k * 2]) * shape;
    const f = this.startOff[k * 2 + 1] + (this.endOff[k * 2 + 1] - this.startOff[k * 2 + 1]) * shape;
    const a = axes(q.heading);
    out.x = q.x + a.rx * r + a.fx * f;
    out.z = q.z + a.rz * r + a.fz * f;
    out.heading = q.heading;
    const marching = this.t >= this.turnOut && this.t < this.turnOut + this.marchTime;
    out.anim = !moving ? rest : marching && horse && this.speed >= 1.5 ? 'gallop' : walk;
  }
}

const ease01 = (x: number): number => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** The smaller turn from heading `a` to heading `b`, signed. */
function angleBetween(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + angleBetween(a, b) * t;
}

// ------------------------------------------------------------------ the parade ground

/** Drill goes in waves down the ranks; men standing at ease fidget on their own time. */
function rankTime(u: Unit, rank: number, seed: number): number {
  return u.drill !== null && u.field === null ? rank * 0.12 + seed * 0.05 : seed * 20;
}

/** The animations that move enough to be redrawn every frame. */
function isLive(anim: Anim): boolean {
  return anim !== 'idle' && anim !== 'stand';
}

function isRider(u: Unit): boolean {
  return u.kind === 'atli_okcu' || u.kind === 'gulam';
}

/** What a company does where it stands: its drill, or standing at ease. */
function restAnim(u: Unit, riding: boolean): Anim {
  const drilling = u.drill !== null && u.field === null;
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
 * Lays the companies out in rows, each in its block of ranks: across the parade ground
 * first, then on the open ground of the range and the paddock. When they do not all fit,
 * the ranks close up, down to under half their room; a barracks fuller still crowds its
 * last companies onto the parade ground rather than out of the gate.
 */
function packBlocks(city: CityState, units: Unit[], areas: Rect[]): Block[] {
  const gap = 0.3;
  const size = (u: Unit, f: number): [number, number] => {
    const def = city.balance.army.units[u.kind];
    const s = companySize(def, u.men, BLOCK_COLS);
    return [s.w * f, s.d * f];
  };
  /** The blocks that fit at closeness `f`, and whether everyone did. */
  const lay = (f: number): { blocks: Block[]; all: boolean } => {
    const blocks: Block[] = [];
    let k = 0;
    for (const a of areas) {
      let x = a.x0;
      let z = a.z0;
      let rowDepth = 0;
      while (k < units.length) {
        const [w, d] = size(units[k], f);
        if (x + w > a.x1 + 1e-6 && x > a.x0) {
          x = a.x0;
          z += rowDepth + gap * f;
          rowDepth = 0;
        }
        if (x + w > a.x1 + 1e-6 || z + d > a.z1 + 1e-6) break;
        blocks.push({ unit: units[k++], x, z, f });
        x += w + gap * f;
        rowDepth = Math.max(rowDepth, d);
      }
    }
    return { blocks, all: k === units.length };
  };
  let f = 1;
  let out = lay(f);
  while (!out.all && f > 0.45) {
    f *= 0.95;
    out = lay(f);
  }
  if (out.all) return out.blocks;
  // Still too many: the rest stand wherever there is ground in the yard, in among the others.
  const yard = areas[0];
  for (let k = out.blocks.length; k < units.length; k++) {
    const [w, d] = size(units[k], f);
    out.blocks.push({
      unit: units[k],
      x: yard.x0 + Math.max(0, yard.x1 - yard.x0 - w) * hash2(units[k].id, k, 29),
      z: yard.z0 + Math.max(0, yard.z1 - yard.z0 - d) * hash2(units[k].id, k, 31),
      f,
    });
  }
  return out.blocks;
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
