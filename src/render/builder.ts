import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { miniMaterial, setInkClass } from './materials';

/** Box with its base on y = 0. */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}

/** Cylinder with its base on y = 0. */
export function cylinder(rTop: number, rBottom: number, h: number, segments = 14): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments);
  g.translate(0, h / 2, 0);
  return g;
}

export function cone(r: number, h: number, segments = 14): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, segments);
  g.translate(0, h / 2, 0);
  return g;
}

/** Hemisphere sitting on y = 0. */
export function dome(r: number, segments = 18): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, segments, Math.max(5, segments / 2), 0, Math.PI * 2, 0, Math.PI / 2);
}

/** Outline of a pointed (two-centred) arch, the shape of every Seljuk door and niche. */
export function archShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const spring = h - w * 0.72;
  s.moveTo(-hw, 0);
  s.lineTo(-hw, spring);
  s.quadraticCurveTo(-hw, spring + w * 0.5, 0, h);
  s.quadraticCurveTo(hw, spring + w * 0.5, hw, spring);
  s.lineTo(hw, 0);
  s.lineTo(-hw, 0);
  return s;
}

/** A thin arch-shaped plate facing +z: niches, doors and windows drawn onto façades. */
export function arch(w: number, h: number, depth = 0.03): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(archShape(w, h), { depth, bevelEnabled: false, curveSegments: 8 });
}

/**
 * Collects many small parts and emits one merged mesh per colour.
 *
 * Buildings are made of dozens of boxes and domes; merging them keeps the draw call count
 * in the tens rather than the thousands, which matters twice over here because the
 * miniature pipeline draws the whole scene twice per frame.
 */
export class PartBatch {
  private readonly byColor = new Map<string, THREE.BufferGeometry[]>();

  /** A frame to place parts in, positioned and turned about the vertical axis. */
  frame(x: number, y: number, z: number, rotY = 0): Frame {
    return new Frame(
      this,
      new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
        new THREE.Vector3(1, 1, 1),
      ),
    );
  }

  add(geom: THREE.BufferGeometry, color: string, matrix: THREE.Matrix4): void {
    const g = geom.index !== null ? geom.toNonIndexed() : geom.clone();
    geom.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    g.applyMatrix4(matrix);
    const list = this.byColor.get(color) ?? [];
    list.push(g);
    this.byColor.set(color, list);
  }

  /** Builds the merged meshes into `parent`. */
  build(parent: THREE.Object3D, inkClass: number): void {
    for (const [color, list] of this.byColor) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (merged === null) continue;
      const mesh = new THREE.Mesh(merged, miniMaterial({ color }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      setInkClass(mesh, inkClass);
      parent.add(mesh);
    }
    this.byColor.clear();
  }
}

export class Frame {
  constructor(
    private readonly batch: PartBatch,
    readonly matrix: THREE.Matrix4,
  ) {}

  /** Places a part at a local position and turn within this frame. */
  part(geom: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rotY = 0): this {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    this.batch.add(geom, color, new THREE.Matrix4().multiplyMatrices(this.matrix, local));
    return this;
  }

  /** A child frame, offset and turned relative to this one. */
  sub(x: number, y: number, z: number, rotY = 0): Frame {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(1, 1, 1),
    );
    return new Frame(this.batch, new THREE.Matrix4().multiplyMatrices(this.matrix, local));
  }
}
