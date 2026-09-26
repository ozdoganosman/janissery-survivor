/**
 * Browser storage for saves and settings. Storage can be missing or refuse writes (a private
 * window, blocked site data, a full quota), so every access is guarded and the game plays
 * on without it.
 */

export function readJson(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to remove where nothing can be stored.
  }
}
