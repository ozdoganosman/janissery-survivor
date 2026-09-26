import { smoothPath, smoothstep, clamp01, type Vec2 } from '../core/geom';
import { fbm } from '../core/noise';
import type { CityDef } from './city-def';
import { Grid } from './grid';

/**
 * The land itself: height, water and how good the soil is. Generated once from the city
 * definition and never changed by play (yet), so everything else can treat it as given.
 */
export interface Terrain {
  grid: Grid;
  /** Heights at tile corners, (size + 1)^2 values. The renderer's mesh uses these directly. */
  corner: Float32Array;
  /** Mean height of each tile. */
  height: Float32Array;
  /** Largest height difference between a tile's corners: how steep it is to build on. */
  slope: Float32Array;
  /** 1 where the stream runs. */
  water: Uint8Array;
  /** Distance from the tile centre to the stream's centre line, in tiles. */
  waterDistance: Float32Array;
  /** Suitability for fields, 0 (useless) to 1 (the best bottom land). */
  fertility: Float32Array;
  /** Index + 1 of the ore deposit under the tile, or 0. */
  ore: Uint8Array;
  /** The stream's centre line, smoothed. */
  streamPath: Vec2[];
  /** Height of the water surface. */
  waterLevel: number;
}

/** Depth the stream bed is cut below the surrounding land. */
const STREAM_DEPTH = 0.6;
export const WATER_LEVEL = -0.22;

export function generateTerrain(def: CityDef): Terrain {
  const grid = new Grid(def.size);
  const streamPath = smoothPath(def.stream.points, 0.5);
  const halfWidth = def.stream.width / 2;

  const baseHeight = (x: number, z: number, streamDist: number): number => {
    let h = (fbm(x * 0.06, z * 0.06, 3, def.seed) - 0.5) * 0.25;
    const r = Math.hypot(x - def.tepe.x, z - def.tepe.z);
    h += def.tepe.height * (1 - smoothstep(def.tepe.topRadius, def.tepe.footRadius, r));
    // Hills rise to the north and west but leave a valley floor along the stream.
    const valley = smoothstep(4, 18, streamDist);
    const rough = 0.35 + fbm(x * 0.04 + 11, z * 0.04 - 7, 4, def.seed + 1);
    const { north, west } = def.hills;
    h += north.height * smoothstep(north.from, north.to, z) * rough * valley;
    h += west.height * smoothstep(west.from, west.to, x) * rough * valley;
    return h;
  };
  const n = grid.size;
  // Stream distance at every corner and every tile centre, computed once.
  const cornerDist = distanceField(n + 1, -grid.half, streamPath);
  const centreDist = distanceField(n, -grid.half + 0.5, streamPath);

  const corner = new Float32Array((n + 1) * (n + 1));
  for (let cz = 0; cz <= n; cz++) {
    for (let cx = 0; cx <= n; cx++) {
      const i = grid.cornerIndex(cx, cz);
      const d = cornerDist[i];
      const carve = STREAM_DEPTH * (1 - smoothstep(halfWidth * 0.6, halfWidth + 1.1, d));
      corner[i] = baseHeight(cx - grid.half, cz - grid.half, d) - carve;
    }
  }

  const height = new Float32Array(grid.count);
  const slope = new Float32Array(grid.count);
  const water = new Uint8Array(grid.count);
  const waterDistance = new Float32Array(grid.count);
  const fertility = new Float32Array(grid.count);
  const wallR = def.walls.radius;

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = grid.index(x, z);
      const c00 = corner[grid.cornerIndex(x, z)];
      const c10 = corner[grid.cornerIndex(x + 1, z)];
      const c01 = corner[grid.cornerIndex(x, z + 1)];
      const c11 = corner[grid.cornerIndex(x + 1, z + 1)];
      const h = (c00 + c10 + c01 + c11) / 4;
      height[i] = h;
      slope[i] = Math.max(c00, c10, c01, c11) - Math.min(c00, c10, c01, c11);

      const wx = grid.centre(x);
      const wz = grid.centre(z);
      const d = centreDist[i];
      waterDistance[i] = d;
      // A little wider than the nominal width: the banks are cut below the water line too.
      const isWater = d < halfWidth + 0.35;
      water[i] = isWater ? 1 : 0;

      const inCity = Math.hypot(wx - def.tepe.x, wz - def.tepe.z) < wallR + 1.5;
      if (isWater || inCity) {
        fertility[i] = 0;
        continue;
      }
      // Bottom land by the stream is best; dry steppe is middling; hillsides are poor.
      let f = 0.34 + 0.3 * fbm(wx * 0.08, wz * 0.08, 3, def.seed + 7);
      f += 0.42 * (1 - smoothstep(1.5, 16, d));
      f -= 0.45 * smoothstep(0.6, 3.2, h);
      f -= 0.5 * smoothstep(0.18, 0.55, slope[i]);
      fertility[i] = Math.round(clamp01(f) * 100) / 100;
    }
  }

  // Ore deposits: ragged patches, so the seam reads as found rather than drawn.
  const ore = new Uint8Array(grid.count);
  def.deposits.forEach((dep, k) => {
    const reach = Math.ceil(dep.radius * 1.3);
    for (let z = grid.tileOf(dep.z) - reach; z <= grid.tileOf(dep.z) + reach; z++) {
      for (let x = grid.tileOf(dep.x) - reach; x <= grid.tileOf(dep.x) + reach; x++) {
        if (!grid.inBounds(x, z)) continue;
        const wx = grid.centre(x);
        const wz = grid.centre(z);
        const edge = dep.radius * (0.75 + 0.5 * fbm(wx * 0.5, wz * 0.5, 2, def.seed + 13 + k));
        const i = grid.index(x, z);
        if (Math.hypot(wx - dep.x, wz - dep.z) < edge && water[i] === 0) ore[i] = k + 1;
      }
    }
  });

  return {
    grid,
    corner,
    height,
    slope,
    water,
    waterDistance,
    fertility,
    ore,
    streamPath,
    waterLevel: WATER_LEVEL,
  };
}

/** Distances beyond this are not tracked; everything that cares about the stream fades out sooner. */
const DISTANCE_CAP = 40;

/**
 * Distance from each point of a `count` x `count` lattice (spacing 1, first point at
 * `origin` on both axes) to a polyline, capped at DISTANCE_CAP. Each segment only visits
 * the lattice points near it, which is what makes this cheap.
 */
function distanceField(count: number, origin: number, path: readonly Vec2[]): Float32Array {
  const out = new Float32Array(count * count).fill(DISTANCE_CAP);
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s];
    const [bx, bz] = path[s + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - DISTANCE_CAP - origin));
    const x1 = Math.min(count - 1, Math.ceil(Math.max(ax, bx) + DISTANCE_CAP - origin));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz) - DISTANCE_CAP - origin));
    const z1 = Math.min(count - 1, Math.ceil(Math.max(az, bz) + DISTANCE_CAP - origin));
    for (let iz = z0; iz <= z1; iz++) {
      const pz = iz + origin;
      for (let ix = x0; ix <= x1; ix++) {
        const px = ix + origin;
        const t = len2 > 0 ? clamp01(((px - ax) * dx + (pz - az) * dz) / len2) : 0;
        const d = Math.hypot(ax + dx * t - px, az + dz * t - pz);
        const k = iz * count + ix;
        if (d < out[k]) out[k] = d;
      }
    }
  }
  return out;
}

/** Bilinear height at any world position, matching the rendered terrain surface. */
export function sampleHeight(t: Terrain, x: number, z: number): number {
  const n = t.grid.size;
  const fx = Math.min(n - 1e-6, Math.max(0, x + t.grid.half));
  const fz = Math.min(n - 1e-6, Math.max(0, z + t.grid.half));
  const cx = Math.floor(fx);
  const cz = Math.floor(fz);
  const ux = fx - cx;
  const uz = fz - cz;
  const c = t.corner;
  const g = t.grid;
  const h00 = c[g.cornerIndex(cx, cz)];
  const h10 = c[g.cornerIndex(cx + 1, cz)];
  const h01 = c[g.cornerIndex(cx, cz + 1)];
  const h11 = c[g.cornerIndex(cx + 1, cz + 1)];
  return (h00 * (1 - ux) + h10 * ux) * (1 - uz) + (h01 * (1 - ux) + h11 * ux) * uz;
}
