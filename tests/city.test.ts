import { beforeAll, describe, expect, it } from 'vitest';
import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import { advanceCalendar, createCalendar, dateOf, formatDate } from '../src/sim/calendar';
import { createCity, WALL, WALL_GATE, type CityState } from '../src/sim/city';
import type { Balance } from '../src/sim/balance';
import type { CityDef } from '../src/sim/city-def';
import { removeField } from '../src/sim/fields';
import { DIRS4 } from '../src/sim/grid';
import { inspectTile } from '../src/sim/inspect';
import { bulldoze, buildRoad, planRoad, BRIDGE_COST } from '../src/sim/roads';

const def = konya as unknown as CityDef;
const balance = balanceJson as unknown as Balance;
/** A fresh Konya with its starting fields cleared, for tests about roads on open ground. */
function openCity(): CityState {
  const c = createCity(def, balance);
  for (const id of [...c.fields.keys()]) removeField(c, id);
  return c;
}
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
        expect(city.roadLocked[i]).toBe(1);
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
    expect(houses).toBeGreaterThan(400);
    expect(houses).toBeLessThan(1400);
  });

  it('keeps generated streets one lane wide', () => {
    const { grid, road, roadLocked } = city;
    let thick = 0;
    for (let z = 0; z < grid.size - 1; z++) {
      for (let x = 0; x < grid.size - 1; x++) {
        const block = [
          grid.index(x, z),
          grid.index(x + 1, z),
          grid.index(x, z + 1),
          grid.index(x + 1, z + 1),
        ];
        if (block.every((i) => road[i] === 1) && block.every((i) => roadLocked[i] === 0)) thick++;
      }
    }
    expect(thick).toBe(0);
  });

  it('describes tiles for the info panel', () => {
    const tepe = inspectTile(city, city.grid.tileOf(0), city.grid.tileOf(0));
    expect(tepe?.land).toBe('Alaeddin Tepesi');
    expect(tepe?.feature).toBe('Alaeddin Camii');
    const gate = city.gates[0];
    const g = gate.tiles[0];
    expect(inspectTile(city, g % city.grid.size, Math.floor(g / city.grid.size))?.feature).toBe(gate.name);
    expect(inspectTile(city, -1, 0)).toBeNull();
  });
});

describe('roads', () => {
  it('prices a straight road on open ground', () => {
    const c = openCity();
    const x = c.grid.tileOf(40);
    const z = c.grid.tileOf(10);
    const plan = planRoad(c, x, z, x + 6, z);
    expect(plan.problem).toBeUndefined();
    expect(plan.tiles).toHaveLength(7);
    expect(plan.cost).toBeGreaterThanOrEqual(70);
  });

  it('refuses to cut through the walls', () => {
    const c = openCity();
    const plan = planRoad(c, c.grid.tileOf(0), c.grid.tileOf(-15), c.grid.tileOf(0), c.grid.tileOf(-30));
    expect(plan.problem).toBeDefined();
    expect(buildRoad(c, plan)).toBe(false);
  });

  it('builds a bridge over the stream and charges for it', () => {
    const c = openCity();
    const x = c.grid.tileOf(-40);
    const plan = planRoad(c, x, c.grid.tileOf(22), x, c.grid.tileOf(38));
    expect(plan.problem).toBeUndefined();
    expect(plan.tiles.some((t) => t.status === 'bridge')).toBe(true);
    expect(plan.cost).toBeGreaterThan(BRIDGE_COST);
    const before = c.treasury;
    expect(buildRoad(c, plan)).toBe(true);
    expect(c.treasury).toBe(before - plan.cost);
    expect(c.road[c.grid.index(x, c.grid.tileOf(30))]).toBe(1);
  });

  it('will not build what the treasury cannot pay for', () => {
    const c = openCity();
    c.treasury = 5;
    const x = c.grid.tileOf(40);
    const plan = planRoad(c, x, c.grid.tileOf(0), x, c.grid.tileOf(8));
    expect(plan.problem).toBe('Hazine yetersiz');
    expect(buildRoad(c, plan)).toBe(false);
    expect(c.treasury).toBe(5);
  });

  it('bulldozes ordinary roads but not gate passages', () => {
    const c = openCity();
    const x = c.grid.tileOf(40);
    const z = c.grid.tileOf(0);
    buildRoad(c, planRoad(c, x, z, x + 4, z));
    expect(bulldoze(c, x, z, x + 4, z)).toBe(5);
    const g = c.gates[0].tiles[0];
    const gx = g % c.grid.size;
    const gz = Math.floor(g / c.grid.size);
    bulldoze(c, gx, gz, gx, gz);
    expect(c.road[g]).toBe(1);
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
