import passiveBalance from '../../data/balance/passives.json';
import type { Rng } from '../core/rng';
import { WEAPON_IDS, weaponStats, type WeaponId } from './weapons';

/**
 * What the player is carrying, and what it adds up to.
 *
 * The run's whole identity lives here. A build is nothing but a set of levels, and
 * every number the weapons and the damage pipeline use is derived from them in one
 * place — so "why is this build strong" has one answer to read rather than six
 * systems to cross-reference.
 */

/** Ceiling on weapon level. Eight steps is enough to feel a weapon transform. */
export const MAX_WEAPON_LEVEL = 8;

/**
 * Carry limits.
 *
 * Six of each, as in the genre's convention, and the reason is not tradition: an
 * unbounded loadout means every run converges on the same maximal set, and the choice
 * the card screen exists to offer stops being a choice.
 */
export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

export type PassiveId = keyof typeof passiveBalance;

export interface PassiveDefinition {
  readonly name: string;
  readonly describe: string;
  readonly stat: keyof DerivedStats;
  readonly perLevel: number;
  readonly maxLevel: number;
}

export const PASSIVE_IDS = Object.keys(passiveBalance) as PassiveId[];

const PASSIVES = passiveBalance as Record<PassiveId, PassiveDefinition>;

export function passiveDefinition(id: PassiveId): PassiveDefinition {
  return PASSIVES[id];
}

/** Everything the passives modify. Multipliers start at 1, bonuses at 0. */
export interface DerivedStats {
  damageMultiplier: number;
  cooldownMultiplier: number;
  areaMultiplier: number;
  amountBonus: number;
  moveSpeedMultiplier: number;
  magnetMultiplier: number;
  armour: number;
  regenPerSecond: number;
}

export interface Loadout {
  /** Weapon id to level, 1..MAX_WEAPON_LEVEL. Absent means not carried. */
  readonly weapons: Map<WeaponId, number>;
  readonly passives: Map<PassiveId, number>;
}

export function createLoadout(starting: WeaponId = 'yatagan'): Loadout {
  return { weapons: new Map([[starting, 1]]), passives: new Map() };
}

export function derivedStats(loadout: Loadout): DerivedStats {
  const stats: DerivedStats = {
    damageMultiplier: 1,
    cooldownMultiplier: 1,
    areaMultiplier: 1,
    amountBonus: 0,
    moveSpeedMultiplier: 1,
    magnetMultiplier: 1,
    armour: 0,
    regenPerSecond: 0,
  };

  for (const [id, level] of loadout.passives) {
    const definition = PASSIVES[id];
    stats[definition.stat] += definition.perLevel * level;
  }

  // A cooldown multiplier at or below zero would fire every weapon every step, so the
  // floor is a correctness guard rather than a balance decision.
  stats.cooldownMultiplier = Math.max(0.25, stats.cooldownMultiplier);
  stats.moveSpeedMultiplier = Math.max(0.1, stats.moveSpeedMultiplier);
  stats.areaMultiplier = Math.max(0.1, stats.areaMultiplier);
  return stats;
}

/** A weapon's stats at a given level, with the player's passives folded in. */
export function effectiveWeapon(id: WeaponId, level: number, stats: DerivedStats) {
  const base = weaponStats(id);
  let { cooldown, damage, area, speed, amount, pierce, duration } = base;

  // Level deltas are additive and applied in order, so the table reads as a list of
  // what each level grants rather than a chain of compounding factors.
  const clampedLevel = Math.max(1, Math.min(MAX_WEAPON_LEVEL, level));
  for (let step = 0; step < clampedLevel - 1; step++) {
    const delta = base.levels[step];
    if (delta === undefined) break;
    cooldown += delta.cooldown ?? 0;
    damage += delta.damage ?? 0;
    area += delta.area ?? 0;
    speed += delta.speed ?? 0;
    amount += delta.amount ?? 0;
    pierce += delta.pierce ?? 0;
    duration += delta.duration ?? 0;
  }

  return {
    ...base,
    cooldown: Math.max(0.05, cooldown * stats.cooldownMultiplier),
    damage: damage * stats.damageMultiplier,
    area: area * stats.areaMultiplier,
    speed,
    amount: amount + stats.amountBonus,
    pierce,
    duration,
  };
}

/** What a level-up card offers. */
export type Card =
  | {
      readonly kind: 'weapon';
      readonly id: WeaponId;
      readonly level: number;
      readonly name: string;
      readonly describe: string;
    }
  | {
      readonly kind: 'passive';
      readonly id: PassiveId;
      readonly level: number;
      readonly name: string;
      readonly describe: string;
    }
  | { readonly kind: 'heal'; readonly name: string; readonly describe: string };

/**
 * Builds the choices for one level-up.
 *
 * New acquisitions are weighted above upgrades so that early levels broaden the build
 * before deepening it — a run that offers only "+5 damage" three times has technically
 * given the player a choice and actually given them nothing.
 *
 * When nothing is left to offer — every weapon and passive maxed — the pool falls back
 * to a heal rather than showing an empty screen or, worse, locking the run.
 */
export function offerCards(loadout: Loadout, rng: Rng, count = 3): Card[] {
  const pool: { card: Card; weight: number }[] = [];

  for (const id of WEAPON_IDS) {
    const level = loadout.weapons.get(id);
    const stats = weaponStats(id);
    if (level === undefined) {
      if (loadout.weapons.size < MAX_WEAPONS) {
        pool.push({
          card: { kind: 'weapon', id, level: 1, name: stats.name, describe: 'Yeni silah' },
          weight: 3,
        });
      }
    } else if (level < MAX_WEAPON_LEVEL) {
      pool.push({
        card: {
          kind: 'weapon',
          id,
          level: level + 1,
          name: stats.name,
          describe: `Seviye ${String(level + 1)}`,
        },
        weight: 2,
      });
    }
  }

  for (const id of PASSIVE_IDS) {
    const definition = PASSIVES[id];
    const level = loadout.passives.get(id);
    if (level === undefined) {
      if (loadout.passives.size < MAX_PASSIVES) {
        pool.push({
          card: {
            kind: 'passive',
            id,
            level: 1,
            name: definition.name,
            describe: definition.describe,
          },
          weight: 3,
        });
      }
    } else if (level < definition.maxLevel) {
      pool.push({
        card: {
          kind: 'passive',
          id,
          level: level + 1,
          name: definition.name,
          describe: `${definition.describe} — seviye ${String(level + 1)}`,
        },
        weight: 2,
      });
    }
  }

  const chosen: Card[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    let total = 0;
    for (const entry of pool) total += entry.weight;

    let roll = rng.next() * total;
    let picked = pool.length - 1;
    for (let p = 0; p < pool.length; p++) {
      roll -= pool[p].weight;
      if (roll <= 0) {
        picked = p;
        break;
      }
    }

    chosen.push(pool[picked].card);
    // Removed rather than reweighted: offering the same upgrade twice on one screen
    // is a choice between identical options.
    pool.splice(picked, 1);
  }

  while (chosen.length < count) {
    chosen.push({ kind: 'heal', name: 'Şerbet Kadehi', describe: 'Canını doldurur' });
  }
  return chosen;
}

/** Applies a chosen card. Returns true when it healed rather than changing the build. */
export function applyCard(loadout: Loadout, card: Card): boolean {
  switch (card.kind) {
    case 'weapon':
      loadout.weapons.set(card.id, card.level);
      return false;
    case 'passive':
      loadout.passives.set(card.id, card.level);
      return false;
    case 'heal':
      return true;
  }
}
