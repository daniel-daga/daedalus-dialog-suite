/**
 * Case-insensitive name helpers.
 *
 * Daedalus identifiers are case-insensitive, so symbol lookups and reference
 * comparisons must ignore case while still preserving the original source
 * casing in the model (fidelity by construction).
 */

/**
 * Compare two identifier names case-insensitively. Nullish inputs only match
 * when strictly equal (both nullish of the same kind).
 */
export function namesEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (a == null || b == null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

// Per-map lazily built lowercase→canonical index. Keyed by the map object via a
// WeakMap so recreated models get their own fresh index and stale entries are
// garbage-collected with the model.
const lowercaseIndexCache = new WeakMap<object, Map<string, string>>();

/**
 * Resolve a value from a record keyed by identifier name, ignoring case. Returns
 * the value stored under the canonical (original-cased) key, or undefined.
 */
export function resolveCaseInsensitive<T>(map: Record<string, T> | undefined, name: string): T | undefined {
  if (!map) return undefined;
  // Fast path: exact-case hit (the common case) avoids building the index.
  const exact = map[name];
  if (exact !== undefined) return exact;

  let index = lowercaseIndexCache.get(map);
  if (!index) {
    index = new Map<string, string>();
    for (const key of Object.keys(map)) {
      index.set(key.toLowerCase(), key);
    }
    lowercaseIndexCache.set(map, index);
  }
  const canonicalKey = index.get(name.toLowerCase());
  return canonicalKey !== undefined ? map[canonicalKey] : undefined;
}
