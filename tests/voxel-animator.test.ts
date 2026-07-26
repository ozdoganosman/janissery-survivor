import { describe, expect, it } from 'vitest';
import {
  ANIMATION_KINDS,
  ANIMATION_RATE,
  poseFor,
  WALK_ARM_SWING,
  WALK_LEG_SWING,
  type Pose,
} from '../src/render/voxel/animator';

const LIMB_KEYS = ['armLeft', 'armRight', 'legLeft', 'legRight', 'head'] as const;

function limbs(pose: Pose): number[] {
  return LIMB_KEYS.map((key) => pose[key]);
}

/**
 * Compares two poses channel by channel with a tolerance.
 *
 * `toEqual` is the wrong tool here: `sin(0)` is exactly `0` while `sin(2*pi)` is
 * `-2.4e-16`, so an animation that loops perfectly to the eye fails an exact
 * comparison — and it fails on the sign of zero, which is doubly confusing.
 */
function expectPoseClose(actual: Pose, expected: Pose): void {
  for (const key of [...LIMB_KEYS, 'bobY', 'squashY'] as const) {
    expect(actual[key], `channel ${key}`).toBeCloseTo(expected[key], 12);
  }
}

describe('poseFor', () => {
  it('covers every declared animation', () => {
    for (const kind of ANIMATION_KINDS) {
      expect(() => poseFor(kind, 0.3)).not.toThrow();
      expect(ANIMATION_RATE[kind]).toBeGreaterThan(0);
    }
  });

  it('returns finite, bounded angles across the whole cycle', () => {
    // A NaN or runaway angle shows up as a limb vanishing, which is hard to trace back
    // from the visual symptom.
    for (const kind of ANIMATION_KINDS) {
      for (let step = 0; step <= 200; step++) {
        const pose = poseFor(kind, step / 200);
        for (const angle of limbs(pose)) {
          expect(Number.isFinite(angle)).toBe(true);
          expect(Math.abs(angle)).toBeLessThan(Math.PI);
        }
        expect(Number.isFinite(pose.bobY)).toBe(true);
        expect(pose.squashY).toBeGreaterThan(0.5);
        expect(pose.squashY).toBeLessThan(1.5);
      }
    }
  });

  it('survives nonsense phase values', () => {
    for (const phase of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      for (const kind of ANIMATION_KINDS) {
        const pose = poseFor(kind, phase);
        for (const angle of limbs(pose)) expect(Number.isFinite(angle)).toBe(true);
      }
    }
  });

  describe('walk', () => {
    it('loops seamlessly: phase 0 and phase 1 agree', () => {
      // Any mismatch here is a visible jerk once per stride.
      expectPoseClose(poseFor('walk', 0), poseFor('walk', 1));
    });

    it('treats phase as cycles, so 1.25 matches 0.25', () => {
      expectPoseClose(poseFor('walk', 1.25), poseFor('walk', 0.25));
    });

    it('swings the legs in opposition', () => {
      // Legs moving together is a hop, not a walk.
      for (const phase of [0.1, 0.35, 0.6, 0.85]) {
        const pose = poseFor('walk', phase);
        expect(pose.legLeft).toBeCloseTo(-pose.legRight, 10);
      }
    });

    it('swings each arm against the leg on its own side', () => {
      for (const phase of [0.15, 0.4, 0.9]) {
        const pose = poseFor('walk', phase);
        expect(Math.sign(pose.armLeft)).toBe(-Math.sign(pose.legLeft));
        expect(Math.sign(pose.armRight)).toBe(-Math.sign(pose.legRight));
      }
    });

    it('reaches its stated swing amplitudes', () => {
      // The instanced renderer reproduces this cycle from these same constants, so a
      // drift between them would make the player and the horde walk differently.
      const quarter = poseFor('walk', 0.25);
      expect(quarter.legLeft).toBeCloseTo(WALK_LEG_SWING, 10);
      expect(quarter.armRight).toBeCloseTo(WALK_ARM_SWING, 10);
    });

    it('bobs upward only, twice per stride', () => {
      // Bob comes from a leg passing underneath, which happens on both halves of the
      // cycle; a bob that went negative would sink the figure into the ground.
      let peaks = 0;
      let previous = poseFor('walk', -0.005).bobY;
      let current = poseFor('walk', 0).bobY;
      for (let step = 1; step <= 200; step++) {
        const next = poseFor('walk', step / 200).bobY;
        expect(current).toBeGreaterThanOrEqual(-1e-9);
        if (current > previous && current >= next) peaks++;
        previous = current;
        current = next;
      }
      expect(peaks).toBe(2);
    });
  });

  describe('idle', () => {
    it('loops seamlessly', () => {
      expectPoseClose(poseFor('idle', 0), poseFor('idle', 1));
    });

    it('keeps the legs planted', () => {
      for (let step = 0; step <= 50; step++) {
        const pose = poseFor('idle', step / 50);
        expect(pose.legLeft).toBe(0);
        expect(pose.legRight).toBe(0);
      }
    });

    it('moves far less than walking', () => {
      let idleMax = 0;
      let walkMax = 0;
      for (let step = 0; step <= 100; step++) {
        idleMax = Math.max(idleMax, ...limbs(poseFor('idle', step / 100)).map(Math.abs));
        walkMax = Math.max(walkMax, ...limbs(poseFor('walk', step / 100)).map(Math.abs));
      }
      expect(idleMax).toBeLessThan(walkMax / 4);
    });
  });

  describe('attack', () => {
    it('winds back before striking forward', () => {
      // Without the wind-up the swing has no anticipation and the player cannot read
      // the attack coming.
      const windup = poseFor('attack', 0.35).armRight;
      const strike = poseFor('attack', 1).armRight;
      expect(windup).toBeLessThan(-1);
      expect(strike).toBeGreaterThan(0.7);
    });

    it('holds its final pose past the end rather than looping', () => {
      expectPoseClose(poseFor('attack', 1.5), poseFor('attack', 1));
      expectPoseClose(poseFor('attack', 12), poseFor('attack', 1));
    });

    it('moves monotonically once the strike begins', () => {
      let previous = poseFor('attack', 0.42).armRight;
      for (let step = 43; step <= 100; step++) {
        const current = poseFor('attack', step / 100).armRight;
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = current;
      }
    });
  });

  describe('hit', () => {
    it('returns to rest so a figure cannot be left stuck in a flinch', () => {
      const end = poseFor('hit', 1);
      for (const angle of limbs(end)) expect(Math.abs(angle)).toBeLessThan(1e-9);
      expect(end.squashY).toBeCloseTo(1, 9);
    });

    it('compresses the figure at the moment of impact', () => {
      expect(poseFor('hit', 0.4).squashY).toBeLessThan(0.97);
    });

    it('starts from rest', () => {
      const start = poseFor('hit', 0);
      for (const angle of limbs(start)) expect(Math.abs(angle)).toBeLessThan(1e-9);
    });
  });
});
