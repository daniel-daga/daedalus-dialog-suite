/**
 * A `Map` whose insertion order is recency, capped at `capacity` entries.
 *
 * `get` and `set` both move the entry to the tail; once `size` passes the cap
 * the head — the least recently used — is dropped. Everything else is the
 * plain `Map` API. Shared by `ProjectService.primedModels` and `FileService`'s
 * per-path caches.
 */
export class LruMap<K, V> extends Map<K, V> {
  constructor(private readonly capacity: number) {
    super();
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.capacity) {
      const oldest = this.keys().next().value;
      if (oldest === undefined) break;
      super.delete(oldest);
    }
    return this;
  }
}
