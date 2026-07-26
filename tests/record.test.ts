import { describe, expect, it } from 'vitest';
import { EMPTY_RECORD, loadRecord, parseRecord, recordRun, saveRecord } from '../src/core/record';

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

describe('parseRecord', () => {
  it('returns an empty record for anything unusable', () => {
    for (const raw of [null, undefined, 7, 'best', []]) {
      expect(parseRecord(raw)).toEqual(EMPTY_RECORD);
    }
  });

  it('refuses a nonsensical time rather than storing it', () => {
    // A negative or NaN best would print as "NaN:NaN" and could never be beaten.
    for (const bestSeconds of [-5, Number.NaN, Number.POSITIVE_INFINITY, '90']) {
      expect(parseRecord({ bestSeconds }).bestSeconds).toBe(0);
    }
  });

  it('keeps a usable time', () => {
    expect(parseRecord({ bestSeconds: 412.5, won: true })).toEqual({
      bestSeconds: 412.5,
      won: true,
    });
  });

  it('treats anything but true as not yet won', () => {
    expect(parseRecord({ bestSeconds: 10, won: 'yes' }).won).toBe(false);
  });
});

describe('recordRun', () => {
  it('takes the longer run', () => {
    const { record, improved } = recordRun({ bestSeconds: 100, won: false }, 250, false);
    expect(record.bestSeconds).toBe(250);
    expect(improved).toBe(true);
  });

  it('keeps the old best when the run was shorter', () => {
    const { record, improved } = recordRun({ bestSeconds: 300, won: false }, 120, false);
    expect(record.bestSeconds).toBe(300);
    expect(improved).toBe(false);
  });

  it('does not count an equal run as an improvement', () => {
    expect(recordRun({ bestSeconds: 300, won: false }, 300, false).improved).toBe(false);
  });

  it('never takes a win back', () => {
    // A later, shorter run is not evidence that the earlier one did not happen.
    const after = recordRun({ bestSeconds: 900, won: true }, 60, false);
    expect(after.record.won).toBe(true);
  });

  it('records a win', () => {
    expect(recordRun(EMPTY_RECORD, 900, true).record.won).toBe(true);
  });

  it('ignores a nonsensical run length', () => {
    const { record, improved } = recordRun({ bestSeconds: 50, won: false }, Number.NaN, false);
    expect(record.bestSeconds).toBe(50);
    expect(improved).toBe(false);
  });

  it('does not mutate the record it was given', () => {
    const before = { bestSeconds: 100, won: false };
    recordRun(before, 500, true);
    expect(before).toEqual({ bestSeconds: 100, won: false });
  });
});

describe('storage', () => {
  it('round-trips', () => {
    const storage = fakeStorage();
    const record = { bestSeconds: 512, won: true };
    expect(saveRecord(record, storage)).toBe(true);
    expect(loadRecord(storage)).toEqual(record);
  });

  it('returns an empty record when nothing is stored or storage is gone', () => {
    expect(loadRecord(fakeStorage())).toEqual(EMPTY_RECORD);
    expect(loadRecord(null)).toEqual(EMPTY_RECORD);
    expect(saveRecord(EMPTY_RECORD, null)).toBe(false);
  });

  it('survives a corrupt entry', () => {
    expect(loadRecord(fakeStorage({ 'janissary.record.v1': 'not json' }))).toEqual(EMPTY_RECORD);
  });

  it('keeps the record separate from the settings key', () => {
    // Clearing or migrating one must never cost the other.
    const storage = fakeStorage();
    saveRecord({ bestSeconds: 100, won: false }, storage);
    expect(storage.getItem('janissary.settings.v1')).toBeNull();
    expect(storage.getItem('janissary.record.v1')).not.toBeNull();
  });
});
