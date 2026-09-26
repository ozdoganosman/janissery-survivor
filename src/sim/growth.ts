import type { Vec2 } from '../core/geom';
import { valueNoise } from '../core/noise';
import { DAYS_PER_MONTH } from './calendar';
import {
  DEG,
  landmarkReserve,
  polar,
  rasterizePath,
  ringPath,
  thinRoads,
  WALL,
  WALL_GATE,
  WALL_NONE,
  type CityState,
  type Gate,
} from './city';

export { outerRadius } from './city';
import type { ExpansionDef } from './city-def';
import { removeField } from './countryside';
import { layLots, syncHouses } from './housing';
import { notify } from './notices';

/**
 * The city outgrowing itself. As the people spill out, streets open outside the walls:
 * ring roads joining the gate roads, and lanes off them. When the city is great enough the
 * governor can raise a new ring of walls round the suburbs, with gates where the roads
 * cross it and new streets inside: more room, more buildings, a safer town.
 */

export interface ExpansionOffer {
  def: ExpansionDef;
  stage: number;
  problem?: string;
  blockedBy?: 'work' | 'rank' | 'akce' | 'urun';
}

/** The next ring of walls, and what stops it being begun now; null when all stand. */
export function expansionOffer(city: CityState): ExpansionOffer | null {
  const stage = city.expansion.built;
  const def = city.def.expansions[stage] as ExpansionDef | undefined;
  if (def === undefined) return null;
  const offer: ExpansionOffer = { def, stage };
  if (city.expansion.work !== null) return { ...offer, blockedBy: 'work', problem: 'Sur yükseliyor' };
  if (city.stats.level < def.rank) {
    const rank = city.balance.levels[def.rank]?.name ?? 'büyük';
    return { ...offer, blockedBy: 'rank', problem: `Şehir ${rank} olunca` };
  }
  if (city.treasury < def.cost) return { ...offer, blockedBy: 'akce', problem: 'Akçe yetmiyor' };
  if (city.product < def.material) {
    return { ...offer, blockedBy: 'urun', problem: `${city.def.resource.good} yetmiyor` };
  }
  return offer;
}

/** Pays for the next ring of walls and sets the masons to work. False when it cannot begin. */
export function startExpansion(city: CityState): boolean {
  const offer = expansionOffer(city);
  if (offer === null || offer.problem !== undefined) return false;
  city.treasury -= offer.def.cost;
  city.product -= offer.def.material;
  const days = offer.def.months * DAYS_PER_MONTH;
  city.expansion.work = { days, daysLeft: days };
  city.revision.walls++;
  return true;
}

/** A day on the walls; the last one raises the ring. */
export function expansionDay(city: CityState): void {
  const w = city.expansion.work;
  if (w === null) return;
  w.daysLeft--;
  if (w.daysLeft > 0) return;
  const def = city.def.expansions[city.expansion.built];
  city.expansion.work = null;
  raiseRing(city, city.expansion.built);
  city.expansion.built++;
  finishStreets(city);
  notify(city, `${def.name} tamamlandı: yeni kapılar ve mahalleler açıldı.`, 'good', 'rank');
}

/** Building slots and order the raised walls give. */
export function wallGifts(city: CityState): { slots: number; order: number } {
  let slots = 0;
  let order = 0;
  for (const e of city.def.expansions.slice(0, city.expansion.built)) {
    slots += e.slots;
    order += e.order;
  }
  return { slots, order };
}

/**
 * Lays one ring of walls: a wall on every tile of the ring that is free, a gate wherever a
 * street crosses it, and inside it a ring street with lanes off it and roads out to the
 * older town between its gates. Water, landmarks and the player's buildings are left alone,
 * so a stream runs through the ring and a building stands in a gap of it.
 */
export function raiseRing(city: CityState, stage: number): void {
  const def = city.def.expansions[stage];
  const { grid, terrain } = city;
  const { tepe } = city.def;
  const R = def.radius;
  for (let z = 0; z < grid.size; z++) {
    for (let x = 0; x < grid.size; x++) {
      if (Math.abs(Math.hypot(grid.centre(x) - tepe.x, grid.centre(z) - tepe.z) - R) >= 0.8) continue;
      const i = grid.index(x, z);
      if (terrain.water[i] === 1 || city.structure[i] >= 0 || city.building[i] >= 0) continue;
      if (city.wall[i] !== WALL_NONE) continue;
      city.wall[i] = city.road[i] === 1 ? WALL_GATE : WALL;
      city.house[i] = 0;
      if (city.field[i] >= 0) removeField(city, city.field[i]);
    }
  }
  city.rings.push({ name: def.name, radius: R, height: city.def.walls.height * 1.1 });
  const inner = city.rings[city.rings.length - 2].radius;
  const reserved = landmarkReserve(city, 1);
  const street = R - 2.2;
  layStreet(city, ringPath(tepe.x, tepe.z, street, 0.5, (city.def.seed % 83) + stage * 7), reserved);
  // Roads out from the old walls to the new ring street, between the gate roads.
  const gates = city.def.gates.map((g) => g.angle * DEG).sort((a, b) => a - b);
  gates.forEach((a, k) => {
    const next = gates[(k + 1) % gates.length] + (k + 1 === gates.length ? Math.PI * 2 : 0);
    const mid = (a + next) / 2;
    layStreet(city, [polar(tepe.x, tepe.z, mid, inner + 2), polar(tepe.x, tepe.z, mid, street)], reserved);
  });
  // Lanes off the ring street into the new quarters.
  for (let k = 0; k < def.alleys; k++) {
    const a = (k / def.alleys) * Math.PI * 2 + stage * 0.37 + valueNoise(k * 1.7, stage) * 0.2;
    const end = Math.max(inner + 3, street - 3 - valueNoise(k, stage + 5) * 3);
    layStreet(
      city,
      [polar(tepe.x, tepe.z, a, street), polar(tepe.x, tepe.z, a + (valueNoise(k, 9) - 0.5) * 0.08, end)],
      reserved,
    );
  }
  city.revision.walls++;
}

/**
 * Paints a street along a path. It goes round water, landmarks, the city's quarry and the
 * player's buildings; through a wall it makes a gate; houses and fields in its way make room.
 */
function layStreet(city: CityState, path: readonly Vec2[], reserved: Uint8Array): void {
  const { grid, terrain } = city;
  for (const [x, z] of rasterizePath(grid, path)) {
    if (!grid.inBounds(x, z)) continue;
    const i = grid.index(x, z);
    if (terrain.water[i] === 1 || terrain.site[i] > 0) continue;
    if (city.structure[i] >= 0 || reserved[i] === 1 || city.building[i] >= 0) continue;
    if (city.wall[i] === WALL) city.wall[i] = WALL_GATE;
    city.road[i] = 1;
    city.house[i] = 0;
    if (city.field[i] >= 0) removeField(city, city.field[i]);
  }
}

/** After streets are laid: gates named, thick crossings thinned, lots and houses laid anew. */
export function finishStreets(city: CityState): void {
  refreshGates(city);
  const locked = new Uint8Array(city.grid.count);
  for (let i = 0; i < locked.length; i++) if (city.wall[i] === WALL_GATE) locked[i] = 1;
  thinRoads(city, locked);
  layLots(city);
  syncHouses(city);
  city.revision.roads++;
  city.revision.walls++;
}

/** Finds the gates in every raised ring and names them after the gate roads they carry. */
export function refreshGates(city: CityState): void {
  const { grid } = city;
  const { tepe } = city.def;
  const first = city.gates.filter((g) => g.radius === city.rings[0].radius);
  const gates: Gate[] = [...first];
  const suffix = ['', 'Dış', 'Varoş', 'Yeni'];
  city.rings.slice(1).forEach((ring, k) => {
    const hits: Array<{ i: number; a: number }> = [];
    for (let i = 0; i < grid.count; i++) {
      if (city.wall[i] !== WALL_GATE) continue;
      const x = grid.centre(i % grid.size) - tepe.x;
      const z = grid.centre(Math.floor(i / grid.size)) - tepe.z;
      if (Math.abs(Math.hypot(x, z) - ring.radius) > 1.3) continue;
      hits.push({ i, a: (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2) });
    }
    hits.sort((p, q) => p.a - q.a);
    const clusters: Array<typeof hits> = [];
    for (const h of hits) {
      const last = clusters[clusters.length - 1];
      if (last !== undefined && h.a - last[last.length - 1].a < 2 / ring.radius) last.push(h);
      else clusters.push([h]);
    }
    // A cluster straddling angle zero is one gate.
    if (clusters.length > 1) {
      const head = clusters[0][0].a;
      const tail = clusters[clusters.length - 1];
      if (head + Math.PI * 2 - tail[tail.length - 1].a < 2 / ring.radius) {
        clusters[0] = [...tail.map((h) => ({ ...h, a: h.a - Math.PI * 2 })), ...clusters[0]];
        clusters.pop();
      }
    }
    for (const c of clusters) {
      const angle = c.reduce((s, h) => s + h.a, 0) / c.length;
      const near = city.def.gates.find((g) => {
        const d = Math.abs(((g.angle * DEG - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return d < 0.3;
      });
      const tag = suffix[Math.min(k + 1, suffix.length - 1)];
      gates.push({
        name:
          near !== undefined ? `${near.name.replace(/ Kapısı$/, '')} ${tag} Kapısı` : `${ring.name} Kapısı`,
        angle,
        tiles: c.map((h) => h.i),
        radius: ring.radius,
      });
    }
  });
  city.gates = gates;
}

export interface StreetStep {
  /** People the city must reach before the street opens. */
  threshold: number;
  path: Vec2[];
}

const plans = new WeakMap<object, StreetStep[]>();

/**
 * The streets the suburbs will get, in the order they open: for each ring beyond the walls,
 * the stretches of ring road between one gate road and the next, each with lanes off it.
 * Worked out from the city definition alone, so it is the same every game.
 */
export function streetPlan(city: CityState): StreetStep[] {
  const cached = plans.get(city.def);
  if (cached !== undefined) return cached;
  const { tepe, walls, suburbs, gates, seed, housing } = city.def;
  const angles = gates.map((g) => g.angle * DEG).sort((a, b) => a - b);
  const paths: Vec2[][] = [];
  suburbs.rings.forEach((offset, ring) => {
    const r = walls.radius + offset;
    const inner = ring === 0 ? walls.radius + 2 : walls.radius + suburbs.rings[ring - 1] + 1.5;
    angles.forEach((a0, k) => {
      const a1 = angles[(k + 1) % angles.length] + (k + 1 === angles.length ? Math.PI * 2 : 0);
      const arc: Vec2[] = [];
      const steps = Math.max(2, Math.ceil(((a1 - a0) * r) / 1.2));
      for (let s = 0; s <= steps; s++) {
        const a = a0 + ((a1 - a0) * s) / steps;
        const wobble = (valueNoise(a * 2.4 + ring * 5, seed % 71) - 0.5) * 1.6;
        arc.push(polar(tepe.x, tepe.z, a, r + wobble));
      }
      paths.push(arc);
      for (let j = 0; j < suburbs.alleys; j++) {
        const a = a0 + ((a1 - a0) * (j + 1)) / (suburbs.alleys + 1);
        const out = j % 2 === 0;
        const end = out ? r + 4 + valueNoise(a * 3, ring) * 3 : Math.max(inner, r - 4);
        paths.push([polar(tepe.x, tepe.z, a, r), polar(tepe.x, tepe.z, a + 0.03, end)]);
      }
    });
  });
  const plan = paths.map((path, k) => ({
    threshold: housing.startPopulation + (k + 1) * suburbs.every,
    path,
  }));
  plans.set(city.def, plan);
  return plan;
}

/** Opens the streets the population has reached. True when any were laid. */
export function growStreets(city: CityState): boolean {
  const plan = streetPlan(city);
  const start = city.streetsLaid;
  const reserved = landmarkReserve(city, 1);
  while (city.streetsLaid < plan.length && city.population >= plan[city.streetsLaid].threshold) {
    layStreet(city, plan[city.streetsLaid].path, reserved);
    city.streetsLaid++;
  }
  if (city.streetsLaid === start) return false;
  finishStreets(city);
  notify(city, 'Şehir büyüyor: varoşlarda yeni sokaklar açıldı.');
  return true;
}

/**
 * Lays again what a saved city had built: its rings of walls and its opened streets. Used
 * when a city is loaded, since walls and streets are not saved tile by tile.
 */
export function replayGrowth(city: CityState, built: number, streets: number): void {
  const plan = streetPlan(city);
  const reserved = landmarkReserve(city, 1);
  for (let k = 0; k < Math.min(streets, plan.length); k++) layStreet(city, plan[k].path, reserved);
  city.streetsLaid = Math.min(streets, plan.length);
  for (let stage = 0; stage < Math.min(built, city.def.expansions.length); stage++) raiseRing(city, stage);
  city.expansion.built = Math.min(built, city.def.expansions.length);
  finishStreets(city);
}
