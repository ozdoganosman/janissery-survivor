import { describe, expect, it } from 'vitest';
import balanceJson from '../data/balance.json';
import konya from '../data/konya.json';
import type { Balance, BuildingKind } from '../src/sim/balance';
import { buildBuilding, proposeBuilding, smokeMap, type BuildingProposal } from '../src/sim/buildings';
import { dateOf } from '../src/sim/calendar';
import { createCity, type CityState } from '../src/sim/city';
import type { CityDef } from '../src/sim/city-def';
import { simulateDays } from '../src/sim/economy';
import { buildField, proposeField } from '../src/sim/fields';
import { inspectTile } from '../src/sim/inspect';
import { buildRoad, planRoad } from '../src/sim/roads';
import { clearArea } from '../src/sim/zoning';

const def = konya as unknown as CityDef;
const balance = balanceJson as unknown as Balance;
const newCity = (): CityState => createCity(def, balance);

const usable = (p: BuildingProposal): boolean => p.problem === undefined;

/** The first spot on the map, scanning from `from` outwards row by row, where `kind` may stand. */
function siteFor(
  c: CityState,
  kind: BuildingKind,
  near: [number, number] = [0, 0],
  reach = 99,
): BuildingProposal {
  const { grid } = c;
  const cx = grid.tileOf(near[0]);
  const cz = grid.tileOf(near[1]);
  for (let r = 0; r <= reach; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !grid.inBounds(cx + dx, cz + dz)) continue;
        const p = proposeBuilding(c, kind, cx + dx, cz + dz);
        if (usable(p)) return p;
      }
    }
  }
  throw new Error(`no site for ${kind}`);
}

/** A straight road on open ground east of the walls; returns its first tile. */
function openRoad(c: CityState, length = 10): { x: number; z: number } {
  const { grid } = c;
  for (let wz = -30; wz < 20; wz++) {
    for (let wx = 30; wx < 70; wx++) {
      const x = grid.tileOf(wx);
      const z = grid.tileOf(wz);
      let clear = true;
      for (let dz = -4; dz <= 4 && clear; dz++) {
        for (let dx = -1; dx <= length && clear; dx++) {
          const i = grid.index(x + dx, z + dz);
          clear = c.road[i] === 0 && c.field[i] < 0 && c.building[i] < 0 && c.terrain.slope[i] < 0.4;
        }
      }
      if (clear && buildRoad(c, planRoad(c, x, z, x + length - 1, z))) return { x, z };
    }
  }
  throw new Error('no open ground for a road');
}

describe('the city on day one', () => {
  it('has a mill on the stream and a bazaar with bakers, both on roads', () => {
    const c = newCity();
    const kinds = [...c.buildings.values()].map((b) => b.kind).sort();
    expect(kinds).toEqual(['arasta', 'degirmen']);
    for (const b of c.buildings.values()) {
      expect(b.roadAccess).toBe(true);
      for (const i of b.tiles) expect(c.building[i]).toBe(b.id);
    }
    const bazaar = [...c.buildings.values()].find((b) => b.kind === 'arasta');
    expect(bazaar?.shops.map((s) => s.trade)).toEqual(['firinci', 'firinci', null, null]);
    expect(c.stats.prosperity).toBeGreaterThan(0.1);
  });

  it('marks iron ore in the hills', () => {
    const c = newCity();
    let ore = 0;
    for (let i = 0; i < c.grid.count; i++) if (c.terrain.ore[i] > 0) ore++;
    expect(ore).toBeGreaterThan(30);
    const d = def.deposits[0];
    expect(inspectTile(c, c.grid.tileOf(d.x), c.grid.tileOf(d.z))?.ore).toBe(d.name);
  });
});

describe('placing buildings', () => {
  it('holds each kind to its site', () => {
    const c = newCity();
    const { x, z } = openRoad(c);
    // Dry open ground beside a road: fine for a foundry or a bazaar, not for a mill or a mine.
    expect(proposeBuilding(c, 'dokumhane', x + 4, z + 2).problem).toBeUndefined();
    expect(proposeBuilding(c, 'arasta', x + 4, z + 1).problem).toBeUndefined();
    expect(proposeBuilding(c, 'degirmen', x + 4, z + 1).problem).toBe('Suya bitişik olmalı');
    expect(proposeBuilding(c, 'maden', x + 4, z + 1).problem).toBe('Demir damarı üstüne kurulmalı');
    // Away from the road.
    expect(proposeBuilding(c, 'arasta', x + 4, z + 4).problem).toBe('Yola bitişik olmalı');
    // On the road itself.
    expect(proposeBuilding(c, 'arasta', x + 4, z).problem).toBe('Yol');
    c.treasury = 100;
    expect(proposeBuilding(c, 'arasta', x + 4, z + 1).problem).toBe('Hazine yetersiz');
  });

  it('turns a bazaar so its long side runs along the road', () => {
    const c = newCity();
    const { x, z } = openRoad(c);
    const p = proposeBuilding(c, 'arasta', x + 4, z + 1);
    expect(p.problem).toBeUndefined();
    expect(p.w).toBe(4);
    expect(p.facing).toBe(2); // the road is to the north
  });

  it('charges the treasury, takes the tiles and keeps roads and zoning off them', () => {
    const c = newCity();
    const { x, z } = openRoad(c);
    const before = c.treasury;
    const b = buildBuilding(c, proposeBuilding(c, 'dokumhane', x + 4, z + 2));
    expect(b).not.toBeNull();
    expect(c.treasury).toBe(before - balance.works.dokumhane.cost);
    const t = b!.tiles[0];
    const tx = t % c.grid.size;
    const tz = Math.floor(t / c.grid.size);
    expect(planRoad(c, tx, tz - 1, tx, tz + 1).problem).toBe('Dökümhane');
    expect(proposeField(c, tx, tz, tx + 1, tz + 1).problem).toBe('Yapı');
    const cleared = clearArea(c, tx, tz, tx, tz);
    expect(cleared.buildings).toBe(1);
    expect(c.buildings.has(b!.id)).toBe(false);
    expect(c.building[t]).toBe(-1);
  });
});

describe('the bread chain', () => {
  it('grinds grain, bakes it, and feeds people bread in place of grain', () => {
    const c = newCity();
    simulateDays(c, 29); // to the end of Mart, before the books close
    const f = c.flows.current;
    expect(f.made.un).toBeGreaterThan(0);
    expect(f.made.ekmek).toBeGreaterThan(0);
    expect(f.used.ekmek).toBeGreaterThan(0);
    // Bread is food: the mill's grain plus what people ate as grain is what they needed.
    const need = (c.stats.population * balance.food.perPersonPerMonth * 29) / 30;
    const eatenAsBread = f.used.ekmek * (balance.goods.ekmek.food ?? 0);
    expect(f.used.zahire - f.made.un + eatenAsBread).toBeGreaterThan(need * 0.95);
    expect(f.used.zahire - f.made.un + eatenAsBread).toBeLessThan(need * 1.05);
  });

  it('sells flour to the bakers and taxes the bread they sell', () => {
    const c = newCity();
    const before = c.treasury;
    simulateDays(c, 20);
    const f = c.flows.current;
    const flourToShops = f.used.un;
    expect(f.sales).toBeCloseTo(flourToShops * balance.goods.un.price, 6);
    expect(f.market).toBeCloseTo(f.used.ekmek * balance.goods.ekmek.price * balance.needs.marketTax, 6);
    expect(c.treasury).toBeCloseTo(before + f.sales + f.market, 6);
  });

  it('opens more bakeries while bread is short and flour is in store', () => {
    const c = newCity();
    const bakers = (): number =>
      [...c.buildings.values()].flatMap((b) => b.shops).filter((s) => s.trade === 'firinci').length;
    expect(bakers()).toBe(2);
    simulateDays(c, 90);
    expect(bakers()).toBe(4);
    expect(c.needs.ekmek).toBeGreaterThan(0.5);
  });

  it('stops opening bakeries once the mill has no flour to spare', () => {
    const c = newCity();
    const { x, z } = openRoad(c);
    expect(buildBuilding(c, proposeBuilding(c, 'arasta', x + 4, z + 1))).not.toBeNull();
    simulateDays(c, 150);
    const bakers = [...c.buildings.values()].flatMap((b) => b.shops).filter((s) => s.trade === 'firinci');
    // One mill grinds enough for four bakers, however many empty shops wait for them.
    expect(bakers.length).toBe(4);
    expect(c.notices.some((n) => n.text.includes('kapattı'))).toBe(false);
  });

  it('lets a mill stand idle when the depot is full of flour', () => {
    const c = newCity();
    c.goods.un = balance.goods.un.cap;
    for (const b of c.buildings.values()) b.shops.forEach((s) => (s.trade = null));
    simulateDays(c, 1);
    const mill = [...c.buildings.values()].find((b) => b.kind === 'degirmen');
    expect(mill?.status).toBe('dolu');
  });
});

describe('the cloth chain', () => {
  it('shears pasture in May, dyes the wool into yarn and weaves it in the bazaar', () => {
    const c = newCity();
    const { x, z } = openRoad(c, 14);
    const pasture = proposeField(c, x, z + 1, x + 9, z + 4, 'mera');
    expect(pasture.problem).toBeUndefined();
    const f = buildField(c, pasture, 'mera');
    expect(f?.kind).toBe('mera');
    expect(f?.stage).toBe('otlak');
    // A flock gives its full fleece only after a year on the grass: run to the second May.
    while (!(dateOf(c.calendar).year === 1231 && dateOf(c.calendar).month === 4)) simulateDays(c, 1);
    expect(c.stats.lastShearing).toBeGreaterThan(pasture.tiles.length * balance.pasture.woolPerTile * 0.5);
    expect(c.goods.yun).toBeGreaterThan(0);

    const dye = buildBuilding(c, siteFor(c, 'boyahane', [20, 30]));
    expect(dye).not.toBeNull();
    const bazaar = buildBuilding(c, proposeBuilding(c, 'arasta', x + 11, z - 2));
    expect(bazaar).not.toBeNull();
    simulateDays(c, 70);
    expect(c.flows.last.made.iplik + c.flows.current.made.iplik).toBeGreaterThan(0);
    const weavers = [...c.buildings.values()].flatMap((b) => b.shops).filter((s) => s.trade === 'dokumaci');
    expect(weavers.length).toBeGreaterThan(0);
    expect(c.needs.kumas).toBeGreaterThan(0);
  });
});

describe('the iron chain', () => {
  it('mines ore on the deposit, smelts it, and tools raise the harvest', () => {
    const c = newCity();
    const d = def.deposits[1];
    const { grid } = c;
    // A track up to the seam, then a mine beside it.
    let mine: BuildingProposal | null = null;
    for (let dz = -6; dz <= 6 && mine === null; dz++) {
      const z = grid.tileOf(d.z) + dz;
      const plan = planRoad(c, grid.tileOf(d.x) - 5, z, grid.tileOf(d.x) + 5, z);
      if (plan.problem !== undefined) continue;
      buildRoad(c, plan);
      for (const side of [-1, 1]) {
        for (let dx = -4; dx <= 4 && mine === null; dx++) {
          const p = proposeBuilding(c, 'maden', grid.tileOf(d.x) + dx, side < 0 ? z - 2 : z + 1);
          if (usable(p)) mine = p;
        }
      }
    }
    expect(mine).not.toBeNull();
    expect(buildBuilding(c, mine!)).not.toBeNull();
    const { x, z } = openRoad(c, 14);
    expect(buildBuilding(c, proposeBuilding(c, 'dokumhane', x + 3, z + 2))).not.toBeNull();
    expect(buildBuilding(c, proposeBuilding(c, 'arasta', x + 10, z + 1))).not.toBeNull();
    simulateDays(c, 100);
    const made = (g: 'cevher' | 'demir' | 'alet'): number => c.flows.last.made[g] + c.flows.current.made[g];
    expect(made('cevher')).toBeGreaterThan(0);
    expect(made('demir')).toBeGreaterThan(0);
    expect(made('alet')).toBeGreaterThan(0);
    expect(c.needs.alet).toBeGreaterThan(0.3);
  });

  it('gives a bigger harvest with tools', () => {
    const plain = newCity();
    const tooled = newCity();
    tooled.goods.alet = 1000;
    tooled.needs.alet = 1;
    while (dateOf(plain.calendar).month !== 8) {
      simulateDays(plain, 1);
      simulateDays(tooled, 1);
    }
    expect(tooled.stats.lastHarvest).toBeGreaterThan(plain.stats.lastHarvest * 1.15);
  });

  it('keeps houses under a foundry’s smoke from gaining a floor', () => {
    const c = newCity();
    const b = buildBuilding(c, siteFor(c, 'dokumhane', [30, -10]))!;
    const smoke = smokeMap(c);
    const cx = b.x0 + 1;
    const cz = b.z0 + 1;
    expect(smoke[c.grid.index(cx, cz)]).toBe(1);
    expect(smoke[c.grid.index(cx + 5, cz)]).toBe(1);
    expect(smoke[c.grid.index(cx + 9, cz)]).toBe(0);
    // Houses in the smoke stay one storey however well the city lives.
    const smoky: number[] = [];
    for (let i = 0; i < c.grid.count && smoky.length < 6; i++) {
      if (
        smoke[i] === 1 &&
        c.building[i] < 0 &&
        c.road[i] === 0 &&
        c.field[i] < 0 &&
        c.terrain.water[i] === 0
      ) {
        c.house[i] = 1;
        smoky.push(i);
      }
    }
    c.balance = { ...balance, growth: { ...balance.growth, upgradeChancePerMonth: 1 } };
    c.needs.ekmek = 1;
    c.needs.kumas = 1;
    simulateDays(c, 31);
    for (const i of smoky) expect(c.house[i]).toBeLessThanOrEqual(1);
  });
});

describe('the bazaar', () => {
  it('closes a shop that goes months without its input', () => {
    const c = newCity();
    const bazaar = [...c.buildings.values()].find((b) => b.kind === 'arasta')!;
    bazaar.shops[3].trade = 'demirci';
    simulateDays(c, 100);
    expect(bazaar.shops.some((s) => s.trade === 'demirci')).toBe(false);
  });

  it('never opens a craft without its input', () => {
    const c = newCity();
    simulateDays(c, 100);
    const trades = [...c.buildings.values()].flatMap((b) => b.shops).map((s) => s.trade);
    expect(trades).not.toContain('dokumaci');
    expect(trades).not.toContain('demirci');
  });

  it('does nothing without a road', () => {
    const c = newCity();
    const { x, z } = openRoad(c);
    const b = buildBuilding(c, proposeBuilding(c, 'dokumhane', x + 4, z + 2))!;
    c.goods.cevher = 300;
    clearArea(c, x, z, x + 9, z);
    simulateDays(c, 2);
    expect(b.roadAccess).toBe(false);
    expect(b.status).toBe('yolsuz');
    expect(c.goods.cevher).toBe(300);
  });
});
