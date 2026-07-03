/**
 * Pending-edit flush registry (co-owned with fix-05 §2.3).
 *
 * Debounced text editors (ActionCard, condition cards) hold the newest
 * keystrokes in component-local state for up to 300 ms before committing them
 * to the store. Any operation that reads or serializes the model — save,
 * auto-save, discard-decision, undo/redo — must first drain those pending
 * edits, or it acts on a stale model. Each such component registers a flusher
 * on mount; the callers below invoke `flushAllPendingEdits()` before they act.
 *
 * Layering: the store never flushes (it must not know about component debounce
 * internals). UI-layer callers invoke the registry.
 */

type PendingEditFlusher = () => void;

const flushers = new Set<PendingEditFlusher>();

/**
 * Register a flusher that commits this component's pending debounced edit.
 * Returns an unregister function to call on unmount.
 */
export function registerPendingEditFlusher(fn: PendingEditFlusher): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/**
 * Flush every registered pending debounced edit synchronously. Safe to call
 * when nothing is pending — flushers no-op unless they hold a live timer.
 */
export function flushAllPendingEdits(): void {
  // Snapshot: a flusher may unregister (unmount) as a side effect of committing.
  for (const flush of Array.from(flushers)) {
    flush();
  }
}
