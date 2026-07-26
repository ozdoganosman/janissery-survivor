import { describe, expect, it } from 'vitest';
import { TICK_SECONDS } from '../src/core/loop';
import {
  CAMERA_LOOK_AHEAD,
  createCameraFocus,
  createPlayer,
  PLAYER_SPEED,
  PLAYER_TURN_RATE,
  stepCameraFocus,
  stepPlayer,
  turnToward,
  wrapAngle,
} from '../src/sim/player';

/** Runs the player for a wall-clock duration at the real tick rate. */
function run(intentX: number, intentZ: number, seconds: number) {
  const player = createPlayer();
  const steps = Math.round(seconds / TICK_SECONDS);
  for (let i = 0; i < steps; i++) stepPlayer(player, intentX, intentZ, TICK_SECONDS);
  return player;
}

describe('wrapAngle', () => {
  it('leaves angles already in range alone', () => {
    // +pi is excluded from the range, so it is not in this list: it folds to -pi,
    // which is the same direction.
    for (const angle of [0, 1, -1, -Math.PI, Math.PI - 0.001]) {
      expect(wrapAngle(angle)).toBeCloseTo(angle, 10);
    }
  });

  it('folds angles past a full turn back into range', () => {
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 10);
    // Half turns land on the -pi end of the range, not +pi; the two name the same
    // direction, so only the documented bound has to agree with the code.
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 10);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 10);
    expect(wrapAngle(Math.PI * 100.5)).toBeCloseTo(Math.PI * 0.5, 8);
  });

  it('always lands within [-pi, pi)', () => {
    for (let i = -50; i <= 50; i++) {
      const wrapped = wrapAngle(i * 0.37);
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI - 1e-9);
      expect(wrapped).toBeLessThan(Math.PI + 1e-9);
    }
  });

  it('returns 0 rather than NaN for nonsense', () => {
    expect(wrapAngle(Number.NaN)).toBe(0);
    expect(wrapAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('turnToward', () => {
  it('snaps to the target when it is within reach', () => {
    expect(turnToward(0, 0.1, 0.5)).toBeCloseTo(0.1, 10);
  });

  it('moves by exactly the step when the target is further', () => {
    expect(turnToward(0, 3, 0.5)).toBeCloseTo(0.5, 10);
    expect(turnToward(0, -3, 0.5)).toBeCloseTo(-0.5, 10);
  });

  it('crosses the seam the short way', () => {
    // The whole reason wrapAngle exists: 3.1 to -3.1 is a 0.08 rad turn, not 6.2.
    // The result is compared as a delta, since stepping past +pi legitimately wraps
    // the absolute value round to the negative end.
    const result = turnToward(3.1, -3.1, 0.05);
    expect(wrapAngle(result - 3.1)).toBeCloseTo(0.05, 10);
  });

  it('never takes the long way round for any pair of angles', () => {
    for (let a = -3; a <= 3; a += 0.25) {
      for (let b = -3; b <= 3; b += 0.25) {
        const stepped = turnToward(a, b, 0.01);
        const moved = Math.abs(wrapAngle(stepped - a));
        const remaining = Math.abs(wrapAngle(b - a));
        expect(moved).toBeLessThanOrEqual(Math.min(0.01, remaining) + 1e-9);
      }
    }
  });
});

describe('stepPlayer', () => {
  it('stands still with no input', () => {
    const player = run(0, 0, 1);
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
    expect(player.speed).toBe(0);
  });

  it('reaches full speed on the very first step', () => {
    // No acceleration ramp: this is the control feel the genre depends on.
    const player = createPlayer();
    stepPlayer(player, 0, 1, TICK_SECONDS);
    expect(player.speed).toBeCloseTo(PLAYER_SPEED, 10);
    expect(player.z).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS, 10);
  });

  it('covers the design speed over a second', () => {
    const player = run(1, 0, 1);
    expect(player.x).toBeCloseTo(PLAYER_SPEED, 1);
  });

  it('does not travel faster diagonally', () => {
    // The classic top-down bug: unnormalised diagonals are 41% faster, which makes
    // zigzagging strictly optimal and quietly breaks every distance-based balance
    // number in the game.
    const straight = run(1, 0, 1);
    const diagonal = run(Math.SQRT1_2, Math.SQRT1_2, 1);
    const straightDistance = Math.hypot(straight.x, straight.z);
    const diagonalDistance = Math.hypot(diagonal.x, diagonal.z);
    expect(diagonalDistance).toBeCloseTo(straightDistance, 6);
  });

  it('clamps an over-long intent vector to the design speed', () => {
    const player = createPlayer();
    stepPlayer(player, 5, 5, TICK_SECONDS);
    expect(player.speed).toBeCloseTo(PLAYER_SPEED, 10);
    expect(Math.hypot(player.x, player.z)).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS, 10);
  });

  it('honours a partly tilted stick as partial speed', () => {
    const player = createPlayer();
    stepPlayer(player, 0, 0.5, TICK_SECONDS);
    expect(player.speed).toBeCloseTo(PLAYER_SPEED * 0.5, 10);
  });

  it('records the previous position for interpolation', () => {
    const player = createPlayer();
    stepPlayer(player, 0, 1, TICK_SECONDS);
    expect(player.previousX).toBe(0);
    expect(player.previousZ).toBe(0);
    stepPlayer(player, 0, 1, TICK_SECONDS);
    expect(player.previousZ).toBeCloseTo(PLAYER_SPEED * TICK_SECONDS, 10);
  });

  it('faces +Z for forward input, matching the model orientation', () => {
    const player = run(0, 1, 1);
    expect(wrapAngle(player.facing)).toBeCloseTo(0, 6);
  });

  it('faces +X for rightward input', () => {
    const player = run(1, 0, 1);
    expect(wrapAngle(player.facing)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('turns no faster than the turn rate', () => {
    const player = createPlayer();
    const before = player.facing;
    stepPlayer(player, 0, 1, TICK_SECONDS);
    expect(Math.abs(wrapAngle(player.facing - before))).toBeLessThanOrEqual(
      PLAYER_TURN_RATE * TICK_SECONDS + 1e-9,
    );
  });

  it('keeps its heading when input stops', () => {
    const player = run(1, 0, 0.5);
    const facing = player.facing;
    stepPlayer(player, 0, 0, TICK_SECONDS);
    expect(player.facing).toBe(facing);
    expect(player.speed).toBe(0);
  });

  it('ignores nonsense input instead of teleporting', () => {
    // A NaN position is unrecoverable — every later comparison against it is false,
    // so the player would vanish and never come back.
    const player = createPlayer();
    stepPlayer(player, Number.NaN, Number.POSITIVE_INFINITY, TICK_SECONDS);
    expect(Number.isFinite(player.x)).toBe(true);
    expect(Number.isFinite(player.z)).toBe(true);
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
  });

  it('gives the same result whatever the step size, over the same duration', () => {
    // Fixed steps are the point, but the integration should still not depend on the
    // tick rate for straight-line motion.
    const fine = createPlayer();
    for (let i = 0; i < 600; i++) stepPlayer(fine, 1, 0, 1 / 600);
    const coarse = createPlayer();
    for (let i = 0; i < 60; i++) stepPlayer(coarse, 1, 0, 1 / 60);
    expect(fine.x).toBeCloseTo(coarse.x, 9);
  });
});

describe('stepCameraFocus', () => {
  it('starts on the player and stays there at rest', () => {
    const player = createPlayer();
    const focus = createCameraFocus();
    for (let i = 0; i < 120; i++) stepCameraFocus(focus, player, TICK_SECONDS);
    expect(focus.x).toBeCloseTo(0, 6);
    expect(focus.z).toBeCloseTo(0, 6);
  });

  it('settles ahead of a running player, never behind', () => {
    const player = createPlayer();
    const focus = createCameraFocus();
    for (let i = 0; i < 300; i++) {
      stepPlayer(player, 0, 1, TICK_SECONDS);
      stepCameraFocus(focus, player, TICK_SECONDS);
    }
    // Leading means the view shows more of what is being walked into.
    expect(focus.z).toBeGreaterThan(player.z);
    expect(focus.z - player.z).toBeLessThanOrEqual(CAMERA_LOOK_AHEAD + 1e-6);
  });

  it('returns to centre once the player stops', () => {
    const player = createPlayer();
    const focus = createCameraFocus();
    for (let i = 0; i < 200; i++) {
      stepPlayer(player, 0, 1, TICK_SECONDS);
      stepCameraFocus(focus, player, TICK_SECONDS);
    }
    for (let i = 0; i < 400; i++) {
      stepPlayer(player, 0, 0, TICK_SECONDS);
      stepCameraFocus(focus, player, TICK_SECONDS);
    }
    expect(focus.z).toBeCloseTo(player.z, 4);
  });

  it('never overshoots its target, whatever the step size', () => {
    // Exponential smoothing with too large a step can overshoot and oscillate; the
    // 1 - exp(-k*dt) form cannot, and this pins that down.
    const player = createPlayer(10, 10);
    const focus = createCameraFocus(0, 0);
    let previousGap = Math.hypot(player.x - focus.x, player.z - focus.z);
    for (let i = 0; i < 50; i++) {
      stepCameraFocus(focus, player, 0.5);
      const gap = Math.hypot(player.x - focus.x, player.z - focus.z);
      expect(gap).toBeLessThanOrEqual(previousGap + 1e-9);
      previousGap = gap;
    }
    expect(previousGap).toBeCloseTo(0, 6);
  });

  it('records the previous focus for interpolation', () => {
    const player = createPlayer(5, 0);
    const focus = createCameraFocus(0, 0);
    stepCameraFocus(focus, player, TICK_SECONDS);
    expect(focus.previousX).toBe(0);
    expect(focus.x).toBeGreaterThan(0);
  });
});
