import { beforeAll, describe, expect, it } from 'vitest';
import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import { advanceCalendar, createCalendar, dateOf, formatDate } from '../src/sim/calendar';
import { createCity, WALL, WALL_GATE, type CityState } from '../src/sim/city';
import type { Balance } from '../src/sim/balance';
import type { CityDef } from '../src/sim/city-def';
import { DIRS4 } from '../src/sim/grid';
import { inspectTile } from '../src/sim/inspect';
import { housesWanted } from '../src/sim/housing';

const def = konya as unknown as CityDef;
const balance = balanceJson as unknown as Balance;
let city: CityState;
beforeAll(() => {
  city = createCity(def, balance);
});

/** Tiles reachable from the map centre moving 4-connected over tiles that pass `open`. */
function flood(c: CityState, open: (i: number) => boolean): Uint8Array {
  const { grid } = c;
  const seen = new Uint8Array(grid.count);
  const start = grid.index(grid.tileOf(0), grid.tileOf(0));
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % grid.size;
    const z = Math.floor(i / grid.size);
    for (const [dx, dz] of DIRS4) {
      if (!grid.inBounds(x + dx, z + dz)) continue;
      const j = grid.index(x + dx, z + dz);
      if (seen[j] === 1 || !open(j)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}
const tileAt = (c: CityState, wx: number, wz: number): number =>
  c.grid.index(c.grid.tileOf(wx), c.grid.tileOf(wz));

describe('terrain', () => {
  it('is identical for the same definition', () => {
    const again = createCity(def, balance);
    expect(again.terrain.corner).toEqual(city.terrain.corner);
    expect(again.house).toEqual(city.house);
    expect(again.road).toEqual(city.road);
  });

  it('runs the stream along its authored course', () => {
    for (const [x, z] of def.stream.points.slice(1, -1)) {
      expect(city.terrain.water[tileAt(city, x, z)]).toBe(1);
    }
  });

  it('keeps fertility in range and zero on water and inside the walls', () => {
    const { fertility, water } = city.terrain;
    for (let i = 0; i < fertility.length; i++) {
      expect(fertility[i]).toBeGreaterThanOrEqual(0);
      expect(fertility[i]).toBeLessThanOrEqual(1);
      if (water[i] === 1) expect(fertility[i]).toBe(0);
    }
    expect(fertility[tileAt(city, 5, 5)]).toBe(0);
  });

  it('makes the stream banks richer than the dry steppe and the hills', () => {
    const { fertility, waterDistance, height, water } = city.terrain;
    let near = 0;
    let nearN = 0;
    let far = 0;
    let farN = 0;
    for (let i = 0; i < fertility.length; i++) {
      if (water[i] === 1 || fertility[i] === 0) continue;
      if (waterDistance[i] < 5) {
        near += fertility[i];
        nearN++;
      } else if (waterDistance[i] > 25 || height[i] > 3) {
        far += fertility[i];
        farN++;
      }
    }
    expect(near / nearN).toBeGreaterThan(far / farN + 0.15);
  });

  it('raises the tepe above the city', () => {
    expect(city.terrain.height[tileAt(city, 0, 0)]).toBeGreaterThan(1.8);
    expect(city.terrain.height[tileAt(city, 15, 0)]).toBeLessThan(0.5);
  });
});

describe('walls and gates', () => {
  it('seal the city except through the gates', () => {
    const { grid } = city;
    const edge = grid.index(0, 0);
    const blockedByWalls = flood(city, (i) => city.wall[i] !== WALL && city.wall[i] !== WALL_GATE);
    expect(blockedByWalls[edge]).toBe(0);
    const throughGates = flood(city, (i) => city.wall[i] !== WALL);
    expect(throughGates[edge]).toBe(1);
  });

  it('give every gate a road passage', () => {
    expect(city.gates).toHaveLength(def.gates.length);
    for (const g of city.gates) {
      expect(g.tiles.length).toBeGreaterThan(0);
      for (const i of g.tiles) {
        expect(city.road[i]).toBe(1);
      }
    }
  });

  it('connect every gate to the tepe by road', () => {
    const reachable = flood(city, (i) => city.road[i] === 1 || city.structure[i] >= 0);
    for (const g of city.gates) expect(reachable[g.tiles[0]]).toBe(1);
  });
});

describe('initial city', () => {
  it('places every landmark without overlap', () => {
    const seen = new Set<number>();
    for (const l of city.landmarks) {
      expect(l.tiles).toHaveLength(l.w * l.d);
      for (const i of l.tiles) {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        expect(city.road[i]).toBe(0);
        expect(city.house[i]).toBe(0);
      }
    }
  });

  it('fills the walled city with houses that front a road', () => {
    const { grid } = city;
    let houses = 0;
    for (let i = 0; i < grid.count; i++) {
      if (city.house[i] === 0) continue;
      houses++;
      expect(city.road[i]).toBe(0);
      expect(city.wall[i]).toBe(0);
    }
    expect(houses).toBe(housesWanted(city));
    expect(houses).toBeGreaterThan(400);
    expect(houses).toBeLessThan(1400);
  });

  it('lays fields round the city, clear of roads and houses', () => {
    expect(city.fields.size).toBeGreaterThan(10);
    for (const f of city.fields.values()) {
      for (const i of f.tiles) {
        expect(city.field[i]).toBe(f.id);
        expect(city.road[i]).toBe(0);
        expect(city.house[i]).toBe(0);
      }
    }
  });

  it('keeps generated streets one lane wide', () => {
    const { grid, road, def } = city;
    // The gate passages are laid straight through the wall and may run two wide.
    const nearWall = (i: number): boolean =>
      Math.abs(
        Math.hypot(
          grid.centre(i % grid.size) - def.tepe.x,
          grid.centre(Math.floor(i / grid.size)) - def.tepe.z,
        ) - def.walls.radius,
      ) < 2.6;
    let thick = 0;
    for (let z = 0; z < grid.size - 1; z++) {
      for (let x = 0; x < grid.size - 1; x++) {
        const block = [
          grid.index(x, z),
          grid.index(x + 1, z),
          grid.index(x, z + 1),
          grid.index(x + 1, z + 1),
        ];
        if (block.every((i) => road[i] === 1) && !block.some(nearWall)) thick++;
      }
    }
    expect(thick).toBe(0);
  });

  it('describes tiles for the info panel', () => {
    const tepe = inspectTile(city, city.grid.tileOf(0), city.grid.tileOf(0));
    expect(tepe?.title).toBe('Alaeddin Camii');
    const gate = city.gates[0];
    const g = gate.tiles[0];
    expect(inspectTile(city, g % city.grid.size, Math.floor(g / city.grid.size))?.title).toBe(gate.name);
    const site = city.def.resource.sites[0];
    expect(inspectTile(city, city.grid.tileOf(site.x), city.grid.tileOf(site.z))?.title).toBe(site.name);
    expect(inspectTile(city, -1, 0)).toBeNull();
  });
});

describe('calendar', () => {
  it('starts on the configured date', () => {
    expect(formatDate(dateOf(createCalendar({ year: 1230, month: 2, day: 1 })))).toBe('1 Mart 1230');
  });

  it('advances by speed and rolls over months, seasons and years', () => {
    const cal = createCalendar({ year: 1230, month: 11, day: 29 });
    cal.speed = 3;
    const days = advanceCalendar(cal, 1);
    expect(days).toBe(15);
    const d = dateOf(cal);
    expect(d.year).toBe(1231);
    expect(d.month).toBe(0);
    expect(d.season).toBe('Kış');
  });

  it('does not move while paused or on a bad clock', () => {
    const cal = createCalendar({ year: 1230, month: 2, day: 1 });
    cal.speed = 0;
    expect(advanceCalendar(cal, 10)).toBe(0);
    cal.speed = 1;
    expect(advanceCalendar(cal, -3)).toBe(0);
    expect(advanceCalendar(cal, Number.NaN)).toBe(0);
  });
});
