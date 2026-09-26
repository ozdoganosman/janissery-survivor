import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { createRng, hash2, type Rng } from '../core/rng';
import { FACING_DIRS } from '../sim/buildings';
import { dateOf } from '../sim/calendar';
import type { CityState } from '../sim/city';
import { sampleHeight } from '../sim/terrain';
import { faceNearestRoad } from './buildings-view';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS } from './palette';
import {
  advanceWalk,
  buildWalkNetwork,
  reweigh,
  spawnWalk,
  walkPoint,
  type Walk,
  type WalkNetwork,
} from './walk-network';

/**
 * The townspeople. Nothing here touches the simulation: the figures only show what it
 * says. Their number follows the population; they walk the streets, crowd the bazaar,
 * fetch water, gather at the mosque doors, work the fields in season and mind the flocks.
 */

type Part =
  | 'robe'
  | 'head'
  | 'turban'
  | 'cap'
  | 'scarf'
  | 'jug'
  | 'sack'
  | 'staff'
  | 'donkey'
  | 'pack'
  | 'helmet'
  | 'spear'
  | 'shield'
  | 'horse'
  | 'furcap';
type Mode = 'walk' | 'stand' | 'work';

interface Figure {
  parts: Part[];
  colors: Partial<Record<Part, string>>;
  mode: Mode;
  /** For walkers: where on the streets, and which side of the street they keep to. */
  walk: Walk | null;
  lane: number;
  speed: number;
  /** Seconds before a walker goes indoors, and 0..1 how far it has come out. */
  life: number;
  fade: number;
  /** A pack animal follows its driver. */
  leader: Figure | null;
  heading: number;
  /** Drawn position, eased towards the path so turns at junctions stay smooth. */
  x: number;
  z: number;
  y: number;
  phase: number;
  small: boolean;
  /** Raised off the ground: a rider in the saddle. */
  lift: number;
  /** A soldier walking the rounds; patrols follow the barracks, not the population. */
  patrol: boolean;
}

const ROBES = [
  '#2f4f9a',
  '#b8322a',
  '#3f7a4a',
  '#c98b4a',
  '#f3ead6',
  '#6b4a8a',
  '#d58a4e',
  '#8a5a36',
  '#2db6b1',
];
const SKIN = ['#e8c19a', '#d9a878', '#c18a5e'];
const TURBANS = ['#f8f3e6', '#f8f3e6', '#efe2c2', '#3f7a4a'];
const CAPS = ['#f3ead6', '#b8322a'];
const SCARVES = ['#f3ead6', '#b8322a', '#2f4f9a', '#6b4a8a', '#e0b13a'];
const DONKEYS = ['#8c8479', '#7a5c44', '#a39a8c'];
const PACKS = ['#c9a071', '#a8834f'];
const SOLDIER_ROBES = ['#8c2a1c', '#a8261c', '#2f4f9a', '#6b2f1c'];
const SHIELDS = ['#b8322a', '#c98b4a', '#2f4f9a', '#e0b13a'];
const HORSES = ['#7a5238', '#5e3b22', '#a67c52', '#e8dcc4', '#3b2c24'];
/** Caravan merchants from the east: dark quilted coats and fur-trimmed caps. */
const RIDER_ROBES = ['#3b4a5e', '#5e3b22', '#4a5a3a', '#6b4a8a'];
const FURS = ['#6b4a2a', '#8a6a44', '#4a3222'];

/** Walking pace in tiles a second at each game speed; paused, the town holds still. */
const PACE = [0, 1, 1.6, 2.2];
const MAX_WALKERS = 480;
const MAX_PATROLS = 40;
const MAX_SENTRIES = 48;
/** Saddle height of a rider, in figure units. */
const SADDLE = 0.17;

function geometries(): Record<Part, THREE.BufferGeometry> {
  const donkey = mergeParts([
    new THREE.BoxGeometry(0.075, 0.08, 0.2).translate(0, 0.13, 0),
    new THREE.BoxGeometry(0.045, 0.075, 0.075).translate(0, 0.19, 0.125),
    new THREE.BoxGeometry(0.015, 0.035, 0.012).translate(-0.013, 0.24, 0.12),
    new THREE.BoxGeometry(0.015, 0.035, 0.012).translate(0.013, 0.24, 0.12),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => new THREE.BoxGeometry(0.02, 0.1, 0.02).translate(sx * 0.025, 0.05, sz * 0.07)),
    ),
  ]);
  const pack = mergeParts([
    new THREE.BoxGeometry(0.045, 0.06, 0.1).translate(-0.058, 0.155, -0.01),
    new THREE.BoxGeometry(0.045, 0.06, 0.1).translate(0.058, 0.155, -0.01),
  ]);
  const spear = mergeParts([
    new THREE.CylinderGeometry(0.005, 0.005, 0.44, 4).translate(0.06, 0.22, 0.02),
    new THREE.ConeGeometry(0.012, 0.05, 4).translate(0.06, 0.465, 0.02),
  ]);
  const horse = mergeParts([
    new THREE.BoxGeometry(0.1, 0.1, 0.28).translate(0, 0.2, 0),
    new THREE.BoxGeometry(0.055, 0.13, 0.07).rotateX(0.5).translate(0, 0.28, 0.14),
    new THREE.BoxGeometry(0.05, 0.05, 0.11).translate(0, 0.335, 0.2),
    new THREE.BoxGeometry(0.02, 0.12, 0.025).rotateX(-0.5).translate(0, 0.19, -0.16),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => new THREE.BoxGeometry(0.025, 0.16, 0.025).translate(sx * 0.032, 0.08, sz * 0.1)),
    ),
  ]);
  const furcap = mergeParts([
    new THREE.CylinderGeometry(0.052, 0.052, 0.022, 8).translate(0, 0.25, 0),
    new THREE.SphereGeometry(0.036, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 1.5, 1)
      .translate(0, 0.258, 0),
  ]);
  return {
    robe: new THREE.CylinderGeometry(0.034, 0.07, 0.19, 7).translate(0, 0.095, 0),
    head: new THREE.SphereGeometry(0.036, 8, 6).translate(0, 0.225, 0),
    turban: new THREE.SphereGeometry(0.047, 8, 5).scale(1, 0.72, 1).translate(0, 0.255, 0),
    cap: new THREE.ConeGeometry(0.032, 0.085, 7).translate(0, 0.292, 0),
    scarf: new THREE.SphereGeometry(0.047, 8, 6).scale(1, 1.18, 1).translate(0, 0.228, -0.006),
    jug: new THREE.CylinderGeometry(0.018, 0.024, 0.055, 6).translate(0.052, 0.215, 0),
    sack: new THREE.BoxGeometry(0.06, 0.07, 0.05).translate(0, 0.17, -0.06),
    staff: new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4).translate(0.06, 0.17, 0.03),
    donkey,
    pack,
    helmet: new THREE.ConeGeometry(0.04, 0.085, 8).translate(0, 0.285, 0),
    spear,
    shield: new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10)
      .rotateZ(Math.PI / 2)
      .translate(-0.07, 0.13, 0.01),
    horse,
    furcap,
  };
}

function mergeParts(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of list) {
    const n = g.index !== null ? g.toNonIndexed() : g;
    pos.push(...(n.getAttribute('position').array as Float32Array));
    nor.push(...(n.getAttribute('normal').array as Float32Array));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export class PeopleView {
  readonly group = new THREE.Group();
  private readonly geoms = geometries();
  private meshes = new Map<Part, THREE.InstancedMesh>();
  /** For each part, where each figure sits in that part's instance list. */
  private slotOf = new Map<Part, Int32Array>();
  private figures: Figure[] = [];
  private net: WalkNetwork | null = null;
  private netKey = '';
  private weightKey = '';
  private placesKey = '';
  private readonly rng: Rng;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sv = new THREE.Vector3();

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.building);
    this.rng = createRng(city.def.seed * 31 + 7);
    this.sync();
  }

  /** How many figures are out, for the smoke test. */
  get count(): number {
    return this.figures.length;
  }

  /** How many horsemen are in the saddle, for the smoke test. */
  get riders(): number {
    return this.figures.filter((f) => f.lift > 0).length;
  }

  /** Rebuilds the streets and the gathering places when the city they depend on changes. */
  sync(): boolean {
    const c = this.city;
    const r = c.revision;
    // Streets change rarely and reset the walkers; how busy each street is changes as
    // the town grows and only reweighs where new walkers come out.
    const netKey = String(r.roads);
    const weightKey = `${Math.floor(r.houses / 8)}:${r.buildings}`;
    const month = dateOf(c.calendar).month;
    const placesKey = `${r.buildings}:${r.fields}:${r.walls}:${month}:${Math.round(c.population / 200)}`;
    if (netKey === this.netKey && weightKey === this.weightKey && placesKey === this.placesKey) return false;
    const newNet = netKey !== this.netKey;
    if (newNet) this.net = buildWalkNetwork(c, busyness(c));
    else if (weightKey !== this.weightKey && this.net !== null) reweigh(this.net, busyness(c));
    const replace = newNet || placesKey !== this.placesKey;
    this.netKey = netKey;
    this.weightKey = weightKey;
    this.placesKey = placesKey;
    if (!replace) return false;
    // Walkers keep walking unless their streets changed; the rest are laid out afresh.
    this.figures = newNet
      ? []
      : this.figures.filter((f) => f.mode === 'walk' && !f.patrol && !f.leader?.patrol);
    this.fillWalkers();
    this.placePatrols();
    this.placeGatherings();
    this.placeGarrison();
    this.placeFieldHands(month);
    this.buildMeshes();
    return true;
  }

  /** Moves and redraws every figure. `zoom` is the camera's, for size and visibility. */
  update(dt: number, zoom: number): void {
    this.group.visible = zoom < 48 && this.figures.length > 0;
    if (!this.group.visible) return;
    const pace = PACE[this.city.calendar.speed] ?? 1;
    const step = Math.min(dt, 0.1) * pace;
    const net = this.net;
    // Miniatures draw people larger than life; more so from further off, so they still read.
    const scale = 1 + 0.75 * smoothstep(10, 34, zoom);
    const ease = 1 - Math.exp(-step * 10);
    this.figures.forEach((f, k) => {
      if (f.mode === 'walk' && net !== null && f.walk !== null) {
        if (f.leader === null) {
          f.life -= step;
          if (f.life <= 0) {
            f.fade -= step * 2;
            if (f.fade <= 0) this.respawn(f);
          } else if (f.fade < 1) {
            f.fade = Math.min(1, f.fade + step * 2);
          }
          advanceWalk(net, f.walk, f.speed * step, this.rng);
        } else {
          // A pack animal keeps a little behind its driver.
          const lead = f.leader.walk;
          if (lead !== null) {
            f.walk.edge = lead.edge;
            f.walk.dir = lead.dir;
            f.walk.s = lead.s - lead.dir * 0.2;
            f.fade = f.leader.fade;
          }
        }
        const [px, pz, dx, dz] = walkPoint(net, f.walk);
        // Keep to one side of the street: offset to the right of the way walked.
        const tx = px - dz * f.lane;
        const tz = pz + dx * f.lane;
        f.x += (tx - f.x) * ease;
        f.z += (tz - f.z) * ease;
        const want = Math.atan2(dx, dz);
        f.heading += angleStep(f.heading, want) * Math.min(1, ease * 1.5);
        f.y = streetHeight(this.city, f.x, f.z);
        f.phase += step * f.speed * 22;
      } else {
        f.phase += step * 3;
      }
      this.write(k, f, scale);
    });
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  private write(k: number, f: Figure, scale: number): void {
    let bob = 0;
    let bend = 0;
    let turn = f.heading;
    if (f.mode === 'walk') {
      bob = Math.abs(Math.sin(f.phase)) * 0.012;
    } else if (f.mode === 'work') {
      // Hoeing: a slow rhythm of bending to the ground and straightening.
      bend = 0.35 + 0.3 * Math.sin(f.phase * 1.6);
    } else {
      // Standing about: turning to one neighbour, then another. Still when the town is paused.
      turn += Math.sin(f.phase * 0.13) * 0.35;
    }
    const s = scale * (f.small ? 0.78 : 1) * (f.mode === 'walk' ? f.fade : 1);
    this.e.set(bend, turn, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.v.set(f.x, f.y + bob + f.lift * s, f.z);
    this.sv.set(s, s, s);
    this.m.compose(this.v, this.q, this.sv);
    for (const part of f.parts) {
      const slot = this.slotOf.get(part)?.[k];
      const mesh = this.meshes.get(part);
      if (slot === undefined || slot < 0 || mesh === undefined) continue;
      mesh.setMatrixAt(slot, this.m);
    }
  }

  private buildMeshes(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
    this.slotOf.clear();
    const owners = new Map<Part, number[]>();
    this.figures.forEach((f, k) => {
      for (const p of f.parts) {
        const list = owners.get(p) ?? [];
        list.push(k);
        owners.set(p, list);
      }
    });
    const color = new THREE.Color();
    for (const [part, list] of owners) {
      const mesh = new THREE.InstancedMesh(this.geoms[part], miniMaterial(), list.length);
      const slots = new Int32Array(this.figures.length).fill(-1);
      list.forEach((k, slot) => {
        slots[k] = slot;
        mesh.setColorAt(slot, color.set(this.figures[k].colors[part] ?? '#ffffff'));
      });
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.set(part, mesh);
      this.slotOf.set(part, slots);
    }
    // Draw everyone once at their spot, so a paused town is not empty.
    this.figures.forEach((f, k) => {
      if (f.mode === 'walk' && this.net !== null && f.walk !== null) {
        const [px, pz, dx, dz] = walkPoint(this.net, f.walk);
        f.x = px - dz * f.lane;
        f.z = pz + dx * f.lane;
        f.heading = Math.atan2(dx, dz);
        f.y = streetHeight(this.city, f.x, f.z);
      }
      this.write(k, f, 1);
    });
  }

  // ---------------------------------------------------------------- who is out

  private fillWalkers(): void {
    const net = this.net;
    if (net === null || net.edges.length === 0) return;
    const want = Math.min(MAX_WALKERS, Math.max(40, Math.round(this.city.population / 9)));
    let have = this.figures.filter((f) => f.leader === null && !f.patrol).length;
    while (have < want) {
      const f = this.person('walk');
      f.walk = spawnWalk(net, this.rng);
      f.fade = 1;
      f.life = 5 + this.rng.next() * 40;
      this.figures.push(f);
      have++;
      // Now and then a traveller leads a laden donkey.
      if (this.rng.chance(0.07)) {
        const d = this.animal();
        d.leader = f;
        d.walk = f.walk === null ? null : { ...f.walk };
        d.lane = f.lane;
        this.figures.push(d);
      }
    }
    if (have > want) {
      let drop = have - want;
      this.figures = this.figures.filter((f) => {
        if (drop > 0 && f.leader === null && f.mode === 'walk' && !f.patrol) {
          drop--;
          return false;
        }
        return true;
      });
      // Pack animals whose drivers went home go with them.
      const out = new Set(this.figures);
      this.figures = this.figures.filter((f) => f.leader === null || out.has(f.leader));
    }
  }

  private respawn(f: Figure): void {
    if (this.net === null) return;
    f.walk = spawnWalk(this.net, this.rng);
    f.life = 15 + this.rng.next() * 35;
    f.fade = 0.01;
    if (f.walk !== null) {
      const [px, pz] = walkPoint(this.net, f.walk);
      f.x = px;
      f.z = pz;
    }
  }

  /** People gathered where the town gathers: shops, fountains, mosque doors, workshops, gates. */
  private placeGatherings(): void {
    const c = this.city;
    const { grid } = c;
    // Each gathering draws from its own stream, so a place keeps its people when others change.
    let r = createRng(1);
    const at = (x: number, z: number, heading: number, item: Part | null = null): void => {
      const f = this.person('stand', item, r);
      f.x = x;
      f.z = z;
      f.y = sampleHeight(c.terrain, x, z);
      f.heading = heading;
      f.phase = r.next() * 6;
      this.figures.push(f);
    };
    for (const b of c.buildings.values()) {
      r = createRng(b.id * 977 + 13);
      const cx = grid.centre(b.x0) + (b.w - 1) / 2;
      const cz = grid.centre(b.z0) + (b.d - 1) / 2;
      const [fx, fz] = FACING_DIRS[b.facing];
      const front = (b.facing % 2 === 0 ? b.d : b.w) / 2;
      const along = b.facing % 2 === 0 ? b.w : b.d;
      // Local (u along the front, v out from it) to world.
      const put = (u: number, v: number, toward = true, item: Part | null = null): void => {
        const x = cx + fz * u + fx * v;
        const z = cz - fx * u + fz * v;
        at(x, z, Math.atan2(fx, fz) + (toward ? Math.PI : 0) + (r.next() - 0.5) * 0.8, item);
      };
      if (b.level === 0) {
        // Masons at work round the scaffold, bending to the stones.
        for (let j = 0; j < 3; j++) {
          const f = this.person('work', null, r);
          const u = (r.next() - 0.5) * along;
          const v = (r.chance(0.5) ? 1 : -1) * (front + 0.25);
          f.x = cx + fz * u + fx * v;
          f.z = cz - fx * u + fz * v;
          f.y = sampleHeight(c.terrain, f.x, f.z);
          f.heading = r.next() * 6;
          this.figures.push(f);
        }
        continue;
      }
      switch (b.kind) {
        case 'carsi': {
          // Customers before the stalls, more as the bazaar grows.
          const bays = 2 + b.level;
          for (let k = 0; k < bays; k++) {
            const u = -along / 2 + 0.1 + (k + 0.5) * ((along - 0.2) / bays);
            const n = 1 + Math.floor(hash2(b.id, k, 81) * 3);
            for (let j = 0; j < n; j++) put(u + (r.next() - 0.5) * 0.4, front + 0.35 + r.next() * 0.35);
          }
          break;
        }
        case 'cami':
          for (let j = 0; j < 3 + b.level * 2; j++)
            put((r.next() - 0.5) * along * 0.8, front + 0.4 + r.next() * 0.5);
          break;
        case 'hamam':
        case 'darussifa':
          for (let j = 0; j < 1 + b.level; j++)
            put((r.next() - 0.5) * 1.2, front + 0.4 + r.next() * 0.4, r.chance(0.6));
          break;
        case 'medrese':
          // Students in the court and at the gate.
          for (let j = 0; j < 2 + b.level * 2; j++)
            at(cx + (r.next() - 0.5) * 0.9, cz + (r.next() - 0.5) * 0.9, r.next() * 6);
          put(0.2, front + 0.4);
          break;
        case 'kervansaray':
          // Merchants on horseback and laden donkeys before the portal.
          for (let j = 0; j < b.level; j++) {
            const u = (j - (b.level - 1) / 2) * 0.55;
            this.rider(
              cx + fz * u + fx * (front + 0.6),
              cz - fx * u + fz * (front + 0.6),
              Math.atan2(fx, fz) + Math.PI,
              r,
            );
          }
          for (let j = 0; j < 1 + b.level; j++)
            put((r.next() - 0.5) * 1.4, front + 1.1 + r.next() * 0.4, r.chance(0.5), 'sack');
          break;
        case 'kisla':
          for (let j = 0; j < 1 + b.level; j++) {
            const f = this.soldier('stand', r);
            const u = (j - b.level / 2) * 0.35;
            f.x = cx + fz * u + fx * (front + 0.3);
            f.z = cz - fx * u + fz * (front + 0.3);
            f.y = sampleHeight(c.terrain, f.x, f.z);
            f.heading = Math.atan2(fx, fz);
            this.figures.push(f);
          }
          break;
        case 'ocak':
          // Quarrymen hauling stone, and a donkey waiting to be loaded.
          for (let j = 0; j < 1 + b.level; j++)
            put((r.next() - 0.5) * along, front + 0.3 + r.next() * 0.3, false, 'sack');
          break;
        default:
          put((r.next() - 0.5) * 0.8, front + 0.35, false, r.chance(0.5) ? 'sack' : null);
      }
    }
    // The congregation at the mosque doors, and a few at every mescit and the bath.
    c.landmarks.forEach((l, index) => {
      r = createRng(5003 + index);
      if (l.kind === 'cami') {
        for (let j = 0; j < 9; j++) {
          at(
            l.x + l.w / 2 + 0.7 + r.next() * 1.4,
            l.z - 0.5 + (r.next() - 0.5) * 2.2,
            -Math.PI / 2 + (r.next() - 0.5),
          );
        }
      } else if (l.kind === 'mescit' || l.kind === 'hamam') {
        const rot = faceNearestRoad(c, l);
        const reach = Math.min(l.w, l.d) / 2 + 0.5;
        for (let j = 0; j < 3; j++) {
          const u = (r.next() - 0.5) * 1.2;
          at(
            l.x + Math.sin(rot) * reach + Math.cos(rot) * u,
            l.z + Math.cos(rot) * reach - Math.sin(rot) * u,
            rot + Math.PI,
          );
        }
      }
    });
    // A knot of people at each gate, where the town meets the road.
    c.gates.forEach((g, index) => {
      r = createRng(7001 + index);
      const inner = g.radius - 2.6;
      const gx = c.def.tepe.x + Math.cos(g.angle) * inner;
      const gz = c.def.tepe.z + Math.sin(g.angle) * inner;
      for (let j = 0; j < 3; j++) at(gx + (r.next() - 0.5) * 1.2, gz + (r.next() - 0.5) * 1.2, r.next() * 6);
    });
  }

  /** Soldiers walking the rounds, a few for every level of barracks. */
  private placePatrols(): void {
    const net = this.net;
    if (net === null || net.edges.length === 0) return;
    const n = Math.min(MAX_PATROLS, barracks(this.city) * 4);
    for (let k = 0; k < n; k++) {
      const f = this.soldier('walk');
      f.walk = spawnWalk(net, this.rng);
      f.life = 10 + this.rng.next() * 40;
      f.patrol = true;
      this.figures.push(f);
    }
  }

  /** Guards at every gate and sentries on the towers, more with every level of barracks. */
  private placeGarrison(): void {
    const c = this.city;
    const { def, terrain } = c;
    const R = def.walls.radius;
    const H = def.walls.height;
    const r = createRng(9001);
    const stand = (x: number, z: number, y: number, heading: number): void => {
      const f = this.soldier('stand', r);
      f.x = x;
      f.z = z;
      f.y = y;
      f.heading = heading;
      this.figures.push(f);
    };
    // Two at each gate, either side of the way in, looking out along the road.
    for (const g of c.gates) {
      const ca = Math.cos(g.angle);
      const sa = Math.sin(g.angle);
      for (const side of [-1, 1]) {
        const x = def.tepe.x + ca * (g.radius - 1.0) - sa * side * 0.7;
        const z = def.tepe.z + sa * (g.radius - 1.0) + ca * side * 0.7;
        stand(x, z, sampleHeight(terrain, x, z), Math.atan2(ca, sa));
      }
    }
    // Sentries on the towers, spread round the circuit; the towers are laid out as the
    // walls view lays them out, so each man stands on a tower top.
    const gateHalf = 1.55 / R;
    const count = Math.max(8, Math.round((2 * Math.PI * R) / def.walls.towerSpacing));
    const towers: number[] = [];
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const first = c.gates.filter((g) => g.radius === R);
      if (first.some((g) => Math.abs(angleStep(a, g.angle)) < gateHalf + 2.2 / R)) continue;
      towers.push(a);
    }
    const n = Math.min(MAX_SENTRIES, towers.length, 6 + barracks(c) * 6);
    for (let k = 0; k < n; k++) {
      const a = towers[Math.floor((k * towers.length) / n)];
      const x = def.tepe.x + Math.cos(a) * R;
      const z = def.tepe.z + Math.sin(a) * R;
      stand(x, z, sampleHeight(terrain, x, z) + H + 0.5, Math.atan2(Math.cos(a), Math.sin(a)));
    }
  }

  /** Farmers in the fields in the working months, a shepherd with every flock. */
  private placeFieldHands(month: number): void {
    const c = this.city;
    const { grid } = c;
    const winter = month === 11 || month <= 1;
    if (winter) return;
    for (const f of c.fields.values()) {
      const x0 = f.x0 - grid.half;
      const z0 = f.z0 - grid.half;
      const r = createRng(f.id * 131 + 17);
      if (f.kind === 'mera') {
        const fig = this.person('stand', 'staff', r);
        fig.x = x0 + 0.5 + hash2(f.id, 1, 91) * (f.w - 1);
        fig.z = z0 + 0.5 + hash2(f.id, 2, 91) * (f.d - 1);
        fig.y = sampleHeight(c.terrain, fig.x, fig.z);
        fig.heading = hash2(f.id, 3, 91) * 6;
        this.figures.push(fig);
        continue;
      }
      if (f.fallow) continue;
      // Most hands at the summer harvest, fewer hoeing in spring or ploughing in autumn.
      const busy = month === 5 || month === 6 ? 1 : month === 7 ? 0.3 : 0.6;
      const n = Math.round(Math.min(6, (f.tiles.length * busy) / 7));
      for (let j = 0; j < n; j++) {
        const fig = this.person('work', null, r);
        fig.x = x0 + 0.3 + hash2(f.id, j, 92) * (f.w - 0.6);
        fig.z = z0 + 0.3 + hash2(f.id, j, 93) * (f.d - 0.6);
        fig.y = sampleHeight(c.terrain, fig.x, fig.z);
        fig.heading = hash2(f.id, j, 94) * 6;
        fig.phase = hash2(f.id, j, 95) * 6;
        this.figures.push(fig);
      }
    }
  }

  // ---------------------------------------------------------------- how they look

  private person(mode: Mode, item: Part | null = null, r: Rng = this.rng): Figure {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(r.next() * list.length)];
    const parts: Part[] = ['robe', 'head'];
    const colors: Partial<Record<Part, string>> = { robe: pick(ROBES), head: pick(SKIN) };
    const woman = mode !== 'work' && r.chance(0.35);
    if (woman) {
      parts.push('scarf');
      colors.scarf = pick(SCARVES);
    } else if (r.chance(0.7)) {
      parts.push('turban');
      colors.turban = pick(TURBANS);
    } else {
      parts.push('cap');
      colors.cap = pick(CAPS);
    }
    const carried = item ?? (mode === 'walk' && r.chance(0.18) ? (r.chance(0.5) ? 'sack' : 'jug') : null);
    if (carried !== null) {
      parts.push(carried);
      colors[carried] = carried === 'jug' ? '#b5693f' : carried === 'staff' ? '#6b4a2a' : pick(PACKS);
    }
    return {
      parts,
      colors,
      mode,
      walk: null,
      lane: (r.chance(0.5) ? 1 : -1) * (0.07 + r.next() * 0.1),
      speed: 0.28 + r.next() * 0.14,
      life: 0,
      fade: 1,
      leader: null,
      heading: 0,
      x: 0,
      z: 0,
      y: 0,
      phase: r.next() * 6,
      small: mode === 'walk' && r.chance(0.12),
      lift: 0,
      patrol: false,
    };
  }

  private animal(): Figure {
    const f = this.person('walk');
    f.parts = ['donkey', 'pack'];
    f.colors = { donkey: DONKEYS[Math.floor(this.rng.next() * DONKEYS.length)], pack: PACKS[0] };
    f.small = false;
    return f;
  }

  /** One of the sultan's men: a red or blue coat, an iron helmet, spear and round shield. */
  private soldier(mode: Mode, r: Rng = this.rng): Figure {
    const f = this.person(mode, null, r);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(r.next() * list.length)];
    f.parts = ['robe', 'head', 'helmet', 'spear', 'shield'];
    f.colors = {
      robe: pick(SOLDIER_ROBES),
      head: pick(SKIN),
      helmet: '#6d6a66',
      spear: '#6b4a2a',
      shield: pick(SHIELDS),
    };
    f.small = false;
    f.speed = 0.3;
    return f;
  }

  /** A horseman, in two figures: the horse, and the rider sat on it in a fur-trimmed cap. */
  private rider(x: number, z: number, heading: number, r: Rng): void {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(r.next() * list.length)];
    const y = sampleHeight(this.city.terrain, x, z);
    const horse = this.person('stand', null, r);
    horse.parts = ['horse'];
    horse.colors = { horse: pick(HORSES) };
    const man = this.person('stand', null, r);
    man.parts = ['robe', 'head', 'furcap'];
    man.colors = { robe: pick(RIDER_ROBES), head: pick(SKIN), furcap: pick(FURS) };
    man.lift = SADDLE;
    for (const f of [horse, man]) {
      f.small = false;
      f.x = x;
      f.z = z;
      f.y = y;
      f.heading = heading;
      // Horses stand still under their riders, who look about only a little.
      f.phase = 0;
      this.figures.push(f);
    }
  }
}

/** How crowded the streets around each tile are: the households nearby, more near the bazaar and the mosques. */
function busyness(city: CityState): (tile: number) => number {
  const { grid } = city;
  const draw = new Float32Array(grid.count);
  const mark = (x: number, z: number, amount: number, r: number): void => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (grid.inBounds(x + dx, z + dz)) draw[grid.index(x + dx, z + dz)] += amount;
      }
    }
  };
  for (let i = 0; i < grid.count; i++) {
    if (city.house[i] > 0) mark(i % grid.size, Math.floor(i / grid.size), city.house[i], 2);
  }
  for (const b of city.buildings.values()) {
    const amount = b.kind === 'carsi' ? 20 + b.level * 10 : b.kind === 'cami' ? 15 : 8;
    mark(b.x0 + Math.floor(b.w / 2), b.z0 + Math.floor(b.d / 2), amount, 3);
  }
  for (const l of city.landmarks) mark(grid.tileOf(l.x), grid.tileOf(l.z), l.kind === 'cami' ? 40 : 10, 4);
  return (tile) => 0.3 + draw[tile];
}

/** Height of a street surface, with bridges over the water. */
function streetHeight(city: CityState, x: number, z: number): number {
  const { grid, terrain } = city;
  const tx = grid.tileOf(x);
  const tz = grid.tileOf(z);
  if (grid.inBounds(tx, tz) && terrain.water[grid.index(tx, tz)] === 1) return terrain.waterLevel + 0.26;
  return Math.max(sampleHeight(terrain, x, z), terrain.waterLevel + 0.14) + 0.03;
}

/** Levels of barracks in the city, all counted together. */
function barracks(city: CityState): number {
  let n = 0;
  for (const b of city.buildings.values()) if (b.kind === 'kisla') n += b.level;
  return n;
}

/** Signed smallest turn from `a` to `b`. */
function angleStep(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
