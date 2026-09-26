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
/** Vertices of the mark on a frame's front: a bar along it and an arrowhead before it. */
const VERTS_PER_MARK = 12;
/** Vertices of the great arrow over a front being drawn: a shaft and a head. */
const VERTS_LEAD = 9;

/** Frames where companies are bound, and the same while a front is being drawn. */
const BOUND = '#f8ecc4';
const DRAWN = '#2f6fd0';
/** The arrows on the frames of companies on the march. */
const BOUND_FRONT = '#b8321f';
/** Raiders the chosen companies are sent against. */
const FOE = '#d0302a';

/** A front being drawn: its middle, the way the army will face, and how wide it is. */
export interface Lead {
  x: number;
  z: number;
  heading: number;
  width: number;
}

/**
 * The chosen companies: a gilt band on the ground round each, and a paler one where each
 * company on the march is bound. The front of every frame is marked, a bar along it and an
 * arrowhead before it, so the way the company faces (or will face) shows at a glance. The
 * bands widen as the camera draws back, so they stay as easy to see. While the player
 * draws a front, its frames turn blue and a great arrow over its middle shows which way the
 * army will face. Drawn over everything and never inked.
 */
export class SelectionView {
  readonly group = new THREE.Group();
  private readonly chosen: THREE.Mesh;
  private readonly bound: THREE.Mesh;
  private readonly chosenFront: THREE.Mesh;
  private readonly boundFront: THREE.Mesh;
  private readonly lead: THREE.Mesh;
  private readonly marked: THREE.Mesh;
  private readonly markedFront: THREE.Mesh;
  private width = 0.06;

  constructor(private readonly city: CityState) {
    markOverlay(this.group);
    this.chosen = bands('#f2c14e', 0.95, VERTS_PER_FRAME);
    this.bound = bands(BOUND, 0.6, VERTS_PER_FRAME);
    this.chosenFront = bands('#f2c14e', 0.95, VERTS_PER_MARK);
    this.boundFront = bands(BOUND_FRONT, 0.9, VERTS_PER_MARK);
    this.lead = bands(DRAWN, 0.85, VERTS_LEAD, 1);
    this.marked = bands(FOE, 0.9, VERTS_PER_FRAME);
    this.markedFront = bands(FOE, 0.9, VERTS_PER_MARK);
    this.group.add(
      this.chosen,
      this.bound,
      this.chosenFront,
      this.boundFront,
      this.lead,
      this.marked,
      this.markedFront,
    );
  }

  /**
   * Draws a band round each footprint in `now`, and round each in `to`; `zoom` sets the
   * width. With a `lead`, `to` is a front being drawn. `foes` are the raiders the chosen
   * companies are sent against, framed in red.
   */
  set(
    now: Footprint[],
    to: Footprint[],
    zoom: number,
    lead: Lead | null = null,
    foes: Footprint[] = [],
  ): void {
    this.width = 0.04 + zoom * 0.0045;
    const drawing = lead !== null;
    tint(this.bound, drawing ? DRAWN : BOUND, drawing ? 0.9 : 0.6);
    tint(this.boundFront, drawing ? DRAWN : BOUND_FRONT, 0.9);
    this.fill(this.chosen, now);
    this.fill(this.bound, to);
    this.mark(this.chosenFront, now);
    this.mark(this.boundFront, to);
    this.fill(this.marked, foes);
    this.mark(this.markedFront, foes);
    this.arrow(lead);
  }

  /** The great arrow before the middle of a front being drawn, the way the army will face. */
  private arrow(lead: Lead | null): void {
    const mesh = this.lead;
    mesh.visible = lead !== null;
    if (lead === null) return;
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const a = axes(lead.heading);
    let o = 0;
    const put = (r: number, f: number): void => {
      const x = lead.x + a.rx * r + a.fx * f;
      const z = lead.z + a.rz * r + a.fz * f;
      arr[o++] = x;
      arr[o++] = sampleHeight(this.city.terrain, x, z) + 0.09;
      arr[o++] = z;
    };
    // As long as a quarter of the front, but never lost from afar nor overbearing.
    const len = Math.min(10, Math.max(this.width * 14, lead.width * 0.25));
    const shaft = len * 0.08;
    const head = len * 0.4;
    // Beyond the arrowheads of the frames in the front rank.
    const start = this.width * 12;
    put(-shaft, start);
    put(shaft, start);
    put(shaft, start + len - head);
    put(-shaft, start);
    put(shaft, start + len - head);
    put(-shaft, start + len - head);
    put(-head * 0.6, start + len - head);
    put(head * 0.6, start + len - head);
    put(0, start + len);
    mesh.geometry.setDrawRange(0, VERTS_LEAD);
    attr.needsUpdate = true;
  }

  /** A bar along the front edge of each frame, outside it, and an arrowhead before that. */
  private mark(mesh: THREE.Mesh, frames: Footprint[]): void {
    const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const n = Math.min(frames.length, MAX_FRAMES);
    const { terrain } = this.city;
    let o = 0;
    const w = this.width;
    // Big enough to read from afar, never much smaller than the band is wide.
    const len = Math.max(0.4, w * 6);
    for (let f = 0; f < n; f++) {
      const fp = frames[f];
      const a = axes(fp.heading);
      const put = (r: number, fw: number): void => {
        const x = fp.x + a.rx * r + a.fx * fw;
        const z = fp.z + a.rz * r + a.fz * fw;
        arr[o++] = x;
        arr[o++] = sampleHeight(terrain, x, z) + 0.07;
        arr[o++] = z;
      };
      const hw = fp.w / 2 + w / 2;
      const front = fp.d / 2 + w / 2;
      // The bar doubles the band on the front edge.
      put(-hw, front);
      put(hw, front);
      put(hw, front + w);
      put(-hw, front);
      put(hw, front + w);
      put(-hw, front + w);
      // The arrowhead: a tip, two barbs and a notch between them.
      const base = front + w * 2;
      const half = Math.min(len * 0.75, Math.max(hw, len * 0.5));
      put(0, base + len);
      put(-half, base);
      put(0, base + len * 0.35);
      put(0, base + len);
      put(0, base + len * 0.35);
      put(half, base);
    }
    mesh.geometry.setDrawRange(0, n * VERTS_PER_MARK);
    attr.needsUpdate = true;
    mesh.visible = n > 0;
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

/** Sets a band mesh's colour and opacity. */
function tint(mesh: THREE.Mesh, color: string, opacity: number): void {
  const m = mesh.material as THREE.MeshBasicMaterial;
  if (m.userData.color !== color) {
    m.color.set(color);
    m.userData.color = color;
  }
  m.opacity = opacity;
}

function bands(color: string, opacity: number, verts: number, frames = MAX_FRAMES): THREE.Mesh {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(frames * verts * 3), 3).setUsage(THREE.DynamicDrawUsage),
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
