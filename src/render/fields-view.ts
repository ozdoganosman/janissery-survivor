import * as THREE from 'three';
import { dateOf } from '../sim/calendar';
import type { CityState } from '../sim/city';
import type { Field } from '../sim/fields';
import { sampleHeight } from '../sim/terrain';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS } from './palette';
import { FIELD_TEXTURE_UNITS, fieldTexture, type FieldLook } from './textures';

/** Gap left along every field edge, so neighbouring fields read as separate strips. */
const INSET = 0.08;

/** How a field looks in a given month (0-based). */
export function fieldLook(f: Field, month: number): FieldLook {
  const winter = month === 11 || month <= 1;
  switch (f.stage) {
    case 'nadas':
      return 'nadas';
    case 'bos':
      return winter ? 'kis' : 'surulmus';
    case 'hasat':
      return winter ? 'kis' : 'aniz';
    case 'ekili':
      // Green through spring; ripe gold in the weeks before the August harvest.
      if (month >= 5) return f.crop === 'arpa' ? 'arpa' : 'bugday';
      return 'yesil';
  }
}

/**
 * The fields, drawn in their season's colours. One merged mesh per look keeps draw calls
 * low; the whole set is rebuilt when fields change or the month turns.
 */
export class FieldsView {
  readonly group = new THREE.Group();
  private key = '';
  private readonly textures = new Map<FieldLook, THREE.Texture>();

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
      if (child instanceof THREE.Mesh) (child.geometry as THREE.BufferGeometry).dispose();
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
    return true;
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
