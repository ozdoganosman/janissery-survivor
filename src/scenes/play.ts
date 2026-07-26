import * as THREE from 'three';
import { createInput } from '../core/input';
import { createRng, seedFromString } from '../core/rng';
import { createDamageNumbers } from '../render/fx/damage-numbers';
import { createProjectileView } from '../render/fx/projectiles-view';
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
import {
  addShake,
  createHitStop,
  createScreenShake,
  requestHitStop,
  stepHitStop,
  stepShake,
} from '../sim/feedback';
import { GEM_CAPACITY, GemPool, stepGems } from '../sim/pickups';
import {
  createCombatReport,
  PROJECTILE_CAPACITY,
  ProjectilePool,
  resetCombatReport,
  resolveHits,
  stepProjectiles,
} from '../sim/projectiles';
import { equip, stepWeapons, WEAPON_IDS, weaponStats, type WeaponId } from '../sim/weapons';
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

/** The player's attack profile. Passives and weapon levels will feed this in phase 5. */
const ATTACK = {
  base: 0,
  multiplier: 1,
  criticalChance: 0.12,
  criticalMultiplier: 2,
};

/**
 * Ordinary damage numbers allowed per simulation step.
 *
 * At sixty steps a second this is still far more than the eye can follow, which is
 * the point: it caps the worst case without thinning the feedback in normal play.
 */
const MAX_NUMBERS_PER_STEP = 3;

/** Shake added by one kill, and by one critical. Kept small; they stack by maximum. */
const KILL_SHAKE = 0.16;
const CRIT_SHAKE = 0.4;

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

  const projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  const projectileView = createProjectileView(PROJECTILE_CAPACITY);
  for (const object of projectileView.objects) view.scene.add(object);

  const damageNumbers = createDamageNumbers();
  view.scene.add(damageNumbers.object);

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

  // `?weapons=yatagan,tirkes` isolates a subset. The phase's exit criterion asks
  // whether each weapon holds up alone, and that cannot be judged with five others
  // clearing the screen first.
  const weaponParam = params.get('weapons');
  const carried: WeaponId[] =
    weaponParam === null
      ? [...WEAPON_IDS]
      : weaponParam
          .split(',')
          .map((name) => name.trim())
          .filter((name): name is WeaponId => (WEAPON_IDS as readonly string[]).includes(name));
  const weapons = (carried.length > 0 ? carried : [...WEAPON_IDS]).map(equip);

  const shake = createScreenShake();
  const hitStop = createHitStop();
  const combat = createCombatReport();
  const combatRng = runRng.fork();

  let spawnCredit = 0;
  let experience = 0;
  let kills = 0;
  let numbersThisStep = 0;

  world.update(player.x, player.z);

  /** Everything that happens when a weapon finishes an enemy off. */
  const onKill = (x: number, z: number): void => {
    gems.spawn(x, z, 1);
    shards.burst(x, z, shardRandom);
    kills++;
  };

  /**
   * Shows a number for a hit — but not for every hit.
   *
   * Six weapons striking a packed crowd land hundreds of hits a second. Drawing a
   * number for each turns the area around the player into an unreadable smear of
   * digits, which conveys strictly less than showing a handful would. Criticals
   * always appear, because they are the thing worth noticing; ordinary hits get a
   * budget per step and the rest are silently dropped. The flash still confirms
   * every one of them landed.
   */
  const onHit = (x: number, z: number, amount: number, critical: boolean): void => {
    if (critical) {
      damageNumbers.push(x, z, amount, true);
      return;
    }
    if (numbersThisStep >= MAX_NUMBERS_PER_STEP) return;
    numbersThisStep++;
    damageNumbers.push(x, z, amount, false);
  };

  // Passed as a function so the damage pipeline decides whether a hit *can* crit
  // while the run's own seeded stream decides the roll, keeping replays identical.
  const rollCritical = (): boolean => combatRng.chance(ATTACK.criticalChance);

  return {
    update(stepSeconds: number): void {
      // Hit-stop freezes the world without touching the step length: shortening steps
      // is exactly what the fixed timestep exists to prevent. Rendering continues, so
      // the freeze reads as impact rather than as a dropped frame.
      if (stepHitStop(hitStop, stepSeconds)) return;

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

      stepWeapons(
        weapons,
        projectiles,
        enemies,
        player.x,
        player.z,
        player.facing,
        stepSeconds,
        combatRng,
      );
      stepProjectiles(projectiles, player.x, player.z, stepSeconds);

      resetCombatReport(combat);
      numbersThisStep = 0;
      // The grid was built before the enemies moved, but they move at most 0.04 units
      // in a step — far less than the smallest hit radius — so rebuilding a second
      // time would cost more than the accuracy is worth.
      resolveHits(projectiles, enemies, grid, ATTACK, combat, onKill, onHit, rollCritical);

      if (combat.kills > 0) addShake(shake, KILL_SHAKE);
      if (combat.criticals > 0) {
        addShake(shake, CRIT_SHAKE);
        requestHitStop(hitStop);
      }
      stepShake(shake, stepSeconds, effectRng);

      experience += stepGems(gems, player.x, player.z, stepSeconds);

      hero.play(player.speed > IDLE_THRESHOLD ? 'walk' : 'idle');
      hero.update(stepSeconds);
      horde.advance(stepSeconds);
      shards.advance(stepSeconds);
      damageNumbers.advance(stepSeconds);
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
        THREE.MathUtils.lerp(focus.previousX, focus.x, alpha) +
          THREE.MathUtils.lerp(shake.previousOffsetX, shake.offsetX, alpha),
        0,
        THREE.MathUtils.lerp(focus.previousZ, focus.z, alpha) +
          THREE.MathUtils.lerp(shake.previousOffsetZ, shake.offsetZ, alpha),
      );

      horde.render(enemies, gems, alpha);
      projectileView.render(projectiles, alpha);
      shards.render(alpha);
      damageNumbers.render();
      touchOverlay.render(input.touchStick);
      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      return [
        `pos ${player.x.toFixed(1)}, ${player.z.toFixed(1)}  spd ${player.speed.toFixed(1)}/${PLAYER_SPEED.toFixed(1)}`,
        `enemies ${enemies.count}/${targetEnemies}  kills ${kills}`,
        `weapons ${weapons.map((w) => weaponStats(w.id).name).join(' ')}`,
        `shots ${projectiles.count}  dmg/s ${Math.round(combat.damageDealt * 60)}  gems ${gems.count}  xp ${experience}`,
        `props ${world.propCount}  draw calls ${info.calls}  tris ${info.triangles}`,
      ].join('\n');
    },

    dispose(): void {
      input.dispose();
      touchOverlay.dispose();
      hero.dispose();
      horde.dispose();
      projectileView.dispose();
      damageNumbers.dispose();
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
