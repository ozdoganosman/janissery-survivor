import { hash2 } from './rng';

/** Smooth value noise in [0, 1). Cheap, deterministic and good enough for terrain. */
export function valueNoise(x: number, z: number, salt = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** Fractal sum of value noise, normalised back into [0, 1). */
export function fbm(x: number, z: number, octaves = 4, salt = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, salt + i * 31);
    norm += amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}
