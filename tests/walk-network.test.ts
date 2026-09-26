import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { advanceWalk, buildWalkNetwork, spawnWalk, walkPoint } from '../src/render/walk-network';
import { newCity } from './helpers';

describe('the walking network', () => {
  const city = newCity();
  const net = buildWalkNetwork(city, () => 1);
  const { grid } = city;

  it('joins the streets at their junctions', () => {
    expect(net.edges.length).toBeGreaterThan(50);
    for (const [node, list] of net.byNode) {
      expect(city.road[node]).toBe(1);
      for (const k of list) {
        const e = net.edges[k];
        expect(e.a === node || e.b === node).toBe(true);
        // Each end of the drawn line sits on the centre of its end tile.
        const [x, z] = e.a === node ? e.pts[0] : e.pts[e.pts.length - 1];
        expect(grid.index(grid.tileOf(x), grid.tileOf(z))).toBe(node);
      }
    }
  });

  it('keeps walkers on the streets for a long walk', () => {
    const rng = createRng(7);
    const walkers = Array.from({ length: 40 }, () => spawnWalk(net, rng)!);
    for (let step = 0; step < 400; step++) {
      for (const w of walkers) {
        advanceWalk(net, w, 0.37, rng);
        const [x, z, dx, dz] = walkPoint(net, w);
        expect(Math.hypot(dx, dz)).toBeCloseTo(1, 3);
        // The smoothed line cuts corners, but never by more than a tile.
        let near = false;
        for (let oz = -1; oz <= 1 && !near; oz++) {
          for (let ox = -1; ox <= 1 && !near; ox++) {
            const tx = grid.tileOf(x) + ox;
            const tz = grid.tileOf(z) + oz;
            near = grid.inBounds(tx, tz) && city.road[grid.index(tx, tz)] === 1;
          }
        }
        expect(near).toBe(true);
      }
    }
  });

  it('sends people where people live', () => {
    const inside = (t: number): number => {
      const x = grid.centre(t % grid.size);
      const z = grid.centre(Math.floor(t / grid.size));
      return Math.hypot(x, z) < city.def.walls.radius ? 10 : 0.1;
    };
    const busy = buildWalkNetwork(city, inside);
    const rng = createRng(3);
    let within = 0;
    for (let k = 0; k < 500; k++) {
      const w = spawnWalk(busy, rng)!;
      const [x, z] = walkPoint(busy, w);
      if (Math.hypot(x, z) < city.def.walls.radius + 1) within++;
    }
    expect(within / 500).toBeGreaterThan(0.8);
  });
});
