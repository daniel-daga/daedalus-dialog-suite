/**
 * The one LRU idiom behind `ProjectService.primedModels` and `FileService`'s
 * encoding/mtime caches: a `Map` whose insertion order is recency, capped.
 */

import { LruMap } from '../src/main/utils/lruMap';

describe('LruMap', () => {
  it('evicts the least recently used entry once the cap is passed', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    expect(map.has('a')).toBe(false);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('a get refreshes the entry', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    expect(map.get('a')).toBe(1);
    map.set('c', 3);

    expect(map.has('a')).toBe(true);
    expect(map.has('b')).toBe(false);
  });

  it('a set on an existing key refreshes it rather than growing the map', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    map.set('b', 2);
    map.set('a', 10);
    map.set('c', 3);

    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(10);
    expect(map.has('b')).toBe(false);
  });

  it('a miss neither inserts nor reorders', () => {
    const map = new LruMap<string, number>(2);
    map.set('a', 1);
    expect(map.get('zzz')).toBeUndefined();
    expect(map.size).toBe(1);
  });
});
