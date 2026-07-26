import { t } from '../core/strings';
import type { ItemIconId } from '../render/voxel/icons';

/**
 * Health, experience, the run clock and what the player is carrying.
 *
 * The bars are absolute rather than fractional. "Sixty of a hundred" tells the player
 * how many more contacts they can survive; a bar that is "60% full" does not.
 *
 * The loadout row exists because a build the player cannot see is a build they cannot
 * plan around: the card screen offers an upgrade to something they took four minutes
 * ago, and without the row the only way to know what that was is to remember.
 */

/** One carried item, as the HUD needs it. */
export interface HudItem {
  readonly id: ItemIconId;
  readonly name: string;
  readonly level: number;
  readonly weapon: boolean;
}

export interface Hud {
  update(state: {
    health: number;
    maxHealth: number;
    level: number;
    experienceFraction: number;
    secondsElapsed: number;
    /** 0 when unhurt, rising to 1 at the moment of a hit. */
    hurt: number;
  }): void;
  /** Redraws the carried items. Called on a build change, not per frame. */
  setLoadout(items: readonly HudItem[]): void;
  dispose(): void;
}

const STYLE = `
.hud-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 90;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #efe7d6;
}
.hud-xp {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5px;
  background: rgba(20, 16, 12, 0.6);
}
.hud-xp-fill {
  height: 100%;
  width: 0%;
  background: #6ad6f0;
  transition: width 90ms linear;
}
.hud-top {
  position: absolute;
  top: 11px; left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  font-variant-numeric: tabular-nums;
}
.hud-level { color: #6ad6f0; }
.hud-health {
  position: absolute;
  left: 50%; bottom: 66px;
  transform: translateX(-50%);
  width: min(240px, 60vw);
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.hud-health-bar {
  width: 100%;
  height: 9px;
  background: rgba(20, 16, 12, 0.7);
  border: 1px solid rgba(239, 231, 214, 0.2);
  border-radius: 2px;
  overflow: hidden;
}
.hud-health-fill {
  height: 100%;
  width: 100%;
  background: #b8392c;
  transition: width 120ms ease-out;
}
.hud-health-text {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  font-variant-numeric: tabular-nums;
}
/* A red wash on damage: at a glance, from anywhere on the screen, without having to
   be watching the bar. */
.hud-hurt {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(184,57,44,0) 45%, rgba(184,57,44,0.55) 100%);
  opacity: 0;
}
/* A phone has no Escape key. Without this there is no way to stop, change a setting
   or leave a run on the platform where the run is hardest to leave. */
.hud-pause {
  position: absolute;
  top: 10px; right: 10px;
  pointer-events: auto;
  appearance: none;
  width: 34px; height: 34px;
  padding: 0;
  display: grid;
  place-items: center;
  gap: 3px;
  border-radius: 4px;
  background: rgba(20, 16, 12, 0.66);
  border: 1px solid rgba(239, 231, 214, 0.2);
  cursor: pointer;
}
.hud-pause:hover { background: rgba(40, 32, 26, 0.9); }
.hud-pause:focus-visible { outline: 2px solid #e0b34a; outline-offset: 2px; }
.hud-pause span {
  display: block;
  width: 3px; height: 12px;
  background: #efe7d6;
  box-shadow: 6px 0 0 #efe7d6;
  margin-right: 6px;
}
/* Top-left, clear of the health bar and the touch stick's usual landing zone. */
.hud-build {
  position: absolute;
  top: 14px; left: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-width: 46vw;
}
.hud-slot {
  position: relative;
  width: 30px; height: 30px;
  border-radius: 3px;
  background: rgba(20, 16, 12, 0.66);
  border: 1px solid rgba(239, 231, 214, 0.16);
}
.hud-slot[data-weapon='true'] { border-color: rgba(224, 179, 74, 0.5); }
.hud-slot img {
  width: 100%; height: 100%;
  display: block;
  image-rendering: pixelated;
}
/* The fallback when the icon renderer had no context to work with. */
.hud-slot-text {
  display: grid;
  place-items: center;
  width: 100%; height: 100%;
  font-size: 11px;
  color: #cfc4b2;
}
.hud-slot-level {
  position: absolute;
  right: -2px; bottom: -3px;
  min-width: 12px;
  padding: 0 2px;
  border-radius: 2px;
  background: rgba(12, 10, 8, 0.9);
  font-size: 9px;
  line-height: 13px;
  text-align: center;
  color: #e0b34a;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 520px) {
  .hud-slot { width: 25px; height: 25px; }
}
@media (prefers-reduced-motion: reduce) {
  .hud-xp-fill, .hud-health-fill { transition: none; }
}
`;

export function createHud(
  parent: HTMLElement = document.body,
  icons: ReadonlyMap<ItemIconId, string> = new Map(),
  onPause: (() => void) | null = null,
): Hud {
  const style = document.createElement('style');
  style.textContent = STYLE;
  parent.appendChild(style);

  const root = document.createElement('div');
  root.className = 'hud-root';
  root.innerHTML = `
    <div class="hud-hurt"></div>
    <div class="hud-xp"><div class="hud-xp-fill"></div></div>
    <div class="hud-top"><span class="hud-level"></span><span class="hud-time"></span></div>
    <div class="hud-build"></div>
    <button type="button" class="hud-pause" aria-label="${t('help.pause')}"><span></span></button>
    <div class="hud-health">
      <div class="hud-health-bar"><div class="hud-health-fill"></div></div>
      <span class="hud-health-text"></span>
    </div>
  `;
  parent.appendChild(root);

  const query = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`HUD is missing ${selector}`);
    return element;
  };

  const hurt = query('.hud-hurt');
  const xpFill = query('.hud-xp-fill');
  const level = query('.hud-level');
  const time = query('.hud-time');
  const healthFill = query('.hud-health-fill');
  const healthText = query('.hud-health-text');
  const build = query('.hud-build');

  const pause = query<HTMLButtonElement>('.hud-pause');
  if (onPause === null) pause.remove();
  else pause.addEventListener('click', onPause);

  // Remembered so the DOM is only touched when something changed; writing the same
  // string sixty times a second is layout work for nothing.
  let lastLevel = -1;
  let lastSecond = -1;
  let lastHealth = -1;

  return {
    update(state): void {
      xpFill.style.width = `${String(Math.round(state.experienceFraction * 100))}%`;

      if (state.level !== lastLevel) {
        lastLevel = state.level;
        level.textContent = `Sv ${String(state.level)}`;
      }

      const seconds = Math.floor(state.secondsElapsed);
      if (seconds !== lastSecond) {
        lastSecond = seconds;
        const minutes = Math.floor(seconds / 60);
        time.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }

      const rounded = Math.ceil(state.health);
      if (rounded !== lastHealth) {
        lastHealth = rounded;
        healthFill.style.width = `${String((state.health / state.maxHealth) * 100)}%`;
        healthText.textContent = `${String(rounded)} / ${String(Math.round(state.maxHealth))}`;
      }

      hurt.style.opacity = String(state.hurt);
    },

    setLoadout(items): void {
      // Weapons first, so the row reads as "what I fight with, then what helps".
      const ordered = [...items].sort((a, b) => Number(b.weapon) - Number(a.weapon));
      build.replaceChildren();

      for (const item of ordered) {
        const slot = document.createElement('div');
        slot.className = 'hud-slot';
        slot.dataset.weapon = String(item.weapon);
        slot.title = `${item.name} ${String(item.level)}`;

        const icon = icons.get(item.id);
        if (icon === undefined) {
          const text = document.createElement('span');
          text.className = 'hud-slot-text';
          text.textContent = item.name.slice(0, 1).toUpperCase();
          slot.appendChild(text);
        } else {
          const image = document.createElement('img');
          image.src = icon;
          image.alt = item.name;
          slot.appendChild(image);
        }

        const level = document.createElement('span');
        level.className = 'hud-slot-level';
        level.textContent = String(item.level);
        slot.appendChild(level);

        build.appendChild(slot);
      }
    },

    dispose(): void {
      root.remove();
      style.remove();
    },
  };
}
