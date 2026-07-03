import { useState, useCallback, useTransition, useRef, useEffect, RefObject } from 'react';
import { useUISelectionStore } from '../../store/uiSelectionStore';

export interface UseDialogTransitionResult {
  isLoadingDialog: boolean;
  setIsLoadingDialog: (loading: boolean) => void;
  finalizeDialogSelection: (dialogName: string, functionName: string | null) => void;
  editorScrollRef: RefObject<HTMLDivElement>;
}

/**
 * Manages the RAF-based two-frame sequencing used when switching dialogs:
 *  1. Immediately mark loading so stale content is hidden.
 *  2. Commit the new dialog/function selection inside a React transition.
 *  3. After the first paint, scroll the editor to the top.
 *  4. After the second paint, clear the loading flag.
 *
 * Cancels any in-flight RAFs on remount and whenever a newer dialog is
 * selected mid-transition (Bug #1 fix — prevents memory leaks and stale
 * setIsLoadingDialog calls from previous selections).
 */
export function useDialogTransition(): UseDialogTransitionResult {
  const [isLoadingDialog, setIsLoadingDialog] = useState(false);
  const [_isPending, startTransition] = useTransition();
  const rafId1Ref = useRef<number | null>(null);
  const rafId2Ref = useRef<number | null>(null);
  const dialogTransitionIdRef = useRef(0);
  const editorScrollRef = useRef<HTMLDivElement>(null);

  // Cleanup RAF callbacks on unmount (Bug #1 fix)
  useEffect(() => {
    return () => {
      if (rafId1Ref.current !== null) {
        cancelAnimationFrame(rafId1Ref.current);
      }
      if (rafId2Ref.current !== null) {
        cancelAnimationFrame(rafId2Ref.current);
      }
    };
  }, []);

  const finalizeDialogSelection = useCallback((dialogName: string, functionName: string | null) => {
    const transitionId = dialogTransitionIdRef.current + 1;
    dialogTransitionIdRef.current = transitionId;

    // Cancel any pending RAF callbacks from previous dialog selection (Bug #1 fix)
    if (rafId1Ref.current !== null) {
      cancelAnimationFrame(rafId1Ref.current);
      rafId1Ref.current = null;
    }
    if (rafId2Ref.current !== null) {
      cancelAnimationFrame(rafId2Ref.current);
      rafId2Ref.current = null;
    }

    // Show loading immediately to prevent stale content flash during transitions
    setIsLoadingDialog(true);

    // Use startTransition to keep UI responsive when switching to dialogs with many actions
    startTransition(() => {
      const { setSelectedDialog, setSelectedFunctionName } = useUISelectionStore.getState();
      setSelectedDialog(dialogName);
      setSelectedFunctionName(functionName);

      // Use requestAnimationFrame to ensure state changes are committed and painted
      rafId1Ref.current = requestAnimationFrame(() => {
        // Scroll to top after content has changed
        if (editorScrollRef.current) {
          editorScrollRef.current.scrollTop = 0;
        }

        // Wait one more frame to ensure rendering is complete
        rafId2Ref.current = requestAnimationFrame(() => {
          if (dialogTransitionIdRef.current === transitionId) {
            setIsLoadingDialog(false);
          }

          // Clear refs after execution
          rafId1Ref.current = null;
          rafId2Ref.current = null;
        });
      });
    });
  }, []);

  return { isLoadingDialog, setIsLoadingDialog, finalizeDialogSelection, editorScrollRef };
}
