import { describe, expect, it } from 'vitest';
import { MAX_STEPS_PER_FRAME, StepAccumulator, TICK_SECONDS, TICK_HZ } from '../src/core/loop';

describe('TICK constants', () => {
  it('describes a 60 Hz simulation', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_SECONDS).toBeCloseTo(1 / 60, 12);
  });
});

describe('StepAccumulator', () => {
  it('runs exactly one step for one tick worth of time', () => {
    const acc = new StepAccumulator();
    expect(acc.advance(TICK_SECONDS)).toBe(1);
    expect(acc.alpha).toBeCloseTo(0, 10);
  });

  it('runs no step when less than a full tick has elapsed', () => {
    const acc = new StepAccumulator();
    expect(acc.advance(TICK_SECONDS / 2)).toBe(0);
    expect(acc.alpha).toBeCloseTo(0.5, 10);
  });

  it('carries leftover time into later frames instead of discarding it', () => {
    const acc = new StepAccumulator();
    // Three-quarter ticks: 0, then 1 (0.5 left), then 1 (0.25 left), then 1.
    expect(acc.advance(TICK_SECONDS * 0.75)).toBe(0);
    expect(acc.advance(TICK_SECONDS * 0.75)).toBe(1);
    expect(acc.advance(TICK_SECONDS * 0.75)).toBe(1);
    expect(acc.advance(TICK_SECONDS * 0.75)).toBe(1);
  });

  it('runs several steps for a slow frame', () => {
    const acc = new StepAccumulator();
    expect(acc.advance(TICK_SECONDS * 3)).toBe(3);
  });

  it('exposes alpha strictly inside [0, 1)', () => {
    const acc = new StepAccumulator();
    for (let i = 0; i < 200; i++) {
      acc.advance(TICK_SECONDS * 0.37);
      expect(acc.alpha).toBeGreaterThanOrEqual(0);
      expect(acc.alpha).toBeLessThan(1);
    }
  });

  it('caps the steps taken for one very long stall', () => {
    const acc = new StepAccumulator();
    // A ten second stall: a backgrounded tab or a laptop waking from sleep.
    expect(acc.advance(10)).toBe(MAX_STEPS_PER_FRAME);
  });

  it('does not accumulate a backlog across repeated stalls', () => {
    const acc = new StepAccumulator();

    // This is the regression that matters. Clamping the returned step count while
    // still banking the full elapsed time would leave seconds of unconsumed time in
    // the accumulator, so every later frame would keep running the maximum number of
    // steps and never catch up — the spiral of death. Each stall must be forgotten.
    for (let i = 0; i < 20; i++) {
      expect(acc.advance(5)).toBe(MAX_STEPS_PER_FRAME);
    }

    // Back to a healthy frame: one tick of time must yield exactly one step.
    expect(acc.advance(TICK_SECONDS)).toBe(1);
  });

  it('ignores non-advancing or nonsensical frame times', () => {
    const acc = new StepAccumulator();
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(acc.advance(bad)).toBe(0);
    }
    expect(acc.alpha).toBe(0);
  });

  it('drops pending time on reset so resuming from pause does not fast-forward', () => {
    const acc = new StepAccumulator();
    acc.advance(TICK_SECONDS * 0.9);
    expect(acc.alpha).toBeGreaterThan(0);

    acc.reset();
    expect(acc.alpha).toBe(0);
    expect(acc.advance(TICK_SECONDS * 0.5)).toBe(0);
  });

  it('keeps the simulation clock proportional to elapsed time', () => {
    const acc = new StepAccumulator();
    let steps = 0;

    // Two seconds of jittery ~90 Hz frames should produce close to 120 steps,
    // regardless of how unevenly the time arrives.
    let elapsed = 0;
    const frameSeconds = 1 / 90;
    while (elapsed < 2) {
      steps += acc.advance(frameSeconds);
      elapsed += frameSeconds;
    }

    expect(steps).toBeGreaterThanOrEqual(118);
    expect(steps).toBeLessThanOrEqual(120);
  });

  it('accepts a custom step rate and cap', () => {
    const acc = new StepAccumulator(1 / 30, 2);
    expect(acc.advance(1 / 30)).toBe(1);
    expect(acc.advance(10)).toBe(2);
  });

  it('rejects an unusable configuration rather than misbehaving later', () => {
    expect(() => new StepAccumulator(0)).toThrow(RangeError);
    expect(() => new StepAccumulator(-1)).toThrow(RangeError);
    expect(() => new StepAccumulator(TICK_SECONDS, 0)).toThrow(RangeError);
    expect(() => new StepAccumulator(TICK_SECONDS, 1.5)).toThrow(RangeError);
  });
});
