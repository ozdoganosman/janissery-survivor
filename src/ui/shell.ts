import {
  ACTION_IDS,
  bindKey,
  DEFAULT_BINDINGS,
  QUALITY_IDS,
  saveSettings,
  type ActionId,
  type QualityId,
  type Settings,
} from '../core/settings';
import { LANGUAGE_IDS, LANGUAGE_NAMES, setLanguage, t, type LanguageId } from '../core/strings';

/**
 * Everything wrapped around a run: the title screen, pause, settings and the rules.
 *
 * One module rather than four, because they are one thing — a stack of panels over a
 * stopped game, sharing a look, a keyboard trap and the single question the scene
 * actually asks: may the simulation advance? Splitting them would mean four copies of
 * that question and four chances for the answer to disagree.
 *
 * The scene owns the run; the shell owns everything that is not the run.
 */

export type ShellMode = 'menu' | 'playing' | 'paused' | 'settings' | 'help';

export interface ShellHooks {
  /** Leaving the title screen for the first time. */
  onStart(): void;
  /** Leaving pause. */
  onResume(): void;
  /** Abandoning the run. */
  onQuit(): void;
  /** A setting changed. The scene applies what it can without a reload. */
  onSettingsChanged(settings: Settings): void;
}

export interface Shell {
  readonly mode: ShellMode;
  /** True while the simulation must not advance. */
  readonly blocking: boolean;
  /** Esc, P, or the pad's start button. Toggles pause, or backs out of a panel. */
  togglePause(): void;
  dispose(): void;
}

const STYLE = `
.sh-root {
  position: fixed;
  inset: 0;
  z-index: 220;
  display: grid;
  place-items: center;
  padding: 24px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #efe7d6;
  background: rgba(8, 6, 5, 0.88);
  overflow-y: auto;
}
/* The hidden attribute hides through a user-agent rule that any author display
   declaration outranks. Without this the panel stops showing text and keeps painting
   a near-opaque wash over the game. */
.sh-root[hidden] { display: none; }
.sh-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  width: min(420px, 100%);
  margin: auto;
}
.sh-title {
  margin: 0;
  font-size: clamp(22px, 6vw, 32px);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #e0b34a;
  text-align: center;
  text-wrap: balance;
}
.sh-tagline { margin: -8px 0 0; font-size: 12px; color: #8d8175; letter-spacing: 0.12em; }
.sh-heading {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #e0b34a;
}
.sh-actions { display: flex; flex-direction: column; gap: 9px; width: 100%; }
.sh-button {
  appearance: none;
  font: inherit;
  font-size: 13px;
  letter-spacing: 0.12em;
  color: #efe7d6;
  background: rgba(40, 32, 26, 0.9);
  border: 1px solid rgba(224, 179, 74, 0.4);
  border-radius: 3px;
  padding: 12px 18px;
  cursor: pointer;
  text-align: center;
}
.sh-button:hover { background: rgba(60, 47, 36, 0.95); }
.sh-button:focus-visible { outline: 2px solid #e0b34a; outline-offset: 3px; }
.sh-button[data-primary] { background: #b8392c; border-color: #b8392c; }
.sh-button[data-primary]:hover { background: #cc4234; }
.sh-rows { display: flex; flex-direction: column; gap: 10px; width: 100%; font-size: 12px; }
.sh-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sh-row-label { color: #b9ad9c; letter-spacing: 0.06em; }
.sh-choice { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
.sh-chip {
  appearance: none;
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: #b9ad9c;
  background: rgba(30, 25, 20, 0.9);
  border: 1px solid rgba(239, 231, 214, 0.16);
  border-radius: 3px;
  padding: 7px 11px;
  cursor: pointer;
  min-width: 56px;
}
.sh-chip[aria-pressed='true'] { color: #100d0a; background: #e0b34a; border-color: #e0b34a; }
.sh-chip:focus-visible { outline: 2px solid #e0b34a; outline-offset: 2px; }
.sh-chip[data-listening='true'] { color: #efe7d6; background: #b8392c; border-color: #b8392c; }
.sh-note { margin: 0; font-size: 11px; color: #8d8175; line-height: 1.6; text-align: center; }
.sh-help { display: flex; flex-direction: column; gap: 12px; width: 100%; font-size: 12px; }
.sh-help-term { color: #e0b34a; letter-spacing: 0.1em; }
.sh-help-body { margin: 3px 0 0; color: #cfc4b2; line-height: 1.65; }
`;

interface Options {
  readonly settings: Settings;
  readonly hooks: ShellHooks;
  /** Skips the title screen — used by "play again", which has already been asked. */
  readonly startImmediately?: boolean;
  readonly parent?: HTMLElement;
}

export function createShell(options: Options): Shell {
  const parent = options.parent ?? document.body;
  const settings = options.settings;

  const style = document.createElement('style');
  style.textContent = STYLE;
  parent.appendChild(style);

  const root = document.createElement('div');
  root.className = 'sh-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  parent.appendChild(root);

  let mode: ShellMode = options.startImmediately === true ? 'playing' : 'menu';
  /** Where "back" returns to. Settings is reachable from both the title and pause. */
  let returnTo: 'menu' | 'paused' = 'menu';
  /** The action waiting for a keypress, or null. */
  let listening: ActionId | null = null;

  const button = (label: string, onClick: () => void, primary = false): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'sh-button';
    element.textContent = label;
    if (primary) element.dataset.primary = 'true';
    element.addEventListener('click', onClick);
    return element;
  };

  /** A labelled row of mutually exclusive chips. */
  const choiceRow = <T extends string>(
    label: string,
    values: readonly T[],
    labelOf: (value: T) => string,
    selected: T,
    onPick: (value: T) => void,
  ): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'sh-row';
    const name = document.createElement('span');
    name.className = 'sh-row-label';
    name.textContent = label;
    const choice = document.createElement('div');
    choice.className = 'sh-choice';
    for (const value of values) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sh-chip';
      chip.textContent = labelOf(value);
      chip.setAttribute('aria-pressed', String(value === selected));
      chip.addEventListener('click', () => {
        onPick(value);
      });
      choice.appendChild(chip);
    }
    row.append(name, choice);
    return row;
  };

  const commit = (): void => {
    saveSettings(settings);
    options.hooks.onSettingsChanged(settings);
    render();
  };

  const go = (next: ShellMode): void => {
    mode = next;
    listening = null;
    render();
  };

  const renderMenu = (panel: HTMLElement): void => {
    const title = document.createElement('h1');
    title.className = 'sh-title';
    title.textContent = t('game.title');
    const tagline = document.createElement('p');
    tagline.className = 'sh-tagline';
    tagline.textContent = t('game.tagline');

    const actions = document.createElement('div');
    actions.className = 'sh-actions';
    actions.append(
      button(
        t('menu.start'),
        () => {
          go('playing');
          options.hooks.onStart();
        },
        true,
      ),
      button(t('menu.help'), () => {
        returnTo = 'menu';
        go('help');
      }),
      button(t('menu.settings'), () => {
        returnTo = 'menu';
        go('settings');
      }),
    );
    panel.append(title, tagline, actions);
  };

  const renderPause = (panel: HTMLElement): void => {
    const heading = document.createElement('h2');
    heading.className = 'sh-heading';
    heading.textContent = t('pause.title');

    const actions = document.createElement('div');
    actions.className = 'sh-actions';
    actions.append(
      button(
        t('menu.resume'),
        () => {
          go('playing');
          options.hooks.onResume();
        },
        true,
      ),
      button(t('menu.help'), () => {
        returnTo = 'paused';
        go('help');
      }),
      button(t('menu.settings'), () => {
        returnTo = 'paused';
        go('settings');
      }),
      button(t('menu.quit'), () => {
        options.hooks.onQuit();
      }),
    );
    panel.append(heading, actions);
  };

  const renderHelp = (panel: HTMLElement): void => {
    const heading = document.createElement('h2');
    heading.className = 'sh-heading';
    heading.textContent = t('help.title');

    const list = document.createElement('div');
    list.className = 'sh-help';
    const entries: [string, string][] = [
      [t('help.move'), `${t('help.moveKeys')}\n${t('help.moveTouch')}`],
      [t('help.pause'), t('help.pauseKeys')],
      [t('help.attack'), t('help.attackBody')],
      [t('help.gems'), t('help.gemsBody')],
      [t('help.goal'), t('help.goalBody')],
    ];
    for (const [term, body] of entries) {
      const block = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'sh-help-term';
      name.textContent = term;
      const text = document.createElement('p');
      text.className = 'sh-help-body';
      text.textContent = body;
      text.style.whiteSpace = 'pre-line';
      block.append(name, text);
      list.appendChild(block);
    }

    const actions = document.createElement('div');
    actions.className = 'sh-actions';
    actions.appendChild(
      button(t('menu.back'), () => {
        go(returnTo);
      }),
    );
    panel.append(heading, list, actions);
  };

  const renderSettings = (panel: HTMLElement): void => {
    const heading = document.createElement('h2');
    heading.className = 'sh-heading';
    heading.textContent = t('settings.title');

    const rows = document.createElement('div');
    rows.className = 'sh-rows';

    rows.appendChild(
      choiceRow<LanguageId>(
        t('settings.language'),
        LANGUAGE_IDS,
        (id) => LANGUAGE_NAMES[id],
        settings.language,
        (id) => {
          settings.language = id;
          setLanguage(id);
          commit();
        },
      ),
    );

    const toggle = (label: string, value: boolean, apply: (next: boolean) => void): HTMLElement =>
      choiceRow<'on' | 'off'>(
        label,
        ['on', 'off'],
        (v) => (v === 'on' ? t('toggle.on') : t('toggle.off')),
        value ? 'on' : 'off',
        (v) => {
          apply(v === 'on');
          commit();
        },
      );

    rows.append(
      toggle(t('settings.shake'), settings.screenShake, (next) => (settings.screenShake = next)),
      toggle(
        t('settings.damageNumbers'),
        settings.damageNumbers,
        (next) => (settings.damageNumbers = next),
      ),
      choiceRow<QualityId>(
        t('settings.quality'),
        QUALITY_IDS,
        (id) => t(`quality.${id}`),
        settings.quality,
        (id) => {
          settings.quality = id;
          commit();
        },
      ),
    );

    const qualityNote = document.createElement('p');
    qualityNote.className = 'sh-note';
    qualityNote.textContent = t('settings.qualityNote');

    const bindingHeading = document.createElement('h2');
    bindingHeading.className = 'sh-heading';
    bindingHeading.textContent = t('settings.bindings');

    const bindings = document.createElement('div');
    bindings.className = 'sh-rows';
    for (const action of ACTION_IDS) {
      const row = document.createElement('div');
      row.className = 'sh-row';
      const name = document.createElement('span');
      name.className = 'sh-row-label';
      name.textContent = t(`action.${action}`);

      const choice = document.createElement('div');
      choice.className = 'sh-choice';
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'sh-chip';
      const waiting = listening === action;
      chip.dataset.listening = String(waiting);
      chip.textContent = waiting
        ? t('settings.listening')
        : settings.bindings[action].map(keyLabel).join(' / ');
      chip.addEventListener('click', () => {
        listening = listening === action ? null : action;
        render();
      });
      choice.appendChild(chip);
      row.append(name, choice);
      bindings.appendChild(row);
    }

    const bindingNote = document.createElement('p');
    bindingNote.className = 'sh-note';
    bindingNote.textContent = t('settings.bindingHint');

    const actions = document.createElement('div');
    actions.className = 'sh-actions';
    actions.append(
      button(t('settings.reset'), () => {
        settings.bindings = { ...DEFAULT_BINDINGS };
        listening = null;
        commit();
      }),
      button(t('menu.back'), () => {
        go(returnTo);
      }),
    );

    panel.append(heading, rows, qualityNote, bindingHeading, bindings, bindingNote, actions);
  };

  function render(): void {
    if (mode === 'playing') {
      root.hidden = true;
      root.replaceChildren();
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'sh-panel';
    switch (mode) {
      case 'menu':
        renderMenu(panel);
        break;
      case 'paused':
        renderPause(panel);
        break;
      case 'help':
        renderHelp(panel);
        break;
      case 'settings':
        renderSettings(panel);
        break;
    }

    root.replaceChildren(panel);
    root.hidden = false;
    // Focus the first control, so the panel is operable from the keyboard the moment
    // it opens rather than after a hunt with Tab.
    panel.querySelector<HTMLElement>('button')?.focus();
  }

  const togglePause = (): void => {
    switch (mode) {
      case 'playing':
        go('paused');
        break;
      case 'paused':
        go('playing');
        options.hooks.onResume();
        break;
      case 'settings':
      case 'help':
        go(returnTo);
        break;
      case 'menu':
        // Nothing to back out to.
        break;
    }
  };

  /**
   * Captures the next keypress while rebinding.
   *
   * On the capture phase and on `window`, so it runs before the input layer sees the
   * key — otherwise binding W to "left" would also walk the player forward, and
   * binding Escape would close the panel it was pressed in.
   */
  const onKeyDown = (event: KeyboardEvent): void => {
    if (listening === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code !== 'Escape') {
      settings.bindings = bindKey(settings.bindings, listening, event.code);
    }
    listening = null;
    commit();
  };
  window.addEventListener('keydown', onKeyDown, true);

  render();

  return {
    get mode() {
      return mode;
    },
    get blocking() {
      return mode !== 'playing';
    },
    togglePause,
    dispose(): void {
      window.removeEventListener('keydown', onKeyDown, true);
      root.remove();
      style.remove();
    },
  };
}

/**
 * A key code as something a player recognises.
 *
 * `KeyW` and `ArrowUp` are DOM identifiers, not names — showing them raw makes the
 * rebinding screen read like a stack trace.
 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) {
    const arrows: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };
    return arrows[code.slice(5)] ?? code;
  }
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Tab: 'Tab',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
  };
  return named[code] ?? code;
}
