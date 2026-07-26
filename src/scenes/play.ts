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
import { createDirector, stageAt, stepDirector } from '../sim/director';
import {
  censusOf,
  createEnemyIntents,
  despawnDistant,
  ENEMY_CAPACITY,
  EnemyPool,
  stepEnemies,
} from '../sim/enemies';
import { ENEMY_SHOT_CAPACITY, EnemyShotPool, stepEnemyShots } from '../sim/enemy-shots';
import {
  addShake,
  createHitStop,
  createScreenShake,
  requestHitStop,
  stepHitStop,
  stepShake,
} from '../sim/feedback';
import {
  applyCard,
  createLoadout,
  derivedStats,
  effectiveWeapon,
  offerCards,
  passiveDefinition,
} from '../sim/loadout';
import { GEM_CAPACITY, GemPool, stepGems } from '../sim/pickups';
import { createCameraFocus, createPlayer, stepCameraFocus, stepPlayer } from '../sim/player';
import { addExperience, createProgression, levelProgress } from '../sim/progression';
import {
  createCombatReport,
  PROJECTILE_CAPACITY,
  ProjectilePool,
  resetCombatReport,
  resolveHits,
  stepProjectiles,
} from '../sim/projectiles';
import { SpatialGrid } from '../sim/spatial';
import { createVitals, heal, stepVitals } from '../sim/vitals';
import { equip, stepWeapons, weaponStats, type WeaponId, type WeaponStats } from '../sim/weapons';
import { createHud } from '../ui/hud';
import { createSummaryScreen } from '../ui/summary';
import { createLevelUpScreen } from '../ui/level-up';
import { createTouchStickOverlay } from '../ui/touch-stick';
import type { GameScene, SceneFactory } from './types';

/**
 * A run.
 *
 * `?seed=word` fixes the scenery, the spawns and the card offers, so a run replays
 * exactly. `?enemies=N` pins the crowd the director maintains, for measuring the frame
 * budget on real hardware. `?start=SECONDS` begins the clock partway in, which is the
 * only practical way to look at the late roster or a boss without playing to it.
 */

const IDLE_THRESHOLD = 0.05;

/** Grid cell size. Larger than the separation radius, so crowding needs only 3x3 cells. */
const GRID_CELL_SIZE = 2;

/** Enemies arrive on a ring this far out, clear of the widest screen corner. */
const SPAWN_RADIUS = 34;

/** Past this the player has outrun them for good and the slots are better reused. */
const DESPAWN_RADIUS = 52;

/**
 * Ordinary damage numbers allowed per simulation step.
 *
 * Six weapons striking a packed crowd land hundreds of hits a second; drawing a
 * number for each turns the ground around the player into an unreadable smear.
 */
const MAX_NUMBERS_PER_STEP = 3;

const KILL_SHAKE = 0.16;
const CRIT_SHAKE = 0.4;
const HURT_SHAKE = 0.75;

const CRITICAL_CHANCE = 0.12;
const CRITICAL_MULTIPLIER = 2;

/** How long a run lasts before it counts as survived. */
const RUN_SECONDS = 15 * 60;

export const createPlayScene: SceneFactory = (view, params): GameScene => {
  const seedParam = params.get('seed');
  const worldSeed = seedParam === null ? 0x4a4e15 : seedFromString(seedParam);
  // Zero means "whatever the wave table says", which is the ordinary game.
  const targetEnemies = readPositiveInt(params.get('enemies'), 0);
  const startSeconds = Math.min(readPositiveInt(params.get('start'), 0), RUN_SECONDS - 1);

  const world = createWorld(worldSeed);
  for (const object of world.objects) view.scene.add(object);

  const hero = createVoxelRig(getVoxelModel('yeniceri'));
  view.scene.add(hero.root);

  const horde = createHordeView(ENEMY_CAPACITY, GEM_CAPACITY, ENEMY_SHOT_CAPACITY);
  for (const object of horde.objects) view.scene.add(object);

  const shards = createShardField(0x6b5f80);
  view.scene.add(shards.object);

  const projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  const projectileView = createProjectileView(PROJECTILE_CAPACITY);
  for (const object of projectileView.objects) view.scene.add(object);

  const damageNumbers = createDamageNumbers();
  view.scene.add(damageNumbers.object);

  const input = createInput(window, view.renderer.domElement);
  const touchOverlay = createTouchStickOverlay();
  const hud = createHud();
  const levelUp = createLevelUpScreen();
  const summary = createSummaryScreen();

  const player = createPlayer(0, 0);
  const focus = createCameraFocus(0, 0);
  const vitals = createVitals();

  const enemies = new EnemyPool(ENEMY_CAPACITY);
  const enemyShots = new EnemyShotPool(ENEMY_SHOT_CAPACITY);
  const gems = new GemPool(GEM_CAPACITY);
  const grid = new SpatialGrid(GRID_CELL_SIZE, ENEMY_CAPACITY);
  const director = createDirector();
  const intents = createEnemyIntents();

  // Separate streams, so adding a spawn roll cannot shift the card offers and a seed
  // keeps meaning the same run after a balance change to an unrelated system.
  const runRng = createRng(worldSeed);
  const spawnRng = runRng.fork();
  const effectRng = runRng.fork();
  const combatRng = runRng.fork();
  const cardRng = runRng.fork();
  const shardRandom = (): number => effectRng.next();

  // One weapon to start. Handing over all six leaves the card screen nothing to give,
  // and the card screen is the shape of the whole run.
  const loadout = createLoadout('yatagan');
  const equipped = new Map<WeaponId, ReturnType<typeof equip>>([['yatagan', equip('yatagan')]]);
  let stats = derivedStats(loadout);

  const progression = createProgression();
  const shake = createScreenShake();
  const hitStop = createHitStop();
  const combat = createCombatReport();

  let kills = 0;
  let numbersThisStep = 0;
  let elapsed = startSeconds;
  let pendingLevels = 0;
  let outcome: 'running' | 'won' | 'lost' = 'running';
  const census = { elites: 0, bosses: 0, telegraphing: 0 };

  world.update(player.x, player.z);

  /** A weapon's stats as the player currently has them: its level plus every passive. */
  const resolveWeapon = (id: WeaponId): WeaponStats =>
    effectiveWeapon(id, loadout.weapons.get(id) ?? 1, stats);

  // The pool is asked what the corpse was worth rather than assuming one gem: a
  // Gulyabani and an elite are the reason to fight through a wall instead of round it.
  const onKill = (x: number, z: number, value: number): void => {
    gems.spawn(x, z, value);
    shards.burst(x, z, shardRandom);
    kills++;
  };

  const onHit = (x: number, z: number, amount: number, critical: boolean): void => {
    // Criticals always show; ordinary hits get a budget. The flash still confirms
    // every one of them landed, so what is dropped is noise rather than information.
    if (critical) {
      damageNumbers.push(x, z, amount, true);
      return;
    }
    if (numbersThisStep >= MAX_NUMBERS_PER_STEP) return;
    numbersThisStep++;
    damageNumbers.push(x, z, amount, false);
  };

  const rollCritical = (): boolean => combatRng.chance(CRITICAL_CHANCE);

  /**
   * Applies damage that bypasses the contact system.
   *
   * Arrows and slams are aimed and avoidable, so they are not softened by the
   * immunity window that stops a surrounding crowd from deleting the player — being
   * hit by something you could have stepped out of should cost the full amount.
   */
  const applyDirectDamage = (amount: number): number => {
    if (amount <= 0 || vitals.dead) return 0;
    const taken = Math.max(1, amount - Math.max(0, stats.armour));
    vitals.health -= taken;
    vitals.hurtFlash = 1;
    if (vitals.health <= 0) {
      vitals.health = 0;
      vitals.dead = true;
    }
    return taken;
  };

  const presentLevel = (): void => {
    const cards = offerCards(loadout, cardRng, 3);
    levelUp.show(progression.level, cards, (index) => {
      const card = cards[index];
      if (card === undefined) return;

      if (applyCard(loadout, card)) {
        heal(vitals, vitals.maxHealth);
      } else if (card.kind === 'weapon' && !equipped.has(card.id)) {
        equipped.set(card.id, equip(card.id));
      }

      // Recomputed on every choice rather than cached per frame: a passive has to
      // take effect on the next shot, not the next level.
      stats = derivedStats(loadout);
      pendingLevels--;
      levelUp.hide();
      // Several levels can land in one step — a heap of gems — and each is owed its
      // own screen rather than all but the last being lost.
      if (pendingLevels > 0) presentLevel();
    });
  };

  return {
    update(stepSeconds: number): void {
      // The card screen stops the world. Being killed while reading a choice would
      // teach the player not to read it.
      if (levelUp.visible || summary.visible || outcome !== 'running') return;
      if (stepHitStop(hitStop, stepSeconds)) return;

      elapsed += stepSeconds;

      const intent = input.sample();
      stepPlayer(
        player,
        intent.moveX * stats.moveSpeedMultiplier,
        intent.moveZ * stats.moveSpeedMultiplier,
        stepSeconds,
      );
      stepCameraFocus(focus, player, stepSeconds);

      despawnDistant(enemies, player.x, player.z, DESPAWN_RADIUS);
      stepDirector(
        director,
        enemies,
        spawnRng,
        player.x,
        player.z,
        SPAWN_RADIUS,
        elapsed,
        stepSeconds,
        targetEnemies,
      );

      grid.rebuild(enemies.count, enemies.x, enemies.z);
      stepEnemies(enemies, grid, player.x, player.z, stepSeconds, elapsed, intents);

      // Ranged attacks and boss slams are decided by the enemy step and carried out
      // here, so the pool never needs to know what a player or a projectile is.
      for (let i = 0; i < intents.shooterCount; i++) {
        const shooter = intents.shooters[i];
        const type = enemies.typeOf(shooter);
        enemyShots.fire(
          enemies.x[shooter],
          enemies.z[shooter],
          player.x,
          player.z,
          type.shotSpeed,
          type.shotDamage,
        );
      }
      let slamDamage = 0;
      for (let i = 0; i < intents.slammerCount; i++) {
        const boss = intents.slammers[i];
        const type = enemies.typeOf(boss);
        const dx = player.x - enemies.x[boss];
        const dz = player.z - enemies.z[boss];
        if (dx * dx + dz * dz <= type.slamRadius * type.slamRadius) {
          slamDamage += type.slamDamage;
        }
        addShake(shake, 1);
      }

      stepWeapons(
        [...equipped.values()],
        resolveWeapon,
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
      resolveHits(
        projectiles,
        enemies,
        grid,
        {
          base: 0,
          multiplier: 1,
          criticalChance: CRITICAL_CHANCE,
          criticalMultiplier: CRITICAL_MULTIPLIER,
        },
        combat,
        onKill,
        onHit,
        rollCritical,
      );

      const shotDamage = stepEnemyShots(enemyShots, player.x, player.z, 0.55, stepSeconds);
      const hurt =
        stepVitals(
          vitals,
          grid,
          player.x,
          player.z,
          stepSeconds,
          stats.armour,
          stats.regenPerSecond,
        ) + applyDirectDamage(shotDamage + slamDamage);

      if (hurt > 0) addShake(shake, HURT_SHAKE);
      if (combat.kills > 0) addShake(shake, KILL_SHAKE);
      if (combat.criticals > 0) {
        addShake(shake, CRIT_SHAKE);
        requestHitStop(hitStop);
      }
      stepShake(shake, stepSeconds, effectRng);

      const collected = stepGems(
        gems,
        player.x,
        player.z,
        stepSeconds,
        2.2 * stats.magnetMultiplier,
      );
      if (collected > 0) {
        pendingLevels += addExperience(progression, collected);
        if (pendingLevels > 0 && !levelUp.visible) presentLevel();
      }

      hero.play(player.speed > IDLE_THRESHOLD ? 'walk' : 'idle');
      hero.update(stepSeconds);
      horde.advance(stepSeconds);
      shards.advance(stepSeconds);
      damageNumbers.advance(stepSeconds);
      world.update(player.x, player.z);

      if (vitals.dead) outcome = 'lost';
      else if (elapsed >= RUN_SECONDS) outcome = 'won';

      if (outcome !== 'running' && !summary.visible) {
        summary.show(
          {
            survived: outcome === 'won',
            seconds: elapsed,
            level: progression.level,
            kills,
            weapons: [...loadout.weapons.entries()].map(
              ([id, level]) => `${weaponStats(id).name} ${String(level)}`,
            ),
            passives: [...loadout.passives.entries()].map(
              ([id, level]) => `${passiveDefinition(id).name} ${String(level)}`,
            ),
          },
          () => {
            window.location.reload();
          },
        );
      }
    },

    render(alpha: number): void {
      hero.root.position.set(
        THREE.MathUtils.lerp(player.previousX, player.x, alpha),
        0,
        THREE.MathUtils.lerp(player.previousZ, player.z, alpha),
      );
      hero.root.rotation.y =
        player.previousFacing + shortestArc(player.previousFacing, player.facing) * alpha;

      view.cameraTarget.set(
        THREE.MathUtils.lerp(focus.previousX, focus.x, alpha) +
          THREE.MathUtils.lerp(shake.previousOffsetX, shake.offsetX, alpha),
        0,
        THREE.MathUtils.lerp(focus.previousZ, focus.z, alpha) +
          THREE.MathUtils.lerp(shake.previousOffsetZ, shake.offsetZ, alpha),
      );

      horde.render(enemies, gems, enemyShots, alpha);
      projectileView.render(projectiles, alpha);
      shards.render(alpha);
      damageNumbers.render();
      touchOverlay.render(input.touchStick);
      hud.update({
        health: vitals.health,
        maxHealth: vitals.maxHealth,
        level: progression.level,
        experienceFraction: levelProgress(progression),
        secondsElapsed: elapsed,
        hurt: vitals.hurtFlash * 0.9,
      });
      view.render();
    },

    detail(): string {
      const info = view.renderer.info.render;
      censusOf(enemies, census);
      const build = [...loadout.weapons.entries()]
        .map(([id, level]) => `${id}${String(level)}`)
        .join(' ');
      const passives = [...loadout.passives.entries()]
        .map(([id, level]) => `${id}${String(level)}`)
        .join(' ');
      return [
        `hp ${String(Math.ceil(vitals.health))}/${String(vitals.maxHealth)}  lv ${String(progression.level)}  xp ${String(progression.lifetime)}  ${outcome}`,
        `build ${build}`,
        `passives ${passives === '' ? '-' : passives}`,
        `enemies ${String(enemies.count)}/${String(targetEnemies > 0 ? targetEnemies : stageAt(elapsed).target)}  kills ${String(kills)}  shots ${String(projectiles.count)}`,
        `elites ${String(census.elites)}  bosses ${String(census.bosses)}  winding up ${String(census.telegraphing)}  enemy shots ${String(enemyShots.count)}`,
        `draw calls ${String(info.calls)}  tris ${String(info.triangles)}`,
      ].join('\n');
    },

    dispose(): void {
      input.dispose();
      touchOverlay.dispose();
      hud.dispose();
      levelUp.dispose();
      summary.dispose();
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
