import * as THREE from 'three';
import type { BuiltModel, BuiltPart } from './builder';
import { ANIMATION_RATE, poseFor, type AnimationKind, type Pose } from './animator';

/**
 * One voxel figure as ordinary scene objects.
 *
 * This is the path for the handful of figures that matter individually — the player,
 * bosses, menu showcases. Each part is a real `Mesh`, so anything is possible:
 * one-shot attacks, per-part effects, parts detaching on death.
 *
 * The horde does not come through here. Hundreds of enemies use `VoxelArmy`, which
 * trades this flexibility for a fixed set of GPU-driven animations. Both read the
 * same models and the same `poseFor`, so the player and the enemies walk alike.
 */

export interface VoxelRig {
  /** Add this to the scene. Its position is the figure's position on the ground. */
  readonly root: THREE.Group;
  /** Which animation is playing. */
  readonly animation: AnimationKind;
  /**
   * Switches animation.
   *
   * One-shot animations (`attack`, `hit`) restart from the beginning; looping ones
   * keep their phase so that walk → idle → walk does not jerk.
   */
  play(kind: AnimationKind): void;
  /** Advances the animation clock. Call once per simulation step. */
  update(stepSeconds: number): void;
  /** True when a one-shot animation has finished. Always false while looping. */
  get finished(): boolean;
  dispose(): void;
}

interface RiggedPart {
  readonly part: BuiltPart;
  readonly node: THREE.Mesh;
}

const ONE_SHOT: ReadonlySet<AnimationKind> = new Set<AnimationKind>(['attack', 'hit']);

export function createVoxelRig(model: BuiltModel): VoxelRig {
  const root = new THREE.Group();

  // A single shared material: every part carries its colour in vertex attributes, so
  // splitting materials per part would only add draw calls for nothing.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // The body group exists so bob and squash can be applied once to the whole figure
  // rather than smeared across every part's transform.
  const body = new THREE.Group();
  root.add(body);

  const parts: RiggedPart[] = model.parts.map((part) => {
    const node = new THREE.Mesh(part.geometry, material);
    // Geometry is pivot-relative, so placing the node at the pivot puts the boxes
    // back where the author drew them, and local rotation now turns about the pivot.
    node.position.copy(part.pivot);
    body.add(node);
    return { part, node };
  });

  let animation: AnimationKind = 'idle';
  let phase = 0;

  const applyPose = (pose: Pose): void => {
    for (const { part, node } of parts) {
      switch (part.role) {
        case 'armLeft':
          node.rotation.x = pose.armLeft;
          break;
        case 'armRight':
          node.rotation.x = pose.armRight;
          break;
        case 'legLeft':
          node.rotation.x = pose.legLeft;
          break;
        case 'legRight':
          node.rotation.x = pose.legRight;
          break;
        case 'head':
          node.rotation.x = pose.head;
          break;
        case 'static':
          break;
      }
    }
    body.position.y = pose.bobY;
    body.scale.y = pose.squashY;
  };

  applyPose(poseFor(animation, 0));

  return {
    root,

    get animation() {
      return animation;
    },

    get finished() {
      return ONE_SHOT.has(animation) && phase >= 1;
    },

    play(kind: AnimationKind): void {
      if (kind === animation && !ONE_SHOT.has(kind)) return;
      animation = kind;
      if (ONE_SHOT.has(kind)) phase = 0;
      applyPose(poseFor(animation, phase));
    },

    update(stepSeconds: number): void {
      phase += stepSeconds * ANIMATION_RATE[animation];
      if (!ONE_SHOT.has(animation)) {
        // Wrap rather than letting phase grow without bound: after a long session a
        // large float loses the precision that keeps the cycle smooth.
        phase %= 1;
      } else if (phase > 1) {
        phase = 1;
      }
      applyPose(poseFor(animation, phase));
    },

    dispose(): void {
      material.dispose();
      root.removeFromParent();
    },
  };
}
