import waveBalance from '../../data/balance/waves.json';
import type { Rng } from '../core/rng';
import { ENEMY_KIND_IDS, enemyTypeIndex, type EnemyKindId } from './enemy-types';
import { FORMATION, spawnFormation, type EnemyPool, type FormationKind } from './enemies';

/**
 * What arrives, and when.
 *
 * The difficulty curve is the run, and it is a table rather than code so that tuning
 * it costs an edit and a reload. Each stage says what the crowd should look like from
 * a given moment onward — how many, which creatures, how they arrive, and how often
 * an elite slips in — and the director interpolates nothing: a stage takes over the
 * instant its time passes, because a curve that eases between stages is much harder
 * to reason about when the eighth minute turns out to be wrong.
 */

export interface WaveStage {
  /** Seconds into the run at which this stage takes over. */
  readonly at: number;
  /** Crowd size the spawner maintains. */
  readonly target: number;
  readonly eliteChance: number;
  readonly formation: FormationKind;
  /** Kind index to relative weight. Normalised at pick time. */
  readonly weights: readonly { readonly kind: number; readonly weight: number }[];
}

export interface BossEntry {
  readonly at: number;
  readonly kind: number;
  readonly healthScale: number;
}

const FORMATION_BY_NAME: Readonly<Record<string, FormationKind>> = {
  ring: FORMATION.ring,
  wall: FORMATION.wall,
  stream: FORMATION.stream,
};

class WaveError extends Error {
  constructor(detail: string) {
    super(`Invalid wave table: ${detail}`);
    this.name = 'WaveError';
  }
}

function parseStages(raw: unknown): WaveStage[] {
  if (!Array.isArray(raw)) throw new WaveError('stages must be an array');

  const stages = raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new WaveError(`stages[${String(index)}] must be an object`);
    }
    const record = entry as Record<string, unknown>;

    const number = (key: string): number => {
      const value = record[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new WaveError(`stages[${String(index)}].${key} must be a non-negative number`);
      }
      return value;
    };

    const formationName = record.formation;
    if (typeof formationName !== 'string' || !(formationName in FORMATION_BY_NAME)) {
      throw new WaveError(
        `stages[${String(index)}].formation must be one of ${Object.keys(FORMATION_BY_NAME).join(', ')}`,
      );
    }

    const rawWeights = record.weights;
    if (typeof rawWeights !== 'object' || rawWeights === null) {
      throw new WaveError(`stages[${String(index)}].weights must be an object`);
    }
    const weights: { kind: number; weight: number }[] = [];
    for (const [name, weight] of Object.entries(rawWeights as Record<string, unknown>)) {
      if (!(ENEMY_KIND_IDS as readonly string[]).includes(name)) {
        throw new WaveError(`stages[${String(index)}].weights has unknown enemy "${name}"`);
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
        throw new WaveError(`stages[${String(index)}].weights.${name} must be positive`);
      }
      weights.push({ kind: enemyTypeIndex(name as EnemyKindId), weight });
    }
    if (weights.length === 0) {
      throw new WaveError(`stages[${String(index)}].weights must name at least one enemy`);
    }

    return {
      at: number('at'),
      target: number('target'),
      eliteChance: number('eliteChance'),
      formation: FORMATION_BY_NAME[formationName],
      weights,
    };
  });

  // Sorted so a table edited out of order still behaves; relying on the author to
  // keep it sorted is how a stage silently never fires.
  return stages.sort((a, b) => a.at - b.at);
}

function parseBosses(raw: unknown): BossEntry[] {
  if (!Array.isArray(raw)) throw new WaveError('bosses must be an array');
  return raw
    .map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new WaveError(`bosses[${String(index)}] must be an object`);
      }
      const record = entry as Record<string, unknown>;
      const at = record.at;
      if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
        throw new WaveError(`bosses[${String(index)}].at must be a non-negative number`);
      }
      const kindName = record.kind;
      if (
        typeof kindName !== 'string' ||
        !(ENEMY_KIND_IDS as readonly string[]).includes(kindName)
      ) {
        throw new WaveError(`bosses[${String(index)}].kind is not a known enemy`);
      }
      const healthScale = record.healthScale;
      return {
        at,
        kind: enemyTypeIndex(kindName as EnemyKindId),
        healthScale:
          typeof healthScale === 'number' && Number.isFinite(healthScale) && healthScale > 0
            ? healthScale
            : 1,
      };
    })
    .sort((a, b) => a.at - b.at);
}

const TABLE = waveBalance as Record<string, unknown>;
export const WAVE_STAGES: readonly WaveStage[] = parseStages(TABLE.stages);
export const BOSS_ENTRIES: readonly BossEntry[] = parseBosses(TABLE.bosses);

/** The stage in force at a given moment. */
export function stageAt(seconds: number): WaveStage {
  let current = WAVE_STAGES[0];
  for (const stage of WAVE_STAGES) {
    if (stage.at > seconds) break;
    current = stage;
  }
  return current;
}

export interface Director {
  /** Bosses already released, so each fires exactly once. */
  readonly bossesReleased: boolean[];
  /** Fractional spawn allowance, so a rate finer than one per step is not lost. */
  credit: number;
  /** Bearing the wall and stream formations arrive from. */
  bearing: number;
}

export function createDirector(): Director {
  return {
    bossesReleased: BOSS_ENTRIES.map(() => false),
    credit: 0,
    bearing: 0,
  };
}

/** Enemies added per second while below the stage's target. */
const SPAWN_RATE = 60;

/** How fast the wall and stream bearings drift, in radians per second. */
const BEARING_DRIFT = 0.35;

/**
 * The crowd size in force: the stage's, an override, or a cap.
 *
 * Three things that were briefly two, with the result that choosing the *lowest*
 * quality tier raised the opening minute from 55 bodies to 140.
 *
 * - The stage table is the game.
 * - A cap only ever removes enemies. It exists to protect a device that cannot draw
 *   the full crowd, so it is a ceiling and never a floor.
 * - An override replaces both. It comes from `?enemies=`, which exists to measure the
 *   frame cost of a chosen number on real hardware — and a measurement quietly capped
 *   to something other than the number asked for is worse than no measurement.
 */
export function effectiveTarget(stage: WaveStage, override = 0, cap = 0): number {
  if (override > 0) return override;
  return cap > 0 ? Math.min(stage.target, cap) : stage.target;
}

/**
 * Runs one step of the timeline: tops the crowd up and releases bosses on schedule.
 *
 * @returns How many ordinary enemies were spawned this step.
 */
export function stepDirector(
  director: Director,
  pool: EnemyPool,
  rng: Rng,
  playerX: number,
  playerZ: number,
  spawnRadius: number,
  elapsed: number,
  stepSeconds: number,
  targetOverride = 0,
  targetCap = 0,
): number {
  for (let i = 0; i < BOSS_ENTRIES.length; i++) {
    const entry = BOSS_ENTRIES[i];
    if (director.bossesReleased[i] || elapsed < entry.at) continue;
    director.bossesReleased[i] = true;
    // Placed a little further out than the crowd, so it is seen coming.
    spawnFormation(
      pool,
      rng,
      playerX,
      playerZ,
      spawnRadius * 1.15,
      1,
      entry.kind,
      0,
      FORMATION.ring,
      0,
      entry.healthScale,
    );
  }

  const stage = stageAt(elapsed);
  director.bearing += BEARING_DRIFT * stepSeconds;

  director.credit += SPAWN_RATE * stepSeconds;
  const room = effectiveTarget(stage, targetOverride, targetCap) - pool.count;
  const wanted = Math.min(Math.floor(director.credit), room);
  if (wanted <= 0) {
    // Do not bank credit while at capacity, or the moment a gap opens the whole
    // backlog arrives at once.
    if (room <= 0) director.credit = 0;
    return 0;
  }
  director.credit -= wanted;

  // One kind per batch rather than per enemy: a wall of mixed creatures reads as
  // noise, while a wall of one reads as a thing that has arrived.
  const kind = pickKind(stage, rng);
  return spawnFormation(
    pool,
    rng,
    playerX,
    playerZ,
    spawnRadius,
    wanted,
    kind,
    stage.eliteChance,
    stage.formation,
    director.bearing,
  );
}

export function pickKind(stage: WaveStage, rng: Rng): number {
  let total = 0;
  for (const entry of stage.weights) total += entry.weight;

  let roll = rng.next() * total;
  for (const entry of stage.weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.kind;
  }
  return stage.weights[stage.weights.length - 1].kind;
}
