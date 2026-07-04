import { useRef } from 'react';

type AnyHandler = (...args: any[]) => any;

/**
 * Returns identity-stable wrappers for a set of handlers. Each wrapper keeps the
 * same reference for the component's lifetime and calls through to the latest
 * handler via a ref, so callbacks can cross a `React.memo` boundary (ActionCard)
 * without invalidating it — the memoized child never sees a new function
 * identity, yet always invokes the current implementation.
 *
 * A handler that is `undefined` stays `undefined` in the result: presence is a
 * genuine render input (e.g. `onNavigateToFunction` toggles a UI affordance).
 * The returned object's identity only changes when the *set of defined keys*
 * changes, so a define/undefine transition is still observable to consumers.
 */
export function useStableHandlers<T extends Record<string, AnyHandler | undefined>>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;

  const wrappers = useRef<Record<string, AnyHandler>>({});
  const resultRef = useRef<T | null>(null);
  const definedKeysRef = useRef<string | null>(null);

  const definedKeys = Object.keys(handlers)
    .filter((key) => typeof handlers[key] === 'function')
    .sort()
    .join('|');

  if (definedKeys !== definedKeysRef.current) {
    definedKeysRef.current = definedKeys;
    const out: Record<string, AnyHandler | undefined> = {};
    for (const key of Object.keys(handlers)) {
      if (typeof handlers[key] === 'function') {
        if (!wrappers.current[key]) {
          wrappers.current[key] = (...args: any[]) => (latest.current[key] as AnyHandler)(...args);
        }
        out[key] = wrappers.current[key];
      } else {
        out[key] = undefined;
      }
    }
    resultRef.current = out as T;
  }

  return resultRef.current as T;
}
