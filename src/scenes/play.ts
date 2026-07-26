import * as THREE from 'three';
import { createInput } from '../core/input';
import { createRng, seedFromString } from '../core/rng';
import { createShardField } from '../render/fx/shards';
import { getVoxelModel } from '../render/voxel/models';
import { createVoxelRig } from '../render/voxel/rig';
import { createWorld } from '../render/world/ground';
import { createHordeView } from '../render/world/horde';
import {
  despawnDistant,
  ENEMY_CAPACITY,
  EnemyPool,
  KARAKONCOLOS,
  spawnRing,
  stepEnemies,
} from '../sim/enemies';
import { GEM_CAPACITY, GemPool, stepGems } from '../sim/pickups';
import {
  createCameraFocus,
  createPlayer,
  PLAYER_SPEED,
  stepCameraFocus,
  stepPlayer,
} from '../sim/player';
import { SpatialGrid } from '../sim/spatial';
import { createTouchStickOverlay } from '../ui/touch-stick';
import type { GameScene, SceneFactory } from './types';

/**
 * The play view.
 *
 * `?seed=word` fixes the scenery layout and the spawn pattern, so a run replays
 * exactly. `?enemies=N` sets the crowd the spawner maintains, which is how the
 * phase's performance budget gets measured on real hardware.
 */

/** Speed below which the figure is considered to be standing still. */
const IDLE_THRESHOLD = 0.05;

/** Grid cell size. Larger than the separation radius, so crowding needs only 3x3 cells. */
const GRID_CELL_SIZE = 2;

/** Enemies arrive on a ring this far out, clear of the widest screen corner. */
const SPAWN_RADIUS = 34;

/** Past this the player has outrun them for good and the slots are better reused. */
const DESPAWN_RADIUS = 52;

/** Crowd the spawner maintains by default. */
const DEFAULT_TARGET_ENEMIES = 300;

/** Enemies added per second while below target. */
const SPAWN_RATE = 55;

/**
 * Placeholder weapon: a damaging aura around the player.
 *
 * Scaffolding, not design. This phase builds the machinery of dying — releasing the
 * pool slot, dropping the gem, bursting the shards — and none of it can be exercised,
 * measured or even seen without something that kills. Phase 4 replaces this with the
 * real weapon set, at which point it becomes the Kandil rather than a debug tool.
 */
const AURA_RADIUS = 2.6;
const AURA_DAMAGE_PER_SECOND = 26;

export const createPlayScene: SceneFactory = (view, params): GameScene => {
  const seedParam = params.get('seed');
  const worldSeed = seedParam === null ? 0x4a4e15 : seedFromString(seedParam);
  const targetEnemies = readPositiveInt(params.get('enemies'), DEFAULT_TARGET_ENEMIES);

  const world = createWorld(worldSeed);
  for (const object of world.objects) view.scene.add(object);

  const hero = createVoxelRig(getVoxelModel('yeniceri'));
  view.scene.add(hero.root);

  const horde = createHordeView(ENEMY_CAPACITY, GEM_CAPACITY);
  for (const object of horde.objects) view.scene.add(object);

  const shards = createShardField(0x6b5f80);
  view.scene.add(shards.object);

  // Touch is bound to the canvas, not the window, so on-screen buttons stay tappable
  // instead of every tap being swallowed as a steer.
  const input = createInput(window, view.renderer.domElement);
  const touchOverlay = createTouchStickOverlay();

  const player = createPlayer(0, 0);
  const focus = createCameraFocus(0, 0);

  const enemies = new EnemyPool(ENEMY_CAPACITY);
  const gems = new GemPool(GEM_CAPACITY);
  const grid = new SpatialGrid(GRID_CELL_SIZE, ENEMY_CAPACITY);

  // Separate streams: adding a spawn roll must not shift the shard scatter, or two
  // runs of one seed would diverge the moment the spawn table changed.
  const runRng = createRng(worldSeed);
  const spawnRng = runRng.fork();
  const effectRng = runRng.fork();
  const shardRandom = (): number => effectRng.next();

  let spawnCredit = 0;
  let experience = 0;
  let kills = 0;

  world.update(player.x, player.z);

  /**
   * Damages everything inside the aura and retires whatever it finishes off.
   *
   * Iterating without incrementing after a kill is deliberate: the pool swaps the
   * last enemy into the vacated slot, so the same index must be examined again.
   */
  const applyAura = (stepSeconds: number): void => {
    const damage = AURA_DAMAGE_PER_SECOND * stepSeconds;
    const radiusSq = AURA_RADIUS * AURA_RADIUS;

    for (let i = 0; i < enemies.count;) {
      const dx = enemies.x[i] - player.x;
      const dz = enemies.z[i] - player.z;
      if (dx * dx + dz * dz > radiusSq) {
        i++;
        continue;
      }

      enemies.health[i] -= damage;
      if (enemies.health[i] > 0) {
        i++;
        continue;
      }

      gems.spawn(enemies.x[i], enemies.z[i], 1);
      shards.burst(enemies.x[i], enemies.z[i], shardRandom);
      kills++;
      enemies.kill(i);
    }
  };

  return {
    update(stepSeconds: number): void {
      const intent = input.sample();
      stepPlayer(player, intent.moveX, intent.moveZ, stepSeconds);
      stepCameraFocus(focus, player, stepSeconds);

      despawnDistant(enemies, player.x, player.z, DESPAWN_RADIUS);

      // Fractional credit, so a rate finer than one per step does not round down to
      // zero every step and stall the wave entirely.
      spawnCredit += SPAWN_RATE * stepSeconds;
      const room = targetEnemies - enemies.count;
      const wanted = Math.min(Math.floor(spawnCredit), room);
      if (wanted > 0) {
        spawnCredit -= wanted;
        spawnRing(enemies, spawnRng, player.x, player.z, SPAWN_RADIUS, wanted);
      } else if (room <= 0) {
        // Do not bank credit while at capacity, or the moment a gap opens the whole
        // backlog arrives at once.
        spawnCredit = 0;
      }

      grid.rebuild(enemies.count, enemies.x, enemies.z);
      stepEnemies(enemies, grid, player.x, player.z, stepSeconds, KARAKONCOLOS);

      applyAura(stepSeconds);
      experience += stepGems(gems, player.x, player.z, stepSeconds);

      hero.play(player.speed > IDLE_THRESHOLD ? 'walk' : 'idle');
      hero.update(stepSeconds);
      horde.advance(stepSeconds);
      shards.advance(stepSeconds);
      world.update(player.x, player.z);
    },

    render(alpha: number): void {
      hero.root.position.set(
        THREE.MathUtils.lerp(player.previousX, player.x, alpha),
        0,
        THREE.MathUtils.lerp(player.previousZ, player.z, alpha),
      );
      // Interpolating raw angles would spin the figure the long way round whenever a
      // turn crosses the +/-pi seam, so blend the shortest arc instead.
      hero.root.rotation.y =
        player.previousFacing + shortestArc(player.previousFacing, player.facing) * alpha;

      view.cameraTarget.set(
        THREE.MathUtils.lerp(focus.previousX, focus.x, alpha),
        0,
        THREE.MathUtils.lerp(focus.previousZ, focus.z, alpha),
      );

      horde.render(enemies, gems, alpha);
      shards.render(alpha);
      touchOverlay.render(input.touchStick);
      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      return [
        `pos ${player.x.toFixed(1)}, ${player.z.toFixed(1)}  spd ${player.speed.toFixed(1)}/${PLAYER_SPEED.toFixed(1)}`,
        `enemies ${enemies.count}/${targetEnemies}  kills ${kills}`,
        `gems ${gems.count}  xp ${experience}  shards ${shards.count}`,
        `props ${world.propCount}  draw calls ${info.calls}  tris ${info.triangles}`,
      ].join('\n');
    },

    dispose(): void {
      input.dispose();
      touchOverlay.dispose();
      hero.dispose();
      horde.dispose();
      shards.dispose();
      world.dispose();
    },
  };
};

/** Signed shortest angular distance from `from` to `to`, in [-pi, pi). */
function shortestArc(from: number, to: number): number {
  const TAU = Math.PI * 2;
  return ((((to - from + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function readPositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
