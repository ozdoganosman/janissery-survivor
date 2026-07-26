import * as THREE from 'three';
import { createRng } from '../core/rng';
import { createVoxelArmy } from '../render/voxel/instanced';
import { getVoxelModel } from '../render/voxel/models';
import { createVoxelRig } from '../render/voxel/rig';
import type { GameScene, SceneFactory } from './types';

/**
 * The default view.
 *
 * Not yet a game: the player is not controllable and the enemies do not pursue. What
 * this scene is for is showing both rendering paths side by side under the real camera
 * — one rigged figure walking a circle, a ring of instanced figures walking their own
 * — so that any discrepancy between the CPU and GPU walk cycles is obvious rather than
 * discovered later with hundreds of enemies on screen. Phase 2 replaces the circling
 * with input.
 */

const HERO_ORBIT_RADIUS = 5.5;
const HERO_ORBIT_SECONDS = 14;

const ENEMY_COUNT = 14;
const ENEMY_ORBIT_RADIUS = 10.5;
const ENEMY_ORBIT_SECONDS = 34;

export const createPlayScene: SceneFactory = (view): GameScene => {
  const heroModel = getVoxelModel('yeniceri');
  const enemyModel = getVoxelModel('karakoncolos');

  const hero = createVoxelRig(heroModel);
  hero.play('walk');
  view.scene.add(hero.root);

  const enemies = createVoxelArmy(enemyModel, { capacity: ENEMY_COUNT });
  for (const mesh of enemies.meshes) view.scene.add(mesh);
  enemies.setCount(ENEMY_COUNT);

  // Phase offsets from a fixed seed: without them every figure lands the same foot on
  // the same frame and the ring reads as one object rather than as a crowd.
  const rng = createRng(0x4a4e15);
  const enemyPhases = Array.from({ length: ENEMY_COUNT }, () => rng.next());

  let heroAngle = 0;
  let previousHeroAngle = 0;
  let enemyAngle = 0;
  let previousEnemyAngle = 0;

  const heroPosition = new THREE.Vector3();

  const placeEnemies = (baseAngle: number): void => {
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const spread = (i / ENEMY_COUNT) * Math.PI * 2;
      const angle = baseAngle + spread;
      const x = Math.sin(angle) * ENEMY_ORBIT_RADIUS;
      const z = Math.cos(angle) * ENEMY_ORBIT_RADIUS;
      // Facing is the tangent of the circle, which is the heading a walker would have.
      enemies.setInstance(i, x, 0, z, angle + Math.PI / 2, 1.1, enemyPhases[i]);
    }
    enemies.flush();
  };

  return {
    update(stepSeconds: number): void {
      previousHeroAngle = heroAngle;
      previousEnemyAngle = enemyAngle;
      heroAngle += (Math.PI * 2 * stepSeconds) / HERO_ORBIT_SECONDS;
      enemyAngle += (Math.PI * 2 * stepSeconds) / ENEMY_ORBIT_SECONDS;
      hero.update(stepSeconds);
      enemies.advance(stepSeconds);
    },

    render(alpha: number): void {
      const angle = THREE.MathUtils.lerp(previousHeroAngle, heroAngle, alpha);
      heroPosition.set(Math.sin(angle) * HERO_ORBIT_RADIUS, 0, Math.cos(angle) * HERO_ORBIT_RADIUS);
      hero.root.position.copy(heroPosition);
      hero.root.rotation.y = angle + Math.PI / 2;

      placeEnemies(THREE.MathUtils.lerp(previousEnemyAngle, enemyAngle, alpha));

      // Keep the hero framed without pinning the camera to it; a little lag reads as
      // weight and stops the world sliding under a motionless character.
      view.cameraTarget.lerp(heroPosition, 0.06);
      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      return `draw calls ${info.calls}  tris ${info.triangles}\nhero ${hero.animation}  enemies ${enemies.count}`;
    },

    dispose(): void {
      hero.dispose();
      enemies.dispose();
    },
  };
};
