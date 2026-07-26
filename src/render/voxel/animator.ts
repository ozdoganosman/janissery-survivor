/**
 * Procedural, skeleton-free posing.
 *
 * There is no rig and no keyframe data: a pose is a handful of rotation angles
 * computed from a phase value. Blocky limbs pivoting at the shoulder and hip read
 * perfectly well this way — it is how Minecraft's own mobs move — and it removes the
 * entire rigging and animation-export pipeline from the project.
 *
 * Deliberately free of any `three` import so it can be tested directly, and so the
 * instanced renderer can reproduce the same walk cycle in a vertex shader without
 * two definitions of "walking" drifting apart.
 */

export const ANIMATION_KINDS = ['idle', 'walk', 'attack', 'hit'] as const;

export type AnimationKind = (typeof ANIMATION_KINDS)[number];

/**
 * Limb rotations in radians about the X axis (forward/back swing), plus whole-body
 * offsets. Positive limb angles swing forward, toward +Z.
 */
export interface Pose {
  readonly armLeft: number;
  readonly armRight: number;
  readonly legLeft: number;
  readonly legRight: number;
  readonly head: number;
  /** Vertical offset of the whole figure, in world units. */
  readonly bobY: number;
  /**
   * Vertical scale of the whole figure. Squash and stretch: Minecraft does not do
   * this, but at top-down scale a rigid figure reads as a sliding statue, and a few
   * percent of vertical give is what makes a walk look like it has weight.
   */
  readonly squashY: number;
}

const TAU = Math.PI * 2;

/** Amplitude of the leg swing while walking, in radians. */
export const WALK_LEG_SWING = 0.62;
/** Arms swing less than legs, and in opposition to them. */
export const WALK_ARM_SWING = 0.42;
/** Peak vertical travel of the walk bob, in world units. */
export const WALK_BOB = 0.075;

/**
 * Pose for an animation at a given phase.
 *
 * `phase` is in cycles, not radians, and need not be wrapped: `1.25` and `0.25` give
 * the same result for looping animations. `idle` and `walk` loop; `attack` and `hit`
 * are one-shot and hold their final pose for phase >= 1.
 */
export function poseFor(kind: AnimationKind, phase: number): Pose {
  // A non-finite phase must not reach the trigonometry. `Math.sin(NaN)` and
  // `Math.sin(Infinity)` are both NaN, a NaN rotation silently drops the limb's
  // vertices, and the visible symptom — an arm that has simply disappeared — gives no
  // hint that a clock or a division upstream produced the bad value.
  const safePhase = Number.isFinite(phase) ? phase : 0;

  switch (kind) {
    case 'walk':
      return walkPose(safePhase);
    case 'attack':
      return attackPose(clamp01(safePhase));
    case 'hit':
      return hitPose(clamp01(safePhase));
    case 'idle':
      return idlePose(safePhase);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function walkPose(phase: number): Pose {
  const swing = Math.sin(TAU * phase);
  return {
    legLeft: WALK_LEG_SWING * swing,
    legRight: -WALK_LEG_SWING * swing,
    // Arms counter the legs; matching them produces an unsettling march.
    armLeft: -WALK_ARM_SWING * swing,
    armRight: WALK_ARM_SWING * swing,
    // The head lags the body slightly, which reads as weight rather than stiffness.
    head: 0.05 * Math.sin(TAU * phase - 0.6),
    // The body rises twice per stride, once for each leg passing under it, hence the
    // doubled frequency and the absolute value.
    bobY: WALK_BOB * Math.abs(Math.sin(TAU * phase)),
    squashY: 1 - 0.025 * Math.cos(2 * TAU * phase),
  };
}

function idlePose(phase: number): Pose {
  // A slow breath at roughly a third of walking cadence.
  const breath = Math.sin(TAU * phase);
  return {
    legLeft: 0,
    legRight: 0,
    armLeft: 0.05 + 0.03 * breath,
    armRight: 0.05 - 0.03 * breath,
    head: 0.03 * breath,
    bobY: 0.012 * breath,
    squashY: 1 + 0.012 * breath,
  };
}

function attackPose(phase: number): Pose {
  // Wind up slowly, strike fast: the anticipation is what makes a hit readable to
  // the player, so it gets most of the cycle.
  const WINDUP_END = 0.42;
  let swordArm: number;
  if (phase < WINDUP_END) {
    const t = phase / WINDUP_END;
    swordArm = -1.55 * easeOutSine(t);
  } else {
    const t = (phase - WINDUP_END) / (1 - WINDUP_END);
    swordArm = -1.55 + 2.45 * easeOutCubic(t);
  }

  return {
    // The sword lives in the right arm's box list, so this angle swings the blade.
    armRight: swordArm,
    armLeft: -0.25 * Math.sin(Math.PI * phase),
    legLeft: 0.12 * Math.sin(Math.PI * phase),
    legRight: -0.12 * Math.sin(Math.PI * phase),
    head: 0.1 * Math.sin(Math.PI * phase),
    bobY: 0,
    squashY: 1,
  };
}

function hitPose(phase: number): Pose {
  // A single sharp recoil that decays: sin(pi*t) peaks in the middle and returns to
  // rest, so the figure cannot be left stuck in a flinch.
  const recoil = Math.sin(Math.PI * phase) * (1 - phase * 0.4);
  return {
    armLeft: -0.5 * recoil,
    armRight: -0.5 * recoil,
    legLeft: -0.2 * recoil,
    legRight: 0.2 * recoil,
    head: -0.35 * recoil,
    bobY: 0,
    // Compressed by the blow, which sells the impact more than the limb angles do.
    squashY: 1 - 0.12 * recoil,
  };
}

function easeOutSine(t: number): number {
  return Math.sin((t * Math.PI) / 2);
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/** Cycles per second for each looping animation, used to turn elapsed time into phase. */
export const ANIMATION_RATE: Readonly<Record<AnimationKind, number>> = {
  idle: 0.35,
  walk: 1.55,
  attack: 1.6,
  hit: 3.2,
};
