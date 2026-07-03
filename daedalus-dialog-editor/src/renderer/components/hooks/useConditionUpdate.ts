import { useState, useRef, useCallback, useEffect } from 'react';
import type { ConditionEditorCondition } from '../dialogTypes';
import { registerPendingEditFlusher } from '../../utils/pendingEditFlushRegistry';

const DEBOUNCE_MS = 300;

export function useConditionUpdate(
  condition: ConditionEditorCondition,
  index: number,
  updateCondition: (index: number, updated: ConditionEditorCondition) => void
) {
  const [localCondition, setLocalCondition] = useState(condition);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs so the cleanup effect always sees the latest values without re-registering
  const localConditionRef = useRef(localCondition);
  const indexRef = useRef(index);
  const updateConditionRef = useRef(updateCondition);

  useEffect(() => { localConditionRef.current = localCondition; }, [localCondition]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { updateConditionRef.current = updateCondition; }, [updateCondition]);

  // Sync local state when parent prop changes
  useEffect(() => { setLocalCondition(condition); }, [condition]);

  const flushUpdate = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updateCondition(index, localCondition);
  }, [updateCondition, index, localCondition]);

  const handleUpdate = useCallback((updated: ConditionEditorCondition) => {
    setLocalCondition(updated);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      updateCondition(index, updated);
    }, DEBOUNCE_MS);
  }, [updateCondition, index]);

  // For selects/switches: skip debounce, apply immediately
  const handleImmediateUpdate = useCallback((updated: ConditionEditorCondition) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLocalCondition(updated);
    updateCondition(index, updated);
  }, [updateCondition, index]);

  // Flush pending debounce on unmount to prevent data loss
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        updateConditionRef.current(indexRef.current, localConditionRef.current);
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

  return { localCondition, handleUpdate, handleImmediateUpdate, flushUpdate };
}
