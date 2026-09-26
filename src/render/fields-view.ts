import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { dateOf } from '../sim/calendar';
import type { CityState } from '../sim/city';
import type { Field } from '../sim/countryside';
import { sampleHeight } from '../sim/terrain';
import { box, PartBatch } from './builder';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';
import { FIELD_TEXTURE_UNITS, fieldTexture, type FieldLook } from './textures';

/** Gap left along every field edge, so neighbouring fields read as separate strips. */
const INSET = 0.08;

/** Sheep grazing on each tile of pasture, outside winter. */
const SHEEP_PER_TILE = 0.7;

/**
 * How a field looks in a given month (0-based). Winter wheat and barley are sown in the
 * autumn, green through the spring, ripe in early summer and cut in Temmuz.
 */
export function fieldLook(f: Field, month: number): FieldLook {
  const winter = month === 11 || month <= 1;
  if (f.kind === 'mera') return winter ? 'kis' : 'mera';
  if (f.fallow) return 'nadas';
  if (winter) return 'kis';
  if (month === 8 || month === 9) return 'surulmus';
  if (month === 5 || month === 6) return f.crop;
  if (month === 7) return 'aniz';
  return 'yesil';
}

/**
 * The fields, drawn in their season's colours, and the pastures with their fences and
 * flocks. One merged mesh per look keeps draw calls low; the whole set is rebuilt when
 * fields change or the month turns.
 */
export class FieldsView {
  readonly group = new THREE.Group();
  private key = '';
  private readonly textures = new Map<FieldLook, THREE.Texture>();
  private readonly sheepBody = new THREE.SphereGeometry(0.11, 8, 6)
    .scale(1.35, 0.85, 0.9)
    .translate(0, 0.1, 0);
  private readonly sheepHead = new THREE.BoxGeometry(0.07, 0.07, 0.08).translate(0.15, 0.13, 0);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.field);
    this.sync();
  }

  sync(): boolean {
    const month = dateOf(this.city.calendar).month;
    const key = `${this.city.revision.fields}:${month}`;
    if (key === this.key) return false;
    this.key = key;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
    }
    const byLook = new Map<FieldLook, Field[]>();
    for (const f of this.city.fields.values()) {
      const look = fieldLook(f, month);
      const list = byLook.get(look) ?? [];
      list.push(f);
      byLook.set(look, list);
    }
    for (const [look, list] of byLook) {
      const geom = mergeFields(this.city, list);
      const mesh = new THREE.Mesh(geom, miniMaterial({ map: this.texture(look) }));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.pastures(month);
    return true;
  }

  /** Wattle fences round every pasture and its flock, out on the grass except in winter. */
  private pastures(month: number): void {
    const { grid, terrain } = this.city;
    const meras = [...this.city.fields.values()].filter((f) => f.kind === 'mera');
    if (meras.length === 0) return;
    const fences = new PartBatch();
    const sheep: THREE.Matrix4[] = [];
    const winter = month === 11 || month <= 1;
    const up = new THREE.Vector3(0, 1, 0);
    for (const f of meras) {
      const x0 = f.x0 - grid.half + 0.12;
      const z0 = f.z0 - grid.half + 0.12;
      const x1 = f.x0 - grid.half + f.w - 0.12;
      const z1 = f.z0 - grid.half + f.d - 0.12;
      const rail = (ax: number, az: number, bx: number, bz: number): void => {
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.round(len));
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps;
          const t1 = (k + 1) / steps;
          const px = ax + (bx - ax) * (t0 + t1) * 0.5;
          const pz = az + (bz - az) * (t0 + t1) * 0.5;
          const y = sampleHeight(terrain, px, pz);
          const piece = fences.frame(px, y, pz, Math.atan2(bz - az, bx - ax) * -1);
          piece.part(box(len / steps + 0.02, 0.05, 0.03), PAL.fence, 0, 0.14, 0);
          piece.part(box(0.04, 0.2, 0.04), PAL.fence, -len / steps / 2, 0, 0);
        }
      };
      rail(x0, z0, x1, z0);
      rail(x1, z0, x1, z1);
      rail(x1, z1, x0, z1);
      rail(x0, z1, x0, z0);
      if (winter) continue;
      const count = Math.round(f.tiles.length * SHEEP_PER_TILE);
      for (let k = 0; k < count; k++) {
        const x = x0 + 0.2 + hash2(f.id, k, 61) * (x1 - x0 - 0.4);
        const z = z0 + 0.2 + hash2(f.id, k, 62) * (z1 - z0 - 0.4);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x, sampleHeight(terrain, x, z), z),
          new THREE.Quaternion().setFromAxisAngle(up, hash2(f.id, k, 63) * Math.PI * 2),
          new THREE.Vector3(1, 1, 1),
        );
        sheep.push(m);
      }
    }
    fences.build(this.group, INK_CLASS.tree);
    if (sheep.length === 0) return;
    for (const [geom, color] of [
      [this.sheepBody, PAL.wool],
      [this.sheepHead, PAL.sheepHead],
    ] as const) {
      const mesh = new THREE.InstancedMesh(geom, miniMaterial({ color }), sheep.length);
      sheep.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      setInkClass(mesh, INK_CLASS.building);
      this.group.add(mesh);
    }
  }

  private texture(look: FieldLook): THREE.Texture {
    let t = this.textures.get(look);
    if (t === undefined) {
      t = fieldTexture(look);
      this.textures.set(look, t);
    }
    return t;
  }
}

/** One grid mesh per field, draped on the terrain, merged into a single geometry. */
function mergeFields(city: CityState, fields: readonly Field[]): THREE.BufferGeometry {
  const { grid, terrain } = city;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const f of fields) {
    const base = positions.length / 3;
    const along = f.w >= f.d; // furrows follow the long side
    const cols = f.w + 1;
    for (let j = 0; j <= f.d; j++) {
      for (let k = 0; k <= f.w; k++) {
        let x = f.x0 - grid.half + k;
        let z = f.z0 - grid.half + j;
        if (k === 0) x += INSET;
        if (k === f.w) x -= INSET;
        if (j === 0) z += INSET;
        if (j === f.d) z -= INSET;
        positions.push(x, sampleHeight(terrain, x, z) + 0.03, z);
        const u = along ? z : x;
        const v = along ? x : z;
        uvs.push(u / FIELD_TEXTURE_UNITS, v / FIELD_TEXTURE_UNITS);
      }
    }
    for (let j = 0; j < f.d; j++) {
      for (let k = 0; k < f.w; k++) {
        const a = base + j * cols + k;
        index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
