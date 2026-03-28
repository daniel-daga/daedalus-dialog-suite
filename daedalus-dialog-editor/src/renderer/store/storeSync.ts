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
import { useProjectStore } from './projectStore';

export function initStoreSync(): () => void {
  return useEditorStore.subscribe((state, prevState) => {
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
}
