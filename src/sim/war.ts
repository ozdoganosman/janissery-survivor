import { hash2 } from '../core/rng';
import { destroyUnit, type Unit } from './army';
import type { EnemyDef, EnemyKind, FighterDef, FormationKind } from './balance';
import { DAYS_PER_MONTH } from './calendar';
import type { CityState } from './city';
import { axes, companySize, formationCols, marchOrder, returnOrder } from './field';
import { notify } from './notices';
import { findPath, standGround } from './paths';
import { wallDepth } from './walls';

/**
 * War: raiders come over the horizon and the army goes out to meet them. A raid makes for
 * the suburbs before one of the city's gates; the walls themselves keep them out. Every
 * tabur on either side is a block of men with a morale: archers shoot at whatever comes
 * within range, riders who shoot fall back from footmen who come too close, the rest close
 * in and fight hand to hand. Men fall to arrows and blows, weighed against the defence of
 * those they strike; a charge, a spear against a horse and a blow in the flank or the rear
 * count for more. Losses, arrows and blows from the side wear morale down, and a tabur whose
 * morale breaks runs: raiders for the edge of the map, the city's men for their barracks.
 *
 * A battle runs in real time, like the march, and the city's days slow down while it lasts.
 * The raiders move here, in the rules; the city's taburs move as the army view marches them,
 * so each step is told where they stand now. The rules decide what they do about it: stand
 * and fight, shoot, go after the foe they were sent against, or run for home.
 */

/** How fast a battle runs at each game speed: the march's pace. */
export const BATTLE_PACE = [0, 1, 1.6, 2.2] as const;

/** A raider tabur on the map. */
export interface Foe {
  id: number;
  kind: EnemyKind;
  men: number;
  /** Men it came with. */
  start: number;
  x: number;
  z: number;
  heading: number;
  morale: number;
  state: FoeState;
  /** The tabur of ours it shoots at or fights, if any. */
  target: number | null;
  /** Its place in the raid's array, about the raid's middle: [to the right, forward]. */
  slot: [number, number];
  /** Seconds since it came to blows, and whether it came at a run. */
  contact: number;
  charged: boolean;
  /** Losses not yet whole men. */
  wound: number;
  /** Its own way to the edge of the map, when it leaves. Not saved. */
  way?: Array<[number, number]>;
  /** It has been shot at or struck from the side this step, to wear its morale. */
  shot: boolean;
  /** Seconds it has been on its way off the map. */
  fleeing: number;
}

export type FoeState = 'advance' | 'engage' | 'shoot' | 'kite' | 'fight' | 'pillage' | 'withdraw' | 'rout';

/** One of our taburs in the battle. */
export interface Fighter {
  morale: number;
  state: 'idle' | 'move' | 'shoot' | 'fight' | 'rout';
  /** The foe it shoots at or fights, for the view: where to face and aim. */
  target: number | null;
  /** The foe it was sent against, and whether it went of its own accord. */
  order: { foe: number; auto: boolean } | null;
  /** Where the last chase sent it, so as not to send it again for nothing. */
  sent: { x: number; z: number; time: number } | null;
  contact: number;
  charged: boolean;
  wound: number;
  shot: boolean;
  /**
   * Where it stands while the battle moves it itself, stepping after its foe or pressing
   * into the fight, rather than marching where it was sent; null while it marches.
   */
  pos: { x: number; z: number; heading: number } | null;
  /** It moved this step; seconds it has got no nearer where it is going. */
  moving: boolean;
  stuck: number;
}

export interface War {
  name: string;
  /** Who they are: "Moğollar". */
  people: string;
  foes: Foe[];
  nextFoe: number;
  /** Our taburs in the battle, by unit id. */
  fighters: Record<number, Fighter>;
  /** The gate they make for, where they pillage before it, and where they came from. */
  gate: string;
  target: { x: number; z: number };
  exit: { x: number; z: number };
  /** The way from where they came to the gate, and how far along it the raid is. */
  way: Array<[number, number]>;
  along: number;
  /** Seconds they have pillaged. */
  pillaged: number;
  time: number;
  /** Their men killed, our men lost, what they took. */
  killed: number;
  lost: number;
  taken: { akce: number; people: number };
  /** Sent by the player to try the army. */
  trial: boolean;
}

/** When the next raid comes, and whether the city has been told. */
export interface RaidClock {
  next: number;
  warned: boolean;
  count: number;
}

/** Where one of our taburs is now, as the army view has it. */
export interface Whereabouts {
  x: number;
  z: number;
  heading: number;
  moving: boolean;
}

/** A tabur's ground: its middle, the way it faces, its front and depth. */
export interface Block {
  x: number;
  z: number;
  heading: number;
  w: number;
  d: number;
}

/** Room left between two blocks at blows, and how close counts as touching (tiles). */
const TOUCH = 0.1;
const CONTACT = 0.45;
/** Turning speed of a raider tabur, radians a second. */
const TURN = 2.2;
/** Seconds raiders on their way off take at most before they are gone. */
const FLEE_MOST = 90;
/** How near its foe a tabur marching against it is taken in hand by the battle (tiles). */
const TAKE = 24;
/** Seconds a tabur in hand may make no headway before it goes the long way round. */
const STUCK = 2;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function angleTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function turnToward(from: number, to: number, most: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + clamp(d, -most, most);
}

// ------------------------------------------------------------------ the raid clock

/**
 * A day of the raid clock: the city hears of a raid some months before it comes. The raid
 * itself sets out from `warStep`, when the battle can be fought.
 */
export function raidDay(city: CityState): void {
  const clock = city.raids;
  const r = city.balance.army.war.raids;
  if (clock.warned || city.calendar.day < clock.next - r.warn * DAYS_PER_MONTH) return;
  clock.warned = true;
  const kind = r.kinds[raidKind(city, clock.count)];
  notify(
    city,
    `Casuslar haber getirdi: ${kind.name} ${r.warn} ay içinde ${bearingName(raidBearing(city, clock.count))} gelecek.`,
    'bad',
  );
}

function raidKind(city: CityState, n: number): number {
  return Math.floor(hash2(n, city.def.seed, 71) * city.balance.army.war.raids.kinds.length);
}

function raidBearing(city: CityState, n: number): number {
  const kind = city.balance.army.war.raids.kinds[raidKind(city, n)];
  return kind.from[0] + (kind.from[1] - kind.from[0]) * hash2(n, city.def.seed, 73);
}

/** Taburs in the `n`th raid. */
export function raidSize(city: CityState, n: number): number {
  const r = city.balance.army.war.raids;
  return Math.round(r.base * (1 + r.grow * n));
}

function bearingName(deg: number): string {
  const names = [
    'doğudan',
    'güneydoğudan',
    'güneyden',
    'güneybatıdan',
    'batıdan',
    'kuzeybatıdan',
    'kuzeyden',
    'kuzeydoğudan',
  ];
  return names[((Math.round(deg / 45) % 8) + 8) % 8];
}

// ------------------------------------------------------------------ setting out

export interface RaidOptions {
  /** Index into the raid kinds; bearing in degrees from east towards south. */
  kind?: number;
  bearing?: number;
  trial?: boolean;
}

/**
 * Sends a raid of `taburs` against the city: they gather at the edge of the map on the
 * bearing they come from and make for the gate nearest it. A problem in words, if one is
 * already on.
 */
export function sendRaid(city: CityState, taburs: number, opts: RaidOptions = {}): War | string {
  if (city.war !== null) return 'Zaten bir akın sürüyor.';
  const wd = city.balance.army.war;
  const n = city.raids.count;
  const kindIndex = opts.kind ?? raidKind(city, n);
  const kind = wd.raids.kinds[kindIndex % wd.raids.kinds.length];
  const bearing = ((opts.bearing ?? raidBearing(city, n)) * Math.PI) / 180;
  const gate = gateToward(city, bearing);
  if (gate === null) return 'Şehrin kapısı yok.';
  const { grid } = city;
  const { tepe } = city.def;
  // As far out as the map goes on that bearing, then the nearest ground they can stand on.
  const edge = grid.half - 8;
  const reach = Math.min(
    Math.abs(Math.cos(bearing)) > 1e-3
      ? (edge - Math.sign(Math.cos(bearing)) * tepe.x) / Math.abs(Math.cos(bearing))
      : Infinity,
    Math.abs(Math.sin(bearing)) > 1e-3
      ? (edge - Math.sign(Math.sin(bearing)) * tepe.z) / Math.abs(Math.sin(bearing))
      : Infinity,
  );
  const start = nearestFoeGround(
    city,
    tepe.x + Math.cos(bearing) * reach,
    tepe.z + Math.sin(bearing) * reach,
    12,
  );
  if (start === null) return 'Akıncılar yol bulamadı.';
  const way = findPath(city, start, gate.at, { gates: false }) ?? [
    [start.x, start.z],
    [gate.at.x, gate.at.z],
  ];
  // How many of each kind: the mix, scaled to the size, largest shares first.
  const mix = Object.entries(kind.mix) as Array<[EnemyKind, number]>;
  const weight = mix.reduce((s, [, w]) => s + w, 0);
  const counts = mix.map(([k, w]) => ({
    k,
    n: Math.floor((taburs * w) / weight),
    rest: (taburs * w) / weight,
  }));
  for (const c of counts) c.rest -= c.n;
  let short = taburs - counts.reduce((s, c) => s + c.n, 0);
  for (const c of [...counts].sort((a, b) => b.rest - a.rest)) {
    if (short <= 0) break;
    c.n++;
    short--;
  }
  // Riders who shoot in front, the rest behind them; in lines about twice as wide as deep.
  const order: EnemyKind[] = [];
  for (const c of [...counts].sort((a, b) => wd.enemies[b.k].missile - wd.enemies[a.k].missile)) {
    for (let k = 0; k < c.n; k++) order.push(c.k);
  }
  const perLine = Math.max(1, Math.ceil(Math.sqrt(order.length * 2)));
  const heading = angleTo(
    start.x,
    start.z,
    way[Math.min(1, way.length - 1)][0],
    way[Math.min(1, way.length - 1)][1],
  );
  const war: War = {
    name: kind.name,
    people: kind.people,
    foes: [],
    nextFoe: 1,
    fighters: {},
    gate: gate.name,
    target: gate.at,
    exit: start,
    way,
    along: 0,
    pillaged: 0,
    time: 0,
    killed: 0,
    lost: 0,
    taken: { akce: 0, people: 0 },
    trial: opts.trial ?? false,
  };
  const a = axes(heading);
  let back = 0;
  for (let line = 0; line * perLine < order.length; line++) {
    const kinds = order.slice(line * perLine, (line + 1) * perLine);
    const sizes = kinds.map((k) => foeSize(city, wd.enemies[k], wd.enemies[k].men));
    const gap = 1.2;
    const width = sizes.reduce((s, z) => s + z.w, 0) + gap * (kinds.length - 1);
    let across = -width / 2;
    const depth = Math.max(...sizes.map((z) => z.d));
    kinds.forEach((k, i) => {
      const def = wd.enemies[k];
      const r = across + sizes[i].w / 2;
      const f = -back - sizes[i].d / 2;
      across += sizes[i].w + gap;
      const at =
        nearestFoeGround(city, start.x + a.rx * r + a.fx * f, start.z + a.rz * r + a.fz * f, 6) ?? start;
      war.foes.push({
        id: war.nextFoe++,
        kind: k,
        men: def.men,
        start: def.men,
        x: at.x,
        z: at.z,
        heading,
        morale: maxMorale(city, def),
        state: 'advance',
        target: null,
        slot: [r, f],
        contact: -1,
        charged: false,
        wound: 0,
        shot: false,
        fleeing: 0,
      });
    });
    back += depth + 1.5;
  }
  city.war = war;
  if (!war.trial) {
    city.raids.count++;
    const [lo, hi] = wd.raids.every;
    city.raids.next =
      city.calendar.day + Math.round((lo + (hi - lo) * hash2(n, city.def.seed, 79)) * DAYS_PER_MONTH);
    city.raids.warned = false;
  }
  const men = war.foes.reduce((s, f) => s + f.men, 0);
  notify(
    city,
    `⚔ ${kind.name} ${bearingName((bearing * 180) / Math.PI)} geliyor: ${war.foes.length} tabur, ${fmt(men)} er. ` +
      `${gate.name} önündeki varoşlara yöneliyorlar.`,
    'bad',
  );
  city.revision.army++;
  return war;
}

/** The gate of the outermost walls nearest a bearing, and the ground before it outside. */
function gateToward(city: CityState, bearing: number): { name: string; at: { x: number; z: number } } | null {
  const outer = Math.max(...city.gates.map((g) => g.ring));
  let best: { name: string; at: { x: number; z: number } } | null = null;
  let bestTurn = Infinity;
  const { grid } = city;
  for (const g of city.gates) {
    if (g.ring !== outer || g.tiles.length === 0) continue;
    let d = Math.abs(g.angle - bearing) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d >= bestTurn) continue;
    let x = 0;
    let z = 0;
    for (const i of g.tiles) {
      x += grid.centre(i % grid.size);
      z += grid.centre(Math.floor(i / grid.size));
    }
    x /= g.tiles.length;
    z /= g.tiles.length;
    const at = nearestFoeGround(city, x + Math.cos(g.angle) * 7, z + Math.sin(g.angle) * 7, 8);
    if (at === null) continue;
    bestTurn = d;
    best = { name: g.name, at };
  }
  return best;
}

// ------------------------------------------------------------------ ground

/** Whether raiders may stand at a point: dry land outside every wall, in no building. */
export function foeGround(city: CityState, x: number, z: number): boolean {
  const { grid } = city;
  const tx = grid.tileOf(x);
  const tz = grid.tileOf(z);
  if (!grid.inBounds(tx, tz)) return false;
  const i = grid.index(tx, tz);
  if (city.terrain.water[i] === 1 && city.road[i] !== 1) return false;
  if (city.wall[i] !== 0 || city.structure[i] >= 0 || city.building[i] >= 0) return false;
  return wallDepth(city, x, z) === 0;
}

function nearestFoeGround(
  city: CityState,
  x: number,
  z: number,
  most: number,
): { x: number; z: number } | null {
  if (foeGround(city, x, z)) return { x, z };
  for (let r = 1; r <= most; r++) {
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (foeGround(city, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

// ------------------------------------------------------------------ figures

function foeSize(city: CityState, def: EnemyDef, men: number): { w: number; d: number } {
  return companySize(def, Math.max(1, men), formationCols(city, def.formation, Math.max(1, men)));
}

function maxMorale(city: CityState, def: FighterDef): number {
  const m = city.balance.army.war.morale;
  return m.base + m.perPoint * def.morale;
}

/** Footmen who carry shields: those with a spear or a sword. */
function shielded(def: FighterDef): boolean {
  return !def.horse && (def.weapon === 'spear' || def.weapon === 'sword');
}

function range(city: CityState, def: FighterDef): number {
  const r = city.balance.army.war.combat.range;
  return def.missile <= 0 ? 0 : def.horse ? r.horse : r.foot;
}

function blockOfFoe(city: CityState, f: Foe): Block {
  const def = city.balance.army.war.enemies[f.kind];
  return { x: f.x, z: f.z, heading: f.heading, ...foeSize(city, def, f.men) };
}

function blockOfUnit(city: CityState, u: Unit, at: Whereabouts): Block {
  const def = city.balance.army.units[u.kind];
  const formation: FormationKind = u.field?.formation ?? 'kare';
  return {
    x: at.x,
    z: at.z,
    heading: at.heading,
    ...companySize(def, u.men, formationCols(city, formation, u.men)),
  };
}

/** How far a point is from a block's ground (0 inside it). */
export function gapTo(b: Block, x: number, z: number): number {
  const a = axes(b.heading);
  const dx = x - b.x;
  const dz = z - b.z;
  const r = Math.abs(dx * a.rx + dz * a.rz) - b.w / 2;
  const f = Math.abs(dx * a.fx + dz * a.fz) - b.d / 2;
  return Math.hypot(Math.max(0, r), Math.max(0, f));
}

/** Whether two blocks are at blows: either one's ground within reach of the other's. */
function touching(a: Block, b: Block): boolean {
  return gapTo(b, a.x, a.z) - a.d / 2 <= CONTACT || gapTo(a, b.x, b.z) - b.d / 2 <= CONTACT;
}

/** Where a block of depth `d` coming from (x, z) stands to come to blows with `b`, and faces. */
function contactPoint(b: Block, x: number, z: number, d: number): { x: number; z: number; heading: number } {
  const a = axes(b.heading);
  const dx = x - b.x;
  const dz = z - b.z;
  const r = dx * a.rx + dz * a.rz;
  const f = dx * a.fx + dz * a.fz;
  const hw = b.w / 2 + d / 2 + TOUCH;
  const hd = b.d / 2 + d / 2 + TOUCH;
  let pr: number;
  let pf: number;
  if (Math.abs(f) / hd >= Math.abs(r) / hw) {
    pf = (f >= 0 ? 1 : -1) * hd;
    pr = clamp(r, -b.w / 2, b.w / 2);
  } else {
    pr = (r >= 0 ? 1 : -1) * hw;
    pf = clamp(f, -b.d / 2, b.d / 2);
  }
  const px = b.x + a.rx * pr + a.fx * pf;
  const pz = b.z + a.rz * pr + a.fz * pf;
  // Square to the side it meets.
  const side =
    Math.abs(f) / hd >= Math.abs(r) / hw
      ? b.heading + (pf > 0 ? Math.PI : 0)
      : b.heading + (pr > 0 ? -Math.PI / 2 : Math.PI / 2);
  return { x: px, z: pz, heading: side };
}

/** How a blow from (x, z) lands on block `b`: 1 in front, `flank` on a side, `rear` behind. */
function sideOf(city: CityState, b: Block, x: number, z: number): { mult: number; flanked: boolean } {
  const c = city.balance.army.war.combat;
  const a = axes(b.heading);
  const dx = x - b.x;
  const dz = z - b.z;
  const len = Math.hypot(dx, dz) || 1;
  const cos = (dx * a.fx + dz * a.fz) / len;
  if (cos < -0.5) return { mult: c.rear, flanked: true };
  if (cos < 0.3) return { mult: c.flank, flanked: true };
  return { mult: 1, flanked: false };
}

// ------------------------------------------------------------------ the battle

/**
 * A slice of battle, `dt` seconds of it at the battle's pace. `where` tells where each of
 * our taburs out of the barracks stands now. With no raid on, it only sets out the one
 * that is due.
 */
export function warStep(city: CityState, dt: number, where: ReadonlyMap<number, Whereabouts>): void {
  if (city.war === null) {
    if (city.calendar.day >= city.raids.next) sendRaid(city, raidSize(city, city.raids.count));
    return;
  }
  if (dt <= 0) return;
  const war = city.war;
  war.time += dt;
  const wd = city.balance.army.war;
  const units = new Map(city.army.units.map((u) => [u.id, u]));

  // Our taburs in the field join the battle; those back in the barracks leave it.
  const ours: Array<{ u: Unit; f: Fighter; at: Whereabouts; b: Block }> = [];
  for (const [id, seen] of where) {
    const u = units.get(id);
    if (u === undefined || u.drill !== null) continue;
    const f = (war.fighters[id] ??= newFighter(city, u));
    // Taburs the battle moves itself are where it has them; the rest where they are seen.
    const at: Whereabouts = f.pos !== null ? { ...f.pos, moving: f.moving } : seen;
    ours.push({ u, f, at, b: blockOfUnit(city, u, at) });
  }
  for (const key of Object.keys(war.fighters)) {
    const id = Number(key);
    if (!where.has(id) || !units.has(id)) delete war.fighters[id];
  }
  const foeById = new Map(war.foes.map((f) => [f.id, f]));
  const blocks = new Map(war.foes.map((f) => [f.id, blockOfFoe(city, f)]));
  const standing = ours.filter((o) => o.f.state !== 'rout');

  // --- the raiders' minds and feet
  let searches = 1;
  const raidPace = Math.min(
    ...war.foes.filter((f) => f.state === 'advance').map((f) => wd.enemies[f.kind].march),
    Infinity,
  );
  // The array moves on at the pace of its slowest, and waits for those who fall behind.
  const behind = war.foes.some((f) => {
    if (f.state !== 'advance') return false;
    const s = slotAt(war, f);
    return Math.hypot(s.x - f.x, s.z - f.z) > 4;
  });
  if (Number.isFinite(raidPace) && war.pillaged === 0 && !behind) {
    war.along = Math.min(pathLength(war.way), war.along + raidPace * dt);
  }
  for (const foe of war.foes) {
    const def = wd.enemies[foe.kind];
    const me = blocks.get(foe.id)!;
    foe.shot = false;
    if (foe.state === 'rout' || foe.state === 'withdraw') {
      const speed = def.march * (foe.state === 'rout' ? wd.combat.routSpeed : 1);
      // Straight off where the land allows; else the way round, one search a step.
      if (foe.way === undefined && clearLine(city, foe, war.exit)) foe.way = [[war.exit.x, war.exit.z]];
      else if (foe.way === undefined && searches-- > 0) {
        foe.way = findPath(city, foe, war.exit, { gates: false }) ?? [[war.exit.x, war.exit.z]];
      }
      if (foe.way === undefined) stepToward(city, foe, war.exit.x, war.exit.z, speed * dt, TURN * dt);
      else followWay(city, foe, foe.way, speed * dt, TURN * dt);
      foe.target = null;
      foe.fleeing += dt;
      continue;
    }
    // The nearest of ours, and any at blows with it.
    let near: (typeof ours)[number] | null = null;
    let nearD = Infinity;
    let blow: (typeof ours)[number] | null = null;
    for (const o of standing) {
      const d = Math.hypot(o.at.x - foe.x, o.at.z - foe.z);
      if (d < nearD) {
        nearD = d;
        near = o;
      }
      if (touching(me, o.b) && (blow === null || d < Math.hypot(blow.at.x - foe.x, blow.at.z - foe.z)))
        blow = o;
    }
    if (blow !== null) {
      if (foe.state !== 'fight') {
        foe.contact = 0;
        foe.charged = foe.state === 'engage';
      }
      foe.state = 'fight';
      foe.target = blow.u.id;
      foe.heading = turnToward(foe.heading, angleTo(foe.x, foe.z, blow.at.x, blow.at.z), TURN * dt);
      continue;
    }
    foe.contact = -1;
    const reach = range(city, def);
    if (near !== null && nearD <= wd.combat.aware) {
      const theirs = city.balance.army.units[near.u.kind];
      if (def.horse && reach > 0 && theirs.missile === 0 && nearD < wd.combat.kite) {
        // Riders who shoot do not wait for footmen and lancers: they fall back and shoot again.
        foe.state = 'kite';
        foe.target = near.u.id;
        const away = angleTo(near.at.x, near.at.z, foe.x, foe.z);
        stepToward(
          city,
          foe,
          foe.x + Math.sin(away) * 4,
          foe.z + Math.cos(away) * 4,
          def.march * dt,
          TURN * dt,
        );
        continue;
      }
      if (reach > 0 && nearD <= reach) {
        foe.state = 'shoot';
        foe.target = near.u.id;
        foe.heading = turnToward(foe.heading, angleTo(foe.x, foe.z, near.at.x, near.at.z), TURN * dt);
        continue;
      }
      foe.state = 'engage';
      foe.target = near.u.id;
      if (reach > 0) {
        const toward = angleTo(foe.x, foe.z, near.at.x, near.at.z);
        const stand = nearD - reach * 0.8;
        stepToward(
          city,
          foe,
          foe.x + Math.sin(toward) * stand,
          foe.z + Math.cos(toward) * stand,
          def.march * dt,
          TURN * dt,
        );
      } else {
        const p = contactPoint(near.b, foe.x, foe.z, me.d);
        const fast = nearD < 8 ? wd.combat.chargeSpeed : 1;
        stepToward(city, foe, p.x, p.z, def.march * fast * dt, TURN * dt);
      }
      continue;
    }
    // Nothing in the way: on to the gate, and pillage there.
    foe.target = null;
    if (war.pillaged >= wd.pillage.seconds) {
      foe.state = 'withdraw';
      continue;
    }
    const slot = slotAt(war, foe);
    if (war.along >= pathLength(war.way) - 0.5 && Math.hypot(slot.x - foe.x, slot.z - foe.z) < 2.5) {
      foe.state = 'pillage';
      foe.heading = turnToward(foe.heading, slot.heading, TURN * dt);
    } else {
      foe.state = 'advance';
      stepToward(city, foe, slot.x, slot.z, def.march * 1.25 * dt, TURN * dt);
    }
  }

  // --- our taburs: those at blows or sent against a raider are moved by the battle itself,
  // step by step, the rest march as the army view has them
  for (const o of ours) {
    const { u, f } = o;
    const def = city.balance.army.units[u.kind];
    f.shot = false;
    f.moving = false;
    if (f.state === 'rout') continue;
    if (f.order !== null && !foeById.has(f.order.foe)) f.order = null;
    // At blows with a raider: stopped in its march, it presses in and turns to face it.
    let blow: Foe | null = null;
    let blowD = Infinity;
    for (const foe of war.foes) {
      const d = Math.hypot(foe.x - o.at.x, foe.z - o.at.z);
      if (d < blowD && touching(o.b, blocks.get(foe.id)!)) {
        blow = foe;
        blowD = d;
      }
    }
    if (blow !== null) {
      if (f.state !== 'fight') {
        f.contact = 0;
        f.charged = o.at.moving;
      }
      f.state = 'fight';
      f.target = blow.id;
      const pos = take(city, o);
      const p = contactPoint(blocks.get(blow.id)!, pos.x, pos.z, o.b.d);
      steer(city, o, p.x, p.z, def.march * 0.4 * dt, TURN * dt, angleTo(pos.x, pos.z, blow.x, blow.z));
      continue;
    }
    f.contact = -1;
    const reach = range(city, def);
    // Archers shoot at the foe they were sent against if it is in range, else the nearest.
    if (reach > 0 && (!o.at.moving || f.pos !== null)) {
      let aim: Foe | null = null;
      let aimD = Infinity;
      for (const foe of war.foes) {
        const d = Math.hypot(foe.x - o.at.x, foe.z - o.at.z);
        if (d > reach) continue;
        const pref = f.order?.foe === foe.id ? -1000 : foe.state === 'rout' ? 50 : 0;
        if (d + pref < aimD) {
          aimD = d + pref;
          aim = foe;
        }
      }
      if (aim !== null) {
        f.state = 'shoot';
        f.target = aim.id;
        if (f.pos !== null)
          steer(city, o, f.pos.x, f.pos.z, 0, TURN * dt, angleTo(o.at.x, o.at.z, aim.x, aim.z));
        continue;
      }
    }
    // Men at ease go for raiders who come near, and for those shooting at them that they
    // could catch: footmen go for footmen, riders for anyone.
    if (f.order === null && !o.at.moving && reach === 0) {
      let near: Foe | null = null;
      let nearD = Infinity;
      for (const foe of war.foes) {
        if (foe.state === 'rout') continue;
        const d = Math.hypot(foe.x - o.at.x, foe.z - o.at.z);
        const shooting = foe.state === 'shoot' && foe.target === u.id && d < wd.combat.aware;
        const catchable = def.horse || !wd.enemies[foe.kind].horse;
        if ((d < wd.combat.guard || (shooting && catchable)) && d < nearD) {
          nearD = d;
          near = foe;
        }
      }
      if (near !== null) f.order = { foe: near.id, auto: true };
    }
    f.target = null;
    f.state = o.at.moving ? 'move' : 'idle';
    if (f.order === null) continue;
    // Sent against a raider: from afar by the march, the long way round if need be; near
    // it, straight at it, at a run for the last stretch, until the two are at blows.
    const foe = foeById.get(f.order.foe)!;
    const d = Math.hypot(foe.x - o.at.x, foe.z - o.at.z);
    if (f.pos === null && d > TAKE) {
      const last = f.sent;
      const moved = last === null || Math.hypot(last.x - foe.x, last.z - foe.z) > 6;
      if (!o.at.moving && moved && (last === null || war.time - last.time > 3)) {
        marchOrder(city, [u.id], foe.x, foe.z, angleTo(o.at.x, o.at.z, foe.x, foe.z));
        f.sent = { x: foe.x, z: foe.z, time: war.time };
      }
      continue;
    }
    const pos = take(city, o);
    let to: { x: number; z: number };
    if (reach > 0) {
      const face = angleTo(pos.x, pos.z, foe.x, foe.z);
      const stand = Math.max(0, d - reach * 0.8);
      to = { x: pos.x + Math.sin(face) * stand, z: pos.z + Math.cos(face) * stand };
    } else to = contactPoint(blocks.get(foe.id)!, pos.x, pos.z, o.b.d);
    const before = Math.hypot(to.x - pos.x, to.z - pos.z);
    const fast = reach === 0 && d < 8 ? wd.combat.chargeSpeed : 1;
    steer(
      city,
      o,
      to.x,
      to.z,
      def.march * fast * dt,
      TURN * dt,
      before < 1.5 ? angleTo(pos.x, pos.z, foe.x, foe.z) : null,
    );
    if (f.moving) f.state = 'move';
    // Walled off from it: the way round, by a march; the battle takes it again when near.
    f.stuck = before > 1 && Math.hypot(to.x - pos.x, to.z - pos.z) > before - 0.02 * dt ? f.stuck + dt : 0;
    if (f.stuck > STUCK) {
      f.stuck = 0;
      f.pos = null;
      marchOrder(city, [u.id], to.x, to.z, angleTo(to.x, to.z, foe.x, foe.z));
      f.sent = { x: foe.x, z: foe.z, time: war.time };
    }
  }
  // Blocks the battle moves do not stand in one another: those that crowd are eased apart.
  const held = ours.filter((o) => o.f.pos !== null);
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) ease(city, held[i], held[j], dt);
  }
  for (let i = 0; i < war.foes.length; i++) {
    for (let j = i + 1; j < war.foes.length; j++) easeFoes(city, war.foes[i], war.foes[j], blocks, dt);
  }

  // --- blows and arrows
  const c = wd.combat;
  const harm = new Map<Foe | Fighter, number>();
  const hurt = (who: Foe | Fighter, n: number): void => {
    harm.set(who, (harm.get(who) ?? 0) + n);
  };
  const defenceOf = (d: FighterDef): number => 1 + d.defense * c.defense;
  const ourBy = new Map(ours.map((o) => [o.u.id, o]));
  // Raiders strike.
  for (const foe of war.foes) {
    const def = wd.enemies[foe.kind];
    const o = foe.target === null ? undefined : ourBy.get(foe.target);
    if (o === undefined) continue;
    const theirs = city.balance.army.units[o.u.kind];
    if (foe.state === 'shoot') {
      const d = Math.hypot(o.at.x - foe.x, o.at.z - foe.z);
      const fall = 1 - 0.4 * clamp(d / Math.max(1, range(city, def)), 0, 1);
      const cover = shielded(theirs) && !sideOf(city, o.b, foe.x, foe.z).flanked ? c.shield : 1;
      hurt(o.f, ((foe.men * def.missile * c.missile * fall * cover) / defenceOf(theirs)) * dt);
      o.f.shot = true;
    } else if (foe.state === 'fight') {
      foe.contact += dt;
      // Struck by a charge the moment they meet.
      if (foe.charged && foe.contact <= dt + 1e-9) o.f.morale -= wd.morale.charged;
      const side = sideOf(city, o.b, foe.x, foe.z);
      let blow = (Math.min(foe.men, c.front) * def.melee * c.melee * side.mult) / defenceOf(theirs);
      if (foe.charged && foe.contact < c.chargeSeconds) blow *= def.horse ? c.charge : 1 + (c.charge - 1) / 2;
      if (def.horse && theirs.weapon === 'spear' && !side.flanked) blow /= c.spearVsHorse;
      if (o.f.state === 'rout') blow *= c.routed;
      hurt(o.f, blow * dt);
      if (side.flanked) o.f.shot = true;
    }
  }
  // Ours strike back.
  for (const o of ours) {
    const f = o.f;
    if (f.target === null) continue;
    const foe = foeById.get(f.target);
    if (foe === undefined) continue;
    const def = city.balance.army.units[o.u.kind];
    const theirs = wd.enemies[foe.kind];
    const fb = blocks.get(foe.id)!;
    if (f.state === 'shoot') {
      const d = Math.hypot(o.at.x - foe.x, o.at.z - foe.z);
      const fall = 1 - 0.4 * clamp(d / Math.max(1, range(city, def)), 0, 1);
      const cover = shielded(theirs) && !sideOf(city, fb, o.at.x, o.at.z).flanked ? c.shield : 1;
      hurt(foe, ((o.u.men * def.missile * c.missile * fall * cover) / defenceOf(theirs)) * dt);
      foe.shot = true;
    } else if (f.state === 'fight') {
      f.contact += dt;
      if (f.charged && f.contact <= dt + 1e-9) foe.morale -= wd.morale.charged;
      const side = sideOf(city, fb, o.at.x, o.at.z);
      let blow = (Math.min(o.u.men, c.front) * def.melee * c.melee * side.mult) / defenceOf(theirs);
      if (f.charged && f.contact < c.chargeSeconds) blow *= def.horse ? c.charge : 1 + (c.charge - 1) / 2;
      if (def.weapon === 'spear' && theirs.horse) blow *= c.spearVsHorse;
      if (def.horse && theirs.weapon === 'spear' && !side.flanked) blow /= c.spearVsHorse;
      if (foe.state === 'rout') blow *= c.routed;
      hurt(foe, blow * dt);
      if (side.flanked) foe.shot = true;
    }
  }

  // --- losses and morale
  const m = wd.morale;
  for (const foe of war.foes) {
    const def = wd.enemies[foe.kind];
    foe.wound += harm.get(foe) ?? 0;
    const dead = Math.min(foe.men, Math.floor(foe.wound));
    foe.wound -= dead;
    foe.men -= dead;
    war.killed += dead;
    foe.morale -= (m.loss * dead) / foe.start;
    if (foe.shot) foe.morale -= m.shot * dt;
    if (foe.state !== 'fight' && foe.state !== 'shoot' && !foe.shot) {
      foe.morale = Math.min(maxMorale(city, def), foe.morale + m.recover * dt);
    }
  }
  for (const o of ours) {
    const f = o.f;
    const def = city.balance.army.units[o.u.kind];
    f.wound += harm.get(f) ?? 0;
    const dead = Math.min(o.u.men, Math.floor(f.wound));
    f.wound -= dead;
    if (dead > 0) {
      o.u.men -= dead;
      war.lost += dead;
      f.morale -= (m.loss * dead) / def.men;
    }
    if (f.shot) f.morale -= m.shot * dt;
    if (f.state !== 'fight' && f.state !== 'shoot' && !f.shot && f.state !== 'rout') {
      f.morale = Math.min(maxMorale(city, def), f.morale + m.recover * dt);
    }
  }
  // Morale breaks: they run, and their fellows nearby waver.
  for (const foe of war.foes) {
    if (foe.state === 'rout' || foe.morale > m.rout) continue;
    foe.state = 'rout';
    foe.target = null;
    delete foe.way;
    for (const other of war.foes) {
      if (other !== foe && Math.hypot(other.x - foe.x, other.z - foe.z) < 8) other.morale -= m.nearbyRout;
    }
  }
  for (const o of ours) {
    const f = o.f;
    if (f.state === 'rout' || f.morale > m.rout || o.u.men <= wd.combat.destroyed) continue;
    f.state = 'rout';
    f.target = null;
    f.order = null;
    f.pos = null;
    returnOrder(city, [o.u.id]);
    notify(city, `${city.balance.army.units[o.u.kind].name} taburu bozguna uğradı, kışlaya kaçıyor.`, 'bad');
    for (const other of ours) {
      if (other !== o && Math.hypot(other.at.x - o.at.x, other.at.z - o.at.z) < 8)
        other.f.morale -= m.nearbyRout;
    }
  }

  // --- the fallen, the fled and the plunder
  for (const o of ours) {
    if (o.u.men > wd.combat.destroyed) continue;
    delete war.fighters[o.u.id];
    destroyUnit(city, o.u.id, `${city.balance.army.units[o.u.kind].name} taburu savaşta kırıldı.`);
  }
  const { grid } = city;
  war.foes = war.foes.filter((foe) => {
    if (foe.men <= wd.combat.destroyed) {
      war.killed += foe.men;
      return false;
    }
    const gone = foe.state === 'rout' || foe.state === 'withdraw';
    const out = Math.abs(foe.x) > grid.half - 3 || Math.abs(foe.z) > grid.half - 3;
    // Those who cannot find their way off scatter after a while.
    const home = Math.hypot(foe.x - war.exit.x, foe.z - war.exit.z) < 2 || foe.fleeing > FLEE_MOST;
    return !(gone && (out || home));
  });
  const plunderers = war.foes.filter((f) => f.state === 'pillage');
  if (plunderers.length > 0) {
    if (war.pillaged === 0) {
      notify(city, `${war.people} ${war.gate} önünde varoşları yağmalıyor!`, 'bad');
    }
    war.pillaged += dt;
    const men = plunderers.reduce((s, f) => s + f.men, 0);
    const akce = Math.max(0, city.treasury) * wd.pillage.treasury * (men / 100) * dt;
    const people = Math.min(city.population, wd.pillage.people * men * dt);
    city.treasury -= akce;
    city.population -= people;
    war.taken.akce += akce;
    war.taken.people += people;
  }
  if (war.foes.length === 0) endWar(city);
}

/** The raid is over: its tally told, the loot of the fallen taken, the field cleared. */
function endWar(city: CityState): void {
  const war = city.war!;
  const wd = city.balance.army.war;
  const loot = war.killed * wd.loot;
  city.treasury += loot;
  const plundered = war.taken.akce >= 1 || war.taken.people >= 1;
  const tally = `Düşmandan ${fmt(war.killed)} ölü, bizden ${fmt(war.lost)} şehit`;
  if (plundered) {
    notify(
      city,
      `${war.people} yağmayla çekildi: ${fmt(war.taken.akce)} akçe ve ${fmt(war.taken.people)} can gitti. ${tally}.`,
      'bad',
    );
  } else {
    notify(city, `Zafer! ${war.name} püskürtüldü. ${tally}; ganimet ${fmt(loot)} akçe.`, 'good');
  }
  // Our taburs out in the field stand down where the battle left them.
  city.war = null;
  city.revision.army++;
}

function newFighter(city: CityState, u: Unit): Fighter {
  return {
    morale: maxMorale(city, city.balance.army.units[u.kind]),
    state: 'idle',
    target: null,
    order: null,
    sent: null,
    contact: -1,
    charged: false,
    wound: 0,
    shot: false,
    pos: null,
    moving: false,
    stuck: 0,
  };
}

interface Ours {
  u: Unit;
  f: Fighter;
  at: Whereabouts;
  b: Block;
}

/**
 * Takes one of our taburs in hand: from now the battle moves it, from where it is seen,
 * and whatever march it was on is over.
 */
function take(city: CityState, o: Ours): { x: number; z: number; heading: number } {
  const f = o.f;
  if (f.pos !== null) return f.pos;
  f.pos = { x: o.at.x, z: o.at.z, heading: o.at.heading };
  o.u.field = { x: o.at.x, z: o.at.z, heading: o.at.heading, formation: o.u.field?.formation ?? 'kare' };
  city.revision.army++;
  return f.pos;
}

/**
 * Moves a tabur in hand up to `most` tiles toward a point, round what is in the way, and
 * turns it by up to `turn` radians: toward `face` if given, else the way it goes. Its post
 * in the field follows it, without a march.
 */
function steer(
  city: CityState,
  o: Ours,
  x: number,
  z: number,
  most: number,
  turn: number,
  face: number | null,
): void {
  const pos = o.f.pos!;
  const d = Math.hypot(x - pos.x, z - pos.z);
  let heading = face;
  if (d > 0.03 && most > 0) {
    const want = angleTo(pos.x, pos.z, x, z);
    const step = Math.min(d, most);
    for (const aside of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
      const h = want + aside;
      const nx = pos.x + Math.sin(h) * step;
      const nz = pos.z + Math.cos(h) * step;
      if (!ourGround(city, nx, nz)) continue;
      pos.x = nx;
      pos.z = nz;
      o.f.moving = step > 1e-3;
      heading ??= h;
      break;
    }
  }
  if (heading !== null) pos.heading = turnToward(pos.heading, heading, turn);
  const field = o.u.field;
  if (field !== null) {
    field.x = pos.x;
    field.z = pos.z;
    field.heading = pos.heading;
  }
  o.at = { ...pos, moving: o.f.moving };
}

/** Whether our taburs may stand at a point: open ground or a street, gates and all. */
function ourGround(city: CityState, x: number, z: number): boolean {
  const { grid } = city;
  const tx = grid.tileOf(x);
  const tz = grid.tileOf(z);
  return grid.inBounds(tx, tz) && standGround(city, grid.index(tx, tz));
}

/** Whether raiders could go straight from one point to another. */
function clearLine(city: CityState, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
  for (let k = 1; k <= n; k++) {
    if (!foeGround(city, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)) return false;
  }
  return true;
}

/** Eases apart two of our blocks in hand when either stands in the other. */
function ease(city: CityState, a: Ours, b: Ours, dt: number): void {
  const pa = a.f.pos!;
  const pb = b.f.pos!;
  const inside = gapTo(b.b, pa.x, pa.z) < 0.05 || gapTo(a.b, pb.x, pb.z) < 0.05;
  if (!inside) return;
  const d = Math.hypot(pa.x - pb.x, pa.z - pb.z) || 0.01;
  const push = Math.min(0.6 * dt, 0.3);
  const ux = (pa.x - pb.x) / d;
  const uz = (pa.z - pb.z) / d;
  if (ourGround(city, pa.x + ux * push, pa.z + uz * push)) {
    pa.x += ux * push;
    pa.z += uz * push;
  }
  if (ourGround(city, pb.x - ux * push, pb.z - uz * push)) {
    pb.x -= ux * push;
    pb.z -= uz * push;
  }
  for (const o of [a, b]) {
    const field = o.u.field;
    if (field === null) continue;
    field.x = o.f.pos!.x;
    field.z = o.f.pos!.z;
  }
}

/** Eases apart two raider blocks when either stands in the other. */
function easeFoes(city: CityState, a: Foe, b: Foe, blocks: Map<number, Block>, dt: number): void {
  const ba = blocks.get(a.id);
  const bb = blocks.get(b.id);
  if (ba === undefined || bb === undefined) return;
  if (gapTo(bb, a.x, a.z) >= 0.05 && gapTo(ba, b.x, b.z) >= 0.05) return;
  const d = Math.hypot(a.x - b.x, a.z - b.z) || 0.01;
  const push = Math.min(0.6 * dt, 0.3);
  const ux = (a.x - b.x) / d;
  const uz = (a.z - b.z) / d;
  if (foeGround(city, a.x + ux * push, a.z + uz * push)) {
    a.x += ux * push;
    a.z += uz * push;
  }
  if (foeGround(city, b.x - ux * push, b.z - uz * push)) {
    b.x -= ux * push;
    b.z -= uz * push;
  }
}

/**
 * Sends our taburs against a raider tabur: they march toward it, and the battle takes them
 * in hand when they are near.
 */
export function attackOrder(city: CityState, ids: readonly number[], foe: number): number {
  const war = city.war;
  const target = war?.foes.find((f) => f.id === foe);
  if (war === null || target === undefined) return 0;
  const sent: number[] = [];
  for (const id of ids) {
    const u = city.army.units.find((x) => x.id === id);
    if (u === undefined || u.drill !== null) continue;
    const f = (war.fighters[id] ??= newFighter(city, u));
    if (f.state === 'rout') continue;
    f.order = { foe, auto: false };
    f.sent = { x: target.x, z: target.z, time: war.time };
    f.stuck = 0;
    // Those the battle already has in hand go straight at it; the rest march toward it.
    if (f.pos === null) sent.push(id);
  }
  if (sent.length > 0) {
    marchOrder(city, sent, target.x, target.z, angleTo(0, 0, target.x, target.z));
  }
  return ids.filter((id) => war.fighters[id]?.order?.foe === foe).length;
}

/** Our taburs given other orders stop going after whatever they were sent against. */
export function dropAttack(city: CityState, ids: readonly number[]): void {
  const war = city.war;
  if (war === null) return;
  for (const id of ids) {
    const f = war.fighters[id] as Fighter | undefined;
    if (f === undefined) continue;
    f.order = null;
    f.sent = null;
    // Out of the battle's hands: it marches again where it is sent.
    if (f.pos !== null) {
      f.pos = null;
      city.revision.army++;
    }
  }
}

/** The raider tabur whose ground is nearest a point, within `reach` tiles of it, if any. */
export function foeAt(city: CityState, x: number, z: number, reach: number): Foe | null {
  const war = city.war;
  if (war === null) return null;
  let best: Foe | null = null;
  let bestGap = reach;
  for (const foe of war.foes) {
    const gap = gapTo(blockOfFoe(city, foe), x, z);
    if (gap <= bestGap) {
      bestGap = gap;
      best = foe;
    }
  }
  return best;
}

/** A raider tabur's ground: its middle, the way it faces, its front and depth. */
export function foeGroundOf(city: CityState, foe: Foe): Block {
  return blockOfFoe(city, foe);
}

/** How a tabur's morale stands, 0..1 of the most it can have. */
export function moraleShare(city: CityState, morale: number, def: FighterDef): number {
  return clamp(morale / maxMorale(city, def), 0, 1);
}

// ------------------------------------------------------------------ moving raiders

function pathLength(way: Array<[number, number]>): number {
  let n = 0;
  for (let k = 1; k < way.length; k++) n += Math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]);
  return n;
}

/** The point `s` along a way, and the heading there. */
function pointAlong(way: Array<[number, number]>, s: number): { x: number; z: number; heading: number } {
  let left = s;
  for (let k = 1; k < way.length; k++) {
    const [ax, az] = way[k - 1];
    const [bx, bz] = way[k];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || k === way.length - 1) {
      const u = len > 0 ? clamp(left / len, 0, 1) : 1;
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, heading: angleTo(ax, az, bx, bz) };
    }
    left -= len;
  }
  return { x: way[0][0], z: way[0][1], heading: 0 };
}

/** Where a raider tabur's place in the array is now, as the raid moves along its way. */
function slotAt(war: War, foe: Foe): { x: number; z: number; heading: number } {
  const p = pointAlong(war.way, war.along);
  // Looking a little ahead, so the array turns smoothly with the road.
  const q = pointAlong(war.way, war.along + 3);
  const heading = Math.hypot(q.x - p.x, q.z - p.z) > 0.1 ? angleTo(p.x, p.z, q.x, q.z) : p.heading;
  const a = axes(heading);
  const [r, f] = foe.slot;
  return { x: p.x + a.rx * r + a.fx * f, z: p.z + a.rz * r + a.fz * f, heading };
}

/**
 * Moves a raider up to `most` tiles toward a point, round what is in the way, turning it
 * by up to `turn` radians toward the way it goes.
 */
function stepToward(city: CityState, foe: Foe, x: number, z: number, most: number, turn: number): void {
  const d = Math.hypot(x - foe.x, z - foe.z);
  if (d < 0.05) return;
  const want = angleTo(foe.x, foe.z, x, z);
  const step = Math.min(d, most);
  for (const aside of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const h = want + aside;
    const nx = foe.x + Math.sin(h) * step;
    const nz = foe.z + Math.cos(h) * step;
    if (!foeGround(city, nx, nz)) continue;
    foe.x = nx;
    foe.z = nz;
    foe.heading = turnToward(foe.heading, h, turn);
    return;
  }
}

/** Moves a raider along a way of its own, dropping the points it has passed. */
function followWay(
  city: CityState,
  foe: Foe,
  way: Array<[number, number]>,
  most: number,
  turn: number,
): void {
  while (way.length > 1 && Math.hypot(way[0][0] - foe.x, way[0][1] - foe.z) < 1) way.shift();
  stepToward(city, foe, way[0][0], way[0][1], most, turn);
}

const fmt = (n: number): string => Math.round(n).toLocaleString('tr-TR');
