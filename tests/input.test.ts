import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  clampIntent,
  createInput,
  stickIntent,
  TOUCH_STICK_RADIUS,
} from '../src/core/input';

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

describe('stickIntent', () => {
  const R = TOUCH_STICK_RADIUS;

  it('treats a tap as no movement', () => {
    // Without this, every tap on the screen jerks the character a step sideways.
    expect(stickIntent(100, 100, 100, 100)).toEqual({ moveX: 0, moveZ: 0 });
    expect(stickIntent(100, 100, 103, 102)).toEqual({ moveX: 0, moveZ: 0 });
  });

  it('maps a drag right to +X', () => {
    const intent = stickIntent(100, 100, 100 + R, 100);
    expect(intent.moveX).toBeCloseTo(1, 6);
    expect(intent.moveZ).toBeCloseTo(0, 6);
  });

  it('maps a drag down to +Z, matching the S key', () => {
    // Screen Y and world Z both grow "toward the viewer", so the axis passes through
    // unflipped. Getting this backwards makes the whole control feel inverted.
    const intent = stickIntent(100, 100, 100, 100 + R);
    expect(intent.moveZ).toBeCloseTo(1, 6);
  });

  it('maps a drag up to -Z', () => {
    const intent = stickIntent(100, 100, 100, 100 - R);
    expect(intent.moveZ).toBeCloseTo(-1, 6);
  });

  it('gives partial speed for a partial drag', () => {
    const intent = stickIntent(0, 0, R / 2, 0);
    expect(intent.moveX).toBeCloseTo(0.5, 6);
  });

  it('never exceeds full speed however far the finger travels', () => {
    for (const distance of [R, R * 2, R * 20, 5000]) {
      const intent = stickIntent(0, 0, distance, distance);
      expect(Math.hypot(intent.moveX, intent.moveZ)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('keeps direction when clamped', () => {
    const intent = stickIntent(0, 0, 300, 400);
    expect(intent.moveX / intent.moveZ).toBeCloseTo(300 / 400, 6);
  });

  it('covers every direction without a dead axis', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
      const intent = stickIntent(0, 0, Math.cos(angle) * R, Math.sin(angle) * R);
      expect(Math.hypot(intent.moveX, intent.moveZ)).toBeCloseTo(1, 6);
    }
  });

  it('survives nonsense coordinates', () => {
    expect(stickIntent(0, 0, Number.NaN, 0)).toEqual({ moveX: 0, moveZ: 0 });
    expect(stickIntent(0, 0, Number.POSITIVE_INFINITY, 0)).toEqual({ moveX: 0, moveZ: 0 });
  });
});

/**
 * A window stand-in whose gamepad API misbehaves in a specific way.
 *
 * This exists because of a real failure: inside a cross-origin iframe whose
 * permissions policy omits `gamepad`, `navigator.getGamepads()` raises a
 * `SecurityError` rather than returning nothing. It is polled every frame, so the
 * unguarded call threw before the first frame was ever drawn and the game showed a
 * grey screen with no error anywhere a player could see it.
 */
function windowWith(getGamepads: (() => (Gamepad | null)[]) | undefined): {
  target: Window;
  calls: () => number;
} {
  let calls = 0;
  const wrapped =
    getGamepads === undefined
      ? undefined
      : () => {
          calls++;
          return getGamepads();
        };
  const target = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    navigator: { getGamepads: wrapped },
  } as unknown as Window;
  return { target, calls: () => calls };
}

function throwingWindow(error: () => never): ReturnType<typeof windowWith> {
  return windowWith(error);
}

describe('createInput and a hostile gamepad API', () => {
  it('does not throw when getGamepads is forbidden', () => {
    const { target } = throwingWindow(() => {
      throw new DOMException('disallowed by permissions policy', 'SecurityError');
    });
    const input = createInput(target);
    expect(() => input.sample()).not.toThrow();
    expect(() => {
      input.pollPause();
    }).not.toThrow();
    input.dispose();
  });

  it('still reports a usable intent when the pad is forbidden', () => {
    // The failure mode that mattered was not the exception itself but everything
    // downstream of it: on a phone the only controls are touch and this call sits in
    // front of them.
    const { target } = throwingWindow(() => {
      throw new DOMException('nope', 'SecurityError');
    });
    const input = createInput(target);
    expect(input.sample()).toEqual({ moveX: 0, moveZ: 0 });
    input.dispose();
  });

  it('stops asking once it has been refused', () => {
    // Polled every frame; throwing sixty times a second is expensive on its own, and
    // the answer cannot change within a page load.
    const { target, calls } = throwingWindow(() => {
      throw new DOMException('nope', 'SecurityError');
    });
    const input = createInput(target);
    for (let i = 0; i < 50; i++) {
      input.pollPause();
      input.sample();
    }
    expect(calls()).toBe(1);
    input.dispose();
  });

  it('copes with the method being absent altogether', () => {
    const { target } = windowWith(undefined);
    const input = createInput(target);
    expect(() => input.sample()).not.toThrow();
    expect(() => {
      input.pollPause();
    }).not.toThrow();
    input.dispose();
  });

  it('copes with a pad list full of holes', () => {
    // Browsers pad the list with nulls for disconnected slots.
    const { target } = windowWith(() => [null, null, null, null]);
    const input = createInput(target);
    expect(input.sample()).toEqual({ moveX: 0, moveZ: 0 });
    input.dispose();
  });

  it('reads a pad that is actually there', () => {
    const pad = {
      connected: true,
      axes: [1, 0],
      buttons: [] as { pressed: boolean }[],
    } as unknown as Gamepad;
    const { target } = windowWith(() => [pad]);
    const input = createInput(target);
    const intent = input.sample();
    expect(intent.moveX).toBeGreaterThan(0.5);
    input.dispose();
  });

  it('fires pause once for a held pad button', () => {
    let pauses = 0;
    const button = { pressed: true };
    const pad = {
      connected: true,
      axes: [0, 0],
      buttons: Array.from({ length: 10 }, (_, i) => (i === 9 ? button : { pressed: false })),
    } as unknown as Gamepad;
    const { target } = windowWith(() => [pad]);
    const input = createInput(target, null, {
      onPause: () => {
        pauses++;
      },
    });

    for (let i = 0; i < 10; i++) input.pollPause();
    expect(pauses).toBe(1);

    button.pressed = false;
    input.pollPause();
    button.pressed = true;
    input.pollPause();
    expect(pauses).toBe(2);
    input.dispose();
  });
});
