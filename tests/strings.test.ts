import { afterEach, describe, expect, it } from 'vitest';
import {
  entryOf,
  getLanguage,
  LANGUAGE_IDS,
  LANGUAGE_NAMES,
  setLanguage,
  STRING_IDS,
  t,
} from '../src/core/strings';
import { keyLabel } from '../src/ui/shell';

afterEach(() => {
  setLanguage('tr');
});

describe('the string table', () => {
  it('has an entry in every language for every id', () => {
    // A missing column is a screen that silently reads half in one language.
    for (const id of STRING_IDS) {
      for (const language of LANGUAGE_IDS) {
        expect(entryOf(id)[language], `${id}.${language}`).toBeTruthy();
      }
    }
  });

  it('names every language it offers', () => {
    for (const language of LANGUAGE_IDS) {
      expect(LANGUAGE_NAMES[language]).toBeTruthy();
    }
  });

  it('is not empty', () => {
    expect(STRING_IDS.length).toBeGreaterThan(20);
  });

  it('keeps the two columns distinct for at least most entries', () => {
    // A handful legitimately match (a proper noun, a number). If nearly all do, the
    // second column was never filled in.
    const same = STRING_IDS.filter((id) => entryOf(id).tr === entryOf(id).en).length;
    expect(same / STRING_IDS.length).toBeLessThan(0.2);
  });
});

describe('t', () => {
  it('follows the selected language', () => {
    setLanguage('tr');
    expect(t('menu.start')).toBe('Başla');
    setLanguage('en');
    expect(t('menu.start')).toBe('Start');
  });

  it('reports the language it is using', () => {
    setLanguage('en');
    expect(getLanguage()).toBe('en');
  });

  it('returns a readable string in every language, for every id', () => {
    for (const language of LANGUAGE_IDS) {
      setLanguage(language);
      for (const id of STRING_IDS) {
        const text = t(id);
        expect(text.length, `${id}.${language}`).toBeGreaterThan(0);
        // A lookup that fell through would show the id itself.
        expect(text).not.toBe(id);
      }
    }
  });

  it('keeps the placeholder the level-up screen substitutes', () => {
    for (const language of LANGUAGE_IDS) {
      setLanguage(language);
      expect(t('levelup.key')).toContain('{n}');
    }
  });
});

describe('keyLabel', () => {
  it('names a letter key by its letter', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
  });

  it('draws the arrows', () => {
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('ArrowLeft')).toBe('←');
  });

  it('gives the named keys their common names', () => {
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
  });

  it('falls back to the code rather than to nothing', () => {
    // Better a stack-trace-looking label than a blank chip the player cannot read.
    expect(keyLabel('IntlBackslash')).toBe('IntlBackslash');
    expect(keyLabel('')).toBe('');
  });
});
