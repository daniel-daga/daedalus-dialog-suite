/**
 * Helpers for round-tripping Maps through the IPC layer.
 *
 * Electron's IPC serialises values with the structured-clone algorithm, which
 * does preserve Maps — but only when both sides support it.  In practice the
 * renderer may receive a plain object when the main process serialised the Map
 * via JSON (e.g. older Electron or a custom serialiser).  This helper handles
 * both forms transparently.
 */

/**
 * Convert a value that arrived over IPC back into a typed Map.
 * Accepts:
 *   - an existing Map (returned as-is after copying),
 *   - a plain object (each own-enumerable key becomes a map entry),
 *   - null / undefined (returns an empty Map).
 */
export function deserialiseIpcMap<K extends string | number, V>(
  raw: Map<K, V> | Record<string, V> | null | undefined
): Map<K, V> {
  const map = new Map<K, V>();
  if (!raw) return map;

  if (raw instanceof Map) {
    raw.forEach((value, key) => map.set(key, value));
  } else {
    Object.entries(raw).forEach(([key, value]) => {
      map.set(key as unknown as K, value);
    });
  }

  return map;
}
