import type { Grid } from './grid';
import { DIRS4 } from './grid';

/** Steps (4-connected) from each tile to the nearest road, up to `max`; 255 beyond that. */
export function roadDistance(city: { grid: Grid; road: Uint8Array }, max: number): Uint8Array {
  const { grid } = city;
  const dist = new Uint8Array(grid.count).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < grid.count; i++) {
    if (city.road[i] === 1) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let step = 1; step <= max; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % grid.size;
      const z = Math.floor(i / grid.size);
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx;
        const nz = z + dz;
        if (!grid.inBounds(nx, nz)) continue;
        const j = grid.index(nx, nz);
        if (dist[j] !== 255) continue;
        dist[j] = step;
        next.push(j);
      }
    }
    frontier = next;
  }
  return dist;
}
