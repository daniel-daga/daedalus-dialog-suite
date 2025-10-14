import { useRef, useCallback } from 'react';

/**
 * Custom hook for managing focus navigation across action cards
 * Provides ref array and focus management utilities
 */
export function useFocusNavigation() {
  const actionRefs = useRef<(HTMLInputElement | null)[]>([]);

  /**
   * Focus a specific action by index
   * @param index - The index of the action to focus
   * @param scrollIntoView - Whether to scroll the element into view smoothly
   */
  const focusAction = useCallback((index: number, scrollIntoView = false) => {
    const ref = actionRefs.current[index];
    if (ref) {
      ref.focus();
      // Scroll the element into view smoothly if requested
      if (scrollIntoView) {
        requestAnimationFrame(() => {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        });
      }
    }
  }, []);

  return {
    actionRefs,
    focusAction
  };
}
