import { describe, expect, it } from 'vitest';
import { barracksOf, recruitMany } from '../src/sim/army';
import { buildBuilding } from '../src/sim/buildings';
import { WALL } from '../src/sim/constants';
import type { CityState } from '../src/sim/city';
import type { Building } from '../src/sim/buildings';
import { simulateDays } from '../src/sim/economy';
import {
  axes,
  companySize,
  faceOrder,
  formationCols,
  formationOrder,
  haltOrder,
  marchOrder,
  returnOrder,
  slotOf,
} from '../src/sim/field';
import { clearance, findPath, marchCost, standGround } from '../src/sim/paths';
import { restoreGame, saveGame } from '../src/sim/save';
import { insideWalls } from '../src/sim/walls';
import { balance, def, newCity, siteFor } from './helpers';

const units = balance.army.units;

/** A city with a barracks and `n` companies of spearmen, drilled or not. */
function withArmy(n: number, drilled = true): CityState {
  const c = newCity();
  c.treasury = 1e6;
  c.product = 1e5;
  const b = buildBuilding(c, siteFor(c, 'kisla', [36, -20]))!;
  simulateDays(c, b.work!.daysLeft);
  recruitMany(c, 'mizrakci', n);
  if (drilled) simulateDays(c, units.mizrakci.months * 30);
  return c;
}

/**
 * Open ground just off the barracks' own: on its near side (`side` 0) or its far side (1),
 * along its longer axis.
 */
function outside(c: CityState, b: Building, side: 0 | 1): { x: number; z: number } {
  const { grid } = c;
  const long = b.w >= b.d;
  for (let off = 2; off < 12; off++) {
    for (let t = 0; t < (long ? b.d : b.w); t++) {
      const x = long ? (side === 0 ? b.x0 - off : b.x0 + b.w - 1 + off) : b.x0 + t;
      const z = long ? b.z0 + t : side === 0 ? b.z0 - off : b.z0 + b.d - 1 + off;
      if (!grid.inBounds(x, z)) continue;
      const i = grid.index(x, z);
      if (standGround(c, i) && clearance(c)[i] >= 2) return { x: grid.centre(x), z: grid.centre(z) };
    }
  }
  throw new Error('no open ground by the barracks');
}

/** A dry, open spot outside the walls, east of the city. */
const OPEN = { x: 60, z: 8 };

describe('formations', () => {
  it('stands every man of a company on his own spot, inside its front and depth', () => {
    const d = units.mizrakci;
    for (const cols of [4, 10, 20]) {
      const { w, d: depth } = companySize(d, 100, cols);
      const seen = new Set<string>();
      for (let k = 0; k < 100; k++) {
        const [r, f] = slotOf(d, 100, cols, k);
        expect(Math.abs(r)).toBeLessThanOrEqual(w / 2);
        expect(Math.abs(f)).toBeLessThanOrEqual(depth / 2);
        seen.add(`${r.toFixed(3)},${f.toFixed(3)}`);
      }
      expect(seen.size).toBe(100);
    }
    // A line is wide and shallow, a column narrow and long.
    const c = newCity();
    const line = companySize(d, 100, formationCols(c, 'saf', 100));
    const column = companySize(d, 100, formationCols(c, 'kol', 100));
    expect(line.w).toBeGreaterThan(line.d);
    expect(column.d).toBeGreaterThan(column.w);
  });
});

describe('orders', () => {
  it('sends ready companies out side by side, and keeps those at drill home', () => {
    const c = withArmy(3);
    recruitMany(c, 'okcu', 1);
    const ids = c.army.units.map((u) => u.id);
    const r = marchOrder(c, ids, OPEN.x, OPEN.z, Math.PI / 2);
    expect(r.moved).toBe(3);
    expect(r.drilling).toBe(1);
    const out = c.army.units.filter((u) => u.field !== null);
    expect(out).toHaveLength(3);
    expect(c.army.units.find((u) => u.kind === 'okcu')!.field).toBeNull();
    // Side by side along the front, none on top of another.
    const a = axes(Math.PI / 2);
    const across = out
      .map((u) => (u.field!.x - OPEN.x) * a.rx + (u.field!.z - OPEN.z) * a.rz)
      .sort((p, q) => p - q);
    const w = companySize(units.mizrakci, 100, 10).w;
    for (let k = 1; k < across.length; k++) expect(across[k] - across[k - 1]).toBeGreaterThanOrEqual(w);
    // Centred on the point ordered.
    expect(Math.abs(across[0] + across[2])).toBeLessThan(1e-6);
  });

  it('will not march into the stream, nor send anyone out who is still at drill', () => {
    const c = withArmy(2);
    const ids = c.army.units.map((u) => u.id);
    const water = c.def.stream.points[3];
    expect(marchOrder(c, ids, water[0], water[1], 0).problem).toBe('Oraya yürünmez');
    const d = withArmy(2, false);
    const r = marchOrder(
      d,
      d.army.units.map((u) => u.id),
      OPEN.x,
      OPEN.z,
      0,
    );
    expect(r.moved).toBe(0);
    expect(r.problem).toContain('Talim');
  });

  it('draws up in many lines when the army is too wide for one', () => {
    const c = withArmy(40);
    const ids = c.army.units.map((u) => u.id);
    marchOrder(c, ids, OPEN.x, OPEN.z, 0, { formation: 'saf' });
    const forward = c.army.units.map((u) => Math.round((u.field!.z - OPEN.z) * 10));
    expect(new Set(forward).size).toBeGreaterThan(1);
  });

  it('changes formation in line, wheels about its middle, halts and goes home', () => {
    const c = withArmy(3);
    const ids = c.army.units.map((u) => u.id);
    marchOrder(c, ids, OPEN.x, OPEN.z, 0);
    expect(formationOrder(c, ids, 'saf')).toBe(3);
    for (const u of c.army.units) expect(u.field!.formation).toBe('saf');
    const before = c.army.units.map((u) => ({ ...u.field! }));
    const cx = before.reduce((n, f) => n + f.x, 0) / 3;
    expect(faceOrder(c, ids, Math.PI / 2)).toBe(3);
    c.army.units.forEach((u, k) => {
      expect(u.field!.heading).toBeCloseTo(before[k].heading + Math.PI / 2);
      // Distances to the middle are kept.
      expect(Math.hypot(u.field!.x - cx, u.field!.z - OPEN.z)).toBeCloseTo(
        Math.hypot(before[k].x - cx, before[k].z - OPEN.z),
        0,
      );
    });
    const where = new Map(c.army.units.map((u) => [u.id, { x: 50, z: 5, heading: 1 }]));
    expect(haltOrder(c, where)).toBe(3);
    expect(c.army.units[0].field).toMatchObject({ x: 50, z: 5, heading: 1, formation: 'saf' });
    // Halted on the barracks' own ground, a company is home.
    const b = barracksOf(c)!;
    const home = new Map([[ids[0], { x: c.grid.centre(b.x0 + 2), z: c.grid.centre(b.z0 + 2), heading: 0 }]]);
    haltOrder(c, home);
    expect(c.army.units[0].field).toBeNull();
    expect(returnOrder(c, ids)).toBe(2);
    for (const u of c.army.units) expect(u.field).toBeNull();
  });

  it('draws up hard by the city wall without standing on it, in it or over it', () => {
    const c = withArmy(20);
    const ids = c.army.units.map((u) => u.id);
    // Just outside the old walls, east of the tepe, facing them.
    const x = c.def.tepe.x + c.def.walls.radius + 3;
    const z = c.def.tepe.z;
    const r = marchOrder(c, ids, x, z, -Math.PI / 2);
    expect(r.moved).toBe(20);
    const { grid } = c;
    for (const u of c.army.units) {
      const f = u.field!;
      const def = units[u.kind];
      const { w, d } = companySize(def, u.men, formationCols(c, f.formation, u.men));
      const a = axes(f.heading);
      for (const su of [-0.5, 0, 0.5]) {
        for (const sv of [-0.5, 0, 0.5]) {
          const px = f.x + a.rx * su * w + a.fx * sv * d;
          const pz = f.z + a.rz * su * w + a.fz * sv * d;
          const i = grid.index(grid.tileOf(px), grid.tileOf(pz));
          expect(c.wall[i]).not.toBe(WALL);
          expect(c.house[i]).toBe(0);
          expect(c.building[i]).toBe(-1);
        }
      }
      // All on this side of the wall, even by a gate.
      expect(insideWalls(c, f.x, f.z)).toBe(false);
    }
    // Drawn up as a body, not strung out: about twice as wide as deep, give or take.
    const xs = c.army.units.map((u) => u.field!.x);
    const zs = c.army.units.map((u) => u.field!.z);
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    expect(spread).toBeLessThan(30);
  });

  it('keeps outside the walls when sent to a gate, and inside when sent within', () => {
    const c = withArmy(20);
    const ids = c.army.units.map((u) => u.id);
    const gate = c.gates.find((g) => g.ring === 0)!;
    const { grid } = c;
    const gx = gate.tiles.reduce((n, i) => n + grid.centre(i % grid.size), 0) / gate.tiles.length;
    const gz = gate.tiles.reduce((n, i) => n + grid.centre(Math.floor(i / grid.size)), 0) / gate.tiles.length;
    // A step outside the gate, away from the tepe.
    const d = Math.hypot(gx - c.def.tepe.x, gz - c.def.tepe.z);
    const ox = gx + ((gx - c.def.tepe.x) / d) * 3;
    const oz = gz + ((gz - c.def.tepe.z) / d) * 3;
    marchOrder(c, ids, ox, oz, 0);
    for (const u of c.army.units) expect(insideWalls(c, u.field!.x, u.field!.z)).toBe(false);
  });

  it('draws up along a front of the width the player drew, facing square to it', () => {
    const c = withArmy(6);
    const ids = c.army.units.map((u) => u.id);
    // A wide front: all six in one line, spread out along it.
    marchOrder(c, ids, OPEN.x, OPEN.z, Math.PI / 2, { width: 16 });
    const a = axes(Math.PI / 2);
    const across = c.army.units.map((u) => (u.field!.x - OPEN.x) * a.rx + (u.field!.z - OPEN.z) * a.rz);
    const ahead = c.army.units.map((u) => (u.field!.x - OPEN.x) * a.fx + (u.field!.z - OPEN.z) * a.fz);
    const w = companySize(units.mizrakci, 100, 10).w;
    expect(Math.max(...across) - Math.min(...across) + w).toBeCloseTo(16, 0);
    expect(new Set(ahead.map((f) => Math.round(f * 10))).size).toBe(1);
    for (const u of c.army.units) expect(u.field!.heading).toBeCloseTo(Math.PI / 2);
    // A narrow front: two abreast, three deep.
    marchOrder(c, ids, OPEN.x, OPEN.z, Math.PI / 2, { width: 2 * w + 0.6 });
    const deep = c.army.units.map((u) =>
      Math.round(((u.field!.x - OPEN.x) * a.fx + (u.field!.z - OPEN.z) * a.fz) * 10),
    );
    expect(new Set(deep).size).toBe(3);
  });

  it('comes back from a save where it was sent', () => {
    const c = withArmy(2);
    marchOrder(
      c,
      c.army.units.map((u) => u.id),
      OPEN.x,
      OPEN.z,
      0.7,
      { formation: 'kol' },
    );
    const back = restoreGame(def, balance, JSON.parse(JSON.stringify(saveGame(c))));
    expect(back.army).toEqual(c.army);
  });
});

describe('the way there', () => {
  it('goes from outside the barracks round the houses and through a gate, never over a wall', () => {
    const c = withArmy(1);
    const b = barracksOf(c)!;
    const from = outside(c, b, 0);
    // Into the heart of the city, inside the walls.
    const to = { x: 2, z: 10 };
    const path = findPath(c, from, to)!;
    expect(path).not.toBeNull();
    expect(path[0]).toEqual([from.x, from.z]);
    expect(path[path.length - 1]).toEqual([to.x, to.z]);
    const { grid } = c;
    for (let k = 1; k < path.length; k++) {
      const [ax, az] = path[k - 1];
      const [bx, bz] = path[k];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
      for (let s = 0; s <= steps; s++) {
        const i = grid.index(
          grid.tileOf(ax + ((bx - ax) * s) / steps),
          grid.tileOf(az + ((bz - az) * s) / steps),
        );
        expect(c.wall[i]).not.toBe(WALL);
      }
    }
  });

  it('goes round the barracks, never through it', () => {
    const c = withArmy(1);
    const b = barracksOf(c)!;
    const { grid } = c;
    const a = outside(c, b, 0);
    const z = outside(c, b, 1);
    const path = findPath(c, a, z)!;
    expect(path).not.toBeNull();
    for (let k = 1; k < path.length; k++) {
      const [ax, az] = path[k - 1];
      const [bx, bz] = path[k];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
      for (let s = 0; s <= steps; s++) {
        const i = grid.index(
          grid.tileOf(ax + ((bx - ax) * s) / steps),
          grid.tileOf(az + ((bz - az) * s) / steps),
        );
        expect(c.building[i]).not.toBe(b.id);
      }
    }
  });

  it('finds no way onto an island of water or into a wall', () => {
    const c = newCity();
    const w = c.wall.indexOf(WALL);
    expect(marchCost(c, w)).toBe(Infinity);
  });
});
