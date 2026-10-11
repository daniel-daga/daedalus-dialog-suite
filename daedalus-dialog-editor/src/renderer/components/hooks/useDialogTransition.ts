import { useState, useCallback, useTransition, useRef, useEffect, RefObject } from 'react';
import { useUISelectionStore } from '../../store/uiSelectionStore';

export interface UseDialogTransitionResult {
  isLoadingDialog: boolean;
  setIsLoadingDialog: (loading: boolean) => void;
  finalizeDialogSelection: (dialogName: string, functionName: string | null) => void;
  editorScrollRef: RefObject<HTMLDivElement>;
}

/**
 * Keeps the editor pane mounted across dialog switches instead of unmounting
 * it while loading:
 *  - Navigation handlers set the async flag (`setIsLoadingDialog(true)`)
 *    while a file open is in flight.
 *  - `finalizeDialogSelection` clears that async flag and commits the new
 *    dialog/function selection inside a React transition, so the previously
 *    committed selection keeps rendering until the new one is ready.
 *  - `isLoadingDialog` is true whenever either the async flag or the
 *    transition (`isPending`) is active, so the loading overlay stays
 *    visible continuously across both phases.
 *  - `isPending` is race-free by construction: if two selections are
 *    finalized in quick succession, React resolves the transition against
 *    the latest state update, so the second selection always wins.
 *  - Scrolling back to the top happens once the *committed* selection
 *    actually changes.
 */
export function useDialogTransition(): UseDialogTransitionResult {
  const [isAsyncLoading, setIsAsyncLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const editorScrollRef = useRef<HTMLDivElement>(null);

  const selectedDialog = useUISelectionStore((state) => state.selectedDialog);
  const selectedFunctionName = useUISelectionStore((state) => state.selectedFunctionName);

  useEffect(() => {
    if (editorScrollRef.current) {
      editorScrollRef.current.scrollTop = 0;
    }
  }, [selectedDialog, selectedFunctionName]);

  const finalizeDialogSelection = useCallback((dialogName: string, functionName: string | null) => {
    setIsAsyncLoading(false);

    startTransition(() => {
      const { setSelectedDialog, setSelectedFunctionName } = useUISelectionStore.getState();
      setSelectedDialog(dialogName);
      setSelectedFunctionName(functionName);
    });
  }, []);

  return {
    isLoadingDialog: isPending || isAsyncLoading,
    setIsLoadingDialog: setIsAsyncLoading,
    finalizeDialogSelection,
    editorScrollRef,
  };
}
