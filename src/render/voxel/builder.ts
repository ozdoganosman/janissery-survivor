import * as THREE from 'three';
import type { LimbRole, VoxelBox, VoxelModel, VoxelPart } from './schema';

/**
 * Turns a voxel model description into one merged geometry per part.
 *
 * Boxes are emitted face by face rather than as `BoxGeometry` instances, for two
 * reasons: every box in a part collapses into a single draw-ready buffer, and faces
 * that can never be seen are dropped before they reach the GPU.
 *
 * ## About the face culling
 *
 * The original plan called for culling faces pointing away from the camera, on the
 * grounds that the camera angle is fixed. That reasoning is wrong and is not what
 * this does: the camera angle is fixed, but *figures rotate to face their direction
 * of travel*, so a face hidden while a figure walks north is plainly visible when it
 * walks south. Culling by camera direction would punch holes in every enemy that
 * turned around.
 *
 * What is culled instead is view-independent: a face completely covered by another
 * box that occupies the space just beyond it. Those faces are interior to the model
 * and cannot be seen from any angle. The saving is smaller than the plan's optimistic
 * ~40% — `BuiltModel` reports the real figure so it can be checked rather than
 * assumed.
 *
 * Occlusion is only considered between boxes that cannot move apart: boxes within
 * one part always, and boxes in two different parts only when both parts are
 * `static`. An arm hides part of the torso while hanging at rest, but that torso
 * face is exposed the moment the arm swings, so it must survive.
 */

/** Axis-aligned bounds in voxel units, as `[minX, minY, minZ, maxX, maxY, maxZ]`. */
type Bounds = [number, number, number, number, number, number];

interface FaceBasis {
  /** Axis the face faces along: 0 = x, 1 = y, 2 = z. */
  readonly axis: 0 | 1 | 2;
  /** Which side of the box: +1 or -1. */
  readonly sign: 1 | -1;
  readonly normal: THREE.Vector3Like;
  /** In-plane basis chosen so that `u × v` equals the normal, giving CCW winding. */
  readonly u: THREE.Vector3Like;
  readonly v: THREE.Vector3Like;
}

const FACES: readonly FaceBasis[] = [
  {
    axis: 0,
    sign: 1,
    normal: { x: 1, y: 0, z: 0 },
    u: { x: 0, y: 0, z: -1 },
    v: { x: 0, y: 1, z: 0 },
  },
  {
    axis: 0,
    sign: -1,
    normal: { x: -1, y: 0, z: 0 },
    u: { x: 0, y: 0, z: 1 },
    v: { x: 0, y: 1, z: 0 },
  },
  {
    axis: 1,
    sign: 1,
    normal: { x: 0, y: 1, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: -1 },
  },
  {
    axis: 1,
    sign: -1,
    normal: { x: 0, y: -1, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
  },
  {
    axis: 2,
    sign: 1,
    normal: { x: 0, y: 0, z: 1 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 1, z: 0 },
  },
  {
    axis: 2,
    sign: -1,
    normal: { x: 0, y: 0, z: -1 },
    u: { x: -1, y: 0, z: 0 },
    v: { x: 0, y: 1, z: 0 },
  },
];

export interface BuiltPart {
  readonly name: string;
  readonly role: LimbRole;
  /** Pivot in world units. Geometry vertices are relative to it. */
  readonly pivot: THREE.Vector3;
  /** Vertices are pivot-relative and already scaled to world units. */
  readonly geometry: THREE.BufferGeometry;
  readonly faceCount: number;
}

export interface BuiltModel {
  readonly name: string;
  readonly parts: readonly BuiltPart[];
  /** Faces actually emitted. */
  readonly faceCount: number;
  /** Faces dropped as unseeable. Reported so the saving is measured, not claimed. */
  readonly culledFaceCount: number;
  /** Model height in world units, for standing figures on the ground. */
  readonly height: number;
  /** Frees every part geometry. */
  dispose(): void;
}

function boundsOf(box: VoxelBox): Bounds {
  const [cx, cy, cz] = box.pos;
  const [sx, sy, sz] = box.size;
  return [cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2];
}

/** Half-open comparison tolerance; model coordinates are authored as tidy halves. */
const EPSILON = 1e-6;

/**
 * Whether `occluder` completely hides the given face of `box`.
 *
 * The face lies at `plane` along `axis`. The occluder must both straddle that plane
 * on the outward side and cover the face's full extent on the other two axes.
 */
function occludes(box: Bounds, occluder: Bounds, axis: 0 | 1 | 2, sign: 1 | -1): boolean {
  const plane = sign === 1 ? box[axis + 3] : box[axis];

  if (sign === 1) {
    // Must start at or before the face and continue past it.
    if (!(occluder[axis] <= plane + EPSILON && occluder[axis + 3] > plane + EPSILON)) return false;
  } else {
    if (!(occluder[axis + 3] >= plane - EPSILON && occluder[axis] < plane - EPSILON)) return false;
  }

  for (let other = 0 as 0 | 1 | 2; other < 3; other = (other + 1) as 0 | 1 | 2) {
    if (other === axis) continue;
    if (occluder[other] > box[other] + EPSILON) return false;
    if (occluder[other + 3] < box[other + 3] - EPSILON) return false;
  }
  return true;
}

/** Boxes that may hide faces of `part`, given the whole model. */
function occluderSetFor(model: VoxelModel, part: VoxelPart): Bounds[] {
  const result: Bounds[] = [];
  for (const candidate of model.parts) {
    const samePart = candidate === part;
    const bothStatic = part.role === 'static' && candidate.role === 'static';
    if (!samePart && !bothStatic) continue;
    for (const box of candidate.boxes) result.push(boundsOf(box));
  }
  return result;
}

export function buildVoxelModel(model: VoxelModel): BuiltModel {
  const palette = model.palette.map((hex) => new THREE.Color(hex).convertSRGBToLinear());

  const parts: BuiltPart[] = [];
  let faceCount = 0;
  let culledFaceCount = 0;
  let maxY = 0;

  for (const part of model.parts) {
    const occluders = occluderSetFor(model, part);

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let partFaces = 0;

    for (const box of part.boxes) {
      const bounds = boundsOf(box);
      maxY = Math.max(maxY, bounds[4]);
      const colour = palette[box.color];

      for (const face of FACES) {
        // The box's own entry in `occluders` needs no special case: a box never
        // extends beyond its own face, so `occludes` rejects it on the first test.
        const hidden = occluders.some((occluder) =>
          occludes(bounds, occluder, face.axis, face.sign),
        );
        if (hidden) {
          culledFaceCount++;
          continue;
        }

        // Face centre in model space, then shifted so the pivot becomes the origin.
        const cx = box.pos[0] + face.normal.x * (box.size[0] / 2) - part.pivot[0];
        const cy = box.pos[1] + face.normal.y * (box.size[1] / 2) - part.pivot[1];
        const cz = box.pos[2] + face.normal.z * (box.size[2] / 2) - part.pivot[2];

        // Half-extents along the in-plane basis vectors.
        const hu =
          (Math.abs(face.u.x) * box.size[0] +
            Math.abs(face.u.y) * box.size[1] +
            Math.abs(face.u.z) * box.size[2]) /
          2;
        const hv =
          (Math.abs(face.v.x) * box.size[0] +
            Math.abs(face.v.y) * box.size[1] +
            Math.abs(face.v.z) * box.size[2]) /
          2;

        const base = positions.length / 3;
        // Counter-clockwise from the outside: -u-v, +u-v, +u+v, -u+v.
        const corners: readonly [number, number][] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        for (const [su, sv] of corners) {
          positions.push(
            (cx + face.u.x * hu * su + face.v.x * hv * sv) * model.scale,
            (cy + face.u.y * hu * su + face.v.y * hv * sv) * model.scale,
            (cz + face.u.z * hu * su + face.v.z * hv * sv) * model.scale,
          );
          normals.push(face.normal.x, face.normal.y, face.normal.z);
          colors.push(colour.r, colour.g, colour.b);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        partFaces++;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    faceCount += partFaces;
    parts.push({
      name: part.name,
      role: part.role,
      pivot: new THREE.Vector3(
        part.pivot[0] * model.scale,
        part.pivot[1] * model.scale,
        part.pivot[2] * model.scale,
      ),
      geometry,
      faceCount: partFaces,
    });
  }

  return {
    name: model.name,
    parts,
    faceCount,
    culledFaceCount,
    height: maxY * model.scale,
    dispose() {
      for (const part of parts) part.geometry.dispose();
    },
  };
}
