import * as THREE from 'three';
import { BEHAVIOUR, ENEMY_TYPES } from '../../sim/enemy-types';
import type { EnemyShotPool } from '../../sim/enemy-shots';
import type { EnemyPool } from '../../sim/enemies';
import type { GemPool } from '../../sim/pickups';
import type { ShadowField } from '../fx/shadows';
import { createVoxelArmy } from '../voxel/instanced';
import { getVoxelModel, type ModelId } from '../voxel/models';

/**
 * Draws the horde, its gems, its return fire and its warnings.
 *
 * The only bridge between the simulation's typed arrays and three.js. Keeping it in
 * one place is what lets `src/sim/` stay renderer-free: the simulation publishes plain
 * numbers, and exactly one file knows those numbers become instances.
 *
 * Enemies are bucketed by *model* rather than by kind, so the boss and the ordinary
 * Gulyabani share one army and one draw call — they differ only in scale and tint.
 *
 * Positions are interpolated here rather than in the simulation. At a fixed 60 Hz on a
 * 144 Hz display, drawing raw step positions repeats a frame and then jumps, which
 * reads as a stutter in the crowd even though the simulation is perfectly smooth.
 */

/** Walk cycles per second at an enemy's full speed. */
const WALK_CYCLES_AT_FULL_SPEED = 1.35;

/** How far a struck enemy brightens. Enough to read in a crowd, short of washing out. */
const FLASH_BRIGHTNESS = 3.5;

/**
 * Elites wear gold.
 *
 * The tint multiplies the model's own colours, and the roster's palettes are dark
 * browns and greys — so a gentle multiplier that looked like gold on paper turned a
 * dark brown into a slightly less dark brown, indistinguishable in a crowd of four
 * hundred. It has to be strong enough to survive being applied to #4a4438.
 */
const ELITE_TINT: readonly [number, number, number] = [3, 2.2, 0.75];

/**
 * Bosses burn.
 *
 * The Gulyabani's palette is a set of dark browns, which works at its own size and
 * turns into an unreadable black mass at three times it. The tint is a legibility fix
 * before it is a flourish: it also says at a glance that this one is not the ordinary
 * creature it shares a model with.
 */
const BOSS_TINT: readonly [number, number, number] = [1.95, 1.05, 0.85];

/** Most instances the telegraph can draw. More bosses than this never coexist. */
const MAX_TELEGRAPHS = 16;

export interface HordeView {
  readonly objects: readonly THREE.Object3D[];
  advance(stepSeconds: number): void;
  render(
    enemies: EnemyPool,
    gems: GemPool,
    shots: EnemyShotPool,
    alpha: number,
    shadows: ShadowField | null,
  ): void;
  dispose(): void;
}

export function createHordeView(
  enemyCapacity: number,
  gemCapacity: number,
  shotCapacity: number,
): HordeView {
  // One army per distinct model. Every kind is resolved to its army index once, here,
  // rather than looked up per enemy per frame.
  const modelIds = [...new Set(ENEMY_TYPES.map((type) => type.model))] as ModelId[];
  const armies = modelIds.map((id) =>
    createVoxelArmy(getVoxelModel(id), { capacity: enemyCapacity }),
  );
  const armyOfKind = ENEMY_TYPES.map((type) => modelIds.indexOf(type.model as ModelId));
  const cursors = new Int32Array(armies.length);

  const gemGeometry = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  const gemMaterial = new THREE.MeshLambertMaterial({
    color: 0x6ad6f0,
    emissive: 0x1b6b80,
    emissiveIntensity: 0.9,
  });
  const gemMesh = new THREE.InstancedMesh(gemGeometry, gemMaterial, gemCapacity);
  gemMesh.count = 0;
  gemMesh.frustumCulled = false;

  const shotGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const shotMaterial = new THREE.MeshLambertMaterial({
    color: 0xff6a8a,
    emissive: 0x8a1030,
    emissiveIntensity: 1.1,
  });
  const shotMesh = new THREE.InstancedMesh(shotGeometry, shotMaterial, shotCapacity);
  shotMesh.count = 0;
  shotMesh.frustumCulled = false;

  // The boss's wind-up, drawn on the ground as two parts.
  //
  // The outline sits at the slam's true radius and never moves, because a warning that
  // only reaches its real extent at the last instant is worse than none: it teaches the
  // player that a spot is safe and then hits them there. The disc inside it fills
  // toward that edge, which is the timer — where it will land, and how long is left,
  // read as two separate things.
  const telegraphRing = new THREE.RingGeometry(0.94, 1, 48);
  telegraphRing.rotateX(-Math.PI / 2);
  const telegraphMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5030,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const telegraphMesh = new THREE.InstancedMesh(telegraphRing, telegraphMaterial, MAX_TELEGRAPHS);
  telegraphMesh.count = 0;
  telegraphMesh.frustumCulled = false;
  telegraphMesh.renderOrder = 4;

  const telegraphDisc = new THREE.CircleGeometry(1, 48);
  telegraphDisc.rotateX(-Math.PI / 2);
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0xff5030,
    transparent: true,
    // Additive, so the fill reads as heat gathering rather than as a painted patch —
    // the same reason the pickup aura is additive.
    blending: THREE.AdditiveBlending,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fillMesh = new THREE.InstancedMesh(telegraphDisc, fillMaterial, MAX_TELEGRAPHS);
  fillMesh.count = 0;
  fillMesh.frustumCulled = false;
  fillMesh.renderOrder = 3;

  const objects: THREE.Object3D[] = [
    ...armies.flatMap((army) => [...army.meshes]),
    gemMesh,
    shotMesh,
    fillMesh,
    telegraphMesh,
  ];

  // Reused every frame; a Matrix4 per instance per frame is the allocation pattern
  // the whole simulation was written to avoid.
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(1, 1, 1);
  let elapsed = 0;

  const renderEnemies = (enemies: EnemyPool, alpha: number, shadows: ShadowField | null): void => {
    cursors.fill(0);
    let telegraphs = 0;

    for (let i = 0; i < enemies.count; i++) {
      const kind = enemies.kind[i];
      const armyIndex = armyOfKind[kind] ?? 0;
      const army = armies[armyIndex];
      const slot = cursors[armyIndex];
      if (slot >= army.capacity) continue;
      cursors[armyIndex] = slot + 1;

      const x = enemies.previousX[i] + (enemies.x[i] - enemies.previousX[i]) * alpha;
      const z = enemies.previousZ[i] + (enemies.z[i] - enemies.previousZ[i]) * alpha;

      // Cycles track the speed actually achieved, not the type's nominal one, so a
      // boss sprinting in from off screen strides rather than gliding.
      const type = ENEMY_TYPES[kind];
      const cycles =
        type.speed > 0 ? (enemies.speed[i] / type.speed) * WALK_CYCLES_AT_FULL_SPEED : 0;

      army.setInstance(slot, x, 0, z, enemies.facing[i], cycles, enemies.phase[i]);
      army.setScale(slot, enemies.scale[i]);

      // Added from here rather than from the scene, because this loop already has the
      // interpolated position and the creature's own size in hand.
      if (shadows !== null) {
        shadows.add(x, z, type.radius);
      }

      const lift = 1 + enemies.flash[i] * FLASH_BRIGHTNESS;
      const tint =
        type.behaviour === BEHAVIOUR.boss ? BOSS_TINT : enemies.elite[i] === 1 ? ELITE_TINT : null;
      if (tint === null) {
        army.setTint(slot, lift, lift, lift);
      } else {
        army.setTint(slot, tint[0] * lift, tint[1] * lift, tint[2] * lift);
      }

      if (
        enemies.telegraph[i] > 0 &&
        type.behaviour === BEHAVIOUR.boss &&
        telegraphs < MAX_TELEGRAPHS
      ) {
        position.set(x, 0.08, z);
        quaternion.identity();

        // Fixed at the reach the blow will actually have.
        scale.set(type.slamRadius, 1, type.slamRadius);
        matrix.compose(position, quaternion, scale);
        telegraphMesh.setMatrixAt(telegraphs, matrix);

        // Filling toward it. Lifted a hair less than the outline so they never z-fight.
        const progress = 1 - enemies.telegraph[i] / Math.max(type.slamTelegraph, 1e-3);
        const filled = type.slamRadius * Math.min(Math.max(progress, 0), 1);
        position.set(x, 0.07, z);
        scale.set(filled, 1, filled);
        matrix.compose(position, quaternion, scale);
        fillMesh.setMatrixAt(telegraphs, matrix);

        telegraphs++;
      }
    }

    for (let a = 0; a < armies.length; a++) {
      armies[a].setCount(cursors[a]);
      armies[a].flush();
    }

    telegraphMesh.count = telegraphs;
    fillMesh.count = telegraphs;
    if (telegraphs > 0) {
      telegraphMesh.instanceMatrix.needsUpdate = true;
      fillMesh.instanceMatrix.needsUpdate = true;
    }
  };

  const renderGems = (gems: GemPool, alpha: number): void => {
    const drawn = Math.min(gems.count, gemCapacity);
    gemMesh.count = drawn;
    scale.set(1, 1, 1);
    for (let i = 0; i < drawn; i++) {
      position.set(
        gems.previousX[i] + (gems.x[i] - gems.previousX[i]) * alpha,
        // Bobbing and tilted, so a gem lying on grass still catches the eye.
        0.42 + Math.sin(elapsed * 2.4 + i) * 0.07,
        gems.previousZ[i] + (gems.z[i] - gems.previousZ[i]) * alpha,
      );
      euler.set(0.6, elapsed * 1.6 + i, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      gemMesh.setMatrixAt(i, matrix);
    }
    if (drawn > 0) gemMesh.instanceMatrix.needsUpdate = true;
  };

  const renderShots = (shots: EnemyShotPool, alpha: number): void => {
    const drawn = Math.min(shots.count, shotCapacity);
    shotMesh.count = drawn;
    scale.set(1, 1, 1);
    for (let i = 0; i < drawn; i++) {
      position.set(
        shots.previousX[i] + (shots.x[i] - shots.previousX[i]) * alpha,
        0.9,
        shots.previousZ[i] + (shots.z[i] - shots.previousZ[i]) * alpha,
      );
      euler.set(elapsed * 5, elapsed * 4 + i, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      shotMesh.setMatrixAt(i, matrix);
    }
    if (drawn > 0) shotMesh.instanceMatrix.needsUpdate = true;
  };

  return {
    objects,

    advance(stepSeconds: number): void {
      // Wrapped so the value stays small; a float grown to thousands of seconds loses
      // the precision the sine needs and the bob visibly judders.
      elapsed = (elapsed + stepSeconds) % 3600;
      for (const army of armies) army.advance(stepSeconds);
    },

    render(enemies, gems, shots, alpha, shadows): void {
      renderEnemies(enemies, alpha, shadows);
      renderGems(gems, alpha);
      renderShots(shots, alpha);
    },

    dispose(): void {
      for (const army of armies) army.dispose();
      for (const mesh of [gemMesh, shotMesh, telegraphMesh, fillMesh]) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      gemGeometry.dispose();
      gemMaterial.dispose();
      shotGeometry.dispose();
      shotMaterial.dispose();
      telegraphRing.dispose();
      telegraphMaterial.dispose();
      telegraphDisc.dispose();
      fillMaterial.dispose();
    },
  };
}
