/**
 * Player movement.
 *
 * The first module under `src/sim/`, and the one that proves the split is real: it
 * imports nothing from `three` and nothing from the DOM, so the whole of the game's
 * movement feel can be exercised in a unit test at whatever timestep we like.
 *
 * The feel target is Vampire Survivors, whose control is deliberately blunt —
 * velocity matches the stick instantly, with no acceleration and no momentum. That
 * sounds unsophisticated and is exactly right: the entire game is about threading
 * gaps in a crowd, and any slide between intent and motion is felt as the character
 * refusing to obey. Inertia is for games where the movement itself is the challenge.
 */

/** World units per second at full tilt. */
export const PLAYER_SPEED = 5.6;

/**
 * How fast the figure turns to face its heading, in radians per second.
 *
 * Not instant: snapping the model through 180 degrees in one frame reads as a glitch
 * rather than as a turn. Fast enough that it never feels like steering a vehicle.
 */
export const PLAYER_TURN_RATE = 16;

export interface PlayerState {
  x: number;
  z: number;
  /** Position at the end of the previous step, for render interpolation. */
  previousX: number;
  previousZ: number;
  /** Heading in radians. 0 faces +Z; matches the model's forward axis. */
  facing: number;
  previousFacing: number;
  /** Current speed in world units per second, for driving the animation. */
  speed: number;
}

export function createPlayer(x = 0, z = 0): PlayerState {
  return { x, z, previousX: x, previousZ: z, facing: Math.PI, previousFacing: Math.PI, speed: 0 };
}

const TAU = Math.PI * 2;

/**
 * Wraps an angle to [-pi, pi).
 *
 * Every rotation bug in a top-down game traces back to skipping this: an object at
 * 3.1 rad turning to -3.1 rad takes the 6.2 rad route the long way round instead of
 * the 0.08 rad route, and the character visibly spins on the spot.
 */
export function wrapAngle(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const wrapped = (((radians + Math.PI) % TAU) + TAU) % TAU;
  return wrapped - Math.PI;
}

/** Rotates `current` toward `target` by at most `maxDelta`, taking the short way. */
export function turnToward(current: number, target: number, maxDelta: number): number {
  const difference = wrapAngle(target - current);
  if (Math.abs(difference) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(difference) * maxDelta);
}

/**
 * Advances the player by one fixed step.
 *
 * `intentX`/`intentZ` are expected to be at most unit length; anything longer is
 * clamped so a miscalibrated pad cannot outrun the design speed.
 */
export function stepPlayer(
  player: PlayerState,
  intentX: number,
  intentZ: number,
  stepSeconds: number,
): void {
  player.previousX = player.x;
  player.previousZ = player.z;
  player.previousFacing = player.facing;

  let x = Number.isFinite(intentX) ? intentX : 0;
  let z = Number.isFinite(intentZ) ? intentZ : 0;
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }

  const speed = Math.min(magnitude, 1) * PLAYER_SPEED;
  player.speed = speed;

  if (speed > 0) {
    player.x += x * PLAYER_SPEED * stepSeconds;
    player.z += z * PLAYER_SPEED * stepSeconds;
    // atan2(x, z) rather than the usual atan2(z, x): the models face +Z, so a
    // heading of 0 must mean "along +Z", not "along +X".
    player.facing = turnToward(player.facing, Math.atan2(x, z), PLAYER_TURN_RATE * stepSeconds);
  }
}

/**
 * Where the camera looks.
 *
 * Kept separate from the player so the camera can lag, lead, or be shaken without
 * any of that leaking into the position the game treats as authoritative.
 */
export interface CameraFocus {
  x: number;
  z: number;
  previousX: number;
  previousZ: number;
}

export function createCameraFocus(x = 0, z = 0): CameraFocus {
  return { x, z, previousX: x, previousZ: z };
}

/** World units the view leads the player by when running flat out. */
export const CAMERA_LOOK_AHEAD = 1.9;

/**
 * Fraction of the remaining distance closed per second.
 *
 * Deliberately high. The plan called for a dead zone as well, and building it showed
 * why not: a dead zone leaves the player off-centre whenever they stop, which in a
 * game about being surrounded silently gives one side of the screen more warning
 * than the other. Smoothing alone removes the jitter without moving the frame.
 */
export const CAMERA_SMOOTHING = 7.5;

export function stepCameraFocus(
  focus: CameraFocus,
  player: PlayerState,
  stepSeconds: number,
): void {
  focus.previousX = focus.x;
  focus.previousZ = focus.z;

  // Lead in the direction of travel, scaled by how fast the player is actually going,
  // so the view drifts forward while running and settles dead centre at rest.
  const lead = player.speed / PLAYER_SPEED;
  const targetX = player.x + Math.sin(player.facing) * CAMERA_LOOK_AHEAD * lead;
  const targetZ = player.z + Math.cos(player.facing) * CAMERA_LOOK_AHEAD * lead;

  // Exponential smoothing written so the result depends on elapsed time rather than
  // on how many steps it was split into.
  const blend = 1 - Math.exp(-CAMERA_SMOOTHING * stepSeconds);
  focus.x += (targetX - focus.x) * blend;
  focus.z += (targetZ - focus.z) * blend;
}
