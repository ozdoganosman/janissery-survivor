/**
 * Health, experience and the run clock.
 *
 * Minimal on purpose — the full interface belongs to a later phase. But health that
 * cannot be seen is health that cannot be managed, and this phase is the one that
 * made the player killable, so the bare minimum has to ship with it.
 *
 * The bars are absolute rather than fractional. "Sixty of a hundred" tells the player
 * how many more contacts they can survive; a bar that is "60% full" does not.
 */

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
@media (prefers-reduced-motion: reduce) {
  .hud-xp-fill, .hud-health-fill { transition: none; }
}
`;

export function createHud(parent: HTMLElement = document.body): Hud {
  const style = document.createElement('style');
  style.textContent = STYLE;
  parent.appendChild(style);

  const root = document.createElement('div');
  root.className = 'hud-root';
  root.innerHTML = `
    <div class="hud-hurt"></div>
    <div class="hud-xp"><div class="hud-xp-fill"></div></div>
    <div class="hud-top"><span class="hud-level"></span><span class="hud-time"></span></div>
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

    dispose(): void {
      root.remove();
      style.remove();
    },
  };
}
