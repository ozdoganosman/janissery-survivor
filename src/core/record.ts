import { safeStorage } from './settings';

/**
 * The only thing a run leaves behind.
 *
 * Deliberately one number. Meta-progression is out of scope for the MVP, and a record
 * that unlocked something would be meta-progression by another name — this is a mark
 * on the wall, nothing the next run inherits.
 *
 * Stored apart from the settings so that clearing one never costs the other, and so a
 * settings-schema change cannot take the record with it.
 */

const STORAGE_KEY = 'janissary.record.v1';

export interface RunRecord {
  /** Longest run in seconds. */
  readonly bestSeconds: number;
  /** Whether a run has ever been survived to the end. */
  readonly won: boolean;
}

export const EMPTY_RECORD: RunRecord = { bestSeconds: 0, won: false };

export function parseRecord(raw: unknown): RunRecord {
  if (typeof raw !== 'object' || raw === null) return EMPTY_RECORD;
  const record = raw as Record<string, unknown>;
  const seconds = record.bestSeconds;
  return {
    bestSeconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
    won: record.won === true,
  };
}

export function loadRecord(storage: Storage | null = safeStorage()): RunRecord {
  if (storage === null) return EMPTY_RECORD;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? EMPTY_RECORD : parseRecord(JSON.parse(raw));
  } catch {
    return EMPTY_RECORD;
  }
}

/**
 * Folds a finished run into the record.
 *
 * Returns the new record and whether it improved, because the summary screen wants to
 * say so and only the comparison knows.
 */
export function recordRun(
  previous: RunRecord,
  seconds: number,
  survived: boolean,
): { record: RunRecord; improved: boolean } {
  const clean = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const improved = clean > previous.bestSeconds;
  return {
    record: {
      bestSeconds: Math.max(previous.bestSeconds, clean),
      // Once survived, always survived; a later shorter run does not take it back.
      won: previous.won || survived,
    },
    improved,
  };
}

export function saveRecord(record: RunRecord, storage: Storage | null = safeStorage()): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
