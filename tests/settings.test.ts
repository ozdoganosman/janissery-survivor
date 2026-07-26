import { describe, expect, it } from 'vitest';
import {
  ACTION_IDS,
  actionForKey,
  bindKey,
  DEFAULT_BINDINGS,
  defaultSettings,
  loadSettings,
  parseSettings,
  QUALITY_ENEMY_LIMIT,
  QUALITY_IDS,
  saveSettings,
  type Bindings,
} from '../src/core/settings';
import { LANGUAGE_IDS } from '../src/core/strings';

/** A `Storage` that lives in a Map, so the tests never touch a real browser store. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

/** A `Storage` that refuses everything, as private browsing does. */
function hostileStorage(): Storage {
  const refuse = (): never => {
    throw new DOMException('denied');
  };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

function everyKey(bindings: Bindings): string[] {
  return ACTION_IDS.flatMap((action) => [...bindings[action]]);
}

describe('defaults', () => {
  it('binds every action to at least one key', () => {
    for (const action of ACTION_IDS) {
      expect(DEFAULT_BINDINGS[action].length).toBeGreaterThan(0);
    }
  });

  it('never gives one key two jobs', () => {
    const keys = everyKey(DEFAULT_BINDINGS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('caps the crowd on the lower tiers and not on the highest', () => {
    expect(QUALITY_ENEMY_LIMIT.low).toBeGreaterThan(0);
    expect(QUALITY_ENEMY_LIMIT.medium).toBeGreaterThan(QUALITY_ENEMY_LIMIT.low);
    // Zero is "no ceiling"; a number here would silently cap the game everyone else
    // is meant to get.
    expect(QUALITY_ENEMY_LIMIT.high).toBe(0);
  });
});

describe('parseSettings', () => {
  it('returns the defaults for anything unusable', () => {
    for (const raw of [null, undefined, 4, 'settings', []]) {
      expect(parseSettings(raw)).toEqual(defaultSettings());
    }
  });

  it('keeps the fields it understands and defaults the rest', () => {
    const parsed = parseSettings({ language: 'en', quality: 'nonsense', screenShake: 'yes' });
    expect(parsed.language).toBe('en');
    expect(parsed.quality).toBe(defaultSettings().quality);
    expect(parsed.screenShake).toBe(defaultSettings().screenShake);
  });

  it('accepts every language and quality it advertises', () => {
    for (const language of LANGUAGE_IDS) {
      expect(parseSettings({ language }).language).toBe(language);
    }
    for (const quality of QUALITY_IDS) {
      expect(parseSettings({ quality }).quality).toBe(quality);
    }
  });

  it('reads stored bindings', () => {
    const parsed = parseSettings({ bindings: { up: ['KeyI'], down: ['KeyK'] } });
    expect(parsed.bindings.up).toEqual(['KeyI']);
    expect(parsed.bindings.down).toEqual(['KeyK']);
    expect(parsed.bindings.left).toEqual([...DEFAULT_BINDINGS.left]);
  });

  it('refuses an empty binding rather than storing one', () => {
    // A direction bound to nothing is a run the player cannot walk out of, and there
    // is no way back to the settings screen to undo it.
    const parsed = parseSettings({ bindings: { up: [], left: [null, 7] } });
    expect(parsed.bindings.up).toEqual([...DEFAULT_BINDINGS.up]);
    expect(parsed.bindings.left).toEqual([...DEFAULT_BINDINGS.left]);
  });

  it('drops junk inside an otherwise usable binding', () => {
    const parsed = parseSettings({ bindings: { up: ['KeyI', 3, '', 'KeyI'] } });
    expect(parsed.bindings.up).toEqual(['KeyI']);
  });

  it('never lets a stored file give one key two jobs', () => {
    // Escape both pausing and walking left would pause on every retreat.
    const parsed = parseSettings({ bindings: { left: ['Escape'], pause: ['Escape'] } });
    const keys = everyKey(parsed.bindings);
    expect(new Set(keys).size).toBe(keys.length);
    for (const action of ACTION_IDS) expect(parsed.bindings[action].length).toBeGreaterThan(0);
  });

  it('resolves a collision between a stored key and another default', () => {
    // "up" claims W; "left" is left on its defaults, which do not include W anyway,
    // but "down" claiming A must push "left" off it without emptying "left".
    const parsed = parseSettings({ bindings: { down: ['KeyA'] } });
    expect(parsed.bindings.down).toEqual(['KeyA']);
    expect(parsed.bindings.left).not.toContain('KeyA');
    expect(parsed.bindings.left.length).toBeGreaterThan(0);
    const keys = everyKey(parsed.bindings);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('always leaves every action playable, whatever it is given', () => {
    const nonsense = [
      { bindings: { up: ['KeyA'], down: ['KeyA'], left: ['KeyA'], right: ['KeyA'] } },
      { bindings: { up: 'KeyW' } },
      { bindings: { up: [], down: [], left: [], right: [], pause: [] } },
      { bindings: [] },
    ];
    for (const raw of nonsense) {
      const parsed = parseSettings(raw);
      for (const action of ACTION_IDS) {
        expect(parsed.bindings[action].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('bindKey', () => {
  it('gives the key to the action asked for', () => {
    const next = bindKey(DEFAULT_BINDINGS, 'up', 'KeyI');
    expect(next.up).toEqual(['KeyI']);
  });

  it('takes the key away from whatever held it', () => {
    const next = bindKey(DEFAULT_BINDINGS, 'up', 'KeyA');
    expect(next.up).toEqual(['KeyA']);
    expect(next.left).not.toContain('KeyA');
  });

  it('swaps rather than stranding, when the loser had only that key', () => {
    const start = bindKey(DEFAULT_BINDINGS, 'left', 'KeyA');
    expect(start.left).toEqual(['KeyA']);
    const next = bindKey(start, 'up', 'KeyA');
    expect(next.up).toEqual(['KeyA']);
    // Left gave up its last key and receives the ones up surrendered.
    expect(next.left.length).toBeGreaterThan(0);
    expect(next.left).not.toContain('KeyA');
  });

  it('leaves every action with a key, over a long chain of rebinds', () => {
    let bindings: Bindings = DEFAULT_BINDINGS;
    const codes = ['KeyI', 'KeyJ', 'KeyK', 'KeyL', 'KeyA', 'KeyW', 'Escape', 'KeyI'];
    for (let i = 0; i < codes.length; i++) {
      bindings = bindKey(bindings, ACTION_IDS[i % ACTION_IDS.length], codes[i]);
      for (const action of ACTION_IDS) {
        expect(bindings[action].length).toBeGreaterThan(0);
      }
      const keys = everyKey(bindings);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('is a no-op in effect when the action already owns the key alone', () => {
    const once = bindKey(DEFAULT_BINDINGS, 'up', 'KeyI');
    expect(bindKey(once, 'up', 'KeyI')).toEqual(once);
  });

  it('does not mutate what it was given', () => {
    const before = JSON.stringify(DEFAULT_BINDINGS);
    bindKey(DEFAULT_BINDINGS, 'up', 'KeyA');
    expect(JSON.stringify(DEFAULT_BINDINGS)).toBe(before);
  });
});

describe('actionForKey', () => {
  it('finds the action a key belongs to', () => {
    expect(actionForKey(DEFAULT_BINDINGS, 'KeyW')).toBe('up');
    expect(actionForKey(DEFAULT_BINDINGS, 'Escape')).toBe('pause');
  });

  it('returns null for an unbound key', () => {
    expect(actionForKey(DEFAULT_BINDINGS, 'KeyZ')).toBeNull();
  });
});

describe('storage', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const settings = defaultSettings();
    settings.language = 'en';
    settings.screenShake = false;
    settings.quality = 'low';
    settings.bindings = bindKey(settings.bindings, 'up', 'KeyI');

    expect(saveSettings(settings, storage)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings(fakeStorage())).toEqual(defaultSettings());
  });

  it('survives a corrupt entry', () => {
    const storage = fakeStorage({ 'janissary.settings.v1': '{not json' });
    expect(loadSettings(storage)).toEqual(defaultSettings());
  });

  it('survives storage being unavailable', () => {
    // Private browsing throws on access rather than returning null, and losing a
    // preference must never cost the player the run they are in.
    expect(() => loadSettings(hostileStorage())).not.toThrow();
    expect(loadSettings(hostileStorage())).toEqual(defaultSettings());
    expect(saveSettings(defaultSettings(), hostileStorage())).toBe(false);
    expect(loadSettings(null)).toEqual(defaultSettings());
    expect(saveSettings(defaultSettings(), null)).toBe(false);
  });
});
