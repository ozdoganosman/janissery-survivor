import type { Vec2 } from '../core/geom';
import { valueNoise } from '../core/noise';
import { DAYS_PER_MONTH } from './calendar';
import {
  DEG,
  landmarkReserve,
  polar,
  pruneRoadFragments,
  rasterizePath,
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
import { DIRS4 } from './grid';
import { layLots, syncHouses } from './housing';
import { notify } from './notices';
import {
  boundAt,
  insideRing,
  planRing,
  ringBand,
  runDistance,
  stepOf,
  wallDepth,
  type WallRing,
} from './walls';

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
 * Lays one ring of walls: a wall on every tile along its lines that is free, a gate
 * wherever a street crosses it, and inside it a ring street with lanes off it and roads out
 * to the older town between its gates. The ring keeps to the town's side of the stream;
 * landmarks and the player's buildings are left alone, so a building stands in a gap of it.
 * A street that only runs alongside the new wall is cut rather than given a long gate.
 */
export function raiseRing(city: CityState, stage: number): void {
  const def = city.def.expansions[stage];
  const ring = planRing(city, stage);
  const { grid, terrain } = city;
  const { tepe } = city.def;
  const band = ringBand(grid, ring, 0.8);
  const underRoad = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) {
    if (band[i] === 0 || city.wall[i] !== WALL_NONE) continue;
    if (terrain.water[i] === 1 || city.structure[i] >= 0 || city.building[i] >= 0) continue;
    if (city.road[i] === 1) {
      underRoad[i] = 1;
      continue;
    }
    city.wall[i] = WALL;
    city.house[i] = 0;
    if (city.field[i] >= 0) removeField(city, city.field[i]);
  }
  gateCrossings(city, ring, underRoad);
  const inner = city.rings[stage];
  city.rings.push(ring);

  const reserved = landmarkReserve(city, 1);
  const salt = (city.def.seed % 83) + stage * 7;
  const at = (a: number, r: number): Vec2 => polar(tepe.x, tepe.z, a, r);
  const walledAt = (a: number): boolean => ring.walled[stepOf(a)] === 1;
  const street = (a: number): number =>
    boundAt(ring, a) - 2.2 + (valueNoise(a * 2.2 + salt, salt) - 0.5) * 0.8;
  // The ring street, inside each stretch of wall; it stops short of the ends.
  for (const run of ring.runs) {
    if (run.spur) continue;
    const angles = run.points.map(([x, z]) => Math.atan2(z - tepe.z, x - tepe.x));
    const trim = run.closed ? 0 : 6;
    const path: Vec2[] = [];
    for (let j = trim; j < angles.length - trim; j += 3) path.push(at(angles[j], street(angles[j])));
    if (run.closed) path.push(path[0]);
    if (path.length > 1) layStreet(city, path, reserved);
  }
  // Roads out from the older walls to the new ring street, between the gate roads.
  const gates = city.def.gates.map((g) => g.angle * DEG).sort((a, b) => a - b);
  gates.forEach((a, k) => {
    const next = gates[(k + 1) % gates.length] + (k + 1 === gates.length ? Math.PI * 2 : 0);
    const mid = (a + next) / 2;
    if (!walledAt(mid)) return;
    layStreet(city, [at(mid, boundAt(inner, mid) + 2), at(mid, street(mid))], reserved);
  });
  // Lanes off the ring street into the new quarters.
  for (let k = 0; k < def.alleys; k++) {
    const a = (k / def.alleys) * Math.PI * 2 + stage * 0.37 + valueNoise(k * 1.7, stage) * 0.2;
    if (!walledAt(a)) continue;
    const from = street(a);
    const end = Math.max(boundAt(inner, a) + 3, from - 3 - valueNoise(k, stage + 5) * 3);
    if (end >= from - 1) continue;
    layStreet(city, [at(a, from), at(a + (valueNoise(k, 9) - 0.5) * 0.08, end)], reserved);
  }
  city.revision.walls++;
}

/**
 * Decides, for each street the new wall has come down on, whether it passes through (a
 * gate) or only ran along where the wall now stands (the street gives way to the wall).
 */
function gateCrossings(city: CityState, ring: WallRing, underRoad: Uint8Array): void {
  const { grid } = city;
  const seen = new Uint8Array(grid.count);
  const side = (i: number): boolean =>
    insideRing(city, ring, grid.centre(i % grid.size), grid.centre(Math.floor(i / grid.size)));
  for (let start = 0; start < grid.count; start++) {
    if (underRoad[start] === 0 || seen[start] === 1) continue;
    const group: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let inside = false;
    let outside = false;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      group.push(i);
      const x = i % grid.size;
      const z = Math.floor(i / grid.size);
      for (const [dx, dz] of DIRS4) {
        if (!grid.inBounds(x + dx, z + dz)) continue;
        const j = grid.index(x + dx, z + dz);
        if (underRoad[j] === 1) {
          if (seen[j] === 0) {
            seen[j] = 1;
            stack.push(j);
          }
        } else if (city.road[j] === 1 && city.wall[j] === WALL_NONE) {
          if (side(j)) inside = true;
          else outside = true;
        }
      }
    }
    const through = inside && outside;
    for (const i of group) {
      city.wall[i] = through ? WALL_GATE : WALL;
      if (through) continue;
      city.road[i] = 0;
      city.house[i] = 0;
      if (city.field[i] >= 0) removeField(city, city.field[i]);
    }
  }
}

/**
 * Paints a street along a path. It goes round water, landmarks, the city's quarry and the
 * player's buildings; houses and fields in its way make room. Where it crosses a wall it
 * makes a gate; where it would only run along one, it stops short of it.
 */
function layStreet(city: CityState, path: readonly Vec2[], reserved: Uint8Array): void {
  const { grid, terrain } = city;
  const tiles = rasterizePath(grid, path).filter(([x, z]) => grid.inBounds(x, z));
  const depth = (t: [number, number]): number => wallDepth(city, grid.centre(t[0]), grid.centre(t[1]));
  const through = new Uint8Array(tiles.length);
  for (let k = 0; k < tiles.length;) {
    if (city.wall[grid.index(...tiles[k])] === WALL_NONE) {
      k++;
      continue;
    }
    let end = k;
    while (end < tiles.length && city.wall[grid.index(...tiles[end])] !== WALL_NONE) end++;
    const crosses = k > 0 && end < tiles.length && depth(tiles[k - 1]) !== depth(tiles[end]);
    if (crosses) through.fill(1, k, end);
    k = end;
  }
  tiles.forEach(([x, z], k) => {
    const i = grid.index(x, z);
    if (terrain.water[i] === 1 || terrain.site[i] > 0) return;
    if (city.structure[i] >= 0 || reserved[i] === 1 || city.building[i] >= 0) return;
    if (city.wall[i] !== WALL_NONE) {
      if (through[k] === 0) return;
      city.wall[i] = WALL_GATE;
    }
    city.road[i] = 1;
    city.house[i] = 0;
    if (city.field[i] >= 0) removeField(city, city.field[i]);
  });
}

/** After streets are laid: gates named, thick crossings thinned, lots and houses laid anew. */
export function finishStreets(city: CityState): void {
  refreshGates(city);
  const locked = new Uint8Array(city.grid.count);
  for (let i = 0; i < locked.length; i++) if (city.wall[i] === WALL_GATE) locked[i] = 1;
  thinRoads(city, locked);
  pruneRoadFragments(city, locked, 4);
  layLots(city);
  syncHouses(city);
  city.revision.roads++;
  city.revision.walls++;
}

/** Finds the gates in every raised ring and names them after the gate roads they carry. */
export function refreshGates(city: CityState): void {
  const { grid } = city;
  const { tepe } = city.def;
  const first = city.gates.filter((g) => g.ring === 0);
  const gates: Gate[] = [...first];
  const old = new Set(first.flatMap((g) => g.tiles));
  const suffix = ['', 'Dış', 'Varoş', 'Yeni'];
  // Each gate tile belongs to the ring whose wall runs nearest it.
  const hitsByRing: Array<Array<{ i: number; a: number; r: number }>> = city.rings.map(() => []);
  for (let i = 0; i < grid.count; i++) {
    if (city.wall[i] !== WALL_GATE || old.has(i)) continue;
    const x = grid.centre(i % grid.size);
    const z = grid.centre(Math.floor(i / grid.size));
    let best = 1.3;
    let owner = -1;
    city.rings.forEach((ring, k) => {
      if (k === 0) return;
      for (const run of ring.runs) {
        const d = runDistance(run, x, z);
        if (d < best) {
          best = d;
          owner = k;
        }
      }
    });
    if (owner < 0) continue;
    const a = (Math.atan2(z - tepe.z, x - tepe.x) + Math.PI * 2) % (Math.PI * 2);
    hitsByRing[owner].push({ i, a, r: Math.hypot(x - tepe.x, z - tepe.z) });
  }
  hitsByRing.forEach((hits, k) => {
    if (k === 0 || hits.length === 0) return;
    const ring = city.rings[k];
    const near = 2 / ring.radius;
    hits.sort((p, q) => p.a - q.a);
    const clusters: Array<typeof hits> = [];
    for (const h of hits) {
      const last = clusters[clusters.length - 1];
      if (last !== undefined && h.a - last[last.length - 1].a < near) last.push(h);
      else clusters.push([h]);
    }
    // A cluster straddling angle zero is one gate.
    if (clusters.length > 1) {
      const head = clusters[0][0].a;
      const tail = clusters[clusters.length - 1];
      if (head + Math.PI * 2 - tail[tail.length - 1].a < near) {
        clusters[0] = [...tail.map((h) => ({ ...h, a: h.a - Math.PI * 2 })), ...clusters[0]];
        clusters.pop();
      }
    }
    for (const c of clusters) {
      const angle = c.reduce((s, h) => s + h.a, 0) / c.length;
      const road = city.def.gates.find((g) => {
        const d = Math.abs(((g.angle * DEG - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return d < 0.3;
      });
      const tag = suffix[Math.min(k, suffix.length - 1)];
      gates.push({
        name:
          road !== undefined ? `${road.name.replace(/ Kapısı$/, '')} ${tag} Kapısı` : `${ring.name} Kapısı`,
        angle,
        tiles: c.map((h) => h.i),
        radius: c.reduce((s, h) => s + h.r, 0) / c.length,
        ring: k,
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
