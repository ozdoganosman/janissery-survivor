/** Small, dependency-free geometry helpers shared by the simulation and the renderer. */

export type Vec2 = readonly [number, number];

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite step. Works with reversed edges (e0 > e1), which reads naturally for fall-offs. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export interface PathHit {
  /** Distance from the query point to the path. */
  distance: number;
  x: number;
  z: number;
  /** Index of the segment the closest point lies on. */
  segment: number;
}

/** Closest point on a polyline. */
export function nearestOnPath(x: number, z: number, path: readonly Vec2[]): PathHit {
  let best = Infinity;
  let hit: PathHit = { distance: Infinity, x, z, segment: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / len2) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d2 = (px - x) ** 2 + (pz - z) ** 2;
    if (d2 < best) {
      best = d2;
      hit = { distance: 0, x: px, z: pz, segment: i };
    }
  }
  hit.distance = Math.sqrt(best);
  return hit;
}

/**
 * Catmull-Rom interpolation through control points, resampled at roughly `step` spacing.
 * Rivers and streets are authored as a few points and drawn as smooth curves.
 */
export function smoothPath(points: readonly Vec2[], step = 1): Vec2[] {
  if (points.length < 2) return points.slice();
  const out: Vec2[] = [];
  const get = (i: number): Vec2 => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Chaikin corner cutting. Turns the staircase of a tile-rasterised road into a smooth
 * curve while keeping its end points fixed, so roads still meet at junction centres.
 */
export function chaikin(points: readonly Vec2[], iterations = 2, closed = false): Vec2[] {
  let pts = points.slice();
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out: Vec2[] = [];
    const n = pts.length;
    if (!closed) out.push(pts[0]);
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const q: Vec2 = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
      const r: Vec2 = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
      if (closed || i > 0) out.push(q);
      if (closed || i < last - 1) out.push(r);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Every tile a straight segment between two tile centres passes through, as a
 * 4-connected chain: consecutive tiles always share an edge, never just a corner.
 *
 * Roads are 4-connected in the simulation, so a diagonal drag has to become a staircase;
 * the renderer smooths that staircase back into a diagonal line.
 */
export function supercoverLine(x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [[x0, z0]];
  const dx = x1 - x0;
  const dz = z1 - z0;
  const nx = Math.abs(dx);
  const nz = Math.abs(dz);
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  let x = x0;
  let z = z0;
  let ix = 0;
  let iz = 0;
  while (ix < nx || iz < nz) {
    // Compare where the next x-step and next z-step boundaries fall along the segment.
    const decision = (1 + 2 * ix) * nz - (1 + 2 * iz) * nx;
    if (decision < 0 || (decision === 0 && nx >= nz)) {
      x += sx;
      ix++;
    } else {
      z += sz;
      iz++;
    }
    out.push([x, z]);
  }
  return out;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
