import enemyBalance from '../../data/balance/enemies.json';

/**
 * The bestiary.
 *
 * Five creatures plus a boss, all in one table, because the difference between them
 * is meant to be numbers and a behaviour name — not code. Adding a sixth enemy should
 * be an entry here and, at most, a movement case; anything more and the roster stops
 * being something that can be tuned.
 */

export const ENEMY_KIND_IDS = [
  'karakoncolos',
  'cin',
  'gulyabani',
  'sahmeran',
  'alkarisi',
  'gulyabaniAgasi',
] as const;

export type EnemyKindId = (typeof ENEMY_KIND_IDS)[number];

/** How a creature moves. Each maps to one case in the enemy step. */
export const BEHAVIOUR = {
  /** Straight at the player. The crowd filler. */
  chase: 0,
  /** Weaves side to side while closing. Hard to intercept, easy to outrun. */
  zigzag: 1,
  /** A wider, faster weave. Fast enough that weaving is the only counterplay. */
  serpentine: 2,
  /** Closes to a distance, holds it, and shoots. Punishes standing still. */
  ranged: 3,
  /** Slow, enormous, and telegraphs a slam. */
  boss: 4,
} as const;

export type BehaviourKind = (typeof BEHAVIOUR)[keyof typeof BEHAVIOUR];

export interface EnemyType {
  readonly id: EnemyKindId;
  readonly name: string;
  readonly model: string;
  readonly behaviour: BehaviourKind;
  readonly speed: number;
  readonly health: number;
  readonly radius: number;
  readonly scale: number;
  readonly experience: number;
  readonly contactDamage: number;

  /** Lateral weave, for `zigzag` and `serpentine`. */
  readonly waveAmplitude: number;
  readonly waveFrequency: number;

  /** For `ranged`. */
  readonly keepDistance: number;
  readonly shotCooldown: number;
  readonly shotSpeed: number;
  readonly shotDamage: number;

  /** For `boss`. */
  readonly slamCooldown: number;
  readonly slamTelegraph: number;
  readonly slamRadius: number;
  readonly slamDamage: number;
  /**
   * Top speed while closing from off screen. Zero disables the ramp.
   *
   * A boss is slow so that its slam can be walked out of — but the player is more than
   * three times faster, so a boss that only ever moved at its fighting pace could be
   * ignored for the whole run by walking away from it once. The ramp separates the two
   * jobs: fast enough to arrive, slow enough to fight.
   */
  readonly pursuitSpeed: number;
}

const BEHAVIOUR_BY_NAME: Readonly<Record<string, BehaviourKind>> = {
  chase: BEHAVIOUR.chase,
  zigzag: BEHAVIOUR.zigzag,
  serpentine: BEHAVIOUR.serpentine,
  ranged: BEHAVIOUR.ranged,
  boss: BEHAVIOUR.boss,
};

class EnemyTypeError extends Error {
  constructor(id: string, detail: string) {
    super(`Invalid enemy "${id}": ${detail}`);
    this.name = 'EnemyTypeError';
  }
}

/**
 * Validates one entry.
 *
 * The table is hand-edited during tuning, and a mistyped speed would otherwise show up
 * as a creature that stands still or teleports — a symptom that says nothing about
 * where the mistake was.
 */
export function parseEnemyType(id: string, raw: unknown): EnemyType {
  if (typeof raw !== 'object' || raw === null) throw new EnemyTypeError(id, 'expected an object');
  const record = raw as Record<string, unknown>;

  const name = record.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new EnemyTypeError(id, 'name must be a non-empty string');
  }
  const model = record.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new EnemyTypeError(id, 'model must be a non-empty string');
  }
  const behaviourName = record.behaviour;
  if (typeof behaviourName !== 'string' || !(behaviourName in BEHAVIOUR_BY_NAME)) {
    throw new EnemyTypeError(
      id,
      `behaviour must be one of ${Object.keys(BEHAVIOUR_BY_NAME).join(', ')}`,
    );
  }

  const required = (key: string): number => {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new EnemyTypeError(id, `${key} must be a positive finite number`);
    }
    return value;
  };
  const optional = (key: string, fallback: number): number => {
    const value = record[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EnemyTypeError(id, `${key} must be a finite number`);
    }
    return value;
  };

  return {
    id: id as EnemyKindId,
    name,
    model,
    behaviour: BEHAVIOUR_BY_NAME[behaviourName],
    speed: required('speed'),
    health: required('health'),
    radius: required('radius'),
    scale: required('scale'),
    experience: required('experience'),
    contactDamage: required('contactDamage'),
    waveAmplitude: optional('waveAmplitude', 0),
    waveFrequency: optional('waveFrequency', 0),
    keepDistance: optional('keepDistance', 0),
    shotCooldown: optional('shotCooldown', 0),
    shotSpeed: optional('shotSpeed', 0),
    shotDamage: optional('shotDamage', 0),
    slamCooldown: optional('slamCooldown', 0),
    slamTelegraph: optional('slamTelegraph', 0),
    slamRadius: optional('slamRadius', 0),
    slamDamage: optional('slamDamage', 0),
    pursuitSpeed: optional('pursuitSpeed', 0),
  };
}

/**
 * Indexed by the numeric kind stored in the pool.
 *
 * The pool holds a `Uint8Array` of kinds rather than strings, so lookups have to be
 * by index; the array order is the contract between the table and the typed array.
 */
export const ENEMY_TYPES: readonly EnemyType[] = ENEMY_KIND_IDS.map((id) =>
  parseEnemyType(id, (enemyBalance as Record<string, unknown>)[id]),
);

export function enemyTypeIndex(id: EnemyKindId): number {
  return ENEMY_KIND_IDS.indexOf(id);
}

export function enemyType(id: EnemyKindId): EnemyType {
  return ENEMY_TYPES[enemyTypeIndex(id)];
}

/** Health and size multiplier for an elite. Colour is applied by the renderer. */
export const ELITE_HEALTH_MULTIPLIER = 4.5;
export const ELITE_SCALE_MULTIPLIER = 1.3;
export const ELITE_EXPERIENCE_MULTIPLIER = 5;
