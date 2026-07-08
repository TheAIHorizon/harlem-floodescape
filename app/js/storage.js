/* storage — namespaced localStorage wrapper (PRD §5.4).
 * Corrupted values never brick the app; quota errors return false.
 */
const PREFIX = "hfe.v1.";

export function loadKey(name, fallback) {
  try {
    const raw = globalThis.localStorage.getItem(PREFIX + name);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveKey(name, value) {
  try {
    globalThis.localStorage.setItem(PREFIX + name, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota exceeded or storage unavailable
  }
}

export function removeKey(name) {
  try {
    globalThis.localStorage.removeItem(PREFIX + name);
  } catch {
    /* ignore */
  }
}

/** Erase every hfe.v1.* key (PRD F-4: "Erase all my data"). */
export function wipeAll() {
  try {
    const doomed = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const k = globalThis.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => globalThis.localStorage.removeItem(k));
    return true;
  } catch {
    return false;
  }
}
