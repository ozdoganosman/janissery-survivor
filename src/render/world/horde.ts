import * as THREE from 'three';
import type { EnemyPool } from '../../sim/enemies';
import type { GemPool } from '../../sim/pickups';
import { createVoxelArmy, type VoxelArmy } from '../voxel/instanced';
import { getVoxelModel } from '../voxel/models';

/**
 * Draws the enemy pool and the gems it leaves behind.
 *
 * The only bridge between the simulation's typed arrays and three.js. Keeping it in
 * one small file is what lets `src/sim/` stay renderer-free: the simulation publishes
 * plain numbers, and exactly one place knows those numbers become instances.
 *
 * Positions are interpolated here rather than in the simulation. The simulation runs
 * at a fixed 60 Hz; on a 144 Hz display, drawing the raw step positions shows the same
 * frame two or three times and then jumps, which reads as a stutter in the crowd even
 * though the simulation is perfectly smooth.
 */

/** Walk cycles per second at the enemy's full speed. */
const WALK_CYCLES_AT_FULL_SPEED = 1.35;

/** How far a struck enemy brightens. Enough to read in a crowd, short of washing out. */
const FLASH_BRIGHTNESS = 3.5;

export interface HordeView {
  readonly objects: readonly THREE.Object3D[];
  /**
   * Advances the clock behind gem bob and spin.
   *
   * Driven from the fixed simulation step rather than from frame time, so gems do not
   * spin faster on a faster machine.
   */
  advance(stepSeconds: number): void;
  /** Writes the current enemy and gem state, blending steps by `alpha`. */
  render(enemies: EnemyPool, gems: GemPool, alpha: number): void;
  dispose(): void;
}

export function createHordeView(enemyCapacity: number, gemCapacity: number): HordeView {
  const army = createVoxelArmy(getVoxelModel('karakoncolos'), { capacity: enemyCapacity });

  // Gems are a single small box, so they get a plain InstancedMesh rather than the
  // voxel army: there are no limbs to animate and nothing to gain from the machinery.
  const gemGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  const gemMaterial = new THREE.MeshLambertMaterial({
    color: 0x6ad6f0,
    emissive: 0x1b6b80,
    emissiveIntensity: 0.9,
  });
  const gemMesh = new THREE.InstancedMesh(gemGeometry, gemMaterial, gemCapacity);
  gemMesh.count = 0;
  // The shader-free path still relies on instanceMatrix, and instances are scattered
  // far from the mesh origin, so culling against the base geometry's bounds would
  // make the whole field of gems vanish.
  gemMesh.frustumCulled = false;

  const objects: THREE.Object3D[] = [...army.meshes, gemMesh];

  // Reused every frame. Allocating a Matrix4 per gem per frame is precisely the
  // pattern the performance budget forbids.
  const scratch = new THREE.Matrix4();
  const gemSpin = new THREE.Euler();
  const gemPosition = new THREE.Vector3();
  const gemScale = new THREE.Vector3(1, 1, 1);
  const gemQuaternion = new THREE.Quaternion();
  let elapsed = 0;

  const renderEnemies = (enemies: EnemyPool, alpha: number, armyRef: VoxelArmy): void => {
    const { x, z, previousX, previousZ, facing, phase, speed, flash, count } = enemies;
    armyRef.setCount(Math.min(count, armyRef.capacity));
    const drawn = Math.min(count, armyRef.capacity);
    for (let i = 0; i < drawn; i++) {
      armyRef.setInstance(
        i,
        previousX[i] + (x[i] - previousX[i]) * alpha,
        0,
        previousZ[i] + (z[i] - previousZ[i]) * alpha,
        facing[i],
        speed[i] > 0 ? WALK_CYCLES_AT_FULL_SPEED : 0,
        phase[i],
      );
      // The tint multiplies the model's own colours, so a struck enemy blanches
      // toward white without losing its silhouette.
      const lift = 1 + flash[i] * FLASH_BRIGHTNESS;
      armyRef.setTint(i, lift, lift, lift);
    }
    armyRef.flush();
  };

  const renderGems = (gems: GemPool, alpha: number): void => {
    const drawn = Math.min(gems.count, gemCapacity);
    gemMesh.count = drawn;
    for (let i = 0; i < drawn; i++) {
      gemPosition.set(
        gems.previousX[i] + (gems.x[i] - gems.previousX[i]) * alpha,
        // Bobbing and tilted, so a gem lying on grass still catches the eye.
        0.42 + Math.sin(elapsed * 2.4 + i) * 0.07,
        gems.previousZ[i] + (gems.z[i] - gems.previousZ[i]) * alpha,
      );
      gemSpin.set(0.6, elapsed * 1.6 + i, 0);
      gemQuaternion.setFromEuler(gemSpin);
      scratch.compose(gemPosition, gemQuaternion, gemScale);
      gemMesh.setMatrixAt(i, scratch);
    }
    if (drawn > 0) gemMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    objects,

    advance(stepSeconds: number): void {
      // Wrapped so the value stays small; a float grown to thousands of seconds
      // loses the precision the sine needs and the bob visibly judders.
      elapsed = (elapsed + stepSeconds) % 3600;
      army.advance(stepSeconds);
    },

    render(enemies, gems, alpha): void {
      renderEnemies(enemies, alpha, army);
      renderGems(gems, alpha);
    },

    dispose(): void {
      army.dispose();
      gemMesh.removeFromParent();
      gemMesh.dispose();
      gemGeometry.dispose();
      gemMaterial.dispose();
    },
  };
}
