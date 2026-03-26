import { useCallback, useRef } from 'react';
import type { DialogFunction, FunctionTreeNode, FunctionTreeChild, ChoiceAction } from '../../types/global';

/** Maximum number of entries to keep in the LRU function-tree cache. */
const MAX_CACHE_SIZE = 1000;

/**
 * Builds and caches the recursive choice-function tree for the dialog tree view.
 *
 * Uses an LRU Map cache keyed by `funcName|ancestorPath` so that:
 *  - diamond patterns (two paths reaching the same node) are each cached under
 *    their own context key, preventing stale results,
 *  - the cache is bounded to MAX_CACHE_SIZE entries to prevent unbounded growth.
 *
 * Reference-equality is used for invalidation: if the `DialogFunction` object
 * stored for a key has the same reference as the one in `functions`, the cached
 * node is returned immediately without rebuilding.
 */
export function useFunctionTreeBuilder(
  functions: Record<string, DialogFunction> | undefined
): (funcName: string, ancestorPath?: string[]) => FunctionTreeNode | null {
  const cacheRef = useRef<Map<string, FunctionTreeNode | null>>(new Map());

  // LRU get: moves the entry to the end (most recently used).
  const lruGet = (key: string): FunctionTreeNode | null | undefined => {
    const cache = cacheRef.current;
    if (!cache.has(key)) return undefined;
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value!);
    return value;
  };

  // LRU set: evicts the oldest entry when the cache exceeds MAX_CACHE_SIZE.
  const lruSet = (key: string, value: FunctionTreeNode | null): void => {
    const cache = cacheRef.current;
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    if (cache.size > MAX_CACHE_SIZE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
  };

  const buildFunctionTree = useCallback(
    (funcName: string, ancestorPath: string[] = []): FunctionTreeNode | null => {
      // Prevent direct cycles (A → B → A), but allow diamonds.
      if (ancestorPath.includes(funcName)) return null;

      const cacheKey = `${funcName}|${ancestorPath.join(',')}`;
      const func = functions?.[funcName];
      if (!func) return null;

      // Fast path: return cached entry when the function reference is unchanged.
      const cached = lruGet(cacheKey);
      if (cached !== undefined && cached !== null && cached.function === func) {
        return cached;
      }

      const choices = (func.actions || []).filter(
        (action): action is ChoiceAction =>
          'dialogRef' in action && 'targetFunction' in action
      );

      const newPath = [...ancestorPath, funcName];

      // Pre-compute isShared for all choices at once (O(n) instead of O(n²)).
      const targetCounts = new Map<string, number>();
      choices.forEach((choice) => {
        const target = choice.targetFunction;
        targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
      });

      const children: FunctionTreeChild[] = choices
        .map((choice) => {
          const subtree = buildFunctionTree(choice.targetFunction, newPath);
          return {
            text: choice.text || '(no text)',
            targetFunction: choice.targetFunction,
            subtree,
            isShared: (targetCounts.get(choice.targetFunction) || 0) > 1
          };
        })
        .filter((c): c is FunctionTreeChild => c.subtree !== null);

      const result: FunctionTreeNode = { name: funcName, function: func, children };
      lruSet(cacheKey, result);
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [functions]
  );

  return buildFunctionTree;
}
