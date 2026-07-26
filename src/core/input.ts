/**
 * Movement intent from keyboard and gamepad.
 *
 * This layer owns everything that touches the browser — key events, the gamepad API,
 * focus loss — and hands the simulation a single plain vector. The simulation never
 * learns that a key exists, which is what keeps it testable and what will let a replay
 * or an AI-driven demo feed it the same way a player does.
 */

/** Below this, stick drift is treated as rest. Cheap sticks idle around 0.1. */
const STICK_DEADZONE = 0.22;

export interface InputSnapshot {
  /** Movement intent on the ground plane. Magnitude is 0..1; +Z is "away from camera". */
  readonly moveX: number;
  readonly moveZ: number;
}

export interface InputSource {
  sample(): InputSnapshot;
  /** True if a gamepad supplied the most recent non-zero reading. */
  get usingGamepad(): boolean;
  dispose(): void;
}

const MOVE_LEFT = new Set(['KeyA', 'ArrowLeft']);
const MOVE_RIGHT = new Set(['KeyD', 'ArrowRight']);
const MOVE_UP = new Set(['KeyW', 'ArrowUp']);
const MOVE_DOWN = new Set(['KeyS', 'ArrowDown']);

/** Keys whose default action would otherwise scroll the page under the game. */
const SWALLOWED = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'PageUp',
  'PageDown',
]);

/**
 * Clamps an intent vector to unit length without changing its direction.
 *
 * Holding two keys gives (1, 1), and using that unchanged is the oldest bug in
 * top-down movement: diagonals come out 41% faster, so the optimal way to cross a
 * room is always to zigzag. Clamping rather than always normalising keeps a
 * half-tilted analogue stick meaning "half speed".
 */
export function clampIntent(x: number, z: number): InputSnapshot {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { moveX: 0, moveZ: 0 };
  const magnitude = Math.hypot(x, z);
  if (magnitude <= 1) return { moveX: x, moveZ: z };
  return { moveX: x / magnitude, moveZ: z / magnitude };
}

/** Radial deadzone, so a stick held diagonally is not clipped per axis into a square. */
export function applyDeadzone(x: number, y: number, deadzone = STICK_DEADZONE): InputSnapshot {
  const magnitude = Math.hypot(x, y);
  if (magnitude < deadzone) return { moveX: 0, moveZ: 0 };
  // Rescale so movement starts from zero at the deadzone edge instead of jumping.
  const scaled = (magnitude - deadzone) / (1 - deadzone) / magnitude;
  return { moveX: x * scaled, moveZ: y * scaled };
}

export function createInput(target: Window = window): InputSource {
  const pressed = new Set<string>();
  let usingGamepad = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (SWALLOWED.has(event.code)) event.preventDefault();
    pressed.add(event.code);
    usingGamepad = false;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    pressed.delete(event.code);
  };

  // Losing focus mid-stride never delivers the keyup, so without this the player
  // keeps running in a straight line for as long as the tab is in the background —
  // and in this genre that means walking into the horde while alt-tabbed.
  const onBlur = (): void => {
    pressed.clear();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  const readGamepad = (): InputSnapshot | null => {
    const pads = target.navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (pad === null || !pad.connected) continue;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      const stick = applyDeadzone(x, y);
      if (stick.moveX !== 0 || stick.moveZ !== 0) return stick;
    }
    return null;
  };

  return {
    get usingGamepad() {
      return usingGamepad;
    },

    sample(): InputSnapshot {
      let x = 0;
      let z = 0;
      if (pressed.has('KeyA') || pressed.has('ArrowLeft')) x -= 1;
      if (pressed.has('KeyD') || pressed.has('ArrowRight')) x += 1;
      // Screen-up walks away from the camera, which is -Z in world space.
      if (pressed.has('KeyW') || pressed.has('ArrowUp')) z -= 1;
      if (pressed.has('KeyS') || pressed.has('ArrowDown')) z += 1;

      if (x !== 0 || z !== 0) return clampIntent(x, z);

      const stick = readGamepad();
      if (stick !== null) {
        usingGamepad = true;
        return clampIntent(stick.moveX, stick.moveZ);
      }
      return { moveX: 0, moveZ: 0 };
    },

    dispose(): void {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      pressed.clear();
    },
  };
}

/** Exposed for tests and for a future key-rebinding screen. */
export const KEY_BINDINGS = {
  left: MOVE_LEFT,
  right: MOVE_RIGHT,
  up: MOVE_UP,
  down: MOVE_DOWN,
} as const;
