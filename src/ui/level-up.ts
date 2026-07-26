import { t } from '../core/strings';

import type { Card } from '../sim/loadout';

/**
 * The card screen.
 *
 * The moment the run is actually about. Everything else is executed by the player's
 * thumb; this is the only place they make a decision, so it stops the world rather
 * than overlaying a live fight — being killed while reading a choice would teach the
 * player to stop reading.
 *
 * Plain DOM rather than in-canvas UI: text needs to be selectable by a screen reader,
 * scale with the viewport, and stay crisp on a phone, and none of that is worth
 * rebuilding on top of WebGL.
 */

export interface LevelUpScreen {
  readonly visible: boolean;
  /** Shows the choices and calls back exactly once with the chosen index. */
  show(level: number, cards: readonly Card[], choose: (index: number) => void): void;
  hide(): void;
  dispose(): void;
}

const STYLE = `
.ju-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 18px;
  padding: 20px;
  background: rgba(10, 8, 6, 0.78);
  backdrop-filter: blur(2px);
  z-index: 200;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #efe7d6;
}
/* The hidden attribute hides an element through a user-agent rule, and any author
   display declaration beats it. Without this the overlay never actually goes away:
   it stops showing cards but keeps painting a 78% black wash and a blur over the
   whole game, which reads as a broken renderer rather than as a stuck dialog. */
.ju-overlay[hidden] {
  display: none;
}
.ju-title {
  text-align: center;
  font-size: 13px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #e0b34a;
}
.ju-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}
.ju-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 190px;
  padding: 16px 14px;
  text-align: left;
  background: #1f1913;
  border: 1px solid #37291d;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: border-color 120ms ease, transform 120ms ease;
}
.ju-card:hover, .ju-card:focus-visible {
  border-color: #b8392c;
  transform: translateY(-2px);
  outline: none;
}
.ju-card:focus-visible { box-shadow: 0 0 0 2px #e0b34a; }
.ju-key {
  font-size: 10px;
  letter-spacing: 0.18em;
  color: #8d8175;
}
.ju-name { font-size: 15px; font-weight: 600; }
.ju-desc { font-size: 12px; line-height: 1.5; color: #b9ad9c; }
.ju-kind { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #8d8175; }
@media (max-width: 700px) {
  .ju-card { width: min(85vw, 260px); padding: 12px; }
  .ju-cards { gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .ju-card { transition: none; }
  .ju-card:hover, .ju-card:focus-visible { transform: none; }
}
`;

export function createLevelUpScreen(parent: HTMLElement = document.body): LevelUpScreen {
  const style = document.createElement('style');
  style.textContent = STYLE;
  parent.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ju-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const title = document.createElement('p');
  title.className = 'ju-title';
  const row = document.createElement('div');
  row.className = 'ju-cards';
  overlay.append(title, row);
  parent.appendChild(overlay);

  let visible = false;
  let pending: ((index: number) => void) | null = null;

  const resolve = (index: number): void => {
    // Cleared before calling back: a second click while the callback runs would apply
    // two upgrades for one level.
    const callback = pending;
    pending = null;
    if (callback !== null) callback(index);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!visible) return;
    const index = Number.parseInt(event.key, 10) - 1;
    if (Number.isNaN(index)) return;
    if (index < 0 || index >= row.children.length) return;
    event.preventDefault();
    resolve(index);
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    get visible() {
      return visible;
    },

    show(level, cards, choose): void {
      pending = choose;
      title.textContent = `${t('levelup.title')} ${String(level)} - ${t('levelup.pick')}`;
      row.replaceChildren();

      cards.forEach((card, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ju-card';

        const key = document.createElement('span');
        key.className = 'ju-key';
        key.textContent = t('levelup.key').replace('{n}', String(index + 1));

        const kind = document.createElement('span');
        kind.className = 'ju-kind';
        kind.textContent =
          card.kind === 'weapon'
            ? t('card.weapon')
            : card.kind === 'passive'
              ? t('card.item')
              : t('card.treat');

        const name = document.createElement('span');
        name.className = 'ju-name';
        name.textContent = card.name;

        const describe = document.createElement('span');
        describe.className = 'ju-desc';
        describe.textContent = card.describe;

        button.append(key, kind, name, describe);
        button.addEventListener('click', () => {
          resolve(index);
        });
        row.appendChild(button);
      });

      overlay.hidden = false;
      visible = true;
      // Focused so the choice is reachable by keyboard alone, and so a controller's
      // d-pad has somewhere to land.
      (row.firstElementChild as HTMLElement | null)?.focus();
    },

    hide(): void {
      overlay.hidden = true;
      visible = false;
      pending = null;
      row.replaceChildren();
    },

    dispose(): void {
      window.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      style.remove();
    },
  };
}
