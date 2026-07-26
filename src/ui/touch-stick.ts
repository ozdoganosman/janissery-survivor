import { TOUCH_STICK_RADIUS, type TouchStick } from '../core/input';

/**
 * Draws the floating thumbstick.
 *
 * Not decoration. A stick that steers invisibly feels broken rather than
 * frictionless: without a mark for where the thumb landed there is no way to judge
 * how far to drag for full speed, and on a small screen the thumb itself hides the
 * character it is steering.
 *
 * DOM rather than canvas, so it stays crisp at any device pixel ratio and costs the
 * render loop two style writes instead of a draw call.
 */

const BASE_SIZE = TOUCH_STICK_RADIUS * 2;
const THUMB_SIZE = 46;

export interface TouchStickOverlay {
  /** Call once per frame with the current stick, or `null` to hide it. */
  render(stick: TouchStick | null): void;
  dispose(): void;
}

export function createTouchStickOverlay(parent: HTMLElement = document.body): TouchStickOverlay {
  const base = document.createElement('div');
  base.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${String(BASE_SIZE)}px`,
    `height:${String(BASE_SIZE)}px`,
    'margin-left:' + String(-BASE_SIZE / 2) + 'px',
    'margin-top:' + String(-BASE_SIZE / 2) + 'px',
    'border-radius:50%',
    'border:2px solid rgba(242,239,230,0.30)',
    'background:rgba(20,16,12,0.22)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 110ms ease',
    'z-index:60',
  ].join(';');

  const thumb = document.createElement('div');
  thumb.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    `width:${String(THUMB_SIZE)}px`,
    `height:${String(THUMB_SIZE)}px`,
    'margin-left:' + String(-THUMB_SIZE / 2) + 'px',
    'margin-top:' + String(-THUMB_SIZE / 2) + 'px',
    'border-radius:50%',
    // The kaftan red, so the control reads as part of this game rather than as a
    // generic overlay dropped on top of it.
    'background:rgba(184,57,44,0.72)',
    'border:2px solid rgba(242,239,230,0.55)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 110ms ease',
    'z-index:61',
  ].join(';');

  parent.append(base, thumb);

  let visible = false;

  return {
    render(stick: TouchStick | null): void {
      if (stick === null) {
        if (visible) {
          visible = false;
          base.style.opacity = '0';
          thumb.style.opacity = '0';
        }
        return;
      }

      if (!visible) {
        visible = true;
        base.style.opacity = '1';
        thumb.style.opacity = '1';
      }

      // The thumb is pinned to the ring's edge once the drag passes full deflection,
      // which is the only honest way to show that dragging further adds nothing.
      const dx = stick.thumbX - stick.originX;
      const dy = stick.thumbY - stick.originY;
      const distance = Math.hypot(dx, dy);
      const limit = distance > TOUCH_STICK_RADIUS ? TOUCH_STICK_RADIUS / distance : 1;

      base.style.transform = `translate(${String(stick.originX)}px, ${String(stick.originY)}px)`;
      thumb.style.transform = `translate(${String(stick.originX + dx * limit)}px, ${String(
        stick.originY + dy * limit,
      )}px)`;
    },

    dispose(): void {
      base.remove();
      thumb.remove();
    },
  };
}
