import { useState, useCallback } from 'react';

export interface RecentDialogTab {
  dialogName: string;
  npcName: string;
  functionName: string | null;
}

const MAX_RECENT_DIALOGS = 10;

export interface UseRecentDialogTabsResult {
  recentDialogs: RecentDialogTab[];
  addRecentDialog: (dialogName: string, npcName: string, functionName: string | null) => void;
  /**
   * Remove a tab.  Returns the next tab to activate when the removed tab was
   * the active one, or `null` when no fallback is available.
   */
  closeRecentDialog: (
    dialogName: string,
    npcName: string,
    activeDialogName: string | null,
    activeNpcName: string | null
  ) => RecentDialogTab | null;
}

/**
 * Manages the list of recently-opened dialog tabs shown above the editor pane.
 *
 * Tab order is kept stable: selecting an existing tab updates its metadata
 * in-place rather than moving it, to avoid horizontal reflow.  New tabs are
 * appended and the list is capped at MAX_RECENT_DIALOGS entries.
 */
export function useRecentDialogTabs(): UseRecentDialogTabsResult {
  const [recentDialogs, setRecentDialogs] = useState<RecentDialogTab[]>([]);

  const addRecentDialog = useCallback(
    (dialogName: string, npcName: string, functionName: string | null) => {
      setRecentDialogs((prev) => {
        const existingIndex = prev.findIndex(
          (tab) => tab.dialogName === dialogName && tab.npcName === npcName
        );

        // Keep tab order stable — only update metadata for existing tabs.
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], functionName };
          return next;
        }

        const next = [...prev, { dialogName, npcName, functionName }];
        if (next.length > MAX_RECENT_DIALOGS) {
          return next.slice(next.length - MAX_RECENT_DIALOGS);
        }
        return next;
      });
    },
    []
  );

  // closeRecentDialog is called inside a React event handler, so `setRecentDialogs`
  // with a direct array (non-updater form) is safe — the value comes from the
  // component's current render snapshot passed in by the caller.
  const closeRecentDialog = useCallback(
    (
      dialogName: string,
      npcName: string,
      activeDialogName: string | null,
      activeNpcName: string | null
    ): RecentDialogTab | null => {
      // Read the snapshot directly to compute the next tab synchronously
      // before the state update is flushed.
      let nextTab: RecentDialogTab | null = null;

      setRecentDialogs((prev) => {
        const tabIndex = prev.findIndex(
          (tab) => tab.dialogName === dialogName && tab.npcName === npcName
        );
        if (tabIndex < 0) return prev;

        const nextTabs = prev.filter((_, i) => i !== tabIndex);

        const closingSelectedTab =
          activeDialogName === dialogName && activeNpcName === npcName;
        if (closingSelectedTab && nextTabs.length > 0) {
          const fallbackIndex = Math.min(tabIndex, nextTabs.length - 1);
          nextTab = nextTabs[fallbackIndex] ?? null;
        }

        return nextTabs;
      });

      return nextTab;
    },
    []
  );

  return { recentDialogs, addRecentDialog, closeRecentDialog };
}
