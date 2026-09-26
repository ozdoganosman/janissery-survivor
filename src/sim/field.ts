import type { FormationKind, UnitDef } from './balance';
import type { Unit } from './army';
import type { CityState } from './city';
import { reachFrom, standGround } from './paths';
import { wallDepth } from './walls';

/**
 * The army out of its barracks. A company ordered out stands somewhere on the map in a
 * formation; the orders say where. How the men get there (the march through the streets)
 * is the view's business: the rules only keep where each company is bound, so a save
 * brings the army back where it was sent.
 */

/** Where a company stands in the field: its centre, the way it faces, and its formation. */
export interface FieldPost {
  x: number;
  z: number;
  /** Radians; 0 faces +z (south), π/2 faces +x (east). */
  heading: number;
  formation: FormationKind;
}

/** Companies are laid in lines no wider than this (tiles); more stand in lines behind. */
const LINE_WIDTH = 24;
/** Room between companies side by side, and between lines. */
const GAP = 0.5;

/** Forward and to-the-right unit vectors for a heading. */
export function axes(heading: number): { fx: number; fz: number; rx: number; rz: number } {
  const s = Math.sin(heading);
  const c = Math.cos(heading);
  return { fx: s, fz: c, rx: -c, rz: s };
}

/** Men abreast in a formation. */
export function formationCols(city: CityState, formation: FormationKind, men: number): number {
  return Math.max(1, Math.min(men, city.balance.army.formations[formation].cols));
}

/** Front and depth of a company in ranks `cols` men wide, in tiles. */
export function companySize(def: UnitDef, men: number, cols: number): { w: number; d: number } {
  const c = Math.max(1, Math.min(cols, men));
  return { w: c * def.file, d: Math.ceil(men / c) * def.rank };
}

/**
 * Where man `k` of a company stands about its centre, as [to its right, forward]: the
 * first rank at the front, each rank filled from the left.
 */
export function slotOf(def: UnitDef, men: number, cols: number, k: number): [number, number] {
  const c = Math.max(1, Math.min(cols, men));
  const ranks = Math.ceil(men / c);
  const col = k % c;
  const rank = Math.floor(k / c);
  return [(col - (c - 1) / 2) * def.file, ((ranks - 1) / 2 - rank) * def.rank];
}

/** A point of a company's ground, from [to its right, forward] about its centre, in the world. */
export function fieldPoint(post: FieldPost, right: number, forward: number): [number, number] {
  const a = axes(post.heading);
  return [post.x + a.rx * right + a.fx * forward, post.z + a.rz * right + a.fz * forward];
}

export interface OrderResult {
  /** Companies that took the order. */
  moved: number;
  /** Companies still at drill, which cannot leave the barracks. */
  drilling: number;
  problem?: string;
}

function unitsOf(city: CityState, ids: readonly number[]): Unit[] {
  const set = new Set(ids);
  const byId = new Map(city.army.units.filter((u) => set.has(u.id)).map((u) => [u.id, u]));
  // In the order given: the caller lines them up left to right.
  return ids.map((id) => byId.get(id)).filter((u): u is Unit => u !== undefined);
}

/** Whether troops can stand at a point: on the map and on dry land. */
export function standable(city: CityState, x: number, z: number): boolean {
  const { grid } = city;
  const tx = grid.tileOf(x);
  const tz = grid.tileOf(z);
  if (!grid.inBounds(tx, tz)) return false;
  const i = grid.index(tx, tz);
  return city.terrain.water[i] === 0 || city.road[i] === 1;
}

/** How far round the point ordered companies look for clear ground (tiles). */
const SEARCH = 40;

/**
 * Sends companies to stand at a point, facing `heading`: side by side from left to right in
 * the order given, in lines one behind another, drawn up about twice as wide as deep. Each
 * company stands on clear ground: not on a wall, in the water, in a house or a building,
 * not across a wall from the point it was sent to, and not where only a long way round
 * would bring it; where its place in the lines is not
 * clear, it takes the nearest place that is. Each keeps its formation, or takes
 * `formation` if one is given. Companies still at drill stay in the barracks.
 */
export function marchOrder(
  city: CityState,
  ids: readonly number[],
  x: number,
  z: number,
  heading: number,
  formation?: FormationKind,
): OrderResult {
  const units = unitsOf(city, ids);
  const ready = units.filter((u) => u.drill === null);
  const out: OrderResult = { moved: 0, drilling: units.length - ready.length };
  const origin = standable(city, x, z) ? nearestGround(city, x, z) : null;
  if (origin === null) return { ...out, problem: 'Oraya yürünmez' };
  if (ready.length === 0) {
    return out.drilling > 0 ? { ...out, problem: 'Talimdeki bölük kışladan çıkamaz' } : out;
  }
  const defs = city.balance.army.units;
  const placed = ready.map((u) => {
    const f = formation ?? u.field?.formation ?? 'kare';
    const size = companySize(defs[u.kind], u.men, formationCols(city, f, u.men));
    return { u, f, ...size };
  });
  // Lines of about the square root of twice the companies: an army twice as wide as deep.
  const perLine = Math.min(placed.length, Math.ceil(Math.sqrt(placed.length * 2)));
  const lines: Array<typeof placed> = [[]];
  let width = 0;
  for (const p of placed) {
    const line = lines[lines.length - 1];
    if (line.length > 0 && (line.length >= perLine || width + GAP + p.w > LINE_WIDTH)) {
      lines.push([p]);
      width = p.w;
    } else {
      width += (line.length > 0 ? GAP : 0) + p.w;
      line.push(p);
    }
  }
  const a = axes(heading);
  const { grid } = city;
  const reach = reachFrom(city, origin.x, origin.z, SEARCH);
  // The army stands on the same side of every wall as the point it was sent to.
  const side = wallDepth(city, origin.x, origin.z);
  const world = (r: number, f: number): [number, number] => [
    x + a.rx * r + a.fx * f,
    z + a.rz * r + a.fz * f,
  ];
  /** Whether a company's ground is clear, and near enough by the ways troops walk. */
  const clear = (r: number, f: number, w: number, d: number): boolean => {
    for (const u of SAMPLES) {
      for (const v of SAMPLES) {
        const [px, pz] = world(r + u * w, f + v * d);
        const tx = grid.tileOf(px);
        const tz = grid.tileOf(pz);
        if (!grid.inBounds(tx, tz)) return false;
        const i = grid.index(tx, tz);
        if (!standGround(city, i) || reach[i] === Infinity) return false;
        if (wallDepth(city, px, pz) !== side) return false;
      }
    }
    const [cx, cz] = world(r, f);
    // Not somewhere only a long way round would reach, such as the far side of a wall.
    return reach[grid.index(grid.tileOf(cx), grid.tileOf(cz))] <= Math.hypot(r, f) * 1.5 + 4;
  };
  const taken: Array<{ r: number; f: number; w: number; d: number }> = [];
  const free = (r: number, f: number, w: number, d: number): boolean =>
    taken.every(
      (t) => Math.abs(t.r - r) >= (t.w + w) / 2 + GAP / 2 || Math.abs(t.f - f) >= (t.d + d) / 2 + GAP / 2,
    );
  let back = 0;
  for (const line of lines) {
    const total = line.reduce((n, p) => n + p.w, 0) + GAP * (line.length - 1);
    const depth = Math.max(...line.map((p) => p.d));
    let across = -total / 2;
    for (const p of line) {
      // Its place in the lines; each line's front rank is level.
      const r0 = across + p.w / 2;
      const f0 = -back - p.d / 2;
      across += p.w + GAP;
      let spot: [number, number] | null = null;
      for (const [i, j] of RINGS) {
        const r = r0 + i * (p.w + GAP) * 0.5;
        const f = f0 + j * (p.d + GAP) * 0.5;
        if (free(r, f, p.w, p.d) && clear(r, f, p.w, p.d)) {
          spot = [r, f];
          break;
        }
      }
      const [r, f] = spot ?? [r0, f0];
      taken.push({ r, f, w: p.w, d: p.d });
      const [px, pz] = world(r, f);
      p.u.field = { x: px, z: pz, heading, formation: p.f };
    }
    back += depth + GAP;
  }
  city.revision.army++;
  return { ...out, moved: ready.length };
}

/** Points over a company's ground checked for clear footing, as shares of its size. */
const SAMPLES = [-0.5, -0.17, 0.17, 0.5];

/** Steps away from a company's place in the lines, nearest first, to look for clear ground. */
const RINGS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let j = -16; j <= 16; j++) for (let i = -16; i <= 16; i++) out.push([i, j]);
  // Nearest first; at a like distance, rather behind the line than before it.
  return out.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]) || p[1] - q[1]);
})();

/** The nearest tile troops can stand on to a point, within a few tiles, or null. */
function nearestGround(city: CityState, x: number, z: number): { x: number; z: number } | null {
  const { grid } = city;
  const cx = grid.tileOf(x);
  const cz = grid.tileOf(z);
  for (let r = 0; r <= 3; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !grid.inBounds(cx + dx, cz + dz)) continue;
        if (standGround(city, grid.index(cx + dx, cz + dz))) {
          return r === 0 ? { x, z } : { x: grid.centre(cx + dx), z: grid.centre(cz + dz) };
        }
      }
    }
  }
  return null;
}

/** Sends companies in the field back to the barracks. Returns how many were out. */
export function returnOrder(city: CityState, ids: readonly number[]): number {
  let n = 0;
  for (const u of unitsOf(city, ids)) {
    if (u.field === null) continue;
    u.field = null;
    n++;
  }
  if (n > 0) city.revision.army++;
  return n;
}

/** The middle of the companies in the field among `ids`, and the way the first faces. */
function groupCentre(units: Unit[]): { x: number; z: number; heading: number } | null {
  const out = units.filter((u) => u.field !== null);
  if (out.length === 0) return null;
  let x = 0;
  let z = 0;
  for (const u of out) {
    x += u.field!.x;
    z += u.field!.z;
  }
  return { x: x / out.length, z: z / out.length, heading: out[0].field!.heading };
}

/**
 * Puts the companies in the field among `ids` into another formation, drawn up again in
 * line about where they stand. Returns how many changed.
 */
export function formationOrder(city: CityState, ids: readonly number[], formation: FormationKind): number {
  const units = unitsOf(city, ids).filter((u) => u.field !== null);
  const centre = groupCentre(units);
  if (centre === null) return 0;
  const a = axes(centre.heading);
  // Keep them in the order they stand, left to right.
  units.sort((p, q) => {
    const pr = (p.field!.x - centre.x) * a.rx + (p.field!.z - centre.z) * a.rz;
    const qr = (q.field!.x - centre.x) * a.rx + (q.field!.z - centre.z) * a.rz;
    return pr - qr;
  });
  // The line's front stays where the front of the group is now.
  const front = Math.max(
    ...units.map((u) => (u.field!.x - centre.x) * a.fx + (u.field!.z - centre.z) * a.fz),
  );
  const defs = city.balance.army.units;
  const depthNow = Math.max(
    ...units.map((u) => companySize(defs[u.kind], u.men, formationCols(city, u.field!.formation, u.men)).d),
  );
  const fx = centre.x + a.fx * (front + depthNow / 2);
  const fz = centre.z + a.fz * (front + depthNow / 2);
  return marchOrder(
    city,
    units.map((u) => u.id),
    fx,
    fz,
    centre.heading,
    formation,
  ).moved;
}

/** Wheels the companies in the field among `ids` about their middle by `turn` radians. */
export function faceOrder(city: CityState, ids: readonly number[], turn: number): number {
  const units = unitsOf(city, ids).filter((u) => u.field !== null);
  const centre = groupCentre(units);
  if (centre === null) return 0;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  for (const u of units) {
    const f = u.field!;
    const dx = f.x - centre.x;
    const dz = f.z - centre.z;
    // Turning the heading by `turn` turns the ground under it the same way.
    f.x = centre.x + dx * c + dz * s;
    f.z = centre.z - dx * s + dz * c;
    f.heading += turn;
  }
  city.revision.army++;
  return units.length;
}

/**
 * Stops companies where they are: each takes the ground it stands on now, as the view
 * reports it. A company still on the barracks' own ground is home.
 */
export function haltOrder(
  city: CityState,
  where: ReadonlyMap<number, { x: number; z: number; heading: number }>,
): number {
  let n = 0;
  const { grid } = city;
  for (const u of city.army.units) {
    const p = where.get(u.id);
    if (p === undefined || u.drill !== null) continue;
    const tx = grid.tileOf(p.x);
    const tz = grid.tileOf(p.z);
    const home =
      grid.inBounds(tx, tz) && city.buildings.get(city.building[grid.index(tx, tz)])?.kind === 'kisla';
    u.field = home ? null : { x: p.x, z: p.z, heading: p.heading, formation: u.field?.formation ?? 'kare' };
    n++;
  }
  if (n > 0) city.revision.army++;
  return n;
}
