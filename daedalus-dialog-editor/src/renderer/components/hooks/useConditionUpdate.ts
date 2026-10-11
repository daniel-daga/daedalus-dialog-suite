import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConditionEditorCondition } from '../dialogTypes';
import { registerPendingEditFlusher } from '../../utils/pendingEditFlushRegistry';
import { shallowEqual } from '../../utils/shallowEqual';

const DEBOUNCE_MS = 300;

export function useConditionUpdate(
  condition: ConditionEditorCondition,
  index: number,
  updateCondition: (index: number, updated: ConditionEditorCondition) => void
) {
  const [localCondition, setLocalCondition] = useState(condition);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs so every timer/flush resolves the LATEST index & value at fire time.
  // ConditionCards are keyed by array index, so a deletion elsewhere reindexes
  // this card while a debounce is pending; a lexically captured index would
  // write onto the wrong slot (finding U3). Mirrors ActionCard's ref pattern.
  const localConditionRef = useRef(localCondition);
  const conditionRef = useRef(condition);
  const indexRef = useRef(index);
  const updateConditionRef = useRef(updateCondition);

  useEffect(() => { localConditionRef.current = localCondition; }, [localCondition]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { updateConditionRef.current = updateCondition; }, [updateCondition]);

  // Sync local state (and the last parent-synced ref) when the prop changes.
  useEffect(() => {
    conditionRef.current = condition;
    setLocalCondition(condition);
  }, [condition]);

  const flushUpdate = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateCondition(index, localCondition);
  }, [updateCondition, index, localCondition]);

  const handleUpdate = useCallback((updated: ConditionEditorCondition) => {
    setLocalCondition(updated);
    localConditionRef.current = updated;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Resolve index/value via refs at fire time: the card may have shifted
      // while the debounce was pending, and a lexical index would write the
      // edit onto a sibling condition.
      updateConditionRef.current(indexRef.current, localConditionRef.current);
      timerRef.current = null;
    }, DEBOUNCE_MS);
  }, []);

  // Called by the card's own delete button before it removes this condition.
  // Cancels the pending debounce and marks local state as already-synced so the
  // unmount flush cannot resurrect the deleted condition.
  const markDeleted = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    conditionRef.current = localConditionRef.current;
  }, []);

  // For selects/switches: skip debounce, apply immediately
  const handleImmediateUpdate = useCallback((updated: ConditionEditorCondition) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLocalCondition(updated);
    updateCondition(index, updated);
  }, [updateCondition, index]);

  // Flush pending debounce on unmount to prevent data loss. Guarded like
  // ActionCard: only flush when the local value actually differs from the last
  // parent-synced condition. During a reindex-driven unmount (a deletion above
  // this card) the shifted-in condition is re-synced first, so an equal value
  // means there is nothing pending to commit — avoids writing a stale slot.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (!shallowEqual(localConditionRef.current, conditionRef.current)) {
          updateConditionRef.current(indexRef.current, localConditionRef.current);
        }
      }
    };
  }, []);

  // Register a save/undo-time flusher (N4): a save within the 300 ms debounce
  // window must serialize the newest keystroke. No-ops unless a timer is live;
  // when it fires it commits the pending edit exactly as the timer body would,
  // resolving index/value via refs so a shifted card writes the right slot.
  useEffect(() => {
    return registerPendingEditFlusher(() => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        updateConditionRef.current(indexRef.current, localConditionRef.current);
      }
    });
  }, []);

  return { localCondition, handleUpdate, handleImmediateUpdate, flushUpdate, markDeleted };
}
