import * as THREE from 'three';
import { UNIT_KINDS, type UnitKind } from '../sim/balance';
import { hash2 } from '../core/rng';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS } from './palette';

/**
 * Soldiers built for battle. Each man is a small rig of separate parts (body, head and
 * helmet, two arms, two legs, weapon, shield, quiver) and each horse another (body, neck,
 * four legs, tail), so that every limb can move. A pose is worked out per man per frame
 * from an animation and its time, and the parts of everyone are drawn as one instanced
 * mesh per part: a thousand men cost a few dozen draw calls.
 *
 * The animations are the ones a battle needs: standing, marching, charging, a spear
 * thrust, a sword cut, loosing an arrow, taking a blow on the shield, falling; and for
 * the horse a walk and a gallop, ridden with a bow or a couched lance. The barracks uses
 * them for drill; the battle layer will use them for war.
 */

export const ANIMS = [
  'idle',
  'march',
  'charge',
  'thrust',
  'slash',
  'shoot',
  'block',
  'fall',
  'stand',
  'ride',
  'gallop',
  'rideShoot',
  'couch',
] as const;

export type Anim = (typeof ANIMS)[number];

/** One man, and his horse if he has one. Positions are world coordinates. */
export interface Soldier {
  kind: UnitKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  anim: Anim;
  /** Seconds into the animation. */
  t: number;
  /** Where his arrow flies to when he looses, if he is drilling at the butts. */
  aim: THREE.Vector3 | null;
  seed: number;
}

// ------------------------------------------------------------------ proportions

const HIP = 0.1;
const LEG = 0.1;
const NECK = 0.1;
const SHOULDER_X = 0.045;
const SHOULDER_Y = 0.092;
const ARM = 0.088;
const LEG_X = 0.02;
/** Height of a horse's body centre, and where its legs and the saddle sit. */
const HORSE_Y = 0.215;
const SADDLE = 0.062;

type PartName =
  | 'leg'
  | 'torso'
  | 'mail'
  | 'head'
  | 'helmet'
  | 'bork'
  | 'arm'
  | 'spear'
  | 'lance'
  | 'pennant'
  | 'sword'
  | 'bow'
  | 'shield'
  | 'quiver'
  | 'arrow'
  | 'riderLeg'
  | 'horse'
  | 'barding'
  | 'horseNeck'
  | 'horseLeg'
  | 'tail';

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
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

/**
 * Every part's shape, with its pivot at the joint it hangs from. `coarse` shapes have
 * fewer sides, for men seen from further off.
 */
function partGeometries(coarse = false): Record<PartName, THREE.BufferGeometry> {
  const round = coarse ? 5 : 8;
  const thin = coarse ? 3 : 4;
  // A strung bow: the grip in the hand, the tips drawn back towards the archer (+y). The
  // arc of a circle through the grip and both tips, stood up along the hand's z axis.
  const bowR = 0.165;
  const bowHalf = 0.615;
  const bow = new THREE.TorusGeometry(bowR, 0.005, coarse ? 2 : 3, coarse ? 6 : 12, bowHalf * 2)
    .rotateZ(-Math.PI / 2 - bowHalf)
    .translate(0, bowR, 0)
    .rotateY(Math.PI / 2);
  return {
    leg: merge([
      new THREE.BoxGeometry(0.026, LEG, 0.028).translate(0, -LEG / 2, 0),
      new THREE.BoxGeometry(0.028, 0.018, 0.04).translate(0, -LEG + 0.009, 0.008),
    ]),
    torso: merge([
      // The kaftan's skirt flares from the belt; the chest narrows to the shoulders.
      new THREE.CylinderGeometry(0.036, 0.055, 0.06, round).translate(0, 0.0, 0),
      new THREE.CylinderGeometry(0.04, 0.036, 0.075, round).translate(0, 0.065, 0),
      new THREE.BoxGeometry(0.11, 0.022, 0.05).translate(0, 0.095, 0),
    ]),
    mail: new THREE.CylinderGeometry(0.043, 0.058, 0.13, round).translate(0, 0.04, 0),
    head: new THREE.SphereGeometry(0.031, round, coarse ? 4 : 6).translate(0, 0.036, 0.004),
    helmet: merge([
      new THREE.ConeGeometry(0.037, 0.075, round).translate(0, 0.088, 0),
      new THREE.CylinderGeometry(0.037, 0.04, 0.03, round).translate(0, 0.045, -0.004),
    ]),
    bork: merge([
      new THREE.CylinderGeometry(0.03, 0.036, 0.075, round).translate(0, 0.085, 0),
      new THREE.CylinderGeometry(0.04, 0.04, 0.016, round).translate(0, 0.052, 0),
    ]),
    arm: merge([
      new THREE.BoxGeometry(0.022, ARM, 0.024).translate(0, -ARM / 2, 0),
      new THREE.BoxGeometry(0.018, 0.018, 0.02).translate(0, -ARM - 0.006, 0.002),
    ]),
    spear: merge([
      new THREE.CylinderGeometry(0.0045, 0.0045, 0.5, thin).translate(0, 0.14, 0),
      new THREE.ConeGeometry(0.011, 0.05, 4).translate(0, 0.415, 0),
    ]),
    lance: merge([
      new THREE.CylinderGeometry(0.0045, 0.0055, 0.72, thin).translate(0, 0.2, 0),
      new THREE.ConeGeometry(0.01, 0.05, 4).translate(0, 0.585, 0),
    ]),
    pennant: new THREE.BoxGeometry(0.003, 0.05, 0.075).translate(0, 0.53, -0.04),
    sword: merge([
      new THREE.BoxGeometry(0.009, 0.15, 0.004).translate(0, 0.085, 0),
      new THREE.BoxGeometry(0.04, 0.007, 0.01).translate(0, 0.01, 0),
      new THREE.BoxGeometry(0.008, 0.03, 0.008).translate(0, -0.008, 0),
    ]),
    bow: merge([bow, new THREE.BoxGeometry(0.002, 0.002, 0.19).translate(0, 0.03, 0)]),
    shield: new THREE.CylinderGeometry(0.055, 0.055, 0.01, coarse ? 7 : 12)
      .rotateZ(Math.PI / 2)
      .translate(-0.016, 0.02, 0),
    quiver: new THREE.BoxGeometry(0.026, 0.085, 0.02).translate(0, 0.02, 0),
    arrow: merge([
      new THREE.CylinderGeometry(0.002, 0.002, 0.12, 3).rotateX(Math.PI / 2),
      new THREE.ConeGeometry(0.005, 0.015, 3).rotateX(Math.PI / 2).translate(0, 0, 0.066),
    ]),
    riderLeg: merge([
      new THREE.BoxGeometry(0.026, 0.026, 0.07).translate(0, 0, 0.03),
      new THREE.BoxGeometry(0.024, 0.075, 0.026).translate(0, -0.035, 0.064),
    ]),
    horse: merge([
      new THREE.BoxGeometry(0.095, 0.1, 0.27),
      new THREE.BoxGeometry(0.08, 0.04, 0.08).translate(0, 0.05, -0.02),
    ]),
    barding: new THREE.BoxGeometry(0.108, 0.07, 0.2).translate(0, -0.005, -0.01),
    horseNeck: merge([
      new THREE.BoxGeometry(0.055, 0.13, 0.065).rotateX(0.55).translate(0, 0.05, 0.03),
      new THREE.BoxGeometry(0.05, 0.05, 0.11).rotateX(0.35).translate(0, 0.105, 0.09),
      new THREE.BoxGeometry(0.014, 0.03, 0.012).translate(-0.013, 0.14, 0.05),
      new THREE.BoxGeometry(0.014, 0.03, 0.012).translate(0.013, 0.14, 0.05),
    ]),
    horseLeg: merge([
      new THREE.BoxGeometry(0.026, 0.16, 0.028).translate(0, -0.08, 0),
      new THREE.BoxGeometry(0.028, 0.02, 0.032).translate(0, -0.15, 0.004),
    ]),
    tail: new THREE.BoxGeometry(0.022, 0.13, 0.02).translate(0, -0.06, 0),
  };
}

// ------------------------------------------------------------------ the look of each company

interface Look {
  horse: boolean;
  weapon: 'spear' | 'lance' | 'sword' | 'bow';
  hat: 'helmet' | 'bork';
  shield: boolean;
  quiver: boolean;
  mail: boolean;
  barding: boolean;
  coat: string[];
  legs: string;
  hatColor: string[];
  shieldColor: string[];
}

const LOOKS: Record<UnitKind, Look> = {
  mizrakci: {
    horse: false,
    weapon: 'spear',
    hat: 'helmet',
    shield: true,
    quiver: false,
    mail: false,
    barding: false,
    coat: ['#8c2a1c', '#9a3322', '#7e2618'],
    legs: '#4a3222',
    hatColor: ['#8f8a84', '#a09a92'],
    shieldColor: ['#b8322a', '#e0b13a', '#2f4f9a'],
  },
  okcu: {
    horse: false,
    weapon: 'bow',
    hat: 'bork',
    shield: false,
    quiver: true,
    mail: false,
    barding: false,
    coat: ['#3f7a4a', '#4a8656', '#35683f'],
    legs: '#5e3b22',
    hatColor: ['#f3ead6', '#efe2c2'],
    shieldColor: ['#8a5a36'],
  },
  atli_okcu: {
    horse: true,
    weapon: 'bow',
    hat: 'bork',
    shield: false,
    quiver: true,
    mail: false,
    barding: false,
    coat: ['#c98b4a', '#b87a3e', '#d59a5a'],
    legs: '#4a3222',
    hatColor: ['#b8322a', '#a8261c'],
    shieldColor: ['#8a5a36'],
  },
  gulam: {
    horse: true,
    weapon: 'lance',
    hat: 'helmet',
    shield: true,
    quiver: false,
    mail: true,
    barding: true,
    coat: ['#2f4f9a', '#294585'],
    legs: '#2a2a33',
    hatColor: ['#c9ccd0', '#b9bec4'],
    shieldColor: ['#e0b13a', '#b8322a'],
  },
};

const SKIN = ['#e8c19a', '#d9a878', '#c18a5e'];
const HORSES = ['#7a5238', '#5e3b22', '#a67c52', '#e8dcc4', '#3b2c24', '#8c6a4a'];
const QUIVER = '#7a4a2a';
const WOOD = '#8a5a36';
const IRON = '#9a9690';

/** Which parts, and how many of each, one man of a company is drawn with. */
function partsOf(look: Look): Array<[PartName, number]> {
  const out: Array<[PartName, number]> = [
    ['torso', 1],
    ['head', 1],
    [look.hat, 1],
    ['arm', 2],
  ];
  out.push(look.horse ? ['riderLeg', 2] : ['leg', 2]);
  out.push([look.weapon, 1]);
  if (look.weapon === 'lance') out.push(['pennant', 1]);
  if (look.weapon === 'bow') out.push(['arrow', 1]);
  if (look.shield) out.push(['shield', 1]);
  if (look.quiver) out.push(['quiver', 1]);
  if (look.mail) out.push(['mail', 1]);
  if (look.horse) out.push(['horse', 1], ['horseNeck', 1], ['horseLeg', 4], ['tail', 1]);
  if (look.barding) out.push(['barding', 1]);
  return out;
}

// ------------------------------------------------------------------ poses

interface Pose {
  bob: number;
  lean: number;
  twist: number;
  head: number;
  armL: number;
  rollL: number;
  armR: number;
  rollR: number;
  legL: number;
  legR: number;
  /** Turn of the weapon in the right hand, and of the bow in the left. */
  weapon: number;
  bowTilt: number;
  /** 0 standing, 1 lying on his back. */
  fall: number;
  /** Arrow in flight: 0..1 of its way, or -1. */
  arrow: number;
  horse: { legs: [number, number, number, number]; pitch: number; bob: number; neck: number; tail: number };
}

const TAU = Math.PI * 2;
const ease = (x: number): number => x * x * (3 - 2 * x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Where a cycle of `period` seconds is, 0..1. */
const cyc = (t: number, period: number): number => (((t / period) % 1) + 1) % 1;
/** Piecewise: 0 before a, 1 after b, eased between. */
const span = (p: number, a: number, b: number): number => ease(clamp01((p - a) / (b - a)));

function resetPose(p: Pose): void {
  p.bob = 0;
  p.lean = 0;
  p.twist = 0;
  p.head = 0;
  p.armL = 0;
  p.rollL = 0;
  p.armR = 0;
  p.rollR = 0;
  p.legL = 0;
  p.legR = 0;
  p.weapon = 0;
  p.bowTilt = 0;
  p.fall = 0;
  p.arrow = -1;
  p.horse.legs.fill(0);
  p.horse.pitch = 0;
  p.horse.bob = 0;
  p.horse.neck = 0;
  p.horse.tail = 0;
}

function newPose(): Pose {
  return {
    bob: 0,
    lean: 0,
    twist: 0,
    head: 0,
    armL: 0,
    rollL: 0,
    armR: 0,
    rollR: 0,
    legL: 0,
    legR: 0,
    weapon: 0,
    bowTilt: 0,
    fall: 0,
    arrow: -1,
    horse: { legs: [0, 0, 0, 0], pitch: 0, bob: 0, neck: 0, tail: 0 },
  };
}

/** Holding the weapon at rest: a spear or lance upright, a sword down, a bow at the side. */
function rest(p: Pose, look: Look): void {
  p.armR = -0.2;
  p.armL = -0.1;
  p.rollL = -0.1;
  p.rollR = 0.08;
  if (look.weapon === 'spear' || look.weapon === 'lance') p.weapon = -p.armR;
  else if (look.weapon === 'sword') p.weapon = Math.PI - 0.3;
  else p.weapon = 0;
  if (look.shield) {
    p.armL = -0.35;
    p.rollL = -0.25;
  }
}

function walkLegs(p: Pose, t: number, period: number, amp: number): void {
  const s = Math.sin(cyc(t, period) * TAU);
  p.legL = amp * s;
  p.legR = -amp * s;
  p.bob = Math.abs(s) * amp * 0.018;
}

function horseGait(p: Pose, t: number, gallop: boolean): void {
  const h = p.horse;
  const period = gallop ? 0.45 : 1.1;
  const amp = gallop ? 0.65 : 0.32;
  // A walk is four even beats; a gallop is the rotary gallop of a running horse.
  const offsets = gallop ? [0, 0.12, 0.52, 0.64] : [0, 0.5, 0.25, 0.75];
  const c = cyc(t, period);
  for (let k = 0; k < 4; k++) h.legs[k] = amp * Math.sin((c + offsets[k]) * TAU);
  h.pitch = gallop ? 0.07 * Math.sin(c * TAU) : 0.015 * Math.sin(c * TAU * 2);
  h.bob = gallop ? 0.02 * Math.abs(Math.sin(c * TAU)) : 0.004 * Math.abs(Math.sin(c * TAU * 2));
  h.neck = gallop ? 0.12 * Math.sin(c * TAU + 1) : 0.05 * Math.sin(c * TAU * 2);
  h.tail = gallop ? -0.9 : 0.15 * Math.sin(t * 1.3);
}

/**
 * Works out a man's pose for his animation at time `t` (seconds). The pose depends on
 * nothing else, so men at the same point of the same drill share it: each man's own
 * rhythm comes from where his time starts.
 */
function pose(p: Pose, look: Look, anim: Anim, t: number): void {
  resetPose(p);
  rest(p, look);
  const breathe = Math.sin(t * 1.7) * 0.004;
  switch (anim) {
    case 'idle':
      p.bob = breathe;
      p.head = Math.sin(t * 0.3) * 0.25;
      break;
    case 'march': {
      walkLegs(p, t, 0.9, 0.5);
      const s = Math.sin(cyc(t, 0.9) * TAU);
      p.armL = look.shield ? -0.35 : -0.35 * s;
      // The spear goes on the shoulder for the march.
      p.armR = -0.35;
      p.weapon = look.weapon === 'spear' || look.weapon === 'lance' ? 0.35 + 0.1 : p.weapon;
      break;
    }
    case 'charge':
      walkLegs(p, t, 0.5, 0.85);
      p.lean = 0.28;
      p.armR = -1.15;
      p.weapon = look.weapon === 'sword' ? Math.PI - 0.5 : Math.PI / 2 + 1.15 - 0.05;
      p.armL = look.shield ? -1.0 : -0.4;
      p.rollL = -0.35;
      break;
    case 'thrust': {
      // A spearman's drill: from guard, lunge, and recover.
      const c = cyc(t, 1.6);
      const out = span(c, 0.3, 0.42) * (1 - span(c, 0.55, 0.9));
      p.legL = 0.32 + out * 0.15;
      p.legR = -0.22;
      p.lean = 0.06 + out * 0.2;
      p.armR = -0.95 - out * 0.55;
      p.weapon = Math.PI / 2 + 0.95 + out * 0.55 - 0.12 + out * 0.12;
      p.armL = -0.8;
      p.rollL = -0.4;
      p.bob = -out * 0.006;
      break;
    }
    case 'slash': {
      const c = cyc(t, 1.4);
      const up = span(c, 0.05, 0.4);
      const down = span(c, 0.45, 0.58);
      p.armR = -0.5 - up * 2.2 + down * 2.4;
      p.rollR = 0.1 + up * 0.25 - down * 0.5;
      p.weapon = Math.PI - 0.3;
      p.twist = -0.25 * up + 0.45 * down;
      p.lean = 0.05 + down * 0.15;
      p.legL = 0.3;
      p.legR = -0.2;
      p.armL = -0.9;
      p.rollL = -0.4;
      break;
    }
    case 'shoot': {
      // Nock, draw to the cheek, loose, reach back to the quiver.
      const c = cyc(t, 2.6);
      const raise = span(c, 0.05, 0.25);
      const draw = span(c, 0.25, 0.5);
      const loose = span(c, 0.62, 0.66);
      const reach = span(c, 0.75, 0.88) * (1 - span(c, 0.92, 1));
      p.twist = 0.55 * raise;
      p.head = -0.5 * raise;
      p.armL = -0.1 - raise * 1.45;
      p.rollL = -0.1 + raise * 0.1;
      p.bowTilt = raise * 0.15;
      p.armR = -0.2 - raise * 1.3 + draw * 0.55 - loose * 0.15 - reach * 1.6;
      p.rollR = 0.08 + draw * 0.55 - loose * 0.3;
      p.legL = 0.25 * raise;
      p.legR = -0.15 * raise;
      p.arrow = c >= 0.64 ? clamp01((c - 0.64) / 0.2) : -1;
      break;
    }
    case 'block':
      p.armL = -1.55;
      p.rollL = -0.55;
      p.lean = 0.12;
      p.legL = 0.35;
      p.legR = -0.3;
      p.bob = -0.008;
      break;
    case 'fall': {
      const f = clamp01(t / 0.9);
      p.fall = ease(f);
      p.armL = -0.6 - f * 1.4;
      p.armR = -0.4 - f * 1.8;
      p.legL = f * 0.4;
      break;
    }
    case 'stand':
      horseGait(p, 0, false);
      p.horse.neck = -0.25 + 0.25 * Math.max(0, Math.sin(t * 0.25));
      p.horse.tail = 0.25 * Math.sin(t * 1.1);
      p.bob = breathe;
      p.head = Math.sin(t * 0.3) * 0.3;
      break;
    case 'ride':
      horseGait(p, t, false);
      break;
    case 'gallop':
      horseGait(p, t, true);
      p.lean = 0.2;
      p.armL = -0.7;
      break;
    case 'rideShoot': {
      horseGait(p, t, true);
      // The Turkmen shot: loosing sideways from the gallop.
      const c = cyc(t, 1.8);
      const raise = span(c, 0.05, 0.25) * (1 - span(c, 0.8, 0.95));
      const draw = span(c, 0.25, 0.5);
      const loose = span(c, 0.6, 0.64);
      p.lean = 0.12;
      p.twist = 1.2 * raise;
      p.head = -0.4 * raise;
      p.armL = -0.2 - raise * 1.4;
      p.armR = -0.2 - raise * 1.25 + draw * 0.5 - loose * 0.1;
      p.rollR = 0.08 + draw * 0.5 - loose * 0.3;
      break;
    }
    case 'couch':
      horseGait(p, t, true);
      p.lean = 0.3;
      p.armR = -1.2;
      p.weapon = Math.PI / 2 + 1.2 - 0.06;
      p.armL = -0.9;
      p.rollL = -0.4;
      break;
  }
}

// ------------------------------------------------------------------ drawing

/**
 * Poses are shared by everyone within this much time of each other (seconds): finely for
 * men at drill, coarsely for men at ease, whose breathing and glances are slow.
 */
const POSE_STEP = 1 / 30;
const EASE_STEP = 0.2;

/** Small parts left out when the camera is far: they would be a pixel or less. */
const FINE_PARTS: readonly PartName[] = ['arrow', 'quiver', 'pennant', 'tail'];

/** Parts of one look, each with its place in a pose's list of matrices. */
interface Rig {
  look: Look;
  /** The parts in drawing order, each part as often as the man has it. */
  parts: PartName[];
  /** For each part name, where its first, second… copy sits in `parts`. */
  index: Map<PartName, number[]>;
}

function rigOf(look: Look): Rig {
  const parts: PartName[] = [];
  const index = new Map<PartName, number[]>();
  for (const [part, n] of partsOf(look)) {
    for (let k = 0; k < n; k++) {
      const list = index.get(part) ?? [];
      list.push(parts.length);
      index.set(part, list);
      parts.push(part);
    }
  }
  return { look, parts, index };
}

/**
 * Everyone in a list of soldiers, drawn as instanced parts. The list is fixed for the
 * crowd's life; the soldiers' positions, animations and times may change every frame.
 *
 * A thousand men at the same drill are only a few dozen poses: each pose is worked out
 * once, as the matrices of the parts about the man's feet, and every man is his pose
 * turned, scaled and set down where he stands. The first `live` soldiers are the ones
 * that move; they are written every update, the rest, standing at ease, only when asked.
 */
export class SoldierCrowd {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly meshOf = new Map<PartName, number>();
  /** For each soldier, the mesh and the slot of each of its parts, in its rig's order. */
  private readonly slotMesh: Int32Array[] = [];
  private readonly slotAt: Int32Array[] = [];
  private readonly rigs: Rig[] = [];
  /** Slots of each mesh taken by the live soldiers: they come first. */
  private readonly livePrefix: number[] = [];
  private readonly cache = new Map<number, Float32Array>();
  /** Lowest and highest slot of each mesh written in an update, beyond the live ones. */
  private readonly lo: number[] = [];
  private readonly hi: number[] = [];
  private readonly p = newPose();
  private readonly m = {
    root: new THREE.Matrix4(),
    hip: new THREE.Matrix4(),
    neck: new THREE.Matrix4(),
    armL: new THREE.Matrix4(),
    armR: new THREE.Matrix4(),
    hand: new THREE.Matrix4(),
    horse: new THREE.Matrix4(),
    local: new THREE.Matrix4(),
    out: new THREE.Matrix4(),
  };
  private readonly e = new THREE.Euler();
  private readonly sv = new THREE.Vector3();
  /** Each mesh's shape in full and with fewer sides. */
  private readonly shapes: Array<[THREE.BufferGeometry, THREE.BufferGeometry]> = [];
  private detail = 0;

  constructor(
    readonly soldiers: Soldier[],
    readonly live = soldiers.length,
  ) {
    setInkClass(this.group, INK_CLASS.building);
    const geoms = partGeometries();
    const coarse = partGeometries(true);
    const rigByKind = new Map<UnitKind, Rig>();
    const counts: number[] = [];
    const partNames: PartName[] = [];
    soldiers.forEach((s, i) => {
      let rig = rigByKind.get(s.kind);
      if (rig === undefined) {
        rig = rigOf(LOOKS[s.kind]);
        rigByKind.set(s.kind, rig);
      }
      this.rigs.push(rig);
      const meshIds = new Int32Array(rig.parts.length);
      const slots = new Int32Array(rig.parts.length);
      rig.parts.forEach((part, k) => {
        let id = this.meshOf.get(part);
        if (id === undefined) {
          id = partNames.length;
          this.meshOf.set(part, id);
          partNames.push(part);
          counts.push(0);
          this.livePrefix.push(0);
          this.lo.push(0);
          this.hi.push(0);
        }
        meshIds[k] = id;
        slots[k] = counts[id]++;
        if (i < live) this.livePrefix[id] = counts[id];
      });
      this.slotMesh.push(meshIds);
      this.slotAt.push(slots);
    });
    partNames.forEach((part, id) => {
      const mesh = new THREE.InstancedMesh(geoms[part], miniMaterial(), counts[id]);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.shapes.push([geoms[part], coarse[part]]);
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    for (const set of [geoms, coarse]) {
      for (const [part, g] of Object.entries(set)) if (!this.meshOf.has(part as PartName)) g.dispose();
    }
    const color = new THREE.Color();
    soldiers.forEach((s, i) => {
      const { look, parts } = this.rigs[i];
      const pick = (list: readonly string[], salt: number): string =>
        list[Math.floor(hash2(i, salt, s.seed * 97) * list.length) % list.length];
      const horse = pick(HORSES, 4);
      parts.forEach((part, k) => {
        const c =
          part === 'torso' || part === 'arm'
            ? pick(look.coat, 1)
            : part === 'head'
              ? pick(SKIN, 2)
              : part === 'helmet' || part === 'bork'
                ? pick(look.hatColor, 3)
                : part === 'leg' || part === 'riderLeg'
                  ? look.legs
                  : part === 'shield'
                    ? pick(look.shieldColor, 5)
                    : part === 'mail'
                      ? '#8d9299'
                      : part === 'horse' || part === 'horseNeck' || part === 'horseLeg' || part === 'tail'
                        ? part === 'tail'
                          ? '#2e2218'
                          : horse
                        : part === 'barding'
                          ? '#a8261c'
                          : part === 'pennant'
                            ? '#b8322a'
                            : part === 'quiver'
                              ? QUIVER
                              : part === 'spear' || part === 'lance' || part === 'bow' || part === 'arrow'
                                ? WOOD
                                : IRON;
        this.meshes[this.slotMesh[i][k]].setColorAt(this.slotAt[i][k], color.set(c));
      });
    });
    for (const mesh of this.meshes) {
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  }

  get count(): number {
    return this.soldiers.length;
  }

  /** Distinct poses worked out in the last update, for tuning. */
  get poses(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const [near, far] of this.shapes) {
      near.dispose();
      far.dispose();
    }
  }

  /**
   * How finely the men are drawn: 0 in full, 1 with fewer sides to every round part,
   * 2 also without the smallest parts.
   */
  setDetail(detail: number): void {
    if (detail === this.detail) return;
    this.detail = detail;
    this.meshes.forEach((mesh, id) => {
      mesh.geometry = this.shapes[id][detail === 0 ? 0 : 1];
    });
    for (const part of FINE_PARTS) {
      const id = this.meshOf.get(part);
      if (id !== undefined) this.meshes[id].visible = detail < 2;
    }
  }

  /**
   * Poses the soldiers for their animation and time and writes their parts: the live ones
   * always, and those from `from` up to `to` as well (by default everyone). Only what was
   * written goes to the graphics card.
   */
  update(scale: number, from = 0, to = this.soldiers.length): void {
    this.cache.clear();
    const lo = this.lo.fill(Infinity);
    const hi = this.hi.fill(-1);
    for (let i = 0; i < this.live; i++) this.write(i, this.soldiers[i], scale, false);
    for (let i = Math.max(from, this.live); i < Math.min(to, this.soldiers.length); i++) {
      this.write(i, this.soldiers[i], scale, true);
    }
    this.meshes.forEach((mesh, id) => {
      const attr = mesh.instanceMatrix;
      attr.clearUpdateRanges();
      const live = this.livePrefix[id];
      if (hi[id] < 0) {
        if (live === 0) return;
        attr.addUpdateRange(0, live * 16);
      } else if (lo[id] <= live) {
        attr.addUpdateRange(0, (hi[id] + 1) * 16);
      } else {
        if (live > 0) attr.addUpdateRange(0, live * 16);
        attr.addUpdateRange(lo[id] * 16, (hi[id] - lo[id] + 1) * 16);
      }
      attr.needsUpdate = true;
    });
  }

  /** local = T(x, y, z) · Ry(ry) · Rx(rx) · Rz(rz); out = parent · local. */
  private joint(
    out: THREE.Matrix4,
    parent: THREE.Matrix4,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): THREE.Matrix4 {
    this.e.set(rx, ry, rz, 'YXZ');
    this.m.local.makeRotationFromEuler(this.e).setPosition(x, y, z);
    return out.multiplyMatrices(parent, this.m.local);
  }

  /** The pose of a rig at a time, shared by everyone of that kind at that moment. */
  private poseOf(rig: Rig, kind: UnitKind, anim: Anim, t: number): Float32Array {
    const step = anim === 'idle' || anim === 'stand' ? EASE_STEP : POSE_STEP;
    const q = Math.round(t / step);
    const key = (q * ANIMS.length + ANIMS.indexOf(anim)) * UNIT_KINDS.length + UNIT_KINDS.indexOf(kind);
    let out = this.cache.get(key);
    if (out === undefined) {
      out = new Float32Array(rig.parts.length * 16 + 1);
      this.rigPose(rig, anim, q * step, out);
      this.cache.set(key, out);
    }
    return out;
  }

  /**
   * Writes every part's matrix about the man's feet (facing +z, at unit size) into `out`,
   * and after them how far his arrow has flown, or -1.
   */
  private rigPose(rig: Rig, anim: Anim, t: number, out: Float32Array): void {
    const { look } = rig;
    const p = this.p;
    pose(p, look, anim, t);
    const m = this.m;
    const put = (part: PartName, nth: number, mat: THREE.Matrix4): void => {
      const at = rig.index.get(part)?.[nth];
      if (at !== undefined) mat.toArray(out, at * 16);
    };
    m.root.identity();

    // The body: on its own feet, or in the saddle.
    if (look.horse) {
      const h = p.horse;
      this.joint(m.horse, m.root, 0, HORSE_Y + h.bob, 0, h.pitch);
      put('horse', 0, m.horse);
      put('barding', 0, m.horse);
      this.joint(m.out, m.horse, 0, 0.03, 0.12, h.neck);
      put('horseNeck', 0, m.out);
      const legAt: Array<[number, number]> = [
        [-0.033, 0.1],
        [0.033, 0.1],
        [-0.033, -0.1],
        [0.033, -0.1],
      ];
      legAt.forEach(([lx, lz], k) => {
        this.joint(m.out, m.horse, lx, -0.045, lz, h.legs[k]);
        put('horseLeg', k, m.out);
      });
      this.joint(m.out, m.horse, 0, 0.035, -0.135, 0.35 + h.tail * 0.3);
      put('tail', 0, m.out);
      for (const side of [-1, 1]) {
        this.joint(m.out, m.horse, side * 0.05, SADDLE, -0.01);
        put('riderLeg', side < 0 ? 0 : 1, m.out);
      }
      this.joint(m.hip, m.horse, 0, SADDLE, -0.01, p.lean, p.twist);
    } else {
      const fall = p.fall;
      // Falling, a man goes over backwards from the feet.
      this.joint(
        m.hip,
        m.root,
        0,
        HIP + p.bob - fall * (HIP - 0.03),
        -fall * 0.1,
        p.lean - fall * 1.45,
        p.twist,
      );
      for (const side of [-1, 1]) {
        this.joint(
          m.out,
          m.root,
          side * LEG_X,
          HIP + p.bob - fall * (HIP - 0.03),
          -fall * 0.05,
          side < 0 ? p.legL - fall * 1.3 : p.legR - fall * 1.2,
        );
        put('leg', side < 0 ? 0 : 1, m.out);
      }
    }
    put('torso', 0, m.hip);
    put('mail', 0, m.hip);
    this.joint(m.neck, m.hip, 0, NECK, 0, 0, p.head);
    put('head', 0, m.neck);
    put(look.hat, 0, m.neck);
    this.joint(m.out, m.hip, 0.02, 0.07, -0.035, 0.25, 0, -0.3);
    put('quiver', 0, m.out);

    this.joint(m.armL, m.hip, -SHOULDER_X, SHOULDER_Y, 0, p.armL, 0, p.rollL);
    put('arm', 0, m.armL);
    this.joint(m.armR, m.hip, SHOULDER_X, SHOULDER_Y, 0, p.armR, 0, p.rollR);
    put('arm', 1, m.armR);

    // Left hand: the shield on the forearm, or the bow.
    if (look.shield) {
      this.joint(m.out, m.armL, -0.012, -ARM * 0.62, 0.005);
      put('shield', 0, m.out);
    }
    if (look.weapon === 'bow') {
      this.joint(m.hand, m.armL, 0, -ARM, 0.004, 0, 0, p.bowTilt);
      put('bow', 0, m.hand);
    } else {
      this.joint(m.hand, m.armR, 0, -ARM, 0.004, p.weapon);
      put(look.weapon, 0, m.hand);
      if (look.weapon === 'lance') put('pennant', 0, m.hand);
    }
    // The arrow stays out of sight here; in flight it is set in the world by itself.
    const arrow = rig.index.get('arrow')?.[0];
    if (arrow !== undefined) out.fill(0, arrow * 16, arrow * 16 + 16);
    out[out.length - 1] = p.arrow;
  }

  /**
   * Sets one man down: his pose, turned to his heading, scaled and moved to where he is.
   * `track` notes the slots written, for the upload.
   */
  private write(i: number, s: Soldier, scale: number, track: boolean): void {
    const rig = this.rigs[i];
    const local = this.poseOf(rig, s.kind, s.anim, s.t);
    const meshIds = this.slotMesh[i];
    const slots = this.slotAt[i];
    const c = Math.cos(s.heading) * scale;
    const sn = Math.sin(s.heading) * scale;
    for (let k = 0; k < meshIds.length; k++) {
      const id = meshIds[k];
      const dst = this.meshes[id].instanceMatrix.array as Float32Array;
      const o = slots[k] * 16;
      if (track) {
        if (slots[k] < this.lo[id]) this.lo[id] = slots[k];
        if (slots[k] > this.hi[id]) this.hi[id] = slots[k];
      }
      const a = k * 16;
      // out = T(s) · Ry(heading) · S(scale) · local, column by column.
      for (let col = 0; col < 16; col += 4) {
        const lx = local[a + col];
        const ly = local[a + col + 1];
        const lz = local[a + col + 2];
        dst[o + col] = c * lx + sn * lz;
        dst[o + col + 1] = scale * ly;
        dst[o + col + 2] = -sn * lx + c * lz;
        dst[o + col + 3] = local[a + col + 3];
      }
      dst[o + 12] += s.x;
      dst[o + 13] += s.y;
      dst[o + 14] += s.z;
    }

    // The arrow in flight, from the bow to the mark.
    const u = local[local.length - 1];
    if (u >= 0 && s.aim !== null) {
      const at = rig.index.get('arrow')?.[0];
      if (at === undefined) return;
      const m = this.m;
      const sx = s.x + Math.sin(s.heading) * 0.1;
      const sz = s.z + Math.cos(s.heading) * 0.1;
      const sy = s.y + 0.2 * scale;
      const x = sx + (s.aim.x - sx) * u;
      const z = sz + (s.aim.z - sz) * u;
      const arc = Math.hypot(s.aim.x - sx, s.aim.z - sz) * 0.25;
      const y = sy + (s.aim.y - sy) * u + arc * 4 * u * (1 - u);
      const pitch = -Math.atan2(s.aim.y - sy + arc * 4 * (1 - 2 * u), Math.hypot(s.aim.x - sx, s.aim.z - sz));
      this.e.set(pitch, Math.atan2(s.aim.x - sx, s.aim.z - sz), 0, 'YXZ');
      this.sv.set(scale, scale, scale);
      m.out.makeRotationFromEuler(this.e).scale(this.sv).setPosition(x, y, z);
      m.out.toArray(this.meshes[meshIds[at]].instanceMatrix.array, slots[at] * 16);
    }
  }
}

/** Parts a man of each company is drawn with, for the smoke test and for tuning. */
export function partCount(kind: UnitKind): number {
  return partsOf(LOOKS[kind]).reduce((n, [, k]) => n + k, 0);
}
