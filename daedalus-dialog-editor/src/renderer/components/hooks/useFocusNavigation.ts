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
   * @param path - The path of the action to focus
   * @param scrollIntoView - Whether to scroll the element into view smoothly
   *
   * Stores a pending request for the case where the element hasn't mounted yet
   * (e.g. a newly inserted action). If the element is already registered the
   * pending request is cleared immediately after focus is applied, preventing
   * stale requests from firing again on future re-renders of the same card.
   */
  const focusAction = useCallback((path: ActionPath, scrollIntoView = false) => {
    const key = actionPathToKey(path);
    pendingFocusRequests.current[key] = { scrollIntoView };
    const focused = focusRegisteredAction(key, scrollIntoView);
    if (focused) {
      // Element was already registered — remove the pending request so it
      // doesn't fire again when the card re-renders with a new path reference.
      delete pendingFocusRequests.current[key];
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
