import { WALL, WALL_GATE, type CityState } from './city';

export interface TileInfo {
  x: number;
  z: number;
  /** What the ground is, in the player's words. */
  land: string;
  /** What stands on it. */
  feature: string;
  height: number;
  /** 0..1, or null where farming makes no sense (water, inside the walls). */
  fertility: number | null;
}

/** Everything the info panel shows about one tile. */
export function inspectTile(city: CityState, x: number, z: number): TileInfo | null {
  const { grid, terrain } = city;
  if (!grid.inBounds(x, z)) return null;
  const i = grid.index(x, z);
  const height = terrain.height[i];
  const slope = terrain.slope[i];
  const r = Math.hypot(grid.centre(x) - city.def.tepe.x, grid.centre(z) - city.def.tepe.z);
  const insideWalls = r < city.def.walls.radius;

  let land: string;
  if (terrain.water[i] === 1) land = city.def.stream.name;
  else if (r < city.def.tepe.footRadius) land = 'Alaeddin Tepesi';
  else if (insideWalls) land = 'Sur içi';
  else if (slope > 0.45) land = 'Yamaç';
  else if (height > 1.4) land = 'Tepelik';
  else land = 'Ova';

  let feature = 'Boş';
  const s = city.structure[i];
  if (s >= 0) feature = city.landmarks[s]?.name ?? 'Yapı';
  else if (city.wall[i] === WALL) feature = 'Sur';
  else if (city.wall[i] === WALL_GATE) {
    const gate = city.gates.find((g) => g.tiles.includes(i));
    feature = gate?.name ?? 'Kapı';
  } else if (city.road[i] === 1) feature = terrain.water[i] === 1 ? 'Köprü' : 'Yol';
  else if (city.house[i] > 0) feature = city.house[i] === 2 ? 'İki katlı ev' : 'Ev';

  const farmable = terrain.water[i] === 0 && !insideWalls;
  return { x, z, land, feature, height, fertility: farmable ? terrain.fertility[i] : null };
}
