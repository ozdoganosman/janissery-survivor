import { LANGUAGE_IDS, type LanguageId } from './strings';

/**
 * What the player has chosen, and how it survives a reload.
 *
 * Two of these are accessibility rather than taste. Screen shake makes some people
 * motion sick, and a shake that cannot be switched off is a game they cannot play;
 * damage numbers are the same argument for visual noise. The quality tier is the
 * honest lever for a phone that cannot draw four hundred bodies — capping the crowd
 * degrades the wave, which is recoverable, instead of the frame rate, which is not.
 *
 * Everything is validated on the way in. `localStorage` is shared with every other
 * page on the origin and survives across versions, so a stored value is untrusted
 * input: a stale or hand-edited entry must produce the default, never a crash on boot
 * or a binding set with no way to move.
 */

export const QUALITY_IDS = ['low', 'medium', 'high'] as const;
export type QualityId = (typeof QUALITY_IDS)[number];

/** Crowd ceiling per tier. The wave table is still free to ask for less. */
export const QUALITY_ENEMY_LIMIT: Readonly<Record<QualityId, number>> = {
  low: 140,
  medium: 260,
  high: 0,
};

export const ACTION_IDS = ['up', 'down', 'left', 'right', 'pause'] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type Bindings = Readonly<Record<ActionId, readonly string[]>>;

export const DEFAULT_BINDINGS: Bindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  pause: ['Escape', 'KeyP'],
};

export interface Settings {
  language: LanguageId;
  screenShake: boolean;
  damageNumbers: boolean;
  quality: QualityId;
  bindings: Bindings;
}

const STORAGE_KEY = 'janissary.settings.v1';

export function defaultSettings(): Settings {
  return {
    language: 'tr',
    screenShake: true,
    damageNumbers: true,
    quality: 'high',
    bindings: { ...DEFAULT_BINDINGS },
  };
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/**
 * Turns whatever was stored into a usable settings object.
 *
 * Field by field rather than all-or-nothing: one bad entry from an older version
 * should cost that entry's value, not every other choice the player made.
 */
export function parseSettings(raw: unknown): Settings {
  const settings = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return settings;
  const record = raw as Record<string, unknown>;

  if (isOneOf(record.language, LANGUAGE_IDS)) settings.language = record.language;
  if (typeof record.screenShake === 'boolean') settings.screenShake = record.screenShake;
  if (typeof record.damageNumbers === 'boolean') settings.damageNumbers = record.damageNumbers;
  if (isOneOf(record.quality, QUALITY_IDS)) settings.quality = record.quality;

  if (typeof record.bindings === 'object' && record.bindings !== null) {
    const stored = record.bindings as Record<string, unknown>;
    const bindings: Record<ActionId, string[]> = { ...DEFAULT_BINDINGS } as Record<
      ActionId,
      string[]
    >;
    // Claimed across all actions, not just within one: a stored file where Escape both
    // pauses and walks left would pause every time the player retreated, and `bindKey`
    // relies on each key belonging to at most one action.
    //
    // Stored entries are read first and win their keys, then any action left on its
    // defaults gives up whichever of those a stored entry already took. An action that
    // would end up with nothing keeps its defaults instead — a duplicate is a nuisance,
    // a direction that cannot be walked is a run that cannot be played.
    const claimed = new Set<string>();
    const fromDefaults: ActionId[] = [];

    for (const action of ACTION_IDS) {
      const keys = Array.isArray(stored[action]) ? (stored[action] as unknown[]) : null;
      const clean =
        keys === null
          ? []
          : [
              ...new Set(
                keys.filter(
                  (key): key is string =>
                    typeof key === 'string' && key.length > 0 && !claimed.has(key),
                ),
              ),
            ];
      if (clean.length === 0) {
        fromDefaults.push(action);
        continue;
      }
      bindings[action] = clean;
      for (const key of clean) claimed.add(key);
    }

    for (const action of fromDefaults) {
      const kept = DEFAULT_BINDINGS[action].filter((key) => !claimed.has(key));
      bindings[action] = kept.length > 0 ? kept : [...DEFAULT_BINDINGS[action]];
      for (const key of bindings[action]) claimed.add(key);
    }
    settings.bindings = bindings;
  }

  return settings;
}

/** Reads the saved settings. Never throws: storage can be disabled or full. */
export function loadSettings(storage: Storage | null = safeStorage()): Settings {
  if (storage === null) return defaultSettings();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return defaultSettings();
    return parseSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

/** Writes the settings. Returns false when storage refused, which is not an error. */
export function saveSettings(settings: Settings, storage: Storage | null = safeStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    // Private browsing and a full quota both land here. Losing a preference is worth
    // strictly less than the run the player is in the middle of.
    return false;
  }
}

/**
 * `localStorage`, or null where it is unavailable.
 *
 * Touching the property itself throws in some privacy modes, so this cannot be a
 * plain reference.
 */
export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Which action a key code triggers, or null. Later bindings do not shadow earlier. */
export function actionForKey(bindings: Bindings, code: string): ActionId | null {
  for (const action of ACTION_IDS) {
    if (bindings[action].includes(code)) return action;
  }
  return null;
}

/**
 * Binds a key to an action, taking it away from whatever else held it.
 *
 * A swap, not an overwrite. Leaving the key on both actions would mean one key doing
 * two things, and the second is never the one the player meant; taking it away and
 * stopping there would leave the robbed action with nothing, so a single rebind could
 * strand the player facing one direction. So the action that loses its last key
 * receives the keys the target gave up — the two trade places, and every action always
 * has at least one key.
 */
export function bindKey(bindings: Bindings, action: ActionId, code: string): Bindings {
  const surrendered = [...bindings[action]].filter((key) => key !== code);
  const next: Record<ActionId, string[]> = {} as Record<ActionId, string[]>;

  for (const other of ACTION_IDS) {
    if (other === action) continue;
    const kept = bindings[other].filter((key) => key !== code);
    // `surrendered` is only empty if `action` held nothing but `code`, which means no
    // other action held it either and this branch is unreachable — except from a
    // hand-built duplicate, where keeping the old keys beats an empty binding.
    next[other] =
      kept.length > 0 ? kept : surrendered.length > 0 ? surrendered : [...bindings[other]];
  }
  next[action] = [code];
  return next;
}
