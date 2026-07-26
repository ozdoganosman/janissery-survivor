/**
 * Fixed-timestep simulation driving.
 *
 * The simulation advances in fixed 60 Hz steps regardless of display refresh rate,
 * and the renderer interpolates between the two most recent states. This is the one
 * decision that must be right from day one: a game that advances by a variable
 * `deltaTime` plays at a different difficulty on a 144 Hz monitor than on a 60 Hz
 * one, and retrofitting fixed steps later means rewriting every movement, cooldown
 * and damage-over-time calculation.
 */

/** Simulation frequency in hertz. */
export const TICK_HZ = 60;

/** Duration of a single simulation step, in seconds. */
export const TICK_SECONDS = 1 / TICK_HZ;

/**
 * Upper bound on simulation steps executed for one rendered frame.
 *
 * Without this cap, a long stall (backgrounded tab, GC pause, laptop sleep) hands
 * us a huge elapsed time; we would then try to catch up with hundreds of steps in
 * one frame, which takes longer than the stall itself and produces an even bigger
 * elapsed time next frame — the classic "spiral of death". Capping means the game
 * clock slips behind wall-clock after a stall, which nobody notices, instead of
 * locking up the page.
 */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Converts irregular frame durations into a whole number of fixed steps plus a
 * leftover fraction used for render interpolation.
 *
 * Deliberately free of any timer or browser API so it can be driven synchronously
 * from tests.
 */
export class StepAccumulator {
  /** Unconsumed time, always in [0, stepSeconds). */
  private leftover = 0;

  constructor(
    readonly stepSeconds: number = TICK_SECONDS,
    readonly maxStepsPerFrame: number = MAX_STEPS_PER_FRAME,
  ) {
    if (!(stepSeconds > 0)) {
      throw new RangeError(`stepSeconds must be positive, got ${stepSeconds}`);
    }
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new RangeError(`maxStepsPerFrame must be a positive integer, got ${maxStepsPerFrame}`);
    }
  }

  /**
   * Feeds one frame's elapsed time in and returns how many simulation steps to run.
   *
   * Non-finite or negative input is treated as zero rather than throwing: clock
   * sources occasionally misbehave, and a stuttering frame should not crash a run.
   */
  advance(frameSeconds: number): number {
    if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) {
      return 0;
    }

    // Clamp *before* accumulating. Clamping the step count afterwards would leave
    // the excess time sitting in `leftover`, so the backlog would survive into the
    // next frame and the spiral would happen anyway, just more slowly.
    const budget = this.stepSeconds * this.maxStepsPerFrame;
    this.leftover += Math.min(frameSeconds, budget);

    let steps = 0;
    while (this.leftover >= this.stepSeconds) {
      this.leftover -= this.stepSeconds;
      steps++;
    }
    return steps;
  }

  /**
   * How far the renderer is between the previous and current simulation state,
   * in [0, 1). Multiply into a lerp to remove the visible stutter that comes from
   * a 60 Hz simulation drawn on a 144 Hz display.
   */
  get alpha(): number {
    return this.leftover / this.stepSeconds;
  }

  /** Discards pending time. Use when resuming from pause so the game does not fast-forward. */
  reset(): void {
    this.leftover = 0;
  }
}

export interface LoopCallbacks {
  /** Advance the simulation by exactly one fixed step. */
  update(stepSeconds: number): void;
  /** Draw the world, blending states by `alpha`. */
  render(alpha: number): void;
}

export interface LoopHandle {
  /** Stops scheduling frames. Safe to call more than once. */
  stop(): void;
  /** Whether the loop is still scheduling frames. */
  readonly running: boolean;
}

/**
 * Drives `callbacks` from `requestAnimationFrame`, stepping the simulation at a
 * fixed rate and rendering once per displayed frame.
 */
export function startFixedStepLoop(
  callbacks: LoopCallbacks,
  accumulator: StepAccumulator = new StepAccumulator(),
): LoopHandle {
  let running = true;
  let frameId = 0;
  let previousMs = performance.now();

  const frame = (nowMs: number): void => {
    if (!running) return;
    frameId = requestAnimationFrame(frame);

    const frameSeconds = (nowMs - previousMs) / 1000;
    previousMs = nowMs;

    const steps = accumulator.advance(frameSeconds);
    for (let i = 0; i < steps; i++) {
      callbacks.update(accumulator.stepSeconds);
    }

    callbacks.render(accumulator.alpha);
  };

  frameId = requestAnimationFrame(frame);

  return {
    get running() {
      return running;
    },
    stop() {
      running = false;
      cancelAnimationFrame(frameId);
    },
  };
}
