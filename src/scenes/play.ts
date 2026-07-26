import * as THREE from 'three';
import { createInput } from '../core/input';
import { seedFromString } from '../core/rng';
import { getVoxelModel } from '../render/voxel/models';
import { createVoxelRig } from '../render/voxel/rig';
import { createWorld } from '../render/world/ground';
import {
  createCameraFocus,
  createPlayer,
  stepCameraFocus,
  stepPlayer,
  PLAYER_SPEED,
} from '../sim/player';
import type { GameScene, SceneFactory } from './types';

/**
 * The play view.
 *
 * Movement, camera and world only — there are no enemies and nothing can hurt the
 * player yet. That is the point of this phase: whether walking around is pleasant is
 * a question best answered before anything is chasing you, because if the movement is
 * wrong no amount of combat rescues it.
 *
 * `?seed=word` picks the scenery layout, and the same word always gives the same
 * ruins.
 */

/** Speed below which the figure is considered to be standing still. */
const IDLE_THRESHOLD = 0.05;

export const createPlayScene: SceneFactory = (view, params): GameScene => {
  const seedParam = params.get('seed');
  const worldSeed = seedParam === null ? 0x4a4e15 : seedFromString(seedParam);

  const world = createWorld(worldSeed);
  for (const object of world.objects) view.scene.add(object);

  const hero = createVoxelRig(getVoxelModel('yeniceri'));
  view.scene.add(hero.root);

  const input = createInput();
  const player = createPlayer(0, 0);
  const focus = createCameraFocus(0, 0);

  world.update(player.x, player.z);

  return {
    update(stepSeconds: number): void {
      const intent = input.sample();
      stepPlayer(player, intent.moveX, intent.moveZ, stepSeconds);
      stepCameraFocus(focus, player, stepSeconds);

      // The animation follows measured speed rather than the key being held, so a
      // player pushed or slowed later still animates truthfully.
      hero.play(player.speed > IDLE_THRESHOLD ? 'walk' : 'idle');
      hero.update(stepSeconds);

      world.update(player.x, player.z);
    },

    render(alpha: number): void {
      hero.root.position.set(
        THREE.MathUtils.lerp(player.previousX, player.x, alpha),
        0,
        THREE.MathUtils.lerp(player.previousZ, player.z, alpha),
      );
      // Interpolating the raw angles would spin the figure the long way round
      // whenever a turn crosses the +/-pi seam, so blend the shortest arc instead.
      hero.root.rotation.y =
        player.previousFacing + shortestArc(player.previousFacing, player.facing) * alpha;

      view.cameraTarget.set(
        THREE.MathUtils.lerp(focus.previousX, focus.x, alpha),
        0,
        THREE.MathUtils.lerp(focus.previousZ, focus.z, alpha),
      );

      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      return [
        `pos ${player.x.toFixed(1)}, ${player.z.toFixed(1)}`,
        `speed ${player.speed.toFixed(2)} / ${PLAYER_SPEED.toFixed(1)}  ${hero.animation}`,
        `props ${world.propCount}  draw calls ${info.calls}`,
        `tris ${info.triangles}  seed ${worldSeed}`,
      ].join('\n');
    },

    dispose(): void {
      input.dispose();
      hero.dispose();
      world.dispose();
    },
  };
};

/** Signed shortest angular distance from `from` to `to`, in [-pi, pi). */
function shortestArc(from: number, to: number): number {
  const TAU = Math.PI * 2;
  return ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}
