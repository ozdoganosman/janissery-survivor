import * as THREE from 'three';

/**
 * Blob shadows.
 *
 * Not real shadows. A shadow map for hundreds of moving figures costs a depth pass
 * over the whole crowd every frame, and the camera is fixed and top-down, so almost
 * none of what that pass computes would ever be seen. A dark ellipse under each figure
 * carries the one thing the player actually needs from a shadow: where the body meets
 * the ground.
 *
 * That is not a cosmetic point. Under this camera a figure and the ground share the
 * screen's vertical axis, so a creature standing at z=10 and one floating above z=6
 * draw at the same height and the crowd reads as a collage. The blob is what tells
 * them apart, and it is the cheapest possible way to say it: one draw call for
 * everything, one matrix per shadow, no lighting involved.
 */

/** How far the shadow spreads relative to the figure's radius. */
const SPREAD = 0.78;

/** How much of the ground a shadow hides. */
const OPACITY = 0.3;

/** Lifted off the ground so it never z-fights the plane it sits on. */
const HEIGHT = 0.02;

export interface ShadowField {
  readonly object: THREE.Object3D;
  /** Clears the frame's shadows. Call before the first `add`. */
  begin(): void;
  /** Queues one shadow. Ignored once the pool is full. */
  add(x: number, z: number, radius: number): void;
  /** Uploads the frame's shadows. Call after the last `add`. */
  end(): void;
  dispose(): void;
}

export function createShadowField(capacity: number): ShadowField {
  // A disc rather than a texture: at this size the polygon count is nothing and a
  // texture would need a fetch per fragment for a shape that is always the same.
  const geometry = new THREE.CircleGeometry(1, 20);
  geometry.rotateX(-Math.PI / 2);

  // A black disc, ordinary alpha, one colour for everything.
  //
  // Two cleverer versions came first and both failed the same way. Per-instance
  // darkness needs the material's own colour to be white so the instance colour
  // survives the multiply — but a white disc over grass is a highlight, not a shadow,
  // and that is exactly what appeared. Switching the blend mode to multiply was meant
  // to fix that and did not: the disc still drew white.
  //
  // So the per-instance darkness goes. It was a nicety, and creatures already differ
  // by the only thing that matters here — a boss's shadow is wider because a boss is
  // wider. Black, alpha-blended, no instance colour: there is nothing left to get
  // wrong, and it costs the same single draw call.
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: OPACITY,
    // Depth *testing* stays on, so a figure standing between the camera and someone
    // else's shadow correctly hides it. Only the write is off, so shadows do not
    // occlude each other where they overlap.
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // Under everything that stands on the ground, over the ground itself.
  mesh.renderOrder = -1;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  let count = 0;

  return {
    object: mesh,

    begin(): void {
      count = 0;
    },

    add(x, z, radius): void {
      if (count >= capacity) return;
      const spread = radius * SPREAD;
      position.set(x, HEIGHT, z);
      scale.set(spread, 1, spread);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(count, matrix);
      count++;
    },

    end(): void {
      mesh.count = count;
      if (count > 0) mesh.instanceMatrix.needsUpdate = true;
    },

    dispose(): void {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
