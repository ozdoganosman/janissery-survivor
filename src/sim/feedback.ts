import type { Rng } from '../core/rng';

/**
 * Screen shake and hit-stop.
 *
 * Both live in the simulation rather than the renderer, because both are time-based
 * and a frame-rate-dependent shake is a different shake on every machine. They are
 * kept apart from the camera's follow logic so that shake can be switched off — the
 * settings screen will offer that, and a player who finds it nauseating should lose
 * the shake, not the camera.
 */

/** How fast a shake dies away, per second. */
const SHAKE_DECAY = 7.5;

/** Ceiling on offset, in world units. Enough to feel, not enough to hide an enemy. */
const MAX_SHAKE = 0.55;

export interface ScreenShake {
  /** Current intensity in [0, 1]. */
  strength: number;
  offsetX: number;
  offsetZ: number;
  previousOffsetX: number;
  previousOffsetZ: number;
}

export function createScreenShake(): ScreenShake {
  return { strength: 0, offsetX: 0, offsetZ: 0, previousOffsetX: 0, previousOffsetZ: 0 };
}

/**
 * Adds to a shake without letting it stack past the ceiling.
 *
 * Taking the maximum rather than the sum matters once hundreds of enemies are dying
 * per second: summing would peg the shake at full strength permanently, and a screen
 * that is always shaking conveys nothing.
 */
export function addShake(shake: ScreenShake, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  shake.strength = Math.min(1, Math.max(shake.strength, amount));
}

export function stepShake(shake: ScreenShake, stepSeconds: number, rng: Rng): void {
  shake.previousOffsetX = shake.offsetX;
  shake.previousOffsetZ = shake.offsetZ;

  if (shake.strength <= 0.001) {
    shake.strength = 0;
    shake.offsetX = 0;
    shake.offsetZ = 0;
    return;
  }

  // Squared, so the shake falls off sharply and spends most of its life subtle.
  const magnitude = MAX_SHAKE * shake.strength * shake.strength;
  const angle = rng.next() * Math.PI * 2;
  shake.offsetX = Math.sin(angle) * magnitude;
  shake.offsetZ = Math.cos(angle) * magnitude;

  shake.strength *= Math.exp(-SHAKE_DECAY * stepSeconds);
}

/**
 * Brief freeze on a heavy hit.
 *
 * Hit-stop is a real technique and a real hazard here. In a game landing hundreds of
 * hits a second, freezing on every one would stop the game outright, so it fires only
 * on criticals and no more often than `HITSTOP_COOLDOWN` allows. The freeze holds the
 * whole simulation still rather than slowing it, because a slowed simulation at a
 * fixed timestep means either skipping steps or changing their length — and changing
 * step length is exactly what the fixed timestep exists to prevent.
 */
const HITSTOP_SECONDS = 0.055;
const HITSTOP_COOLDOWN = 0.22;

export interface HitStop {
  /** Seconds the simulation is still frozen for. */
  remaining: number;
  /** Seconds until another freeze is permitted. */
  cooldown: number;
}

export function createHitStop(): HitStop {
  return { remaining: 0, cooldown: 0 };
}

export function requestHitStop(hitStop: HitStop): void {
  if (hitStop.cooldown > 0) return;
  hitStop.remaining = HITSTOP_SECONDS;
  hitStop.cooldown = HITSTOP_COOLDOWN;
}

/**
 * Advances the freeze clock.
 *
 * @returns True while the world should stay still. The caller keeps rendering, so the
 *   frozen frame is still drawn and interpolated — otherwise the freeze would look
 *   like a dropped frame instead of an impact.
 */
export function stepHitStop(hitStop: HitStop, stepSeconds: number): boolean {
  if (hitStop.cooldown > 0) hitStop.cooldown -= stepSeconds;
  if (hitStop.remaining <= 0) return false;
  hitStop.remaining -= stepSeconds;
  return true;
}
