import * as THREE from 'three';
import { hash2 } from '../core/rng';
import type { CityState } from '../sim/city';
import { DIRS4 } from '../sim/grid';
import { sampleHeight } from '../sim/terrain';
import { miniMaterial, setInkClass } from './materials';
import { INK_CLASS, PAL } from './palette';

const STOREY = 0.36;

/**
 * Houses: flat-roofed mudbrick, the Konya type. One instanced mesh per part, so a city of
 * thousands of houses is still a handful of draw calls.
 *
 * Every variation (size, colour, roof room, turn) is a hash of the tile, so a house keeps
 * its look when something is built next door.
 */
export class HousesView {
  readonly group = new THREE.Group();
  private revision = -1;
  private readonly unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

  constructor(private readonly city: CityState) {
    setInkClass(this.group, INK_CLASS.building);
    this.sync(true);
  }

  /** Rebuilds when houses changed, or when roads changed (houses turn to face them). */
  sync(force = false): boolean {
    const rev = this.city.revision.houses * 100003 + this.city.revision.roads;
    if (!force && rev === this.revision) return false;
    this.revision = rev;
    for (const child of this.group.children.slice()) {
      this.group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
    this.build();
    return true;
  }

  private build(): void {
    const { grid, terrain, house, road } = this.city;
    const bodies: Part[] = [];
    const roofs: Part[] = [];
    const openings: Part[] = [];
    for (let i = 0; i < house.length; i++) {
      const storeys = house[i];
      if (storeys === 0) continue;
      const tx = i % grid.size;
      const tz = Math.floor(i / grid.size);
      const h0 = hash2(tx, tz, 1);
      const h1 = hash2(tx, tz, 2);
      const h2 = hash2(tx, tz, 3);
      const w = 0.62 + 0.22 * h0;
      const d = 0.6 + 0.22 * h1;
      const x = grid.centre(tx) + (h2 - 0.5) * (1 - w) * 0.8;
      const z = grid.centre(tz) + (h1 - 0.5) * (1 - d) * 0.8;

      // Face a neighbouring street if there is one; otherwise keep the hashed turn.
      let rot = Math.floor(h0 * 4) * (Math.PI / 2);
      for (const [dx, dz] of DIRS4) {
        const nx = tx + dx;
        const nz = tz + dz;
        if (grid.inBounds(nx, nz) && road[grid.index(nx, nz)] === 1) {
          rot = Math.atan2(dx, dz);
          break;
        }
      }
      rot += (h2 - 0.5) * 0.18;

      let base = Infinity;
      for (const [cx, cz] of [
        [x - w / 2, z - d / 2],
        [x + w / 2, z - d / 2],
        [x - w / 2, z + d / 2],
        [x + w / 2, z + d / 2],
      ]) {
        base = Math.min(base, sampleHeight(terrain, cx, cz));
      }
      const wallH = storeys * STOREY + 0.06;
      const color = PAL.houses[Math.floor(hash2(tx, tz, 4) * PAL.houses.length)];
      const roof = PAL.roofs[Math.floor(hash2(tx, tz, 5) * PAL.roofs.length)];
      const frame = new Frame(x, base, z, rot);
      bodies.push(frame.part(0, -0.3, 0, w, wallH + 0.3, d, color));
      roofs.push(frame.part(0, wallH, 0, w + 0.06, 0.05, d + 0.06, roof));
      if (hash2(tx, tz, 6) < 0.22) {
        // A small room on the roof, reached by an outside stair: a common Konya silhouette.
        const rw = w * 0.45;
        const rd = d * 0.45;
        bodies.push(frame.part(-w * 0.2, wallH + 0.05, -d * 0.2, rw, 0.26, rd, color));
        roofs.push(frame.part(-w * 0.2, wallH + 0.31, -d * 0.2, rw + 0.05, 0.04, rd + 0.05, roof));
      }
      openings.push(frame.part(w * 0.18, 0, d / 2 + 0.005, 0.16, 0.26, 0.02, PAL.door));
      const windowY = storeys === 2 ? STOREY + 0.12 : 0.17;
      openings.push(frame.part(-w * 0.22, windowY, d / 2 + 0.005, 0.1, 0.1, 0.02, PAL.door));
      if (storeys === 2) openings.push(frame.part(w * 0.2, windowY, d / 2 + 0.005, 0.1, 0.1, 0.02, PAL.door));
    }
    this.instanced(bodies, true);
    this.instanced(roofs, true);
    this.instanced(openings, false);
  }

  private instanced(parts: Part[], castShadow: boolean): void {
    if (parts.length === 0) return;
    const mesh = new THREE.InstancedMesh(this.unit, miniMaterial(), parts.length);
    const color = new THREE.Color();
    parts.forEach((p, k) => {
      mesh.setMatrixAt(k, p.matrix);
      mesh.setColorAt(k, color.set(p.color));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}

interface Part {
  matrix: THREE.Matrix4;
  color: string;
}

/** A turned local frame that turns box specs into instance matrices. */
class Frame {
  private readonly q: THREE.Quaternion;
  private readonly origin: THREE.Vector3;

  constructor(x: number, y: number, z: number, rot: number) {
    this.origin = new THREE.Vector3(x, y, z);
    this.q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
  }

  part(lx: number, ly: number, lz: number, w: number, h: number, d: number, color: string): Part {
    const p = new THREE.Vector3(lx, ly, lz).applyQuaternion(this.q).add(this.origin);
    return { matrix: new THREE.Matrix4().compose(p, this.q, new THREE.Vector3(w, h, d)), color };
  }
}
