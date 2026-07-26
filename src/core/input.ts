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

/**
 * Where the on-screen thumbstick currently is, in CSS pixels, or `null` when no
 * finger is down. The renderer draws it; the input layer only decides the numbers.
 */
export interface TouchStick {
  readonly originX: number;
  readonly originY: number;
  readonly thumbX: number;
  readonly thumbY: number;
}

export interface InputSource {
  sample(): InputSnapshot;
  /** True if a gamepad supplied the most recent non-zero reading. */
  get usingGamepad(): boolean;
  /** Non-null while a finger is steering. */
  get touchStick(): TouchStick | null;
  dispose(): void;
}

/** Drag distance, in CSS pixels, that counts as full deflection. */
export const TOUCH_STICK_RADIUS = 58;

/** Drag below this many pixels is treated as a tap, not a steer. */
const TOUCH_DEADZONE_PX = 7;

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

/**
 * Turns a drag into an intent vector.
 *
 * Screen Y grows downward and so does world +Z, so the vertical axis passes straight
 * through — dragging down walks toward the camera, matching what the S key does.
 */
export function stickIntent(
  originX: number,
  originY: number,
  pointX: number,
  pointY: number,
  radius = TOUCH_STICK_RADIUS,
  deadzonePx = TOUCH_DEADZONE_PX,
): InputSnapshot {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < deadzonePx) return { moveX: 0, moveZ: 0 };
  return clampIntent(dx / radius, dy / radius);
}

/**
 * @param target Window the keyboard and gamepad are read from.
 * @param touchSurface Element that starts a steer when touched. Restricting this to
 *   the canvas rather than the whole window keeps buttons and overlays tappable.
 */
export function createInput(
  target: Window = window,
  touchSurface: HTMLElement | null = null,
): InputSource {
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

  // A floating stick rather than a fixed pad in a corner: the stick appears wherever
  // the thumb lands. A fixed pad has to be found by looking, and looking away from
  // the crowd is the one thing this genre never gives you time for.
  let stickPointerId: number | null = null;
  let stickOriginX = 0;
  let stickOriginY = 0;
  let stickThumbX = 0;
  let stickThumbY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    // Only touch. Leaving the mouse out keeps click-to-drag from fighting a future
    // click-to-aim, and desktop already has the keyboard.
    if (event.pointerType !== 'touch') return;
    // Ignore extra fingers: the first one steers until it lifts, so a second thumb
    // resting on the glass cannot yank the player sideways.
    if (stickPointerId !== null) return;

    stickPointerId = event.pointerId;
    stickOriginX = event.clientX;
    stickOriginY = event.clientY;
    stickThumbX = event.clientX;
    stickThumbY = event.clientY;
    usingGamepad = false;
    touchSurface?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointerId) return;
    stickThumbX = event.clientX;
    stickThumbY = event.clientY;
    event.preventDefault();
  };

  const endStick = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointerId) return;
    stickPointerId = null;
  };

  if (touchSurface !== null) {
    touchSurface.addEventListener('pointerdown', onPointerDown);
    touchSurface.addEventListener('pointermove', onPointerMove);
    touchSurface.addEventListener('pointerup', endStick);
    // Without `pointercancel` the player keeps running when the browser steals the
    // gesture — a notification shade pulled down, a system back swipe.
    touchSurface.addEventListener('pointercancel', endStick);
    touchSurface.addEventListener('lostpointercapture', endStick);
  }

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

    get touchStick(): TouchStick | null {
      if (stickPointerId === null) return null;
      return {
        originX: stickOriginX,
        originY: stickOriginY,
        thumbX: stickThumbX,
        thumbY: stickThumbY,
      };
    },

    sample(): InputSnapshot {
      // Touch first: a finger on the glass is unambiguous intent, and on a phone
      // there is nothing else competing for it.
      if (stickPointerId !== null) {
        return stickIntent(stickOriginX, stickOriginY, stickThumbX, stickThumbY);
      }

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
      if (touchSurface !== null) {
        touchSurface.removeEventListener('pointerdown', onPointerDown);
        touchSurface.removeEventListener('pointermove', onPointerMove);
        touchSurface.removeEventListener('pointerup', endStick);
        touchSurface.removeEventListener('pointercancel', endStick);
        touchSurface.removeEventListener('lostpointercapture', endStick);
      }
      stickPointerId = null;
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
