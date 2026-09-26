import * as THREE from 'three';
import { smoothstep } from '../core/geom';
import { fbm } from '../core/noise';
import type { CityState } from '../sim/city';
import { miniMaterial, markOverlay, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';
import { fertilityTexture, groundTexture, GROUND_TEXTURE_UNITS, waterTexture } from './textures';

/** The ground mesh, the fertility layer that can be laid over it, and the stream. */
export class TerrainView {
  readonly group = new THREE.Group();
  private readonly overlay: THREE.Mesh;
  private readonly waterTex: THREE.Texture;

  constructor(city: CityState) {
    const { terrain, def } = city;
    const n = terrain.grid.size;
    const geom = new THREE.PlaneGeometry(n, n, n, n);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const col = {
      plainAlt: new THREE.Color(PAL.plainAlt),
      lush: new THREE.Color(PAL.lush),
      urban: new THREE.Color(PAL.urban),
      hill: new THREE.Color(PAL.hill),
      rock: new THREE.Color(PAL.hillRock),
      tepe: new THREE.Color(PAL.tepe),
      bank: new THREE.Color(PAL.bank),
      ore: new THREE.Color(PAL.ore),
    };
    const oreAround = (cx: number, cz: number): number => {
      let k = 0;
      for (const [x, z] of [
        [cx - 1, cz - 1],
        [cx, cz - 1],
        [cx - 1, cz],
        [cx, cz],
      ]) {
        if (terrain.grid.inBounds(x, z) && terrain.ore[terrain.grid.index(x, z)] > 0) k++;
      }
      return k / 4;
    };
    const streamCorner = (cx: number, cz: number): number => {
      // Tile-centre distances are close enough for colouring the corners around them.
      const x = Math.min(n - 1, Math.max(0, cx));
      const z = Math.min(n - 1, Math.max(0, cz));
      return terrain.waterDistance[terrain.grid.index(x, z)];
    };
    // PlaneGeometry lays its vertices out row by row from -z to +z, matching our corners.
    for (let i = 0; i < pos.count; i++) {
      const cx = i % (n + 1);
      const cz = Math.floor(i / (n + 1));
      const x = cx - n / 2;
      const z = cz - n / 2;
      const h = terrain.corner[terrain.grid.cornerIndex(cx, cz)];
      pos.setY(i, h);
      uv.setXY(i, x / GROUND_TEXTURE_UNITS, z / GROUND_TEXTURE_UNITS);

      const r = Math.hypot(x - def.tepe.x, z - def.tepe.z);
      const ds = streamCorner(cx, cz);
      c.set(PAL.plain).lerp(col.plainAlt, fbm(x * 0.1, z * 0.1, 3, 5));
      c.lerp(col.lush, 1 - smoothstep(2, 12, ds));
      const hillT = r > def.tepe.footRadius + 2 ? smoothstep(0.8, 3.5, h) : 0;
      c.lerp(col.hill, hillT);
      c.lerp(col.rock, smoothstep(3.8, 6.5, h) * fbm(x * 0.15, z * 0.15, 3, 9) * 1.2);
      c.lerp(col.urban, 1 - smoothstep(def.walls.radius - 1, def.walls.radius + 1.5, r));
      c.lerp(
        col.tepe,
        smoothstep(def.tepe.topRadius - 0.5, def.tepe.topRadius + 0.5, r) *
          (1 - smoothstep(def.tepe.footRadius - 0.5, def.tepe.footRadius + 0.5, r)),
      );
      c.lerp(col.bank, 1 - smoothstep(0.9, 1.9, ds));
      // Iron stains the ground rust-red where a seam comes to the surface.
      c.lerp(col.ore, 0.6 * oreAround(cx, cz));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();
    const ground = new THREE.Mesh(geom, miniMaterial({ map: groundTexture(), vertexColors: true }));
    ground.receiveShadow = true;
    setInkClass(ground, INK_CLASS.ground);
    this.group.add(ground);

    // Fertility layer: same surface, lifted a hair, drawn only when asked for.
    const overlayMat = new THREE.MeshBasicMaterial({
      map: fertilityTexture(terrain),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const overlayGeom = geom.clone();
    // The overlay samples one texel per tile, so it needs plain 0..1 UVs across the map.
    const ouv = overlayGeom.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < ouv.count; i++) {
      const cx = i % (n + 1);
      const cz = Math.floor(i / (n + 1));
      ouv.setXY(i, cx / n, cz / n);
    }
    this.overlay = new THREE.Mesh(overlayGeom, overlayMat);
    this.overlay.visible = false;
    this.overlay.renderOrder = 2;
    markOverlay(this.overlay);
    this.group.add(this.overlay);

    // Stream: one ribbon along the centre line at the water level, wide enough to cover
    // the cut banks, with waves that drift downstream.
    this.waterTex = waterTexture(PAL.water);
    const water = new THREE.Mesh(
      ribbonGeometry(terrain.streamPath, def.stream.width + 1.2, () => terrain.waterLevel, 3.2),
      miniMaterial({ map: this.waterTex }),
    );
    water.receiveShadow = true;
    setInkClass(water, INK_CLASS.water);
    this.group.add(water);
  }

  setFertilityVisible(visible: boolean): void {
    this.overlay.visible = visible;
  }

  get fertilityVisible(): boolean {
    return this.overlay.visible;
  }

  /** Slow drift of the water motifs. */
  update(seconds: number): void {
    this.waterTex.offset.y = -seconds * 0.05;
  }
}

/**
 * A flat strip following a path. `yAt` gives the height of each edge vertex; `uvLength`
 * is how many world units one texture repeat covers along the path.
 */
export function ribbonGeometry(
  path: ReadonlyArray<readonly [number, number]>,
  width: number,
  yAt: (x: number, z: number) => number,
  uvLength = 4,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let travelled = 0;
  for (let i = 0; i < path.length; i++) {
    const [x, z] = path[i];
    const [ax, az] = path[Math.max(0, i - 1)];
    const [bx, bz] = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    if (i > 0) travelled += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]);
    for (const side of [-0.5, 0.5]) {
      const px = x + nx * width * side;
      const pz = z + nz * width * side;
      positions.push(px, yAt(px, pz), pz);
      uvs.push(side + 0.5, travelled / uvLength);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      // Wound so the face points up.
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
