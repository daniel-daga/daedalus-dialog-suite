import { useRef, useCallback } from 'react';
import type { ActionPath } from '../nestedActionUtils';
import { actionPathToKey } from '../nestedActionUtils';

/**
 * Custom hook for managing focus navigation across action cards
 * Provides ref array and focus management utilities
 */
export function useFocusNavigation() {
  const actionRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const pendingFocusRequests = useRef<Record<string, { scrollIntoView: boolean }>>({});

  const focusRegisteredAction = useCallback((key: string, scrollIntoView = false) => {
    const ref = actionRefs.current[key];
    if (!ref) {
      return false;
    }

    ref.focus();
    if (scrollIntoView) {
      requestAnimationFrame(() => {
        ref.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      });
    }

    return true;
  }, []);

  const registerActionRef = useCallback((path: ActionPath, element: HTMLInputElement | null) => {
    const key = actionPathToKey(path);
    actionRefs.current[key] = element;

    if (!element) {
      return;
    }

    const pendingFocus = pendingFocusRequests.current[key];
    if (pendingFocus) {
      delete pendingFocusRequests.current[key];
      focusRegisteredAction(key, pendingFocus.scrollIntoView);
    }
  }, [focusRegisteredAction]);

  /**
   * Focus a specific action by index
   * @param index - The index of the action to focus
   * @param scrollIntoView - Whether to scroll the element into view smoothly
   */
  const focusAction = useCallback((path: ActionPath, scrollIntoView = false) => {
    const key = actionPathToKey(path);
    const focused = focusRegisteredAction(key, scrollIntoView);
    if (!focused) {
      pendingFocusRequests.current[key] = { scrollIntoView };
    }
  }, [focusRegisteredAction]);

  /**
   * Trim the refs array to match the current number of actions
   * Call this after rendering when actions change
   */
  const trimRefs = useCallback((visiblePaths: ActionPath[]) => {
    const nextKeys = new Set(visiblePaths.map((path) => actionPathToKey(path)));
    Object.keys(actionRefs.current).forEach((key) => {
      if (!nextKeys.has(key)) {
        delete actionRefs.current[key];
      }
    });
    Object.keys(pendingFocusRequests.current).forEach((key) => {
      if (!nextKeys.has(key)) {
        delete pendingFocusRequests.current[key];
      }
    });
  }, []);

  return {
    actionRefs,
    registerActionRef,
    focusAction,
    trimRefs
  };
}
