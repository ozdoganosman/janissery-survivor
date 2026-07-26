/**
 * The screen at the end of a run.
 *
 * A run that simply stops teaches nothing. The summary is where the player finds out
 * how far they got and what they were carrying when it ended — which is the only way
 * the next run's choices can be made differently on purpose.
 */

export interface RunSummary {
  readonly survived: boolean;
  readonly seconds: number;
  readonly level: number;
  readonly kills: number;
  readonly weapons: readonly string[];
  readonly passives: readonly string[];
}

export interface SummaryScreen {
  readonly visible: boolean;
  show(summary: RunSummary, onRestart: () => void): void;
  hide(): void;
  dispose(): void;
}

const STYLE = `
.sm-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 16px;
  padding: 24px;
  background: rgba(8, 6, 5, 0.9);
  z-index: 210;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #efe7d6;
  text-align: center;
}
/* The hidden attribute hides through a user-agent rule, and any author display
   declaration beats it. Without this the panel never goes away — it stops showing
   text but keeps painting a near-opaque wash over the game. */
.sm-overlay[hidden] { display: none; }
.sm-verdict {
  font-size: 22px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.sm-verdict[data-outcome='won'] { color: #e0b34a; }
.sm-verdict[data-outcome='lost'] { color: #b8392c; }
.sm-stats {
  display: grid;
  grid-template-columns: auto auto;
  gap: 6px 18px;
  justify-content: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.sm-label { color: #8d8175; text-align: right; }
.sm-value { text-align: left; }
.sm-build { font-size: 12px; color: #b9ad9c; line-height: 1.7; max-width: 340px; }
.sm-restart {
  justify-self: center;
  appearance: none;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: #efe7d6;
  background: #b8392c;
  border: 1px solid #b8392c;
  border-radius: 3px;
  padding: 10px 22px;
  cursor: pointer;
}
.sm-restart:focus-visible { outline: 2px solid #e0b34a; outline-offset: 3px; }
`;

export function createSummaryScreen(parent: HTMLElement = document.body): SummaryScreen {
  const style = document.createElement('style');
  style.textContent = STYLE;
  parent.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'sm-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  parent.appendChild(overlay);

  let visible = false;

  return {
    get visible() {
      return visible;
    },

    show(summary, onRestart): void {
      const minutes = Math.floor(summary.seconds / 60);
      const seconds = Math.floor(summary.seconds % 60);
      const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

      overlay.replaceChildren();

      const verdict = document.createElement('p');
      verdict.className = 'sm-verdict';
      verdict.dataset.outcome = summary.survived ? 'won' : 'lost';
      verdict.textContent = summary.survived ? 'Hayatta kaldın' : 'Düştün';

      const stats = document.createElement('div');
      stats.className = 'sm-stats';
      const rows: [string, string][] = [
        ['Süre', clock],
        ['Seviye', String(summary.level)],
        ['Öldürme', String(summary.kills)],
      ];
      for (const [label, value] of rows) {
        const key = document.createElement('span');
        key.className = 'sm-label';
        key.textContent = label;
        const val = document.createElement('span');
        val.className = 'sm-value';
        val.textContent = value;
        stats.append(key, val);
      }

      const build = document.createElement('p');
      build.className = 'sm-build';
      const weapons = summary.weapons.length > 0 ? summary.weapons.join(', ') : '—';
      const passives = summary.passives.length > 0 ? summary.passives.join(', ') : '—';
      build.textContent = `Silahlar: ${weapons}\nEşyalar: ${passives}`;
      build.style.whiteSpace = 'pre-line';

      const restart = document.createElement('button');
      restart.type = 'button';
      restart.className = 'sm-restart';
      restart.textContent = 'Yeniden başla';
      restart.addEventListener('click', onRestart);

      overlay.append(verdict, stats, build, restart);
      overlay.hidden = false;
      visible = true;
      restart.focus();
    },

    hide(): void {
      overlay.hidden = true;
      visible = false;
      overlay.replaceChildren();
    },

    dispose(): void {
      overlay.remove();
      style.remove();
    },
  };
}
