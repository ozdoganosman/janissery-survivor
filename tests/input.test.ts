import { describe, expect, it } from 'vitest';
import { applyDeadzone, clampIntent } from '../src/core/input';

describe('clampIntent', () => {
  it('leaves a short vector alone', () => {
    // A half-tilted stick must still mean half speed, so short vectors are not
    // normalised up to unit length.
    expect(clampIntent(0.5, 0)).toEqual({ moveX: 0.5, moveZ: 0 });
    expect(clampIntent(0, -0.25)).toEqual({ moveX: 0, moveZ: -0.25 });
  });

  it('leaves a unit vector alone', () => {
    const result = clampIntent(1, 0);
    expect(Math.hypot(result.moveX, result.moveZ)).toBeCloseTo(1, 10);
  });

  it('clamps a two-key diagonal to unit length', () => {
    // (1,1) unchanged is the classic bug: diagonals come out 41% faster and zigzag
    // becomes the fastest way to cross any distance.
    const result = clampIntent(1, 1);
    expect(Math.hypot(result.moveX, result.moveZ)).toBeCloseTo(1, 10);
    expect(result.moveX).toBeCloseTo(Math.SQRT1_2, 10);
    expect(result.moveZ).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('preserves direction while clamping', () => {
    const result = clampIntent(3, 4);
    expect(result.moveX / result.moveZ).toBeCloseTo(3 / 4, 10);
    expect(Math.hypot(result.moveX, result.moveZ)).toBeCloseTo(1, 10);
  });

  it('passes rest through as rest', () => {
    expect(clampIntent(0, 0)).toEqual({ moveX: 0, moveZ: 0 });
  });

  it('rejects nonsense rather than producing NaN movement', () => {
    expect(clampIntent(Number.NaN, 1)).toEqual({ moveX: 0, moveZ: 0 });
    expect(clampIntent(1, Number.POSITIVE_INFINITY)).toEqual({ moveX: 0, moveZ: 0 });
  });
});

describe('applyDeadzone', () => {
  it('treats stick drift as rest', () => {
    expect(applyDeadzone(0.1, 0.05)).toEqual({ moveX: 0, moveZ: 0 });
  });

  it('ramps from zero at the deadzone edge', () => {
    // A deadzone that simply passes the raw value through makes the character jump
    // straight to a third of full speed the instant the stick registers.
    const justOutside = applyDeadzone(0.23, 0, 0.22);
    expect(Math.hypot(justOutside.moveX, justOutside.moveZ)).toBeLessThan(0.05);
  });

  it('reaches full magnitude at full deflection', () => {
    const full = applyDeadzone(1, 0, 0.22);
    expect(full.moveX).toBeCloseTo(1, 10);
  });

  it('is radial, not per-axis', () => {
    // A per-axis deadzone clips a stick held diagonally into a square, so a diagonal
    // push registers as a smaller magnitude than the same push along an axis.
    const diagonal = applyDeadzone(Math.SQRT1_2, Math.SQRT1_2, 0.22);
    const axial = applyDeadzone(1, 0, 0.22);
    expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBeCloseTo(
      Math.hypot(axial.moveX, axial.moveZ),
      10,
    );
  });

  it('preserves direction', () => {
    const result = applyDeadzone(0.6, 0.8, 0.22);
    expect(result.moveX / result.moveZ).toBeCloseTo(0.6 / 0.8, 10);
  });

  it('never exceeds unit length for a legal stick reading', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      for (const radius of [0.3, 0.6, 0.9, 1]) {
        const result = applyDeadzone(Math.cos(angle) * radius, Math.sin(angle) * radius);
        expect(Math.hypot(result.moveX, result.moveZ)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
