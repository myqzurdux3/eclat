/**
 * Local storage, for settings that belong to this machine.
 *
 * Every read is checked and every write may fail: storage is disabled in
 * some contexts, and what comes back was written by an older version of the
 * application or edited by hand. A bad value must cost the caller its
 * default, never a crash — the same three lines were being written out at
 * each of eight call sites, and the one that skipped the check let a
 * corrupted rotation poison every panel coordinate with NaN.
 */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: the setting holds for this session only.
  }
}

/** Parsed JSON, or the fallback when there is nothing usable stored. */
export function readJson<T>(key: string, fallback: T): T | unknown {
  const raw = readText(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeText(key, JSON.stringify(value))
  } catch {
    // A value that will not serialise is not worth keeping.
  }
}
