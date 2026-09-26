import * as THREE from 'three';
import type { CityState } from '../sim/city';
import { axes } from '../sim/field';
import { sampleHeight } from '../sim/terrain';
import type { Footprint } from './army-view';
import { markOverlay } from './materials';

/** Most rectangles drawn at once, and the pieces each edge is cut into to follow the land. */
const MAX_FRAMES = 256;
const PIECES = 6;
/** Vertices of one frame: two triangles for every piece of each of its four edges. */
const VERTS_PER_FRAME = 4 * PIECES * 6;

/**
 * The chosen companies: a gilt band on the ground round each, and a paler one where each
 * company on the march is bound. The bands widen as the camera draws back, so they stay
 * as easy to see. Drawn over everything and never inked.
 */
export class SelectionView {
  readonly group = new THREE.Group();
  private readonly chosen: THREE.Mesh;
  private readonly bound: THREE.Mesh;
  private width = 0.06;

  constructor(private readonly city: CityState) {
    markOverlay(this.group);
    this.chosen = bands('#f2c14e', 0.95);
    this.bound = bands('#f8ecc4', 0.6);
    this.group.add(this.chosen, this.bound);
  }

  /** Draws a band round each footprint in `now`, and round each in `to`; `zoom` sets the width. */
  set(now: Footprint[], to: Footprint[], zoom: number): void {
    this.width = 0.04 + zoom * 0.0045;
    this.fill(this.chosen, now);
    this.fill(this.bound, to);
  }

  private fill(mesh: THREE.Mesh, frames: Footprint[]): void {
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = Math.min(frames.length, MAX_FRAMES);
    let o = 0;
    const { terrain } = this.city;
    const half = this.width / 2;
    const put = (x: number, z: number): void => {
      arr[o++] = x;
      arr[o++] = sampleHeight(terrain, x, z) + 0.07;
      arr[o++] = z;
    };
    for (let f = 0; f < n; f++) {
      const fp = frames[f];
      const a = axes(fp.heading);
      const hw = fp.w / 2;
      const hd = fp.d / 2;
      // Each edge runs from one corner to the next; the band lies across it, inside and out.
      const edges: Array<[number, number, number, number]> = [
        [-hw, -hd, hw, -hd],
        [hw, -hd, hw, hd],
        [hw, hd, -hw, hd],
        [-hw, hd, -hw, -hd],
      ];
      for (const [r0, f0, r1, f1] of edges) {
        const len = Math.hypot(r1 - r0, f1 - f0);
        // Across the edge, in the company's own frame, then into the world.
        const nr = (-(f1 - f0) / len) * half;
        const nf = ((r1 - r0) / len) * half;
        const world = (r: number, fw: number): [number, number] => [
          fp.x + a.rx * r + a.fx * fw,
          fp.z + a.rz * r + a.fz * fw,
        ];
        for (let p = 0; p < PIECES; p++) {
          const u0 = p / PIECES;
          const u1 = (p + 1) / PIECES;
          // The band runs a half-width past each corner so the corners close.
          const e0 = u0 === 0 ? -half / len : 0;
          const e1 = u1 === 1 ? half / len : 0;
          const ar = r0 + (r1 - r0) * (u0 + e0);
          const af = f0 + (f1 - f0) * (u0 + e0);
          const br = r0 + (r1 - r0) * (u1 + e1);
          const bf = f0 + (f1 - f0) * (u1 + e1);
          const [ax, az] = world(ar - nr, af - nf);
          const [bx, bz] = world(br - nr, bf - nf);
          const [cx, cz] = world(br + nr, bf + nf);
          const [dx, dz] = world(ar + nr, af + nf);
          put(ax, az);
          put(bx, bz);
          put(cx, cz);
          put(ax, az);
          put(cx, cz);
          put(dx, dz);
        }
      }
    }
    mesh.geometry.setDrawRange(0, n * VERTS_PER_FRAME);
    attr.needsUpdate = true;
    mesh.visible = n > 0;
  }
}

function bands(color: string, opacity: number): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MAX_FRAMES * VERTS_PER_FRAME * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.visible = false;
  return mesh;
}
