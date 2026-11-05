/**
 * Cross-store synchronisation bridge.
 *
 * Problem this solves (refactoring-targets item 10):
 *   Both `editorStore` and `projectStore` held a copy of every open file's
 *   semantic model.  Previously editorStore imported projectStore directly and
 *   called `updateFileModel()` at nine separate call sites after every model
 *   mutation.  This created invisible coupling: any change to projectStore's
 *   public interface could silently break the sync, and the push logic was
 *   scattered rather than owned by a single place.
 *
 * Solution — inverted-dependency subscription:
 *   editorStore no longer imports projectStore.  Instead, this module owns the
 *   cross-store wiring by subscribing to editorStore's state changes and
 *   forwarding model updates to projectStore's parsed-files cache.
 *
 *   The world's waynet names reach the Problems scan the same way: the scan
 *   reads them from `worldStore` when it runs, and this module is what makes it
 *   run when they change (level-editor.md §16.8).
 *
 *   The edit history's cleanup is here too (issue #532): closing a file or
 *   saving its source drops that file's undo stack, and no other place owns a
 *   teardown for it.
 *
 *   A reference-equality guard on `semanticModel` ensures we only push to
 *   projectStore when a file's model has actually changed — not on every
 *   unrelated editorStore mutation (dirty-flag updates, history stack changes,
 *   etc.).
 *
 * Usage:
 *   Call `initStoreSync()` once during application bootstrap (e.g. App.tsx).
 *   The returned function unsubscribes the listener (useful for tests).
 */

import { useEditorStore } from './editorStore';
import { useFileStore } from './fileStore';
import { useHistoryStore } from './historyStore';
import { useProjectStore } from './projectStore';
import { useProblemsStore } from './problemsStore';
import { useWorldStore } from './worldStore';

export function initStoreSync(): () => void {
  /**
   * Closing a file or reloading its source from disk drops its undo stack: the
   * snapshots belong to the model that no longer exists.
   */
  const unsubscribeHistory = useFileStore.subscribe((state, prevState) => {
    if (state.openFiles === prevState.openFiles) return;

    const removedFiles: string[] = [];
    prevState.openFiles.forEach((_, filePath) => {
      if (!state.openFiles.has(filePath)) {
        removedFiles.push(filePath);
      }
    });

    if (removedFiles.length > 0) {
      const historyState = useHistoryStore.getState();
      removedFiles.forEach((fp) => historyState.clearHistoryForFile(fp));
    }

    // Detect source saves: existing file whose originalCode changed and is no
    // longer dirty. Only the saved file's history is cleared.
    state.openFiles.forEach((fileState, filePath) => {
      const prevFileState = prevState.openFiles.get(filePath);
      if (
        prevFileState &&
        prevFileState.originalCode !== fileState.originalCode &&
        !fileState.isDirty
      ) {
        useHistoryStore.getState().clearHistoryForFile(filePath);
      }
    });
  });

  /**
   * A world opening, closing, gaining/losing/renaming a waypoint, or gaining an
   * edit changes what the scan would say, so the project is re-scanned.
   * `waynetLoaded` keeps the object identity when a re-read changed no name,
   * which confines the name half to those events: a gizmo drag re-reads the
   * payload and does not reach it. The edit half is `editCount`, because a move
   * changes no name and `routine-mob-missing` asks about positions — and it is
   * a counter rather than a payload comparison because `requestScan` debounces,
   * so a drag's one commit costs one scan.
   */
  const unsubscribeWorld = useWorldStore.subscribe((state, prevState) => {
    // The portal findings arrive once per open and are cleared with the world
    // (level-editor.md §16.20 slice 3); either edge is a re-scan.
    if (state.waynetNames === prevState.waynetNames
      && state.portalFindings === prevState.portalFindings
      && state.editCount === prevState.editCount) return;
    useProblemsStore.getState().requestScan();
  });

  const unsubscribeEditor = useEditorStore.subscribe((state, prevState) => {
    // Skip when openFiles reference is unchanged (e.g. settings-only updates)
    if (state.openFiles === prevState.openFiles) return;

    state.openFiles.forEach((fileState, filePath) => {
      const prevFileState = prevState.openFiles.get(filePath);
      // Push to projectStore only when the model reference has changed for
      // this file (immer preserves references for unmodified entries).
      if (!prevFileState || prevFileState.semanticModel !== fileState.semanticModel) {
        useProjectStore.getState().updateFileModel(filePath, fileState.semanticModel);
      }
    });
  });

  return () => {
    unsubscribeHistory();
    unsubscribeWorld();
    unsubscribeEditor();
  };
}
